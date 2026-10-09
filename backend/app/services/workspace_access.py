"""Workspace grants are configured on managers and inherited by their users."""
from fastapi import HTTPException
from sqlalchemy import select

from app.models.user import User

WORKSPACES = ("youtube", "spotify", "youtube-spotify")


def manager_workspaces(user):
    configured = getattr(user, "workspace_access", None)
    if configured is None:
        return ["youtube"]  # Preserve the previous manager policy during migration.
    if not isinstance(configured, list):
        return []
    return [key for key in WORKSPACES if key in configured]


async def effective_workspaces(user, db, *, managers=None):
    if user.role == "admin":
        return list(WORKSPACES)
    if user.role == "manager":
        return manager_workspaces(user)
    manager_id = getattr(user, "manager_id", None)
    if manager_id is None:
        return list(WORKSPACES)
    if managers is not None:
        manager = managers.get(manager_id)
    else:
        manager = (await db.execute(select(User).where(User.id == manager_id)
                                   .execution_options(populate_existing=True))).scalar_one_or_none()
    if manager is None or manager.role != "manager" or not manager.is_active:
        return []
    return manager_workspaces(manager)


async def require_workspace_access(user, db, workspace):
    if workspace not in await effective_workspaces(user, db):
        raise HTTPException(403, "Workspace access is not assigned to this account")


def requested_manager_workspaces(actor, request, role):
    """Never accept an independently configured grant on an assigned user."""
    if "workspaces" not in request.model_fields_set:
        return None
    if actor.role != "admin":
        raise HTTPException(403, "Only admins may assign manager workspaces")
    if role != "manager" or not request.workspaces:
        raise HTTPException(400, "Workspace selection is only available for managers")
    return [key for key in WORKSPACES if key in request.workspaces]
