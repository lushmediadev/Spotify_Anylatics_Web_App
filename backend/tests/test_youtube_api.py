"""HTTP integration contracts backed by SQLite, with no remote lifespan/jobs."""

import asyncio
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from threading import Barrier
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app import database
from app.api import auth as auth_api, items as items_api, youtube as api
from app.api import crawl as crawl_api, jobs as jobs_api
from app.database import Base, get_db
from app.models.crawl_job import CrawlJob
from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.models.user import User
from app.models.youtube import Channel, ChannelPlaylist, ChannelSnapshot, YouTubeApiKey, YouTubeChannelGroup
from app.services import youtube as youtube_service, youtube_jobs
from app.services.auth import get_current_user
from app.utils.youtube_urls import parse_youtube_url


@compiles(JSONB, "sqlite")
def sqlite_jsonb(type_, compiler, **kwargs):
    return "JSON"


class AsyncSessionAdapter:
    """Execute real SQL through the async interface used by routes/workers."""

    def __init__(self, session):
        self.session = session

    async def execute(self, statement, *args, **kwargs):
        return self.session.execute(statement, *args, **kwargs)

    async def scalar(self, statement, *args, **kwargs):
        return self.session.scalar(statement, *args, **kwargs)

    async def get(self, model, identity):
        return self.session.get(model, identity)

    def add(self, instance):
        self.session.add(instance)

    async def flush(self):
        self.session.flush()

    async def commit(self):
        self.session.commit()

    async def rollback(self):
        self.session.rollback()

    async def refresh(self, instance):
        self.session.refresh(instance)

    async def delete(self, instance):
        self.session.delete(instance)


NAMES = ("manager", "assigned", "unassigned", "other_manager", "admin", "linked_admin")
ALLOWED = {"manager"}
CHANNEL_ID = "UC" + "a" * 22
NEW_PLAYLIST = "N" * 22


def fixed_uuid(value):
    # PostgreSQL UUID compiles with numeric affinity in SQLite; retain hex letters.
    return uuid.UUID(int=(0xABCDEF << 104) + value)


def utc_now():
    return datetime.now(UTC).replace(tzinfo=None)


@pytest.fixture
def env(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{(tmp_path / 'youtube.db').as_posix()}",
                           connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def enable_fks(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    users, channels, items = {}, {}, {}
    with Session(engine, expire_on_commit=False) as session:
        for index, name in enumerate(NAMES):
            role = "manager" if "manager" in name else "admin" if "admin" in name else "user"
            users[name] = User(id=fixed_uuid(index + 1), username=name,
                               email=f"{name}@example.test", password_hash="unused", role=role,
                               display_name=f"Display {name}", avatar=f"https://example.test/{name}.png")
        session.add_all(users.values())
        session.flush()
        users["assigned"].manager_id = users["manager"].id
        users["linked_admin"].manager_id = users["manager"].id
        for index, name in enumerate(NAMES):
            channels[name] = Channel(id=fixed_uuid(100 + index), user_id=users[name].id,
                query_type="handle", query=f"@{name}", name=f"Channel {name}", group="Shared",
                status="error" if name == "assigned" else "active",
                view_count=100, view_count_delta=5 if name == "assigned" else 0,
                created_at=datetime(2026, 1, 1) + timedelta(days=index))
            items[name] = Item(id=fixed_uuid(200 + index), user_id=users[name].id,
                spotify_id=f"{index:022d}", item_type="playlist", name=f"Playlist {name}",
                group="Original", status="active", followers=17, track_count=3,
                image="https://example.test/cover.png", created_at=datetime(2026, 1, 1))
        session.add_all([*channels.values(), *items.values()])
        session.flush()
        for name in NAMES:
            session.add(ChannelPlaylist(channel_id=channels[name].id, item_id=items[name].id))
            session.add(ChannelSnapshot(channel_id=channels[name].id, view_count=100,
                                        captured_at=datetime(2026, 1, 1)))
            session.add(MetricsSnapshot(item_id=items[name].id, spotify_id=items[name].spotify_id,
                                        followers=17, track_count=3))
            session.add(RawResponse(spotify_id=items[name].spotify_id, operation="test", response_data={}))
            session.add(YouTubeApiKey(user_id=users[name].id, key=f"key_{name}", position=0))
        session.commit()

    state = SimpleNamespace(engine=engine, users=users, channels=channels, items=items,
                            actor="manager", scheduled=[], statements=[], worker_sessions=[])

    @event.listens_for(engine, "before_cursor_execute")
    def record_sql(connection, cursor, statement, parameters, context, executemany):
        state.statements.append(statement)

    @asynccontextmanager
    async def session_context():
        with Session(engine, expire_on_commit=False) as session:
            state.worker_sessions.append(session)
            try:
                yield AsyncSessionAdapter(session)
                session.commit()
            except Exception:
                session.rollback()
                raise

    async def override_db():
        async with session_context() as db:
            yield db

    async def actor(db=Depends(get_db)):
        # Actor selection only is overridden; every resource scope runs real SQL.
        return await db.get(User, users[state.actor].id)

    def track(coroutine):
        try:
            name = coroutine.cr_code.co_name
            args = dict(coroutine.cr_frame.f_locals)
            # A separate connection proves durability before background scheduling.
            with Session(engine) as session:
                if name == "refresh_channels":
                    owner = args["owner_id"]
                    ids = args["channel_ids"]
                    rows = session.scalars(select(Channel).where(Channel.id.in_(ids))).all()
                    assert len(rows) == len(ids)
                    assert all(row.user_id == owner and row.status == "crawling" for row in rows)
                    assert args["attempts"] == {row.id: row.refresh_started_at for row in rows}
                elif name == "run_spotify_job":
                    job = session.get(CrawlJob, args["job_id"])
                    assert job is not None and job.status == "pending"
                    item = session.get(Item, job.item_id)
                    assert item is not None and item.user_id == job.user_id
                    assert item.spotify_id == args["spotify_id"] and item.status == "crawling"
                else:
                    pytest.fail(f"Unexpected scheduled worker: {name}")
            state.scheduled.append((name, args))
        finally:
            coroutine.close()

    monkeypatch.setattr(youtube_jobs, "track", track)
    monkeypatch.setattr(database, "async_session", session_context)
    monkeypatch.setattr(youtube_jobs, "crawl_item_task", AsyncMock())
    monkeypatch.setattr(crawl_api, "crawl_item_task", AsyncMock())
    state.external_check = AsyncMock(return_value=[{"status": "ok"}])
    monkeypatch.setattr(api, "check_external_keys", state.external_check)
    app = FastAPI()
    app.include_router(api.router, prefix="/api")
    app.include_router(items_api.router, prefix="/api")
    app.include_router(auth_api.router, prefix="/api")
    app.include_router(crawl_api.router, prefix="/api")
    app.include_router(jobs_api.router, prefix="/api")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = actor
    state.app = app
    # No TestClient context: do not invoke any production lifespan startup.
    state.client = TestClient(app)
    try:
        yield state
    finally:
        state.client.close()
        app.dependency_overrides.clear()
        engine.dispose()


def request(env, method, path="/channels", **kwargs):
    return env.client.request(method, "/api/youtube" + path, **kwargs)


def rows(env, model):
    with Session(env.engine) as session:
        return session.scalars(select(model)).all()


def ids(env, model):
    return {row.id for row in rows(env, model)}


def link_ids(env, channel):
    return {row.item_id for row in rows(env, ChannelPlaylist) if row.channel_id == channel.id}


def playlist_url(item):
    return f"https://open.spotify.com/playlist/{item.spotify_id}"


@pytest.mark.parametrize("actor,visible", [
    ("manager", ALLOWED), ("assigned", {"assigned"}), ("unassigned", {"unassigned"}),
    ("admin", {"admin"}),
])
def test_list_owner_scopes_and_own_key_counts(env, actor, visible):
    env.actor = actor
    response = request(env, "GET")
    assert response.status_code == 200, response.text
    body = response.json()
    assert {row["id"] for row in body["items"]} == {str(env.channels[name].id) for name in visible}
    assert body["total"] == len(visible)
    assert body["groups"] == [{"name": "Shared", "count": len(visible)}]
    assert body["key_count"] == 1 and body["has_keys"] is True


@pytest.mark.parametrize("owner", NAMES)
def test_explicit_owner_filter_intersects_manager_scope(env, owner):
    response = request(env, "GET", params={"user_id": str(env.users[owner].id)})
    assert response.status_code == 200
    body = response.json()
    expected = 1 if owner in ALLOWED else 0
    assert body["total"] == len(body["items"]) == expected
    assert sum(group["count"] for group in body["groups"]) == expected
    assert {row["user_id"] for row in body["items"]} == ({str(env.users[owner].id)} if expected else set())


@pytest.mark.parametrize("actor,owner", [(a, o) for a in ("manager", "assigned", "admin") for o in NAMES])
def test_detail_and_mutation_scopes(env, actor, owner):
    env.actor = actor
    allowed = owner == actor
    path = f"/channels/{env.channels[owner].id}"
    response = request(env, "GET", path)
    assert response.status_code == (200 if allowed else 404), response.text
    if allowed:
        playlist = response.json()["playlists"][0]
        assert playlist["user_id"] == str(env.users[owner].id)
        assert playlist["user_name"] == f"Display {owner}"
        assert playlist["user_avatar"] == env.users[owner].avatar
        assert playlist["followers"] == 17
    else:
        before = ids(env, Channel), link_ids(env, env.channels[owner])
        for method, suffix, data in [
            ("POST", "/refresh", None), ("POST", "/playlists/refresh", None),
            ("PUT", "/playlists", {"item_ids": [], "urls": []}), ("DELETE", "", None),
        ]:
            assert request(env, method, path + suffix, json=data).status_code == 404
        assert (ids(env, Channel), link_ids(env, env.channels[owner])) == before
        assert env.scheduled == []


def test_list_order_groups_filters_and_pagination(env):
    with Session(env.engine) as session:
        session.add(Channel(id=fixed_uuid(99), user_id=env.users["manager"].id,
            query_type="handle", query="@older", group="Other", status="active",
            view_count_delta=-2, created_at=env.channels["manager"].created_at))
        session.commit()
    body = request(env, "GET").json()
    assert [row["id"] for row in body["items"]] == [
        str(fixed_uuid(99)), str(env.channels["manager"].id)]
    page = request(env, "GET", params={"offset": 1, "limit": 1}).json()
    assert page["total"] == 2 and [row["id"] for row in page["items"]] == [str(env.channels["manager"].id)]
    expected_groups = [{"name": "Other", "count": 1}, {"name": "Shared", "count": 1}]
    for params, expected in [
        ({"filter": "changed"}, {str(fixed_uuid(99))}),
        ({"filter": "errors"}, set()),
        ({"group": "Other"}, {str(fixed_uuid(99))}),
        ({"group": "aLl"}, {row["id"] for row in body["items"]}),
        ({"search": " Channel assigned "}, set()),
        ({"search": "@unassigned"}, set()),
    ]:
        result = request(env, "GET", params=params)
        assert result.status_code == 200
        assert {row["id"] for row in result.json()["items"]} == expected
        assert result.json()["total"] == len(expected)
        assert result.json()["groups"] == expected_groups
    for params in ({"limit": 0}, {"offset": -1}, {"filter": "unknown"}, {"user_id": "bad"}):
        assert request(env, "GET", params=params).status_code == 422


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/keys", None), ("PUT", "/keys", {"api_keys": "key"}),
    ("POST", "/keys/check", {}), ("GET", "/channels", None),
    ("POST", "/groups", {"name": "Private"}),
    ("POST", "/channels", {"urls": ["@new"], "group": "New"}),
    ("POST", "/channels/refresh", {}), ("GET", "/channels/{id}", None),
    ("DELETE", "/channels/{id}", None), ("POST", "/channels/{id}/refresh", None),
    ("PUT", "/channels/{id}/playlists", {}), ("POST", "/channels/{id}/playlists/refresh", None),
])
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}])
def test_real_auth_rejects_missing_or_invalid_token(env, method, path, payload, headers):
    del env.app.dependency_overrides[get_current_user]
    response = request(env, method, path.format(id=env.channels["manager"].id), json=payload, headers=headers)
    assert response.status_code == 401, response.text
    assert env.scheduled == []


