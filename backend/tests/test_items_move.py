import asyncio
import json
import uuid

import pytest
from types import SimpleNamespace

from fastapi import HTTPException
from app.api import items as items_api
from app.schemas.item import ItemMoveRequest


class FakeResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        class Scalar:
            def __init__(self, items):
                self._items = items

            def all(self):
                return list(self._items)

        return Scalar(self._items)


class FakeSession:
    def __init__(self, items):
        self.items = items
        self.committed = False

    async def execute(self, query):
        return FakeResult(self.items)

    async def commit(self):
        self.committed = True


def make_item(item_id, user_id, group):
    return SimpleNamespace(id=item_id, user_id=user_id, group=group)


def test_user_cannot_move_other_users_items():
    async def run():
        user = SimpleNamespace(id=uuid.uuid4(), role="user")
        session = FakeSession([])
        with pytest.raises(HTTPException) as exc:
            await items_api.move_items_group(
                ItemMoveRequest(item_ids=[uuid.uuid4()], group="new"),
                db=session,
                current_user=user,
            )
        assert exc.value.status_code == 404

    asyncio.run(run())


def test_user_moves_own_items():
    async def run():
        user = SimpleNamespace(id=uuid.uuid4(), role="user")
        item = make_item(uuid.uuid4(), user.id, "old")
        session = FakeSession([item])
        response = await items_api.move_items_group(
            ItemMoveRequest(item_ids=[item.id], group="moved"),
            db=session,
            current_user=user,
        )
        assert response["moved"] == 1
        assert item.group == "moved"
        assert session.committed

    asyncio.run(run())


def test_admin_moves_own_items():
    async def run():
        admin = SimpleNamespace(id=uuid.uuid4(), role="admin")
        target_user = admin.id
        item = make_item(uuid.uuid4(), target_user, "source")
        session = FakeSession([item])
        response = await items_api.move_items_group(
            ItemMoveRequest(item_ids=[item.id], group="", user_id=target_user),
            db=session,
            current_user=admin,
        )
        assert response["group"] is None
        assert response["moved"] == 1
        assert item.group is None

    asyncio.run(run())


def test_row_order_keys_parse_uuid_id_prefixes():
    first = uuid.uuid4()
    second = uuid.uuid4()
    user = SimpleNamespace(
        ui_preferences=json.dumps(
            {
                "row_order": [
                    f"id:{first}",
                    "not-a-uuid",
                    str(second),
                    f"id:{first}",
                ]
            }
        )
    )

    indexes = items_api._row_order_uuid_indexes(items_api._load_row_order_keys(user))

    assert indexes[first] == 0
    assert indexes[second] == 2
    assert len(indexes) == 2


def test_item_search_matches_full_spotify_url_by_type_and_id():
    admin = SimpleNamespace(id=uuid.uuid4(), role="admin")

    query = items_api._apply_item_scope(
        items_api.select(items_api.Item),
        admin,
        search="https://open.spotify.com/playlist/37i9dQZF1DWV7EzJMK2FUI?si=test",
    )
    compiled = str(query)

    assert "items.item_type = :item_type_1" in compiled
    assert "items.spotify_id = :spotify_id_1" in compiled


def test_default_item_sort_places_new_items_at_the_end():
    user = SimpleNamespace(id=uuid.uuid4(), role="user", ui_preferences=None)

    query = items_api._apply_item_sort(
        items_api.select(items_api.Item),
        user,
    )
    compiled = str(query)

    assert "items.created_at ASC" in compiled
    assert "items.id ASC" in compiled


def test_playlist_export_refetches_incomplete_cached_tracks(monkeypatch):
    async def run():
        item = SimpleNamespace(item_type="playlist", spotify_id="playlist123")
        raw_map = {
            "playlist123": {
                "tracks": [{"name": "cached"}] * 100,
                "tracks_expected": 367,
                "deep_crawl_complete": False,
            }
        }
        calls = []

        async def fake_fetch_playlist(playlist_id):
            calls.append(playlist_id)
            return {
                "tracks": [{"name": "fresh"}] * 367,
                "tracks_expected": 367,
                "deep_crawl_complete": True,
            }

        monkeypatch.setattr(items_api.spotify_client, "fetch_playlist", fake_fetch_playlist)
        result = await items_api._hydrate_raw_for_export(
            "playlist-type3",
            [item],
            raw_map,
            True,
        )

        assert calls == ["playlist123"]
        assert len(result["playlist123"]["tracks"]) == 367

    asyncio.run(run())
