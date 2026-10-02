"""Tracked, bounded workers; committed channel status is the durable job marker."""

import asyncio
from datetime import datetime, timedelta

from sqlalchemy import delete, or_, select, update

from app import database
from app.models.youtube import Channel, ChannelPlaylist, ChannelSnapshot, YouTubeApiKey
from app.models.user import User
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.services.crawler import crawl_item_task
from app.services.youtube import YouTubeClient

_tasks: set[asyncio.Task] = set()
_channel_slots = asyncio.Semaphore(3)
_spotify_slots = asyncio.Semaphore(4)
_owner_locks: dict = {}
LEASE_SECONDS = 600
FETCH_TIMEOUT_SECONDS = 300


def track(coroutine):
    task = asyncio.create_task(coroutine)
    _tasks.add(task)
    task.add_done_callback(_task_done)
    return task


def _task_done(task):
    _tasks.discard(task)
    if not task.cancelled():
        # Retrieve exceptions without printing possibly credential-bearing tracebacks.
        task.exception()


async def recover_stale_channels():
    cutoff = datetime.utcnow() - timedelta(seconds=LEASE_SECONDS)
    async with database.async_session() as db:
        await db.execute(update(Channel).where(Channel.status == "crawling", or_(
            Channel.refresh_started_at.is_(None), Channel.refresh_started_at < cutoff,
        )).values(
            status="error", error_code="refresh_interrupted",
            error_message="Refresh interrupted. Please retry.", refresh_started_at=None,
        ))
        jobs = list((await db.execute(select(CrawlJob).where(
            CrawlJob.status.in_(["pending", "crawling"]), CrawlJob.created_at < cutoff,
            or_(CrawlJob.started_at.is_(None), CrawlJob.started_at < cutoff),
        ))).scalars())
        for job in jobs:
            if isinstance(job.result, dict) and job.result.get("youtube_channel_job"):
                await _interrupt_spotify_job(db, job)
        await db.commit()


async def maintenance():
    while True:
        await asyncio.sleep(60)
        try:
            await recover_stale_channels()
        except Exception:
            # A transient DB outage must not permanently stop lease recovery.
            continue


async def shutdown():
    for task in list(_tasks):
        task.cancel()
    if _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)
    _owner_locks.clear()


async def _record_failure(ids, attempts):
    async with database.async_session() as db:
        for channel_id in ids:
            if channel_id not in attempts:
                continue
            await db.execute(update(Channel).where(Channel.id == channel_id, Channel.status == "crawling",
                Channel.refresh_started_at == attempts[channel_id]).values(
                status="error", error_code="refresh_failed", error_message="Refresh failed. Please retry.",
                refresh_started_at=None, last_checked=datetime.utcnow(),
            ))
        await db.commit()


