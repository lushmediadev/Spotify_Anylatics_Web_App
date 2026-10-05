"""Durable additive workspace contracts using real SQL and HTTP requests."""

from datetime import datetime, timedelta
import uuid

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.user import User
from app.models.youtube import Channel, ChannelPlaylist, ChannelSnapshot, YouTubeChannelGroup, YouTubeWorkspacePreference
from test_youtube_api import env, fixed_uuid, ids, link_ids, request, rows


def add_channel(env, value, group="Shared", owner=None):
    owner = owner or env.actor
    channel = Channel(id=fixed_uuid(value), user_id=env.users[owner].id,
        query_type="handle", query=f"@extra{value}", group=group, status="active",
        created_at=datetime(2026, 2, 1) + timedelta(seconds=value))
    with Session(env.engine) as session:
        session.add(channel)
        session.commit()
    return str(fixed_uuid(value))


def create_group(env, name):
    result = request(env, "POST", "/groups", json={"name": name})
    assert result.status_code == 200, result.text


def save(env, data):
    response = request(env, "PUT", "/preferences", json=data)
    assert response.status_code == 200, response.text
    assert request(env, "GET", "/preferences").json() == response.json()
    return response.json()


def test_preferences_default_partial_merge_reset_and_persist(env):
    assert request(env, "GET", "/preferences").json() == {
        "group_order": [], "channel_orders": {}, "playlist_orders": {}}
    first = str(env.channels[env.actor].id)
    second = add_channel(env, 400)
    other = add_channel(env, 401, "Other")
    playlist = str(env.items[env.actor].id)
    body = save(env, {"group_order": ["Shared", "Other"], "channel_orders": {"Shared": [second, first]},
        "playlist_orders": {first: [playlist]}})
    merged = save(env, {"channel_orders": {"Other": [other]}})
    assert merged["group_order"] == body["group_order"]
    assert merged["playlist_orders"] == body["playlist_orders"]
    assert merged["channel_orders"] == {"Shared": [second, first], "Other": [other]}
    reset = save(env, {"channel_orders": {"Shared": []}})
    assert reset["channel_orders"] == {"Shared": [], "Other": [other]}
    with Session(env.engine) as session:
        row = session.get(YouTubeWorkspacePreference, env.users[env.actor].id)
        assert row.channel_orders == reset["channel_orders"]
        assert row.playlist_orders == body["playlist_orders"]
    assert save(env, {}) == reset


def test_channel_sql_order_before_paging_filters_and_new_default_append(env):
    original = str(env.channels[env.actor].id)
    channel_ids = [add_channel(env, value) for value in range(400, 460)]
    ordered = list(reversed(channel_ids)) + [original]
    save(env, {"channel_orders": {"Shared": ordered}})
    env.statements.clear()
    page = request(env, "GET", params={"group": "Shared", "limit": 50}).json()
    assert [row["id"] for row in page["items"]] == ordered[:50]
    second = request(env, "GET", params={"group": "Shared", "offset": 50, "limit": 50}).json()
    assert [row["id"] for row in second["items"]] == ordered[50:]
    filtered = request(env, "GET", params={"search": "@extra4", "offset": 10, "limit": 5}).json()
    assert [row["id"] for row in filtered["items"]] == ordered[10:15]
    assert any("CASE" in sql and "LIMIT" in sql for sql in env.statements)
    new = request(env, "POST", json={"urls": ["@fresh"], "group": "Shared"}).json()["items"][0]["id"]
    assert [row["id"] for row in request(env, "GET", params={"limit": 500}).json()["items"]] == ordered + [new]
    duplicate = request(env, "POST", json={"urls": ["@fresh", "@fresh"], "group": "Shared"})
    assert duplicate.json()["accepted"] == 0 and duplicate.json()["skipped"] == 2
    assert request(env, "GET", params={"limit": 500}).json()["total"] == 62


