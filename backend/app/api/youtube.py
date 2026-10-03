"""YouTube channels with actor-scoped keys and owner-scoped playlist links."""

import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.items import _extract_owner_url, _item_to_response, _load_item_users, _load_latest_raw_data, _load_recent_snapshots
from app.database import get_db
from app.models.crawl_job import CrawlJob
from app.models.item import Item
from app.models.user import User
from app.models.youtube import Channel, ChannelPlaylist, ChannelSnapshot, YouTubeApiKey, YouTubeChannelGroup, YouTubeWorkspacePreference
from app.schemas.youtube import (ChannelCreateRequest, ChannelGroupRequest, ChannelListResponse, ChannelRefreshRequest,
    ChannelResponse, KeysCheckRequest, KeysRequest, PlaylistReplaceRequest, WorkspacePreferenceResponse,
    WorkspacePreferenceRequest, ChannelBatchRequest, ChannelMoveRequest, ChannelGroupRenameRequest,
    ChannelGroupsDeleteRequest, ChannelGroupClearRequest)
from app.services.auth import get_current_user, owner_scope_condition, require_user_access
from app.services import youtube_jobs
from app.services import youtube_workspace as workspace
from app.services.youtube_workspace import AGGREGATE_GROUPS, channel_group_name
from app.services.youtube import check_keys as check_external_keys
from app.utils.youtube_urls import parse_youtube_url

class PrivateKeyRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                return await handler(request)
            except RequestValidationError:
                if self.path.endswith(("/keys", "/keys/check")):
                    # FastAPI normally includes invalid input values in 422 responses.
                    raise HTTPException(422, "Invalid API key request") from None
                raise

        return private_handler


router = APIRouter(prefix="/youtube", tags=["YouTube"], route_class=PrivateKeyRoute)


async def ensure_channel_group(db, user_id, name):
    existing = (await db.execute(select(YouTubeChannelGroup).where(
        YouTubeChannelGroup.user_id == user_id, YouTubeChannelGroup.name == name,
    ))).scalar_one_or_none()
    if existing is None:
        db.add(YouTubeChannelGroup(user_id=user_id, name=name))


