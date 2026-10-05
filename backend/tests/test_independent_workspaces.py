"""Real SQL/HTTP gates for independent data, migration and manager access."""
import asyncio
from datetime import datetime
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_youtube_api import env, AsyncSessionAdapter, fixed_uuid
from app.api.router import router
from app.database import get_db
from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.models.youtube import Channel, ChannelPlaylist, YouTubeWorkspacePreference
from app.services.auth import get_current_user
from app.services.playlist_workspace_migration import migrate_playlist_workspace
from app.ytm.database import Base as YTMBase, get_db as ytm_db
from app.ytm.api import crawl as ytm_crawl


def full_client(env):
    YTMBase.metadata.create_all(env.engine)
    application = FastAPI()
    application.include_router(router)

    async def actor():
        return env.users[env.actor]

    async def db():
        with Session(env.engine, expire_on_commit=False) as session:
            yield AsyncSessionAdapter(session)
            session.commit()

    application.dependency_overrides[get_current_user] = actor
    application.dependency_overrides[get_db] = db
    application.dependency_overrides[ytm_db] = db
    return TestClient(application)


def test_copy_legacy_snapshots_order_idempotently_and_delete_only_independent_playlist(env):
    env.actor = "admin"
    with Session(env.engine, expire_on_commit=False) as session:
        source = Item(id=fixed_uuid(701), spotify_id="L" * 22, item_type="playlist", user_id=env.users['admin'].id,
            status="active", group="Checker", followers=42)
        channel = Channel(id=fixed_uuid(702), user_id=source.user_id, query_type="handle", query="@legacy", group="Legacy")
        session.add_all([source, channel]); session.flush()
        session.add_all([ChannelPlaylist(channel_id=channel.id, item_id=source.id),
            RawResponse(spotify_id=source.spotify_id, operation="fetch_playlist", response_data={}),
            MetricsSnapshot(item_id=source.id, spotify_id=source.spotify_id, followers=40, captured_at=datetime(2026, 1, 1)),
            YouTubeWorkspacePreference(user_id=source.user_id, playlist_orders={str(channel.id): [str(source.id)]})])
        session.commit()
        assert asyncio.run(migrate_playlist_workspace(AsyncSessionAdapter(session))) == 1
        session.commit()
        assert asyncio.run(migrate_playlist_workspace(AsyncSessionAdapter(session))) == 0
        clone = session.scalars(select(Item).where(Item.spotify_id == source.spotify_id, Item.workspace == "channel-playlists")).one()
        clone_id, source_id = clone.id, source.id
        assert clone_id != source_id and clone.followers == 42
        assert len(list(session.scalars(select(MetricsSnapshot).where(MetricsSnapshot.item_id == clone_id)))) == 1
        preference = session.get(YouTubeWorkspacePreference, source.user_id)
        assert preference.playlist_orders[str(channel.id)] == [str(clone_id)]
    with full_client(env) as client:
        checker = client.get('/api/items').json()
        assert {row['id'] for row in checker['items']} == {str(source_id)}
        assert client.post('/api/youtube/playlists/refresh', json={'item_ids': [str(source_id)]}).status_code == 400
        assert client.post('/api/youtube/playlists/refresh', json={'item_ids': [str(clone_id)]}).json()['accepted'] == 1
        assert client.delete(f'/api/items-by-id/{clone_id}').status_code == 404
        assert client.delete(f'/api/channel-playlists/items-by-id/{clone_id}').status_code == 200
    with Session(env.engine) as session:
        assert session.get(Item, source_id) is not None
        assert session.get(Item, source_id).status == 'active'
        assert session.get(Item, clone_id) is None
        assert session.scalars(select(MetricsSnapshot).where(MetricsSnapshot.item_id == source_id)).one().followers == 40
        assert session.scalars(select(RawResponse).where(RawResponse.spotify_id == "L" * 22)).one() is not None


