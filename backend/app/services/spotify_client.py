"""Spotify API client with resilient public-data fallbacks."""

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings
from app.services import spotify_web_scraper
from app.services.auth_manager import get_auth_headers, invalidate_tokens
from app.services.rate_limiter import rate_limit

logger = logging.getLogger(__name__)
SPOTIFY_WEB_API = "https://api.spotify.com/v1"
SPOTIFY_PATHFINDER_API = "https://api-partner.spotify.com/pathfinder/v1/query"
SPOTIFY_OPEN = "https://open.spotify.com"
_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_PLAYLIST_TRACK_FIELDS = (
    "items(added_at,track(id,name,duration_ms,popularity,preview_url,explicit,track_number,"
    "artists(id,name),album(id,name,release_date,images),external_urls(spotify))),"
    "total,limit,offset,next"
)
_PATHFINDER_QUERY_PLAYLIST_HASH = "2888863ae48f035d0177d73c88f389e7946a95d49a8883a26e86aebd02f2ed24"
_PATHFINDER_QUERY_TRACK_HASH = "cc31bfe16d74df1e9f6f880a908bb3880674deca34c8b67576ecbf8246e967ba"
_PATHFINDER_QUERY_ALBUM_HASH = "ce390dbf7ca6b61a23aec210619e1094fe9d23d7f101ff773ce1146f84d4dd10"
_PATHFINDER_QUERY_ARTIST_HASH = "a55d895740a6ea09d6f34a39ee6a1e8a4c66c6889361710bd01560d1c314f1f4"


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _spotify_uri_to_id(uri: str | None) -> str | None:
    if not uri or not isinstance(uri, str):
        return None
    parts = uri.split(":")
    if len(parts) >= 3:
        return parts[-1]
    return None


def _first_image_from_sources(sources: list[dict[str, Any]] | None) -> str | None:
    if not sources:
        return None
    first = sources[0] or {}
    return first.get("url")


def _append_crawl_mode(base_mode: str | None, suffix: str) -> str:
    if not base_mode:
        return suffix
    if suffix in base_mode:
        return base_mode
    return f"{base_mode}+{suffix}"


def _normalize_name_parts(values: list[str] | None) -> list[str]:
    if not isinstance(values, list):
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        name = raw.strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(name)
    return normalized


def _format_album_display_name(album_name: str | None, artist_names: list[str] | None) -> str | None:
    base = (album_name or "").strip()
    if not base:
        return None
    artists = _normalize_name_parts(artist_names)
    if not artists:
        return base
    prefix = " - ".join(artists)
    lower_prefix = prefix.lower()
    if base.lower().startswith(f"{lower_prefix} - "):
        return base
    return f"{prefix} - {base}"


async def _consume_scrape_task(task: asyncio.Task | None, label: str) -> dict[str, Any] | None:
    if task is None:
        return None
    try:
        return await task
    except Exception as ex:
        logger.warning("Playwright %s scrape task failed: %s", label, ex)
        return None


def _cancel_scrape_task(task: asyncio.Task | None) -> None:
    if task is None:
        return
    if task.done():
        return
    task.cancel()