def test_keys_are_actor_owned_cleaned_checked_and_never_inherited(env):
    assert request(env, "GET", "/keys").json() == {"api_keys": "key_manager"}
    result = request(env, "PUT", "/keys", json={"api_keys": " one\n\ntwo\none \n"})
    assert result.status_code == 200 and result.json() == {"api_keys": "one\ntwo"}
    stored = sorted((row.position, row.key) for row in rows(env, YouTubeApiKey) if row.user_id == env.users["manager"].id)
    assert stored == [(0, "one"), (1, "two")]
    assert request(env, "POST", "/keys/check", json={}).status_code == 200
    env.external_check.assert_awaited_once_with(["one", "two"])
    env.external_check.reset_mock()
    assert request(env, "POST", "/keys/check", json={"api_keys": " probe\nprobe"}).status_code == 200
    env.external_check.assert_awaited_once_with(["probe"])
    assert request(env, "GET", "/keys").json()["api_keys"] == "one\ntwo"
    env.actor = "assigned"
    assert request(env, "GET", "/keys").json()["api_keys"] == "key_assigned"
    assert request(env, "PUT", "/keys", json={"api_keys": ""}).status_code == 200
    body = request(env, "GET").json()
    assert body["key_count"] == 0 and body["has_keys"] is False
    assert request(env, "GET", "/keys").json()["api_keys"] == ""
    env.actor = "admin"
    assert request(env, "GET", "/keys").json()["api_keys"] == "key_admin"


@pytest.mark.parametrize("bad", ["valid\nbad key", "x" * 257, "\n".join(f"k{i}" for i in range(101))])
def test_invalid_key_input_is_atomic(env, bad):
    before = {(row.user_id, row.key, row.position) for row in rows(env, YouTubeApiKey)}
    for method, path in (("PUT", "/keys"), ("POST", "/keys/check")):
        assert request(env, method, path, json={"api_keys": bad}).status_code == 400
        assert {(row.user_id, row.key, row.position) for row in rows(env, YouTubeApiKey)} == before
    env.external_check.assert_not_awaited()


@pytest.mark.parametrize("method,path", [("PUT", "/keys"), ("POST", "/keys/check")])
@pytest.mark.parametrize("payload,status", [
    ({"api_keys": ["DO_NOT_ECHO_SECRET"]}, 422),
    ({"api_keys": {"secret": "DO_NOT_ECHO_SECRET"}}, 422),
    ({"api_keys": "DO_NOT_ECHO_SECRET" * 2000}, 400),
])
def test_key_validation_never_echoes_raw_secrets(env, method, path, payload, status):
    before = {(row.user_id, row.key) for row in rows(env, YouTubeApiKey)}
    response = request(env, method, path, json=payload)
    assert response.status_code == status, response.text
    assert "DO_NOT_ECHO_SECRET" not in response.text
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)
    assert {(row.user_id, row.key) for row in rows(env, YouTubeApiKey)} == before
    env.external_check.assert_not_awaited()


