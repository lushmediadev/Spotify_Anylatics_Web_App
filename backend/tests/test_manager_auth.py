"""User-management contract tests using real SQL predicates on SQLite."""

import asyncio
import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, event, update
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api import auth as auth_api
from app.models.user import User
from app.schemas.auth import AdminCreateUserRequest, AdminUpdateUserRequest, UserResponse
from app.services.auth import get_current_user, verify_password


class _EmptyResult:
    def all(self):
        return []


class _Database:
    """Async facade for User SQL; existing dependent-data deletion uses fake results."""

    def __init__(self, session):
        self.session = session
        self.dependent_queries = []

    async def execute(self, query):
        if query.is_select:
            tables = query.get_final_froms()
        else:
            tables = [query.table]
        if any(table.name != "users" for table in tables):
            self.dependent_queries.append(query)
            return _EmptyResult()
        return self.session.execute(query)

    def add(self, user):
        self.session.add(user)

    async def flush(self):
        self.session.flush()

    async def rollback(self):
        self.session.rollback()


@pytest.fixture
def accounts():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    User.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as session:
        def add(name, role="user", manager_id=None, active=True):
            user = User(
                id=uuid.uuid4(), username=name, email=f"{name}@users.spoticheck.local",
                password_hash="old-hash", role=role, manager_id=manager_id, is_active=active,
            )
            session.add(user)
            session.flush()
            return user

        admin = add("admin", "admin")
        manager = add("manager", "manager")
        other_manager = add("other_manager", "manager")
        assigned = add("assigned", manager_id=manager.id)
        foreign = add("foreign", manager_id=other_manager.id)
        unassigned = add("unassigned")
        session.commit()
        yield _Database(session), {
            "admin": admin, "manager": manager, "other_manager": other_manager,
            "assigned": assigned, "foreign": foreign, "unassigned": unassigned,
        }
    engine.dispose()


def _run(awaitable):
    return asyncio.run(awaitable)


def _expect_status(status, awaitable):
    with pytest.raises(HTTPException) as error:
        _run(awaitable)
    assert error.value.status_code == status


def test_manager_id_schema_uuid_and_explicit_null():
    manager_id = uuid.uuid4()
    assert AdminCreateUserRequest(username="x", password="pass", manager_id=str(manager_id)).manager_id == manager_id
    assert "manager_id" not in AdminUpdateUserRequest().model_fields_set
    assert "manager_id" in AdminUpdateUserRequest(manager_id=None).model_fields_set
    assert UserResponse(id="x", username="x", display_name=None, role="user").manager_id is None
    for schema, fields in (
        (AdminUpdateUserRequest, {}),
        (AdminCreateUserRequest, {"username": "x", "password": "pass"}),
    ):
        with pytest.raises(ValidationError):
            schema(**fields, manager_id="not-a-uuid")


def test_manager_list_is_self_and_assigned_admin_list_is_all(accounts):
    db, users = accounts
    own = _run(auth_api.list_users(admin=users["manager"], db=db))
    assert {row.id for row in own} == {str(users[key].id) for key in ("manager", "assigned")}
    assert next(row for row in own if row.username == "assigned").manager_id == str(users["manager"].id)
    assert len(_run(auth_api.list_users(admin=users["admin"], db=db))) == len(users)


def test_manager_create_auto_assigns_and_admin_can_create_manager(accounts):
    db, users = accounts
    created = _run(auth_api.admin_create_user(
        AdminCreateUserRequest(username="new_user", password="pass"), users["manager"], db,
    ))
    assert created.role == "user"
    assert created.manager_id == str(users["manager"].id)
    created_manager = _run(auth_api.admin_create_user(
        AdminCreateUserRequest(username="new_manager", password="pass", role="manager"), users["admin"], db,
    ))
    assert created_manager.role == "manager"
    assert created_manager.manager_id is None


