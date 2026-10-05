"""Items endpoints — query stored items."""

import asyncio
from collections import defaultdict
from datetime import datetime
import io
import json
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.params import Query as QueryParam
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.crawl_job import CrawlJob
from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.models.user import User
from app.schemas.item import ItemGroupSummary, ItemListResponse, ItemMoveRequest, ItemResponse, ItemSummaryResponse
from app.services.auth import get_current_user, owner_scope_condition
from app.services import spotify_client
from app.utils.spotify_urls import parse_spotify_url

router = APIRouter()


EXPORT_ACTIONS = {
    "listview-excel",
    "playlist-type3",
    "album-type0",
    "track-offline",
    "artist-basic",
}
EXPORT_FORMATS = {"json", "txt", "xlsx"}


class ItemExportRequest(BaseModel):
    action: str
    format: str = "json"
    item_ids: list[str] = Field(default_factory=list)
    deep_fetch: bool = False


def _query_param_value(value):
    return None if isinstance(value, QueryParam) else value


def _apply_item_scope(
    query,
    current_user: User,
    user_id: str | None = None,
    type: str | None = None,
    status: str | None = None,
    group: str | None = None,
    search: str | None = None,
):
    """Apply list-scope filters shared by item and summary endpoints."""
    user_id = _query_param_value(user_id)
    type = _query_param_value(type)
    status = _query_param_value(status)
    group = _query_param_value(group)
    search = _query_param_value(search)

    query = query.where(owner_scope_condition(current_user, Item.user_id))
    if user_id:
        try:
            owner_id = uuid.UUID(str(user_id))
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail="Invalid user_id") from exc
        query = query.where(Item.user_id == owner_id)

    if type:
        query = query.where(Item.item_type == type)
    if status:
        query = query.where(Item.status == status)
    if group:
        query = query.where(Item.group == group)
    if search and search.strip():
        search_text = search.strip()
        pattern = f"%{search_text}%"
        parsed_search = parse_spotify_url(search_text)
        spotify_link_match = (
            and_(
                Item.item_type == parsed_search[0],
                Item.spotify_id == parsed_search[1],
            )
            if parsed_search
            else None
        )
        search_clauses = [
            Item.name.ilike(pattern),
            Item.spotify_id.ilike(pattern),
            Item.owner_name.ilike(pattern),
            Item.group.ilike(pattern),
        ]
        if spotify_link_match is not None:
            search_clauses.insert(0, spotify_link_match)
        query = query.where(
            or_(*search_clauses)
        )
    return query


def _sort_expr_for_key(sort: str | None):
    metric_exprs = {
        "playlistSaves": case((Item.item_type == "playlist", Item.followers), else_=None),
        "playlistCount": case((Item.item_type == "playlist", Item.track_count), else_=None),
        "albumCount": case((Item.item_type == "album", Item.track_count), else_=None),
        "artistFollowers": case((Item.item_type.in_(["artist", "track", "album"]), Item.followers), else_=None),
        "artistListeners": case((Item.item_type.in_(["artist", "track", "album"]), Item.monthly_listeners), else_=None),
        "trackViews": case((Item.item_type == "track", Item.playcount), else_=None),
        "playlistOwner": case((Item.item_type == "playlist", func.lower(Item.owner_name)), else_=None),
        "name": func.lower(Item.name),
        "owner": func.lower(Item.owner_name),
        "updated": Item.updated_at,
        "checked": Item.last_checked,
    }
    return metric_exprs.get(sort or "")


def _load_row_order_keys(user: User) -> list[str]:
    try:
        ui_preferences = getattr(user, "ui_preferences", None)
        parsed = json.loads(ui_preferences) if ui_preferences else {}
    except (json.JSONDecodeError, TypeError):
        return []
    row_order = parsed.get("row_order") if isinstance(parsed, dict) else None
    if not isinstance(row_order, list):
        return []
    keys: list[str] = []
    for value in row_order:
        cleaned = str(value or "").strip()
        if cleaned:
            keys.append(cleaned)
    return keys


def _row_order_uuid_indexes(keys: list[str]) -> dict[uuid.UUID, int]:
    indexes: dict[uuid.UUID, int] = {}
    for idx, key in enumerate(keys):
        candidate = key[3:] if key.startswith("id:") else key
        try:
            item_id = uuid.UUID(candidate)
        except (ValueError, TypeError):
            continue
        if item_id not in indexes:
            indexes[item_id] = idx
    return indexes


def _apply_item_sort(
    query,
    current_user: User,
    total: int = 0,
    sort: str | None = None,
    sort_direction: str | None = None,
    checked_sort: str | None = None,
):
    sort = _query_param_value(sort)
    sort_direction = _query_param_value(sort_direction)
    checked_sort = _query_param_value(checked_sort)
    direction = "asc" if sort_direction == "asc" else "desc"

    if checked_sort and checked_sort != "none":
        status_priority = {
            "error-first": {"error": 0, "crawling": 1, "pending": 2, "active": 3},
            "crawling-first": {"crawling": 0, "pending": 1, "error": 2, "active": 3},
            "active-first": {"active": 0, "crawling": 1, "pending": 2, "error": 3},
        }.get(checked_sort)
        if status_priority:
            priority_expr = case(
                *[(Item.status == status_name, priority) for status_name, priority in status_priority.items()],
                else_=9,
            )
            return query.order_by(priority_expr.asc(), Item.last_checked.desc().nullslast(), Item.updated_at.desc())
        if checked_sort == "oldest-first":
            return query.order_by(Item.last_checked.asc().nullslast(), Item.updated_at.asc())
        if checked_sort == "recent-first":
            return query.order_by(Item.last_checked.desc().nullslast(), Item.updated_at.desc())

    expr = _sort_expr_for_key(sort)
    if expr is not None:
        ordered_expr = expr.asc().nullslast() if direction == "asc" else expr.desc().nullslast()
        return query.order_by(ordered_expr, Item.updated_at.desc())

    row_order_indexes = _row_order_uuid_indexes(_load_row_order_keys(current_user))
    if total and len(row_order_indexes) >= total:
        custom_order_expr = case(row_order_indexes, value=Item.id, else_=len(row_order_indexes))
        return query.order_by(custom_order_expr.asc(), Item.created_at.asc().nullslast(), Item.id.asc())

    return query.order_by(Item.created_at.asc().nullslast(), Item.id.asc())


