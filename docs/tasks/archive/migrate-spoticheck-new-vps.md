# migrate-spoticheck-new-vps Chuyển app và domain

Task hoàn tất ngày 2026-10-09; canonical runtime trong docs/PROJECT_BRIEF.md và deploy/README.md, bằng chứng migration trong docs/CHANGELOG.md.

## Goal
- Chuyển SpotiCheck từ 82.197.71.6 sang 194.233.69.135 và dùng ytm.lushmedia.net.

## Scope
- Repo/Compose, PostgreSQL đầy đủ, .env, Nginx/TLS/DNS, backup timer và old-domain cutover.

## Constraints
- VPS mới có Nginx và ba app ở 8012/8013/8014; SpotiCheck dùng project spoticheck, loopback 8015. Không thay service khác hay standalone YTM.
- Sao lưu, kiểm tra bản restore trước; final dump phải sau khi old app dừng ghi. Không chạy hai bản writable sau cutover.
- Secret chuyển server-to-server qua SSH, không vào Git/log. User/domain có thể cần đăng nhập lại do localStorage khác origin.

## Current State
- New checkout commit7126e74, Compose spoticheck/app+db đã build và restore staging; runtime smoke 5 tài khoản/quyền đạt, key YouTube dùng được IP mới. 561 backend +80 frontend tests đạt.
- Cloudflare A ytm.lushmedia.net=194.233.69.135 Proxied; Let's Encrypt cấp thành công. Nginx mới giữ maintenance503 cho tới final restore.
- Final SQL restore trong transaction; cả18 bảng full-row hashes khớp source trước startup. New app healthy/public200, old domain redirect302, old app stopped/restart=no và timer disabled; DB/image/source giữ rollback.

## Next Steps
- Không còn bước cutover. Theo dõi vận hành tại domain mới; không khởi động old app để tránh split writes.

## Risks
- YouTube API keys có thể bị giới hạn IP cũ; cần kiểm tra với egress IP mới, không tự sửa Google Cloud policy.