@pytest.mark.parametrize("role,assignment", [("admin", None), ("manager", None), ("user", "other_manager")])
def test_manager_cannot_create_elevated_or_reassigned_users(accounts, role, assignment):
    db, users = accounts
    _expect_status(403, auth_api.admin_create_user(
        AdminCreateUserRequest(username="denied", password="pass", role=role,
                               manager_id=users[assignment].id if assignment else None),
        users["manager"], db,
    ))
    assert db.session.query(User).filter_by(username="denied").first() is None


@pytest.mark.parametrize("operation,target", [
    (operation, target)
    for operation in ("update", "reset", "get_groups", "save_groups", "delete")
    for target in ("manager", "admin", "other_manager", "foreign", "unassigned", "missing")
    if not (target == "manager" and operation in {"get_groups", "save_groups"})
])
def test_manager_management_denies_outside_assigned_users(accounts, operation, target):
    db, users = accounts
    target_id = str(uuid.uuid4() if target == "missing" else users[target].id)
    actor = users["manager"]
    calls = {
        "update": lambda: auth_api.admin_update_user(target_id, AdminUpdateUserRequest(display_name="denied"), actor, db),
        "reset": lambda: auth_api.admin_reset_password(target_id, auth_api.AdminResetPasswordRequest(new_password="pass"), actor, db),
        "get_groups": lambda: auth_api.admin_get_user_groups(target_id, actor, db),
        "save_groups": lambda: auth_api.admin_save_user_groups(target_id, {"groups": ["denied"]}, actor, db),
        "delete": lambda: auth_api.admin_delete_user(target_id, actor, db),
    }
    _expect_status(404 if target == "missing" else 403, calls[operation]())
    assert not db.dependent_queries
    if target != "missing":
        assert db.session.get(User, users[target].id) is not None
        assert users[target].password_hash == "old-hash"


@pytest.mark.parametrize("payload", [
    {"role": "admin"}, {"role": "manager"}, {"manager_id": None}, {"manager_id": "other_manager"},
])
def test_manager_cannot_elevate_or_reassign_assigned_user(accounts, payload):
    db, users = accounts
    payload = dict(payload)
    if payload.get("manager_id") == "other_manager":
        payload["manager_id"] = users["other_manager"].id
    _expect_status(403, auth_api.admin_update_user(
        str(users["assigned"].id), AdminUpdateUserRequest(**payload), users["manager"], db,
    ))
    assert users["assigned"].role == "user"
    assert users["assigned"].manager_id == users["manager"].id


@pytest.mark.parametrize("target", ["manager", "other_manager", "admin"])
def test_corrupt_assignment_does_not_grant_manager_management_or_list_access(accounts, target):
    db, users = accounts
    actor = users["manager"]
    user = users[target]
    user.manager_id = actor.id
    _run(db.flush())
    _expect_status(403, auth_api.admin_update_user(str(user.id), AdminUpdateUserRequest(display_name="denied"), actor, db))
    _expect_status(403, auth_api.admin_reset_password(str(user.id), auth_api.AdminResetPasswordRequest(new_password="pass"), actor, db))
    if target == "manager":
        assert _run(auth_api.admin_get_user_groups(str(user.id), actor, db)) == {"groups": []}
        assert _run(auth_api.admin_save_user_groups(str(user.id), {"groups": []}, actor, db)) == {"groups": []}
    else:
        _expect_status(403, auth_api.admin_get_user_groups(str(user.id), actor, db))
        _expect_status(403, auth_api.admin_save_user_groups(str(user.id), {"groups": []}, actor, db))
    _expect_status(403, auth_api.admin_delete_user(str(user.id), actor, db))
    listed = _run(auth_api.list_users(admin=actor, db=db))
    assert {row.id for row in listed} == {str(actor.id), str(users["assigned"].id)}