@pytest.mark.parametrize("value,parsed", [
    (CHANNEL_ID, ("id", CHANNEL_ID)),
    (f"https://www.youtube.com/channel/{CHANNEL_ID}/videos", ("id", CHANNEL_ID)),
    ("@new", ("handle", "@new")), ("https://m.youtube.com/@new/about", ("handle", "@new")),
    ("https://youtube.com/user/Legacy", ("username", "Legacy")),
    ("https://youtube.com/c/Custom", ("custom", "Custom")),
])
def test_create_uses_real_parser_query_types(env, value, parsed):
    assert parse_youtube_url(value) == parsed
    response = request(env, "POST", json={"urls": [value, value], "group": " New "})
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["accepted"], body["skipped"]) == (1, 1)
    assert len(body["items"]) == 1
    row = body["items"][0]
    assert (row["query_type"], row["query"], row["group"], row["status"]) == (*parsed, "New", "crawling")
    assert row["youtube_id"] == (CHANNEL_ID if parsed[0] == "id" else None)
    assert len(env.scheduled) == 1
    repeat = request(env, "POST", json={"urls": [value], "group": "Different"}).json()
    assert (repeat["accepted"], repeat["skipped"]) == (0, 1)
    assert repeat["items"][0]["id"] == row["id"] and repeat["items"][0]["group"] == "New"
    assert len(env.scheduled) == 1


@pytest.mark.parametrize("group", [" ", "all", " All ", " ALL LINKS ", "All Channels"])
def test_create_invalid_group_does_not_write(env, group):
    before = ids(env, Channel)
    assert request(env, "POST", json={"urls": ["@new"], "group": group}).status_code == 400
    assert ids(env, Channel) == before and env.scheduled == []


@pytest.mark.parametrize("bad", [
    "https://youtube.com.evil.test/@new", "https://youtube.com/watch?v=abc",
    "https://user:pass@youtube.com/@new", "https://youtube.com/@new/unknown", "not-a-url",
])
def test_create_mixed_invalid_urls_are_atomic(env, bad):
    before = ids(env, Channel)
    assert request(env, "POST", json={"urls": ["@valid", bad], "group": "New"}).status_code == 400
    assert ids(env, Channel) == before and env.scheduled == []


@pytest.mark.parametrize("owner", NAMES)
def test_create_target_owner_authorization_and_committed_schedule(env, owner):
    before = ids(env, Channel)
    response = request(env, "POST", json={"urls": ["@new"], "group": "New",
                                          "target_user_id": str(env.users[owner].id)})
    if owner not in ALLOWED:
        assert response.status_code == 403 and ids(env, Channel) == before and env.scheduled == []
    else:
        assert response.status_code == 200, response.text
        assert response.json()["items"][0]["user_id"] == str(env.users[owner].id)
        assert env.scheduled[0][1]["owner_id"] == env.users[owner].id


def test_create_id_reuses_resolved_handle_canonical_channel(env):
    with Session(env.engine) as session:
        session.get(Channel, env.channels["manager"].id).youtube_id = CHANNEL_ID
        session.commit()
    before = ids(env, Channel)
    response = request(env, "POST", json={"urls": [CHANNEL_ID], "group": "New"})
    assert response.status_code == 200, response.text
    assert response.json()["accepted"] == 0 and response.json()["skipped"] == 1
    assert response.json()["items"][0]["id"] == str(env.channels["manager"].id)
    assert ids(env, Channel) == before and env.scheduled == []


def test_batch_refresh_is_atomic_scoped_grouped_by_owner_and_skips_claimed(env):
    requested = [str(env.channels[name].id) for name in ("manager", "unassigned")]
    assert request(env, "POST", "/channels/refresh", json={"channel_ids": requested}).status_code == 404
    assert env.scheduled == []
    assert all(row.status != "crawling" for row in rows(env, Channel))
    body = request(env, "POST", "/channels/refresh", json={}).json()
    assert body["accepted"] == 1 and body["skipped"] == 0
    assert {args["owner_id"] for _, args in env.scheduled} == {env.users[name].id for name in ALLOWED}
    repeat = request(env, "POST", "/channels/refresh", json={}).json()
    assert repeat["accepted"] == 0 and repeat["skipped"] == 1 and len(env.scheduled) == 1
    assert all(row.group == "Shared" for row in rows(env, Channel))


@pytest.mark.parametrize("bad_kind", ["foreign", "track", "missing", "bad_host", "track_url", "credentials", "port"])
def test_playlist_replace_rejects_mixed_input_atomically(env, bad_kind):
    env.actor = "assigned"
    channel = env.channels["assigned"]
    payload = {"item_ids": [str(env.items["assigned"].id)], "urls": [f"spotify:playlist:{NEW_PLAYLIST}"]}
    if bad_kind == "foreign":
        payload["item_ids"].append(str(env.items["manager"].id))
    elif bad_kind == "missing":
        payload["item_ids"].append(str(uuid.uuid4()))
    elif bad_kind == "track":
        with Session(env.engine) as session:
            track = Item(user_id=channel.user_id, spotify_id="T" * 22, item_type="track")
            session.add(track)
            session.commit()
            payload["item_ids"].append(str(track.id))
    else:
        payload["urls"].append({
            "bad_host": f"https://open.spotify.com.evil.test/playlist/{NEW_PLAYLIST}",
            "track_url": f"https://open.spotify.com/track/{NEW_PLAYLIST}",
            "credentials": f"https://a@open.spotify.com/playlist/{NEW_PLAYLIST}",
            "port": f"https://open.spotify.com:443/playlist/{NEW_PLAYLIST}",
        }[bad_kind])
    before = ids(env, Item), link_ids(env, channel), ids(env, CrawlJob)
    response = request(env, "PUT", f"/channels/{channel.id}/playlists", json=payload)
    assert response.status_code == 400, response.text
    assert (ids(env, Item), link_ids(env, channel), ids(env, CrawlJob)) == before
    assert env.scheduled == []


def test_playlist_reuse_preserves_fields_new_job_owner_and_replacement(env):
    env.actor = "assigned"
    channel, item = env.channels["assigned"], env.items["assigned"]
    # Same Spotify identity belonging to another accessible owner must not be reused.
    with Session(env.engine) as session:
        session.get(Item, env.items["manager"].id).spotify_id = NEW_PLAYLIST
        session.commit()
    response = request(env, "PUT", f"/channels/{channel.id}/playlists", json={
        "item_ids": [str(item.id), str(item.id)],
        "urls": [playlist_url(item), f"spotify:playlist:{NEW_PLAYLIST}",
                 f"https://open.spotify.com/intl-en/playlist/{NEW_PLAYLIST}?si=test"],
    })
    assert response.status_code == 200, response.text
    playlists = response.json()["playlists"]
    assert len(playlists) == 2 and len(env.scheduled) == 1
    reused = next(row for row in playlists if row["id"] == str(item.id))
    assert (reused["group"], reused["name"], reused["followers"], reused["track_count"], reused["image"], reused["status"]) == (
        "Original", item.name, 17, 3, item.image, "active")
    new = next(row for row in playlists if row["id"] != str(item.id))
    assert new["user_id"] == str(channel.user_id) and new["group"] == "Channel Playlists"
    assert new["id"] != str(env.items["manager"].id)
    jobs = rows(env, CrawlJob)
    assert len(jobs) == 1 and jobs[0].user_id == channel.user_id and str(jobs[0].item_id) == new["id"]
    assert env.scheduled[0][1]["job_id"] == jobs[0].id
    cleared = request(env, "PUT", f"/channels/{channel.id}/playlists", json={})
    assert cleared.status_code == 200 and cleared.json()["playlists"] == []
    assert {item.id, uuid.UUID(new["id"])} <= ids(env, Item)
    assert len(rows(env, CrawlJob)) == 1


