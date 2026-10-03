"""Crawl endpoints - trigger crawl jobs."""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.models.user import User
from app.schemas.crawl import (
    CrawlRequest,
    CrawlBatchRequest,
    CrawlResponse,
    CrawlBatchResponse,
)
from app.utils.spotify_urls import parse_spotify_url
from app.services.crawler import crawl_item_task
from app.services.auth import get_current_user, require_user_access, owner_scope_condition

router = APIRouter()


async def _resolve_target_user_id(
    db: AsyncSession, current_user: User, requested_user_id: uuid.UUID | None
) -> uuid.UUID:
    if requested_user_id is None:
        return current_user.id

    if requested_user_id == current_user.id:
        return current_user.id
    target_user = await require_user_access(db, current_user, requested_user_id)
    return target_user.id


async def _resolve_refresh_item(
    db: AsyncSession,
    current_user: User,
    item_id: uuid.UUID,
    target_user_id: uuid.UUID | None,
    expected_type: str,
    expected_spotify_id: str,
) -> Item:
    item_result = await db.execute(select(Item).where(
        Item.id == item_id, owner_scope_condition(current_user, Item.user_id),
    ))
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found for refresh")

    if target_user_id and item.user_id != target_user_id:
        raise HTTPException(status_code=400, detail="target_user_id does not match item owner")

    if item.item_type != expected_type or item.spotify_id != expected_spotify_id:
        raise HTTPException(status_code=400, detail="item_id does not match URL")

    return item


async def _find_existing_owned_item(
    db: AsyncSession,
    current_user: User,
    target_user_id: uuid.UUID,
    item_type: str,
    spotify_id: str,
) -> Item | None:
    query = select(Item).where(
        Item.spotify_id == spotify_id,
        Item.item_type == item_type,
    )

    query = query.where(
        owner_scope_condition(current_user, Item.user_id), Item.user_id == target_user_id,
    )

    result = await db.execute(query.order_by(Item.updated_at.desc()))
    return result.scalars().first()


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
            target_user_id=req.target_user_id,
            expected_type=item_type,
            expected_spotify_id=spotify_id,
        )
        if req.group is not None:
            item.group = requested_group
    else:
        if requested_group is None:
            raise HTTPException(
                status_code=400,
                detail="Select a group before adding a new link",
            )
        existing_item = await _find_existing_owned_item(
            db=db,
            current_user=current_user,
            target_user_id=target_user_id,
            item_type=item_type,
            spotify_id=spotify_id,
        )
        if existing_item:
            return CrawlResponse(
                job_id=None,
                item_id=str(existing_item.id),
                status="duplicate",
                skipped_duplicate=True,
                message="Link already exists for this user",
            )
        item = Item(
            spotify_id=spotify_id,
            item_type=item_type,
            status="crawling",
            group=requested_group,
            user_id=target_user_id,
        )
        db.add(item)
        await db.flush()
    item.status = "crawling"
    item.error_code = None
    item.error_message = None

    # Create crawl job
    job = CrawlJob(
        item_id=item.id,
        spotify_url=req.url,
        item_type=item_type,
        status="pending",
        user_id=item.user_id or current_user.id,
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
    accepted_indices: list[int] = []
    background_jobs: list[tuple[str, str, str]] = []
    skipped_duplicates = 0
    target_user_id = await _resolve_target_user_id(db, current_user, req.target_user_id)
    requested_group = (req.group or "").strip() or None
    if req.item_ids is not None and len(req.item_ids) != len(req.urls):
        raise HTTPException(status_code=400, detail="item_ids must align with urls length")
    item_ids = req.item_ids if req.item_ids is not None else [None] * len(req.urls)

    for idx, url in enumerate(req.urls):
        parsed = parse_spotify_url(url)
        if not parsed:
            continue  # Skip invalid URLs

        item_type, spotify_id = parsed
        refresh_item_id = item_ids[idx] if idx < len(item_ids) else None
        if refresh_item_id:
            item = await _resolve_refresh_item(
                db=db,
                current_user=current_user,
                item_id=refresh_item_id,
                target_user_id=req.target_user_id,
                expected_type=item_type,
                expected_spotify_id=spotify_id,
            )
            if req.group is not None:
                item.group = requested_group
        else:
            if requested_group is None:
                raise HTTPException(
                    status_code=400,
                    detail="Select a group before adding new links",
                )
            existing_item = await _find_existing_owned_item(
                db=db,
                current_user=current_user,
                target_user_id=target_user_id,
                item_type=item_type,
                spotify_id=spotify_id,
            )
            if existing_item:
                skipped_duplicates += 1
                continue
            item = Item(
                spotify_id=spotify_id,
                item_type=item_type,
                status="crawling",
                group=requested_group,
                user_id=target_user_id,
            )
            db.add(item)
            await db.flush()
        item.status = "crawling"
        item.error_code = None
        item.error_message = None

        job = CrawlJob(
            item_id=item.id,
            spotify_url=url,
            item_type=item_type,
            status="pending",
            user_id=item.user_id or current_user.id,
        )
        db.add(job)
        await db.flush()

        job_id = str(job.id)
        job_ids.append(job_id)
        accepted_indices.append(idx)
        background_jobs.append((job_id, spotify_id, item_type))

    # Persist all created jobs before scheduling any background task.
    await db.commit()

    for job_id, spotify_id, item_type in background_jobs:
        asyncio.create_task(crawl_item_task(job_id, spotify_id, item_type))

    return CrawlBatchResponse(
        job_ids=job_ids,
        count=len(job_ids),
        accepted_indices=accepted_indices,
        skipped_duplicates=skipped_duplicates,
        message=(
            "No new crawl jobs created because all links already exist for this user"
            if not job_ids and skipped_duplicates
            else "Batch crawl jobs created"
        ),
    )
