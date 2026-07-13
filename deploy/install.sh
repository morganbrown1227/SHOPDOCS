#!/usr/bin/env bash
# On-prem installer for ShopDocs. Run as root on the air-gapped Ubuntu 22.04
# server. Everything below runs with no network access — it only ever reads
# from vendor/debs and vendor/wheels shipped in this bundle.
set -euo pipefail

UPGRADE=0
[[ "${1:-}" == "--upgrade" ]] && UPGRADE=1

HERE=$(cd "$(dirname "$0")" && pwd)
APP=/opt/shopdocs
DATA=/opt/shopdocs/uploads
USER=shopdocs
PY=python3.10

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "run this as root (sudo bash install.sh)."

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
    echo "WARNING: this bundle was built and tested for Ubuntu 22.04 (found ${PRETTY_NAME:-unknown}). Continuing anyway." >&2
  fi
fi

shopt -s nullglob
DEBS=("$HERE"/vendor/debs/*.deb)
WHEELS=("$HERE"/vendor/wheels/*.whl)
[[ ${#DEBS[@]} -gt 0 ]]   || fail "vendor/debs is empty — this bundle was not built correctly (see deploy/offline_bundle.sh)."
[[ ${#WHEELS[@]} -gt 0 ]] || fail "vendor/wheels is empty — this bundle was not built correctly (see deploy/offline_bundle.sh)."
[[ -d "$HERE/app/backend" ]] || fail "app/backend is missing from this bundle."

echo "==> Installing OS packages (mongodb-org, caddy, ${PY}) from vendor/debs — offline"
# Passing the local .deb paths directly lets apt resolve inter-package
# dependencies from this explicit file list plus what's already installed,
# without touching the network. If a dependency is missing from vendor/debs
# this fails loudly instead of hanging on an unreachable mirror.
apt-get install -y "${DEBS[@]}" \
  || fail "apt failed to install the bundled .deb packages. If this looks like a missing dependency, rebuild the bundle with offline_bundle.sh — do not run 'apt-get -f install' here, it requires internet on an air-gapped box."

command -v mongod >/dev/null 2>&1 || fail "mongod not found after package install — mongodb-org did not install correctly."
command -v caddy  >/dev/null 2>&1 || fail "caddy not found after package install."
command -v $PY    >/dev/null 2>&1 || fail "$PY not found after package install."

id -u $USER >/dev/null 2>&1 || useradd --system --home $APP --shell /usr/sbin/nologin $USER

mkdir -p $APP $DATA
if [[ $UPGRADE -eq 0 ]] || [[ ! -d $APP/backend ]]; then
  rsync -a --delete --exclude='uploads' --exclude='.env' "$HERE/app/" "$APP/"
else
  rsync -a --delete --exclude='uploads' --exclude='.env' \
        --exclude='backend/.venv' "$HERE/app/" "$APP/"
fi

echo "==> Python venv + offline wheels"
$PY -m venv $APP/backend/.venv
$APP/backend/.venv/bin/pip install --no-index --find-links "$HERE/vendor/wheels" \
    -r $APP/backend/requirements.txt

if [[ ! -f $APP/backend/.env ]]; then
  echo "==> Creating /opt/shopdocs/backend/.env"
  read -rp "Admin email   : " EMAIL
  read -rsp "Admin password: " PW; echo
  SECRET=$($PY -c 'import secrets;print(secrets.token_hex(32))')
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