def test_playlist_refresh_preserves_group_skips_crawling_commits_jobs(env):
    env.actor = "assigned"
    channel = env.channels["assigned"]
    path = f"/channels/{channel.id}/playlists/refresh"
    response = request(env, "POST", path)
    assert response.status_code == 200 and response.json()["accepted"] == 1
    assert len(env.scheduled) == 1
    job = rows(env, CrawlJob)[0]
    assert job.user_id == channel.user_id and str(job.id) == response.json()["job_ids"][0]
    with Session(env.engine) as session:
        item = session.get(Item, env.items["assigned"].id)
        assert item.group == "Original" and item.name == "Playlist assigned" and item.followers == 17
    repeated = request(env, "POST", path).json()
    assert repeated == {"accepted": 0, "skipped": 1, "job_ids": []}
    assert len(rows(env, CrawlJob)) == len(env.scheduled) == 1


def test_delete_channel_cascades_youtube_only_never_spotify_records(env):
    env.actor = "assigned"
    channel = env.channels["assigned"]
    before = {model: ids(env, model) for model in (Item, MetricsSnapshot, RawResponse, CrawlJob, YouTubeApiKey)}
    response = request(env, "DELETE", f"/channels/{channel.id}")
    assert response.status_code == 200 and response.json()["deleted"] is True
    assert channel.id not in ids(env, Channel)
    assert not any(row.channel_id == channel.id for row in rows(env, ChannelSnapshot))
    assert not any(row.channel_id == channel.id for row in rows(env, ChannelPlaylist))
    assert all(ids(env, model) == previous for model, previous in before.items())
    assert request(env, "DELETE", f"/channels/{channel.id}").status_code == 404


def test_delete_user_api_cascades_keys_channels_snapshots_links_not_other_owners(env):
    owner = "assigned"
    for target in ("assigned", "manager"):
        env.actor = target
        assert request(env, "POST", "/groups", json={"name": "Persisted",
            "target_user_id": str(env.users[target].id)}).status_code == 200
    env.actor = "manager"
    before_groups = ids(env, YouTubeChannelGroup)
    deleted_groups = {row.id for row in rows(env, YouTubeChannelGroup) if row.user_id == env.users[owner].id}
    before_channels = ids(env, Channel)
    before_items = ids(env, Item)
    # Cross-link models a legacy association; deleting the user must leave its
    # other owner's channel intact while removing the now-deleted item link.
    with Session(env.engine) as session:
        session.add(ChannelPlaylist(channel_id=env.channels["manager"].id, item_id=env.items[owner].id))
        session.commit()
    response = env.client.delete(f"/api/auth/users/{env.users[owner].id}")
    assert response.status_code == 200, response.text
    assert env.users[owner].id not in ids(env, User)
    assert ids(env, Channel) == before_channels - {env.channels[owner].id}
    assert ids(env, Item) == before_items - {env.items[owner].id}
    assert not any(row.user_id == env.users[owner].id for row in rows(env, YouTubeApiKey))
    assert not any(row.channel_id == env.channels[owner].id for row in rows(env, ChannelSnapshot))
    assert not any(row.channel_id == env.channels[owner].id or row.item_id == env.items[owner].id
                   for row in rows(env, ChannelPlaylist))
    assert link_ids(env, env.channels["manager"]) == {env.items["manager"].id}
    assert ids(env, YouTubeChannelGroup) == before_groups - deleted_groups


def test_direct_user_delete_uses_real_youtube_foreign_key_cascades(env):
    # Isolate FK behavior from auth cleanup; Spotify's user FK is not CASCADE.
    with Session(env.engine) as session:
        user = User(username="youtube_only", email="youtube_only@example.test", password_hash="unused")
        session.add(user)
        session.flush()
        channel = Channel(user_id=user.id, query_type="handle", query="@only", group="Only")
        session.add(channel)
        session.flush()
        session.add_all([YouTubeApiKey(user_id=user.id, key="only"),
                         ChannelSnapshot(channel_id=channel.id, view_count=1),
                         ChannelPlaylist(channel_id=channel.id, item_id=env.items["manager"].id)])
        session.commit()
        user_id, channel_id = user.id, channel.id
        session.execute(delete(User).where(User.id == user_id))
        session.commit()
    assert channel_id not in ids(env, Channel)
    assert not any(row.user_id == user_id for row in rows(env, YouTubeApiKey))
    assert not any(row.channel_id == channel_id for row in rows(env, ChannelSnapshot))
    assert not any(row.channel_id == channel_id for row in rows(env, ChannelPlaylist))
    assert env.items["manager"].id in ids(env, Item)


def test_item_delete_api_removes_all_linked_associations_keeps_channels_and_other_items(env):
    env.actor = "assigned"
    item = env.items["assigned"]
    with Session(env.engine) as session:
        session.add(ChannelPlaylist(channel_id=env.channels["manager"].id, item_id=item.id))
        session.add(CrawlJob(item_id=item.id, user_id=item.user_id, spotify_url=playlist_url(item)))
        session.commit()
    before_channels, before_items, before_snapshots = ids(env, Channel), ids(env, Item), ids(env, ChannelSnapshot)
    response = env.client.delete(f"/api/items-by-id/{item.id}")
    assert response.status_code == 200, response.text
    assert response.json()["deleted"] == 1
    assert ids(env, Item) == before_items - {item.id}
    assert ids(env, Channel) == before_channels and ids(env, ChannelSnapshot) == before_snapshots
    assert not any(row.item_id == item.id for row in rows(env, ChannelPlaylist))
    assert not any(row.item_id == item.id for row in rows(env, MetricsSnapshot))
    assert not any(row.item_id == item.id for row in rows(env, CrawlJob))
    assert link_ids(env, env.channels["manager"]) == {env.items["manager"].id}


def test_batched_response_helpers_constant_queries_and_string_owner_keys(env):
    with Session(env.engine) as session:
        for index in range(20):
            channel = Channel(user_id=env.users["manager"].id, query_type="handle",
                              query=f"@batch{index}", group="Batch", status="active")
            item = Item(user_id=env.users["manager"].id, spotify_id=f"B{index:021d}", item_type="playlist",
                        name=f"Batch {index}", group="Original", status="active")
            session.add_all([channel, item])
            session.flush()
            session.add(ChannelPlaylist(channel_id=channel.id, item_id=item.id))
            session.add(RawResponse(spotify_id=item.spotify_id, operation="test", response_data={}))
            session.add(MetricsSnapshot(item_id=item.id, spotify_id=item.spotify_id, followers=1))
        session.commit()
    counts = []
    for limit in (1, 500):
        env.statements.clear()
        response = request(env, "GET", params={"limit": limit})
        assert response.status_code == 200, response.text
        statements = [sql for sql in env.statements if sql.lstrip().upper().startswith("SELECT")]
        counts.append(len(statements))
        for channel in response.json()["items"]:
            for item in channel["playlists"]:
                owner = next(user for user in env.users.values() if str(user.id) == item["user_id"])
                assert item["user_name"] == owner.display_name and item["user_avatar"] == owner.avatar
        for table in ("raw_responses", "metrics_snapshots"):
            assert sum(table in sql for sql in statements) == 1
    # Actor lookup + channel/stored groups/count/page/keys + links/raw/snapshots/users.
    assert counts == [10, 10]
    with Session(env.engine) as session:
        user_map = asyncio.run(items_api._load_item_users(AsyncSessionAdapter(session), [env.items["assigned"]]))
        assert set(user_map) == {str(env.users["assigned"].id)}


