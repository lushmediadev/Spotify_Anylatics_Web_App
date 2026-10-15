"""Shared login and shared account scope over the separate YTM records."""
import uuid

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import aliased
from app.services.auth import get_current_user as shared_user, user_scope_condition
from app.ytm.database import get_db
from app.ytm.models.user import User
from app.services.workspace_access import require_workspace_access

# Mirror rows never carry the real role: cross-account access is decided from the shared
# accounts table (visible_owner_ids), not from standalone YTM role branches.
_MIRROR_ROLE = "user"


def _mirror_is_current(user, actor) -> bool:
    return (
        user is not None
        and user.username == actor.username
        and user.role == _MIRROR_ROLE
        and user.is_active == actor.is_active
    )


async def get_current_user(actor=Depends(shared_user), db=Depends(get_db)):
    # ``db`` is the same request session the shared auth dependency used (see
    # app.ytm.database), so this adds no second connection.
    await require_workspace_access(actor, db, "youtube")
    user = await ensure_mirror(db, actor)
    user.shared_actor = actor
    return user


async def ensure_mirror(db, actor):
    """The YTM row for a shared account (created on first use; ids are the shared UUID strings)."""
    user_id = str(actor.id)
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if _mirror_is_current(user, actor):
        return user  # Common path: plain read, no row lock.

    # The mirror row must be created/updated: serialize on the shared users row so
    # concurrent first requests cannot race on the insert, then re-read fresh state.
    from app.models.user import User as SharedUser
    await db.execute(select(SharedUser.id).where(SharedUser.id == actor.id).with_for_update())
    user = (await db.execute(
        select(User).where(User.id == user_id).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if user is None:
        user = User(id=user_id, shared_user_id=actor.id, username=actor.username, email=f"{actor.id}@internal.invalid", password_hash="disabled-shared-login", role=_MIRROR_ROLE)
        db.add(user)
    user.username = actor.username
    user.role = _MIRROR_ROLE
    user.is_active = actor.is_active
    await db.flush()
    return user


async def _shared_actor(db, user):
    from app.models.user import User as SharedUser
    actor = getattr(user, "shared_actor", None)
    return actor if actor is not None else await db.get(SharedUser, user.shared_user_id)


async def visible_owner_ids(db, user) -> list[str]:
    """Owners whose YTM data the actor may view and manage: admin all, manager self + own users."""
    from app.models.user import User as SharedUser
    actor = await _shared_actor(db, user)
    rows = await db.execute(select(SharedUser.id).where(user_scope_condition(actor)))
    return [str(value) for value in rows.scalars()]


async def owner_for(db, user, requested_user_id: str | None) -> str:
    """Resolve a requested owner (default: the actor), creating its mirror row when needed."""
    from app.models.user import User as SharedUser
    if not requested_user_id or str(requested_user_id) == user.id:
        return user.id
    if str(requested_user_id) not in await visible_owner_ids(db, user):
        raise HTTPException(status_code=403, detail="Not authorized for this user")
    target = await db.get(SharedUser, uuid.UUID(str(requested_user_id)))
    if target is None:
        raise HTTPException(status_code=404, detail="Target user not found")
    return (await ensure_mirror(db, target)).id


async def owner_labels(db, owner_ids) -> dict[str, dict]:
    """Display name, avatar and manager name per owner, read from the shared accounts."""
    from app.models.user import User as SharedUser
    ids = set()
    for value in owner_ids:
        try:
            ids.add(uuid.UUID(str(value)))
        except (ValueError, TypeError):
            continue
    if not ids:
        return {}
    manager = aliased(SharedUser)
    rows = await db.execute(
        select(SharedUser, func.coalesce(manager.display_name, manager.username))
        .outerjoin(manager, manager.id == SharedUser.manager_id)
        .where(SharedUser.id.in_(ids))
    )
    return {str(user.id): {"name": user.display_name or user.username, "avatar": user.avatar, "manager": manager_name}
            for user, manager_name in rows.all()}


async def get_admin_user(current_user=Depends(get_current_user)):
    raise HTTPException(403, "Use the shared account settings")


async def get_manager_or_admin_user(current_user=Depends(get_current_user)):
    raise HTTPException(403, "Account management is not part of YouTube Link Checker")


def can_manage_user(actor, target):
    return actor.id == target.id
