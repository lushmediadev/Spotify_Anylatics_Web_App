"""Endpoint integration tests: ownership decisions execute against real SQLite SQL."""

import asyncio
import inspect
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.params import Query
from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app.api import crawl as crawl_api, items as items_api, jobs as jobs_api
from app.database import Base
from app.models.crawl_job import CrawlJob
from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.models.user import User
from app.schemas.crawl import CrawlBatchRequest, CrawlRequest
from app.schemas.item import ItemMoveRequest
from app.schemas.job import JobBatchRequest


@compiles(JSONB, "sqlite")
def _sqlite_jsonb(type_, compiler, **kwargs):
    return "JSON"


class AsyncSessionAdapter:
    """Async endpoint interface over a real sync Session; no aiosqlite required."""

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

    async def refresh(self, instance):
        self.session.refresh(instance)

    async def delete(self, instance):
        self.session.delete(instance)


ALLOWED = ("manager",)
FORBIDDEN = ("assigned", "assigned_two", "unassigned", "other_manager", "admin", "linked_manager", "linked_admin")


@pytest.fixture
def scope_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        users = {}
        for name in ALLOWED + FORBIDDEN:
            role = "manager" if "manager" in name else "admin" if "admin" in name else "user"
            users[name] = User(
                id=uuid.uuid4(), username=name, email=f"{name}@example.test",
                password_hash="unused", role=role,
            )
        session.add_all(users.values())
        session.flush()
        for name in ("assigned", "assigned_two", "linked_manager", "linked_admin"):
            users[name].manager_id = users["manager"].id
        items = {}
        for index, (name, owner) in enumerate(users.items()):
            items[name] = Item(
                id=uuid.uuid4(), user_id=owner.id, spotify_id=f"scope{index:017d}",
                item_type="track", name=f"Private {name}", group="shared",
                status={"assigned": "error", "assigned_two": "pending"}.get(name, "active"),
            )
        items["legacy"] = Item(
            id=uuid.uuid4(), user_id=None, spotify_id="legacy0000000000000000",
            item_type="track", name="Legacy", status="active", group="shared",
        )
        session.add_all(items.values())
        session.flush()
        for item in items.values():
            session.add(MetricsSnapshot(item_id=item.id, spotify_id=item.spotify_id, playcount=10))
            session.add(RawResponse(spotify_id=item.spotify_id, operation="test", response_data={}))
        session.commit()
        scheduled = []

        def schedule(coroutine):
            # Close, rather than run, the real crawler coroutine after endpoint commit.
            scheduled.append(coroutine)
            coroutine.close()

        monkeypatch.setattr(crawl_api.asyncio, "create_task", schedule)
        yield SimpleNamespace(
            session=session, db=AsyncSessionAdapter(session), users=users,
            items=items, scheduled=scheduled,
        )
    engine.dispose()


def call(state, endpoint, actor="manager", **kwargs):
    # Direct route calls need the concrete defaults that FastAPI normally supplies.
    defaults = {
        name: param.default.default
        for name, param in inspect.signature(endpoint).parameters.items()
        if isinstance(param.default, Query)
    }
    defaults.update(kwargs)
    return asyncio.run(endpoint(db=state.db, current_user=state.users[actor], **defaults))


def denied(state, endpoint, *, status=(403, 404), **kwargs):
    with pytest.raises(HTTPException) as error:
        call(state, endpoint, **kwargs)
    assert error.value.status_code in status
    # Mirror get_db's failed-request rollback, including batch partial flushes.
    state.session.rollback()


def ids(state, names):
    return {str(state.items[name].id) for name in names}


def remaining_ids(state):
    return {str(value) for value in state.session.scalars(select(Item.id))}


def url(item):
    return f"https://open.spotify.com/{item.item_type}/{item.spotify_id}"


