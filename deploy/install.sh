#!/usr/bin/env bash
# On-prem installer for ShopDocs. Run as root on the air-gapped server.
set -euo pipefail

UPGRADE=0
[[ "${1:-}" == "--upgrade" ]] && UPGRADE=1

HERE=$(cd "$(dirname "$0")" && pwd)
APP=/opt/shopdocs
DATA=/opt/shopdocs/uploads
USER=shopdocs

echo "==> Installing OS packages from vendor/debs"
dpkg -i "$HERE"/vendor/debs/*.deb 2>/dev/null || apt-get -f install -y

id -u $USER >/dev/null 2>&1 || useradd --system --home $APP --shell /usr/sbin/nologin $USER

mkdir -p $APP $DATA
if [[ $UPGRADE -eq 0 ]] || [[ ! -d $APP/backend ]]; then
  rsync -a --delete --exclude='uploads' --exclude='.env' "$HERE/app/" "$APP/"
else
  rsync -a --delete --exclude='uploads' --exclude='.env' \
        --exclude='backend/.venv' "$HERE/app/" "$APP/"
fi

echo "==> Python venv + offline wheels"
python3.11 -m venv $APP/backend/.venv
$APP/backend/.venv/bin/pip install --no-index --find-links "$HERE/vendor/wheels" \
    -r $APP/backend/requirements.txt

if [[ ! -f $APP/backend/.env ]]; then
  echo "==> Creating /opt/shopdocs/backend/.env"
  read -rp "Admin email   : " EMAIL
  read -rsp "Admin password: " PW; echo
  SECRET=$(python3.11 -c 'import secrets;print(secrets.token_hex(32))')
  cat > $APP/backend/.env <<EOF
MONGO_URL="mongodb://127.0.0.1:27017"
DB_NAME="shopdocs"
CORS_ORIGINS="*"
JWT_SECRET="$SECRET"
ADMIN_EMAIL="$EMAIL"
ADMIN_PASSWORD="$PW"
UPLOAD_DIR="$DATA"
EOF
  chmod 600 $APP/backend/.env
fi

chown -R $USER:$USER $APP

echo "==> Installing systemd unit + Caddy config"
install -m 644 "$HERE/deploy/shopdocs-backend.service" /etc/systemd/system/
install -m 644 "$HERE/deploy/Caddyfile" /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now mongod
systemctl enable --now shopdocs-backend
systemctl enable --now caddy

IP=$(hostname -I | awk '{print $1}')
echo
echo "==========================================="
echo " ShopDocs is live at:  http://$IP/"
echo " Backend logs:        journalctl -u shopdocs-backend -f"
echo "==========================================="
