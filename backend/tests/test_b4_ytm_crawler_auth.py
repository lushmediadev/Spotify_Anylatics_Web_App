"""B4: YTM key rotation, no DB held across YouTube calls, auth mirror locking,
batch caps, in-progress refresh skipping, and case-insensitive email login."""

import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from test_youtube_api import env, AsyncSessionAdapter  # noqa: F401  (pytest fixture)
from app import database as shared_database
from app.services.auth import hash_password
from app.ytm import database as ytm_database
from app.ytm import models as _ytm_models  # noqa: F401  (register ytm tables)
from app.ytm.api import crawl as ytm_crawl
from app.ytm.models.crawl_job import CrawlJob
from app.ytm.models.item import Item
from app.ytm.models.user import User as YTMUser
from app.ytm.schemas.crawl import CrawlBatchRequest, CrawlScopeRequest
from app.ytm.services import auth as ytm_auth
from app.ytm.services import crawler, youtube_client
from app.ytm.services.youtube_client import YouTubeApiError
from app.ytm.utils.youtube_urls import parse_youtube_channel_url

CHANNEL_ID = "UC" + "b" * 22


def _channel_data(youtube_id=CHANNEL_ID, views=1000):
    from datetime import datetime
    return {"youtube_id": youtube_id, "name": "Chan", "image": None, "banner_image": None,
            "video_count": 3, "subscriber_count": 10, "view_count": views, "raw": {},
            "checked_at": datetime.utcnow()}


# ── youtube_client error codes ─────────────────────────────────────────────

@pytest.mark.parametrize("status, body, code, rotatable", [
    (403, {"error": {"message": "q", "errors": [{"reason": "quotaExceeded"}]}}, "quota_exceeded", True),
    (400, {"error": {"message": "k", "errors": [{"reason": "keyInvalid"}]}}, "invalid_key", True),
    (429, {"error": {"message": "slow"}}, "rate_limited", True),
    (403, {"error": {"message": "no"}}, "forbidden", True),
    (503, {"error": {"message": "down"}}, "api_unavailable", True),
    (400, {"error": {"message": "bad", "errors": [{"reason": "invalidParameter"}]}}, "invalid_query", False),
    (404, {"error": {"message": "gone"}}, "channel_not_found", False),
])
def test_ytm_request_errors_carry_codes(status, body, code, rotatable):
    async def run():
        transport = httpx.MockTransport(lambda request: httpx.Response(status, json=body))
        async with httpx.AsyncClient(transport=transport) as client:
            with pytest.raises(YouTubeApiError) as error:
                await youtube_client._request("channels", {"part": "id"}, "KEY", client)
            return error.value

    exc = asyncio.run(run())
    assert exc.code == code and exc.rotatable is rotatable


def test_ytm_network_and_invalid_json_codes():
    def boom(request):
        raise httpx.ConnectError("down")

    async def run(handler):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(YouTubeApiError) as error:
                await youtube_client._request("channels", {}, "KEY", client)
            return error.value

    assert asyncio.run(run(boom)).code == "network_error"
    invalid = asyncio.run(run(lambda request: httpx.Response(200, content=b"not json")))
    assert invalid.code == "invalid_response" and not invalid.rotatable


def test_dead_key_helpers_removed():
    assert not hasattr(youtube_client, "get_random_api_key")
    assert not hasattr(youtube_client, "check_api_key")
    assert not hasattr(crawler, "_mark_api_key")


# ── key rotation ───────────────────────────────────────────────────────────