def test_group_order_append_new_empty_and_discovered_groups(env):
    create_group(env, "Z existing")
    save(env, {"group_order": ["Shared"]})
    create_group(env, "A new")
    expected = ["Shared", "Z existing", "A new"]
    assert [row["name"] for row in request(env, "GET").json()["groups"]] == expected
    assert request(env, "GET", "/preferences").json()["group_order"] == expected
    assert request(env, "POST", json={"urls": ["@newgroup"], "group": "0 New"}).status_code == 200
    assert [row["name"] for row in request(env, "GET").json()["groups"]] == expected + ["0 New"]


def test_playlist_parent_order_batch_query_and_replace_cleanup(env):
    channel = str(env.channels[env.actor].id)
    second_channel = add_channel(env, 400)
    first_item = str(env.items[env.actor].id)
    with Session(env.engine) as session:
        second = Item(id=fixed_uuid(500), user_id=env.users[env.actor].id, item_type="playlist", workspace="channel-playlists",
            spotify_id="Q" * 22, group="Original", status="active", created_at=datetime(2026, 2, 1))
        session.add(second)
        session.flush()
        second_item = str(second.id)
        for parent in (channel, second_channel):
            session.add(ChannelPlaylist(channel_id=uuid.UUID(parent), item_id=second.id))
        session.add(ChannelPlaylist(channel_id=fixed_uuid(400), item_id=env.items[env.actor].id))
        session.commit()
    save(env, {"playlist_orders": {channel: [second_item, first_item], second_channel: [first_item, second_item]}})
    env.statements.clear()
    result = request(env, "GET").json()
    assert {row["id"]: [item["id"] for item in row["playlists"]] for row in result["items"]} == {
        channel: [second_item, first_item], second_channel: [first_item, second_item]}
    assert sum("FROM youtube_workspace_preferences" in sql for sql in env.statements) == 1
    detail = request(env, "GET", f"/channels/{channel}").json()
    assert [item["id"] for item in detail["playlists"]] == [second_item, first_item]
    replaced = request(env, "PUT", f"/channels/{channel}/playlists", json={"item_ids": [first_item]})
    assert replaced.status_code == 200
    assert request(env, "GET", "/preferences").json()["playlist_orders"][channel] == [first_item]
    assert len(rows(env, Item)) == 7


@pytest.mark.parametrize("actor", ["manager", "admin", "assigned"])
def test_own_only_bulk_mutations_and_preferences_are_atomic(env, actor):
    env.actor = actor
    foreign = "unassigned"
    own_id, foreign_id = str(env.channels[actor].id), str(env.channels[foreign].id)
    create_group(env, "Destination")
    before = ids(env, Channel), ids(env, Item), len(rows(env, ChannelSnapshot)), len(rows(env, ChannelPlaylist))
    for path in ("/channels/move", "/channels/delete"):
        payload = {"channel_ids": [own_id, foreign_id]}
        if path.endswith("move"):
            payload["group"] = "Destination"
        assert request(env, "POST", path, json=payload).status_code == 404
        assert (ids(env, Channel), ids(env, Item), len(rows(env, ChannelSnapshot)), len(rows(env, ChannelPlaylist))) == before
    for patch in (
        {"channel_orders": {"Shared": [foreign_id]}},
        {"playlist_orders": {foreign_id: []}},
        {"playlist_orders": {own_id: [str(env.items[foreign].id)]}},
        {"group_order": ["Destination"], "channel_orders": {"Shared": [foreign_id]}},
    ):
        assert request(env, "PUT", "/preferences", json=patch).status_code == 400
        assert rows(env, YouTubeWorkspacePreference) == []
    env.actor = foreign
    create_group(env, "Foreign only")
    save(env, {"group_order": ["Foreign only"]})
    env.actor = actor
    for method, path, data in (
        ("PATCH", "/groups", {"old_name": "Foreign only", "new_name": "Stolen"}),
        ("POST", "/groups/delete", {"names": ["Destination", "Foreign only"]}),
        ("POST", "/groups/clear", {"name": "Foreign only"}),
    ):
        assert request(env, method, path, json=data).status_code == 404
    assert request(env, "GET", "/preferences").json()["group_order"] == []
    assert "Destination" in [row["name"] for row in request(env, "GET").json()["groups"]]
    save(env, {"group_order": ["Destination"]})
    env.actor = foreign
    assert request(env, "GET", "/preferences").json()["group_order"] == ["Foreign only"]


