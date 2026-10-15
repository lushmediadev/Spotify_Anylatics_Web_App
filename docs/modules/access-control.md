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
- `backend/app/services/workspace_access.py`: canonical workspace grants, dynamic inheritance và HTTP authorization.

## Invariants
- Phạm vi dữ liệu (`owner_scope_condition`, YTM `visible_owner_ids`): admin xem/sửa/xóa/refresh dữ liệu của mọi tài khoản; manager của chính mình và của user (role `user`) có `manager_id` = manager đó; user chỉ của mình. Áp dụng như nhau cho YouTube Checker, Channel & Playlist và Spotify Checker. Admin và user không thuộc manager có cả ba workspace. Keys/profile/settings dùng chung.
- UI: bộ lọc owner (`frontend/owner-filter.js`, `#manager-filter-wrap` trong group panel) chỉ hiện cho admin/manager, mặc định là chính mình, chọn một tài khoản áp cho cả ba workspace. Mọi lệnh ghi gửi kèm owner (`user_id` / `target_user_id`) để không bao giờ tác động lên toàn bộ phạm vi khi xem một tài khoản. Tên hiển thị `User (Manager)`.
- Admin quản lý mọi tài khoản và global preferences. Manager có Users cùng các workspace được admin gán; user dưới quyền kế thừa workspace hiện tại của manager, không có bản quyền riêng để manager tự thay đổi.
- ID/label workspace: `youtube` = YouTube Checker; `spotify` = Spotify Checker; `youtube-spotify` = Channel & Playlist. Checkbox có thể chọn nhiều, ít nhất một.
- `User.workspace_access` là nullable JSON cho manager; API request/response thêm `workspaces` array. Manager cũ/null mặc định Youtube; admin/standalone user giữ cả ba. Assigned user resolve từ manager mỗi request, manager invalid/inactive fail closed với [] và chỉ còn shared profile/settings.
- Chỉ admin đặt workspace khi create/update role manager. Manager/user gửi field này bị chặn; field omitted giữ nguyên cấu hình, null/empty/unknown không được dùng để mở rộng quyền. API gates và navigation dùng cùng effective response.
- Manager tạo duy nhất role user; backend tự gắn manager_id của manager đang đăng nhập. Admin thấy và sửa/reset-password được tất cả tài khoản; manager chỉ sửa/reset-password/activate/delete user được gắn manager_id của mình. Không nhân bản user sang một danh sách riêng.
- Manager cannot elevate roles, reassign users, or manage another manager/admin. Private group preferences of other accounts are not part of account-list/profile management responses.
- Explicit null manager_id clears assignment; omitted manager_id preserves it.
- Reassign users before deleting/demoting their manager. Prevent deleting/demoting/deactivating own admin or last active admin.
- Management authorization khóa và refresh target row trong transaction để việc admin đổi role/manager_id không để manager cũ sửa user qua bản dữ liệu cache.
- List/export/delete/refresh and job visibility share server-side ownership enforcement; old jobs resolve ownership through their item.

## Known Pitfalls
- Frontend role cache is refreshed via `/auth/me` during bootstrap; UI visibility never substitutes for backend authorization.
- `user_scope_condition` is an account-management predicate, not a resource data predicate. Resource endpoints use `owner_scope_condition`; `require_user_access` distinguishes data access from `management=True`.
- Existing accounts receive null manager_id through an additive startup migration; no account is automatically reassigned.

## Verification
- `backend/tests/test_manager_auth.py`, `test_manager_data_scope.py`, `test_manager_migration.py` exercise real SQL scopes, endpoint denial, and additive migration.