def _fake_fetch(monkeypatch, outcomes):
    calls = []

    async def fake(parsed, key):
        calls.append(key)
        outcome = outcomes[len(calls) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(crawler, "fetch_channel", fake)
    return calls


@pytest.mark.parametrize("code", ["quota_exceeded", "invalid_key", "forbidden", "rate_limited", "network_error"])
def test_rotates_to_next_key_only_for_key_errors(monkeypatch, code):
    calls = _fake_fetch(monkeypatch, [YouTubeApiError("first", code), {"ok": True}])
    parsed = parse_youtube_channel_url("@handle")
    assert asyncio.run(crawler._fetch_with_api_keys(["k1", "k2", "k3"], parsed)) == {"ok": True}
    assert calls == ["k1", "k2"]


@pytest.mark.parametrize("error", [
    YouTubeApiError("Channel not found", "channel_not_found"),
    YouTubeApiError("bad input", "invalid_query"),
    YouTubeApiError("garbage", "invalid_response"),
    ValueError("unexpected bug"),
])
def test_non_rotatable_errors_stop_and_surface_original(monkeypatch, error):
    calls = _fake_fetch(monkeypatch, [error, {"ok": True}])
    with pytest.raises(type(error)) as raised:
        asyncio.run(crawler._fetch_with_api_keys(["k1", "k2"], parse_youtube_channel_url("@handle")))
    assert raised.value is error and calls == ["k1"]


def test_all_keys_exhausted_surfaces_last_error_and_no_keys_message(monkeypatch):
    last = YouTubeApiError("quota 2", "quota_exceeded")
    _fake_fetch(monkeypatch, [YouTubeApiError("quota 1", "quota_exceeded"), last])
    with pytest.raises(YouTubeApiError) as raised:
        asyncio.run(crawler._fetch_with_api_keys(["k1", "k2"], parse_youtube_channel_url("@h")))
    assert raised.value is last
    with pytest.raises(YouTubeApiError) as raised:
        asyncio.run(crawler._fetch_with_api_keys([], parse_youtube_channel_url("@h")))
    assert str(raised.value) == crawler.NO_SYSTEM_KEY_MESSAGE


# ── workers hold no DB session while awaiting YouTube ──────────────────────

def _ytm_rows(env, statuses=("pending",), item_status="crawling", query="@handle"):
    ytm_database.Base.metadata.create_all(env.engine)
    admin = env.users["admin"]
    with Session(env.engine, expire_on_commit=False) as session:
        user = session.get(YTMUser, str(admin.id)) or YTMUser(
            id=str(admin.id), shared_user_id=admin.id, username="admin",
            email=f"{admin.id}@internal.invalid", password_hash="x", role="user")
        session.merge(user)
        session.flush()
        parsed = parse_youtube_channel_url(query)
        jobs = []
        for status in statuses:
            item = Item(query=parsed.query, query_type=parsed.query_type, user_id=str(admin.id),
                        status=item_status, youtube_id=parsed.query if parsed.query_type == "id" else None)
            session.add(item)
            session.flush()
            job = CrawlJob(item_id=item.id, youtube_url=parsed.url, item_type="channel",
                           status=status, user_id=str(admin.id))
            session.add(job)
            session.flush()
            jobs.append((job.id, item.id, parsed))
        session.commit()
    return jobs


def _tracking_sessions(env, monkeypatch):
    tracker = {"open": 0, "opened": 0}

    @asynccontextmanager
    async def factory():
        tracker["open"] += 1
        tracker["opened"] += 1
        try:
            with Session(env.engine, expire_on_commit=False) as session:
                yield AsyncSessionAdapter(session)
        finally:
            tracker["open"] -= 1

    monkeypatch.setattr(crawler, "async_session", factory)
    return tracker


def test_crawl_item_task_releases_session_before_youtube_call(env, monkeypatch):
    [(job_id, item_id, parsed)] = _ytm_rows(env)
    tracker = _tracking_sessions(env, monkeypatch)
    keys_seen = []

    async def fake(parsed_arg, key):
        assert tracker["open"] == 0, "DB session held across YouTube call"
        keys_seen.append(key)
        return _channel_data()

    monkeypatch.setattr(crawler, "fetch_channel", fake)
    asyncio.run(crawler.crawl_item_task(job_id, parsed))
    assert keys_seen == ["key_admin"] and tracker["opened"] == 2
    with Session(env.engine) as session:
        job, item = session.get(CrawlJob, job_id), session.get(Item, item_id)
        assert job.status == "completed" and job.started_at is not None
        assert item.status == "active" and item.view_count == 1000


def test_crawl_item_task_records_non_rotatable_error_once(env, monkeypatch):
    [(job_id, item_id, parsed)] = _ytm_rows(env)
    _tracking_sessions(env, monkeypatch)
    calls = _fake_fetch(monkeypatch, [YouTubeApiError("Channel not found", "channel_not_found")])
    asyncio.run(crawler.crawl_item_task(job_id, parsed))
    assert calls == ["key_admin"]  # second system key (key_linked_admin) never spent
    with Session(env.engine) as session:
        assert session.get(CrawlJob, job_id).error == "Channel not found"
        assert session.get(Item, item_id).status == "error"


def test_batch_task_releases_session_before_youtube_call(env, monkeypatch):
    jobs = _ytm_rows(env, statuses=("pending",), query=CHANNEL_ID)
    tracker = _tracking_sessions(env, monkeypatch)

    async def fake(channel_ids, key):
        assert tracker["open"] == 0
        return {CHANNEL_ID: _channel_data()}

    monkeypatch.setattr(crawler, "fetch_channels_by_ids", fake)
    asyncio.run(crawler.crawl_channel_id_batch_task([(job_id, parsed) for job_id, _, parsed in jobs]))
    with Session(env.engine) as session:
        assert session.get(CrawlJob, jobs[0][0]).status == "completed"
        assert session.get(Item, jobs[0][1]).status == "active"


# ── R6: auth mirror lock + single session ──────────────────────────────────

class _RecordingDb(AsyncSessionAdapter):
    def __init__(self, session):
        super().__init__(session)
        self.locks = 0

    async def execute(self, statement, *args, **kwargs):
        if getattr(statement, "_for_update_arg", None) is not None:
            self.locks += 1
        return await super().execute(statement, *args, **kwargs)


def test_ytm_auth_locks_only_when_mirror_changes(env):
    ytm_database.Base.metadata.create_all(env.engine)
    with Session(env.engine, expire_on_commit=False) as session:
        db = _RecordingDb(session)
        actor = session.get(type(env.users["admin"]), env.users["admin"].id)
        user = asyncio.run(ytm_auth.get_current_user(actor, db))
        assert user.id == str(actor.id) and db.locks == 1  # mirror created
        session.commit()
        asyncio.run(ytm_auth.get_current_user(actor, db))
        assert db.locks == 1  # unchanged mirror: plain select, no row lock
        actor.username = "renamed_admin"
        user = asyncio.run(ytm_auth.get_current_user(actor, db))
        assert db.locks == 2 and user.username == "renamed_admin" and user.role == "user"


def test_ytm_routes_share_the_request_session_dependency():
    assert ytm_database.get_db is shared_database.get_db
    assert ytm_database.async_session is shared_database.async_session


# ── R7: batch cap + skip in-progress refreshes ─────────────────────────────

def test_batch_request_caps_urls_at_500():
    assert len(CrawlBatchRequest(urls=["@a"] * 500).urls) == 500
    with pytest.raises(ValidationError):
        CrawlBatchRequest(urls=["@a"] * 501)
    with pytest.raises(ValidationError):
        CrawlBatchRequest(urls=["@a"], item_ids=[None] * 501)


def test_scope_refresh_skips_items_already_crawling(env, monkeypatch):
    crawling = _ytm_rows(env, item_status="crawling", query="UC" + "c" * 22)
    idle = _ytm_rows(env, item_status="active", query=CHANNEL_ID)
    scheduled = []
    monkeypatch.setattr(ytm_crawl, "schedule_crawl_jobs", scheduled.extend)
    with Session(env.engine, expire_on_commit=False) as session:
        db = AsyncSessionAdapter(session)
        current_user = session.get(YTMUser, str(env.users["admin"].id))
        response = asyncio.run(ytm_crawl.crawl_scope(CrawlScopeRequest(), db, current_user))
    assert response.count == 1 and response.skipped_in_progress == 1
    assert response.item_ids == [idle[0][1]] and len(scheduled) == 1
    assert crawling[0][1] not in response.item_ids


# ── R8: login normalizes email only ────────────────────────────────────────

def test_login_matches_email_case_insensitively_username_unchanged(env):
    with Session(env.engine) as session:
        user = session.get(type(env.users["admin"]), env.users["admin"].id)
        user.password_hash = hash_password("pw")
        session.commit()
    login = lambda name: env.client.post("/api/auth/login", json={"username": name, "password": "pw"})
    assert login("  ADMIN@Example.Test ").status_code == 200
    assert login("admin@example.test").status_code == 200
    assert login("admin").status_code == 200
    assert login("ADMIN").status_code == 401
    assert login("admin@example.test").json()["user"]["username"] == "admin"


# ── notes ──────────────────────────────────────────────────────────────────

def test_ytm_item_note_is_owner_only_trimmed_searchable_and_exported(env):
    from fastapi import HTTPException
    from app.ytm.api import items as ytm_items
    from app.ytm.schemas.item import ItemNoteRequest

    [(_, item_id, _)] = _ytm_rows(env, statuses=("completed",), item_status="active")
    with pytest.raises(ValidationError):
        ItemNoteRequest(note="x" * 1001)
    with pytest.raises(ValidationError):
        ItemNoteRequest(note="ok", group="other")
    with Session(env.engine, expire_on_commit=False) as session:
        db = AsyncSessionAdapter(session)
        owner = session.get(YTMUser, str(env.users["admin"].id))
        other = YTMUser(id=str(env.users["manager"].id), shared_user_id=env.users["manager"].id, username="manager",
                        email="m@internal.invalid", password_hash="x", role="user")
        session.add(other)
        session.commit()
        saved = asyncio.run(ytm_items.update_item_note(item_id, ItemNoteRequest(note="  Sponsor lead\nfollow up  "), db, owner))
        assert saved.note == "Sponsor lead\nfollow up" and saved.note_updated_at is not None
        stamp = saved.note_updated_at
        same = asyncio.run(ytm_items.update_item_note(item_id, ItemNoteRequest(note="Sponsor lead\nfollow up"), db, owner))
        assert same.note_updated_at == stamp
        with pytest.raises(HTTPException) as denied:
            asyncio.run(ytm_items.update_item_note(item_id, ItemNoteRequest(note="foreign"), db, other))
        assert denied.value.status_code == 404
        found = asyncio.run(ytm_items.list_items(None, None, "SPONSOR lead", None, "asc", 50, 0, db, owner))
        assert [row.id for row in found.items] == [item_id] and found.items[0].note == saved.note
        missed = asyncio.run(ytm_items.list_items(None, None, "no such note", None, "asc", 50, 0, db, owner))
        assert missed.total == 0
        exported = asyncio.run(ytm_items.export_items({"item_ids": [item_id]}, db, owner))
        assert exported["rows"][0]["note"] == saved.note
        cleared = asyncio.run(ytm_items.update_item_note(item_id, ItemNoteRequest(note="  "), db, owner))
        assert cleared.note is None
