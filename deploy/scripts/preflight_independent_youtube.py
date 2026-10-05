"""Run only against a disposable PostgreSQL copy; never against production."""
import asyncio
import json
import uuid
from datetime import datetime


async def main():
    from app.config import settings
    if not settings.DATABASE_URL.rsplit("/", 1)[-1].startswith("spoticheck_preflight_"):
        raise RuntimeError("Refusing to change a non-preflight database")
    from sqlalchemy import func, select
    from app.database import init_db, async_session, engine
    from app.models.user import User
    from app.models.item import Item
    from app.models.youtube import Channel, ChannelPlaylist
    from app.models.metrics_snapshot import MetricsSnapshot
    from app.services.playlist_workspace_migration import migrate_playlist_workspace
    from app.ytm.database import init_db as init_ytm_db
    from app.ytm.models.item import Item as YTMItem
    from app.main import app
    from app.services.auth import create_access_token
    from app.services import youtube_jobs
    from app.ytm.api import crawl as ytm_crawl
    import httpx

    await init_db()
    await init_ytm_db()
    async with async_session() as db:
        original = (await db.execute(select(func.count()).select_from(Item).where(Item.workspace == "spotify"))).scalar_one()
        migrated = await migrate_playlist_workspace(db)
        assert (await db.execute(select(func.count()).select_from(Item).where(Item.workspace == "spotify"))).scalar_one() == original
        assert await migrate_playlist_workspace(db) == 0
        assert (await db.execute(select(func.count()).select_from(YTMItem))).scalar_one() == 0
        suffix = uuid.uuid4().hex[:14]
        manager = User(username="pf_manager_" + suffix, email=suffix + "m@preflight.invalid", password_hash="disabled", role="manager")
        other = User(username="pf_user_" + suffix, email=suffix + "u@preflight.invalid", password_hash="disabled", role="user")
        db.add_all([manager, other]); await db.flush()
        source = Item(user_id=other.id, spotify_id="P" * 22, item_type="playlist", workspace="spotify", followers=42, status="active", group="Checker")
        channel = Channel(user_id=other.id, query_type="handle", query="@pf_" + suffix, group="Preflight")
        db.add_all([source, channel]); await db.flush()
        db.add_all([ChannelPlaylist(channel_id=channel.id, item_id=source.id),
            MetricsSnapshot(item_id=source.id, spotify_id=source.spotify_id, followers=40, captured_at=datetime.utcnow())])
        await db.flush()
        assert await migrate_playlist_workspace(db) == 1
        clone = (await db.execute(select(Item).where(Item.user_id == other.id, Item.workspace == "channel-playlists"))).scalar_one()
        assert clone.id != source.id and clone.followers == 42
        assert (await db.execute(select(func.count()).select_from(MetricsSnapshot).where(MetricsSnapshot.item_id == clone.id))).scalar_one() == 1
        await db.commit()
        manager_token = create_access_token({"sub": str(manager.id)})
        other_token = create_access_token({"sub": str(other.id)})
        source_id, clone_id = source.id, clone.id

    # No provider calls or background jobs are permitted during preflight.
    ytm_crawl.schedule_crawl_jobs = lambda jobs: None
    youtube_jobs.track = lambda coroutine: coroutine.close()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://preflight") as client:
        headers = {"Authorization": "Bearer " + manager_token}
        for path in ("/api/items", "/api/youtube/channels", "/api/channel-playlists/items", "/api/auth/users"):
            assert (await client.get(path, headers=headers)).status_code == 403
        assert (await client.get("/api/youtube/keys", headers=headers)).status_code == 200
        assert (await client.get("/api/ytm/items", headers=headers)).json()["total"] == 0
        response = await client.post("/api/ytm/crawl/batch", headers=headers, json={"urls": ["https://www.youtube.com/@pf_channel"], "group": "YTM Only"})
        assert response.status_code == 200
        assert (await client.get("/api/ytm/items", headers=headers)).json()["total"] == 1
        headers = {"Authorization": "Bearer " + other_token}
        assert (await client.get("/api/ytm/items", headers=headers)).json()["total"] == 0
        assert (await client.delete(f"/api/items-by-id/{clone_id}", headers=headers)).status_code == 404
        assert (await client.delete(f"/api/channel-playlists/items-by-id/{clone_id}", headers=headers)).status_code == 200
        checker = (await client.get("/api/items", headers=headers)).json()
        assert [row["id"] for row in checker["items"]] == [str(source_id)]
    print(json.dumps({"postgres_preflight": "passed", "original_checker_rows": original, "migrated_playlists": migrated, "manager_gates": "passed", "separate_ytm": "passed"}))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
