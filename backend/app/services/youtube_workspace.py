"""Owner-locked, additive workspace ordering; never owns Spotify resources."""

import uuid

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.models.item import Item
from app.models.user import User
from app.models.youtube import (
    Channel, ChannelPlaylist, ChannelSnapshot, YouTubeChannelGroup, YouTubeWorkspacePreference,
)

AGGREGATE_GROUPS = {"all", "all links", "all channels"}


def channel_group_name(value):
    name = value.strip()
    if not name or len(name) > 128 or name.casefold() in AGGREGATE_GROUPS:
        raise HTTPException(400, "Choose a non-aggregate channel group")
    return name


async def lock_owner(db, user_id):
    # Lock the always-existing owner first, including before preference row creation.
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())


async def load_preferences(db, user_id):
    row = (await db.execute(select(YouTubeWorkspacePreference).where(
        YouTubeWorkspacePreference.user_id == user_id,
    ).execution_options(populate_existing=True))).scalar_one_or_none()
    return row, {
        "group_order": list(row.group_order or []) if row else [],
        "channel_orders": {key: list(value) for key, value in (row.channel_orders or {}).items()} if row else {},
        "playlist_orders": {key: list(value) for key, value in (row.playlist_orders or {}).items()} if row else {},
    }


async def workspace_state(db, user_id):
    channels = list((await db.execute(select(Channel).where(Channel.user_id == user_id)
        .order_by(Channel.created_at, Channel.id).execution_options(populate_existing=True))).scalars())
    groups = set((await db.execute(select(YouTubeChannelGroup.name).where(
        YouTubeChannelGroup.user_id == user_id))).scalars()) | {row.group for row in channels}
    return groups, {str(row.id): row for row in channels}


async def playlist_members(db, user_id):
    rows = (await db.execute(select(ChannelPlaylist.channel_id, ChannelPlaylist.item_id)
        .join(Channel, Channel.id == ChannelPlaylist.channel_id)
        .join(Item, Item.id == ChannelPlaylist.item_id).where(
            Channel.user_id == user_id, Item.user_id == user_id, Item.item_type == "playlist",
        ))).all()
    members = {}
    for channel_id, item_id in rows:
        members.setdefault(str(channel_id), set()).add(str(item_id))
    return members


async def prune_preferences(db, user_id, data):
    groups, channels = await workspace_state(db, user_id)
    members = await playlist_members(db, user_id)
    data["group_order"] = [name for name in data["group_order"] if name in groups]
    data["channel_orders"] = {
        name: [value for value in values if value in channels and channels[value].group == name]
        for name, values in data["channel_orders"].items() if name in groups
    }
    data["playlist_orders"] = {
        channel: [value for value in values if value in members.get(channel, set())]
        for channel, values in data["playlist_orders"].items() if channel in channels
    }
    return data


def check_size(data):
    size = len(data["group_order"]) + sum(
        len(values) + 1 for field in ("channel_orders", "playlist_orders") for values in data[field].values()
    )
    if size > 5000:
        raise HTTPException(400, "Workspace preferences exceed 5000 entries")


def save_preferences(db, user_id, row, data):
    check_size(data)
    if row is None:
        row = YouTubeWorkspacePreference(user_id=user_id)
        db.add(row)
    for field, value in data.items():
        setattr(row, field, value)


def unique_names(values):
    names = [channel_group_name(value) for value in values]
    if any(len(name) > 128 for name in names) or len(names) != len(set(names)):
        raise HTTPException(400, "Invalid or duplicate group names")
    return names


def unique_ids(values):
    try:
        ids = [str(uuid.UUID(value)) for value in values]
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "Invalid workspace UUID") from None
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "Duplicate workspace UUIDs")
    return ids


async def append_new_group(db, user_id, name):
    groups, _ = await workspace_state(db, user_id)
    row, data = await load_preferences(db, user_id)
    if row and data["group_order"] and name not in groups:
        data = await prune_preferences(db, user_id, data)
        data["group_order"] += sorted(groups - set(data["group_order"]))
        data["group_order"].append(name)
        save_preferences(db, user_id, row, data)


async def locked_channels(db, user_id, ids):
    if not ids:
        raise HTTPException(400, "Choose at least one channel")
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "Duplicate channel IDs")
    rows = list((await db.execute(select(Channel).where(Channel.user_id == user_id, Channel.id.in_(ids))
        .order_by(Channel.id).with_for_update().execution_options(populate_existing=True))).scalars())
    if {row.id for row in rows} != set(ids):
        raise HTTPException(404, "One or more channels not found")
    return rows


async def remove_channels(db, user_id, channels):
    ids = [row.id for row in channels]
    if ids:
        await db.execute(delete(ChannelPlaylist).where(ChannelPlaylist.channel_id.in_(ids)))
        await db.execute(delete(ChannelSnapshot).where(ChannelSnapshot.channel_id.in_(ids)))
        await db.execute(delete(Channel).where(Channel.user_id == user_id, Channel.id.in_(ids)))
    row, data = await load_preferences(db, user_id)
    if row:
        save_preferences(db, user_id, row, await prune_preferences(db, user_id, data))
