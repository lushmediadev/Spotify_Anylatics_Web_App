"""Shared login, with independent own-only YTM preferences and records."""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from app.services.auth import get_current_user as shared_user
from app.ytm.database import get_db
from app.ytm.models.user import User


async def get_current_user(actor=Depends(shared_user), db=Depends(get_db)):
    from app.models.user import User as SharedUser
    await db.execute(select(SharedUser.id).where(SharedUser.id == actor.id).with_for_update())
    user = await db.get(User, str(actor.id))
    if user is None:
        user = User(id=str(actor.id), shared_user_id=actor.id, username=actor.username, email=f"{actor.id}@internal.invalid", password_hash="disabled-shared-login", role="user")
        db.add(user)
        await db.flush()
    user.username = actor.username
    user.role = "user"  # Standalone role branches must never grant cross-account data access.
    user.is_active = actor.is_active
    await db.flush()
    return user


async def get_admin_user(current_user=Depends(get_current_user)):
    raise HTTPException(403, "Use the shared account settings")


async def get_manager_or_admin_user(current_user=Depends(get_current_user)):
    raise HTTPException(403, "Account management is not part of YouTube Link Checker")


def can_manage_user(actor, target):
    return actor.id == target.id
