"""Item schemas - API response models."""

from datetime import datetime

from pydantic import BaseModel


class ItemResponse(BaseModel):
    id: str
    youtube_id: str | None = None
    spotify_id: str | None = None
    type: str = "channel"
    query: str | None = None
    query_type: str | None = None
    name: str | None = None
    youtube_url: str | None = None
    spotify_url: str | None = None
    image: str | None = None
    banner_image: str | None = None

    video_count: int | None = None
    subscriber_count: int | None = None
    view_count: int | None = None
    view_count_delta: int | None = None
    delta_days: int | None = None

    # Compatibility aliases for reused list helpers from the original scaffold.
    followers: int | None = None
    playcount: int | None = None
    track_count: int | None = None
    followers_delta: int | None = None
    playcount_delta: int | None = None
    track_count_delta: int | None = None

    status: str = "pending"
    error_code: int | None = None
    error_message: str | None = None
    group: str | None = None
    user_id: str | None = None
    user_name: str | None = None
    manager_name: str | None = None
    user_avatar: str | None = None
    added_date: str | None = None
    last_checked: datetime | None = None
    created_at: datetime | None = None


class ItemListResponse(BaseModel):
    items: list[ItemResponse]
    total: int


class ItemIdsResponse(BaseModel):
    ids: list[str]
    total: int


class ItemGroupSummary(BaseModel):
    name: str
    count: int


class ItemSummaryResponse(BaseModel):
    total: int
    all_total: int
    active: int
    errors: int
    crawling: int
    groups: list[ItemGroupSummary]


class ItemMoveRequest(BaseModel):
    item_ids: list[str]
    group: str | None = None
    user_id: str | None = None
