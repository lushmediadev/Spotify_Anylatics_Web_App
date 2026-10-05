"""Job status schemas."""

from datetime import datetime

from pydantic import BaseModel


class JobResponse(BaseModel):
    id: str
    item_id: str | None = None
    status: str
    youtube_url: str
    spotify_url: str | None = None
    item_type: str | None = None
    error: str | None = None
    result: dict | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class JobBatchRequest(BaseModel):
    job_ids: list[str]


class JobBatchResponse(BaseModel):
    jobs: list[JobResponse]
