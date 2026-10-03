"""Auth endpoints — register, login, user info."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.app_setting import AppSetting
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    AuthResponse,
    UserResponse,
    UpdateProfileRequest,
    ChangePasswordRequest,
    UpdateAvatarRequest,
    AdminUpdateUserRequest,
    AdminResetPasswordRequest,
    AdminCreateUserRequest,
)
from app.services.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_admin_user,
    get_manager_or_admin_user,
    user_scope_condition,
    require_user_access,
)

router = APIRouter(prefix="/auth")
_INTERNAL_EMAIL_DOMAIN = "users.spoticheck.local"
_MAX_ROW_ORDER_ITEMS = 5000
_COLUMN_WIDTH_MIN = 40
_COLUMN_WIDTH_MAX = 2000
_PLAYLIST_CLIPBOARD_LINE_LIMIT_KEY = "playlist_clipboard_line_limit"
_PLAYLIST_CLIPBOARD_LINE_LIMIT_DEFAULT = 100
_PLAYLIST_CLIPBOARD_LINE_LIMIT_MIN = 1
_PLAYLIST_CLIPBOARD_LINE_LIMIT_MAX = 2000


def _build_internal_email(username: str) -> str:
    return f"{username.lower()}@{_INTERNAL_EMAIL_DOMAIN}"


def _resolve_email(username: str, email: str | None) -> str:
    normalized = (email or "").strip().lower()
    return normalized or _build_internal_email(username)


def _public_email(email: str | None) -> str | None:
    normalized = (email or "").strip().lower()
    if not normalized or normalized.endswith("@" + _INTERNAL_EMAIL_DOMAIN):
        return None
    return email


def _user_response(user: User, *, include_private: bool = True) -> UserResponse:
    try:
        custom_groups = json.loads(user.custom_groups) if user.custom_groups else []
    except (json.JSONDecodeError, TypeError):
        custom_groups = []
    if not isinstance(custom_groups, list):
        custom_groups = []
    custom_groups = [str(g).strip() for g in custom_groups if str(g).strip()]

    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=_public_email(user.email),
        display_name=user.display_name,
        role=user.role,
        manager_id=str(user.manager_id) if getattr(user, "manager_id", None) is not None else None,
        is_active=user.is_active,
        created_at=user.created_at.isoformat() if user.created_at else None,
        last_login=user.last_login.isoformat() if user.last_login else None,
        avatar=user.avatar,
        custom_groups=custom_groups if include_private else [],
    )


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Create the bootstrap account. Public sign-up is disabled after first user."""
    count_result = await db.execute(select(func.count()).select_from(User))
    user_count = count_result.scalar() or 0
    if user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public sign up is disabled",
        )

    username = (req.username or "").strip()
    resolved_email = _resolve_email(username, req.email)

    # Check duplicates
    existing = await db.execute(
        select(User).where((User.username == username) | (User.email == resolved_email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        )

    user = User(
        username=username,
        email=resolved_email,
        password_hash=hash_password(req.password),
        display_name=req.display_name,
        role="admin",
    )
    db.add(user)
    await db.flush()

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        access_token=token,
        user=_user_response(user),
    )


def _sanitize_ui_preferences(raw: dict | None) -> dict:
    data = raw if isinstance(raw, dict) else {}

    row_order_raw = data.get("row_order")
    row_order: list[str] = []
    if isinstance(row_order_raw, list):
        for value in row_order_raw:
            s = str(value).strip()
            if not s:
                continue
            row_order.append(s)
            if len(row_order) >= _MAX_ROW_ORDER_ITEMS:
                break

    widths_raw = data.get("column_widths")
    column_widths: dict[str, int] = {}
    if isinstance(widths_raw, dict):
        for key, value in widths_raw.items():
            name = str(key).strip()
            if not name:
                continue
            try:
                numeric = int(round(float(value)))
            except (TypeError, ValueError):
                continue
            column_widths[name] = max(_COLUMN_WIDTH_MIN, min(_COLUMN_WIDTH_MAX, numeric))

    return {"row_order": row_order, "column_widths": column_widths}


def _load_ui_preferences(user: User) -> dict:
    try:
        parsed = json.loads(user.ui_preferences) if user.ui_preferences else {}
    except (json.JSONDecodeError, TypeError):
        parsed = {}
    return _sanitize_ui_preferences(parsed)


def _normalize_playlist_clipboard_line_limit(value) -> int:
    """Return a safe global clipboard line limit."""
    if isinstance(value, bool):
        return _PLAYLIST_CLIPBOARD_LINE_LIMIT_DEFAULT
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return _PLAYLIST_CLIPBOARD_LINE_LIMIT_DEFAULT
    return max(
        _PLAYLIST_CLIPBOARD_LINE_LIMIT_MIN,
        min(_PLAYLIST_CLIPBOARD_LINE_LIMIT_MAX, numeric),
    )


async def _load_global_preferences(db: AsyncSession) -> dict:
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _PLAYLIST_CLIPBOARD_LINE_LIMIT_KEY)
    )
    setting = result.scalar_one_or_none()
    value = _PLAYLIST_CLIPBOARD_LINE_LIMIT_DEFAULT
    if setting is not None:
        value = _normalize_playlist_clipboard_line_limit(setting.value)
    return {"playlist_clipboard_line_limit": value}


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate with username/email + password."""
    result = await db.execute(
        select(User).where(
            (User.username == req.username) | (User.email == req.username)
        )
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    user.last_login = datetime.utcnow()
    await db.flush()

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        access_token=token,
        user=_user_response(user),
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Return the current authenticated user."""
    return _user_response(current_user)


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    admin: User = Depends(get_manager_or_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """List all accounts for admins, or self and assigned users for managers."""
    result = await db.execute(
        select(User).where(user_scope_condition(admin)).order_by(User.created_at)
    )
    users = result.scalars().all()
    return [_user_response(u, include_private=u.id == admin.id) for u in users]


@router.post("/users", response_model=UserResponse, status_code=201)
async def admin_create_user(
    req: AdminCreateUserRequest,
    admin: User = Depends(get_manager_or_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an account; managers may only create users assigned to themselves."""
    username = (req.username or "").strip()
    email = _resolve_email(username, req.email)
    display_name = (req.display_name or "").strip() or None
    role = (req.role or "user").strip().lower()

    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if len(req.password or "") < 4:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 4 characters",
        )
    if role not in ("admin", "manager", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'manager' or 'user'")
    manager_id = req.manager_id
    if admin.role == "manager":
        if role != "user" or (manager_id is not None and manager_id != admin.id):
            raise HTTPException(status_code=403, detail="Managers can only create their own users")
        manager_id = admin.id
    await _validate_manager_assignment(db, role, manager_id)

    existing = await db.execute(
        select(User).where((User.username == username) | (User.email == email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered",
        )

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(req.password),
        display_name=display_name,
        role=role,
        is_active=True,
        manager_id=manager_id,
    )
    db.add(user)
    await db.flush()
    return _user_response(user, include_private=user.id == admin.id)


# ---------------------------------------------------------------------------
# Profile / settings endpoints
# ---------------------------------------------------------------------------


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    req: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's profile fields exposed in the dashboard."""
    if req.display_name is not None:
        current_user.display_name = req.display_name
    await db.flush()
    return _user_response(current_user)


@router.post("/me/password")
async def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the current user's password."""
    if not verify_password(req.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(req.new_password) < 4:
        raise HTTPException(
            status_code=400, detail="Password must be at least 4 characters"
        )
    current_user.password_hash = hash_password(req.new_password)
    await db.flush()
    return {"ok": True, "message": "Password changed successfully"}


@router.post("/me/avatar")
async def update_avatar(
    req: UpdateAvatarRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload/replace the current user's avatar (base64 data URL)."""
    if len(req.avatar) > 500_000:  # ~500KB limit
        raise HTTPException(status_code=400, detail="Avatar too large (max 500KB)")
    current_user.avatar = req.avatar
    await db.flush()
    return {"ok": True, "avatar": req.avatar}


@router.delete("/me/avatar")
async def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove the current user's avatar."""
    current_user.avatar = None
    await db.flush()
    return {"ok": True}


# ---------------------------------------------------------------------------
# UI preferences sync endpoints
# ---------------------------------------------------------------------------


@router.get("/me/preferences")
async def get_my_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the current user's UI preferences."""
    return {
        "preferences": _load_ui_preferences(current_user),
        "global_preferences": await _load_global_preferences(db),
    }


@router.put("/me/preferences")
async def save_my_preferences(
    req: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save the current user's UI preferences."""
    incoming = req.get("preferences", {})
    if incoming is None:
        incoming = {}
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="preferences must be an object")

    cleaned = _sanitize_ui_preferences(incoming)
    current_user.ui_preferences = json.dumps(cleaned)
    await db.flush()
    return {"preferences": cleaned}


@router.put("/admin/preferences")
async def save_admin_preferences(
    req: dict,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Save application-wide preferences; only admins may change them."""
    incoming = req.get("playlist_clipboard_line_limit")
    if isinstance(incoming, bool) or incoming is None:
        raise HTTPException(
            status_code=400,
            detail="playlist_clipboard_line_limit must be an integer between 1 and 2000",
        )
    try:
        normalized = int(incoming)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="playlist_clipboard_line_limit must be an integer between 1 and 2000",
        )
    if normalized < _PLAYLIST_CLIPBOARD_LINE_LIMIT_MIN or normalized > _PLAYLIST_CLIPBOARD_LINE_LIMIT_MAX:
        raise HTTPException(
            status_code=400,
            detail="playlist_clipboard_line_limit must be between 1 and 2000",
        )

    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _PLAYLIST_CLIPBOARD_LINE_LIMIT_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting is None:
        setting = AppSetting(
            key=_PLAYLIST_CLIPBOARD_LINE_LIMIT_KEY,
            value=str(normalized),
        )
        db.add(setting)
    else:
        setting.value = str(normalized)
    await db.flush()
    return {
        "global_preferences": {
            "playlist_clipboard_line_limit": normalized,
        }
    }


# ---------------------------------------------------------------------------
# Groups sync endpoints
# ---------------------------------------------------------------------------


@router.get("/me/groups")
async def get_my_groups(
    current_user: User = Depends(get_current_user),
):
    """Get the current user's groups list."""
    try:
        groups = json.loads(current_user.custom_groups) if current_user.custom_groups else []
    except (json.JSONDecodeError, TypeError):
        groups = []
    return {"groups": groups}


@router.put("/me/groups")
async def save_my_groups(
    req: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save the current user's groups list."""
    groups = req.get("groups", [])
    if not isinstance(groups, list):
        raise HTTPException(status_code=400, detail="groups must be an array")
    # Deduplicate and clean
    cleaned = list(dict.fromkeys(str(g).strip() for g in groups if str(g).strip()))
    current_user.custom_groups = json.dumps(cleaned)
    await db.flush()
    return {"groups": cleaned}


# ---------------------------------------------------------------------------
# Admin user management endpoints
# ---------------------------------------------------------------------------


async def _validate_manager_assignment(db: AsyncSession, role: str, manager_id):
    if manager_id is None:
        return
    if role != "user":
        raise HTTPException(status_code=400, detail="Only users may be assigned to a manager")
    # Serialize assignment with manager demotion/deletion.
    result = await db.execute(
        select(User).where(User.id == manager_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    manager = result.scalar_one_or_none()
    if manager is None or manager.role != "manager" or not manager.is_active:
        raise HTTPException(status_code=400, detail="manager_id must reference an active manager")


async def _protect_manager_demotion(db: AsyncSession, user: User):
    if user.role != "manager":
        return
    result = await db.execute(
        select(User).where(User.id == user.id).with_for_update()
        .execution_options(populate_existing=True)
    )
    locked_user = result.scalar_one_or_none()
    if locked_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if locked_user.role != "manager":
        return
    result = await db.execute(
        select(func.count()).select_from(User).where(User.manager_id == user.id)
    )
    if result.scalar():
        raise HTTPException(status_code=400, detail="Reassign users before removing their manager")


async def _protect_active_admin(db: AsyncSession, actor: User, user: User):
    if str(actor.id) == str(user.id):
        raise HTTPException(status_code=400, detail="Cannot demote or deactivate your own admin account")
    if user.role != "admin" or not user.is_active:
        return
    # Lock the same ordered set for concurrent privilege-removal requests.
    result = await db.execute(
        select(User.id).where(User.role == "admin", User.is_active.is_(True))
        .order_by(User.id).with_for_update()
    )
    if not any(str(admin_id) != str(user.id) for admin_id in result.scalars().all()):
        raise HTTPException(status_code=400, detail="Cannot remove the last active admin")


@router.patch("/users/{user_id}", response_model=UserResponse)
async def admin_update_user(
    user_id: str,
    req: AdminUpdateUserRequest,
    admin: User = Depends(get_manager_or_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Edit an accessible account without allowing manager privilege escalation."""
    user = await require_user_access(db, admin, user_id, management=True)
    next_role = req.role if req.role is not None else user.role
    next_active = req.is_active if req.is_active is not None else user.is_active
    assignment_set = "manager_id" in req.model_fields_set
    next_manager_id = req.manager_id if assignment_set else getattr(user, "manager_id", None)
    if admin.role == "manager":
        if next_role != "user" or next_manager_id != admin.id:
            raise HTTPException(status_code=403, detail="Managers cannot elevate or reassign users")
    if next_role not in ("admin", "manager", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'manager' or 'user'")
    if user.role == "admin" and (next_role != "admin" or not next_active):
        await _protect_active_admin(db, admin, user)
    if user.role == "manager" and next_role != "manager":
        await _protect_manager_demotion(db, user)
    if assignment_set or next_role != user.role:
        await _validate_manager_assignment(db, next_role, next_manager_id)

    if req.username is not None:
        next_username = (req.username or "").strip()
        if not next_username:
            raise HTTPException(status_code=400, detail="Username is required")
        if next_username != user.username:
            existing = await db.execute(
                select(User).where(User.username == next_username, User.id != user.id)
            )
            if existing.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Username already registered",
                )
            if (user.email or "").strip().lower().endswith("@" + _INTERNAL_EMAIL_DOMAIN):
                user.email = _build_internal_email(next_username)
            user.username = next_username
    if req.display_name is not None:
        user.display_name = req.display_name
    if req.role is not None:
        user.role = next_role
    if req.is_active is not None:
        user.is_active = req.is_active
    if assignment_set:
        user.manager_id = next_manager_id

    await db.flush()
    return _user_response(user, include_private=user.id == admin.id)


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: str,
    req: AdminResetPasswordRequest,
    admin: User = Depends(get_manager_or_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin — set a new password for any user (no old password needed)."""
    user = await require_user_access(db, admin, user_id, management=True)
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    user.password_hash = hash_password(req.new_password)
    await db.flush()
    return {"ok": True, "message": f"Password reset for {user.username}"}




@router.get("/users/{user_id}/groups")
async def admin_get_user_groups(
    user_id: str,
    admin: User = Depends(get_manager_or_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the actor's own groups; management rights do not grant data access."""
    user = await require_user_access(db, admin, user_id, management=False)
    try:
        groups = json.loads(user.custom_groups) if user.custom_groups else []
    except (json.JSONDecodeError, TypeError):
        groups = []
    return {"groups": groups}


@router.put("/users/{user_id}/groups")
async def admin_save_user_groups(
    user_id: str,
    req: dict,
    admin: User = Depends(get_manager_or_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Save the actor's own groups."""
    user = await require_user_access(db, admin, user_id, management=False)
    groups = req.get("groups", [])
    if not isinstance(groups, list):
        raise HTTPException(status_code=400, detail="groups must be an array")
    cleaned = list(dict.fromkeys(str(g).strip() for g in groups if str(g).strip()))
    user.custom_groups = json.dumps(cleaned)
    await db.flush()
    return {"groups": cleaned}

@router.delete("/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    admin: User = Depends(get_manager_or_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin — permanently delete a user and all their data (items, crawl jobs)."""
    user = await require_user_access(db, admin, user_id, management=True)
    if str(admin.id) == str(user.id):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    username = user.username
    target_id = user.id

    try:
        # Serialize deletion with owner-scoped channel/playlist mutations.
        await db.execute(select(User.id).where(User.id == target_id).with_for_update())
        # Resolve all item ids first so dependent tables can be cleaned safely.
        item_rows = (
            await db.execute(select(Item.id).where(Item.user_id == target_id))
        ).all()
        item_ids = [row[0] for row in item_rows]

        if item_ids:
            await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id.in_(item_ids)))
            await db.execute(delete(CrawlJob).where(CrawlJob.item_id.in_(item_ids)))

        # Delete crawl jobs belonging to user
        await db.execute(delete(CrawlJob).where(CrawlJob.user_id == target_id))
        # Delete items belonging to user
        await db.execute(delete(Item).where(Item.user_id == target_id))
        # Delete the user
        await db.execute(delete(User).where(User.id == target_id))
        await db.flush()
    except Exception as exc:  # pragma: no cover - defensive safety path
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {exc}") from exc

    return {"ok": True, "message": f"User {username} and all their data deleted"}