def fake_worker_client(env, monkeypatch, results):
    calls = []

    class FakeClient:
        def __init__(self, keys):
            calls.append({"keys": keys})

        async def fetch_channels(self, queries):
            calls[-1]["queries"] = queries
            return results

    monkeypatch.setattr(youtube_jobs, "YouTubeClient", FakeClient)
    return calls


def test_worker_owner_keys_snapshot_delta_and_foreign_channel_exclusion(env, monkeypatch):
    channel = env.channels["assigned"]
    with Session(env.engine) as session:
        row = session.get(Channel, channel.id)
        row.status = "crawling"
        session.commit()
    calls = fake_worker_client(env, monkeypatch, [{"youtube_id": CHANNEL_ID, "name": "Resolved",
                                                  "view_count": 145, "image": "cover", "banner": "banner"}])
    before = len(rows(env, ChannelSnapshot))
    asyncio.run(youtube_jobs.refresh_channels(channel.user_id, [channel.id, env.channels["manager"].id]))
    assert calls == [{"keys": ["key_assigned"], "queries": [("handle", "@assigned")]}]
    with Session(env.engine) as session:
        row = session.get(Channel, channel.id)
        assert (row.status, row.youtube_id, row.name, row.view_count_delta, row.group) == (
            "active", CHANNEL_ID, "Resolved", 45, "Shared")
        assert row.delta_days == (row.last_checked - datetime(2026, 1, 1)).days
        assert row.refresh_started_at is None and row.error_code is None
        assert session.get(Channel, env.channels["manager"].id).name == "Channel manager"
    assert len(rows(env, ChannelSnapshot)) == before + 1
    assert any(row.channel_id == channel.id and row.view_count == 145 for row in rows(env, ChannelSnapshot))


def test_worker_canonical_merge_unions_links_preserves_canonical_group_and_other_owner(env, monkeypatch):
    canonical = env.channels["assigned"]
    with Session(env.engine) as session:
        session.get(Channel, canonical.id).youtube_id = CHANNEL_ID
        session.get(Channel, env.channels["manager"].id).youtube_id = CHANNEL_ID
        alias = Channel(user_id=canonical.user_id, query_type="custom", query="Alias", group="Alias Group", status="crawling")
        extra = Item(user_id=canonical.user_id, spotify_id="E" * 22, item_type="playlist", group="Keep")
        session.add_all([alias, extra])
        session.flush()
        session.add_all([ChannelPlaylist(channel_id=alias.id, item_id=extra.id),
                         ChannelPlaylist(channel_id=alias.id, item_id=env.items["assigned"].id),
                         ChannelSnapshot(channel_id=alias.id, view_count=1)])
        session.commit()
        alias_id, extra_id = alias.id, extra.id
    calls = fake_worker_client(env, monkeypatch, [{"youtube_id": CHANNEL_ID, "view_count": 200}])
    asyncio.run(youtube_jobs.refresh_channels(canonical.user_id, [alias_id]))
    assert calls[0]["keys"] == ["key_assigned"]
    assert alias_id not in ids(env, Channel)
    assert link_ids(env, canonical) == {env.items["assigned"].id, extra_id}
    assert not any(row.channel_id == alias_id for row in rows(env, ChannelSnapshot))
    assert not any(row.channel_id == alias_id for row in rows(env, ChannelPlaylist))
    with Session(env.engine) as session:
        assert session.get(Channel, canonical.id).group == "Shared"
        assert session.get(Item, extra_id).group == "Keep"
        assert session.get(Channel, env.channels["manager"].id) is not None


def test_spotify_worker_uses_mocked_crawl(env):
    job_id = uuid.uuid4()
    asyncio.run(youtube_jobs.run_spotify_job(job_id, NEW_PLAYLIST))
    youtube_jobs.crawl_item_task.assert_awaited_once_with(str(job_id), NEW_PLAYLIST, "playlist")


def test_post_create_to_worker_resolved_id_and_snapshot_regression(env, monkeypatch):
    env.actor = "assigned"
    """Exercise actual POST parser, stored identity, scheduled args and worker."""
    response = request(env, "POST", json={
        "urls": [f"https://www.youtube.com/channel/{CHANNEL_ID}/videos", CHANNEL_ID],
        "group": "Resolved IDs", "target_user_id": str(env.users["assigned"].id),
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["accepted"], body["skipped"]) == (1, 1)
    channel_id = uuid.UUID(body["items"][0]["id"])
    assert body["items"][0]["query_type"] == "id"
    assert body["items"][0]["youtube_id"] == CHANNEL_ID
    worker, args = env.scheduled[0]
    assert worker == "refresh_channels"
    assert args["owner_id"] == env.users["assigned"].id and args["channel_ids"] == [channel_id]
    assert set(args["attempts"]) == {channel_id}
    calls = []

    class FakeClient:
        def __init__(self, keys):
            assert keys == ["key_assigned"]

        async def fetch_channels(self, queries):
            calls.append(queries)
            assert queries == [("id", CHANNEL_ID)]
            # Worker has committed the initial read and released its transaction.
            assert not env.worker_sessions[-1].in_transaction()
            return [{"youtube_id": CHANNEL_ID, "view_count": 987, "name": "New channel"}]

    monkeypatch.setattr(youtube_jobs, "YouTubeClient", FakeClient)
    asyncio.run(youtube_jobs.refresh_channels(**args))
    assert calls == [[("id", CHANNEL_ID)]]
    detail = request(env, "GET", f"/channels/{channel_id}")
    assert detail.status_code == 200, detail.text
    row = detail.json()
    assert (row["status"], row["query_type"], row["youtube_id"], row["view_count"], row["group"]) == (
        "active", "id", CHANNEL_ID, 987, "Resolved IDs")
    assert row["youtube_url"] == f"https://www.youtube.com/channel/{CHANNEL_ID}"
    assert row["last_checked"] is not None and row["view_count_delta"] is None
    snapshots = [snapshot for snapshot in rows(env, ChannelSnapshot) if snapshot.channel_id == channel_id]
    assert len(snapshots) == 1 and snapshots[0].view_count == 987


def test_durable_stale_recovery_commits_only_crawling_rows_and_allows_retry(env):
    env.actor = "assigned"
    fresh_started = utc_now()
    with Session(env.engine) as session:
        row = session.get(Channel, env.channels["assigned"].id)
        row.status = "crawling"
        row.refresh_started_at = datetime(2026, 1, 1)
        fresh = session.get(Channel, env.channels["manager"].id)
        fresh.status, fresh.refresh_started_at = "crawling", fresh_started
        null_lease = session.get(Channel, env.channels["unassigned"].id)
        null_lease.status, null_lease.refresh_started_at = "crawling", None
        session.commit()
    before = ids(env, ChannelSnapshot)
    asyncio.run(youtube_jobs.recover_stale_channels())
    with Session(env.engine) as session:
        row = session.get(Channel, env.channels["assigned"].id)
        assert row.status == "error" and row.error_code == "refresh_interrupted"
        assert row.refresh_started_at is None and row.group == "Shared" and row.view_count == 100
        for name in NAMES:
            if name == "manager":
                fresh = session.get(Channel, env.channels[name].id)
                assert fresh.status == "crawling" and fresh.refresh_started_at == fresh_started
            elif name == "unassigned":
                assert session.get(Channel, env.channels[name].id).error_code == "refresh_interrupted"
            elif name != "assigned":
                assert session.get(Channel, env.channels[name].id).status == env.channels[name].status
    assert ids(env, ChannelSnapshot) == before and env.scheduled == []
    asyncio.run(youtube_jobs.recover_stale_channels())
    response = request(env, "POST", f"/channels/{env.channels['assigned'].id}/refresh")
    assert response.status_code == 200 and response.json()["accepted"] == 1
    assert len(env.scheduled) == 1


def test_concurrent_refresh_claim_schedules_exactly_once(env):
    env.actor = "assigned"
    barrier = Barrier(2)
    path = f"/channels/{env.channels['assigned'].id}/refresh"

    def refresh():
        barrier.wait(timeout=10)
        return request(env, "POST", path)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(refresh) for _ in range(2)]
        responses = [future.result(timeout=20) for future in futures]
    assert all(response.status_code == 200 for response in responses)
    assert sorted((response.json()["accepted"], response.json()["skipped"]) for response in responses) == [(0, 1), (1, 0)]
    assert len(env.scheduled) == 1
    assert env.scheduled[0][1]["channel_ids"] == [env.channels["assigned"].id]


