"""Small YouTube Data API v3 client."""

from __future__ import annotations

import asyncio
import random
import string
from collections.abc import Sequence
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ytm.config import settings
from app.ytm.models.api_key import ApiKey
from app.ytm.utils.youtube_urls import ParsedYouTubeChannel


YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
CHANNELS_LIST_BATCH_SIZE = 50

_youtube_http_client: httpx.AsyncClient | None = None
_youtube_http_client_lock = asyncio.Lock()


class YouTubeApiError(RuntimeError):
    pass


def _to_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _youtube_banner_url(value: str | None) -> str | None:
    if not value:
        return None
    url = value.strip()
    if not url.startswith("http"):
        return None
    if "=w" in url or "-fcrop64=" in url:
        return url
    return f"{url}=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj"


async def get_active_api_keys(db: AsyncSession, user_id: str | None = None) -> list[ApiKey]:
    if not user_id:
        return []
    import uuid
    from app.models.user import User as SharedUser
    from app.models.youtube import YouTubeApiKey
    owner_id = uuid.UUID(user_id)
    result = await db.execute(select(YouTubeApiKey).join(SharedUser, SharedUser.id == YouTubeApiKey.user_id)
        .where(YouTubeApiKey.user_id == owner_id, SharedUser.is_active.is_(True)).order_by(YouTubeApiKey.position))
    return list(result.scalars().all())


async def get_random_api_key(db: AsyncSession) -> ApiKey:
    keys = await get_active_api_keys(db)
    if not keys:
        raise YouTubeApiError("No YouTube API key configured")
    return random.choice(keys)


async def get_youtube_http_client() -> httpx.AsyncClient:
    global _youtube_http_client
    async with _youtube_http_client_lock:
        if _youtube_http_client is None or _youtube_http_client.is_closed:
            _youtube_http_client = httpx.AsyncClient(timeout=settings.YOUTUBE_HTTP_TIMEOUT_SECONDS)
    return _youtube_http_client


async def close_youtube_http_client() -> None:
    global _youtube_http_client
    if _youtube_http_client is not None and not _youtube_http_client.is_closed:
        await _youtube_http_client.aclose()
    _youtube_http_client = None


async def _request(
    path: str,
    params: dict,
    api_key: str,
    client: httpx.AsyncClient | None = None,
) -> dict:
    request_params = dict(params)
    request_params["key"] = api_key
    request_client = client or await get_youtube_http_client()
    try:
        res = await request_client.get(f"{YOUTUBE_API_BASE}/{path}", params=request_params)
    except httpx.HTTPError:
        raise YouTubeApiError("YouTube network request failed") from None
    if res.status_code != 200:
        detail = res.text[:500].replace(api_key, "[redacted]")
        try:
            payload = res.json()
            detail = payload.get("error", {}).get("message") or detail
        except ValueError:
            pass
        raise YouTubeApiError(str(detail).replace(api_key, "[redacted]"))
    return res.json()


async def check_api_key(api_key: str) -> tuple[bool, str | None]:
    query = "".join(random.choice(string.ascii_letters) for _ in range(5))
    try:
        await _request(
            "search",
            {"part": "snippet", "q": query, "maxResults": 1, "type": "channel"},
            api_key,
        )
        return True, None
    except Exception as exc:
        return False, str(exc)


def _chunked(values: Sequence[str], size: int) -> list[list[str]]:
    return [list(values[index:index + size]) for index in range(0, len(values), size)]


def _channel_result(item: dict, payload: dict) -> dict:
    snippet = item.get("snippet") or {}
    stats = item.get("statistics") or {}
    branding = item.get("brandingSettings") or {}
    branding_image = branding.get("image") or {}
    thumbnails = snippet.get("thumbnails") or {}
    thumb = thumbnails.get("high") or thumbnails.get("medium") or thumbnails.get("default") or {}

    return {
        "youtube_id": item.get("id"),
        "name": snippet.get("title"),
        "image": thumb.get("url"),
        "banner_image": _youtube_banner_url(branding_image.get("bannerExternalUrl")),
        "video_count": _to_int(stats.get("videoCount")),
        "subscriber_count": _to_int(stats.get("subscriberCount")),
        "view_count": _to_int(stats.get("viewCount")),
        "raw": payload,
        "checked_at": datetime.utcnow(),
    }


async def fetch_channels_by_ids(
    channel_ids: Sequence[str],
    api_key: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, dict]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for channel_id in channel_ids:
        value = str(channel_id or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        cleaned.append(value)
    if not cleaned:
        return {}

    request_client = client or await get_youtube_http_client()
    results: dict[str, dict] = {}
    for chunk in _chunked(cleaned, CHANNELS_LIST_BATCH_SIZE):
        payload = await _request(
            "channels",
            {
                "part": "snippet,statistics,brandingSettings",
                "id": ",".join(chunk),
            },
            api_key,
            client=request_client,
        )
        for item in payload.get("items") or []:
            youtube_id = item.get("id")
            if youtube_id:
                results[youtube_id] = _channel_result(item, payload)
    return results


async def fetch_channel(parsed: ParsedYouTubeChannel, api_key: str) -> dict:
    client = await get_youtube_http_client()
    if parsed.query_type == "id":
        data_by_id = await fetch_channels_by_ids([parsed.query], api_key, client=client)
        data = data_by_id.get(parsed.query)
        if not data:
            raise YouTubeApiError("Channel not found")
        return data

    params: dict[str, str | int] = {
        "part": "snippet,statistics,brandingSettings",
        "maxResults": 1,
    }
    if parsed.query_type == "handle":
        params["forHandle"] = parsed.query if parsed.query.startswith("@") else f"@{parsed.query}"
    elif parsed.query_type == "username":
        params["forUsername"] = parsed.query
    else:
        search = await _request(
            "search",
            {"part": "snippet", "q": parsed.query, "maxResults": 1, "type": "channel"},
            api_key,
            client=client,
        )
        items = search.get("items") or []
        channel_id = ((items[0].get("id") or {}).get("channelId")) if items else None
        if not channel_id:
            raise YouTubeApiError("Could not resolve channel from URL")
        params["id"] = channel_id

    payload = await _request("channels", params, api_key, client=client)
    items = payload.get("items") or []
    if not items:
        raise YouTubeApiError("Channel not found")
    return _channel_result(items[0], payload)
