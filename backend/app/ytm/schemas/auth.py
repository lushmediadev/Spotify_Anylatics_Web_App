"""Auth-related Pydantic schemas."""

from pydantic import BaseModel


class RegisterRequest(BaseModel):
    username: str
    email: str | None = None
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str | None = None
    role: str
    manager_id: str | None = None
    manager_name: str | None = None
    is_active: bool = True
    created_at: str | None = None
    last_login: str | None = None
    avatar: str | None = None
    custom_groups: list[str] | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateAvatarRequest(BaseModel):
    avatar: str


class AdminUpdateUserRequest(BaseModel):
    username: str | None = None
    role: str | None = None
    manager_id: str | None = None
    is_active: bool | None = None


class AdminResetPasswordRequest(BaseModel):
    new_password: str


class AdminCreateUserRequest(BaseModel):
    username: str
    email: str | None = None
    password: str
    role: str = "user"
    manager_id: str | None = None
