# migrate-spoticheck-new-vps Chuyển app và domain

## Goal
- Chuyển SpotiCheck từ 82.197.71.6 sang 194.233.69.135 và dùng ytm.lushmedia.net.

## Scope
- Repo/Compose, PostgreSQL đầy đủ, .env, Nginx/TLS/DNS, backup timer và old-domain cutover.

## Constraints
- VPS mới có Nginx và ba app ở 8012/8013/8014; SpotiCheck dùng project spoticheck, loopback 8015. Không thay service khác hay standalone YTM.
- Sao lưu, kiểm tra bản restore trước; final dump phải sau khi old app dừng ghi. Không chạy hai bản writable sau cutover.
- Secret chuyển server-to-server qua SSH, không vào Git/log. User/domain có thể cần đăng nhập lại do localStorage khác origin.

## Current State
- SSH hai VPS và Cloudflare đã truy cập được; ytm.lushmedia.net chưa có DNS. Đang chuẩn bị runtime riêng để tránh đụng Nginx hiện có.

## Next Steps
- Deploy staging/restore thử, TLS/DNS, final dump và data comparison, cutover/re-login smoke/backup.

## Risks
- YouTube API keys có thể bị giới hạn IP cũ; cần kiểm tra với egress IP mới, không tự sửa Google Cloud policy.
