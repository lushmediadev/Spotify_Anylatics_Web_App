"""Shared login, with independent own-only YTM preferences and records."""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from app.services.auth import get_current_user as shared_user
from app.ytm.database import get_db
from app.ytm.models.user import User
from app.services.workspace_access import require_workspace_access

_MIRROR_ROLE = "user"  # Standalone role branches must never grant cross-account data access.


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


async def get_admin_user(current_user=Depends(get_current_user)):
    raise HTTPException(403, "Use the shared account settings")


async def get_manager_or_admin_user(current_user=Depends(get_current_user)):
    raise HTTPException(403, "Account management is not part of YouTube Link Checker")


def can_manage_user(actor, target):
    return actor.id == target.id
