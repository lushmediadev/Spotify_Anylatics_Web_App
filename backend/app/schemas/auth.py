"""Auth-related Pydantic schemas."""

from uuid import UUID
from typing import Literal

from pydantic import BaseModel, Field

WorkspaceKey = Literal["youtube", "spotify", "youtube-spotify"]


class RegisterRequest(BaseModel):
    username: str
    email: str | None = None
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    username: str  # can be username or email
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str | None = None
    display_name: str | None
    role: str
    manager_id: str | None = None
    workspaces: list[WorkspaceKey] = Field(default_factory=lambda: ["youtube", "spotify", "youtube-spotify"])
    is_active: bool = True
    created_at: str | None = None
    last_login: str | None = None
    avatar: str | None = None
    custom_groups: list[str] | None = None

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateAvatarRequest(BaseModel):
    avatar: str  # base64 data URL


class AdminUpdateUserRequest(BaseModel):
    username: str | None = None
    display_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    manager_id: UUID | None = None
    workspaces: list[WorkspaceKey] | None = Field(default=None, min_length=1, max_length=3)


class AdminResetPasswordRequest(BaseModel):
    new_password: str


class AdminCreateUserRequest(BaseModel):
    username: str
    email: str | None = None
    password: str
    display_name: str | None = None
    role: str = "user"
    manager_id: UUID | None = None
    workspaces: list[WorkspaceKey] | None = Field(default=None, min_length=1, max_length=3)
