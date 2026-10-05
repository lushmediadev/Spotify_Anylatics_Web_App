"""Main API router — aggregates all sub-routers."""

from fastapi import APIRouter, Depends
from app.services.item_workspaces import bind_item_workspace

from app.api.health import router as health_router
from app.api.crawl import router as crawl_router
from app.api.items import router as items_router
from app.api.jobs import router as jobs_router
from app.api.auth import router as auth_router
from app.api.youtube import router as youtube_router
from app.ytm.api.router import router as ytm_router

router = APIRouter(prefix="/api")
router.include_router(health_router, tags=["Health"])
router.include_router(auth_router, tags=["Auth"])
router.include_router(ytm_router)
router.include_router(crawl_router, tags=["Crawl"], dependencies=[Depends(bind_item_workspace)])
router.include_router(items_router, tags=["Items"], dependencies=[Depends(bind_item_workspace)])
router.include_router(jobs_router, tags=["Jobs"], dependencies=[Depends(bind_item_workspace)])
router.include_router(youtube_router, dependencies=[Depends(bind_item_workspace)])
playlist_items = APIRouter(routes=[route for route in items_router.routes if
    (route.path in {"/items", "/items/summary"} and "GET" in route.methods)
    or (route.path == "/items/export" and "POST" in route.methods)
    or (route.path == "/items-by-id/{item_id}" and "DELETE" in route.methods)])
router.include_router(playlist_items, prefix="/channel-playlists", tags=["Channel playlist items"], dependencies=[Depends(bind_item_workspace)])
