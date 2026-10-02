"""Main API router — aggregates all sub-routers."""

from fastapi import APIRouter

from app.api.health import router as health_router
from app.api.crawl import router as crawl_router
from app.api.items import router as items_router
from app.api.jobs import router as jobs_router
from app.api.auth import router as auth_router
from app.api.youtube import router as youtube_router

router = APIRouter(prefix="/api")
router.include_router(health_router, tags=["Health"])
router.include_router(auth_router, tags=["Auth"])
router.include_router(crawl_router, tags=["Crawl"])
router.include_router(items_router, tags=["Items"])
router.include_router(jobs_router, tags=["Jobs"])
router.include_router(youtube_router)