def test_manager_assigned_update_reset_groups_and_delete(accounts):
    db, users = accounts
    actor, target = users["manager"], users["assigned"]
    target_id = str(target.id)
    response = _run(auth_api.admin_update_user(
        target_id, AdminUpdateUserRequest(username="renamed", display_name="Renamed", is_active=False,
                                          role="user", manager_id=actor.id), actor, db,
    ))
    assert response.username == "renamed"
    assert target.email == "renamed@users.spoticheck.local"
    assert response.is_active is False
    _run(auth_api.admin_reset_password(target_id, auth_api.AdminResetPasswordRequest(new_password="pass"), actor, db))
    assert verify_password("pass", target.password_hash)
    _expect_status(403, auth_api.admin_save_user_groups(target_id, {"groups": ["Jazz"]}, actor, db))
    _expect_status(403, auth_api.admin_get_user_groups(target_id, actor, db))
    assert _run(auth_api.admin_delete_user(target_id, actor, db))["ok"]
    assert db.session.get(User, target.id) is None
    assert {query.table.name for query in db.dependent_queries if not query.is_select} == {"items", "crawl_jobs"}


def test_admin_assignment_omitted_preserves_null_clears_and_reassigns(accounts):
    db, users = accounts
    target = users["assigned"]
    _run(auth_api.admin_update_user(str(target.id), AdminUpdateUserRequest(display_name="kept"), users["admin"], db))
    assert target.manager_id == users["manager"].id
    _run(auth_api.admin_update_user(str(target.id), AdminUpdateUserRequest(manager_id=None), users["admin"], db))
    assert target.manager_id is None
    _run(auth_api.admin_update_user(str(target.id), AdminUpdateUserRequest(manager_id=users["other_manager"].id), users["admin"], db))
    assert target.manager_id == users["other_manager"].id


@pytest.mark.parametrize("target_role", ["admin", "manager"])
def test_admin_must_clear_assignment_before_elevating_user(accounts, target_role):
    db, users = accounts
    target = users["assigned"]
    _expect_status(400, auth_api.admin_update_user(str(target.id), AdminUpdateUserRequest(role=target_role), users["admin"], db))
    assert target.role == "user"
    result = _run(auth_api.admin_update_user(
        str(target.id), AdminUpdateUserRequest(role=target_role, manager_id=None), users["admin"], db,
    ))
    assert result.role == target_role and result.manager_id is None


@pytest.mark.parametrize("invalid", ["admin", "unassigned", "missing", "inactive_manager"])
@pytest.mark.parametrize("operation", ["create", "update"])
def test_assignment_requires_existing_active_manager(accounts, invalid, operation):
    db, users = accounts
    if invalid == "inactive_manager":
        users["other_manager"].is_active = False
        db.session.flush()
        manager_id = users["other_manager"].id
    else:
        manager_id = uuid.uuid4() if invalid == "missing" else users[invalid].id
    if operation == "create":
        call = auth_api.admin_create_user(AdminCreateUserRequest(username="invalid", password="pass", manager_id=manager_id), users["admin"], db)
    else:
        call = auth_api.admin_update_user(str(users["unassigned"].id), AdminUpdateUserRequest(manager_id=manager_id), users["admin"], db)
    _expect_status(400, call)
    assert users["unassigned"].manager_id is None


@pytest.mark.parametrize("role", ["admin", "manager"])
def test_admin_cannot_create_non_user_with_assignment(accounts, role):
    db, users = accounts
    _expect_status(400, auth_api.admin_create_user(
        AdminCreateUserRequest(username="invalid", password="pass", role=role, manager_id=users["manager"].id), users["admin"], db,
    ))


@pytest.mark.parametrize("changes", [{"role": "user"}, {"is_active": False}])
def test_assignment_lock_refreshes_stale_manager(accounts, changes):
    db, users = accounts
    manager = users["other_manager"]
    db.session.execute(update(User).where(User.id == manager.id).values(**changes)
                       .execution_options(synchronize_session=False))
    assert manager.role == "manager" and manager.is_active
    _expect_status(400, auth_api.admin_update_user(
        str(users["unassigned"].id), AdminUpdateUserRequest(manager_id=manager.id), users["admin"], db,
    ))
    assert users["unassigned"].manager_id is None
    assert all(getattr(manager, key) == value for key, value in changes.items())


def test_demotion_lock_refreshes_stale_target(accounts):
    db, users = accounts
    manager = users["other_manager"]
    db.session.execute(update(User).where(User.id == manager.id).values(role="user")
                       .execution_options(synchronize_session=False))
    assert manager.role == "manager"
    _run(auth_api._protect_manager_demotion(db, manager))
    assert manager.role == "user"


