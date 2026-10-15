"""Item schemas — API response models."""

from datetime import datetime
import uuid
from pydantic import BaseModel


class AlbumTrackExport(BaseModel):
    """Export-friendly album track row."""

    artist_names: str
    track_name: str
    spotify_url: str | None = None
    playcount_estimate: int | None = None


class ItemResponse(BaseModel):
    """Single item response."""

    id: str
    spotify_id: str
    type: str
    name: str | None = None
    spotify_url: str | None = None
    image: str | None = None

    # Owner / Artist
    owner_name: str | None = None
    owner_image: str | None = None
    owner_url: str | None = None
    artist_names: list[str] | None = None
    export_tracks: list[AlbumTrackExport] | None = None

    # Metrics
    followers: int | None = None
    monthly_listeners: int | None = None
    monthly_plays: int | None = None
    playcount: int | None = None
    total_plays: int | None = None
    track_count: int | None = None
    album_count: int | None = None
    duration: str | None = None
    release_date: str | None = None
    saves: int | None = None
    followers_delta: int | None = None
    monthly_listeners_delta: int | None = None
    playcount_delta: int | None = None
    track_count_delta: int | None = None
    delta_days: int | None = None

    # Status
    status: str = "pending"
    error_code: int | None = None
    error_message: str | None = None

    # Grouping
    group: str | None = None
    user_id: str | None = None
    user_name: str | None = None
    user_avatar: str | None = None
    manager_name: str | None = None
    added_date: str | None = None

    # Timestamps
    last_checked: datetime | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ItemListResponse(BaseModel):
    """List of items response."""

    items: list[ItemResponse]
    total: int


class ItemGroupSummary(BaseModel):
    """Group count for the current list owner scope."""

    name: str
    count: int


class ItemSummaryResponse(BaseModel):
    """Fast aggregate counts for paged list views."""

    total: int
    all_total: int
    active: int
    errors: int
    crawling: int
    groups: list[ItemGroupSummary]


class ItemMoveRequest(BaseModel):
    item_ids: list[uuid.UUID]
    group: str | None = None
    user_id: uuid.UUID | None = None


ItemMoveRequest.model_rebuild()
