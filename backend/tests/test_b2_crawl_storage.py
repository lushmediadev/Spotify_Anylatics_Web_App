"""Crawl storage/lifecycle contracts: compact job results, raw pruning, recovery, cleanup, secrets."""

import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app import database
from app.config import Settings, validate_production_secrets
from app.database import Base
from app.models.crawl_job import CrawlJob
from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.models.user import User
from app.services import crawler


@compiles(JSONB, "sqlite")
def sqlite_jsonb(type_, compiler, **kwargs):
    return "JSON"


class AsyncSessionAdapter:
    """Execute real SQL through the async interface used by workers."""

    def __init__(self, session):
        self.session = session

    @property
    def info(self):
        return self.session.info

    async def execute(self, statement, *args, **kwargs):
        return self.session.execute(statement, *args, **kwargs)

    def add(self, instance):
        self.session.add(instance)

    async def flush(self):
        self.session.flush()

    async def commit(self):
        self.session.commit()

    async def rollback(self):
        self.session.rollback()


def fixed_uuid(value):
    # PostgreSQL UUID compiles with numeric affinity in SQLite; retain hex letters.
    return uuid.UUID(int=(0xABCDEF << 104) + value)


PLAYLIST_ID = "P" * 22


@pytest.fixture
def env(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{(tmp_path / 'b2.db').as_posix()}",
                           connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def enable_fks(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(id=fixed_uuid(1), username="owner", email="owner@example.test",
                    password_hash="unused", role="user")
        session.add(user)
        session.flush()
        item = Item(id=fixed_uuid(10), user_id=user.id, spotify_id=PLAYLIST_ID, item_type="playlist",
                    name="Old name", group="G", status="crawling", followers=5)
        session.add(item)
        session.commit()

    state = SimpleNamespace(engine=engine, user=user, item=item, open_sessions=0)

    @asynccontextmanager
    async def session_context():
        with Session(engine, expire_on_commit=False) as session:
            state.open_sessions += 1
            try:
                yield AsyncSessionAdapter(session)
            finally:
                state.open_sessions -= 1

    monkeypatch.setattr(database, "async_session", session_context)
    try:
        yield state
    finally:
        engine.dispose()


def add_job(env, job_id, status="pending", result=None, created_at=None, started_at=None, item_id=None):
    with Session(env.engine) as session:
        session.add(CrawlJob(id=job_id, item_id=item_id or env.item.id, user_id=env.user.id,
                             spotify_url=f"https://open.spotify.com/playlist/{PLAYLIST_ID}",
                             item_type="playlist", status=status, result=result,
                             created_at=created_at or datetime.utcnow(), started_at=started_at))
        session.commit()


def test_job_result_summary_is_compact_and_keeps_marker():
    data = {"name": "List", "followers": 7, "track_count": 2000, "playcount": None,
            "tracks": [{"name": f"t{i}"} for i in range(2000)], "artist_names": ["a"] * 50,
            "extra": {"nested": True}}
    summary = crawler._job_result_summary({"youtube_channel_job": True}, data)
    assert summary["name"] == "List" and summary["followers"] == 7 and summary["track_count"] == 2000
    assert "playcount" in summary and summary["playcount"] is None
    assert "tracks" not in summary and "extra" not in summary
    assert len(summary["artist_names"]) == crawler.JOB_RESULT_MAX_ARTISTS
    assert summary["youtube_channel_job"] is True
    assert "youtube_channel_job" not in crawler._job_result_summary({}, data)


def test_crawl_holds_no_session_during_fetch_and_prunes_raw(env, monkeypatch):
    monkeypatch.setattr(crawler.settings, "RAW_RESPONSE_KEEP_PER_ITEM", 3)
    old = datetime.utcnow() - timedelta(days=1)
    with Session(env.engine) as session:
        for index in range(4):
            session.add(RawResponse(spotify_id=PLAYLIST_ID, operation="fetch_playlist",
                                    response_data={"n": index}, captured_at=old + timedelta(minutes=index)))
        session.add(RawResponse(spotify_id="Z" * 22, operation="fetch_playlist", response_data={}))
        session.commit()
    seen_sessions = []

    async def fake_fetch(spotify_id):
        seen_sessions.append(env.open_sessions)
        return {"name": "New name", "followers": 9, "track_count": 2,
                "tracks": [{"name": "a"}, {"name": "b"}]}

    monkeypatch.setitem(crawler.FETCHERS, "playlist", fake_fetch)
    job_id = fixed_uuid(100)
    add_job(env, job_id)
    asyncio.run(crawler.crawl_item_task(str(job_id), PLAYLIST_ID, "playlist"))

    assert seen_sessions == [0]
    with Session(env.engine) as session:
        job = session.get(CrawlJob, job_id)
        assert job.status == "completed" and job.completed_at is not None and job.started_at is not None
        assert job.result["name"] == "New name" and job.result["track_count"] == 2
        assert "tracks" not in job.result
        item = session.get(Item, env.item.id)
        assert item.status == "active" and item.name == "New name" and item.followers == 9
        assert len(session.scalars(select(MetricsSnapshot)).all()) == 1
        raws = session.scalars(select(RawResponse).where(RawResponse.spotify_id == PLAYLIST_ID)
                               .order_by(RawResponse.captured_at.desc())).all()
        assert len(raws) == 3
        assert raws[0].response_data["tracks"] == [{"name": "a"}, {"name": "b"}]
        assert [raw.response_data.get("n") for raw in raws[1:]] == [3, 2]
        # Other Spotify IDs are untouched.
        assert len(session.scalars(select(RawResponse).where(RawResponse.spotify_id == "Z" * 22)).all()) == 1


def test_crawl_failure_marks_job_and_item_error(env, monkeypatch):
    async def failing_fetch(spotify_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(crawler.settings, "MAX_RETRIES", 1)
    monkeypatch.setitem(crawler.FETCHERS, "playlist", failing_fetch)
    job_id = fixed_uuid(101)
    add_job(env, job_id)
    asyncio.run(crawler.crawl_item_task(str(job_id), PLAYLIST_ID, "playlist"))
    with Session(env.engine) as session:
        job = session.get(CrawlJob, job_id)
        assert job.status == "error" and job.retry_count == 1
        assert job.error == "All retry attempts failed - no data returned"
        item = session.get(Item, env.item.id)
        assert item.status == "error" and item.error_message == job.error


def test_startup_recovery_skips_youtube_channel_jobs(env):
    with Session(env.engine) as session:
        session.add(Item(id=fixed_uuid(11), user_id=env.user.id, spotify_id="Y" * 22, item_type="playlist",
                         workspace="channel-playlists", status="crawling"))
        session.commit()
    add_job(env, fixed_uuid(200), status="crawling", started_at=datetime.utcnow())
    add_job(env, fixed_uuid(201), status="pending", result={})
    add_job(env, fixed_uuid(202), status="pending", result={"youtube_channel_job": True}, item_id=fixed_uuid(11))
    add_job(env, fixed_uuid(203), status="completed", result={"name": "x"})

    assert asyncio.run(crawler.recover_interrupted_jobs()) == 2
    with Session(env.engine) as session:
        for job_id in (fixed_uuid(200), fixed_uuid(201)):
            job = session.get(CrawlJob, job_id)
            assert job.status == "error" and job.error == crawler.INTERRUPTED_BY_RESTART
            assert job.completed_at is not None
        assert session.get(CrawlJob, fixed_uuid(202)).status == "pending"
        assert session.get(CrawlJob, fixed_uuid(203)).status == "completed"
        item = session.get(Item, env.item.id)
        assert item.status == "error" and item.error_message == crawler.ITEM_INTERRUPTED_MESSAGE
        assert session.get(Item, fixed_uuid(11)).status == "crawling"


def test_stale_recovery_only_long_running_crawls(env):
    now = datetime.utcnow()
    add_job(env, fixed_uuid(300), status="crawling", started_at=now - timedelta(minutes=5))
    add_job(env, fixed_uuid(301), status="pending", created_at=now - timedelta(hours=2))
    asyncio.run(crawler.recover_interrupted_jobs(stale_after=timedelta(minutes=30)))
    with Session(env.engine) as session:
        assert session.get(CrawlJob, fixed_uuid(300)).status == "crawling"
        assert session.get(CrawlJob, fixed_uuid(301)).status == "pending"
        assert session.get(Item, env.item.id).status == "crawling"

    add_job(env, fixed_uuid(302), status="crawling", started_at=now - timedelta(minutes=31))
    add_job(env, fixed_uuid(303), status="crawling", started_at=now - timedelta(minutes=31),
            result={"youtube_channel_job": True})
    asyncio.run(crawler.recover_interrupted_jobs(stale_after=timedelta(minutes=30)))
    with Session(env.engine) as session:
        assert session.get(CrawlJob, fixed_uuid(302)).status == "error"
        assert session.get(CrawlJob, fixed_uuid(303)).status == "crawling"
        # Other active jobs still own the item, so it stays crawling.
        assert session.get(Item, env.item.id).status == "crawling"


def test_cleanup_retention(env, monkeypatch):
    monkeypatch.setattr(crawler, "CLEANUP_BATCH_SIZE", 2)
    now = datetime.utcnow()
    with Session(env.engine) as session:
        for index in range(5):
            session.add(RawResponse(spotify_id=PLAYLIST_ID, operation="fetch_playlist", response_data={"n": index},
                                    captured_at=now - timedelta(days=60 - index)))
        # The only (old) raw row for another ID backs export fallbacks and must survive.
        session.add(RawResponse(spotify_id="Q" * 22, operation="fetch_playlist", response_data={"keep": True},
                                captured_at=now - timedelta(days=120)))
        session.commit()
    add_job(env, fixed_uuid(400), status="completed", result={"tracks": [1, 2]}, created_at=now - timedelta(days=10))
    add_job(env, fixed_uuid(401), status="completed", result={"name": "recent"}, created_at=now - timedelta(days=1))
    add_job(env, fixed_uuid(402), status="pending", result={"youtube_channel_job": True},
            created_at=now - timedelta(days=100))
    add_job(env, fixed_uuid(403), status="error", created_at=now - timedelta(days=100))
    add_job(env, fixed_uuid(404), status="completed", result={"name": "old"}, created_at=now - timedelta(days=95))

    stats = asyncio.run(crawler.cleanup_crawl_storage())
    assert stats["raw_responses_deleted"] == 4 and stats["crawl_jobs_deleted"] == 2
    with Session(env.engine) as session:
        raws = session.scalars(select(RawResponse)).all()
        assert sorted((raw.spotify_id, raw.response_data.get("n")) for raw in raws if raw.spotify_id == PLAYLIST_ID) == [(PLAYLIST_ID, 4)]
        assert any(raw.spotify_id == "Q" * 22 for raw in raws)
        assert session.get(CrawlJob, fixed_uuid(400)).result is None
        assert session.get(CrawlJob, fixed_uuid(401)).result == {"name": "recent"}
        marker = session.get(CrawlJob, fixed_uuid(402))
        assert marker.status == "pending" and marker.result == {"youtube_channel_job": True}
        assert session.get(CrawlJob, fixed_uuid(403)) is None
        assert session.get(CrawlJob, fixed_uuid(404)) is None


@pytest.mark.parametrize("overrides,should_raise", [
    ({"JWT_SECRET_KEY": "change-me-in-production-jwt", "SECRET_KEY": "change-me-in-production"}, True),
    ({"JWT_SECRET_KEY": "change-me-jwt", "SECRET_KEY": "a" * 40}, True),
    ({"JWT_SECRET_KEY": "b" * 40, "SECRET_KEY": "change-me-app-secret"}, True),
    ({"JWT_SECRET_KEY": "b" * 40, "SECRET_KEY": ""}, True),
    ({"DEBUG": True, "JWT_SECRET_KEY": "change-me-in-production-jwt"}, False),
    ({"ENFORCE_SECRET_CHECK": False, "SECRET_KEY": "change-me-in-production"}, False),
    ({"JWT_SECRET_KEY": "b" * 40, "SECRET_KEY": "a" * 40}, False),
])
def test_production_secret_check(overrides, should_raise):
    config = Settings(_env_file=None, **{"DEBUG": False, "ENFORCE_SECRET_CHECK": True, **overrides})
    if should_raise:
        with pytest.raises(RuntimeError, match="placeholder"):
            validate_production_secrets(config)
    else:
        validate_production_secrets(config)


def test_weak_secret_only_warns_when_not_enforced(caplog):
    config = Settings(_env_file=None, DEBUG=False, JWT_SECRET_KEY="change-me-jwt", SECRET_KEY="a" * 40)
    validate_production_secrets(config)  # default: warn, do not stop the app
    assert "JWT_SECRET_KEY" in caplog.text