def test_worker_skips_deleted_channel_during_fetch_without_poisoning_survivor(env, monkeypatch):
    first, survivor = env.channels["manager"], env.channels["assigned"]
    with Session(env.engine) as session:
        extra = Channel(user_id=first.user_id, query_type="handle", query="@survivor", group="Keep", status="crawling")
        session.get(Channel, first.id).status = "crawling"
        session.add(extra)
        session.commit()
        extra_id = extra.id

    class FakeClient:
        def __init__(self, keys):
            assert keys == ["key_manager"]

        async def fetch_channels(self, queries):
            assert queries == [("handle", "@manager"), ("handle", "@survivor")]
            assert not env.worker_sessions[-1].in_transaction()
            # A second connection can mutate while the external fetch runs.
            with Session(env.engine) as session:
                session.execute(delete(Channel).where(Channel.id == first.id))
                session.commit()
            return [{"youtube_id": "UC" + "d" * 22, "view_count": 1},
                    {"youtube_id": "UC" + "s" * 22, "view_count": 2}]

    monkeypatch.setattr(youtube_jobs, "YouTubeClient", FakeClient)
    asyncio.run(youtube_jobs.refresh_channels(first.user_id, [first.id, extra_id]))
    assert first.id not in ids(env, Channel)
    with Session(env.engine) as session:
        assert session.get(Channel, extra_id).status == "active"
        assert session.get(Channel, survivor.id).status == "error"
    assert sum(snapshot.channel_id == extra_id for snapshot in rows(env, ChannelSnapshot)) == 1


def test_worker_batch_canonical_merge_applies_result_and_records_one_snapshot(env, monkeypatch):
    canonical = env.channels["assigned"]
    with Session(env.engine) as session:
        row = session.get(Channel, canonical.id)
        row.youtube_id, row.status = CHANNEL_ID, "crawling"
        alias = Channel(user_id=canonical.user_id, query_type="handle", query="@alias",
                        group="Alias", status="crawling", created_at=datetime(2025, 1, 1))
        session.add(alias)
        session.commit()
        alias_id = alias.id
    before = sum(snapshot.channel_id == canonical.id for snapshot in rows(env, ChannelSnapshot))
    fake_worker_client(env, monkeypatch, [
        {"youtube_id": CHANNEL_ID, "name": "Fresh", "view_count": 150},
        {"youtube_id": CHANNEL_ID, "name": "Fresh", "view_count": 150},
    ])
    asyncio.run(youtube_jobs.refresh_channels(canonical.user_id, [alias_id, canonical.id]))
    assert alias_id not in ids(env, Channel)
    with Session(env.engine) as session:
        row = session.get(Channel, canonical.id)
        assert (row.status, row.name, row.view_count, row.view_count_delta, row.group) == (
            "active", "Fresh", 150, 50, "Shared")
    assert sum(snapshot.channel_id == canonical.id for snapshot in rows(env, ChannelSnapshot)) == before + 1


def test_create_through_real_youtube_client_mock_http_channels_list_id(env, monkeypatch):
    env.actor = "assigned"
    """No parser/client/worker mocking: replace only the outbound HTTP transport."""
    calls = []
    original_client = httpx.AsyncClient

    def channels_list(req):
        assert not env.worker_sessions[-1].in_transaction()
        calls.append(req)
        assert req.method == "GET"
        assert req.url.scheme == "https" and req.url.host == "www.googleapis.com"
        assert req.url.path == "/youtube/v3/channels"
        assert dict(req.url.params) == {
            "part": "snippet,statistics,brandingSettings", "id": CHANNEL_ID, "maxResults": "50"}
        assert req.headers["X-Goog-Api-Key"] == "key_assigned"
        assert "key_assigned" not in str(req.url)
        return httpx.Response(200, json={"items": [{
            "id": CHANNEL_ID, "snippet": {"title": "Real client result",
                "thumbnails": {"high": {"url": "https://example.test/channel.jpg"}}},
            "statistics": {"viewCount": str(1000 + len(calls))},
            "brandingSettings": {"image": {"bannerExternalUrl": "https://example.test/banner.jpg"}},
        }]})

    def http_client(**kwargs):
        return original_client(transport=httpx.MockTransport(channels_list), **kwargs)

    monkeypatch.setattr(youtube_service.httpx, "AsyncClient", http_client)
    response = request(env, "POST", json={
        "urls": [f"https://youtube.com/channel/{CHANNEL_ID}"], "group": "HTTP regression",
        "target_user_id": str(env.users["assigned"].id),
    })
    assert response.status_code == 200, response.text
    channel_id = uuid.UUID(response.json()["items"][0]["id"])
    assert response.json()["items"][0]["query_type"] == "id"
    assert len(env.scheduled) == 1
    asyncio.run(youtube_jobs.refresh_channels(**env.scheduled[0][1]))
    detail = request(env, "GET", f"/channels/{channel_id}").json()
    assert (detail["status"], detail["youtube_id"], detail["view_count"], detail["name"]) == (
        "active", CHANNEL_ID, 1001, "Real client result")
    assert detail["image"] == "https://example.test/channel.jpg"
    assert detail["banner"] == "https://example.test/banner.jpg"
    assert detail["group"] == "HTTP regression" and detail["view_count_delta"] is None
    # A subsequent API refresh must query the resolved ID, not an alias type.
    refresh = request(env, "POST", f"/channels/{channel_id}/refresh")
    assert refresh.status_code == 200 and refresh.json()["accepted"] == 1
    asyncio.run(youtube_jobs.refresh_channels(**env.scheduled[-1][1]))
    detail = request(env, "GET", f"/channels/{channel_id}").json()
    assert detail["status"] == "active" and detail["view_count_delta"] == 1
    assert detail["view_count"] == 1002 and detail["delta_days"] == 0
    snapshots = [row for row in rows(env, ChannelSnapshot) if row.channel_id == channel_id]
    assert sorted(row.view_count for row in snapshots) == [1001, 1002]
    assert len(calls) == 2


@pytest.mark.parametrize("fetch_fails", [False, True])
def test_superseded_attempt_cannot_complete_or_fail_new_claim(env, monkeypatch, fetch_fails):
    channel = env.channels["assigned"]
    old_attempt = utc_now() - timedelta(seconds=10)
    new_attempt = utc_now()
    with Session(env.engine) as session:
        row = session.get(Channel, channel.id)
        row.status, row.refresh_started_at = "crawling", old_attempt
        session.commit()
    before_snapshots = ids(env, ChannelSnapshot)
    calls = []

    class FakeClient:
        def __init__(self, keys):
            assert keys == ["key_assigned"]

        async def fetch_channels(self, queries):
            calls.append(queries)
            with Session(env.engine) as session:
                row = session.get(Channel, channel.id)
                row.refresh_started_at = new_attempt
                session.commit()
            if fetch_fails:
                raise RuntimeError("DO_NOT_PERSIST_SECRET")
            return [{"youtube_id": CHANNEL_ID, "view_count": 900}]

    monkeypatch.setattr(youtube_jobs, "YouTubeClient", FakeClient)
    asyncio.run(youtube_jobs.refresh_channels(channel.user_id, [channel.id], {channel.id: old_attempt}))
    assert len(calls) == 1
    with Session(env.engine) as session:
        row = session.get(Channel, channel.id)
        assert row.status == "crawling" and row.refresh_started_at == new_attempt
        assert row.view_count == 100 and row.error_code is None and row.youtube_id is None
    assert ids(env, ChannelSnapshot) == before_snapshots
    # A queued old attempt must not even fetch once the claim has changed.
    asyncio.run(youtube_jobs.refresh_channels(channel.user_id, [channel.id], {channel.id: old_attempt}))
    assert len(calls) == 1


