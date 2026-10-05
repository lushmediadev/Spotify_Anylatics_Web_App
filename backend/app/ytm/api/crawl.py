"""Crawl endpoints - trigger YouTube channel refresh jobs."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ytm.database import get_db
from app.ytm.models.crawl_job import CrawlJob
from app.ytm.models.item import Item
from app.ytm.models.user import User
from app.ytm.schemas.crawl import CrawlBatchRequest, CrawlBatchResponse, CrawlRequest, CrawlResponse, CrawlScopeRequest
from app.ytm.services.auth import get_current_user
from app.ytm.services.crawler import schedule_crawl_jobs
from app.ytm.utils.youtube_urls import build_channel_url, parse_youtube_channel_url

router = APIRouter()


async def _target_user_id(db: AsyncSession, actor: User, requested_user_id: str | None) -> str:
    if not requested_user_id:
        return actor.id
    if actor.role == "admin":
        target = await db.get(User, requested_user_id)
        if not target:
            raise HTTPException(status_code=404, detail="Target user not found")
        return target.id
    if actor.role == "manager":
        target = await db.get(User, requested_user_id)
        if not target or not (target.id == actor.id or target.manager_id == actor.id):
            raise HTTPException(status_code=403, detail="Not authorized to set target user")
        return target.id
    if requested_user_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized to set target user")
    return actor.id


async def _existing_item(db: AsyncSession, target_user_id: str, query_type: str, query: str) -> Item | None:
    result = await db.execute(
        select(Item).where(
            Item.user_id == target_user_id,
            Item.query_type == query_type,
            Item.query == query,
        )
    )
    return result.scalar_one_or_none()


async def _ensure_item_access(db: AsyncSession, actor: User, item: Item) -> None:
    if actor.role == "admin":
        return
    if actor.role == "manager":
        allowed = await db.execute(
            select(User.id).where(or_(User.id == actor.id, User.manager_id == actor.id))
        )
        if item.user_id in {row[0] for row in allowed.all()}:
            return
    elif item.user_id == actor.id:
        return
    raise HTTPException(status_code=403, detail="Not authorized to refresh this item")


def _plain_query_value(value, default=None):
    return default if value.__class__.__name__ == "Query" else value


def _item_refresh_url(item: Item) -> str:
    return build_channel_url(item.youtube_id, item.query if item.query_type == "url" else None)


def _item_matches_search(item: Item, search: str | None) -> bool:
    clean = (search or "").strip().lower()
    if not clean:
        return True
    values = [item.name, item.youtube_id, item.query, item.group]
    return any(clean in str(value or "").lower() for value in values)


async def _visible_user_ids(db: AsyncSession, actor: User, requested_user_id: str | None = None) -> list[str]:
    if actor.role == "admin":
        if requested_user_id:
            return [requested_user_id]
        result = await db.execute(select(User.id))
        return [row[0] for row in result.all()]
    if actor.role == "manager":
        if requested_user_id:
            result = await db.execute(
                select(User).where(or_(User.id == actor.id, User.manager_id == actor.id), User.id == requested_user_id)
            )
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=403, detail="Not authorized for this user")
            return [requested_user_id]
        result = await db.execute(select(User.id).where(or_(User.id == actor.id, User.manager_id == actor.id)))
        return [row[0] for row in result.all()]
    if requested_user_id and requested_user_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized for this user")
    return [actor.id]


async def _create_refresh_jobs(
    db: AsyncSession,
    items: list[Item],
    current_user: User,
) -> tuple[list[str], list[str], list[tuple[str, object]]]:
    job_ids: list[str] = []
    item_ids: list[str] = []
    background: list[tuple[str, object]] = []
    jobs: list[tuple[CrawlJob, object]] = []

    for item in items:
        parsed = parse_youtube_channel_url(_item_refresh_url(item))
        if not parsed:
            continue
        item.status = "crawling"
        item.error_message = None
        job = CrawlJob(
            item_id=item.id,
            youtube_url=parsed.url,
            item_type="channel",
            status="pending",
            user_id=current_user.id,
        )
        db.add(job)
        jobs.append((job, parsed))

    if not jobs:
        return job_ids, item_ids, background

    await db.flush()
    for job, parsed in jobs:
        job_ids.append(job.id)
        item_ids.append(str(job.item_id))
        background.append((job.id, parsed))
    return job_ids, item_ids, background


@router.post("/crawl", response_model=CrawlResponse)
async def crawl(req: CrawlRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    parsed = parse_youtube_channel_url(req.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Invalid YouTube channel URL")

    target_user_id = await _target_user_id(db, current_user, req.target_user_id)
    requested_group = (req.group or "").strip() or None

    if req.item_id:
        item = await db.get(Item, req.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        await _ensure_item_access(db, current_user, item)
        if req.group is not None:
            item.group = requested_group
    else:
        existing = await _existing_item(db, target_user_id, parsed.query_type, parsed.query)
        if existing:
            return CrawlResponse(
                job_id=None,
                item_id=existing.id,
                status="duplicate",
                skipped_duplicate=True,
                message="Channel already exists for this user",
            )
        item = Item(
            query=parsed.query,
            query_type=parsed.query_type,
            item_type="channel",
            name=parsed.query,
            status="crawling",
            group=requested_group,
            user_id=target_user_id,
        )
        if parsed.query_type == "id":
            item.youtube_id = parsed.query
        db.add(item)
        await db.flush()

    item.status = "crawling"
    item.error_message = None
    job = CrawlJob(
        item_id=item.id,
        youtube_url=parsed.url,
        item_type="channel",
        status="pending",
        user_id=current_user.id,
    )
    db.add(job)
    await db.flush()
    job_id = job.id
    await db.commit()
    schedule_crawl_jobs([(job_id, parsed)])
    return CrawlResponse(job_id=job_id, status="pending")


@router.post("/crawl/batch", response_model=CrawlBatchResponse)
async def crawl_batch(req: CrawlBatchRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.item_ids is not None and len(req.item_ids) != len(req.urls):
        raise HTTPException(status_code=400, detail="item_ids must align with urls length")

    job_ids: list[str] = []
    accepted_indices: list[int] = []
    skipped_duplicates = 0
    target_user_id = await _target_user_id(db, current_user, req.target_user_id)
    requested_group = (req.group or "").strip() or None
    requested_item_ids = req.item_ids if req.item_ids is not None else [None] * len(req.urls)
    refreshed_item_ids: list[str] = []
    background: list[tuple[str, object]] = []

    for idx, url in enumerate(req.urls):
        parsed = parse_youtube_channel_url(url)
        if not parsed:
            continue
        refresh_item_id = requested_item_ids[idx] if idx < len(requested_item_ids) else None
        if refresh_item_id:
            item = await db.get(Item, refresh_item_id)
            if not item:
                continue
            await _ensure_item_access(db, current_user, item)
            if req.group is not None:
                item.group = requested_group
        else:
            existing = await _existing_item(db, target_user_id, parsed.query_type, parsed.query)
            if existing:
                skipped_duplicates += 1
                continue
            item = Item(
                query=parsed.query,
                query_type=parsed.query_type,
                item_type="channel",
                name=parsed.query,
                youtube_id=parsed.query if parsed.query_type == "id" else None,
                status="crawling",
                group=requested_group,
                user_id=target_user_id,
            )
            db.add(item)
            await db.flush()

        item.status = "crawling"
        item.error_message = None
        job = CrawlJob(
            item_id=item.id,
            youtube_url=parsed.url,
            item_type="channel",
            status="pending",
            user_id=current_user.id,
        )
        db.add(job)
        await db.flush()
        job_ids.append(job.id)
        accepted_indices.append(idx)
        if job.item_id:
            refreshed_item_ids.append(job.item_id)
        background.append((job.id, parsed))

    await db.commit()
    schedule_crawl_jobs(background)

    return CrawlBatchResponse(
        job_ids=job_ids,
        count=len(job_ids),
        accepted_indices=accepted_indices,
        item_ids=refreshed_item_ids,
        skipped_duplicates=skipped_duplicates,
        message="Batch crawl jobs created",
    )


@router.post("/crawl/scope", response_model=CrawlBatchResponse)
async def crawl_scope(
    req: CrawlScopeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visible_ids = await _visible_user_ids(db, current_user, req.target_user_id)
    query = select(Item).where(Item.user_id.in_(visible_ids))
    group = (req.group or "").strip()
    if group:
        query = query.where(Item.group == group)
    result = await db.execute(query)
    items = [item for item in result.scalars().all() if _item_matches_search(item, req.search)]

    job_ids, refreshed_item_ids, background = await _create_refresh_jobs(db, items, current_user)
    await db.commit()
    schedule_crawl_jobs(background)

    return CrawlBatchResponse(
        job_ids=job_ids,
        count=len(job_ids),
        accepted_indices=list(range(len(job_ids))),
        item_ids=refreshed_item_ids,
        message="Scope crawl jobs created",
    )