@pytest.mark.parametrize("path", ["/channels/delete", "/channels/move"])
def test_batch_validation_empty_duplicate_missing_and_limit(env, path):
    create_group(env, "Destination")
    channel = str(env.channels[env.actor].id)
    for values, status in (([], 400), ([channel, channel], 400), ([str(fixed_uuid(9999))], 404),
                           ([str(fixed_uuid(i)) for i in range(1000, 1501)], 422)):
        data = {"channel_ids": values}
        if path.endswith("move"):
            data["group"] = "Destination"
        result = request(env, "POST", path, json=data)
        assert result.status_code == status, result.text
        assert len(rows(env, Channel)) == 6


@pytest.mark.parametrize("patch", [
    {"group_order": ["Shared", " Shared "]}, {"group_order": ["All Channels"]},
    {"group_order": ["Missing"]}, {"group_order": ["x" * 129]}, {"group_order": None},
    {"channel_orders": {"Shared": ["invalid"]}},
    {"playlist_orders": {"bad-key": []}},
    {"channel_orders": {"Missing": []}}, {"channel_orders": {"Shared": ["bad"] * 5001}},
    {"channel_orders": {str(index): [] for index in range(5001)}},
])
def test_invalid_preferences_do_not_persist(env, patch):
    before = save(env, {"group_order": ["Shared"]})
    assert request(env, "PUT", "/preferences", json=patch).status_code == 400
    assert request(env, "GET", "/preferences").json() == before


def test_preference_duplicate_ids_wrong_group_and_unlinked_item(env):
    channel = str(env.channels[env.actor].id)
    playlist = str(env.items[env.actor].id)
    other = add_channel(env, 400, "Other")
    for patch in (
        {"channel_orders": {"Shared": [channel, channel.upper()]}},
        {"channel_orders": {"Shared": [other]}},
        {"playlist_orders": {channel: [playlist, playlist]}},
        {"playlist_orders": {other: [playlist]}},
    ):
        assert request(env, "PUT", "/preferences", json=patch).status_code == 400
    assert rows(env, YouTubeWorkspacePreference) == []


def test_move_preserves_hidden_destination_and_source_order_associations(env):
    own = str(env.channels[env.actor].id)
    source = add_channel(env, 400)
    dest_first = add_channel(env, 401, "Destination")
    dest_hidden = add_channel(env, 402, "Destination")
    save(env, {"channel_orders": {"Shared": [source, own], "Destination": [dest_first]}})
    before = ids(env, Item), len(rows(env, ChannelPlaylist)), len(rows(env, ChannelSnapshot))
    response = request(env, "POST", "/channels/move", json={"channel_ids": [own], "group": "Destination"})
    assert response.status_code == 200 and response.json()["moved"] == 1
    assert request(env, "GET", "/preferences").json()["channel_orders"] == {
        "Shared": [source], "Destination": [dest_first, dest_hidden, own]}
    assert [row["id"] for row in request(env, "GET", params={"group": "Destination"}).json()["items"]] == [dest_first, dest_hidden, own]
    assert (ids(env, Item), len(rows(env, ChannelPlaylist)), len(rows(env, ChannelSnapshot))) == before
    assert request(env, "POST", "/channels/move", json={"channel_ids": [own], "group": "Destination"}).json()["moved"] == 0
    assert request(env, "POST", "/channels/move", json={"channel_ids": [own], "group": "Missing"}).status_code == 400