def _spotify_url(item_type: str, spotify_id: str) -> str:
    return f"https://open.spotify.com/{item_type}/{spotify_id}"


def _extract_owner_url(item: Item, raw_data: dict | None) -> str | None:
    if isinstance(raw_data, dict):
        owner_url = raw_data.get("owner_url")
        if isinstance(owner_url, str) and owner_url.strip():
            return owner_url.strip()

        if item.item_type == "track":
            artists = raw_data.get("artists") or []
            if isinstance(artists, list) and artists:
                first_artist = artists[0] or {}
                artist_id = first_artist.get("spotify_id") or first_artist.get("id")
                if artist_id:
                    return _spotify_url("artist", artist_id)

        if item.item_type == "album":
            artists = raw_data.get("artists") or []
            if isinstance(artists, list) and artists:
                first_artist = artists[0] or {}
                artist_id = first_artist.get("spotify_id") or first_artist.get("id")
                if artist_id:
                    return _spotify_url("artist", artist_id)

            tracks = raw_data.get("tracks") or []
            if isinstance(tracks, list) and tracks:
                first_track = tracks[0] or {}
                track_artists = first_track.get("artists") or []
                if isinstance(track_artists, list) and track_artists:
                    first_artist = track_artists[0] or {}
                    artist_id = first_artist.get("spotify_id") or first_artist.get("id")
                    if artist_id:
                        return _spotify_url("artist", artist_id)

    if item.item_type == "artist":
        return _spotify_url("artist", item.spotify_id)
    return None


def _extract_artist_names(raw_data: dict | None) -> list[str]:
    if not isinstance(raw_data, dict):
        return []

    artist_names = raw_data.get("artist_names")
    if isinstance(artist_names, list):
        return [
            name.strip()
            for name in artist_names
            if isinstance(name, str) and name.strip()
        ]

    artists = raw_data.get("artists")
    if isinstance(artists, list):
        names: list[str] = []
        for artist in artists:
            if not isinstance(artist, dict):
                continue
            name = artist.get("name")
            if isinstance(name, str) and name.strip():
                names.append(name.strip())
        if names:
            return names

    tracks = raw_data.get("tracks")
    if isinstance(tracks, list):
        names: list[str] = []
        seen: set[str] = set()
        for track in tracks:
            if not isinstance(track, dict):
                continue
            nested_artist_names = track.get("artist_names")
            if isinstance(nested_artist_names, list):
                for name in nested_artist_names:
                    if not isinstance(name, str) or not name.strip():
                        continue
                    cleaned = name.strip()
                    lowered = cleaned.lower()
                    if lowered in seen:
                        continue
                    seen.add(lowered)
                    names.append(cleaned)
                continue

            nested_artists = track.get("artists")
            if not isinstance(nested_artists, list):
                continue
            for artist in nested_artists:
                if not isinstance(artist, dict):
                    continue
                name = artist.get("name")
                if not isinstance(name, str) or not name.strip():
                    continue
                cleaned = name.strip()
                lowered = cleaned.lower()
                if lowered in seen:
                    continue
                seen.add(lowered)
                names.append(cleaned)
        if names:
            return names

    return []


def _normalize_artist_name_parts(values: list[str] | None) -> list[str]:
    if not isinstance(values, list):
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        name = value.strip()
        if not name:
            continue
        lowered = name.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(name)
    return normalized


def _split_artist_label(value: str | None) -> list[str]:
    if not isinstance(value, str):
        return []
    return _normalize_artist_name_parts([part.strip() for part in value.split(",")])


def _artist_prefix_candidates(artist_names: list[str]) -> list[str]:
    normalized = _normalize_artist_name_parts(artist_names)
    candidates: list[str] = []
    seen: set[str] = set()

    def append_candidate(candidate: str) -> None:
        text = candidate.strip()
        if not text:
            return
        lowered = text.lower()
        if lowered in seen:
            return
        seen.add(lowered)
        candidates.append(text)

    for separator in (", ", " - "):
        for size in range(len(normalized), 0, -1):
            append_candidate(separator.join(normalized[:size]))
    for name in normalized:
        append_candidate(name)
    return candidates


def _strip_leading_artist_prefix(title: str, artist_names: list[str]) -> str:
    base = _safe_export_text(title) or "-"
    candidates = _artist_prefix_candidates(artist_names)
    if not candidates:
        return base

    while True:
        lowered = base.lower()
        matched = False
        for prefix in candidates:
            marker = f"{prefix} - "
            if lowered.startswith(marker.lower()):
                base = base[len(marker):].strip() or "-"
                matched = True
                break
        if not matched:
            return base


