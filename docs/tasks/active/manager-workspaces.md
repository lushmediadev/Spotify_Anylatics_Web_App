# manager-workspaces Quyền workspace cho manager và user kế thừa

## Goal
- Admin tích chọn Youtube, Spotify, Youtube-Spotify khi tạo/sửa manager; user dưới quyền kế thừa quyền hiện tại của manager.

## Scope
- User model/schema, shared workspace authorization, auth response/CRUD, shell navigation và modal quản lý tài khoản.

## Constraints
- Youtube là YTM, Spotify là Link Checker, Youtube-Spotify là Channel & Playlist riêng. Quyền dữ liệu vẫn own-account-only.
- Manager cũ giữ Youtube; admin/unassigned user giữ cả ba. Chỉ admin đặt workspace cho manager; manager không tự sửa workspace hoặc đặt cho user.
- Migration nullable JSON, API thêm field workspaces; không đổi route/field cũ, dữ liệu hay standalone YTM.

## Current State
- Backend/UI hoàn tất: 561 backend và 80 frontend/browser tests pass; local smoke xác nhận multi-select/edit prefill, manager không có selector và user có đúng navigation kế thừa.

## Next Steps
- Kiểm thử grant combinations, inheritance/reassignment/revocation và tampering; browser local, PostgreSQL preflight, rollout app-only và health.

## Risks
- UI cache stale sau admin đổi quyền; API cần enforce quyền hiện tại, frontend refresh/chuyển view hợp lệ.