def test_manager_with_assigned_users_cannot_be_demoted(accounts):
    db, users = accounts
    manager = users["manager"]
    _expect_status(400, auth_api.admin_update_user(str(manager.id), AdminUpdateUserRequest(role="user"), users["admin"], db))
    assert manager.role == "manager"
    _run(auth_api.admin_update_user(str(users["assigned"].id), AdminUpdateUserRequest(manager_id=None), users["admin"], db))
    _run(auth_api.admin_update_user(str(manager.id), AdminUpdateUserRequest(role="user"), users["admin"], db))
    assert manager.role == "user"


def test_admin_delete_manager_detaches_assigned_users(accounts):
    db, users = accounts
    manager, assigned = users["manager"], users["assigned"]
    assert _run(auth_api.admin_delete_user(str(manager.id), users["admin"], db))["ok"]
    assert db.session.get(User, manager.id) is None
    db.session.refresh(assigned)
    assert assigned.manager_id is None
    assert assigned.role == "user"


def test_admin_cannot_delete_self(accounts):
    db, users = accounts
    _expect_status(400, auth_api.admin_delete_user(str(users["admin"].id), users["admin"], db))
    assert db.session.get(User, users["admin"].id) is not None


@pytest.mark.parametrize("operation", ["demote", "deactivate"])
def test_admin_self_and_last_active_admin_protection(accounts, operation):
    db, users = accounts
    admin = users["admin"]
    payload = AdminUpdateUserRequest(role="user") if operation == "demote" else AdminUpdateUserRequest(is_active=False)

    def call(actor):
        return auth_api.admin_update_user(str(admin.id), payload, actor, db)

    _expect_status(400, call(admin))
    inactive_admin = User(id=uuid.uuid4(), username="inactive_admin", email="inactive@example.com",
                          password_hash="old-hash", role="admin", is_active=False)
    db.add(inactive_admin)
    _run(db.flush())
    _expect_status(400, call(inactive_admin))
    assert admin.role == "admin" and admin.is_active
    inactive_admin.is_active = True
    _run(db.flush())
    _run(call(inactive_admin))
    assert inactive_admin.role == "admin" and inactive_admin.is_active


def test_http_dependencies_manager_access_user_denied_global_preferences_admin_only(accounts):
    db, users = accounts
    app = FastAPI()
    app.include_router(auth_api.router)
    actor = users["manager"]

    async def current_actor():
        return actor

    async def database():
        yield db

    app.dependency_overrides[get_current_user] = current_actor
    app.dependency_overrides[auth_api.get_db] = database
    with TestClient(app) as client:
        response = client.get("/auth/users")
        assert response.status_code == 403
        assert client.get("/auth/me").json()["manager_id"] is None
        own_groups_url = f"/auth/users/{actor.id}/groups"
        assert client.get(own_groups_url).status_code == 403
        response = client.put(own_groups_url, json={"groups": [" Own ", "Own", ""]})
        assert response.status_code == 403
        response = client.get(own_groups_url)
        assert response.status_code == 403
        assert client.patch(f"/auth/users/{actor.id}", json={"display_name": "denied"}).status_code == 403
        assert client.post(f"/auth/users/{actor.id}/reset-password", json={"new_password": "pass"}).status_code == 403
        assert client.delete(f"/auth/users/{actor.id}").status_code == 403
        assert client.put("/auth/admin/preferences", json={"playlist_clipboard_line_limit": 10}).status_code == 403
        assert client.post("/auth/users", json={"username": "bad", "password": "pass", "manager_id": "bad"}).status_code == 403
        actor = users["assigned"]
        assert client.get("/auth/me").json()["manager_id"] == str(users["manager"].id)
        assert client.get("/auth/users").status_code == 403
        assert client.post("/auth/users", json={"username": "bad", "password": "pass"}).status_code == 403
        assert client.patch(f"/auth/users/{actor.id}", json={"role": "admin"}).status_code == 403
