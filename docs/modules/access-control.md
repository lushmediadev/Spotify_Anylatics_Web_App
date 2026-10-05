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
- Resource data is own-account-only wherever a role has workspace access. Admin/user access Spotify and combined channels; all roles access their own YTM workspace and API keys. No account filter or impersonation flow.
- Admin manages accounts and global preferences. Manager uses only YouTube Link Checker and own shared key/profile settings; Spotify, Channel & Playlist and account-management HTTP APIs deny managers.
- Legacy manager_id assignments remain stored for compatibility, but no longer grant managers account-management permission.
- Manager cannot elevate roles, reassign users, or manage another manager/admin. Private group preferences of other accounts are not part of account-list/profile management responses.
- Explicit null manager_id clears assignment; omitted manager_id preserves it.
- Reassign users before deleting/demoting their manager. Prevent deleting/demoting/deactivating own admin or last active admin.
- List/export/delete/refresh and job visibility share server-side ownership enforcement; old jobs resolve ownership through their item.

## Known Pitfalls
- Frontend role cache is refreshed via `/auth/me` during bootstrap; UI visibility never substitutes for backend authorization.
- `user_scope_condition` is an account-management predicate, not a resource data predicate. Resource endpoints use `owner_scope_condition`; `require_user_access` distinguishes data access from `management=True`.
- Existing accounts receive null manager_id through an additive startup migration; no account is automatically reassigned.

## Verification
- `backend/tests/test_manager_auth.py`, `test_manager_data_scope.py`, `test_manager_migration.py` exercise real SQL scopes, endpoint denial, and additive migration.