@pytest.mark.parametrize("actor,names", [
    ("manager", ALLOWED), ("assigned", ("assigned",)),
    ("admin", ("admin",)),
])
def test_list_and_summary_scope(scope_db, actor, names):
    response = call(scope_db, items_api.list_items, actor=actor)
    assert {item.id for item in response.items} == ids(scope_db, names)
    assert response.total == len(names)
    summary = call(scope_db, items_api.item_summary, actor=actor)
    assert summary.total == summary.all_total == len(names)
    assert [(group.name, group.count) for group in summary.groups] == [("shared", len(names))]
    if actor == "manager":
        assert (summary.active, summary.errors, summary.crawling) == (1, 0, 0)


@pytest.mark.parametrize("owner", ALLOWED + FORBIDDEN)
def test_explicit_list_summary_filter_intersects_manager_scope(scope_db, owner):
    target = str(scope_db.users[owner].id)
    response = call(scope_db, items_api.list_items, user_id=target)
    summary = call(scope_db, items_api.item_summary, user_id=target)
    expected = ids(scope_db, (owner,)) if owner in ALLOWED else set()
    assert {item.id for item in response.items} == expected
    assert response.total == summary.total == summary.all_total == len(expected)
    assert sum(group.count for group in summary.groups) == len(expected)


def test_list_pagination_and_search_do_not_leak(scope_db):
    page = call(scope_db, items_api.list_items, limit=1, offset=1)
    assert page.total == 1 and page.items == []
    for owner in FORBIDDEN:
        result = call(scope_db, items_api.list_items, search=scope_db.items[owner].spotify_id)
        assert result.total == 0 and result.items == []


@pytest.mark.parametrize("owner", ALLOWED + FORBIDDEN + ("legacy",))
def test_get_item_scope(scope_db, owner):
    item = scope_db.items[owner]
    args = dict(item_type=item.item_type, spotify_id=item.spotify_id)
    if owner in ALLOWED:
        assert call(scope_db, items_api.get_item, **args).id == str(item.id)
    else:
        denied(scope_db, items_api.get_item, **args)


@pytest.mark.parametrize("endpoint", [items_api.get_item, items_api.delete_item])
def test_link_duplicates_cannot_expand_own_scope(scope_db, endpoint):
    own = scope_db.items["manager"]
    assigned = scope_db.items["assigned"]
    assigned.spotify_id = own.spotify_id
    scope_db.session.commit()
    before = remaining_ids(scope_db)
    args = dict(item_type="track", spotify_id=own.spotify_id)
    denied(scope_db, endpoint, user_id=str(scope_db.users["assigned"].id), **args)
    response = call(scope_db, endpoint, **args)
    if endpoint is items_api.get_item:
        assert response.id == str(own.id)
    else:
        assert response["deleted"] == 1
        assert remaining_ids(scope_db) == before - {str(own.id)}
        assert scope_db.session.scalar(select(RawResponse).where(RawResponse.spotify_id == own.spotify_id))


@pytest.mark.parametrize("endpoint", [items_api.get_item, items_api.delete_item])
@pytest.mark.parametrize("owner", FORBIDDEN)
def test_explicit_link_owner_never_falls_back(scope_db, endpoint, owner):
    own = scope_db.items["manager"]
    scope_db.items[owner].spotify_id = own.spotify_id
    scope_db.session.commit()
    before = remaining_ids(scope_db)
    denied(scope_db, endpoint, item_type="track", spotify_id=own.spotify_id,
           user_id=str(scope_db.users[owner].id))
    assert remaining_ids(scope_db) == before


def test_move_mixed_ids_only_changes_scoped_rows(scope_db):
    response = call(scope_db, items_api.move_items_group, payload=ItemMoveRequest(
        item_ids=[item.id for item in scope_db.items.values()], group="moved",
    ))
    assert response["moved"] == 1
    scope_db.session.expire_all()
    for name, item in scope_db.items.items():
        assert item.group == ("moved" if name in ALLOWED else "shared")


