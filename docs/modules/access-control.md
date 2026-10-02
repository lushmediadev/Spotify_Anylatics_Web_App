# Access Control

## Responsibility
- Enforce admin, manager, and user permissions across account and link operations.

## Entry Points
- `/api/auth/users`, account/group CRUD, crawl, items, export, and jobs endpoints.
- Frontend `canManageUsers`, role dropdowns, and manager assignment controls.

## Key Files
- `backend/app/services/auth.py`: canonical SQL scope predicates and target authorization.
- `backend/app/api/auth.py`: role changes, manager assignment, global settings.
- `backend/app/models/user.py`: nullable UUID `manager_id`, self FK with `SET NULL`.

## Invariants
- Admin accesses all accounts; global preferences remain admin-only.
- Manager accesses own resources and role=user accounts assigned via manager_id; account-management actions on own manager account use profile endpoints.
- User accesses own resources only. Manager cannot elevate roles, reassign users, or access another manager/admin.
- Explicit null manager_id clears assignment; omitted manager_id preserves it.
- Reassign users before deleting/demoting their manager. Prevent deleting/demoting/deactivating own admin or last active admin.
- List/export/delete/refresh and job visibility share server-side ownership enforcement; old jobs resolve ownership through their item.

## Known Pitfalls
- Frontend role cache is refreshed via `/auth/me` during bootstrap; UI visibility never substitutes for backend authorization.
- Existing accounts receive null manager_id through an additive startup migration; no account is automatically reassigned.

## Verification
- `backend/tests/test_manager_auth.py`, `test_manager_data_scope.py`, `test_manager_migration.py` exercise real SQL scopes, endpoint denial, and additive migration.