def test_rename_discovered_group_conflict_and_preference_cleanup(env):
    own = str(env.channels[env.actor].id)
    playlist = str(env.items[env.actor].id)
    create_group(env, "Conflict")
    save(env, {"group_order": ["Shared", "Conflict"], "channel_orders": {"Shared": [own]},
        "playlist_orders": {own: [playlist]}})
    assert request(env, "PATCH", "/groups", json={"old_name": "Shared", "new_name": "Conflict"}).status_code == 409
    response = request(env, "PATCH", "/groups", json={"old_name": "Shared", "new_name": "Renamed"})
    assert response.status_code == 200 and response.json()["updated"] == 1
    prefs = request(env, "GET", "/preferences").json()
    assert prefs == {"group_order": ["Renamed", "Conflict"], "channel_orders": {"Renamed": [own]},
        "playlist_orders": {own: [playlist]}}
    assert request(env, "GET", f"/channels/{own}").json()["group"] == "Renamed"
    assert link_ids(env, env.channels[env.actor]) == {env.items[env.actor].id}
    assert request(env, "PATCH", "/groups", json={"old_name": "Renamed", "new_name": "Renamed"}).status_code == 200
    assert request(env, "PATCH", "/groups", json={"old_name": "Renamed", "new_name": "All"}).status_code == 400


def test_group_delete_moves_without_deleting_and_rejects_ungrouped(env):
    own = str(env.channels[env.actor].id)
    playlist = str(env.items[env.actor].id)
    create_group(env, "Empty")
    save(env, {"group_order": ["Shared", "Empty"], "channel_orders": {"Shared": [own]},
        "playlist_orders": {own: [playlist]}})
    before = ids(env, Channel), ids(env, Item), len(rows(env, ChannelPlaylist)), len(rows(env, ChannelSnapshot))
    response = request(env, "POST", "/groups/delete", json={"names": ["Shared", "Empty"]})
    assert response.status_code == 200 and response.json() == {"deleted": 2, "moved": 1, "names": ["Shared", "Empty"]}
    assert (ids(env, Channel), ids(env, Item), len(rows(env, ChannelPlaylist)), len(rows(env, ChannelSnapshot))) == before
    assert request(env, "GET", f"/channels/{own}").json()["group"] == "Ungrouped"
    assert request(env, "GET", "/preferences").json() == {"group_order": ["Ungrouped"], "channel_orders": {"Ungrouped": [own]},
        "playlist_orders": {own: [playlist]}}
    assert request(env, "POST", "/groups/delete", json={"names": ["Ungrouped"]}).status_code == 400
    assert request(env, "GET").json()["groups"] == [{"name": "Ungrouped", "count": 1}]


@pytest.mark.parametrize("method,path", [("POST", "/channels/delete"), ("DELETE", "/channels/{id}"),
                                        ("POST", "/groups/clear")])
def test_delete_clear_only_youtube_keep_spotify_and_cleanup_order(env, method, path):
    channel = str(env.channels[env.actor].id)
    create_group(env, "Shared")
    save(env, {"group_order": ["Shared"], "channel_orders": {"Shared": [channel]},
        "playlist_orders": {channel: [str(env.items[env.actor].id)]}})
    before = ids(env, Item)
    data = {"name": "Shared"} if path.endswith("clear") else {"channel_ids": [channel]}
    response = request(env, method, path.format(id=channel), json=data if method == "POST" else None)
    assert response.status_code == 200, response.text
    assert ids(env, Item) == before
    assert len(rows(env, Channel)) == len(rows(env, ChannelPlaylist)) == len(rows(env, ChannelSnapshot)) == 5
    assert request(env, "GET", "/preferences").json() == {
        "group_order": ["Shared"], "channel_orders": {"Shared": []}, "playlist_orders": {}}
    assert request(env, "GET").json()["groups"] == [{"name": "Shared", "count": 0}]


def test_clear_discovered_group_retains_definition_and_empty_ungrouped_delete(env):
    assert request(env, "POST", "/groups/clear", json={"name": "Shared"}).json()["deleted"] == 1
    assert request(env, "GET").json()["groups"] == [{"name": "Shared", "count": 0}]
    create_group(env, "Ungrouped")
    assert request(env, "POST", "/groups/delete", json={"names": ["Ungrouped"]}).status_code == 200