@pytest.mark.parametrize("owner", ALLOWED + FORBIDDEN)
def test_move_explicit_owner_intersects_scope(scope_db, owner):
    payload = ItemMoveRequest(
        item_ids=[item.id for item in scope_db.items.values()],
        user_id=scope_db.users[owner].id, group="moved",
    )
    if owner in ALLOWED:
        assert call(scope_db, items_api.move_items_group, payload=payload)["moved"] == 1
    else:
        denied(scope_db, items_api.move_items_group, payload=payload)
    scope_db.session.expire_all()
    for name, item in scope_db.items.items():
        assert item.group == ("moved" if name == owner and owner in ALLOWED else "shared")


@pytest.mark.parametrize("owner", [None, *FORBIDDEN])
def test_rename_defaults_to_own_and_explicit_owner_intersects_scope(scope_db, owner):
    args = dict(old_group="shared", new_group="renamed")
    if owner is not None:
        args["user_id"] = str(scope_db.users[owner].id)
    if owner in FORBIDDEN:
        try:
            result = call(scope_db, items_api.rename_group, **args)
            assert result["updated"] == 0
        except HTTPException as error:
            assert error.status_code in (403, 404)
            scope_db.session.rollback()
    else:
        assert call(scope_db, items_api.rename_group, **args)["updated"] == 1
    scope_db.session.expire_all()
    for name, item in scope_db.items.items():
        changed = name == (owner or "manager") and owner not in FORBIDDEN
        assert item.group == ("renamed" if changed else "shared")


@pytest.mark.parametrize("endpoint", [items_api.delete_item, items_api.delete_item_by_id])
@pytest.mark.parametrize("owner", ALLOWED + FORBIDDEN + ("legacy",))
def test_delete_scope_and_dependent_rows(scope_db, endpoint, owner):
    item = scope_db.items[owner]
    item_id, spotify_id = item.id, item.spotify_id
    job = CrawlJob(item_id=item_id, user_id=item.user_id, spotify_url=url(item), result={"private": owner})
    scope_db.session.add(job)
    scope_db.session.commit()
    before = remaining_ids(scope_db)
    args = dict(item_id=str(item_id)) if endpoint is items_api.delete_item_by_id else dict(
        item_type="track", spotify_id=spotify_id,
    )
    if owner in ALLOWED:
        assert call(scope_db, endpoint, **args)["deleted"] == 1
        assert remaining_ids(scope_db) == before - {str(item_id)}
        assert scope_db.session.get(CrawlJob, job.id) is None
        assert scope_db.session.scalar(select(MetricsSnapshot).where(MetricsSnapshot.item_id == item_id)) is None
        assert scope_db.session.scalar(select(RawResponse).where(RawResponse.spotify_id == spotify_id)) is None
    else:
        denied(scope_db, endpoint, **args)
        assert remaining_ids(scope_db) == before
        assert scope_db.session.get(CrawlJob, job.id) is not None
        assert scope_db.session.scalar(select(MetricsSnapshot).where(MetricsSnapshot.item_id == item_id)) is not None


@pytest.mark.parametrize("owner", [None, *FORBIDDEN])
def test_clear_scope_and_explicit_owner(scope_db, owner):
    before = remaining_ids(scope_db)
    args = dict(group="shared")
    if owner is not None:
        args["user_id"] = str(scope_db.users[owner].id)
    expected = ids(scope_db, ALLOWED if owner is None else (owner,)) if owner not in FORBIDDEN else set()
    response = call(scope_db, items_api.clear_items, **args)
    assert response["deleted"] == len(expected)
    assert remaining_ids(scope_db) == before - expected
    snapshots = {str(value) for value in scope_db.session.scalars(select(MetricsSnapshot.item_id))}
    assert snapshots == before - expected