@pytest.mark.parametrize("other_pending", [False, True])
def test_playlist_worker_cancel_cleanup_preserves_group_and_newer_job(env, monkeypatch, other_pending):
    env.actor = "assigned"
    channel, item = env.channels["assigned"], env.items["assigned"]
    response = request(env, "POST", f"/channels/{channel.id}/playlists/refresh")
    assert response.status_code == 200 and response.json()["accepted"] == 1
    job_id = uuid.UUID(response.json()["job_ids"][0])
    with Session(env.engine) as session:
        assert session.get(CrawlJob, job_id).result["youtube_channel_job"] is True
        if other_pending:
            session.add(CrawlJob(item_id=item.id, user_id=item.user_id,
                                 spotify_url=playlist_url(item), status="pending"))
            session.commit()

    async def cancel_worker():
        started = asyncio.Event()

        async def blocked_crawl(*args):
            started.set()
            await asyncio.Future()

        monkeypatch.setattr(youtube_jobs, "crawl_item_task", blocked_crawl)
        task = asyncio.create_task(youtube_jobs.run_spotify_job(job_id, item.spotify_id))
        await asyncio.wait_for(started.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_worker())
    with Session(env.engine) as session:
        job = session.get(CrawlJob, job_id)
        assert job.status == "error" and job.completed_at is not None
        assert job.error == "Playlist refresh interrupted. Please retry."
        row = session.get(Item, item.id)
        assert row.group == "Original" and row.followers == 17
        assert row.status == ("crawling" if other_pending else "error")
        if not other_pending:
            assert row.error_code == 503 and row.error_message == job.error
    assert link_ids(env, channel) == {item.id}


def test_stale_spotify_recovery_only_marked_jobs_not_fresh_or_unrelated(env):
    old = utc_now() - timedelta(seconds=youtube_jobs.LEASE_SECONDS + 60)
    job_ids = {}
    with Session(env.engine) as session:
        for owner, marked, stale in [("assigned", True, True), ("manager", True, False),
                                     ("unassigned", False, True)]:
            item = session.get(Item, env.items[owner].id)
            item.status = "crawling"
            job = CrawlJob(item_id=item.id, user_id=item.user_id, spotify_url=playlist_url(item),
                           status="pending", created_at=old if stale else utc_now(),
                           result={"youtube_channel_job": True} if marked else {})
            session.add(job)
            session.flush()
            job_ids[owner] = job.id
        session.commit()
    asyncio.run(youtube_jobs.recover_stale_channels())
    with Session(env.engine) as session:
        for owner in job_ids:
            job, item = session.get(CrawlJob, job_ids[owner]), session.get(Item, env.items[owner].id)
            assert job.status == ("error" if owner == "assigned" else "pending")
            assert item.status == ("error" if owner == "assigned" else "crawling")
            assert item.group == "Original"


@pytest.mark.parametrize("actor,target,allowed", [
    ("manager", "manager", True), ("manager", "assigned", False),
    ("manager", "unassigned", False), ("manager", "linked_admin", False),
    ("assigned", "assigned", True), ("assigned", "manager", False),
    ("unassigned", "unassigned", True), ("admin", "unassigned", False), ("admin", "admin", True),
])
def test_group_create_owner_scope_and_empty_reload(env, actor, target, allowed):
    env.actor = actor
    before = ids(env, YouTubeChannelGroup)
    response = request(env, "POST", "/groups", json={
        "name": " Empty group ", "target_user_id": str(env.users[target].id)})
    if not allowed:
        assert response.status_code == 403, response.text
        assert ids(env, YouTubeChannelGroup) == before
        return
    assert response.status_code == 200, response.text
    assert response.json() == {"name": "Empty group", "count": 0, "user_id": str(env.users[target].id)}
    body = request(env, "GET", params={"user_id": str(env.users[target].id)}).json()
    assert body["groups"] == [{"name": "Empty group", "count": 0}, {"name": "Shared", "count": 1}]
    empty = request(env, "GET", params={"group": "Empty group", "user_id": str(env.users[target].id)}).json()
    assert empty["items"] == [] and empty["total"] == 0
    assert empty["groups"] == body["groups"] and env.scheduled == []


def test_groups_duplicate_reuse_owner_separation_and_scope(env):
    for target in ("manager", "assigned"):
        env.actor = target
        for _ in range(2):
            response = request(env, "POST", "/groups", json={"name": "Same",
                "target_user_id": str(env.users[target].id)})
            assert response.status_code == 200, response.text
    env.actor = "unassigned"
    assert request(env, "POST", "/groups", json={"name": "Secret unassigned",
        "target_user_id": str(env.users["unassigned"].id)}).status_code == 200
    assert request(env, "POST", "/groups", json={"name": "Same",
        "target_user_id": str(env.users["unassigned"].id)}).status_code == 200
    stored = rows(env, YouTubeChannelGroup)
    assert len(stored) == 4
    assert {row.user_id for row in stored if row.name == "Same"} == {
        env.users[name].id for name in ("manager", "assigned", "unassigned")}
    env.actor = "manager"
    assert request(env, "GET").json()["groups"] == [{"name": "Same", "count": 0}, {"name": "Shared", "count": 1}]
    assert request(env, "GET", params={"user_id": str(env.users["unassigned"].id)}).json()["groups"] == []
    env.actor = "assigned"
    assert request(env, "GET").json()["groups"] == [{"name": "Same", "count": 0}, {"name": "Shared", "count": 1}]
    env.actor = "admin"
    assert request(env, "GET").json()["groups"] == [{"name": "Shared", "count": 1}]


@pytest.mark.parametrize("name", [" All ", " ALL LINKS ", "aLl ChAnNeLs", " "])
def test_group_aggregate_labels_rejected_atomically(env, name):
    before = ids(env, YouTubeChannelGroup), ids(env, Channel)
    response = request(env, "POST", "/groups", json={"name": name})
    assert response.status_code == 400, response.text
    assert (ids(env, YouTubeChannelGroup), ids(env, Channel)) == before and env.scheduled == []


def test_channel_create_persists_group_and_aggregate_filters_ignore_label(env):
    env.actor = "assigned"
    response = request(env, "POST", json={"urls": ["@group_persist"], "group": " Auto group ",
        "target_user_id": str(env.users["assigned"].id)})
    assert response.status_code == 200, response.text
    stored = rows(env, YouTubeChannelGroup)
    assert [(row.name, row.user_id) for row in stored] == [("Auto group", env.users["assigned"].id)]
    channel_id = response.json()["items"][0]["id"]
    baseline = request(env, "GET").json()
    for label in (" All ", "ALL LINKS", " all channels "):
        body = request(env, "GET", params={"group": label}).json()
        assert body["total"] == baseline["total"] == 2 and body["items"] == baseline["items"]
    assert request(env, "DELETE", f"/channels/{channel_id}").status_code == 200
    body = request(env, "GET", params={"user_id": str(env.users["assigned"].id)}).json()
    assert body["groups"] == [{"name": "Auto group", "count": 0}, {"name": "Shared", "count": 1}]
    assert len(rows(env, YouTubeChannelGroup)) == 1


