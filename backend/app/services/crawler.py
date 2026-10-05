"""
Crawler Service - orchestrates crawl jobs.

Runs as background tasks via event-loop tasks.
"""

import asyncio
import logging
from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy import select

from app.database import async_session
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.services import spotify_client
from app.config import settings

logger = logging.getLogger(__name__)

# Dispatch table: type -> fetch function
FETCHERS = {
    "artist": spotify_client.query_artist,
    "track": spotify_client.get_track,
    "playlist": spotify_client.fetch_playlist,
    "album": spotify_client.fetch_album,
}
CRAWL_TASK_SEMAPHORE = asyncio.Semaphore(max(1, settings.CRAWL_TASK_MAX_CONCURRENCY))

def _has_meaningful_data(data: dict) -> bool:
    """Return True when payload contains any usable field from API/Playwright."""
    keys = (
        "name",
        "image",
        "owner_name",
        "owner_image",
        "followers",
        "monthly_listeners",
        "monthly_plays",
        "playcount",
        "total_plays",
        "track_count",
        "album_count",
        "duration_ms",
        "release_date",
    )
    for key in keys:
        value = data.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, (list, dict)) and not value:
            continue
        return True
    return False


def _prefer_existing_on_none(current, incoming):
    """Keep current value when incoming is None/empty-string."""
    if incoming is None:
        return current
    if isinstance(incoming, str) and not incoming.strip():
        return current
    return incoming


def _extract_primary_artist_id(data: dict) -> str | None:
    artists = data.get("artists") or []
    if isinstance(artists, list):
        for artist in artists:
            if not isinstance(artist, dict):
                continue
            artist_id = artist.get("spotify_id") or artist.get("id")
            if isinstance(artist_id, str) and artist_id.strip():
                return artist_id.strip()

    owner_url = data.get("owner_url")
    if not isinstance(owner_url, str) or not owner_url.strip():
        return None

    parsed = urlparse(owner_url)
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 2 and parts[-2] == "artist":
        return parts[-1].strip() or None
    return None


async def _enrich_owner_artist_metrics(data: dict) -> dict:
    primary_artist_id = _extract_primary_artist_id(data)
    if not primary_artist_id:
        return data

    artist_data = await spotify_client.query_artist(primary_artist_id)
    if not artist_data or artist_data.get("error"):
        return data

    merged = dict(data)
    if artist_data.get("followers") is not None:
        merged["followers"] = artist_data.get("followers")
    if artist_data.get("monthly_listeners") is not None:
        merged["monthly_listeners"] = artist_data.get("monthly_listeners")
    if not merged.get("owner_name") and artist_data.get("owner_name"):
        merged["owner_name"] = artist_data.get("owner_name")
    if not merged.get("owner_image") and artist_data.get("owner_image"):
        merged["owner_image"] = artist_data.get("owner_image")
    if not merged.get("owner_url") and artist_data.get("owner_url"):
        merged["owner_url"] = artist_data.get("owner_url")
    return merged


