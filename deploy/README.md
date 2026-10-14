# VPS Deployment

## VPS có Nginx dùng chung

- SpotiCheck dùng `/opt/spoticheck/app`, `docker-compose.nginx.yml` (project `spoticheck`) và chỉ publish `127.0.0.1:8015`.
- Đặt `APP_DOMAIN=ytm.lushmedia.net` trong `.env`, và ghi `docker-compose.nginx.yml` vào `deploy/.compose-file` để helper/backup/update chọn đúng runtime.
- Nginx host dùng `deploy/nginx/ytm.lushmedia.net.conf`; cấp certificate Let's Encrypt bằng webroot `/var/www/letsencrypt`, kiểm tra `nginx -t` trước reload. Không bật service Caddy từ compose legacy trên máy đã có Nginx.
- Deploy/health: `docker compose -f docker-compose.nginx.yml --env-file .env up -d --build`, `curl http://127.0.0.1:8015/api/health`, sau đó kiểm tra HTTPS public.
- Khi chuyển VPS: backup trước, restore thử và đối chiếu; final dump sau khi dừng app cũ, restore bản cuối rồi mới mở app mới. Giữ DB/image cũ để rollback, không cho hai bản nhận ghi cùng lúc.

## Legacy Caddy host

Hai domain `ytm.jazzrelaxation.com` và `spotify.jazzrelaxation.com` đã ngừng hoạt động: không còn DNS record, old origin trả HTTP 410 và không redirect. Không dùng hai domain này làm `APP_DOMAIN` hoặc tạo lại DNS khi triển khai. VPS cũ chỉ giữ shared Caddy/mail và các service khác; không rollout lại SpotiCheck lên đó.

This folder contains the tracked runtime config for the VPS stack:

- `docker-compose.vps.yml`: app + PostgreSQL + Caddy
- `.env.example`: environment template
- `Caddyfile`: reverse proxy for the public domain
- `scripts/`: operational commands for redeploy, backup, and data migration
- `systemd/`: timer/service units for automated backups

Recommended rollout:

1. Copy `.env.example` to `.env` and fill in real secrets.
2. Run `docker compose -f docker-compose.vps.yml --env-file .env up -d --build`.
3. Verify the app locally on the VPS with:
   - `docker compose -f docker-compose.vps.yml --env-file .env ps`
   - `docker compose -f docker-compose.vps.yml --env-file .env logs -f app`
   - `curl http://127.0.0.1/api/health -H "Host: ytm.lushmedia.net"`
4. Với một deployment Caddy mới, trỏ DNS của `APP_DOMAIN` đang dùng tới VPS phù hợp. Production hiện tại dùng Nginx trên `194.233.69.135`.
5. Kiểm tra `https://ytm.lushmedia.net/api/health` sau DNS cutover.

Operational notes:

- The app still serves the frontend from FastAPI; there is no separate frontend container.
- Persistent business data lives in PostgreSQL (`postgres_data` volume).
- Caddy manages the origin certificate once the public domain resolves to this VPS.
- After installing the helper wrapper, day-to-day commands can use `spoticheck status|logs|backup|redeploy|update|set-admin`.
- GitHub `main` is the deployment source of truth. The normal release flow is: test locally, commit and push to GitHub, SSH to the VPS, then run `spoticheck update`.
- `spoticheck update` fetches `origin/main`, pulls the latest commit, and runs the Compose redeploy. It should be used instead of manually copying source files to the VPS.
- To restore a known version, inspect `git log` on GitHub, check out or revert the desired commit in a controlled local branch, push the release commit, then run `spoticheck update` on the VPS.
- `scripts/migrate_from_database_url.sh` expects a real source PostgreSQL URL in `SOURCE_DATABASE_URL`; this is intended for Railway or any other external PostgreSQL source.
- `spoticheck set-admin [--current <old_admin>] [--username <new_admin>] [--password <new_password>]` rotates the persisted admin login in PostgreSQL. If `--current` is omitted, the script auto-selects the only admin account. If `--password` is omitted, the script prompts securely.
