"""Authentication service — password hashing, JWT, FastAPI dependencies."""

from datetime import datetime, timedelta
from typing import Optional
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
import bcrypt
from sqlalchemy import and_, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

# ---------------------------------------------------------------------------
# Password hashing (direct bcrypt - no passlib needed)
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

_ALGORITHM = settings.JWT_ALGORITHM
_SECRET = settings.JWT_SECRET_KEY


def create_access_token(
    data: dict, expires_delta: Optional[timedelta] = None
) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(hours=settings.JWT_EXPIRY_HOURS)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, _SECRET, algorithm=_ALGORITHM)


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Mandatory auth dependency — raises 401 when token is missing/invalid."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Optional auth — returns None when no token is provided."""
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials, db)
    except HTTPException:
        return None


async def get_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Require admin role."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


async def get_manager_or_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.role not in {"admin", "manager"}:
        raise HTTPException(status_code=403, detail="Manager or admin privileges required")
    return current_user


def user_scope_condition(actor: User):
    """Assigned accounts never grant access to other managers or admins."""
    if actor.role == "admin":
        return true()
    if actor.role == "manager":
        return or_(User.id == actor.id, and_(User.role == "user", User.manager_id == actor.id))
    return User.id == actor.id


def owner_scope_condition(actor: User, owner_column):
    if actor.role == "admin":
        return true()
    if actor.role == "manager":
        return owner_column.in_(select(User.id).where(user_scope_condition(actor)))
    return owner_column == actor.id


async def require_user_access(
    db: AsyncSession, actor: User, user_id, *, management: bool = False,
) -> User:
    try:
        target_id = uuid.UUID(str(user_id))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid user_id") from exc
    result = await db.execute(select(User).where(User.id == target_id))
    target = result.scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    own = str(target.id) == str(actor.id)
    assigned = (
        actor.role == "manager" and target.role == "user"
        and str(target.manager_id) == str(actor.id)
    )
    allowed = actor.role == "admin" or assigned or (own and not management)
    if not allowed:
        raise HTTPException(status_code=403, detail="Not authorized to access this user")
    return target