def test_preference_row_cascades_on_account_delete(env):
    env.actor = "unassigned"
    save(env, {"group_order": ["Shared"]})
    with Session(env.engine) as session:
        # Existing Spotify FK policy is unchanged; remove its resources first.
        session.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id == env.items[env.actor].id))
        session.execute(delete(Item).where(Item.user_id == env.users[env.actor].id))
        session.execute(delete(User).where(User.id == env.users[env.actor].id))
        session.commit()
        assert session.scalar(select(YouTubeWorkspacePreference)) is None


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/preferences", None), ("PUT", "/preferences", {}),
    ("PATCH", "/groups", {"old_name": "Shared", "new_name": "Other"}),
    ("POST", "/groups/delete", {"names": ["Shared"]}),
    ("POST", "/groups/clear", {"name": "Shared"}),
    ("POST", "/channels/delete", {"channel_ids": []}),
    ("POST", "/channels/move", {"channel_ids": [], "group": "Shared"}),
])
def test_workspace_routes_require_auth(env, method, path, payload):
    from app.services.auth import get_current_user
    del env.app.dependency_overrides[get_current_user]
    assert request(env, method, path, json=payload).status_code == 401


@pytest.mark.parametrize("field", ["user_id", "target_user_id", "preferences"])
def test_preference_unknown_owner_fields_forbidden(env, field):
    data = {"group_order": ["Shared"], field: str(env.users["unassigned"].id)}
    assert request(env, "PUT", "/preferences", json=data).status_code == 422
    assert rows(env, YouTubeWorkspacePreference) == []


def test_move_multiple_keeps_source_manual_order_before_destination_append(env):
    first = str(env.channels[env.actor].id)
    second = add_channel(env, 400)
    destination = add_channel(env, 401, "Destination")
    save(env, {"channel_orders": {"Shared": [second, first], "Destination": [destination]}})
    result = request(env, "POST", "/channels/move", json={"channel_ids": [first, second], "group": "Destination"})
    assert result.status_code == 200 and result.json()["moved"] == 2
    assert request(env, "GET", "/preferences").json()["channel_orders"] == {
        "Shared": [], "Destination": [destination, second, first]}


def test_group_delete_append_preserves_existing_ungrouped_hidden_channels(env):
    first = str(env.channels[env.actor].id)
    second = add_channel(env, 400)
    destination = add_channel(env, 401, "Ungrouped")
    hidden = add_channel(env, 402, "Ungrouped")
    save(env, {"channel_orders": {"Shared": [second, first], "Ungrouped": [destination]}})
    result = request(env, "POST", "/groups/delete", json={"names": ["Shared"]})
    assert result.status_code == 200 and result.json()["moved"] == 2
    assert request(env, "GET", "/preferences").json()["channel_orders"] == {
        "Ungrouped": [destination, hidden, second, first]}


def test_merged_preference_limit_is_atomic(env):
    with Session(env.engine) as session:
        session.add_all(YouTubeChannelGroup(user_id=env.users[env.actor].id, name=f"Group{i}")
            for i in range(2500))
        session.commit()
    names = [f"Group{i}" for i in range(2500)]
    before = save(env, {"group_order": names, "channel_orders": {name: [] for name in names}})
    assert request(env, "PUT", "/preferences", json={"channel_orders": {"Shared": []}}).status_code == 400
    assert request(env, "GET", "/preferences").json() == before


def test_owner_lock_is_first_mutation_query_for_new_endpoints(env, monkeypatch):
    from test_youtube_api import AsyncSessionAdapter
    from sqlalchemy.dialects.postgresql import dialect

    statements = []
    original = AsyncSessionAdapter.execute

    async def record(self, statement, *args, **kwargs):
        statements.append(str(statement.compile(dialect=dialect())))
        return await original(self, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSessionAdapter, "execute", record)
    channel = str(env.channels[env.actor].id)
    for method, path, payload in (
        ("PUT", "/preferences", {}),
        ("POST", "/channels/move", {"channel_ids": [channel], "group": "Shared"}),
        ("PATCH", "/groups", {"old_name": "Shared", "new_name": "Shared"}),
        ("POST", "/channels/delete", {"channel_ids": []}),
        ("POST", "/groups/delete", {"names": ["Missing"]}),
        ("POST", "/groups/clear", {"name": "Missing"}),
    ):
        statements.clear()
        request(env, method, path, json=payload)
        assert "SELECT users.id" in statements[0] and "FOR UPDATE" in statements[0]
