import asyncio
import uuid
from types import SimpleNamespace

from app.api import items as items_api


class _FakeResult:
    def __init__(self, rows=None, rowcount=0):
        self._rows = rows or []
        self.rowcount = rowcount

    def all(self):
        return list(self._rows)


class _FakeAsyncSession:
    def __init__(self, select_rows=None, delete_rowcount=0):
        self.select_rows = list(select_rows or [])
        self.delete_rowcount = delete_rowcount
        self.statements = []
        self.committed = False

    async def execute(self, statement):
        self.statements.append(statement)
        if len(self.statements) == 1:
            return _FakeResult(rows=self.select_rows)
        return _FakeResult(rowcount=self.delete_rowcount)

    async def commit(self):
        self.committed = True


async def _noop_delete_raw_if_unreferenced(*_args, **_kwargs):
    return None


def _run_clear_items(*, db, current_user, group=None, user_id=None):
    return asyncio.run(
        items_api.clear_items(
            group=group,
            user_id=user_id,
            db=db,
            current_user=current_user,
        )
    )


def test_clear_items_group_filter_uses_normalized_name(monkeypatch):
    monkeypatch.setattr(items_api, "_delete_raw_if_unreferenced", _noop_delete_raw_if_unreferenced)
    current_user = SimpleNamespace(role="user", id=str(uuid.uuid4()))
    db = _FakeAsyncSession(select_rows=[(uuid.uuid4(), "spotify-1")], delete_rowcount=1)
    legacy_group = f"{uuid.uuid4()}::  Chill Mix  "

    result = _run_clear_items(db=db, current_user=current_user, group=legacy_group)

    select_stmt = db.statements[0]
    params = select_stmt.compile().params
    assert current_user.id in params.values()
    assert "chill mix" in params.values()
    assert result["deleted"] == 1
    assert db.committed is True


def test_clear_items_all_links_group_skips_group_where_clause(monkeypatch):
    monkeypatch.setattr(items_api, "_delete_raw_if_unreferenced", _noop_delete_raw_if_unreferenced)
    current_user = SimpleNamespace(role="user", id=str(uuid.uuid4()))
    db = _FakeAsyncSession(select_rows=[(uuid.uuid4(), "spotify-1")], delete_rowcount=1)

    _run_clear_items(db=db, current_user=current_user, group="All Links")

    select_stmt = db.statements[0]
    params = select_stmt.compile().params
    assert current_user.id in params.values()
    assert "all links" not in params.values()


def test_clear_items_returns_zero_without_commit_when_nothing_matches(monkeypatch):
    monkeypatch.setattr(items_api, "_delete_raw_if_unreferenced", _noop_delete_raw_if_unreferenced)
    current_user = SimpleNamespace(role="user", id=str(uuid.uuid4()))
    db = _FakeAsyncSession(select_rows=[])

    result = _run_clear_items(db=db, current_user=current_user, group="Any Group")

    assert result["deleted"] == 0
    assert db.committed is False
    assert len(db.statements) == 1
