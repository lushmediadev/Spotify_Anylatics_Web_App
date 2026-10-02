"""
SpotiCheck Backend - FastAPI application entry point.

Serves API endpoints and optionally static frontend files.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import router as api_router
from app.config import settings
from app.database import init_db
from app.services import youtube_jobs

# Logging
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("spoticheck")


def _resolve_frontend_dir() -> Path | None:
    """Return a valid frontend directory path if available."""
    candidates: list[Path] = []

    configured = (settings.FRONTEND_DIR or "").strip()
    if configured:
        configured_path = Path(configured)
        if not configured_path.is_absolute():
            configured_path = Path(__file__).resolve().parents[1] / configured_path
        candidates.append(configured_path)

    backend_dir = Path(__file__).resolve().parents[1]
    repo_dir = backend_dir.parent
    candidates.append(repo_dir / "frontend")

    seen: set[Path] = set()
    for candidate in candidates:
        normalized = candidate.resolve()
        if normalized in seen:
            continue
        seen.add(normalized)
        if (normalized / "index.html").exists():
            return normalized
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown events."""
    logger.info("Starting SpotiCheck API...")

    # Always ensure compatibility migrations run at startup.
    # Older deployments may carry legacy unique constraints that break per-user link ownership.
    if not settings.AUTO_INIT_DB:
        logger.warning("AUTO_INIT_DB=false but running compatibility DB init to ensure schema integrity")
    await init_db()
    logger.info("Database tables checked/created")
    await youtube_jobs.recover_stale_channels()
    youtube_jobs.track(youtube_jobs.maintenance())

    try:
        yield
    finally:
        await youtube_jobs.shutdown()

    logger.info("Shutting down SpotiCheck API...")


app = FastAPI(
    title="SpotiCheck API",
    description="Spotify link monitoring and analytics backend",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
allowed_origins = [
    settings.FRONTEND_URL,
    "http://localhost:8080",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
]
allowed_origins = [origin for origin in dict.fromkeys(allowed_origins) if origin]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router)

# Optional static frontend serving for single-service deployment.
frontend_dir = _resolve_frontend_dir()
if settings.SERVE_FRONTEND and frontend_dir:
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
    logger.info("Serving frontend from: %s", frontend_dir)
else:
    logger.info("Frontend static serving disabled or directory not found")
