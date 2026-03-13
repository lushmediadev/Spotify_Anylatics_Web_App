"""Crawl endpoints - trigger crawl jobs."""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.user import User
from app.schemas.crawl import (
    CrawlRequest,
    CrawlBatchRequest,
    CrawlResponse,
    CrawlBatchResponse,
)
from app.utils.spotify_urls import parse_spotify_url
from app.services.crawler import crawl_item_task
from app.services.auth import get_current_user

router = APIRouter()


async def _resolve_target_user_id(
    db: AsyncSession, current_user: User, requested_user_id: uuid.UUID | None
) -> uuid.UUID:
    if requested_user_id is None:
        return current_user.id

    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to set target user")

    user_result = await db.execute(select(User).where(User.id == requested_user_id))
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")

    return target_user.id


async def _resolve_refresh_item(
    db: AsyncSession,
    current_user: User,
    item_id: uuid.UUID,
    target_user_id: uuid.UUID | None,
    expected_type: str,
    expected_spotify_id: str,
) -> Item:
    item_result = await db.execute(select(Item).where(Item.id == item_id))
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found for refresh")

    if current_user.role != "admin" and item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to refresh this item")

    if target_user_id and item.user_id != target_user_id:
        raise HTTPException(status_code=400, detail="target_user_id does not match item owner")

    if item.item_type != expected_type or item.spotify_id != expected_spotify_id:
        raise HTTPException(status_code=400, detail="item_id does not match URL")

    return item


async def _delete_duplicate_rows(db: AsyncSession, duplicates: list[Item]) -> None:
    if not duplicates:
        return
    duplicate_ids = [item.id for item in duplicates if item and item.id]
    if not duplicate_ids:
        return
    await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id.in_(duplicate_ids)))
    await db.execute(delete(CrawlJob).where(CrawlJob.item_id.in_(duplicate_ids)))
    for item in duplicates:
        await db.delete(item)


async def _resolve_or_create_item(
    db: AsyncSession,
    *,
    spotify_id: str,
    item_type: str,
    target_user_id: uuid.UUID,
    requested_group: str | None,
    remove_duplicates: bool,
) -> Item:
    if remove_duplicates:
        duplicate_query = select(Item).where(
            Item.spotify_id == spotify_id,
            Item.item_type == item_type,
            Item.user_id == target_user_id,
        )
        if requested_group is None:
            duplicate_query = duplicate_query.where(Item.group.is_(None))
        else:
            duplicate_query = duplicate_query.where(Item.group == requested_group)
        duplicates = (
            await db.execute(
                duplicate_query.order_by(Item.updated_at.desc(), Item.created_at.desc())
            )
        ).scalars().all()
        if duplicates:
            primary = duplicates[0]
            if requested_group is not None:
                primary.group = requested_group
            await _delete_duplicate_rows(db, duplicates[1:])
            return primary

    item = Item(
        spotify_id=spotify_id,
        item_type=item_type,
        status="crawling",
        group=requested_group,
        user_id=target_user_id,
    )
    db.add(item)
    await db.flush()
    return item


@router.post("/crawl", response_model=CrawlResponse)
async def crawl(
    req: CrawlRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start a crawl job for a single Spotify URL."""
    parsed = parse_spotify_url(req.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Invalid Spotify URL or URI")

    item_type, spotify_id = parsed
    target_user_id = await _resolve_target_user_id(db, current_user, req.target_user_id)
    requested_group = (req.group or "").strip() or None

    if req.item_id:
        item = await _resolve_refresh_item(
            db=db,
            current_user=current_user,
            item_id=req.item_id,
            target_user_id=target_user_id,
            expected_type=item_type,
            expected_spotify_id=spotify_id,
        )
        if req.group is not None:
            item.group = requested_group
    else:
        item = await _resolve_or_create_item(
            db,
            spotify_id=spotify_id,
            item_type=item_type,
            target_user_id=target_user_id,
            requested_group=requested_group,
            remove_duplicates=bool(req.remove_duplicates),
        )
    item.status = "crawling"
    item.error_code = None
    item.error_message = None

    # Create crawl job
    job = CrawlJob(
        item_id=item.id,
        spotify_url=req.url,
        item_type=item_type,
        status="pending",
        user_id=current_user.id,
    )
    db.add(job)
    await db.flush()

    job_id = str(job.id)

    # Persist before scheduling background work so task can always read the job row.
    await db.commit()

    # Run in event loop without request/response lifecycle coupling.
    asyncio.create_task(crawl_item_task(job_id, spotify_id, item_type))

    return CrawlResponse(job_id=job_id, status="pending")


@router.post("/crawl/batch", response_model=CrawlBatchResponse)
async def crawl_batch(
    req: CrawlBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start crawl jobs for multiple Spotify URLs."""
    job_ids = []
    background_jobs: list[tuple[str, str, str]] = []
    target_user_id = await _resolve_target_user_id(db, current_user, req.target_user_id)
    requested_group = (req.group or "").strip() or None
    if req.item_ids is not None and len(req.item_ids) != len(req.urls):
        raise HTTPException(status_code=400, detail="item_ids must align with urls length")
    item_ids = req.item_ids if req.item_ids is not None else [None] * len(req.urls)
    seen_batch_keys: set[tuple[str, str, str, str]] = set()

    for idx, url in enumerate(req.urls):
        parsed = parse_spotify_url(url)
        if not parsed:
            continue  # Skip invalid URLs

        item_type, spotify_id = parsed
        refresh_item_id = item_ids[idx] if idx < len(item_ids) else None
        if req.remove_duplicates and not refresh_item_id:
            dedupe_key = (
                item_type,
                spotify_id,
                str(target_user_id),
                requested_group or "",
            )
            if dedupe_key in seen_batch_keys:
                continue
            seen_batch_keys.add(dedupe_key)
        if refresh_item_id:
            item = await _resolve_refresh_item(
                db=db,
                current_user=current_user,
                item_id=refresh_item_id,
                target_user_id=target_user_id,
                expected_type=item_type,
                expected_spotify_id=spotify_id,
            )
            if req.group is not None:
                item.group = requested_group
        else:
            item = await _resolve_or_create_item(
                db,
                spotify_id=spotify_id,
                item_type=item_type,
                target_user_id=target_user_id,
                requested_group=requested_group,
                remove_duplicates=bool(req.remove_duplicates),
            )
        item.status = "crawling"
        item.error_code = None
        item.error_message = None

        job = CrawlJob(
            item_id=item.id,
            spotify_url=url,
            item_type=item_type,
            status="pending",
            user_id=current_user.id,
        )
        db.add(job)
        await db.flush()

        job_id = str(job.id)
        job_ids.append(job_id)
        background_jobs.append((job_id, spotify_id, item_type))

    # Persist all created jobs before scheduling any background task.
    await db.commit()

    for job_id, spotify_id, item_type in background_jobs:
        asyncio.create_task(crawl_item_task(job_id, spotify_id, item_type))

    return CrawlBatchResponse(job_ids=job_ids, count=len(job_ids))