async def refresh_channels(owner_id, channel_ids, attempts=None):
    lock = _owner_locks.setdefault(owner_id, asyncio.Lock())
    expected = dict(attempts or {})
    try:
        async with lock, _channel_slots:
            async with database.async_session() as db:
                channels = list((await db.execute(select(Channel).where(
                    Channel.id.in_(channel_ids), Channel.user_id == owner_id, Channel.status == "crawling",
                ).order_by(Channel.created_at, Channel.id))).scalars())
                if attempts is not None:
                    channels = [row for row in channels if row.refresh_started_at == expected.get(row.id)]
                else:
                    expected = {row.id: row.refresh_started_at for row in channels}
                if not channels:
                    return
                keys = list((await db.execute(select(YouTubeApiKey.key).where(
                    YouTubeApiKey.user_id == owner_id,
                ).order_by(YouTubeApiKey.position))).scalars())
                client = YouTubeClient(keys)
                queries = [("id", row.youtube_id) if row.youtube_id else (row.query_type, row.query) for row in channels]
                # Do not keep a DB transaction or owner lock during network calls.
                await db.commit()
                results = await asyncio.wait_for(client.fetch_channels(queries), timeout=FETCH_TIMEOUT_SECONDS)
                if len(results) != len(channels):
                    raise ValueError("Incomplete channel results")
                await db.execute(select(User.id).where(User.id == owner_id).with_for_update())
                processed_ids = set()
                for row, result in zip(channels, results):
                    # Skip channels deleted while the external request was running.
                    current = (await db.execute(select(Channel).where(Channel.id == row.id)
                        .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
                    if current is None:
                        continue
                    row = current
                    if row.status != "crawling" or row.refresh_started_at != expected.get(row.id):
                        continue
                    if row.id in processed_ids:
                        continue
                    now = datetime.utcnow()
                    row.last_checked = now
                    row.refresh_started_at = None
                    if result.get("error_code") or not result.get("youtube_id"):
                        row.status = "error"
                        row.error_code = result.get("error_code") or "channel_not_found"
                        row.error_message = result.get("error_message") or "Channel could not be resolved."
                        continue
                    canonical = (await db.execute(select(Channel).where(
                        Channel.user_id == owner_id, Channel.youtube_id == result["youtube_id"], Channel.id != row.id,
                    ))).scalar_one_or_none()
                    if canonical:
                        source_attempt = expected.get(row.id)
                        linked = list((await db.execute(select(ChannelPlaylist.item_id).where(ChannelPlaylist.channel_id == row.id))).scalars())
                        existing = set((await db.execute(select(ChannelPlaylist.item_id).where(ChannelPlaylist.channel_id == canonical.id))).scalars())
                        for item_id in linked:
                            if item_id not in existing:
                                db.add(ChannelPlaylist(channel_id=canonical.id, item_id=item_id))
                        await db.execute(delete(ChannelPlaylist).where(ChannelPlaylist.channel_id == row.id))
                        await db.execute(delete(ChannelSnapshot).where(ChannelSnapshot.channel_id == row.id))
                        await db.delete(row)
                        await db.flush()
                        row = canonical
                        if row.id in processed_ids:
                            continue
                        if row.status == "crawling" and row.refresh_started_at != expected.get(row.id):
                            continue
                        if source_attempt and row.last_checked and row.last_checked > source_attempt:
                            continue
                        row.last_checked = now
                        row.refresh_started_at = None
                    views = result.get("view_count")
                    if views is not None:
                        previous = (await db.execute(select(ChannelSnapshot).where(ChannelSnapshot.channel_id == row.id)
                            .order_by(ChannelSnapshot.captured_at.desc(), ChannelSnapshot.id.desc()).limit(1))).scalar_one_or_none()
                        row.view_count_delta = views - previous.view_count if previous else None
                        row.delta_days = max(0, (now - previous.captured_at).days) if previous else None
                        db.add(ChannelSnapshot(channel_id=row.id, view_count=views, captured_at=now))
                    for field in ("youtube_id", "name", "image", "banner", "view_count"):
                        setattr(row, field, result.get(field))
                    row.status, row.error_code, row.error_message = "active", None, None
                    processed_ids.add(row.id)
                    await db.flush()
                await db.commit()
    except asyncio.CancelledError:
        raise
    except Exception:
        # Never persist or log external exception text: it may contain API keys.
        await _record_failure(channel_ids, expected)
    finally:
        if not lock.locked():
            # Keep locks with queued waiters until they finish.
            if not getattr(lock, "_waiters", None):
                _owner_locks.pop(owner_id, None)


async def run_spotify_job(job_id, spotify_id):
    try:
        async with _spotify_slots:
            async with database.async_session() as db:
                job = (await db.execute(select(CrawlJob).where(CrawlJob.id == job_id))).scalar_one_or_none()
                if job and job.status not in {"pending", "crawling"}:
                    return
            await asyncio.wait_for(crawl_item_task(str(job_id), spotify_id, "playlist"), timeout=FETCH_TIMEOUT_SECONDS)
    except BaseException:
        async with database.async_session() as db:
            job = (await db.execute(select(CrawlJob).where(CrawlJob.id == job_id).with_for_update())).scalar_one_or_none()
            if job and job.status in {"pending", "crawling"}:
                await _interrupt_spotify_job(db, job)
                await db.commit()
        raise


async def _interrupt_spotify_job(db, job):
    job.status = "error"
    job.error = "Playlist refresh interrupted. Please retry."
    job.completed_at = datetime.utcnow()
    other = (await db.execute(select(CrawlJob.id).where(CrawlJob.item_id == job.item_id,
        CrawlJob.id != job.id, CrawlJob.status.in_(["pending", "crawling"])).limit(1))).scalar_one_or_none()
    if other is None:
        await db.execute(update(Item).where(Item.id == job.item_id, Item.status == "crawling").values(
            status="error", error_code=503, error_message=job.error,
        ))
