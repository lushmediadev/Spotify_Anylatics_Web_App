"""System YouTube API key pool: only keys owned by active admins are used."""

from sqlalchemy import select

from app.models.user import User
from app.models.youtube import YouTubeApiKey


def mask_key(key: str) -> str:
    """Never expose more than a short prefix/suffix of a stored credential."""
    return f"{key[:4]}…{key[-4:]}" if len(key) >= 12 else f"…{key[-2:]}"


async def system_api_key_rows(db) -> list[tuple[YouTubeApiKey, User]]:
    rows = (await db.execute(
        select(YouTubeApiKey, User).join(User, User.id == YouTubeApiKey.user_id)
        .where(User.role == "admin", User.is_active.is_(True))
        .order_by(User.created_at, User.id, YouTubeApiKey.position, YouTubeApiKey.id)
    )).all()
    seen, unique = set(), []
    for key, owner in rows:
        if key.key not in seen:
            seen.add(key.key)
            unique.append((key, owner))
    return unique


async def system_api_keys(db) -> list[str]:
    return [key.key for key, _ in await system_api_key_rows(db)]
