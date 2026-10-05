"""YTM remains a separate dataset/API but uses the main application's login."""
import json
from fastapi import APIRouter, Depends, HTTPException
from app.ytm.database import get_db
from app.ytm.services.auth import get_current_user
from app.ytm.api.items import router as items
from app.ytm.api.crawl import router as crawl
from app.ytm.api.jobs import router as jobs

router = APIRouter(prefix="/ytm", tags=["YouTube Link Checker"])
router.include_router(items)
router.include_router(crawl)
router.include_router(jobs)


def profile(user):
    return {"id": user.id, "username": user.username, "display_name": user.username,
        "email": user.email, "role": "user", "is_active": user.is_active, "avatar": user.avatar,
        "custom_groups": json.loads(user.custom_groups or "[]")}


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return profile(user)


@router.get("/auth/users")
async def own_user(user=Depends(get_current_user)):
    return [profile(user)]


@router.get("/auth/me/groups")
@router.get("/auth/users/{user_id}/groups")
async def groups(user_id: str | None = None, user=Depends(get_current_user)):
    if user_id and user_id != user.id:
        raise HTTPException(403, "Own groups only")
    return {"groups": json.loads(user.custom_groups or "[]")}


@router.put("/auth/me/groups")
@router.put("/auth/users/{user_id}/groups")
async def save_groups(body: dict, user_id: str | None = None, user=Depends(get_current_user), db=Depends(get_db)):
    if user_id and user_id != user.id:
        raise HTTPException(403, "Own groups only")
    values = body.get("groups", [])
    if not isinstance(values, list) or len(values) > 5000 or any(not isinstance(value, str) or len(value) > 128 for value in values):
        raise HTTPException(400, "Invalid groups")
    user.custom_groups = json.dumps(list(dict.fromkeys(value.strip() for value in values if value.strip())))
    await db.flush()
    return {"groups": json.loads(user.custom_groups)}


@router.get("/auth/me/preferences")
async def preferences(user=Depends(get_current_user)):
    return {"preferences": json.loads(user.ui_preferences or "{}")}


@router.put("/auth/me/preferences")
async def save_preferences(body: dict, user=Depends(get_current_user), db=Depends(get_db)):
    values = body.get("preferences", {})
    if not isinstance(values, dict) or len(json.dumps(values)) > 1000000:
        raise HTTPException(400, "Invalid preferences")
    user.ui_preferences = json.dumps(values)
    await db.flush()
    return {"preferences": values}
