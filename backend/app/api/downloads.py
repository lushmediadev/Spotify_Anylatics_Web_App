"""Admin-only file downloads (e.g. desktop app installers) served from DOWNLOADS_DIR.

Files are copied onto the server out of band (they are too large for git and for
Cloudflare upload limits). The browser keeps its bearer token in localStorage, so a
plain <a href> cannot authenticate: the page asks for a short-lived signed link and
then navigates to it, letting the browser stream the file straight to disk.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.auth import create_access_token, get_admin_user

router = APIRouter(prefix="/downloads")

_TOKEN_PURPOSE = "download"
_LINK_TTL = timedelta(minutes=5)
_NO_STORE = {"Cache-Control": "private, no-store"}


def _downloads_dir() -> Path | None:
    raw = (settings.DOWNLOADS_DIR or "").strip()
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_dir() else None


def _resolve_file(name: str) -> Path:
    """The file called ``name`` directly inside DOWNLOADS_DIR, or 404."""
    root = _downloads_dir()
    if root is None or not name or name != Path(name).name or name.startswith("."):
        raise HTTPException(status_code=404, detail="File not found")
    path = root / name
    if not path.is_file() or path.resolve().parent != root.resolve():
        raise HTTPException(status_code=404, detail="File not found")
    return path


def _file_info(path: Path) -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "size": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


@router.get("")
async def list_downloads(admin: User = Depends(get_admin_user)):
    root = _downloads_dir()
    files = []
    if root is not None:
        files = [
            _file_info(path)
            for path in sorted(root.iterdir(), key=lambda p: p.name.lower())
            if path.is_file() and not path.name.startswith(".")
        ]
    return {"files": files}


@router.post("/{name}/link")
async def create_download_link(name: str, admin: User = Depends(get_admin_user)):
    path = _resolve_file(name)
    # No "sub" claim, so get_current_user rejects this token as an access token.
    token = create_access_token(
        {"purpose": _TOKEN_PURPOSE, "uid": str(admin.id), "file": path.name},
        expires_delta=_LINK_TTL,
    )
    return {"url": f"/api/downloads/file/{quote(path.name)}?token={quote(token)}", "expires_in": int(_LINK_TTL.total_seconds())}


@router.get("/file/{name}")
async def download_file(name: str, token: str = Query(...), db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=403, detail="Download link is invalid or has expired")
    if payload.get("purpose") != _TOKEN_PURPOSE or payload.get("file") != name or payload.get("sub"):
        raise HTTPException(status_code=403, detail="Download link is invalid or has expired")
    try:
        user_id = uuid.UUID(str(payload.get("uid")))
    except ValueError:
        raise HTTPException(status_code=403, detail="Download link is invalid or has expired")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    path = _resolve_file(name)
    return FileResponse(path, filename=path.name, media_type="application/octet-stream", headers=_NO_STORE)