@pytest.mark.parametrize("owner", ALLOWED + FORBIDDEN + ("legacy",))
def test_export_authorization_is_all_or_nothing(scope_db, owner):
    requested = [str(scope_db.items[owner].id), str(scope_db.items["manager"].id)]
    payload = items_api.ItemExportRequest(action="track-offline", item_ids=requested)
    if owner in ALLOWED:
        response = call(scope_db, items_api.export_items, payload=payload)
        expected = list(dict.fromkeys(requested))
        assert response["count"] == len(expected)
        assert [row[1] for row in response["rows"]] == [
            url(scope_db.session.get(Item, uuid.UUID(item_id))) for item_id in expected
        ]
    else:
        denied(scope_db, items_api.export_items, status=(404,), payload=payload)


@pytest.mark.parametrize("batch", [False, True])
@pytest.mark.parametrize("owner", ALLOWED + FORBIDDEN)
def test_crawl_target_and_job_owner(scope_db, batch, owner):
    target = scope_db.users[owner]
    endpoint = crawl_api.crawl_batch if batch else crawl_api.crawl
    new_url = "https://open.spotify.com/track/newscope00000000000001"
    args = dict(group="new", target_user_id=target.id)
    req = CrawlBatchRequest(urls=[new_url], **args) if batch else CrawlRequest(url=new_url, **args)
    before = remaining_ids(scope_db)
    if owner in FORBIDDEN:
        denied(scope_db, endpoint, status=(403,), req=req)
        assert remaining_ids(scope_db) == before
        assert scope_db.session.scalars(select(CrawlJob)).all() == []
        assert scope_db.scheduled == []
        return
    response = call(scope_db, endpoint, req=req)
    job_id = response.job_ids[0] if batch else response.job_id
    job = scope_db.session.get(CrawlJob, uuid.UUID(job_id))
    item = scope_db.session.get(Item, job.item_id)
    assert job.user_id == item.user_id == target.id
    assert item.group == "new" and len(scope_db.scheduled) == 1
    assert call(scope_db, jobs_api.get_job, actor=owner, job_id=job_id).id == job_id


@pytest.mark.parametrize("batch", [False, True])
@pytest.mark.parametrize("owner", ALLOWED + FORBIDDEN + ("legacy",))
def test_refresh_requires_owner_access_and_preserves_job_owner(scope_db, batch, owner):
    item = scope_db.items[owner]
    endpoint = crawl_api.crawl_batch if batch else crawl_api.crawl
    # No target: refresh must use the item's owner, not the actor's default target.
    req = CrawlBatchRequest(urls=[url(item)], item_ids=[item.id]) if batch else CrawlRequest(
        url=url(item), item_id=item.id,
    )
    previous = (item.status, item.group)
    if owner not in ALLOWED:
        denied(scope_db, endpoint, status=(404,), req=req)
        assert (item.status, item.group) == previous
        assert scope_db.session.scalars(select(CrawlJob)).all() == []
        assert scope_db.scheduled == []
        return
    response = call(scope_db, endpoint, req=req)
    job_id = response.job_ids[0] if batch else response.job_id
    job = scope_db.session.get(CrawlJob, uuid.UUID(job_id))
    assert job.item_id == item.id and job.user_id == item.user_id
    assert item.status == "crawling" and item.group == "shared"
    assert len(scope_db.scheduled) == 1


@pytest.mark.parametrize("batch", [False, True])
def test_refresh_explicit_target_must_match_item_owner(scope_db, batch):
    item = scope_db.items["assigned"]
    args = dict(target_user_id=scope_db.users["assigned_two"].id)
    req = CrawlBatchRequest(urls=[url(item)], item_ids=[item.id], **args) if batch else CrawlRequest(
        url=url(item), item_id=item.id, **args,
    )
    denied(scope_db, crawl_api.crawl_batch if batch else crawl_api.crawl, status=(403,), req=req)
    assert scope_db.session.scalars(select(CrawlJob)).all() == []
    assert scope_db.scheduled == []


