"""HTTP coverage for manager grants and live user inheritance across workspaces."""
import itertools
import uuid

import pytest
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.auth import get_current_user
from app.services.workspace_access import WORKSPACES
from test_youtube_api import env
from test_independent_workspaces import full_client


def fresh_client(env):
    client = full_client(env)

    async def current_actor():
        with Session(env.engine) as db:
            return db.get(User, env.users[env.actor].id)

    client.app.dependency_overrides[get_current_user] = current_actor
    return client


COMBINATIONS = [list(values) for count in (1, 2, 3) for values in itertools.combinations(WORKSPACES, count)]
PATHS = {'youtube': '/api/ytm/items', 'spotify': '/api/items', 'youtube-spotify': '/api/youtube/channels'}


@pytest.mark.parametrize('grants', COMBINATIONS)
@pytest.mark.parametrize('actor', ['manager', 'assigned'])
def test_workspace_combinations_gate_manager_and_assigned_user(env, grants, actor):
    with fresh_client(env) as client:
        env.actor = 'admin'
        response = client.patch(f'/api/auth/users/{env.users["manager"].id}', json={'workspaces': grants})
        assert response.status_code == 200, response.text
        assert response.json()['workspaces'] == grants
        env.actor = actor
        assert client.get('/api/auth/me').json()['workspaces'] == grants
        for key, path in PATHS.items():
            assert client.get(path).status_code == (200 if key in grants else 403), path
        assert client.get('/api/channel-playlists/items').status_code == (200 if 'youtube-spotify' in grants else 403)
        assert client.get('/api/ytm/auth/me/preferences').status_code == (200 if 'youtube' in grants else 403)
        assert client.put('/api/ytm/auth/me/groups', json={'groups': ['Own']}).status_code == (200 if 'youtube' in grants else 403)
        assert client.post('/api/youtube/groups', json={'name': 'Own'}).status_code == (200 if 'youtube-spotify' in grants else 403)
        if 'spotify' not in grants:
            assert client.post('/api/crawl/batch', json={'urls': ['https://open.spotify.com/playlist/' + 'L' * 22], 'group': 'Own'}).status_code == 403
            assert client.post('/api/items/export', json={'action': 'playlist-type3', 'format': 'json', 'item_ids': []}).status_code == 403
        if 'youtube-spotify' not in grants:
            assert client.post('/api/channel-playlists/items/export', json={'action': 'playlist-type3', 'format': 'json', 'item_ids': []}).status_code == 403
        # Own key/profile settings are shared; grants do not expand account management.
        assert client.get('/api/youtube/keys').status_code == 200
        assert client.get('/api/auth/users').status_code == (200 if actor == 'manager' else 403)


def test_created_user_inherits_then_follows_manager_edits_and_reassignment(env):
    with fresh_client(env) as client:
        env.actor = 'admin'
        assert client.patch(f'/api/auth/users/{env.users["manager"].id}', json={'workspaces': ['spotify']}).status_code == 200
        env.actor = 'manager'
        response = client.post('/api/auth/users', json={'username': 'new_inherited', 'password': 'test-pass'})
        assert response.status_code == 201
        assert response.json()['workspaces'] == ['spotify']
        user_id = uuid.UUID(response.json()['id'])
        with Session(env.engine) as db:
            user = db.get(User, user_id)
            assert user.manager_id == env.users['manager'].id and user.workspace_access is None
            env.users['new_inherited'] = user
        env.actor = 'admin'
        assert client.patch(f'/api/auth/users/{env.users["manager"].id}', json={'workspaces': ['youtube-spotify']}).status_code == 200
        env.actor = 'new_inherited'
        assert client.get('/api/auth/me').json()['workspaces'] == ['youtube-spotify']
        assert client.get('/api/items').status_code == 403
        assert client.get('/api/youtube/channels').status_code == 200
        env.actor = 'admin'
        assert client.patch(f'/api/auth/users/{user_id}', json={'manager_id': str(env.users['other_manager'].id)}).status_code == 200
        env.actor = 'new_inherited'
        assert client.get('/api/auth/me').json()['workspaces'] == ['youtube']
        assert client.get('/api/youtube/channels').status_code == 403
        assert client.get('/api/ytm/items').status_code == 200
        env.actor = 'admin'
        assert client.patch(f'/api/auth/users/{user_id}', json={'manager_id': None}).status_code == 200
        env.actor = 'new_inherited'
        assert client.get('/api/auth/me').json()['workspaces'] == list(WORKSPACES)


