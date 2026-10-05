"""Isolate HTTP item operations while retaining shared Spotify crawl/export code."""
from fastapi import Depends, Request, HTTPException
from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria
from app.database import get_db
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.services.auth import get_current_user


@event.listens_for(Session, "do_orm_execute")
def scope_item_queries(execute_state):
    workspace = execute_state.session.info.get("item_workspace")
    if workspace and not execute_state.execution_options.get("skip_item_workspace") and (execute_state.is_select or execute_state.is_update or execute_state.is_delete):
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(Item, Item.workspace == workspace, include_aliases=True)
        )


@event.listens_for(Session, "before_flush")
def scope_new_items(session, _context, _instances):
    workspace = session.info.get("item_workspace")
    if workspace:
        for item in session.new:
            if isinstance(item, Item):
                item.workspace = workspace
            elif isinstance(item, CrawlJob) and workspace == "channel-playlists":
                item.result = {**(item.result or {}), "youtube_channel_job": True}


async def bind_item_workspace(request: Request, db=Depends(get_db), actor=Depends(get_current_user)):
    if actor.role == "manager" and request.url.path not in {"/api/youtube/keys", "/api/youtube/keys/check"}:
        raise HTTPException(403, "Manager access is limited to YouTube Link Checker")
    db.info["item_workspace"] = (
        "channel-playlists" if request.url.path.startswith(("/api/youtube/", "/api/channel-playlists/")) else "spotify"
    )
    try:
        yield
    finally:
        db.info.pop("item_workspace", None)