def test_batch_refresh_rolls_back_on_out_of_scope_row(scope_db):
    allowed = scope_db.items["manager"]
    forbidden = scope_db.items["unassigned"]
    req = CrawlBatchRequest(urls=[url(allowed), url(forbidden)], item_ids=[allowed.id, forbidden.id])
    denied(scope_db, crawl_api.crawl_batch, status=(404,), req=req)
    assert allowed.status == "active" and forbidden.status == "active"
    assert scope_db.session.scalars(select(CrawlJob)).all() == []
    assert scope_db.scheduled == []


def seed_jobs(state):
    jobs = {}
    for name, item in state.items.items():
        # Legacy jobs may record the actor rather than canonical item owner.
        actor_id = state.users["unassigned"].id if name in ALLOWED else state.users["manager"].id
        jobs[name] = CrawlJob(item_id=item.id, user_id=actor_id, spotify_url=url(item), result={"owner": name})
    for owner in ALLOWED + FORBIDDEN:
        jobs[f"standalone_{owner}"] = CrawlJob(
            item_id=None, user_id=state.users[owner].id,
            spotify_url="https://open.spotify.com/track/standalone", result={"owner": owner},
        )
    jobs["standalone_legacy"] = CrawlJob(item_id=None, user_id=None, spotify_url="legacy", result={})
    state.session.add_all(jobs.values())
    state.session.commit()
    return jobs


@pytest.mark.parametrize("actor", ["manager", "assigned", "admin"])
def test_jobs_canonical_item_owner_and_standalone_fallback(scope_db, actor):
    jobs = seed_jobs(scope_db)
    names = {actor, f"standalone_{actor}"}
    requested = list(reversed(list(jobs.values())))
    response = call(scope_db, jobs_api.get_jobs_batch, actor=actor, req=JobBatchRequest(
        job_ids=["invalid", *[str(job.id) for job in requested], str(requested[0].id)],
    ))
    expected = [str(job.id) for job in requested if job in [jobs[name] for name in names]]
    assert [job.id for job in response.jobs] == expected
    for name, job in jobs.items():
        if name in names:
            response = call(scope_db, jobs_api.get_job, actor=actor, job_id=str(job.id))
            assert response.id == str(job.id) and response.result == job.result
        else:
            denied(scope_db, jobs_api.get_job, actor=actor, status=(404,), job_id=str(job.id))


@pytest.mark.parametrize("actor,owner", [("assigned", "assigned"), ("admin", "admin"), ("manager", "manager")])
def test_refresh_all_roles_preserve_own_job_owner(scope_db, actor, owner):
    item = scope_db.items[owner]
    target = item.user_id if actor == "admin" and item.user_id is not None else None
    response = call(scope_db, crawl_api.crawl, actor=actor, req=CrawlRequest(
        url=url(item), item_id=item.id, target_user_id=target,
    ))
    job = scope_db.session.get(CrawlJob, uuid.UUID(response.job_id))
    assert job.user_id == (item.user_id or scope_db.users[actor].id)


def test_user_cannot_escape_own_scope_with_explicit_filters(scope_db):
    target = str(scope_db.users["unassigned"].id)
    assert call(scope_db, items_api.list_items, actor="assigned", user_id=target).total == 0
    assert call(scope_db, items_api.item_summary, actor="assigned", user_id=target).total == 0
    assert call(scope_db, items_api.clear_items, actor="assigned", user_id=target)["deleted"] == 0
    denied(scope_db, crawl_api.crawl, actor="assigned", status=(403,), req=CrawlRequest(
        url="https://open.spotify.com/track/newuser000000000000001", group="new",
        target_user_id=scope_db.users["unassigned"].id,
    ))