@pytest.mark.parametrize('value', [None, [], ['spotify'], ['youtube', 'spotify']])
def test_manager_cannot_set_workspace_on_self_or_created_assigned_users(env, value):
    env.actor = 'manager'
    with fresh_client(env) as client:
        # Schema rejects an empty grant; every other shape is forbidden by authorization.
        expected = 422 if value == [] else 403
        assert client.post('/api/auth/users', json={'username': 'tampered', 'password': 'pass', 'workspaces': value}).status_code == expected
        for target in ('manager', 'assigned'):
            assert client.patch(f'/api/auth/users/{env.users[target].id}', json={'workspaces': value}).status_code == expected
        assert client.get('/api/auth/me').json()['workspaces'] == ['youtube']


@pytest.mark.parametrize('value', [[], ['unknown'], ['Youtube'], ['spotify', 'youtube', 'youtube-spotify', 'spotify'], 'spotify'])
def test_admin_invalid_grants_are_rejected_without_changing_manager(env, value):
    env.actor = 'admin'
    with fresh_client(env) as client:
        assert client.patch(f'/api/auth/users/{env.users["manager"].id}', json={'workspaces': value}).status_code == 422
        assert client.get('/api/auth/users').json()[0]['workspaces'] == ['youtube']


def test_legacy_defaults_and_admin_only_manager_configuration(env):
    with fresh_client(env) as client:
        for actor, expected in [('manager', ['youtube']), ('unassigned', list(WORKSPACES)), ('admin', list(WORKSPACES))]:
            env.actor = actor
            assert client.get('/api/auth/me').json()['workspaces'] == expected
        response = client.post('/api/auth/users', json={'username': 'workspace_manager', 'password': 'pass', 'role': 'manager', 'workspaces': ['spotify', 'youtube']})
        assert response.status_code == 201 and response.json()['workspaces'] == ['youtube', 'spotify']
        for role in ('user', 'admin'):
            assert client.post('/api/auth/users', json={'username': 'invalid-' + role, 'password': 'pass', 'role': role, 'workspaces': ['spotify']}).status_code == 400
        assert client.patch(f'/api/auth/users/{env.users["manager"].id}', json={'workspaces': None}).status_code == 400


@pytest.mark.parametrize('change', [{'is_active': False}, {'role': 'admin'}, {'workspace_access': []}, {'workspace_access': ['unknown']}])
def test_invalid_or_inactive_manager_inheritance_fails_closed(env, change):
    with Session(env.engine) as db:
        manager = db.get(User, env.users['manager'].id)
        for key, value in change.items():
            setattr(manager, key, value)
        db.commit()
    env.actor = 'assigned'
    with fresh_client(env) as client:
        assert client.get('/api/auth/me').json()['workspaces'] == []
        for path in PATHS.values():
            assert client.get(path).status_code == 403
        assert client.patch('/api/auth/me', json={'display_name': 'Still accessible'}).status_code == 200


def test_granted_manager_still_cannot_read_assigned_users_private_items(env):
    with Session(env.engine) as db:
        db.get(User, env.users['manager'].id).workspace_access = list(WORKSPACES)
        db.commit()
    env.actor = 'manager'
    with fresh_client(env) as client:
        assert client.get('/api/youtube/channels').status_code == 200
        assert client.get('/api/youtube/channels?user_id=' + str(env.users['assigned'].id)).json()['total'] == 0
        assert client.get('/api/items?user_id=' + str(env.users['assigned'].id)).json()['total'] == 0
        assert client.get('/api/ytm/items?user_id=' + str(env.users['assigned'].id)).status_code == 403
