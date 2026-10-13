"""
Crawler Service - orchestrates crawl jobs.

Runs as background tasks via event-loop tasks.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlparse

from sqlalchemy import delete, null, select, update
from sqlalchemy.orm import aliased

from app import database
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
JOB_RESULT_MAX_ARTISTS = 20
JOB_RESULT_COMPACT_DAYS = 7
STALE_CRAWL_MINUTES = 30
INTERRUPTED_BY_RESTART = "Interrupted by server restart"
ITEM_INTERRUPTED_MESSAGE = "Crawl interrupted — please refresh"
CLEANUP_BATCH_SIZE = 500
CLEANUP_MAX_BATCHES = 200
MAINTENANCE_INTERVAL_SECONDS = 60
CLEANUP_INTERVAL_SECONDS = 3600

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


def _job_result_summary(previous: dict | None, data: dict) -> dict:
    """Compact job result: scalar fields only (no track lists); the full payload lives in raw_responses."""
    summary = {
        key: value
        for key, value in data.items()
        if value is None or isinstance(value, (str, int, float, bool))
    }
    for key in ("artist_names", "artists"):
        value = data.get(key)
        if isinstance(value, list):
            summary[key] = value[:JOB_RESULT_MAX_ARTISTS]
    if isinstance(previous, dict) and previous.get("youtube_channel_job"):
        summary["youtube_channel_job"] = True
    return summary


def _job_key(job_id):
    """Accept str or UUID job ids (callers pass str; non-native UUID backends need UUID objects)."""
    if isinstance(job_id, uuid.UUID):
        return job_id
    try:
        return uuid.UUID(str(job_id))
    except (TypeError, ValueError):
        return job_id


def _is_youtube_channel_job(job: CrawlJob) -> bool:
    return isinstance(job.result, dict) and bool(job.result.get("youtube_channel_job"))


async def _prune_raw_responses(db, spotify_id: str) -> None:
    """Keep only the latest N raw responses for one Spotify ID."""
    keep = max(1, settings.RAW_RESPONSE_KEEP_PER_ITEM)
    latest_ids = (
        select(RawResponse.id)
        .where(RawResponse.spotify_id == spotify_id)
        .order_by(RawResponse.captured_at.desc(), RawResponse.id.desc())
        .limit(keep)
        .correlate(None)  # Same table as the DELETE target: never auto-correlate.
    )
    await db.execute(
        delete(RawResponse).where(
            RawResponse.spotify_id == spotify_id,
            RawResponse.id.not_in(latest_ids),
        ).execution_options(synchronize_session=False)
    )


async def _mark_job_failed(job_id: str, spotify_id: str, item_type: str, error: Exception) -> None:
    """Persist an error for the job/item in a fresh session (no session is held during fetches)."""
    async with database.async_session() as db:
        try:
            job_result = await db.execute(
                select(CrawlJob).where(CrawlJob.id == _job_key(job_id))
            )
            job = job_result.scalar_one_or_none()
            if job:
                job.status = "error"
                job.error = str(error)
                job.completed_at = datetime.utcnow()
                job.retry_count += 1

            if job is not None:
                item = await _load_job_item(db, job, spotify_id, item_type)
            else:
                item = None  # The job was deleted; do not modify unrelated matching rows.
            if item:
                item.status = "error"
                item.error_message = str(error)
                item.last_checked = datetime.utcnow()

            await db.commit()
        except Exception:
            await db.rollback()


async def crawl_item_task(job_id: str, spotify_id: str, item_type: str):
    """
    Background task: crawl a single Spotify item.

    1. Update job status to 'crawling' (short DB session, committed and closed)
    2. Call the appropriate Spotify client function (no DB connection held)
    3. Update Item with real data (second short DB session)
    4. Save raw response (pruned to the latest N per Spotify ID)
    5. Update job status to 'completed' or 'error'
    """
    async with CRAWL_TASK_SEMAPHORE:
        try:
            # 1. Mark job as crawling
            async with database.async_session() as db:
                job_result = await db.execute(select(CrawlJob).where(CrawlJob.id == _job_key(job_id)))
                job = job_result.scalar_one_or_none()
                if not job:
                    logger.error(f"Job {job_id} not found")
                    return

                job.status = "crawling"
                job.started_at = datetime.utcnow()
                await db.commit()

            # 2. Fetch data from Spotify (network I/O, no session/transaction open)
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

            if not data.get("error") and not _has_meaningful_data(data):
                raise Exception("No usable data from API")

            async with database.async_session() as db:
                job_result = await db.execute(select(CrawlJob).where(CrawlJob.id == _job_key(job_id)))
                job = job_result.scalar_one_or_none()
                if not job:
                    logger.warning(f"Job {job_id} was deleted during crawl; discarding result")
                    return

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

                # 5. Save raw response (full payload; the only full copy)
                raw = RawResponse(
                    spotify_id=spotify_id,
                    operation=f"fetch_{item_type}",
                    response_data=data,
                )
                db.add(raw)
                await db.flush()
                await _prune_raw_responses(db, spotify_id)

                # 6. Mark job completed with a compact summary (frontend polling reads scalar fields)
                job.status = "completed"
                job.result = _job_result_summary(job.result, data)
                job.completed_at = datetime.utcnow()

                await db.commit()
                logger.info(
                    f"Crawl completed: {item_type}:{spotify_id} - {data.get('name', '?')}"
                )

        except Exception as e:
            logger.error(f"Crawl failed for {spotify_id}: {e}")
            await _mark_job_failed(job_id, spotify_id, item_type, e)


async def recover_interrupted_jobs(stale_after: timedelta | None = None) -> int:
    """Mark lost Spotify crawl jobs as error and release their items.

    stale_after=None (startup): every pending/crawling Spotify job is from a previous process.
    stale_after=timedelta: only jobs crawling longer than that are considered lost.
    YouTube channel playlist jobs (result.youtube_channel_job) are handled by youtube_jobs.
    """
    now = datetime.utcnow()
    async with database.async_session() as db:
        query = select(CrawlJob)
        if stale_after is None:
            query = query.where(CrawlJob.status.in_(["pending", "crawling"]))
            job_error = INTERRUPTED_BY_RESTART
        else:
            query = query.where(CrawlJob.status == "crawling", CrawlJob.started_at < now - stale_after)
            job_error = f"Crawl timed out after {int(stale_after.total_seconds() // 60)} minutes"
        jobs = [job for job in (await db.execute(query)).scalars() if not _is_youtube_channel_job(job)]
        if not jobs:
            return 0
        for job in jobs:
            job.status = "error"
            job.error = job_error
            job.completed_at = now
        await db.flush()
        item_ids = list({job.item_id for job in jobs if job.item_id})
        for offset in range(0, len(item_ids), CLEANUP_BATCH_SIZE):
            chunk = item_ids[offset:offset + CLEANUP_BATCH_SIZE]
            still_active = (
                select(CrawlJob.id)
                .where(CrawlJob.item_id == Item.id, CrawlJob.status.in_(["pending", "crawling"]))
                .exists()
            )
            await db.execute(
                update(Item)
                .where(Item.id.in_(chunk), Item.status == "crawling", ~still_active)
                .values(status="error", error_code=503, error_message=ITEM_INTERRUPTED_MESSAGE)
                .execution_options(synchronize_session=False)
            )
        await db.commit()
    logger.warning("Marked %d interrupted Spotify crawl job(s) as error: %s", len(jobs), job_error)
    return len(jobs)


async def _run_batched(statement_factory, max_batches: int = CLEANUP_MAX_BATCHES) -> int:
    """Run a bounded DML statement repeatedly, one short transaction per batch."""
    total = 0
    for _ in range(max_batches):
        async with database.async_session() as db:
            result = await db.execute(statement_factory().execution_options(synchronize_session=False))
            await db.commit()
        count = max(0, result.rowcount or 0)
        total += count
        if count < CLEANUP_BATCH_SIZE:
            break
    return total


async def cleanup_crawl_storage() -> dict:
    """Trim old raw responses, compact old job results, delete old finished jobs."""
    now = datetime.utcnow()
    raw_cutoff = now - timedelta(days=max(1, settings.RAW_RESPONSE_RETENTION_DAYS))
    result_cutoff = now - timedelta(days=JOB_RESULT_COMPACT_DAYS)
    job_cutoff = now - timedelta(days=max(1, settings.CRAWL_JOB_RETENTION_DAYS))
    terminal = ["completed", "error"]

    def old_raw():
        newer = aliased(RawResponse)
        # The latest row per Spotify ID backs items' raw_map/export fallbacks: never age it out.
        has_newer = (
            select(newer.id)
            .where(newer.spotify_id == RawResponse.spotify_id, newer.captured_at > RawResponse.captured_at)
            .exists()
        )
        ids = (
            select(RawResponse.id)
            .where(RawResponse.captured_at < raw_cutoff, has_newer)
            .limit(CLEANUP_BATCH_SIZE)
            .correlate(None)
        )
        return delete(RawResponse).where(RawResponse.id.in_(ids))

    def compact_results():
        # Terminal jobs only: pending/crawling jobs (incl. youtube_channel_job markers) are never touched.
        ids = (
            select(CrawlJob.id)
            .where(CrawlJob.status.in_(terminal), CrawlJob.created_at < result_cutoff, CrawlJob.result.is_not(None))
            .limit(CLEANUP_BATCH_SIZE)
            .correlate(None)
        )
        return update(CrawlJob).where(CrawlJob.id.in_(ids)).values(result=null())

    def old_jobs():
        # No table references crawl_jobs (FKs point from crawl_jobs to items/users), so deletion is safe.
        ids = (
            select(CrawlJob.id)
            .where(CrawlJob.status.in_(terminal), CrawlJob.created_at < job_cutoff)
            .limit(CLEANUP_BATCH_SIZE)
            .correlate(None)
        )
        return delete(CrawlJob).where(CrawlJob.id.in_(ids))

    stats = {
        "raw_responses_deleted": await _run_batched(old_raw),
        "job_results_compacted": await _run_batched(compact_results),
        "crawl_jobs_deleted": await _run_batched(old_jobs),
    }
    if any(stats.values()):
        logger.info("Crawl storage cleanup: %s", stats)
    return stats


async def maintenance_loop():
    """Periodic Spotify crawl maintenance: stale-job recovery every minute, storage cleanup hourly."""
    last_cleanup = None
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(MAINTENANCE_INTERVAL_SECONDS)
        try:
            await recover_interrupted_jobs(stale_after=timedelta(minutes=STALE_CRAWL_MINUTES))
        except Exception as ex:
            logger.warning("Spotify stale job recovery failed: %s", type(ex).__name__)
        if last_cleanup is None or loop.time() - last_cleanup >= CLEANUP_INTERVAL_SECONDS:
            last_cleanup = loop.time()
            try:
                await cleanup_crawl_storage()
            except Exception as ex:
                logger.warning("Crawl storage cleanup failed: %s", type(ex).__name__)