def test_manager_batch_refresh_has_no_per_item_user_lookup(scope_db):
    statements = []

    def capture(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = scope_db.session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        selected = [scope_db.items[name] for name in ALLOWED]
        response = call(scope_db, crawl_api.crawl_batch, req=CrawlBatchRequest(
            urls=[url(item) for item in selected], item_ids=[item.id for item in selected],
        ))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.count == len(selected)
    # Ownership checks must not introduce per-item User ORM loads.
    assert not [sql for sql in statements if sql.lstrip().lower().startswith("select users.")]
    assert len(statements) == len(selected)
    assert len(scope_db.scheduled) == len(selected)
    for job_id, item in zip(response.job_ids, selected):
        job = scope_db.session.get(CrawlJob, uuid.UUID(job_id))
        assert job.item_id == item.id and job.user_id == item.user_id


@pytest.mark.parametrize("batch", [False, True])
def test_manager_duplicate_crawl_is_owner_specific(scope_db, batch):
    existing = scope_db.items["manager"]
    endpoint = crawl_api.crawl_batch if batch else crawl_api.crawl
    args = dict(group="new", target_user_id=scope_db.users["manager"].id)
    req = CrawlBatchRequest(urls=[url(existing)], **args) if batch else CrawlRequest(url=url(existing), **args)
    response = call(scope_db, endpoint, req=req)
    if batch:
        assert response.count == 0 and response.skipped_duplicates == 1
    else:
        assert response.status == "duplicate" and response.item_id == str(existing.id)
    assert scope_db.session.scalars(select(CrawlJob)).all() == []
    assert scope_db.scheduled == []
    args["target_user_id"] = scope_db.users["assigned_two"].id
    req = CrawlBatchRequest(urls=[url(existing)], **args) if batch else CrawlRequest(url=url(existing), **args)
    denied(scope_db, endpoint, status=(403,), req=req)
    assert scope_db.session.scalars(select(CrawlJob)).all() == []


@pytest.mark.parametrize("batch", [False, True])
def test_crawl_missing_target_returns_404(scope_db, batch):
    args = dict(group="new", target_user_id=uuid.uuid4())
    new_url = "https://open.spotify.com/track/missingowner00000000001"
    req = CrawlBatchRequest(urls=[new_url], **args) if batch else CrawlRequest(url=new_url, **args)
    denied(scope_db, crawl_api.crawl_batch if batch else crawl_api.crawl, status=(404,), req=req)
    assert scope_db.session.scalars(select(CrawlJob)).all() == []
    assert scope_db.scheduled == []


def test_jobs_invalid_id_is_400(scope_db):
    denied(scope_db, jobs_api.get_job, status=(400,), job_id="invalid")


@pytest.mark.parametrize("endpoint", [items_api.get_item, items_api.delete_item])
def test_admin_default_duplicate_link_only_affects_own(scope_db, endpoint):
    own = scope_db.items["admin"]
    scope_db.items["unassigned"].spotify_id = own.spotify_id
    scope_db.session.commit()
    before = remaining_ids(scope_db)
    response = call(scope_db, endpoint, actor="admin", item_type="track", spotify_id=own.spotify_id)
    if endpoint is items_api.get_item:
        assert response.id == str(own.id)
        assert remaining_ids(scope_db) == before
    else:
        assert response["deleted"] == 1
        assert remaining_ids(scope_db) == before - {str(own.id)}


def test_admin_default_move_only_own_excluding_legacy(scope_db):
    response = call(scope_db, items_api.move_items_group, actor="admin", payload=ItemMoveRequest(
        item_ids=[item.id for item in scope_db.items.values()], group="changed",
    ))
    assert response["moved"] == 1
    scope_db.session.expire_all()
    assert all(item.group == ("changed" if name == "admin" else "shared")
               for name, item in scope_db.items.items())


def test_admin_default_rename_only_own_excluding_legacy(scope_db):
    response = call(scope_db, items_api.rename_group, actor="admin", old_group="shared", new_group="changed")
    assert response["updated"] == 1
    scope_db.session.expire_all()
    for name, item in scope_db.items.items():
        assert item.group == ("changed" if name == "admin" else "shared")


def test_admin_default_clear_only_own_excluding_legacy(scope_db):
    before = remaining_ids(scope_db)
    response = call(scope_db, items_api.clear_items, actor="admin")
    assert response["deleted"] == 1
    assert remaining_ids(scope_db) == before - ids(scope_db, ("admin",))
    assert len(scope_db.session.scalars(select(MetricsSnapshot)).all()) == len(before) - 1
    assert len(scope_db.session.scalars(select(RawResponse)).all()) == len(before) - 1


def test_admin_export_denies_foreign_and_legacy(scope_db):
    selected = list(scope_db.items.values())
    denied(scope_db, items_api.export_items, actor="admin", status=(404,), payload=items_api.ItemExportRequest(
        action="track-offline", item_ids=[str(item.id) for item in selected],
    ))
    response = call(scope_db, items_api.export_items, actor="admin", payload=items_api.ItemExportRequest(
        action="track-offline", item_ids=[str(scope_db.items["admin"].id)],
    ))
    assert response["count"] == 1


@pytest.mark.parametrize("batch", [False, True])
def test_admin_refresh_without_target_denies_foreign_owner(scope_db, batch):
    item = scope_db.items["assigned"]
    req = CrawlBatchRequest(urls=[url(item)], item_ids=[item.id]) if batch else CrawlRequest(
        url=url(item), item_id=item.id,
    )
    denied(scope_db, crawl_api.crawl_batch if batch else crawl_api.crawl, actor="admin", status=(404,), req=req)
    assert scope_db.scheduled == []


@pytest.mark.parametrize("batch", [False, True])
def test_admin_new_foreign_target_is_denied(scope_db, batch):
    target = scope_db.users["unassigned"]
    args = dict(group="new", target_user_id=target.id)
    new_url = "https://open.spotify.com/track/adminnew00000000000001"
    req = CrawlBatchRequest(urls=[new_url], **args) if batch else CrawlRequest(url=new_url, **args)
    denied(scope_db, crawl_api.crawl_batch if batch else crawl_api.crawl, actor="admin", status=(403,), req=req)
    assert scope_db.session.scalars(select(CrawlJob)).all() == []
    assert scope_db.scheduled == []


@pytest.mark.parametrize("actor", ["admin", "manager", "assigned"])
def test_jobs_reassignment_revokes_creator_access(scope_db, actor):
    item = scope_db.items[actor]
    job = CrawlJob(item_id=item.id, user_id=scope_db.users[actor].id,
                   spotify_url=url(item), result={"private": actor})
    scope_db.session.add(job)
    scope_db.session.commit()
    assert call(scope_db, jobs_api.get_job, actor=actor, job_id=str(job.id)).id == str(job.id)
    item.user_id = scope_db.users["unassigned"].id
    scope_db.session.commit()
    denied(scope_db, jobs_api.get_job, actor=actor, status=(404,), job_id=str(job.id))
    assert call(scope_db, jobs_api.get_jobs_batch, actor=actor,
                req=JobBatchRequest(job_ids=[str(job.id)])).jobs == []
    assert call(scope_db, jobs_api.get_job, actor="unassigned", job_id=str(job.id)).id == str(job.id)


def test_admin_null_owner_item_is_not_dedupe_or_refresh_target(scope_db):
    legacy = scope_db.items["legacy"]
    assert asyncio.run(crawl_api._find_existing_owned_item(
        scope_db.db, scope_db.users["admin"], scope_db.users["admin"].id,
        legacy.item_type, legacy.spotify_id,
    )) is None
    denied(scope_db, crawl_api.crawl, actor="admin", status=(404,), req=CrawlRequest(
        url=url(legacy), item_id=legacy.id,
    ))
    response = call(scope_db, crawl_api.crawl, actor="admin", req=CrawlRequest(
        url=url(legacy), group="Own",
    ))
    job = scope_db.session.get(CrawlJob, uuid.UUID(response.job_id))
    item = scope_db.session.get(Item, job.item_id)
    assert item.id != legacy.id and item.user_id == scope_db.users["admin"].id
    assert legacy.user_id is None