async def _apply_track_playwright_fallback(
    track_id: str,
    result: dict[str, Any],
    scraped_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not settings.PLAYWRIGHT_ENABLE_FALLBACK:
        return result
    if result.get("error"):
        return result

    needs_playcount = result.get("playcount") is None
    needs_duration = result.get("duration_ms") is None
    should_compare_visible_playcount = bool(settings.PLAYWRIGHT_COMPARE_VISIBLE_PLAYCOUNT)
    if not (needs_playcount or needs_duration or should_compare_visible_playcount):
        return result

    scraped = scraped_data or await spotify_web_scraper.scrape_track_stats(track_id)
    if not scraped:
        return result

    merged = dict(result)
    scraped_playcount = scraped.get("playcount")
    if scraped_playcount is not None:
        # Prefer visible playcount from open.spotify page when available.
        if needs_playcount or merged.get("playcount") != scraped_playcount:
            merged["playcount"] = scraped_playcount
    if needs_duration and scraped.get("duration_ms") is not None:
        merged["duration_ms"] = scraped.get("duration_ms")
    if merged.get("name") in (None, "") and scraped.get("name"):
        merged["name"] = scraped.get("name")
    if scraped_playcount is not None or scraped.get("duration_ms") is not None:
        merged["crawl_mode"] = _append_crawl_mode(merged.get("crawl_mode"), "playwright")
    return merged


async def _apply_artist_playwright_fallback(
    artist_id: str,
    result: dict[str, Any],
    scraped_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not settings.PLAYWRIGHT_ENABLE_FALLBACK:
        return result
    if result.get("error"):
        return result
    if result.get("monthly_listeners") is not None and result.get("followers") is not None:
        return result

    scraped = scraped_data or await spotify_web_scraper.scrape_artist_stats(artist_id)
    if not scraped:
        return result

    merged = dict(result)
    if merged.get("monthly_listeners") is None and scraped.get("monthly_listeners") is not None:
        merged["monthly_listeners"] = scraped.get("monthly_listeners")
    if merged.get("followers") is None and scraped.get("followers") is not None:
        merged["followers"] = scraped.get("followers")
    if merged.get("name") in (None, "") and scraped.get("name"):
        merged["name"] = scraped.get("name")
    if merged.get("owner_name") in (None, "") and scraped.get("owner_name"):
        merged["owner_name"] = scraped.get("owner_name")
    if (
        scraped.get("monthly_listeners") is not None
        or scraped.get("followers") is not None
    ):
        merged["crawl_mode"] = _append_crawl_mode(merged.get("crawl_mode"), "playwright")
    return merged


async def _apply_album_playwright_fallback(
    album_id: str,
    result: dict[str, Any],
    scraped_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not settings.PLAYWRIGHT_ENABLE_FALLBACK:
        return result
    if result.get("error"):
        return result
    if result.get("playcount") is not None or result.get("total_plays") is not None:
        return result

    expected_tracks = _safe_int(result.get("track_count"))
    seed_track_ids: list[str] | None = None
    track_rows = result.get("tracks")
    if isinstance(track_rows, list):
        seed_track_ids = [
            row.get("spotify_id")
            for row in track_rows
            if isinstance(row, dict) and isinstance(row.get("spotify_id"), str)
        ]
    scraped = scraped_data or await spotify_web_scraper.scrape_album_stats(
        album_id,
        expected_tracks=expected_tracks,
        seed_track_ids=seed_track_ids,
    )
    if not scraped:
        return result

    merged = dict(result)
    if scraped.get("playcount") is not None:
        merged["playcount"] = scraped.get("playcount")
        merged["total_plays"] = scraped.get("playcount")
    if merged.get("track_count") is None and scraped.get("track_count") is not None:
        merged["track_count"] = scraped.get("track_count")
    if scraped.get("tracks_crawled") is not None:
        merged["tracks_crawled"] = scraped.get("tracks_crawled")
    if scraped.get("tracks_expected") is not None:
        merged["tracks_expected"] = scraped.get("tracks_expected")
    if scraped.get("tracks_with_playcount") is not None:
        merged["tracks_with_playcount"] = scraped.get("tracks_with_playcount")
    if merged.get("name") in (None, "") and scraped.get("name"):
        merged["name"] = scraped.get("name")
    if merged.get("owner_name") in (None, "") and scraped.get("owner_name"):
        merged["owner_name"] = scraped.get("owner_name")
    merged["name"] = _format_album_display_name(merged.get("name"), merged.get("artist_names")) or merged.get("name")
    merged["crawl_mode"] = _append_crawl_mode(merged.get("crawl_mode"), "playwright")
    return merged


async def _get_json(path: str, params: dict[str, Any] | None = None) -> tuple[int, dict[str, Any] | None]:
    try:
        headers = await get_auth_headers()
    except Exception as ex:
        logger.warning("Auth headers unavailable for %s: %s", path, ex)
        return 0, None

    await rate_limit()
    async with httpx.AsyncClient(timeout=settings.SPOTIFY_HTTP_TIMEOUT_SECONDS) as client:
        res = await client.get(f"{SPOTIFY_WEB_API}{path}", headers=headers, params=params)

    if res.status_code == 401:
        await invalidate_tokens()
        return 401, None

    if res.status_code in (403, 404):
        return res.status_code, None

    if res.status_code == 429:
        retry_after = res.headers.get("Retry-After")
        logger.warning("Spotify Web API rate-limited for %s (Retry-After=%s)", path, retry_after)
        return 429, None

    if res.status_code != 200:
        logger.warning("Spotify request failed: %s %s", path, res.status_code)
        return res.status_code, None

    try:
        return 200, res.json()
    except Exception as ex:
        logger.warning("Invalid JSON from Spotify for %s: %s", path, ex)
        return 502, None


async def _get_pathfinder_json(payload: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
    try:
        headers = await get_auth_headers()
    except Exception as ex:
        logger.warning("Auth headers unavailable for Pathfinder request: %s", ex)
        return 0, None

    req_headers = {
        "Authorization": headers.get("Authorization", ""),
        "User-Agent": headers.get("User-Agent", _DEFAULT_UA),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.SPOTIFY_CLIENT_TOKEN:
        req_headers["client-token"] = settings.SPOTIFY_CLIENT_TOKEN

    await rate_limit()
    async with httpx.AsyncClient(timeout=settings.SPOTIFY_HTTP_TIMEOUT_SECONDS) as client:
        res = await client.post(SPOTIFY_PATHFINDER_API, headers=req_headers, json=payload)

    if res.status_code == 401:
        await invalidate_tokens()
        return 401, None

    if res.status_code in (403, 404):
        return res.status_code, None

    if res.status_code == 429:
        retry_after = res.headers.get("Retry-After")
        logger.warning("Spotify Pathfinder rate-limited (Retry-After=%s)", retry_after)
        return 429, None

    if res.status_code != 200:
        logger.warning("Spotify Pathfinder request failed: %s", res.status_code)
        return res.status_code, None

    try:
        return 200, res.json()
    except Exception as ex:
        logger.warning("Invalid JSON from Spotify Pathfinder: %s", ex)
        return 502, None


async def _pathfinder_query(
    operation_name: str,
    query_hash: str,
    variables: dict[str, Any],
) -> tuple[int, dict[str, Any] | None]:
    payload = {
        "operationName": operation_name,
        "variables": variables,
        "extensions": {
            "persistedQuery": {
                "version": 1,
                "sha256Hash": query_hash,
            }
        },
    }
    return await _get_pathfinder_json(payload)


async def _fallback_oembed(item_type: str, spotify_id: str) -> dict[str, Any] | None:
    url = f"{SPOTIFY_OPEN}/{item_type}/{spotify_id}"
    headers = {"User-Agent": _DEFAULT_UA, "Accept": "application/json"}
    params = {"url": url}
    try:
        async with httpx.AsyncClient(timeout=settings.SPOTIFY_HTTP_TIMEOUT_SECONDS) as client:
            res = await client.get(f"{SPOTIFY_OPEN}/oembed", params=params, headers=headers)
        if res.status_code != 200:
            return None

        data = res.json()
        return {
            "name": data.get("title"),
            "image": data.get("thumbnail_url"),
            "owner_name": data.get("author_name"),
        }
    except Exception as ex:
        logger.warning("oEmbed fallback failed for %s:%s - %s", item_type, spotify_id, ex)
        return None


def _normalize_playlist_track(item: dict[str, Any]) -> dict[str, Any] | None:
    track = item.get("track") or {}
    if not isinstance(track, dict):
        return None

    track_id = track.get("id")
    if not track_id:
        return None

    album = track.get("album") or {}
    artists = track.get("artists") or []
    images = album.get("images") or []
    popularity = track.get("popularity")

    return {
        "spotify_id": track_id,
        "name": track.get("name"),
        "artist_names": [a.get("name") for a in artists if a.get("name")],
        "artists": [
            {"spotify_id": a.get("id"), "name": a.get("name")}
            for a in artists
            if a.get("name")
        ],
        "album_name": album.get("name"),
        "album_id": album.get("id"),
        "album_release_date": album.get("release_date"),
        "image": images[0].get("url") if images else None,
        "duration_ms": track.get("duration_ms"),
        "explicit": track.get("explicit"),
        "track_number": track.get("track_number"),
        "preview_url": track.get("preview_url"),
        "spotify_url": (track.get("external_urls") or {}).get("spotify"),
        "popularity": popularity,
        # Web API track item does not provide exact playcount.
        "playcount_estimate": None,
        "added_at": item.get("added_at"),
    }


def _normalize_pathfinder_track(item: dict[str, Any]) -> dict[str, Any] | None:
    wrapper = item.get("itemV2") or {}
    data = wrapper.get("data") or {}
    if not isinstance(data, dict):
        return None

    track_uri = data.get("uri")
    track_id = _spotify_uri_to_id(track_uri)
    if not track_id:
        return None

    album = data.get("albumOfTrack") or {}
    album_uri = album.get("uri")
    album_id = _spotify_uri_to_id(album_uri)
    album_cover_sources = (album.get("coverArt") or {}).get("sources") or []

    artists_items = (data.get("artists") or {}).get("items") or []
    artists: list[dict[str, Any]] = []
    artist_names: list[str] = []
    for artist in artists_items:
        profile = artist.get("profile") or {}
        name = profile.get("name")
        artist_uri = artist.get("uri")
        artist_id = _spotify_uri_to_id(artist_uri)
        if name:
            artist_names.append(name)
            artists.append({"spotify_id": artist_id, "name": name})

    preview_items = (((data.get("previews") or {}).get("audioPreviews") or {}).get("items") or [])
    preview_url = preview_items[0].get("url") if preview_items else None

    duration_ms = _safe_int((data.get("duration") or {}).get("totalMilliseconds"))
    track_number = _safe_int(data.get("trackNumber"))
    playcount = _safe_int(data.get("playcount"))
    content_rating = (data.get("contentRating") or {}).get("label")

    return {
        "spotify_id": track_id,
        "name": data.get("name"),
        "artist_names": artist_names,
        "artists": artists,
        "album_name": album.get("name"),
        "album_id": album_id,
        "album_release_date": None,
        "image": _first_image_from_sources(album_cover_sources),
        "duration_ms": duration_ms,
        "explicit": content_rating == "EXPLICIT",
        "track_number": track_number,
        "preview_url": preview_url,
        "spotify_url": f"https://open.spotify.com/track/{track_id}",
        "popularity": None,
        "playcount_estimate": playcount,
        "added_at": item.get("addedAt"),
    }


async def _fetch_playlist_tracks_paginated(
    playlist_id: str,
    total_tracks_hint: int | None,
) -> tuple[list[dict[str, Any]], int | None, int]:
    page_size = max(1, min(settings.PLAYLIST_PAGE_SIZE, 100))
    max_tracks = max(page_size, settings.PLAYLIST_MAX_TRACKS)

    tracks: list[dict[str, Any]] = []
    total_tracks = total_tracks_hint
    offset = 0
    pages_fetched = 0

    while offset < max_tracks:
        status, payload = await _get_json(
            f"/playlists/{playlist_id}/items",
            params={
                "limit": page_size,
                "offset": offset,
                "fields": _PLAYLIST_TRACK_FIELDS,
            },
        )
        if status != 200 or not payload:
            break

        pages_fetched += 1
        total_tracks = payload.get("total", total_tracks)
        items = payload.get("items") or []
        if not items:
            break

        for raw_item in items:
            normalized = _normalize_playlist_track(raw_item)
            if normalized:
                tracks.append(normalized)
                if len(tracks) >= max_tracks:
                    break

        fetched_count = len(items)
        offset += fetched_count

        if len(tracks) >= max_tracks:
            break
        if total_tracks is not None and offset >= int(total_tracks):
            break
        if fetched_count < page_size:
            break

    return tracks, total_tracks, pages_fetched


async def _fetch_playlist_pathfinder_page(
    playlist_id: str,
    offset: int,
    limit: int,
) -> tuple[int, dict[str, Any] | None]:
    payload = {
        "operationName": "queryPlaylist",
        "variables": {
            "uri": f"spotify:playlist:{playlist_id}",
            "offset": offset,
            "limit": limit,
        },
        "extensions": {
            "persistedQuery": {
                "version": 1,
                "sha256Hash": _PATHFINDER_QUERY_PLAYLIST_HASH,
            }
        },
    }

    status, data = await _get_pathfinder_json(payload)
    if status != 200 or not data:
        return status, None

    playlist = (data.get("data") or {}).get("playlistV2")
    if not isinstance(playlist, dict):
        return 502, None

    typename = playlist.get("__typename")
    if typename == "NotFound":
        return 404, None
    if typename == "GenericError":
        return 403, None
    if typename != "Playlist":
        return 502, None

    return 200, playlist


async def _fetch_playlist_via_pathfinder(playlist_id: str) -> dict[str, Any] | None:
    page_size = max(1, min(settings.PLAYLIST_PAGE_SIZE, 100))
    max_tracks = max(page_size, settings.PLAYLIST_MAX_TRACKS)

    tracks: list[dict[str, Any]] = []
    pages_fetched = 0
    total_tracks: int | None = None

    name: str | None = None
    image: str | None = None
    owner_name: str | None = None
    owner_image: str | None = None
    followers: int | None = None

    offset = 0
    while offset < max_tracks:
        current_offset = offset
        status, playlist = await _fetch_playlist_pathfinder_page(playlist_id, current_offset, page_size)
        if status != 200 or not playlist:
            if pages_fetched == 0:
                return None
            break

        if pages_fetched == 0:
            name = playlist.get("name")
            images_items = (playlist.get("images") or {}).get("items") or []
            image_sources = (images_items[0] or {}).get("sources") if images_items else []
            image = _first_image_from_sources(image_sources)

            owner_data = ((playlist.get("ownerV2") or {}).get("data") or {})
            owner_name = owner_data.get("name") or owner_data.get("username")
            owner_image = _first_image_from_sources((owner_data.get("avatar") or {}).get("sources") or [])
            followers = _safe_int(playlist.get("followers"))

        content = playlist.get("content") or {}
        total_tracks = _safe_int(content.get("totalCount")) or total_tracks
        items = content.get("items") or []
        if not items:
            break

        for raw_item in items:
            normalized = _normalize_pathfinder_track(raw_item)
            if normalized:
                tracks.append(normalized)
                if len(tracks) >= max_tracks:
                    break

        pages_fetched += 1

        if len(tracks) >= max_tracks:
            break
        if total_tracks is not None and len(tracks) >= total_tracks:
            break

        next_offset = _safe_int((content.get("pagingInfo") or {}).get("nextOffset"))
        if next_offset is None or next_offset <= current_offset:
            break

        offset = next_offset

    if pages_fetched == 0:
        return None

    expected = total_tracks if total_tracks is not None else len(tracks)
    deep_complete = bool(expected == 0 or len(tracks) >= expected)
    play_values = [t.get("playcount_estimate") for t in tracks if t.get("playcount_estimate") is not None]
    total_plays = sum(play_values) if deep_complete and len(play_values) >= expected else None

    return {
        "name": name,
        "image": image,
        "owner_name": owner_name,
        "owner_image": owner_image,
        "followers": followers,
        "track_count": expected,
        "tracks": tracks,
        "tracks_crawled": len(tracks),
        "tracks_expected": expected,
        "tracks_with_playcount": len(play_values),
        "deep_crawl_pages": pages_fetched,
        "deep_crawl_complete": deep_complete,
        "total_plays": total_plays,
        "playcount": total_plays,
        "crawl_mode": "deep_pathfinder",
    }


async def query_artist(artist_id: str) -> dict[str, Any] | None:
    """Query artist data from Spotify Web API, fallback to oEmbed."""
    playwright_task: asyncio.Task | None = None
    if settings.PLAYWRIGHT_ENABLE_FALLBACK and settings.PLAYWRIGHT_INLINE_FALLBACK:
        playwright_task = asyncio.create_task(spotify_web_scraper.scrape_artist_stats(artist_id))

    pathfinder = await _fetch_artist_via_pathfinder(artist_id)
    if pathfinder is not None:
        needs_playwright = (
            pathfinder.get("name") in (None, "")
            or pathfinder.get("owner_name") in (None, "")
            or pathfinder.get("monthly_listeners") is None
            or pathfinder.get("followers") is None
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return pathfinder
        scraped = await _consume_scrape_task(playwright_task, "artist")
        return await _apply_artist_playwright_fallback(artist_id, pathfinder, scraped)

    status, data = await _get_json(f"/artists/{artist_id}")
    if status == 200 and data:
        images = data.get("images") or []
        followers = (data.get("followers") or {}).get("total")
        result = {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "followers": followers,
            "monthly_listeners": None,
            "owner_name": data.get("name"),
            "owner_url": f"https://open.spotify.com/artist/{artist_id}",
            "playcount": None,
            "total_plays": None,
        }
        needs_playwright = (
            result.get("name") in (None, "")
            or result.get("owner_name") in (None, "")
            or result.get("monthly_listeners") is None
            or result.get("followers") is None
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return result
        scraped = await _consume_scrape_task(playwright_task, "artist")
        return await _apply_artist_playwright_fallback(artist_id, result, scraped)

    fallback = await _fallback_oembed("artist", artist_id)
    if fallback:
        fallback["monthly_listeners"] = None
        fallback["playcount"] = None
        fallback["total_plays"] = None
        fallback["crawl_mode"] = "oembed"
        needs_playwright = (
            fallback.get("name") in (None, "")
            or fallback.get("owner_name") in (None, "")
            or fallback.get("monthly_listeners") is None
            or fallback.get("followers") is None
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return fallback
        scraped = await _consume_scrape_task(playwright_task, "artist")
        return await _apply_artist_playwright_fallback(artist_id, fallback, scraped)

    scraped = await _consume_scrape_task(playwright_task, "artist")
    if scraped:
        return {
            "name": scraped.get("name"),
            "owner_name": scraped.get("owner_name") or scraped.get("name"),
            "owner_url": f"https://open.spotify.com/artist/{artist_id}",
            "monthly_listeners": scraped.get("monthly_listeners"),
            "followers": scraped.get("followers"),
            "playcount": None,
            "total_plays": None,
            "crawl_mode": scraped.get("crawl_mode") or "playwright_artist",
        }

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Artist not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Artist forbidden"}
    return None


async def get_track(track_id: str) -> dict[str, Any] | None:
    """Get track data from Spotify Web API, fallback to oEmbed."""
    playwright_task: asyncio.Task | None = None
    if settings.PLAYWRIGHT_ENABLE_FALLBACK and settings.PLAYWRIGHT_INLINE_FALLBACK:
        playwright_task = asyncio.create_task(spotify_web_scraper.scrape_track_stats(track_id))

    pathfinder = await _fetch_track_via_pathfinder(track_id)
    if pathfinder is not None:
        if pathfinder.get("error"):
            if not settings.PLAYWRIGHT_INLINE_FALLBACK:
                return pathfinder
            scraped = await _consume_scrape_task(playwright_task, "track")
            if scraped:
                return {
                    "name": scraped.get("name"),
                    "duration_ms": scraped.get("duration_ms"),
                    "playcount": scraped.get("playcount"),
                    "monthly_plays": None,
                    "monthly_listeners": None,
                    "crawl_mode": scraped.get("crawl_mode") or "playwright_track",
                }
            return pathfinder

        needs_playwright = (
            pathfinder.get("name") in (None, "")
            or pathfinder.get("duration_ms") is None
            or pathfinder.get("playcount") is None
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return pathfinder
        scraped = await _consume_scrape_task(playwright_task, "track")
        return await _apply_track_playwright_fallback(track_id, pathfinder, scraped)

    status, data = await _get_json(f"/tracks/{track_id}")
    if status == 200 and data:
        album = data.get("album") or {}
        images = album.get("images") or []
        artists = data.get("artists") or []
        primary_artist = artists[0]["name"] if artists else None

        webapi_result = {
            "name": data.get("name"),
            "artist_names": [artist.get("name") for artist in artists if artist.get("name")],
            "artists": [
                {"spotify_id": artist.get("id"), "name": artist.get("name")}
                for artist in artists
                if artist.get("name")
            ],
            "image": images[0]["url"] if images else None,
            "owner_name": primary_artist,
            "owner_url": f"https://open.spotify.com/artist/{artists[0]['id']}" if artists and artists[0].get("id") else None,
            "duration_ms": data.get("duration_ms"),
            "release_date": album.get("release_date"),
            "playcount": None,
            "monthly_plays": None,
            "monthly_listeners": None,
            "crawl_mode": "webapi_track",
        }

        needs_playwright = (
            webapi_result.get("name") in (None, "")
            or webapi_result.get("duration_ms") is None
            or webapi_result.get("playcount") is None
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return webapi_result
        scraped = await _consume_scrape_task(playwright_task, "track")
        return await _apply_track_playwright_fallback(track_id, webapi_result, scraped)

    fallback = await _fallback_oembed("track", track_id)
    if fallback:
        fallback["crawl_mode"] = "oembed"
        needs_playwright = (
            fallback.get("name") in (None, "")
            or fallback.get("duration_ms") is None
            or fallback.get("playcount") is None
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return fallback
        scraped = await _consume_scrape_task(playwright_task, "track")
        return await _apply_track_playwright_fallback(track_id, fallback, scraped)

    scraped = await _consume_scrape_task(playwright_task, "track")
    if scraped:
        return {
            "name": scraped.get("name"),
            "duration_ms": scraped.get("duration_ms"),
            "playcount": scraped.get("playcount"),
            "monthly_plays": None,
            "monthly_listeners": None,
            "crawl_mode": scraped.get("crawl_mode") or "playwright_track",
        }

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Track not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Track forbidden"}
    return None


async def fetch_playlist(playlist_id: str) -> dict[str, Any] | None:
    """Fetch playlist metadata and deep-crawl all tracks (Pathfinder first)."""
    # 1) Preferred flow: Pathfinder pagination with playcount-rich track payload.
    pathfinder_result = await _fetch_playlist_via_pathfinder(playlist_id)
    if pathfinder_result:
        return pathfinder_result

    # 2) Fallback to Spotify Web API v1.
    status, data = await _get_json(
        f"/playlists/{playlist_id}",
        params={"fields": "name,images,owner(display_name),followers(total),tracks(total),items(total)"},
    )
    if status == 200 and data:
        images = data.get("images") or []
        owner = data.get("owner") or {}
        followers = (data.get("followers") or {}).get("total")
        tracks_meta = data.get("tracks") or {}
        items_meta = data.get("items") or {}
        total_tracks_hint = items_meta.get("total")
        if total_tracks_hint is None:
            total_tracks_hint = tracks_meta.get("total")

        result: dict[str, Any] = {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "owner_name": owner.get("display_name"),
            "followers": followers,
            "track_count": total_tracks_hint,
        }

        if total_tracks_hint == 0:
            result.update(
                {
                    "tracks": [],
                    "tracks_crawled": 0,
                    "tracks_expected": 0,
                    "deep_crawl_complete": True,
                    "total_plays": 0,
                    "playcount": 0,
                    "crawl_mode": "deep_webapi",
                }
            )
            return result

        playlist_tracks, total_tracks, pages_fetched = await _fetch_playlist_tracks_paginated(
            playlist_id, total_tracks_hint
        )

        if playlist_tracks:
            expected = total_tracks if total_tracks is not None else len(playlist_tracks)
            deep_complete = len(playlist_tracks) >= expected
            exact_track_plays = [
                t.get("playcount_estimate")
                for t in playlist_tracks
                if t.get("playcount_estimate") is not None
            ]
            total_plays = sum(exact_track_plays) if deep_complete and len(exact_track_plays) >= expected else None
            result.update(
                {
                    "track_count": expected,
                    "tracks": playlist_tracks,
                    "tracks_crawled": len(playlist_tracks),
                    "tracks_expected": expected,
                    "tracks_with_playcount": len(exact_track_plays),
                    "deep_crawl_pages": pages_fetched,
                    "deep_crawl_complete": deep_complete,
                    "total_plays": total_plays,
                    "playcount": total_plays,
                    "crawl_mode": "deep_webapi",
                }
            )
            return result

        result.update(
            {
                "tracks": [],
                "tracks_crawled": 0,
                "tracks_expected": total_tracks_hint,
                "deep_crawl_pages": pages_fetched,
                "deep_crawl_complete": False,
                "total_plays": None,
                "playcount": None,
                "crawl_mode": "metadata_only",
            }
        )
        return result

    # 3) Lowest fallback: oEmbed metadata only.
    fallback = await _fallback_oembed("playlist", playlist_id)
    if fallback:
        fallback.update(
            {
                "tracks": [],
                "tracks_crawled": 0,
                "tracks_expected": None,
                "deep_crawl_complete": False,
                "total_plays": None,
                "playcount": None,
                "crawl_mode": "oembed",
            }
        )
        return fallback

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Playlist not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Playlist forbidden"}
    return None


async def fetch_album(album_id: str) -> dict[str, Any] | None:
    """Fetch album metadata from Spotify Web API, fallback to oEmbed."""
    playwright_task: asyncio.Task | None = None
    if settings.PLAYWRIGHT_ENABLE_FALLBACK and settings.PLAYWRIGHT_INLINE_FALLBACK:
        playwright_task = asyncio.create_task(spotify_web_scraper.scrape_album_stats(album_id))

    pathfinder = await _fetch_album_via_pathfinder(album_id)
    if pathfinder is not None:
        needs_playwright = (
            pathfinder.get("name") in (None, "")
            or pathfinder.get("owner_name") in (None, "")
            or (pathfinder.get("playcount") is None and pathfinder.get("total_plays") is None)
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return pathfinder
        scraped = await _consume_scrape_task(playwright_task, "album")
        return await _apply_album_playwright_fallback(album_id, pathfinder, scraped)

    status, data = await _get_json(f"/albums/{album_id}")
    if status == 200 and data:
        images = data.get("images") or []
        artists = data.get("artists") or []
        artist_names = [
            artist.get("name")
            for artist in artists
            if isinstance(artist, dict) and isinstance(artist.get("name"), str)
        ]
        result = {
            "name": _format_album_display_name(data.get("name"), artist_names) or data.get("name"),
            "image": images[0]["url"] if images else None,
            "owner_name": artists[0]["name"] if artists else None,
            "owner_url": f"https://open.spotify.com/artist/{artists[0]['id']}" if artists and artists[0].get("id") else None,
            "artist_names": _normalize_name_parts(artist_names),
            "artists": [
                {"spotify_id": artist.get("id"), "name": artist.get("name")}
                for artist in artists
                if isinstance(artist, dict) and artist.get("name")
            ],
            "track_count": data.get("total_tracks"),
            "release_date": data.get("release_date"),
            "playcount": None,
            "total_plays": None,
            "crawl_mode": "webapi_album",
        }
        needs_playwright = (
            result.get("name") in (None, "")
            or result.get("owner_name") in (None, "")
            or (result.get("playcount") is None and result.get("total_plays") is None)
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return result
        scraped = await _consume_scrape_task(playwright_task, "album")
        return await _apply_album_playwright_fallback(album_id, result, scraped)

    fallback = await _fallback_oembed("album", album_id)
    if fallback:
        fallback["crawl_mode"] = "oembed"
        needs_playwright = (
            fallback.get("name") in (None, "")
            or fallback.get("owner_name") in (None, "")
            or (fallback.get("playcount") is None and fallback.get("total_plays") is None)
        )
        if not settings.PLAYWRIGHT_INLINE_FALLBACK or not needs_playwright:
            _cancel_scrape_task(playwright_task)
            return fallback
        scraped = await _consume_scrape_task(playwright_task, "album")
        return await _apply_album_playwright_fallback(album_id, fallback, scraped)

    scraped = await _consume_scrape_task(playwright_task, "album")
    if scraped:
        artist_names = _normalize_name_parts(
            [scraped.get("owner_name")] if isinstance(scraped.get("owner_name"), str) else []
        )
        return {
            "name": _format_album_display_name(scraped.get("name"), artist_names) or scraped.get("name"),
            "owner_name": scraped.get("owner_name"),
            "artist_names": artist_names,
            "artists": [{"spotify_id": None, "name": name} for name in artist_names],
            "track_count": scraped.get("track_count"),
            "tracks_crawled": scraped.get("tracks_crawled"),
            "tracks_expected": scraped.get("tracks_expected"),
            "tracks_with_playcount": scraped.get("tracks_with_playcount"),
            "playcount": scraped.get("playcount"),
            "total_plays": scraped.get("total_plays"),
            "deep_crawl_complete": scraped.get("deep_crawl_complete"),
            "crawl_mode": scraped.get("crawl_mode") or "playwright_album",
        }

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Album not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Album forbidden"}
    return None



def _pathfinder_date_to_iso(date_obj: dict[str, Any] | None) -> str | None:
    if not date_obj:
        return None
    iso = date_obj.get("isoString")
    if isinstance(iso, str) and iso:
        return iso[:10]
    year = _safe_int(date_obj.get("year"))
    month = _safe_int(date_obj.get("month"))
    day = _safe_int(date_obj.get("day"))
    if year and month and day:
        return f"{year:04d}-{month:02d}-{day:02d}"
    if year and month:
        return f"{year:04d}-{month:02d}"
    if year:
        return f"{year:04d}"
    return None


def _pathfinder_extract_artists(artists_container: Any) -> tuple[list[dict[str, Any]], list[str]]:
    if isinstance(artists_container, dict):
        raw_items = artists_container.get("items") or []
    elif isinstance(artists_container, list):
        raw_items = artists_container
    else:
        raw_items = []

    artists: list[dict[str, Any]] = []
    names: list[str] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        profile = raw.get("profile") or {}
        name = profile.get("name") or raw.get("name")
        artist_uri = raw.get("uri")
        artist_id = raw.get("id") or _spotify_uri_to_id(artist_uri)
        if name:
            names.append(name)
            artists.append({"spotify_id": artist_id, "name": name})

    return artists, names


def _pathfinder_extract_preview_url(previews_container: Any) -> str | None:
    items = (((previews_container or {}).get("audioPreviews") or {}).get("items") or [])
    if items:
        first = items[0] or {}
        return first.get("url")
    return None


async def _fetch_track_via_pathfinder(track_id: str) -> dict[str, Any] | None:
    status, payload = await _pathfinder_query(
        operation_name="queryTrack",
        query_hash=_PATHFINDER_QUERY_TRACK_HASH,
        variables={"uri": f"spotify:track:{track_id}"},
    )
    if status != 200 or not payload:
        return None

    track_union = (payload.get("data") or {}).get("trackUnion")
    if not isinstance(track_union, dict):
        return None

    typename = track_union.get("__typename")
    if typename == "NotFound":
        return {"error": True, "error_code": 404, "error_message": "Track not found"}
    if typename != "Track":
        return None

    album = track_union.get("albumOfTrack") or {}
    album_cover_sources = (album.get("coverArt") or {}).get("sources") or []
    release_date = _pathfinder_date_to_iso(album.get("date"))
    artists, artist_names = _pathfinder_extract_artists(track_union.get("artists"))

    first_artist_items = ((track_union.get("firstArtist") or {}).get("items") or [])
    primary_artist = first_artist_items[0] if first_artist_items else {}
    owner_name = ((primary_artist.get("profile") or {}).get("name"))
    owner_artist_id = _spotify_uri_to_id(primary_artist.get("uri"))
    owner_image = _first_image_from_sources(
        ((primary_artist.get("visuals") or {}).get("avatarImage") or {}).get("sources") or []
    )

    duration_ms = _safe_int((track_union.get("duration") or {}).get("totalMilliseconds"))
    playcount = _safe_int(track_union.get("playcount"))

    source = "pathfinder_track"

    return {
        "name": track_union.get("name"),
        "artist_names": artist_names or ([owner_name] if owner_name else []),
        "artists": artists or (
            [{"spotify_id": owner_artist_id, "name": owner_name}]
            if owner_artist_id or owner_name
            else []
        ),
        "image": _first_image_from_sources(album_cover_sources),
        "owner_name": owner_name,
        "owner_image": owner_image,
        "owner_url": f"https://open.spotify.com/artist/{owner_artist_id}" if owner_artist_id else None,
        "duration_ms": duration_ms,
        "release_date": release_date,
        "playcount": playcount,
        "monthly_plays": None,
        "monthly_listeners": None,
        "playcount_estimated": False,
        "crawl_mode": source,
    }


async def _fetch_artist_via_pathfinder(artist_id: str) -> dict[str, Any] | None:
    status, payload = await _pathfinder_query(
        operation_name="queryArtist",
        query_hash=_PATHFINDER_QUERY_ARTIST_HASH,
        variables={"uri": f"spotify:artist:{artist_id}"},
    )
    if status != 200 or not payload:
        return None

    artist_union = (payload.get("data") or {}).get("artistUnion")
    if not isinstance(artist_union, dict):
        return None

    typename = artist_union.get("__typename")
    if typename == "NotFound":
        return {"error": True, "error_code": 404, "error_message": "Artist not found"}
    if typename != "Artist":
        return None

    profile = artist_union.get("profile") or {}
    visuals = artist_union.get("visuals") or {}
    stats = artist_union.get("stats") or {}

    albums_items = (((artist_union.get("discography") or {}).get("albums") or {}).get("items") or [])
    album_count = 0
    for bucket in albums_items:
        releases = ((bucket.get("releases") or {}).get("items") or [])
        album_count += len(releases)

    avatar_sources = ((visuals.get("avatarImage") or {}).get("sources") or [])
    avatar = _first_image_from_sources(avatar_sources)

    return {
        "name": profile.get("name"),
        "image": avatar,
        "owner_name": profile.get("name"),
        "owner_image": avatar,
        "owner_url": f"https://open.spotify.com/artist/{artist_id}",
        "followers": _safe_int(stats.get("followers")),
        "monthly_listeners": _safe_int(stats.get("monthlyListeners")),
        "playcount": None,
        "total_plays": None,
        "album_count": album_count or None,
        "crawl_mode": "pathfinder_artist",
    }



def _normalize_pathfinder_album_track(track_data: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(track_data, dict):
        return None

    track_id = track_data.get("id") or _spotify_uri_to_id(track_data.get("uri"))
    if not track_id:
        return None

    artists, artist_names = _pathfinder_extract_artists(track_data.get("artists"))
    preview_url = _pathfinder_extract_preview_url(track_data.get("previews"))
    duration_ms = _safe_int((track_data.get("duration") or {}).get("totalMilliseconds"))
    track_number = _safe_int(track_data.get("trackNumber"))
    playcount = _safe_int(track_data.get("playcount"))
    content_rating = (track_data.get("contentRating") or {}).get("label")

    return {
        "spotify_id": track_id,
        "name": track_data.get("name"),
        "artist_names": artist_names,
        "artists": artists,
        "duration_ms": duration_ms,
        "explicit": content_rating == "EXPLICIT",
        "track_number": track_number,
        "preview_url": preview_url,
        "spotify_url": f"https://open.spotify.com/track/{track_id}",
        "playcount_estimate": playcount,
    }


async def _fetch_album_via_pathfinder(album_id: str) -> dict[str, Any] | None:
    page_size = max(1, min(settings.PLAYLIST_PAGE_SIZE, 100))
    max_tracks = max(page_size, settings.PLAYLIST_MAX_TRACKS)

    tracks: list[dict[str, Any]] = []
    pages_fetched = 0
    total_tracks: int | None = None

    name: str | None = None
    image: str | None = None
    owner_name: str | None = None
    owner_image: str | None = None
    owner_url: str | None = None
    release_date: str | None = None
    album_artists: list[dict[str, Any]] = []
    album_artist_names: list[str] = []

    offset = 0
    while offset < max_tracks:
        current_offset = offset
        status, payload = await _pathfinder_query(
            operation_name="queryAlbum",
            query_hash=_PATHFINDER_QUERY_ALBUM_HASH,
            variables={
                "uri": f"spotify:album:{album_id}",
                "offset": current_offset,
                "limit": page_size,
            },
        )
        if status != 200 or not payload:
            if pages_fetched == 0:
                return None
            break

        album_union = (payload.get("data") or {}).get("albumUnion")
        if not isinstance(album_union, dict):
            if pages_fetched == 0:
                return None
            break

        typename = album_union.get("__typename")
        if typename == "NotFound":
            return {"error": True, "error_code": 404, "error_message": "Album not found"}
        if typename != "Album":
            if pages_fetched == 0:
                return None
            break

        if pages_fetched == 0:
            name = album_union.get("name")
            image = _first_image_from_sources((album_union.get("coverArt") or {}).get("sources") or [])
            release_date = _pathfinder_date_to_iso(album_union.get("date"))
            artist_items = ((album_union.get("artists") or {}).get("items") or [])
            album_artists, album_artist_names = _pathfinder_extract_artists(artist_items)
            main_artist = artist_items[0] if artist_items else {}
            owner_name = ((main_artist.get("profile") or {}).get("name"))
            owner_artist_id = _spotify_uri_to_id(main_artist.get("uri"))
            owner_url = f"https://open.spotify.com/artist/{owner_artist_id}" if owner_artist_id else None
            owner_image = _first_image_from_sources(
                ((main_artist.get("visuals") or {}).get("avatarImage") or {}).get("sources") or []
            )

        tracks_v2 = album_union.get("tracksV2") or {}
        total_tracks = _safe_int(tracks_v2.get("totalCount")) or total_tracks
        rows = tracks_v2.get("items") or []

        for row in rows:
            track_data = row.get("track") or {}
            normalized = _normalize_pathfinder_album_track(track_data)
            if normalized:
                normalized["album_name"] = name
                normalized["album_id"] = album_id
                normalized["album_release_date"] = release_date
                normalized["image"] = normalized.get("image") or image

                tracks.append(normalized)
                if len(tracks) >= max_tracks:
                    break

        pages_fetched += 1

        if len(tracks) >= max_tracks:
            break
        if total_tracks is not None and len(tracks) >= total_tracks:
            break

        next_offset = _safe_int((tracks_v2.get("pagingInfo") or {}).get("nextOffset"))
        if next_offset is None or next_offset <= current_offset:
            break
        offset = next_offset

    if pages_fetched == 0:
        return None

    expected = total_tracks if total_tracks is not None else len(tracks)
    deep_complete = bool(expected == 0 or len(tracks) >= expected)
    play_values = [t.get("playcount_estimate") for t in tracks if t.get("playcount_estimate") is not None]
    total_plays = sum(play_values) if deep_complete and len(play_values) >= expected else None
    display_name = _format_album_display_name(name, album_artist_names) or name

    return {
        "name": display_name,
        "image": image,
        "owner_name": owner_name,
        "owner_image": owner_image,
        "owner_url": owner_url,
        "artist_names": _normalize_name_parts(album_artist_names),
        "artists": album_artists,
        "track_count": expected,
        "release_date": release_date,
        "tracks": tracks,
        "tracks_crawled": len(tracks),
        "tracks_expected": expected,
        "tracks_with_playcount": len(play_values),
        "deep_crawl_pages": pages_fetched,
        "deep_crawl_complete": deep_complete,
        "total_plays": total_plays,
        "playcount": total_plays,
        "crawl_mode": "pathfinder_album",
    }