def _build_display_title(artist_names: list[str], title: str, fallback_artist: str = "-") -> str:
    normalized_artists = _normalize_artist_name_parts(artist_names)
    artist_label = ", ".join(normalized_artists)
    if not artist_label:
        artist_label = _safe_export_text(fallback_artist) or "-"
        normalized_artists = _split_artist_label(artist_label)

    normalized_title = _strip_leading_artist_prefix(title, normalized_artists)
    if artist_label == "-":
        return normalized_title
    return f"{artist_label} - {normalized_title}" if normalized_title else f"{artist_label} - -"


def _build_item_display_title(item: Item, raw_data: dict | None) -> str:
    item_type = _safe_export_text(getattr(item, "item_type", ""))
    base_title = _safe_export_text(getattr(item, "name", "")) or "-"
    if item_type not in {"track", "album"}:
        return base_title

    artist_names = _extract_artist_names(raw_data)
    fallback_artist = _safe_export_text(getattr(item, "owner_name", ""))
    return _build_display_title(artist_names, base_title, fallback_artist)


def _build_album_export_tracks(raw_data: dict | None) -> list[dict]:
    if not isinstance(raw_data, dict):
        return []

    tracks = raw_data.get("tracks")
    if not isinstance(tracks, list):
        return []

    export_rows: list[dict] = []
    for track in tracks:
        if not isinstance(track, dict):
            continue

        track_name = track.get("name")
        if not isinstance(track_name, str) or not track_name.strip():
            continue

        artist_names = _extract_artist_names(track)
        spotify_url = track.get("spotify_url")
        if not isinstance(spotify_url, str) or not spotify_url.strip():
            spotify_id = track.get("spotify_id")
            spotify_url = (
                _spotify_url("track", spotify_id.strip())
                if isinstance(spotify_id, str) and spotify_id.strip()
                else None
            )

        export_rows.append(
            {
                "artist_names": ", ".join(artist_names) if artist_names else "-",
                "track_name": track_name.strip(),
                "spotify_url": spotify_url,
                "playcount_estimate": track.get("playcount_estimate"),
            }
        )

    return export_rows


