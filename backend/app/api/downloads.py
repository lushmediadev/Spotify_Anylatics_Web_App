"""Admin-only file downloads (e.g. desktop app installers) served from DOWNLOADS_DIR.

Admins upload files from the page in chunks: Cloudflare rejects request bodies over
100MB and the host nginx caps them at 20MB, so a file is staged in DOWNLOADS_DIR/.uploads
one chunk per request and atomically moved into place on completion. The browser keeps its bearer token in localStorage, so a
plain <a href> cannot authenticate: the page asks for a short-lived signed link and
then navigates to it, letting the browser stream the file straight to disk.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
import json
import os
import re
import shutil
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
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

_UPLOADS_SUBDIR = ".uploads"
# Below the host nginx client_max_body_size (20m) and far below Cloudflare's 100MB cap.
UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
MAX_CHUNK_BYTES = 16 * 1024 * 1024
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
_FREE_SPACE_MARGIN = 512 * 1024 * 1024
_STALE_UPLOAD_SECONDS = 24 * 3600
_UPLOAD_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_TITLES_FILE = ".downloads.json"


def _downloads_dir() -> Path | None:
    raw = (settings.DOWNLOADS_DIR or "").strip()
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_dir() else None


def _is_safe_name(name: str) -> bool:
    return bool(name) and name == Path(name).name and not name.startswith(".") and "\\" not in name


def _resolve_file(name: str) -> Path:
    """The file called ``name`` directly inside DOWNLOADS_DIR, or 404."""
    root = _downloads_dir()
    if root is None or not _is_safe_name(name):
        raise HTTPException(status_code=404, detail="File not found")
    path = root / name
    if not path.is_file() or path.resolve().parent != root.resolve():
        raise HTTPException(status_code=404, detail="File not found")
    return path


def _load_titles(root: Path) -> dict[str, str]:
    path = root / _TITLES_FILE
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(status_code=503, detail="Download titles could not be read")
    titles = data.get("titles") if isinstance(data, dict) else None
    if not isinstance(titles, dict):
        raise HTTPException(status_code=503, detail="Download titles could not be read")
    return {key: value for key, value in titles.items() if isinstance(key, str) and isinstance(value, str)}


def _save_titles(root: Path, titles: dict[str, str]) -> None:
    target = root / _TITLES_FILE
    temporary = root / f"{_TITLES_FILE}.{uuid.uuid4().hex}.tmp"
    try:
        temporary.write_text(json.dumps({"titles": titles}, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _file_info(path: Path, titles: dict[str, str] | None = None) -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "title": (titles or {}).get(path.name) or path.stem or path.name,
        "size": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


@router.get("")
async def list_downloads(admin: User = Depends(get_admin_user)):
    root = _downloads_dir()
    files = []
    if root is not None:
        titles = _load_titles(root)
        files = [
            _file_info(path, titles)
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


@router.delete("/{name}")
async def delete_download(name: str, admin: User = Depends(get_admin_user)):
    path = _resolve_file(name)
    root = path.parent
    titles = _load_titles(root)
    path.unlink()
    if titles.pop(name, None) is not None:
        _save_titles(root, titles)
    return {"deleted": path.name}


class UpdateDownloadTitle(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)


@router.patch("/{name}")
async def update_download_title(name: str, body: UpdateDownloadTitle, admin: User = Depends(get_admin_user)):
    path = _resolve_file(name)
    title = body.title.strip()
    if not title or any(ord(ch) < 32 for ch in title):
        raise HTTPException(status_code=400, detail="Invalid title")
    root = path.parent
    titles = _load_titles(root)
    titles[name] = title
    _save_titles(root, titles)
    return _file_info(path, titles)


# --- Chunked uploads ---------------------------------------------------------


class UploadStart(BaseModel):
    name: str = Field(..., max_length=200)
    size: int
    overwrite: bool = False
    title: str | None = Field(default=None, max_length=160)


def _require_root() -> Path:
    root = _downloads_dir()
    if root is None:
        raise HTTPException(status_code=503, detail="Downloads directory is not configured")
    return root


def _uploads_dir(root: Path) -> Path:
    path = root / _UPLOADS_SUBDIR
    path.mkdir(exist_ok=True)
    return path


def _cleanup_stale_uploads(staging: Path) -> None:
    cutoff = time.time() - _STALE_UPLOAD_SECONDS
    for path in staging.iterdir():
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def _load_upload(upload_id: str, admin: User) -> tuple[Path, Path, dict]:
    """(downloads dir, staged .part file, metadata) for an upload this admin started, or 404."""
    root = _require_root()
    if not _UPLOAD_ID_RE.match(upload_id):
        raise HTTPException(status_code=404, detail="Upload not found")
    staging = _uploads_dir(root)
    part = staging / f"{upload_id}.part"
    try:
        meta = json.loads((staging / f"{upload_id}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="Upload not found")
    if meta.get("uid") != str(admin.id) or not part.is_file():
        raise HTTPException(status_code=404, detail="Upload not found")
    return root, part, meta


def _discard_upload(part: Path) -> None:
    for path in (part, part.with_suffix(".json")):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


@router.post("/uploads")
async def start_upload(body: UploadStart, admin: User = Depends(get_admin_user)):
    root = _require_root()
    name = body.name.strip()
    if not _is_safe_name(name) or any(ord(ch) < 32 for ch in name):
        raise HTTPException(status_code=400, detail="Invalid file name")
    title = body.title.strip() if body.title is not None else None
    if body.title is not None and (not title or any(ord(ch) < 32 for ch in title)):
        raise HTTPException(status_code=400, detail="Invalid title")
    if body.size <= 0:
        raise HTTPException(status_code=400, detail="File is empty")
    if body.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large")
    target = root / name
    if target.exists() and not (body.overwrite and target.is_file()):
        raise HTTPException(status_code=409, detail=f"{name} already exists")
    staging = _uploads_dir(root)
    _cleanup_stale_uploads(staging)
    if shutil.disk_usage(staging).free < body.size + _FREE_SPACE_MARGIN:
        raise HTTPException(status_code=507, detail="Not enough disk space on the server")
    upload_id = uuid.uuid4().hex
    (staging / f"{upload_id}.part").touch()
    meta = {"name": name, "size": body.size, "overwrite": body.overwrite, "title": title, "uid": str(admin.id)}
    (staging / f"{upload_id}.json").write_text(json.dumps(meta), encoding="utf-8")
    return {"upload_id": upload_id, "chunk_size": UPLOAD_CHUNK_BYTES, "max_chunk_size": MAX_CHUNK_BYTES}


@router.put("/uploads/{upload_id}")
async def upload_chunk(
    upload_id: str,
    request: Request,
    offset: int = Query(..., ge=0),
    admin: User = Depends(get_admin_user),
):
    _root, part, meta = _load_upload(upload_id, admin)
    received = part.stat().st_size
    if offset != received:
        # Chunks must arrive in order; the client resumes from "received".
        raise HTTPException(status_code=409, detail={"message": "Unexpected chunk offset", "received": received})
    limit = min(MAX_CHUNK_BYTES, meta["size"] - received)
    written = 0
    with part.open("r+b") as handle:
        handle.seek(received)
        try:
            async for piece in request.stream():
                written += len(piece)
                if written > limit:
                    raise HTTPException(status_code=413, detail="Chunk is too large")
                handle.write(piece)
        except BaseException:
            # Drop a partial or rejected chunk so the client can retry from the same offset.
            handle.truncate(received)
            raise
    # Writes refresh the .part mtime; refresh the metadata too so cleanup skips live uploads.
    os.utime(part.with_suffix(".json"))
    return {"received": received + written, "size": meta["size"]}


@router.post("/uploads/{upload_id}/complete")
async def complete_upload(upload_id: str, admin: User = Depends(get_admin_user)):
    root, part, meta = _load_upload(upload_id, admin)
    received = part.stat().st_size
    if received != meta["size"]:
        raise HTTPException(status_code=409, detail={"message": "Upload is incomplete", "received": received})
    target = root / meta["name"]
    if target.exists() and not (meta["overwrite"] and target.is_file()):
        raise HTTPException(status_code=409, detail=f"{meta['name']} already exists")
    titles = _load_titles(root)
    part.chmod(0o644)
    os.replace(part, target)
    _discard_upload(part)
    if meta.get("title"):
        titles[meta["name"]] = meta["title"]
        _save_titles(root, titles)
    return _file_info(target, titles)


@router.delete("/uploads/{upload_id}")
async def abort_upload(upload_id: str, admin: User = Depends(get_admin_user)):
    _root, part, _meta = _load_upload(upload_id, admin)
    _discard_upload(part)
    return {"aborted": upload_id}