def test_manager_only_ytm_own_resources_shared_keys_and_no_import(env, monkeypatch):
    monkeypatch.setattr(ytm_crawl, 'schedule_crawl_jobs', lambda jobs: None)
    env.actor = 'manager'
    with full_client(env) as client:
        for path in ('/api/items', '/api/items/summary', '/api/youtube/channels', '/api/youtube/preferences', '/api/channel-playlists/items', '/api/auth/users'):
            assert client.get(path).status_code == 403, path
        assert client.post('/api/crawl/batch', json={'urls': ['https://open.spotify.com/playlist/' + 'L' * 22], 'group': 'No'}).status_code == 403
        assert client.post('/api/channel-playlists/items/export', json={'action': 'playlist-type3', 'format': 'json', 'item_ids': []}).status_code == 403
        assert client.get('/api/youtube/keys').status_code == 200
        assert client.get('/api/ytm/items').json()['total'] == 0
        response = client.post('/api/ytm/crawl/batch', json={'urls': ['https://www.youtube.com/@fresh'], 'group': 'YTM Only'})
        assert response.status_code == 200, response.text
        assert client.get('/api/ytm/items').json()['total'] == 1
        assert client.get('/api/ytm/items?user_id=' + str(env.users['unassigned'].id)).status_code == 403
        assert client.put('/api/ytm/auth/me/groups', json={'groups': ['YTM Empty']}).status_code == 200
        assert client.get('/api/ytm/auth/me/groups').json()['groups'] == ['YTM Empty']
        env.actor = 'admin'
        assert client.get('/api/ytm/items').json()['total'] == 0
        assert client.get('/api/ytm/auth/me/groups').json()['groups'] == []
        assert client.get('/api/youtube/channels').json()['total'] > 0


def test_user_deletion_cascades_independent_ytm_data(env, monkeypatch):
    from app.ytm.models.user import User as YTMUser
    from app.ytm.models.item import Item as YTMItem
    from app.ytm.models.crawl_job import CrawlJob as YTMJob
    monkeypatch.setattr(ytm_crawl, 'schedule_crawl_jobs', lambda jobs: None)
    env.actor = 'unassigned'
    owner = env.users[env.actor].id
    with full_client(env) as client:
        assert client.post('/api/ytm/crawl/batch', json={'urls': ['https://www.youtube.com/@remove'], 'group': 'Mine'}).status_code == 200
        env.actor = 'admin'
        assert client.delete(f'/api/auth/users/{owner}').status_code == 200
    with Session(env.engine) as session:
        assert session.get(YTMUser, str(owner)) is None
        assert list(session.scalars(select(YTMItem).where(YTMItem.user_id == str(owner)))) == []
        assert list(session.scalars(select(YTMJob).where(YTMJob.user_id == str(owner)))) == []


def test_deleted_exact_crawl_item_never_resolves_a_checker_duplicate(env):
    from app.models.crawl_job import CrawlJob
    from app.services.crawler import _load_job_item
    with Session(env.engine) as session:
        checker = Item(user_id=env.users['admin'].id, item_type='playlist', spotify_id='D' * 22)
        session.add(checker); session.flush()
        missing = CrawlJob(item_id=fixed_uuid(999), user_id=checker.user_id, spotify_url='https://open.spotify.com/playlist/' + checker.spotify_id, item_type='playlist')
        assert asyncio.run(_load_job_item(AsyncSessionAdapter(session), missing, checker.spotify_id, 'playlist')) is None


def test_ytm_workers_read_only_active_owners_shared_keys(env):
    from app.ytm.services.youtube_client import get_active_api_keys
    with Session(env.engine) as session:
        own = env.users['manager']
        keys = asyncio.run(get_active_api_keys(AsyncSessionAdapter(session), str(own.id)))
        assert keys and all(key.user_id == own.id for key in keys)
        session.get(type(own), own.id).is_active = False
        session.flush()
        assert asyncio.run(get_active_api_keys(AsyncSessionAdapter(session), str(own.id))) == []