def _normalize_group_name(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    if "::" in text:
        maybe_owner, possible_name = text.split("::", 1)
        try:
            uuid.UUID(maybe_owner.strip())
            text = possible_name.strip()
        except ValueError:
            pass
    return text.lower()


def _format_added_date(value) -> str | None:
    if value is None:
        return None
    return value.strftime("%d/%m %H:%M")


def _compute_delta(current: int | None, previous: int | None) -> int | None:
    if current is None or previous is None:
        return None
    return current - previous


async def _load_latest_raw_data(db: AsyncSession, items: list[Item]) -> dict[str, dict]:
    spotify_ids = list(dict.fromkeys(item.spotify_id for item in items if item.spotify_id))
    if not spotify_ids:
        return {}

    ranked_raw = (
        select(
            RawResponse.spotify_id.label("spotify_id"),
            RawResponse.response_data.label("response_data"),
            func.row_number()
            .over(
                partition_by=RawResponse.spotify_id,
                order_by=RawResponse.captured_at.desc(),
            )
            .label("row_num"),
        )
        .where(RawResponse.spotify_id.in_(spotify_ids))
        .subquery()
    )
    result = await db.execute(
        select(ranked_raw.c.spotify_id, ranked_raw.c.response_data)
        .where(ranked_raw.c.row_num == 1)
    )
    raw_map: dict[str, dict] = {}
    for spotify_id, response_data in result.all():
        if isinstance(response_data, dict):
            raw_map[spotify_id] = response_data
    return raw_map


async def _load_recent_snapshots(db: AsyncSession, items: list[Item]) -> dict:
    item_ids = [item.id for item in items if item.id]
    if not item_ids:
        return {}

    ranked_snapshots = (
        select(
            MetricsSnapshot,
            func.row_number()
            .over(
                partition_by=MetricsSnapshot.item_id,
                order_by=MetricsSnapshot.captured_at.desc(),
            )
            .label("row_num"),
        )
        .where(MetricsSnapshot.item_id.in_(item_ids))
        .subquery()
    )
    result = await db.execute(
        select(MetricsSnapshot)
        .join(
            ranked_snapshots,
            MetricsSnapshot.id == ranked_snapshots.c.id,
        )
        .where(ranked_snapshots.c.row_num <= 2)
        .order_by(MetricsSnapshot.item_id, MetricsSnapshot.captured_at.desc())
    )
    rows = result.scalars().all()

    snapshot_map: dict = defaultdict(list)
    for row in rows:
        bucket = snapshot_map[row.item_id]
        if len(bucket) < 2:
            bucket.append(row)
    return snapshot_map


async def _load_item_users(db: AsyncSession, items: list[Item]) -> dict[str, User]:
    user_ids = [item.user_id for item in items if item.user_id]
    if not user_ids:
        return {}

    result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users = result.scalars().all()
    return {str(user.id): user for user in users}


async def _delete_raw_if_unreferenced(
    db: AsyncSession,
    spotify_ids: list[str],
    excluded_item_ids: list[uuid.UUID] | None = None,
) -> None:
    unique_ids = [sid for sid in dict.fromkeys(spotify_ids) if sid]
    if not unique_ids:
        return

    query = select(Item.spotify_id).where(Item.spotify_id.in_(unique_ids))
    if excluded_item_ids:
        query = query.where(~Item.id.in_(excluded_item_ids))

    # Raw responses cache public upstream payloads shared by every workspace/user.
    remaining_rows = (await db.execute(query.execution_options(skip_item_workspace=True))).all()
    remaining_ids = {row[0] for row in remaining_rows if row and row[0]}
    stale_ids = [sid for sid in unique_ids if sid not in remaining_ids]
    if stale_ids:
        await db.execute(delete(RawResponse).where(RawResponse.spotify_id.in_(stale_ids)))


def _item_to_response(
    item: Item,
    owner_url: str | None = None,
    raw_data: dict | None = None,
    snapshots: list[MetricsSnapshot] | None = None,
    item_user: User | None = None,
) -> ItemResponse:
    """Convert DB Item model to API response schema."""
    duration = None
    if item.duration_ms:
        mins, secs = divmod(item.duration_ms // 1000, 60)
        duration = f"{mins}:{secs:02d}"

    has_total_plays = item.item_type in {"track", "album", "playlist"}
    total_plays = item.playcount if has_total_plays else None
    artist_names = _extract_artist_names(raw_data)
    export_tracks = _build_album_export_tracks(raw_data) if item.item_type == "album" else None

    snapshots = snapshots or []
    latest_snapshot = snapshots[0] if len(snapshots) >= 1 else None
    previous_snapshot = snapshots[1] if len(snapshots) >= 2 else None

    delta_days = None
    if latest_snapshot and previous_snapshot:
        delta_days = max(
            0,
            int((latest_snapshot.captured_at - previous_snapshot.captured_at).total_seconds() // 86400),
        )

    return ItemResponse(
        id=str(item.id),
        spotify_id=item.spotify_id,
        type=item.item_type,
        name=item.name,
        spotify_url=_spotify_url(item.item_type, item.spotify_id),
        image=item.image,
        owner_name=item.owner_name,
        owner_image=item.owner_image,
        owner_url=owner_url,
        artist_names=artist_names or None,
        export_tracks=export_tracks or None,
        followers=item.followers,
        monthly_listeners=item.monthly_listeners,
        monthly_plays=item.monthly_listeners,
        playcount=item.playcount,
        total_plays=total_plays,
        track_count=item.track_count,
        album_count=item.album_count,
        duration=duration,
        release_date=item.release_date,
        saves=item.followers,
        followers_delta=_compute_delta(
            latest_snapshot.followers if latest_snapshot else item.followers,
            previous_snapshot.followers if previous_snapshot else None,
        ),
        monthly_listeners_delta=_compute_delta(
            latest_snapshot.monthly_listeners if latest_snapshot else item.monthly_listeners,
            previous_snapshot.monthly_listeners if previous_snapshot else None,
        ),
        playcount_delta=_compute_delta(
            latest_snapshot.playcount if latest_snapshot else item.playcount,
            previous_snapshot.playcount if previous_snapshot else None,
        ),
        track_count_delta=_compute_delta(
            latest_snapshot.track_count if latest_snapshot else item.track_count,
            previous_snapshot.track_count if previous_snapshot else None,
        ),
        delta_days=delta_days,
        status=item.status,
        error_code=item.error_code,
        error_message=item.error_message,
        group=item.group,
        user_id=str(item.user_id) if item.user_id else None,
        user_name=(item_user.display_name or item_user.username) if item_user else None,
        user_avatar=item_user.avatar if item_user else None,
        added_date=_format_added_date(item.created_at),
        last_checked=item.last_checked,
        created_at=item.created_at,
    )


def _safe_export_text(value) -> str:
    if value is None:
        return ""
    return str(value).replace("\r", " ").replace("\n", " ").strip()


def _format_export_metric(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value)
    return _safe_export_text(value)


def _format_export_updated(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.strftime("%H:%M %d/%m/%Y")


def _build_export_file_name(prefix: str, extension: str) -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    return f"{prefix}-{timestamp}.{extension}"


def _rows_to_tab_text(headers: list[str], rows: list[list[str]]) -> str:
    lines: list[str] = []
    if headers:
        lines.append("\t".join(_safe_export_text(cell) for cell in headers))
    for row in rows:
        lines.append("\t".join(_safe_export_text(cell) for cell in row))
    return "\r\n".join(lines)


def _extract_export_track_url(track: dict, fallback_type: str = "track") -> str:
    if not isinstance(track, dict):
        return ""
    spotify_url = track.get("spotify_url")
    if isinstance(spotify_url, str) and spotify_url.strip():
        return spotify_url.strip()
    spotify_id = track.get("spotify_id") or track.get("id")
    if isinstance(spotify_id, str) and spotify_id.strip():
        return _spotify_url(fallback_type, spotify_id.strip())
    return ""


def _extract_export_track_artists(track: dict, fallback: str = "-") -> str:
    if not isinstance(track, dict):
        return fallback

    artist_names = _extract_artist_names(track)
    if artist_names:
        return ", ".join(artist_names)

    owner_name = track.get("owner_name")
    if isinstance(owner_name, str) and owner_name.strip():
        return owner_name.strip()

    return fallback


def _build_export_track_title(artist_label: str, track_name: str) -> str:
    artist_names = _split_artist_label(artist_label)
    return _build_display_title(artist_names, track_name, artist_label)


def _merge_export_blocks(blocks: list[list[list[str]]]) -> list[list[str]]:
    normalized_blocks = [block for block in blocks if block]
    if not normalized_blocks:
        return []

    widths = [
        max((len(row) for row in block), default=0)
        for block in normalized_blocks
    ]
    height = max((len(block) for block in normalized_blocks), default=0)
    merged_rows: list[list[str]] = []

    for row_index in range(height):
        merged_row: list[str] = []
        for block_index, block in enumerate(normalized_blocks):
            width = widths[block_index]
            raw_row = block[row_index] if row_index < len(block) else []
            padded_row = [
                _safe_export_text(raw_row[column_index]) if column_index < len(raw_row) else ""
                for column_index in range(width)
            ]
            merged_row.extend(padded_row)
        merged_rows.append(merged_row)

    return merged_rows


def _build_artist_basic_rows(
    items: list[Item],
    raw_map: dict[str, dict],
) -> tuple[list[str], list[list[str]], str]:
    headers: list[str] = []
    rows: list[list[str]] = []
    for item in items:
        if item.item_type != "artist":
            continue
        rows.append(
            [
                _safe_export_text(item.name) or "-",
                _spotify_url("artist", item.spotify_id),
                _format_export_metric(item.followers),
                _format_export_metric(item.monthly_listeners),
            ]
        )
    return headers, rows, "spoticheck-artist-basic"


def _extract_playlist_owner(item: Item, raw_data: dict | None) -> str:
    if isinstance(raw_data, dict):
        owner_name = raw_data.get("owner_name")
        if isinstance(owner_name, str) and owner_name.strip():
            return owner_name.strip()
    if isinstance(item.owner_name, str) and item.owner_name.strip():
        return item.owner_name.strip()
    return ""


def _build_listview_export_rows(
    items: list[Item],
    raw_map: dict[str, dict],
    user_map: dict[str, User],
) -> tuple[list[str], list[list[str]], str]:
    headers = [
        "Type",
        "Name",
        "Spotify URL",
        "Group",
        "User",
        "Playlist Owner",
        "Playlist (Save)",
        "Playlist (Count)",
        "Album (Track Count)",
        "Artist (Followers)",
        "Artist (Listeners)",
        "Tracks (Views)",
        "Updated",
    ]
    rows: list[list[str]] = []
    for item in items:
        raw_data = raw_map.get(item.spotify_id)
        item_user = user_map.get(str(item.user_id)) if item.user_id else None
        user_name = ""
        if item_user:
            user_name = item_user.display_name or item_user.username or ""

        rows.append(
            [
                _safe_export_text(item.item_type),
                _build_item_display_title(item, raw_data),
                _spotify_url(item.item_type, item.spotify_id),
                _safe_export_text(item.group),
                _safe_export_text(user_name),
                _safe_export_text(_extract_playlist_owner(item, raw_data)),
                _format_export_metric(item.followers if item.item_type == "playlist" else None),
                _format_export_metric(item.track_count if item.item_type == "playlist" else None),
                _format_export_metric(item.track_count if item.item_type == "album" else None),
                _format_export_metric(item.followers if item.item_type in {"artist", "track", "album"} else None),
                _format_export_metric(item.monthly_listeners if item.item_type in {"artist", "track", "album"} else None),
                _format_export_metric(item.playcount if item.item_type == "track" else None),
                _format_export_updated(item.last_checked or item.created_at),
            ]
        )
    return headers, rows, "spoticheck-listview"


def _build_playlist_type3_rows(
    items: list[Item],
    raw_map: dict[str, dict],
) -> tuple[list[str], list[list[str]], str]:
    headers: list[str] = []
    blocks: list[list[list[str]]] = []
    for item in items:
        if item.item_type != "playlist":
            continue
        block_rows: list[list[str]] = []
        raw_data = raw_map.get(item.spotify_id)
        tracks = raw_data.get("tracks") if isinstance(raw_data, dict) else None
        if isinstance(tracks, list) and tracks:
            for track in tracks:
                if not isinstance(track, dict):
                    continue
                artist_label = _extract_export_track_artists(track)
                track_name = _safe_export_text(track.get("name")) or "-"
                title = _build_export_track_title(artist_label, track_name)
                block_rows.append(
                    [
                        title,
                        _extract_export_track_url(track),
                        _format_export_metric(track.get("playcount_estimate")),
                    ]
                )
        else:
            fallback_artist = _safe_export_text(item.owner_name) or "-"
            fallback_title = _build_export_track_title(fallback_artist, _safe_export_text(item.name) or "-")
            block_rows.append(
                [
                    fallback_title,
                    _spotify_url("playlist", item.spotify_id),
                    _format_export_metric(item.playcount),
                ]
            )
        blocks.append(block_rows)
    return headers, _merge_export_blocks(blocks), "spoticheck-playlist-type3"


def _build_album_type0_rows(
    items: list[Item],
    raw_map: dict[str, dict],
) -> tuple[list[str], list[list[str]], str]:
    headers: list[str] = []
    blocks: list[list[list[str]]] = []
    for item in items:
        if item.item_type != "album":
            continue
        raw_data = raw_map.get(item.spotify_id)
        album_name = _build_item_display_title(item, raw_data)
        block_rows: list[list[str]] = []
        tracks = raw_data.get("tracks") if isinstance(raw_data, dict) else None
        if isinstance(tracks, list) and tracks:
            index = 1
            for track in tracks:
                if not isinstance(track, dict):
                    continue
                track_name = _safe_export_text(track.get("name")) or "-"
                block_rows.append(
                    [
                        album_name,
                        str(index),
                        _build_export_track_title(_extract_export_track_artists(track), track_name),
                        _extract_export_track_url(track),
                        _format_export_metric(track.get("playcount_estimate")),
                    ]
                )
                index += 1
        else:
            fallback_artist = _safe_export_text(item.owner_name) or _safe_export_text(
                ", ".join(_extract_artist_names(raw_data))
            ) or "-"
            block_rows.append(
                [
                    album_name,
                    "1",
                    _build_export_track_title(fallback_artist, _safe_export_text(item.name) or "-"),
                    _spotify_url("album", item.spotify_id),
                    _format_export_metric(item.playcount),
                ]
            )
        blocks.append(block_rows)
    return headers, _merge_export_blocks(blocks), "spoticheck-album-type0"


def _build_track_offline_rows(
    items: list[Item],
    raw_map: dict[str, dict],
) -> tuple[list[str], list[list[str]], str]:
    headers: list[str] = []
    rows: list[list[str]] = []
    for item in items:
        if item.item_type != "track":
            continue
        raw_data = raw_map.get(item.spotify_id)
        artist_names = _extract_artist_names(raw_data)
        artist_label = ", ".join(artist_names) if artist_names else (_safe_export_text(item.owner_name) or "-")
        track_name = _build_item_display_title(item, raw_data)
        rows.append(
            [
                _build_export_track_title(artist_label, track_name),
                _spotify_url("track", item.spotify_id),
                _format_export_metric(item.playcount),
                _format_export_metric(item.monthly_listeners),
            ]
        )
    return headers, rows, "spoticheck-track-offline"


def _build_export_rows(
    action: str,
    items: list[Item],
    raw_map: dict[str, dict],
    user_map: dict[str, User],
) -> tuple[list[str], list[list[str]], str]:
    if action == "listview-excel":
        return _build_listview_export_rows(items, raw_map, user_map)
    if action == "playlist-type3":
        return _build_playlist_type3_rows(items, raw_map)
    if action == "album-type0":
        return _build_album_type0_rows(items, raw_map)
    if action == "track-offline":
        return _build_track_offline_rows(items, raw_map)
    if action == "artist-basic":
        return _build_artist_basic_rows(items, raw_map)
    raise HTTPException(status_code=400, detail="Unsupported export action")


async def _hydrate_raw_for_export(
    action: str,
    items: list[Item],
    raw_map: dict[str, dict],
    deep_fetch: bool,
) -> dict[str, dict]:
    if not deep_fetch:
        return raw_map
    if action not in {"playlist-type3", "album-type0"}:
        return raw_map

    target_items: list[Item] = []
    for item in items:
        raw_data = raw_map.get(item.spotify_id)
        tracks = raw_data.get("tracks") if isinstance(raw_data, dict) else None
        expected = raw_data.get("tracks_expected") if isinstance(raw_data, dict) else None
        if expected is None and isinstance(raw_data, dict):
            expected = raw_data.get("track_count")
        try:
            expected_count = int(expected) if expected is not None else None
        except (TypeError, ValueError):
            expected_count = None
        tracks_complete = isinstance(tracks, list) and (
            bool(raw_data.get("deep_crawl_complete"))
            if isinstance(raw_data, dict) and expected_count is None
            else expected_count is not None and len(tracks) >= expected_count
        )
        if tracks_complete:
            continue
        if action == "playlist-type3" and item.item_type == "playlist":
            target_items.append(item)
        if action == "album-type0" and item.item_type == "album":
            target_items.append(item)

    if not target_items:
        return raw_map

    semaphore = asyncio.Semaphore(4)

    async def fetch_one(target: Item) -> tuple[str, dict | None]:
        async with semaphore:
            if action == "playlist-type3":
                data = await spotify_client.fetch_playlist(target.spotify_id)
            else:
                data = await spotify_client.fetch_album(target.spotify_id)
            if isinstance(data, dict) and not data.get("error"):
                return target.spotify_id, data
            return target.spotify_id, None

    results = await asyncio.gather(
        *(fetch_one(target) for target in target_items),
        return_exceptions=True,
    )

    for result in results:
        if isinstance(result, Exception):
            continue
        spotify_id, payload = result
        if isinstance(payload, dict):
            raw_map[spotify_id] = payload

    return raw_map


def _build_xlsx_stream(headers: list[str], rows: list[list[str]]) -> io.BytesIO:
    try:
        from openpyxl import Workbook
        from openpyxl.utils import get_column_letter
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="openpyxl is required for XLSX export",
        ) from exc

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Export"

    if headers:
        worksheet.append([_safe_export_text(cell) for cell in headers])
    for row in rows:
        worksheet.append([_safe_export_text(cell) for cell in row])

    for col_idx, column in enumerate(worksheet.columns, start=1):
        max_length = 0
        for cell in column:
            value = cell.value
            if value is None:
                continue
            max_length = max(max_length, len(str(value)))
        worksheet.column_dimensions[get_column_letter(col_idx)].width = min(max(max_length + 2, 12), 64)

    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


@router.get("/items", response_model=ItemListResponse)
async def list_items(
    type: str | None = Query(None, description="Filter by item type"),
    group: str | None = Query(None, description="Filter by group"),
    status: str | None = Query(None, description="Filter by status"),
    user_id: str | None = Query(None, description="Optional own account ID; other IDs return no items"),
    search: str | None = Query(None, description="Search by title, owner, group, or Spotify ID"),
    sort: str | None = Query(None, description="Sort key"),
    sort_direction: str | None = Query(None, description="Sort direction"),
    checked_sort: str | None = Query(None, description="Checked/status sort mode"),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all items with optional filters."""
    query = select(Item)
    query = _apply_item_scope(query, current_user, user_id, type, status, group, search)

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = _apply_item_sort(query, current_user, total, sort, sort_direction, checked_sort)

    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    result = await db.execute(query)
    items = result.scalars().all()
    raw_map = await _load_latest_raw_data(db, items)
    snapshot_map = await _load_recent_snapshots(db, items)
    user_map = await _load_item_users(db, items)

    return ItemListResponse(
        items=[
            _item_to_response(
                item,
                _extract_owner_url(item, raw_map.get(item.spotify_id)),
                raw_map.get(item.spotify_id),
                snapshot_map.get(item.id),
                user_map.get(str(item.user_id)) if item.user_id else None,
            )
            for item in items
        ],
        total=total,
    )


@router.get("/items/summary", response_model=ItemSummaryResponse)
async def item_summary(
    type: str | None = Query(None, description="Filter by item type"),
    group: str | None = Query(None, description="Active group filter"),
    user_id: str | None = Query(None, description="Filter by accessible user"),
    search: str | None = Query(None, description="Search by title, owner, group, or Spotify ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return fast counts for large paged list views."""
    base_query = _apply_item_scope(select(Item), current_user, user_id, type, search=search)
    scoped_query = _apply_item_scope(select(Item), current_user, user_id, type, group=group, search=search)

    scoped_subquery = scoped_query.subquery()
    base_subquery = base_query.subquery()
    total_result = await db.execute(select(func.count()).select_from(scoped_subquery))
    all_total_result = await db.execute(select(func.count()).select_from(base_subquery))

    status_rows = await db.execute(
        select(scoped_subquery.c.status, func.count())
        .select_from(scoped_subquery)
        .group_by(scoped_subquery.c.status)
    )
    status_counts = {status_name or "": int(count or 0) for status_name, count in status_rows.all()}

    group_rows = await db.execute(
        select(base_subquery.c.group, func.count())
        .select_from(base_subquery)
        .where(base_subquery.c.group.is_not(None), base_subquery.c.group != "")
        .group_by(base_subquery.c.group)
        .order_by(base_subquery.c.group.asc())
    )

    return ItemSummaryResponse(
        total=int(total_result.scalar() or 0),
        all_total=int(all_total_result.scalar() or 0),
        active=status_counts.get("active", 0),
        errors=status_counts.get("error", 0),
        crawling=status_counts.get("crawling", 0) + status_counts.get("pending", 0),
        groups=[
            ItemGroupSummary(name=str(group_name), count=int(count or 0))
            for group_name, count in group_rows.all()
            if group_name
        ],
    )


@router.post("/items/move")
async def move_items_group(
    payload: ItemMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Move a batch of stored items into a new group (or clear the group)."""
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids is required")

    target_group = (payload.group or "").strip() or None
    target_query = select(Item).where(Item.id.in_(payload.item_ids))

    target_query = _apply_item_scope(target_query, current_user, payload.user_id)

    result = await db.execute(target_query)
    items = result.scalars().all()

    if not items:
        raise HTTPException(status_code=404, detail="No matching items found")

    moved = 0
    for item in items:
        item.group = target_group
        moved += 1

    await db.commit()
    return {"ok": True, "moved": moved, "group": target_group}


@router.get("/items/{item_type}/{spotify_id}", response_model=ItemResponse)
async def get_item(
    item_type: str,
    spotify_id: str,
    user_id: str | None = Query(None, description="Target accessible user"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific item by type and Spotify ID."""
    query = select(Item).where(
        Item.spotify_id == spotify_id,
        Item.item_type == item_type,
    )
    user_id = _query_param_value(user_id)
    query = _apply_item_scope(query, current_user, user_id)

    result = await db.execute(query.order_by(Item.updated_at.desc()))
    rows = result.scalars().all()
    if current_user.role in {"admin", "manager"} and not user_id and len(rows) > 1:
        raise HTTPException(
            status_code=409,
            detail="Multiple users track this link. Specify user_id.",
        )
    item = rows[0] if rows else None
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    raw_map = await _load_latest_raw_data(db, [item])
    snapshot_map = await _load_recent_snapshots(db, [item])
    user_map = await _load_item_users(db, [item])
    return _item_to_response(
        item,
        _extract_owner_url(item, raw_map.get(item.spotify_id)),
        raw_map.get(item.spotify_id),
        snapshot_map.get(item.id),
        user_map.get(str(item.user_id)) if item.user_id else None,
    )


@router.patch("/items/group")
async def rename_group(
    old_group: str = Query(..., description="Current group name"),
    new_group: str | None = Query(None, description="New group name (empty = clear group)"),
    user_id: str | None = Query(None, description="Target accessible user"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rename or clear a group for one user and persist item.group in DB."""
    old_clean = old_group.strip()
    new_clean = (new_group or "").strip()
    if not old_clean:
        raise HTTPException(status_code=400, detail="old_group is required")
    next_group = new_clean or None
    old_norm = _normalize_group_name(old_clean)

    target_user_id = current_user.id
    user_id = _query_param_value(user_id)
    if user_id:
        try:
            target_user_id = uuid.UUID(str(user_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid user_id") from exc

    query = select(Item).where(Item.group.is_not(None))
    query = _apply_item_scope(query, current_user, target_user_id)

    items = (await db.execute(query)).scalars().all()
    updated = 0
    for item in items:
        if _normalize_group_name(item.group) != old_norm:
            continue
        item.group = next_group
        updated += 1

    await db.commit()

    return {
        "ok": True,
        "updated": int(updated),
        "old_group": old_clean,
        "new_group": next_group,
    }


@router.delete("/items/{item_type}/{spotify_id}")
async def delete_item(
    item_type: str,
    spotify_id: str,
    user_id: str | None = Query(None, description="Target accessible user"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single item by type + Spotify ID."""
    query = select(Item).where(
        Item.spotify_id == spotify_id,
        Item.item_type == item_type,
    )
    user_id = _query_param_value(user_id)
    query = _apply_item_scope(query, current_user, user_id)

    result = await db.execute(query.order_by(Item.updated_at.desc()))
    rows = result.scalars().all()
    if current_user.role in {"admin", "manager"} and not user_id and len(rows) > 1:
        raise HTTPException(
            status_code=409,
            detail="Multiple users track this link. Specify user_id.",
        )
    item = rows[0] if rows else None
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id == item.id))
    await db.execute(delete(CrawlJob).where(CrawlJob.item_id == item.id))
    await db.delete(item)
    await _delete_raw_if_unreferenced(db, [item.spotify_id], excluded_item_ids=[item.id])
    await db.commit()
    return {"ok": True, "deleted": 1}


@router.delete("/items-by-id/{item_id}")
async def delete_item_by_id(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single item by row id (safe when duplicate links exist)."""
    try:
        item_uuid = uuid.UUID(str(item_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid item_id") from exc

    result = await db.execute(_apply_item_scope(
        select(Item).where(Item.id == item_uuid), current_user,
    ))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id == item.id))
    await db.execute(delete(CrawlJob).where(CrawlJob.item_id == item.id))
    await db.delete(item)
    await _delete_raw_if_unreferenced(db, [item.spotify_id], excluded_item_ids=[item.id])
    await db.commit()
    return {"ok": True, "deleted": 1}


@router.delete("/items")
async def clear_items(
    group: str | None = Query(None, description="Optional group to clear"),
    user_id: str | None = Query(None, description="Filter by accessible user"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear all items (or items in one group)."""
    selected_items = select(Item.id, Item.spotify_id)

    group = _query_param_value(group)
    selected_items = _apply_item_scope(selected_items, current_user, user_id, group=group)

    rows = (await db.execute(selected_items)).all()
    if not rows:
        return {"ok": True, "deleted": 0, "group": group}

    item_ids = [row[0] for row in rows]
    spotify_ids = [row[1] for row in rows]

    await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id.in_(item_ids)))
    await db.execute(delete(CrawlJob).where(CrawlJob.item_id.in_(item_ids)))
    result = await db.execute(delete(Item).where(Item.id.in_(item_ids)))
    await _delete_raw_if_unreferenced(db, spotify_ids, excluded_item_ids=item_ids)
    await db.commit()
    return {"ok": True, "deleted": result.rowcount or 0, "group": group}


@router.post("/items/export")
async def export_items(
    payload: ItemExportRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    action = _safe_export_text(payload.action).lower()
    output_format = _safe_export_text(payload.format).lower() or "json"
    if action not in EXPORT_ACTIONS:
        raise HTTPException(status_code=400, detail="Unsupported export action")
    if output_format not in EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail="Unsupported export format")

    ordered_item_ids: list[str] = []
    ordered_item_uuids: list[uuid.UUID] = []
    seen_ids: set[str] = set()
    for raw_item_id in payload.item_ids:
        item_id = _safe_export_text(raw_item_id)
        if not item_id or item_id in seen_ids:
            continue
        try:
            parsed = uuid.UUID(item_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid item id: {item_id}") from exc
        seen_ids.add(item_id)
        ordered_item_ids.append(item_id)
        ordered_item_uuids.append(parsed)

    if not ordered_item_uuids:
        raise HTTPException(status_code=400, detail="No item_ids provided")

    query = select(Item).where(Item.id.in_(ordered_item_uuids))
    query = _apply_item_scope(query, current_user)
    result = await db.execute(query)
    rows = result.scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="No items found for export")

    item_map = {str(item.id): item for item in rows}
    items: list[Item] = [item_map[item_id] for item_id in ordered_item_ids if item_id in item_map]
    if not items:
        raise HTTPException(status_code=404, detail="No exportable items found")
    if len(items) < len(ordered_item_ids):
        raise HTTPException(status_code=404, detail="Some items were not found or not authorized")

    raw_map = await _load_latest_raw_data(db, items)
    raw_map = await _hydrate_raw_for_export(action, items, raw_map, bool(payload.deep_fetch))
    user_map = await _load_item_users(db, items)
    headers, export_rows, file_prefix = _build_export_rows(action, items, raw_map, user_map)

    if output_format == "json":
        return {
            "ok": True,
            "action": action,
            "headers": headers,
            "rows": export_rows,
            "count": len(export_rows),
            "file_prefix": file_prefix,
        }

    if output_format == "txt":
        text_content = _rows_to_tab_text(headers, export_rows)
        file_name = _build_export_file_name(file_prefix, "txt")
        response_headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
        return StreamingResponse(
            io.BytesIO(text_content.encode("utf-8-sig")),
            media_type="text/plain; charset=utf-8",
            headers=response_headers,
        )

    if output_format == "xlsx":
        stream = _build_xlsx_stream(headers, export_rows)
        file_name = _build_export_file_name(file_prefix, "xlsx")
        response_headers = {"Content-Disposition": f'attachment; filename="{file_name}"'}
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=response_headers,
        )

    raise HTTPException(status_code=400, detail="Unsupported export format")
