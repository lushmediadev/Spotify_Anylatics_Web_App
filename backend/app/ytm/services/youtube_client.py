"""Small YouTube Data API v3 client."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.youtube import _http_error as classify_http_error
from app.ytm.config import settings
from app.ytm.utils.youtube_urls import ParsedYouTubeChannel


YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
CHANNELS_LIST_BATCH_SIZE = 50

_youtube_http_client: httpx.AsyncClient | None = None
_youtube_http_client_lock = asyncio.Lock()


# Error codes (shared classification with app.services.youtube._http_error)
# that are specific to the key or transient, so the next system key may succeed.
# Everything else (channel not found, bad request/input, invalid response,
# unexpected errors) is a property of the request and must not burn more quota.
ROTATABLE_ERROR_CODES = frozenset({
    "invalid_key", "quota_exceeded", "rate_limited", "forbidden",
    "network_error", "api_unavailable",
})


class YouTubeApiError(RuntimeError):
    def __init__(self, message: str, code: str = "api_error"):
        super().__init__(message)
        self.code = code

    @property
    def rotatable(self) -> bool:
        return self.code in ROTATABLE_ERROR_CODES


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


async def get_active_api_keys(db: AsyncSession) -> list:
    """Every account refreshes with the admin-managed system key pool."""
    from app.services.youtube_keys import system_api_key_rows
    return [key for key, _ in await system_api_key_rows(db)]


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
    request_client = client or await get_youtube_http_client()
    try:
        # Credentials stay out of URLs: httpx logs request URLs at INFO.
        res = await request_client.get(
            f"{YOUTUBE_API_BASE}/{path}", params=dict(params), headers={"X-Goog-Api-Key": api_key},
        )
    except httpx.HTTPError:
        raise YouTubeApiError("YouTube network request failed", "network_error") from None
    if res.status_code != 200:
        code = classify_http_error(res)
        if code == "api_error" and res.status_code == 400:
            # Plain 400 (badRequest/invalidParameter) is about the input, not the key;
            # key problems arrive as 400 + keyInvalid and are classified above.
            code = "invalid_query"
        detail = res.text[:500].replace(api_key, "[redacted]")
        try:
            payload = res.json()
            error = payload.get("error") if isinstance(payload, dict) else None
            detail = (error.get("message") if isinstance(error, dict) else None) or detail
        except ValueError:
            pass
        raise YouTubeApiError(str(detail).replace(api_key, "[redacted]"), code)
    try:
        payload = res.json()
    except ValueError:
        raise YouTubeApiError("YouTube API returned an invalid response", "invalid_response") from None
    if not isinstance(payload, dict):
        raise YouTubeApiError("YouTube API returned an invalid response", "invalid_response")
    return payload


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
            raise YouTubeApiError("Channel not found", "channel_not_found")
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
            raise YouTubeApiError("Could not resolve channel from URL", "channel_not_found")
        params["id"] = channel_id

    payload = await _request("channels", params, api_key, client=client)
    items = payload.get("items") or []
    if not items:
        raise YouTubeApiError("Channel not found", "channel_not_found")
    return _channel_result(items[0], payload)