@router.post("/groups")
async def create_group(req: ChannelGroupRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    name = channel_group_name(req.name)
    owner = await require_user_access(db, current_user, req.target_user_id or current_user.id)
    await db.execute(select(User.id).where(User.id == owner.id).with_for_update())
    await workspace.append_new_group(db, owner.id, name)
    await ensure_channel_group(db, owner.id, name)
    await db.commit()
    count = (await db.execute(select(func.count()).select_from(Channel).where(
        Channel.user_id == owner.id, Channel.group == name,
    ))).scalar_one()
    return {"name": name, "count": count, "user_id": str(owner.id)}


@router.get("/preferences", response_model=WorkspacePreferenceResponse)
async def get_workspace_preferences(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _, data = await workspace.load_preferences(db, current_user.id)
    return await workspace.prune_preferences(db, current_user.id, data)


@router.put("/preferences", response_model=WorkspacePreferenceResponse)
async def put_workspace_preferences(req: WorkspacePreferenceRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    patch = req.model_dump(exclude_unset=True)
    if any(value is None for value in patch.values()):
        raise HTTPException(400, "Preference fields cannot be null; use [] to reset an order")
    workspace.check_size({"group_order": [], "channel_orders": {}, "playlist_orders": {}, **patch})
    await workspace.lock_owner(db, current_user.id)
    groups, channels = await workspace.workspace_state(db, current_user.id)
    members = await workspace.playlist_members(db, current_user.id)
    if "group_order" in patch:
        patch["group_order"] = workspace.unique_names(patch["group_order"])
        if not set(patch["group_order"]) <= groups:
            raise HTTPException(400, "Group not found")
    if "channel_orders" in patch:
        normalized = {}
        for key, values in patch["channel_orders"].items():
            name = workspace.unique_names([key])[0]
            ids = workspace.unique_ids(values)
            if name not in groups or any(value not in channels or channels[value].group != name for value in ids):
                raise HTTPException(400, "Channels must belong to the owner's group")
            if name in normalized:
                raise HTTPException(400, "Duplicate group names")
            normalized[name] = ids
        patch["channel_orders"] = normalized
    if "playlist_orders" in patch:
        normalized = {}
        for key, values in patch["playlist_orders"].items():
            channel = workspace.unique_ids([key])[0]
            ids = workspace.unique_ids(values)
            if channel not in channels or not set(ids) <= members.get(channel, set()):
                raise HTTPException(400, "Playlists must be linked to an owned channel")
            if channel in normalized:
                raise HTTPException(400, "Duplicate channel IDs")
            normalized[channel] = ids
        patch["playlist_orders"] = normalized
    row, data = await workspace.load_preferences(db, current_user.id)
    data = await workspace.prune_preferences(db, current_user.id, data)
    for field, value in patch.items():
        if field == "group_order":
            data[field] = value
        else:
            data[field].update(value)
    workspace.save_preferences(db, current_user.id, row, data)
    await db.commit()
    return data


@router.patch("/groups")
async def rename_group(req: ChannelGroupRenameRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    old, new = channel_group_name(req.old_name), channel_group_name(req.new_name)
    await workspace.lock_owner(db, current_user.id)
    groups, _ = await workspace.workspace_state(db, current_user.id)
    if old not in groups:
        raise HTTPException(404, "Group not found")
    if new != old and new in groups:
        raise HTTPException(409, "Group already exists")
    await ensure_channel_group(db, current_user.id, old)
    await db.flush()
    result = await db.execute(update(Channel).where(Channel.user_id == current_user.id, Channel.group == old).values(group=new))
    await db.execute(update(YouTubeChannelGroup).where(YouTubeChannelGroup.user_id == current_user.id,
        YouTubeChannelGroup.name == old).values(name=new))
    row, data = await workspace.load_preferences(db, current_user.id)
    if row:
        data["group_order"] = [new if value == old else value for value in data["group_order"]]
        if old in data["channel_orders"]:
            data["channel_orders"][new] = data["channel_orders"].pop(old)
        workspace.save_preferences(db, current_user.id, row, await workspace.prune_preferences(db, current_user.id, data))
    await db.commit()
    return {"old_name": old, "new_name": new, "updated": result.rowcount}


async def move_workspace_channels(db, user_id, rows, destination):
    preference, data = await workspace.load_preferences(db, user_id)
    data = await workspace.prune_preferences(db, user_id, data)
    moved = {str(row.id) for row in rows if row.group != destination}
    if moved:
        for source in {row.group for row in rows if row.group != destination}:
            await ensure_channel_group(db, user_id, source)
        _, all_channels = await workspace.workspace_state(db, user_id)
        # Preserve visible destination order, including previously unranked records.
        destination_order = list(data["channel_orders"].get(destination, []))
        destination_order += [key for key, row in all_channels.items()
            if row.group == destination and key not in destination_order]
        group_ranks = {name: index for index, name in enumerate(data["group_order"])}
        channel_ranks = {name: {value: index for index, value in enumerate(values)}
            for name, values in data["channel_orders"].items()}
        appended = sorted(moved, key=lambda key: (
            group_ranks.get(all_channels[key].group, len(group_ranks)),
            all_channels[key].group if group_ranks else "",
            channel_ranks.get(all_channels[key].group, {}).get(key, 5000),
            all_channels[key].created_at, key,
        ))
        for name, values in data["channel_orders"].items():
            data["channel_orders"][name] = [value for value in values if value not in moved]
        data["channel_orders"][destination] = destination_order + appended
        for row in rows:
            row.group = destination
        await db.flush()
        workspace.save_preferences(db, user_id, preference, data)
    return len(moved)


@router.post("/groups/delete")
async def delete_groups(req: ChannelGroupsDeleteRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    names = workspace.unique_names(req.names)
    await workspace.lock_owner(db, current_user.id)
    groups, channels = await workspace.workspace_state(db, current_user.id)
    if not set(names) <= groups:
        raise HTTPException(404, "One or more groups not found")
    selected = [row for row in channels.values() if row.group in names]
    if "Ungrouped" in names and selected:
        raise HTTPException(400, "Cannot delete Ungrouped while channels require it")
    moved = 0
    if selected:
        await workspace.append_new_group(db, current_user.id, "Ungrouped")
        await ensure_channel_group(db, current_user.id, "Ungrouped")
        await db.flush()
        moved = await move_workspace_channels(db, current_user.id, selected, "Ungrouped")
    await db.execute(delete(YouTubeChannelGroup).where(YouTubeChannelGroup.user_id == current_user.id,
        YouTubeChannelGroup.name.in_(names)))
    row, data = await workspace.load_preferences(db, current_user.id)
    if row:
        workspace.save_preferences(db, current_user.id, row, await workspace.prune_preferences(db, current_user.id, data))
    await db.commit()
    return {"deleted": len(names), "moved": moved, "names": names}


@router.post("/groups/clear")
async def clear_group(req: ChannelGroupClearRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    name = channel_group_name(req.name)
    await workspace.lock_owner(db, current_user.id)
    groups, channels = await workspace.workspace_state(db, current_user.id)
    if name not in groups:
        raise HTTPException(404, "Group not found")
    await ensure_channel_group(db, current_user.id, name)
    await db.flush()
    selected = [row for row in channels.values() if row.group == name]
    await workspace.remove_channels(db, current_user.id, selected)
    await db.commit()
    return {"name": name, "deleted": len(selected)}


@router.post("/channels/move")
async def move_channels(req: ChannelMoveRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    destination = channel_group_name(req.group)
    await workspace.lock_owner(db, current_user.id)
    rows = await workspace.locked_channels(db, current_user.id, req.channel_ids)
    groups, _ = await workspace.workspace_state(db, current_user.id)
    if destination not in groups:
        raise HTTPException(400, "Destination group not found")
    await ensure_channel_group(db, current_user.id, destination)
    moved = await move_workspace_channels(db, current_user.id, rows, destination)
    await db.commit()
    return {"moved": moved, "group": destination, "channel_ids": [str(value) for value in req.channel_ids]}


@router.post("/channels/delete")
async def delete_channels(req: ChannelBatchRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await workspace.lock_owner(db, current_user.id)
    rows = await workspace.locked_channels(db, current_user.id, req.channel_ids)
    await workspace.remove_channels(db, current_user.id, rows)
    await db.commit()
    return {"deleted": len(rows), "channel_ids": [str(value) for value in req.channel_ids]}


def clean_keys(raw):
    if len(raw) > 32768:
        raise HTTPException(400, "API key input is too large")
    keys = list(dict.fromkeys(line.strip() for line in raw.splitlines() if line.strip()))
    if len(keys) > 100 or any(len(key) > 256 or not re.fullmatch(r"[A-Za-z0-9_-]+", key) for key in keys):
        raise HTTPException(400, "Invalid API key input")
    return keys


async def own_keys(db, actor):
    return list((await db.execute(select(YouTubeApiKey.key).where(YouTubeApiKey.user_id == actor.id)
        .order_by(YouTubeApiKey.position))).scalars())


@router.get("/keys")
async def get_keys(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return {"api_keys": "\n".join(await own_keys(db, current_user))}


@router.put("/keys")
async def put_keys(req: KeysRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    keys = clean_keys(req.api_keys)
    await db.execute(select(User.id).where(User.id == current_user.id).with_for_update())
    await db.execute(delete(YouTubeApiKey).where(YouTubeApiKey.user_id == current_user.id))
    for position, key in enumerate(keys):
        db.add(YouTubeApiKey(user_id=current_user.id, key=key, position=position))
    await db.commit()
    return {"api_keys": "\n".join(keys)}


@router.post("/keys/check")
async def check_keys(req: KeysCheckRequest = KeysCheckRequest(), db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    keys = clean_keys(req.api_keys) if req.api_keys is not None else await own_keys(db, current_user)
    return {"results": await check_external_keys(keys)}


async def channel_for_actor(db, actor, channel_id):
    row = (await db.execute(select(Channel).where(Channel.id == channel_id,
        owner_scope_condition(actor, Channel.user_id)))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Channel not found")
    return row


async def channel_responses(db, channels, preferences=None):
    playlists = defaultdict(list)
    if channels:
        if preferences is None:
            preferences = {row.user_id: row.playlist_orders for row in (await db.execute(
                select(YouTubeWorkspacePreference).where(YouTubeWorkspacePreference.user_id.in_(
                    {channel.user_id for channel in channels})))).scalars()}
        ranks = {channel.id: {value: index for index, value in enumerate(
            preferences.get(channel.user_id, {}).get(str(channel.id), []))} for channel in channels}
        rows = (await db.execute(select(ChannelPlaylist.channel_id, Item).join(Item, Item.id == ChannelPlaylist.item_id)
            .join(Channel, Channel.id == ChannelPlaylist.channel_id).where(
                Channel.id.in_([row.id for row in channels]), Item.user_id == Channel.user_id,
                Item.item_type == "playlist",
            ).order_by(Item.created_at, Item.id))).all()
        items = list({item.id: item for _, item in rows}.values())
        raw = await _load_latest_raw_data(db, items)
        snapshots = await _load_recent_snapshots(db, items)
        users = await _load_item_users(db, items)
        for channel_id, item in rows:
            playlists[channel_id].append(_item_to_response(item, owner_url=_extract_owner_url(item, raw.get(item.spotify_id)), raw_data=raw.get(item.spotify_id),
                snapshots=snapshots.get(item.id), item_user=users.get(str(item.user_id))))
        for channel_id, values in playlists.items():
            rank = ranks[channel_id]
            values.sort(key=lambda item: rank.get(item.id, len(rank)))
    return [ChannelResponse(**{field: str(getattr(row, field)) if field in {"id", "user_id"} else getattr(row, field)
        for field in ChannelResponse.model_fields if field not in {"playlists", "youtube_url"}},
        youtube_url=f"https://www.youtube.com/channel/{row.youtube_id}" if row.youtube_id else None,
        playlists=playlists[row.id]) for row in channels]


@router.get("/channels", response_model=ChannelListResponse)
async def list_channels(user_id: uuid.UUID | None = None, group: str | None = None, search: str | None = None,
    filter: Literal["all", "changed", "errors"] = "all", limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _, preferences = await workspace.load_preferences(db, current_user.id)
    conditions = [owner_scope_condition(current_user, Channel.user_id)]
    if user_id:
        conditions.append(Channel.user_id == user_id)
    groups = (await db.execute(select(Channel.group, func.count()).where(*conditions)
        .group_by(Channel.group).order_by(Channel.group))).all()
    group_conditions = [owner_scope_condition(current_user, YouTubeChannelGroup.user_id)]
    if user_id:
        group_conditions.append(YouTubeChannelGroup.user_id == user_id)
    stored_groups = list((await db.execute(select(YouTubeChannelGroup.name).where(*group_conditions))).scalars())
    group_counts = {name: count for name, count in groups}
    for name in stored_groups:
        group_counts.setdefault(name, 0)
    if group and group.strip().casefold() not in AGGREGATE_GROUPS:
        conditions.append(Channel.group == group)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        conditions.append(or_(Channel.name.ilike(pattern), Channel.query.ilike(pattern), Channel.youtube_id.ilike(pattern)))
    if filter == "changed":
        conditions.append(Channel.view_count_delta != 0)
    elif filter == "errors":
        conditions.append(Channel.status == "error")
    total = (await db.execute(select(func.count()).select_from(Channel).where(*conditions))).scalar_one()
    ordering = []
    # Keep the legacy global created_at order unless a group rail order was set.
    group_ranks = {name: index for index, name in enumerate(preferences["group_order"])}
    if group_ranks:
        ordering.extend([case(group_ranks, value=Channel.group, else_=len(group_ranks)), Channel.group])
    channel_ranks = {uuid.UUID(value): index for values in preferences["channel_orders"].values()
        for index, value in enumerate(values)}
    if channel_ranks:
        ordering.append(case(channel_ranks, value=Channel.id, else_=5000))
    channels = list((await db.execute(select(Channel).where(*conditions).order_by(*ordering, Channel.created_at.asc(), Channel.id)
        .limit(limit).offset(offset))).scalars())
    keys = await own_keys(db, current_user)
    return ChannelListResponse(items=await channel_responses(db, channels,
        {current_user.id: preferences["playlist_orders"]}), total=total,
        groups=[{"name": name, "count": group_counts[name]} for name in sorted(group_counts,
            key=lambda name: (group_ranks.get(name, len(group_ranks)), name))], key_count=len(keys), has_keys=bool(keys))


async def claim_refresh(db, channels):
    accepted = []
    owners = defaultdict(list)
    attempts = {}
    cutoff = datetime.utcnow() - timedelta(seconds=youtube_jobs.LEASE_SECONDS)
    owner_ids = {row.user_id for row in channels}
    if owner_ids:
        await db.execute(select(User.id).where(User.id.in_(owner_ids)).order_by(User.id).with_for_update())
    for row in sorted(channels, key=lambda channel: str(channel.id)):
        started = datetime.utcnow()
        claimed = await db.execute(update(Channel).where(Channel.id == row.id, or_(Channel.status != "crawling",
            Channel.refresh_started_at < cutoff)).values(
            status="crawling", error_code=None, error_message=None, refresh_started_at=started))
        if claimed.rowcount:
            accepted.append(row.id)
            owners[row.user_id].append(row.id)
            attempts[row.id] = started
    await db.commit()
    for owner, ids in owners.items():
        youtube_jobs.track(youtube_jobs.refresh_channels(owner, ids, {value: attempts[value] for value in ids}))
    return {"accepted": len(accepted), "skipped": len(channels) - len(accepted), "channel_ids": [str(value) for value in accepted]}


@router.post("/channels")
async def create_channels(req: ChannelCreateRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    group = channel_group_name(req.group)
    owner = await require_user_access(db, current_user, req.target_user_id or current_user.id)
    parsed = [parse_youtube_url(url) for url in req.urls]
    if any(value is None for value in parsed):
        raise HTTPException(400, "Invalid YouTube channel URL")
    # Serialize owner mutations across API calls and workers, including unresolved aliases.
    await db.execute(select(User).where(User.id == owner.id).with_for_update())
    await workspace.append_new_group(db, owner.id, group)
    await ensure_channel_group(db, owner.id, group)
    existing = list((await db.execute(select(Channel).where(Channel.user_id == owner.id))).scalars())
    by_query = {(row.query_type, row.query): row for row in existing}
    by_id = {row.youtube_id: row for row in existing if row.youtube_id}
    created, response_rows, skipped = [], [], 0
    for query_type, query in parsed:
        found = by_query.get((query_type, query)) or (by_id.get(query) if query_type == "id" else None)
        if found:
            skipped += 1
            if found not in response_rows:
                response_rows.append(found)
            continue
        row = Channel(user_id=owner.id, query_type=query_type, query=query, group=group,
            youtube_id=query if query_type == "id" else None, status="pending")
        db.add(row)
        await db.flush()
        created.append(row)
        response_rows.append(row)
        by_query[(query_type, query)] = row
        if row.youtube_id:
            by_id[row.youtube_id] = row
    await claim_refresh(db, created)
    return {"accepted": len(created), "skipped": skipped, "items": await channel_responses(db, response_rows)}


@router.post("/channels/refresh")
async def refresh_channels(req: ChannelRefreshRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = select(Channel).where(owner_scope_condition(current_user, Channel.user_id))
    ids = set(req.channel_ids)
    if ids:
        query = query.where(Channel.id.in_(ids))
    rows = list((await db.execute(query)).scalars())
    if ids and {row.id for row in rows} != ids:
        raise HTTPException(404, "One or more channels not found")
    return await claim_refresh(db, rows)


@router.get("/channels/{channel_id}", response_model=ChannelResponse)
async def get_channel(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (await channel_responses(db, [await channel_for_actor(db, current_user, channel_id)]))[0]


@router.post("/channels/{channel_id}/refresh")
async def refresh_channel(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return await claim_refresh(db, [await channel_for_actor(db, current_user, channel_id)])


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await workspace.lock_owner(db, current_user.id)
    rows = await workspace.locked_channels(db, current_user.id, [channel_id])
    await workspace.remove_channels(db, current_user.id, rows)
    await db.commit()
    return {"deleted": True, "channel_id": str(channel_id)}


def playlist_id(url):
    value = url.strip()
    match = re.fullmatch(r"spotify:playlist:([A-Za-z0-9]{22})", value)
    if match:
        return match[1]
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"https", "http"} or parsed.hostname != "open.spotify.com" or parsed.username or parsed.password or parsed.port:
            return None
        match = re.fullmatch(r"/(?:intl-[a-z]{2}/)?playlist/([A-Za-z0-9]{22})/?", parsed.path)
        return match[1] if match else None
    except ValueError:
        return None


def make_spotify_job(db, item):
    item.status, item.error_code, item.error_message = "crawling", None, None
    job = CrawlJob(item_id=item.id, user_id=item.user_id, item_type="playlist",
        spotify_url=f"https://open.spotify.com/playlist/{item.spotify_id}", status="pending",
        result={"youtube_channel_job": True})
    db.add(job)
    return job


@router.put("/channels/{channel_id}/playlists", response_model=ChannelResponse)
async def replace_playlists(channel_id: uuid.UUID, req: PlaylistReplaceRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    channel = await channel_for_actor(db, current_user, channel_id)
    parsed = [playlist_id(url) for url in req.urls]
    if any(value is None for value in parsed):
        raise HTTPException(400, "Only valid Spotify playlist URLs are accepted")
    await db.execute(select(User.id).where(User.id == channel.user_id).with_for_update())
    locked = (await db.execute(select(Channel).where(Channel.id == channel_id,
        owner_scope_condition(current_user, Channel.user_id)).with_for_update()
        .execution_options(populate_existing=True))).scalar_one_or_none()
    if locked is None:
        raise HTTPException(404, "Channel not found")
    channel = locked
    requested = set(req.item_ids)
    selected = list((await db.execute(select(Item).where(Item.id.in_(requested), Item.user_id == channel.user_id,
        Item.item_type == "playlist").order_by(Item.id).with_for_update())).scalars()) if requested else []
    if {item.id for item in selected} != requested:
        raise HTTPException(400, "Playlists must belong to the channel owner")
    existing = list((await db.execute(select(Item).where(Item.user_id == channel.user_id, Item.item_type == "playlist",
        Item.spotify_id.in_(parsed)).order_by(Item.created_at, Item.id).with_for_update())).scalars()) if parsed else []
    by_spotify = {}
    for item in selected + existing:
        by_spotify.setdefault(item.spotify_id, item)
    jobs = []
    for spotify_id in dict.fromkeys(parsed):
        item = by_spotify.get(spotify_id)
        if item is None:
            item = Item(user_id=channel.user_id, spotify_id=spotify_id, item_type="playlist", group="Channel Playlists", status="pending")
            db.add(item)
            await db.flush()
            jobs.append((make_spotify_job(db, item), spotify_id))
            by_spotify[spotify_id] = item
        selected.append(item)
    await db.execute(delete(ChannelPlaylist).where(ChannelPlaylist.channel_id == channel_id))
    for item_id in {item.id for item in selected}:
        db.add(ChannelPlaylist(channel_id=channel_id, item_id=item_id))
    await db.flush()
    preference, data = await workspace.load_preferences(db, current_user.id)
    if preference:
        workspace.save_preferences(db, current_user.id, preference,
            await workspace.prune_preferences(db, current_user.id, data))
    await db.commit()
    for job, spotify_id in jobs:
        youtube_jobs.track(youtube_jobs.run_spotify_job(job.id, spotify_id))
    return (await channel_responses(db, [channel]))[0]


@router.post("/channels/{channel_id}/playlists/refresh")
async def refresh_playlists(channel_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    channel = await channel_for_actor(db, current_user, channel_id)
    items = list((await db.execute(select(Item).join(ChannelPlaylist, ChannelPlaylist.item_id == Item.id).where(
        ChannelPlaylist.channel_id == channel.id, Item.user_id == channel.user_id, Item.item_type == "playlist",
    ).with_for_update())).scalars())
    jobs = [(make_spotify_job(db, item), item.spotify_id) for item in items if item.status != "crawling"]
    await db.commit()
    for job, spotify_id in jobs:
        youtube_jobs.track(youtube_jobs.run_spotify_job(job.id, spotify_id))
    return {"accepted": len(jobs), "skipped": len(items) - len(jobs), "job_ids": [str(job.id) for job, _ in jobs]}
