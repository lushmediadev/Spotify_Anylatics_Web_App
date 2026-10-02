"""Jobs endpoints â€” check crawl job status."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.crawl_job import CrawlJob
from app.models.item import Item
from app.models.user import User
from app.schemas.job import JobBatchRequest, JobBatchResponse, JobResponse
from app.services.auth import get_current_user, owner_scope_condition

router = APIRouter()


def _job_scope_condition(current_user: User):
    if current_user.role == "admin":
        return owner_scope_condition(current_user, CrawlJob.user_id)
    # Older jobs store the initiator, not necessarily the item's owner.
    # Resolve ownership in SQL so reassignment immediately revokes access.
    owned_item = select(Item.id).where(
        Item.id == CrawlJob.item_id,
        owner_scope_condition(current_user, Item.user_id),
    ).exists()
    return or_(
        owned_item,
        and_(CrawlJob.item_id.is_(None), owner_scope_condition(current_user, CrawlJob.user_id)),
    )


def _serialize_job(job: CrawlJob) -> JobResponse:
    return JobResponse(
        id=str(job.id),
        item_id=str(job.item_id) if job.item_id else None,
        status=job.status,
        spotify_url=job.spotify_url,
        item_type=job.item_type,
        error=job.error,
        result=job.result,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


@router.post("/jobs/batch", response_model=JobBatchResponse)
async def get_jobs_batch(
    req: JobBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get statuses for multiple crawl jobs in one request."""
    ordered_job_ids: list[str] = []
    parsed_job_ids: list[uuid.UUID] = []
    seen: set[str] = set()

    for raw_job_id in req.job_ids:
        try:
            parsed = uuid.UUID(str(raw_job_id))
        except (TypeError, ValueError):
            continue
        parsed_str = str(parsed)
        if parsed_str in seen:
            continue
        seen.add(parsed_str)
        ordered_job_ids.append(parsed_str)
        parsed_job_ids.append(parsed)

    if not parsed_job_ids:
        return JobBatchResponse(jobs=[])

    query = select(CrawlJob).where(CrawlJob.id.in_(parsed_job_ids))
    query = query.where(_job_scope_condition(current_user))

    result = await db.execute(query)
    job_map = {str(job.id): job for job in result.scalars().all()}
    ordered_jobs = [
        _serialize_job(job_map[job_id])
        for job_id in ordered_job_ids
        if job_id in job_map
    ]
    return JobBatchResponse(jobs=ordered_jobs)


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get crawl job status."""
    try:
        parsed_id = uuid.UUID(str(job_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid job_id") from exc
    result = await db.execute(select(CrawlJob).where(
        CrawlJob.id == parsed_id, _job_scope_condition(current_user),
    ))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return _serialize_job(job)
