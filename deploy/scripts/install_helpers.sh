#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"

install -d -m 755 /opt/spoticheck/backups/postgres
install -d -m 755 /opt/spoticheck/backups/imports
if id deploy >/dev/null 2>&1; then
  chown -R deploy:deploy /opt/spoticheck/backups
fi

ln -sfn "${SCRIPT_DIR}/spoticheck.sh" /usr/local/bin/spoticheck
install -m 644 "${DEPLOY_DIR}/systemd/spoticheck-backup.service" /etc/systemd/system/spoticheck-backup.service
install -m 644 "${DEPLOY_DIR}/systemd/spoticheck-backup.timer" /etc/systemd/system/spoticheck-backup.timer

if id deploy >/dev/null 2>&1; then
ln -sfn "${APP_DIR}" /home/deploy/spoticheck-app
cat > /home/deploy/.bash_aliases <<'EOF'
alias sc='cd /opt/spoticheck/app/deploy'
alias scapp='cd /opt/spoticheck/app'
alias scstatus='spoticheck status'
alias sclogs='spoticheck logs app'
EOF
chown -h deploy:deploy /home/deploy/spoticheck-app
chown deploy:deploy /home/deploy/.bash_aliases
else
  # Root-only hosts still get the same backup/helper lifecycle without a new user.
  install -d -m 755 /etc/systemd/system/spoticheck-backup.service.d
  printf '[Service]\nUser=root\n' > /etc/systemd/system/spoticheck-backup.service.d/runtime-user.conf
fi

systemctl daemon-reload
systemctl enable --now spoticheck-backup.timer
systemctl restart spoticheck-backup.timer

echo "Installed helper command: /usr/local/bin/spoticheck"
echo "Installed timer: spoticheck-backup.timer"
