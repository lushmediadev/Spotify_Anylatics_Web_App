"""Crawl request/response schemas."""

from pydantic import BaseModel, Field

MAX_BATCH_URLS = 500


class CrawlRequest(BaseModel):
    """Single crawl request."""

    url: str
    group: str | None = None
    target_user_id: str | None = None
    item_id: str | None = None


class CrawlBatchRequest(BaseModel):
    """Batch crawl request."""

    urls: list[str] = Field(max_length=MAX_BATCH_URLS)
    group: str | None = None
    target_user_id: str | None = None
    item_ids: list[str | None] | None = Field(default=None, max_length=MAX_BATCH_URLS)


class CrawlScopeRequest(BaseModel):
    """Refresh every item visible in a list scope without sending full rows to the browser."""

    group: str | None = None
    search: str | None = None
    target_user_id: str | None = None


class CrawlResponse(BaseModel):
    """Crawl job created response."""

    job_id: str | None = None
    item_id: str | None = None
    status: str = "pending"
    skipped_duplicate: bool = False
    message: str = "Crawl job created"


class CrawlBatchResponse(BaseModel):
    """Batch crawl response."""

    job_ids: list[str]
    count: int
    accepted_indices: list[int] = []
    item_ids: list[str] = []
    skipped_duplicates: int = 0
    skipped_in_progress: int = 0
    message: str = "Batch crawl jobs created"