def _formatted_item_name(item_type: str, data: dict) -> str | None:
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    base_name = name.strip()

    def normalized_artist_names() -> list[str]:
        raw_artist_names = data.get("artist_names") or []
        if not isinstance(raw_artist_names, list):
            return []
        names: list[str] = []
        seen: set[str] = set()
        for artist in raw_artist_names:
            if not isinstance(artist, str) or not artist.strip():
                continue
            cleaned = artist.strip()
            lowered = cleaned.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            names.append(cleaned)
        return names

    def strip_existing_artist_prefix(title: str, artist_names: list[str]) -> str:
        if not artist_names:
            return title

        candidates: list[str] = []
        seen: set[str] = set()
        for separator in (", ", " - "):
            for size in range(len(artist_names), 0, -1):
                candidate = separator.join(artist_names[:size]).strip()
                lowered = candidate.lower()
                if not candidate or lowered in seen:
                    continue
                seen.add(lowered)
                candidates.append(candidate)
        for name in artist_names:
            lowered = name.lower()
            if lowered not in seen:
                seen.add(lowered)
                candidates.append(name)

        current = title.strip()
        while True:
            lowered = current.lower()
            matched = False
            for prefix in candidates:
                marker = f"{prefix} - "
                if lowered.startswith(marker.lower()):
                    current = current[len(marker):].strip()
                    matched = True
                    break
            if not matched:
                return current or title

    if item_type == "track":
        artist_names = normalized_artist_names()
        if not artist_names and isinstance(data.get("owner_name"), str) and data.get("owner_name").strip():
            artist_names = [data.get("owner_name").strip()]
        if artist_names:
            prefix = ', '.join(artist_names)
            stripped = strip_existing_artist_prefix(base_name, artist_names)
            return f"{prefix} - {stripped}"

    if item_type == "album":
        artist_names = normalized_artist_names()
        if not artist_names:
            owner_name = data.get("owner_name")
            if isinstance(owner_name, str) and owner_name.strip():
                artist_names = [owner_name.strip()]
        if artist_names:
            prefix = ", ".join(artist_names)
            stripped = strip_existing_artist_prefix(base_name, artist_names)
            return f"{prefix} - {stripped}"

    return base_name


async def _finalize_payload(item_type: str, data: dict) -> dict:
    merged = dict(data)
    if item_type in {"track", "album"}:
        merged = await _enrich_owner_artist_metrics(merged)

    formatted_name = _formatted_item_name(item_type, merged)
    if formatted_name:
        merged["name"] = formatted_name
    return merged


async def _load_job_item(db, job: CrawlJob, spotify_id: str, item_type: str) -> Item | None:
    """Resolve the correct item row for this job (supports duplicate spotify_id across users)."""
    if job.item_id:
        by_id_result = await db.execute(select(Item).where(Item.id == job.item_id))
        by_id = by_id_result.scalar_one_or_none()
        return by_id  # A deleted exact row must never fall back to another workspace/user.

    if not job.user_id:
        return None

    fallback_result = await db.execute(
        select(Item)
        .where(
            Item.spotify_id == spotify_id,
            Item.item_type == item_type,
            Item.user_id == job.user_id,
            Item.workspace == ("channel-playlists" if isinstance(job.result, dict) and job.result.get("youtube_channel_job") else "spotify"),
        )
        .order_by(Item.updated_at.desc())
    )
    return fallback_result.scalars().first()


