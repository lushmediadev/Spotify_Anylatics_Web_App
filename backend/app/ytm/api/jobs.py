"""Job endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ytm.database import get_db
from app.ytm.models.crawl_job import CrawlJob
from app.ytm.models.item import Item
from app.ytm.models.user import User
from app.ytm.schemas.job import JobBatchRequest, JobBatchResponse, JobResponse
from app.ytm.services.auth import get_current_user
from app.ytm.utils.youtube_urls import build_channel_url

router = APIRouter()


async def _can_see_job(db: AsyncSession, user: User, job: CrawlJob) -> bool:
    if user.role == "admin":
        return True
    if not job.item_id:
        return job.user_id == user.id
    item = await db.get(Item, job.item_id)
    if not item:
        return job.user_id == user.id
    if user.role == "manager":
        owner = await db.get(User, item.user_id)
        return bool(owner and (owner.id == user.id or owner.manager_id == user.id))
    return item.user_id == user.id


def _response(job: CrawlJob) -> JobResponse:
    return JobResponse(
        id=job.id,
        item_id=job.item_id,
        status=job.status,
        youtube_url=job.youtube_url,
        spotify_url=job.youtube_url,
        item_type=job.item_type,
        error=job.error,
        result=job.result,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = await db.get(CrawlJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not await _can_see_job(db, current_user, job):
        raise HTTPException(status_code=403, detail="Not authorized for this job")
    return _response(job)


@router.post("/jobs/batch", response_model=JobBatchResponse)
async def get_jobs_batch(req: JobBatchRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not req.job_ids:
        return JobBatchResponse(jobs=[])
    result = await db.execute(select(CrawlJob).where(CrawlJob.id.in_([str(x) for x in req.job_ids])))
    jobs = []
    for job in result.scalars().all():
        if await _can_see_job(db, current_user, job):
            jobs.append(_response(job))
    return JobBatchResponse(jobs=jobs)
