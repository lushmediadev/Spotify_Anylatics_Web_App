"""Additive YouTube API contracts."""

import uuid
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.item import ItemResponse, ItemGroupSummary


class KeysRequest(BaseModel):
    api_keys: str


class KeysCheckRequest(BaseModel):
    api_keys: str | None = None


class ChannelCreateRequest(BaseModel):
    urls: list[str] = Field(max_length=500)
    group: str = Field(min_length=1, max_length=128)
    target_user_id: uuid.UUID | None = None


class ChannelGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    target_user_id: uuid.UUID | None = None


class WorkspacePreferenceResponse(BaseModel):
    group_order: list[str] = Field(default_factory=list)
    channel_orders: dict[str, list[str]] = Field(default_factory=dict)
    playlist_orders: dict[str, list[str]] = Field(default_factory=dict)


class WorkspacePreferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group_order: list[str] | None = Field(default=None, max_length=5000)
    channel_orders: dict[str, list[str]] | None = None
    playlist_orders: dict[str, list[str]] | None = None


class ChannelBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    channel_ids: list[uuid.UUID] = Field(max_length=500)


class ChannelMoveRequest(ChannelBatchRequest):
    group: str = Field(min_length=1, max_length=128)


class ChannelGroupRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    old_name: str = Field(min_length=1, max_length=128)
    new_name: str = Field(min_length=1, max_length=128)


class ChannelGroupsDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    names: list[str] = Field(min_length=1, max_length=500)


class ChannelGroupClearRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=128)


class ChannelRefreshRequest(BaseModel):
    channel_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)


class PlaylistReplaceRequest(BaseModel):
    item_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    urls: list[str] = Field(default_factory=list, max_length=500)


class ChannelResponse(BaseModel):
    id: str
    user_id: str
    query_type: str
    query: str
    youtube_id: str | None = None
    youtube_url: str | None = None
    name: str | None = None
    image: str | None = None
    banner: str | None = None
    view_count: int | None = None
    view_count_delta: int | None = None
    delta_days: int | None = None
    status: str
    error_code: str | None = None
    error_message: str | None = None
    group: str
    created_at: datetime
    last_checked: datetime | None = None
    playlists: list[ItemResponse] = Field(default_factory=list)


class ChannelListResponse(BaseModel):
    items: list[ChannelResponse]
    total: int
    groups: list[ItemGroupSummary]
    key_count: int
    has_keys: bool