async def crawl_item_task(job_id: str, spotify_id: str, item_type: str):
    """
    Background task: crawl a single Spotify item.

    1. Update job status to 'crawling'
    2. Call the appropriate Spotify client function
    3. Update Item with real data
    4. Save raw response
    5. Update job status to 'completed' or 'error'
    """
    async with CRAWL_TASK_SEMAPHORE:
        async with async_session() as db:
            try:
                # 1. Mark job as crawling
                job_result = await db.execute(select(CrawlJob).where(CrawlJob.id == job_id))
                job = job_result.scalar_one_or_none()
                if not job:
                    logger.error(f"Job {job_id} not found")
                    return

                job.status = "crawling"
                job.started_at = datetime.utcnow()
                await db.commit()

                existing_item = await _load_job_item(db, job, spotify_id, item_type)
                existing_data = {}
                if existing_item is not None:
                    existing_data = {
                        "name": existing_item.name,
                        "owner_name": existing_item.owner_name,
                        "playcount": existing_item.playcount,
                        "monthly_listeners": existing_item.monthly_listeners,
                        "followers": existing_item.followers,
                        "duration_ms": existing_item.duration_ms,
                        "track_count": existing_item.track_count,
                    }

                # 2. Fetch data from Spotify
                fetcher = FETCHERS.get(item_type)
                if not fetcher:
                    raise ValueError(f"Unknown item type: {item_type}")

                data = None
                for attempt in range(settings.MAX_RETRIES):
                    try:
                        data = await fetcher(spotify_id)
                        if data is not None:
                            break
                    except Exception as e:
                        logger.warning(
                            f"Attempt {attempt + 1} failed for {spotify_id}: {e}"
                        )
                        if attempt < settings.MAX_RETRIES - 1:
                            wait = (2**attempt) + (asyncio.get_event_loop().time() % 1)
                            await asyncio.sleep(wait)

                if data is None:
                    raise Exception("All retry attempts failed - no data returned")

                data = await _finalize_payload(item_type, data)

                # 3. Check if response indicates an error
                if data.get("error"):
                    item = await _load_job_item(db, job, spotify_id, item_type)
                    if item:
                        item.status = "error"
                        item.error_code = data.get("error_code")
                        item.error_message = data.get("error_message")
                        item.last_checked = datetime.utcnow()

                    job.status = "error"
                    job.error = data.get("error_message", "Unknown error")
                    job.completed_at = datetime.utcnow()
                    await db.commit()
                    return

                if not _has_meaningful_data(data):
                    raise Exception("No usable data from API")

                # 4. Update Item with real data
                item = await _load_job_item(db, job, spotify_id, item_type)
                if item:
                    item.name = _prefer_existing_on_none(item.name, data.get("name"))
                    item.image = _prefer_existing_on_none(item.image, data.get("image"))
                    item.owner_name = _prefer_existing_on_none(item.owner_name, data.get("owner_name"))
                    item.owner_image = _prefer_existing_on_none(item.owner_image, data.get("owner_image"))
                    item.followers = _prefer_existing_on_none(item.followers, data.get("followers"))

                    monthly_value = data.get("monthly_listeners")
                    if monthly_value is None:
                        monthly_value = data.get("monthly_plays")
                    item.monthly_listeners = _prefer_existing_on_none(
                        item.monthly_listeners,
                        monthly_value,
                    )

                    item.playcount = _prefer_existing_on_none(item.playcount, data.get("playcount"))
                    item.track_count = _prefer_existing_on_none(item.track_count, data.get("track_count"))
                    item.album_count = _prefer_existing_on_none(item.album_count, data.get("album_count"))
                    item.duration_ms = _prefer_existing_on_none(item.duration_ms, data.get("duration_ms"))
                    item.release_date = _prefer_existing_on_none(item.release_date, data.get("release_date"))
                    item.status = "active"
                    item.error_code = None
                    item.error_message = None
                    item.last_checked = datetime.utcnow()

                    snapshot = MetricsSnapshot(
                        item_id=item.id,
                        spotify_id=spotify_id,
                        followers=item.followers,
                        monthly_listeners=item.monthly_listeners,
                        playcount=item.playcount,
                        track_count=item.track_count,
                    )
                    db.add(snapshot)

                # 5. Save raw response for debugging
                raw = RawResponse(
                    spotify_id=spotify_id,
                    operation=f"fetch_{item_type}",
                    response_data=data,
                )
                db.add(raw)

                # 6. Mark job completed
                job.status = "completed"
                job.result = data
                job.completed_at = datetime.utcnow()

                await db.commit()
                logger.info(
                    f"Crawl completed: {item_type}:{spotify_id} - {data.get('name', '?')}"
                )

            except Exception as e:
                logger.error(f"Crawl failed for {spotify_id}: {e}")
                try:
                    job_result = await db.execute(
                        select(CrawlJob).where(CrawlJob.id == job_id)
                    )
                    job = job_result.scalar_one_or_none()
                    if job:
                        job.status = "error"
                        job.error = str(e)
                        job.completed_at = datetime.utcnow()
                        job.retry_count += 1

                    if job is not None:
                        item = await _load_job_item(db, job, spotify_id, item_type)
                    else:
                        item = None  # The job was deleted; do not modify unrelated matching rows.
                    if item:
                        item.status = "error"
                        item.error_message = str(e)
                        item.last_checked = datetime.utcnow()

                    await db.commit()
                except Exception:
                    await db.rollback()
