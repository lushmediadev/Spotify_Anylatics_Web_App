"""Crawl request/response schemas."""

import uuid

from pydantic import BaseModel


class CrawlRequest(BaseModel):
    """Single crawl request."""

    url: str
    group: str | None = None
    target_user_id: uuid.UUID | None = None
    item_id: uuid.UUID | None = None
    remove_duplicates: bool = False


class CrawlBatchRequest(BaseModel):
    """Batch crawl request."""

    urls: list[str]
    group: str | None = None
    target_user_id: uuid.UUID | None = None
    item_ids: list[uuid.UUID | None] | None = None
    remove_duplicates: bool = False


class CrawlResponse(BaseModel):
    """Crawl job created response."""

    job_id: str
    status: str = "pending"
    message: str = "Crawl job created"


class CrawlBatchResponse(BaseModel):
    """Batch crawl response."""

    job_ids: list[str]
    count: int
    message: str = "Batch crawl jobs created"
