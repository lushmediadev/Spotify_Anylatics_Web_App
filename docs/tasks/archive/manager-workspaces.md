# manager-workspaces Quyền workspace cho manager và user kế thừa

Task hoàn tất ngày 2026-10-09; bằng chứng release nằm ở entry cùng ngày trong docs/CHANGELOG.md.

## Goal
- Admin tích chọn Youtube, Spotify, Youtube-Spotify khi tạo/sửa manager; user dưới quyền kế thừa quyền hiện tại của manager.

## Scope
- User model/schema, shared workspace authorization, auth response/CRUD, shell navigation và modal quản lý tài khoản.

## Constraints
- Youtube là YTM, Spotify là Link Checker, Youtube-Spotify là Channel & Playlist riêng. Quyền dữ liệu vẫn own-account-only.
- Manager cũ giữ Youtube; admin/unassigned user giữ cả ba. Chỉ admin đặt workspace cho manager; manager không tự sửa workspace hoặc đặt cho user.
- Migration nullable JSON, API thêm field workspaces; không đổi route/field cũ, dữ liệu hay standalone YTM.

## Current State
- Backend/UI đã deploy `9039535`; 561 backend và 80 frontend/browser tests pass. PostgreSQL copy và production scope/health checks đạt; dữ liệu và service khác giữ nguyên.

## Next Steps
- Không còn việc implementation/deploy. Admin chỉnh workspace của từng manager theo nhu cầu vận hành.

## Risks
- UI cache stale sau admin đổi quyền; API cần enforce quyền hiện tại, frontend refresh/chuyển view hợp lệ.