@pytest.mark.parametrize("actor", ["admin", "manager", "assigned"])
@pytest.mark.parametrize("owner", NAMES)
def test_spotify_http_owner_scope_denies_foreign_rows(env, actor, owner):
    env.actor = actor
    item = env.items[owner]
    path = f"/api/items/playlist/{item.spotify_id}"
    own = actor == owner
    assert env.client.get(path).status_code == (200 if own else 404)
    exported = env.client.post("/api/items/export", json={
        "action": "listview-excel", "item_ids": [str(item.id)], "deep_fetch": False,
    })
    assert exported.status_code == (200 if own else 404), exported.text
    if own:
        assert exported.json()["count"] == 1
        return
    before = ids(env, Item), ids(env, CrawlJob), ids(env, RawResponse), ids(env, MetricsSnapshot)
    assert env.client.delete(path).status_code == 404
    assert env.client.delete(f"/api/items-by-id/{item.id}").status_code == 404
    assert env.client.post("/api/items/move", json={
        "item_ids": [str(item.id)], "group": "Denied",
    }).status_code == 404
    for batch in (False, True):
        refresh = {"urls": [playlist_url(item)], "item_ids": [str(item.id)]} if batch else {
            "url": playlist_url(item), "item_id": str(item.id),
        }
        endpoint = "/api/crawl/batch" if batch else "/api/crawl"
        assert env.client.post(endpoint, json=refresh).status_code == 404
        create = {"urls": [playlist_url(item)]} if batch else {"url": playlist_url(item)}
        create.update(group="Denied", target_user_id=str(env.users[owner].id))
        assert env.client.post(endpoint, json=create).status_code == 403
    assert (ids(env, Item), ids(env, CrawlJob), ids(env, RawResponse), ids(env, MetricsSnapshot)) == before
    assert env.scheduled == []


@pytest.mark.parametrize("actor", ["admin", "manager", "assigned"])
def test_spotify_own_http_crud_and_jobs(env, actor):
    env.actor = actor
    own = env.items[actor]
    own_user = str(env.users[actor].id)
    assert env.client.get("/api/items").json()["total"] == 1
    assert env.client.get("/api/items/summary").json()["all_total"] == 1
    moved = env.client.post("/api/items/move", json={
        "item_ids": [str(own.id)], "user_id": own_user, "group": "Own moved",
    })
    assert moved.status_code == 200 and moved.json()["moved"] == 1
    renamed = env.client.patch("/api/items/group", params={"old_group": "Own moved", "new_group": "Own renamed"})
    assert renamed.status_code == 200 and renamed.json()["updated"] == 1
    refresh = env.client.post("/api/crawl", json={"url": playlist_url(own), "item_id": str(own.id)})
    assert refresh.status_code == 200, refresh.text
    job_id = refresh.json()["job_id"]
    assert env.client.get(f"/api/jobs/{job_id}").status_code == 200
    assert env.client.post("/api/jobs/batch", json={"job_ids": [job_id]}).json()["jobs"][0]["id"] == job_id
    new_url = "https://open.spotify.com/track/" + "Z" * 22
    created = env.client.post("/api/crawl/batch", json={"urls": [new_url], "group": "Own new", "target_user_id": own_user})
    assert created.status_code == 200 and created.json()["count"] == 1
    with Session(env.engine) as session:
        jobs = session.scalars(select(CrawlJob)).all()
        assert len(jobs) == 2
        assert all(job.user_id == env.users[actor].id for job in jobs)
        assert all(session.get(Item, job.item_id).user_id == env.users[actor].id for job in jobs)
    assert env.client.delete(f"/api/items-by-id/{own.id}").status_code == 200
    assert env.client.delete("/api/items").json()["deleted"] == 1
    assert ids(env, Item) == {env.items[name].id for name in NAMES if name != actor}
    assert len(rows(env, RawResponse)) == len(NAMES) - 1


@pytest.mark.parametrize("actor", ["admin", "manager"])
def test_management_responses_redact_private_data_but_keep_account_access(env, actor):
    env.actor = actor
    with Session(env.engine) as session:
        for user in session.scalars(select(User)):
            user.custom_groups = json.dumps([f"private-{user.username}"])
            user.ui_preferences = json.dumps({"row_order": [f"private-{user.username}"]})
        session.commit()
    listed = env.client.get("/api/auth/users")
    assert listed.status_code == 200
    visible = NAMES if actor == "admin" else ("manager", "assigned")
    assert {row["username"] for row in listed.json()} == set(visible)
    for row in listed.json():
        assert row["role"] == env.users[row["username"]].role
        assert row["display_name"] == env.users[row["username"]].display_name
        assert row["custom_groups"] == ([f"private-{actor}"] if row["username"] == actor else [])
        assert "ui_preferences" not in row
    target = str(env.users["assigned"].id)
    response = env.client.patch(f"/api/auth/users/{target}", json={"display_name": "Managed"})
    assert response.status_code == 200 and response.json()["custom_groups"] == []
    assert env.client.post(f"/api/auth/users/{target}/reset-password", json={"new_password": "pass"}).status_code == 200
    assert env.client.get(f"/api/auth/users/{target}/groups").status_code == 403
    assert env.client.put(f"/api/auth/users/{target}/groups", json={"groups": ["Denied"]}).status_code == 403
    mine = env.client.get("/api/auth/me/preferences")
    assert mine.status_code == 200 and mine.json()["preferences"]["row_order"] == [f"private-{actor}"]
    saved = env.client.put("/api/auth/me/preferences", json={
        "user_id": target, "preferences": {"row_order": ["own-new"]},
    })
    assert saved.status_code == 200
    with Session(env.engine) as session:
        foreign = session.get(User, env.users["assigned"].id)
        assert json.loads(foreign.custom_groups) == ["private-assigned"]
        assert json.loads(foreign.ui_preferences)["row_order"] == ["private-assigned"]
    global_saved = env.client.put("/api/auth/admin/preferences", json={"playlist_clipboard_line_limit": 12})
    assert global_saved.status_code == (200 if actor == "admin" else 403)
    if actor == "admin":
        assert env.client.get("/api/auth/me/preferences").json()["global_preferences"]["playlist_clipboard_line_limit"] == 12


@pytest.mark.parametrize("actor", ["admin", "manager", "assigned"])
def test_me_groups_profile_preferences_are_always_actor_owned(env, actor):
    env.actor = actor
    foreign = "unassigned"
    target = str(env.users[foreign].id)
    response = env.client.put("/api/auth/me/groups", json={
        "groups": [" Own ", "Own", ""], "target_user_id": target,
    })
    assert response.status_code == 200 and response.json() == {"groups": ["Own"]}
    assert env.client.get("/api/auth/me/groups").json() == {"groups": ["Own"]}
    assert env.client.get("/api/auth/me").json()["custom_groups"] == ["Own"]
    updated = env.client.patch("/api/auth/me", json={"display_name": "Own profile"})
    assert updated.status_code == 200 and updated.json()["id"] == str(env.users[actor].id)
    saved = env.client.put("/api/auth/me/preferences", json={
        "preferences": {"row_order": ["Own row"]}, "target_user_id": target,
    })
    assert saved.status_code == 200
    assert env.client.get("/api/auth/me/preferences").json()["preferences"]["row_order"] == ["Own row"]
    with Session(env.engine) as session:
        other = session.get(User, env.users[foreign].id)
        assert not other.custom_groups and not other.ui_preferences
        assert other.display_name == env.users[foreign].display_name
    response = env.client.put("/api/auth/admin/preferences", json={"playlist_clipboard_line_limit": 15})
    assert response.status_code == (200 if actor == "admin" else 403)
