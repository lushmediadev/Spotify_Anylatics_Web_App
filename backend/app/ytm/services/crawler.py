"""Crawler service - refreshes YouTube channel rows."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ytm.config import settings
from app.ytm.database import async_session
from app.ytm.models.crawl_job import CrawlJob
from app.ytm.models.item import Item
from app.ytm.models.metric_snapshot import MetricSnapshot
from app.ytm.services.youtube_client import (
    CHANNELS_LIST_BATCH_SIZE,
    YouTubeApiError,
    fetch_channel,
    fetch_channels_by_ids,
    get_active_api_keys,
)
from app.ytm.utils.youtube_urls import ParsedYouTubeChannel

logger = logging.getLogger(__name__)
CRAWL_TASK_SEMAPHORE = asyncio.Semaphore(max(1, settings.CRAWL_TASK_MAX_CONCURRENCY))
_tasks: set[asyncio.Task] = set()


def _start_task(coroutine):
    task = asyncio.create_task(coroutine)
    _tasks.add(task)
    task.add_done_callback(_finished)


def _finished(task):
    _tasks.discard(task)
    if not task.cancelled():
        task.exception()


async def shutdown():
    for task in list(_tasks):
        task.cancel()
    await asyncio.gather(*list(_tasks), return_exceptions=True)


async def recover_interrupted_jobs():
    from sqlalchemy import update
    async with async_session() as db:
        jobs = list((await db.execute(select(CrawlJob).where(CrawlJob.status.in_(["pending", "crawling"])))).scalars())
        for job in jobs:
            job.status = "error"
            job.error = "Refresh interrupted. Please retry."
            job.completed_at = datetime.utcnow()
        ids = [job.item_id for job in jobs if job.item_id]
        if ids:
            await db.execute(update(Item).where(Item.id.in_(ids), Item.status.in_(["pending", "crawling"])).values(status="error", error_message="Refresh interrupted. Please retry."))
        await db.commit()


def _delta_days(previous: datetime | None, current: datetime) -> int | None:
    if previous is None:
        return None
    return max(1, (current.date() - previous.date()).days)


def _job_result(item: Item) -> dict:
    return {
        "id": item.id,
        "youtube_id": item.youtube_id,
        "type": "channel",
        "query": item.query,
        "query_type": item.query_type,
        "name": item.name,
        "image": item.image,
        "banner_image": item.banner_image,
        "video_count": item.video_count,
        "subscriber_count": item.subscriber_count,
        "view_count": item.view_count,
        "view_count_delta": item.view_count_delta,
        "delta_days": item.delta_days,
        "status": item.status,
        "group": item.group,
        "user_id": item.user_id,
        "last_checked": item.last_checked.isoformat() if item.last_checked else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def _apply_success(db: AsyncSession, item: Item, job: CrawlJob, data: dict) -> None:
    checked_at = data["checked_at"]
    previous_view_count = item.view_count
    previous_checked = item.last_checked

    item.youtube_id = data["youtube_id"] or item.youtube_id
    item.name = data["name"] or item.name
    item.image = data["image"] or item.image
    item.banner_image = data["banner_image"] or item.banner_image
    item.video_count = data["video_count"]
    item.subscriber_count = data["subscriber_count"]
    item.view_count = data["view_count"]
    item.last_checked = checked_at
    item.status = "active"
    item.error_code = None
    item.error_message = None

    if previous_view_count is not None and data["view_count"] is not None:
        item.view_count_delta = data["view_count"] - previous_view_count
        item.delta_days = _delta_days(previous_checked, checked_at)
    else:
        item.view_count_delta = None
        item.delta_days = None

    db.add(MetricSnapshot(item_id=item.id, view_count=data["view_count"], checked_at=checked_at))

    job.status = "completed"
    job.error = None
    job.completed_at = datetime.utcnow()
    job.result = _job_result(item)


def _apply_error(item: Item | None, job: CrawlJob, exc: Exception | str) -> None:
    message = str(exc)
    if item is not None:
        item.status = "error"
        item.error_message = message
        item.last_checked = datetime.utcnow()
    job.status = "error"
    job.error = message
    job.completed_at = datetime.utcnow()


def _mark_api_key(api_key, status: str, error: Exception | str | None = None) -> None:
    api_key.last_status = status
    api_key.last_error = str(error) if error else None
    api_key.last_checked_at = datetime.utcnow()


async def _fetch_with_api_keys(db: AsyncSession, parsed: ParsedYouTubeChannel, user_id: str) -> dict:
    api_keys = await get_active_api_keys(db, user_id)
    if not api_keys:
        raise YouTubeApiError("No YouTube API key configured")

    data = None
    last_error: Exception | None = None
    for api_key in api_keys:
        try:
            data = await fetch_channel(parsed, api_key.key)
            _mark_api_key(api_key, "ok")
            break
        except Exception as exc:
            last_error = exc
            _mark_api_key(api_key, "error", exc)

    if data is None:
        raise YouTubeApiError(str(last_error) if last_error else "Could not call YouTube API")
    return data


async def _fetch_id_batch_with_api_keys(db: AsyncSession, channel_ids: Sequence[str], user_id: str) -> dict[str, dict]:
    api_keys = await get_active_api_keys(db, user_id)
    if not api_keys:
        raise YouTubeApiError("No YouTube API key configured")

    data_by_id = None
    last_error: Exception | None = None
    for api_key in api_keys:
        try:
            data_by_id = await fetch_channels_by_ids(channel_ids, api_key.key)
            _mark_api_key(api_key, "ok")
            break
        except Exception as exc:
            last_error = exc
            _mark_api_key(api_key, "error", exc)

    if data_by_id is None:
        raise YouTubeApiError(str(last_error) if last_error else "Could not call YouTube API")
    return data_by_id


async def crawl_item_task(job_id: str, parsed: ParsedYouTubeChannel):
    async with CRAWL_TASK_SEMAPHORE:
        async with async_session() as db:
            job = None
            item = None
            try:
                result = await db.execute(select(CrawlJob).where(CrawlJob.id == job_id))
                job = result.scalar_one_or_none()
                if not job:
                    logger.error("Job %s not found", job_id)
                    return

                job.status = "crawling"
                job.started_at = datetime.utcnow()
                await db.commit()

                item_result = await db.execute(select(Item).where(Item.id == job.item_id))
                item = item_result.scalar_one_or_none()
                if not item:
                    raise YouTubeApiError("Channel row not found")

                data = await _fetch_with_api_keys(db, parsed, item.user_id)
                _apply_success(db, item, job, data)
                await db.commit()
            except Exception as exc:
                logger.warning("YouTube crawl failed job=%s error=%s", job_id, exc)
                if job is not None:
                    if item is None and job.item_id:
                        item_result = await db.execute(select(Item).where(Item.id == job.item_id))
                        item = item_result.scalar_one_or_none()
                    _apply_error(item, job, exc)
                    await db.commit()


async def crawl_channel_id_batch_task(jobs: Sequence[tuple[str, ParsedYouTubeChannel]]):
    if not jobs:
        return
    async with CRAWL_TASK_SEMAPHORE:
        async with async_session() as db:
            job_ids = [job_id for job_id, _ in jobs]
            job_by_id: dict[str, CrawlJob] = {}
            item_by_id: dict[str, Item] = {}
            try:
                result = await db.execute(select(CrawlJob).where(CrawlJob.id.in_(job_ids)))
                job_by_id = {job.id: job for job in result.scalars().all()}

                item_ids = [job.item_id for job in job_by_id.values() if job.item_id]
                if item_ids:
                    item_result = await db.execute(select(Item).where(Item.id.in_(item_ids)))
                    item_by_id = {item.id: item for item in item_result.scalars().all()}

                for job in job_by_id.values():
                    job.status = "crawling"
                    job.started_at = datetime.utcnow()
                await db.commit()

                channel_ids = [parsed.query for _, parsed in jobs if parsed.query_type == "id"]
                owners = {item.user_id for item in item_by_id.values()}
                if len(owners) != 1:
                    raise YouTubeApiError("Batch must belong to one account")
                data_by_id = await _fetch_id_batch_with_api_keys(db, channel_ids, next(iter(owners)))

                for job_id, parsed in jobs:
                    job = job_by_id.get(job_id)
                    if not job:
                        continue
                    item = item_by_id.get(str(job.item_id))
                    if not item:
                        _apply_error(None, job, "Channel row not found")
                        continue
                    data = data_by_id.get(parsed.query)
                    if not data:
                        _apply_error(item, job, "Channel not found")
                        continue
                    _apply_success(db, item, job, data)
                await db.commit()
            except Exception as exc:
                logger.warning("YouTube batch crawl failed jobs=%s error=%s", len(jobs), exc)
                if not job_by_id:
                    result = await db.execute(select(CrawlJob).where(CrawlJob.id.in_(job_ids)))
                    job_by_id = {job.id: job for job in result.scalars().all()}
                if not item_by_id:
                    item_ids = [job.item_id for job in job_by_id.values() if job.item_id]
                    if item_ids:
                        item_result = await db.execute(select(Item).where(Item.id.in_(item_ids)))
                        item_by_id = {item.id: item for item in item_result.scalars().all()}
                for job in job_by_id.values():
                    _apply_error(item_by_id.get(str(job.item_id)), job, exc)
                await db.commit()


def _chunked_jobs(jobs: Sequence[tuple[str, ParsedYouTubeChannel]]) -> list[list[tuple[str, ParsedYouTubeChannel]]]:
    return [list(jobs[index:index + CHANNELS_LIST_BATCH_SIZE]) for index in range(0, len(jobs), CHANNELS_LIST_BATCH_SIZE)]


def schedule_crawl_jobs(jobs: Sequence[tuple[str, ParsedYouTubeChannel]]) -> None:
    """Schedule crawl jobs, batching direct channel IDs into channels.list requests."""
    direct_id_jobs = [job for job in jobs if job[1].query_type == "id"]
    resolve_jobs = [job for job in jobs if job[1].query_type != "id"]

    for batch in _chunked_jobs(direct_id_jobs):
        _start_task(crawl_channel_id_batch_task(batch))
    for job_id, parsed in resolve_jobs:
        _start_task(crawl_item_task(job_id, parsed))
