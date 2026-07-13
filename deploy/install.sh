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

echo "==> Installing OS packages (mongod, mongosh, mongodb-database-tools, caddy, ${PY}) from vendor/debs — offline"
# Passing the local .deb paths directly lets apt resolve inter-package
# dependencies from this explicit file list plus what's already installed,
# without touching the network. If a dependency is missing from vendor/debs
# this fails loudly instead of hanging on an unreachable mirror.
apt-get install -y "${DEBS[@]}" \
  || fail "apt failed to install the bundled .deb packages. If this looks like a missing dependency, rebuild the bundle with offline_bundle.sh — do not run 'apt-get -f install' here, it requires internet on an air-gapped box."

command -v mongod >/dev/null 2>&1 || fail "mongod not found after package install — mongodb-org-server did not install correctly."
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

# The caddy .deb's postinst starts caddy.service immediately on package
# install using its own stock Caddyfile (the "Caddy works!" placeholder),
# and only chowns /var/log/caddy to caddy:caddy the first time that
# directory is created. Neither of those covers our shopdocs.log path, so
# set it up explicitly and idempotently rather than relying on the package.
echo "==> Preparing Caddy log path"
id -u caddy >/dev/null 2>&1 || fail "caddy system user not found — the caddy package did not install correctly."
mkdir -p /var/log/caddy
touch /var/log/caddy/shopdocs.log
chown -R caddy:caddy /var/log/caddy
chmod 750 /var/log/caddy
chmod 644 /var/log/caddy/shopdocs.log

systemctl daemon-reload
systemctl enable --now mongod
systemctl enable --now shopdocs-backend

echo "==> Activating Caddy config"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
  || fail "Caddy config failed validation — see errors above."
systemctl enable caddy
# caddy.service may already be running (started by the package's postinst
# with its stock Caddyfile) — 'restart' forces it to load our config,
# whereas 'enable --now' would be a no-op against an already-active unit.
systemctl restart caddy \
  || fail "caddy failed to (re)start. Check: journalctl -u caddy -e"

echo "==> Verifying ShopDocs is actually being served"
# Uses python3.10 (already a hard dependency above) instead of curl, since
# curl isn't guaranteed present on a minimized Ubuntu Server install and
# this box has no network to fetch it.
VERIFY_RC=0
$PY - <<'PYEOF' || VERIFY_RC=$?
import sys, time, urllib.request, urllib.error

def get(path, timeout=3):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1{path}", timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception:
        return None, ""

body = ""
for _ in range(10):
    status, body = get("/")
    if status == 200:
        break
    time.sleep(1)
else:
    print("UNREACHABLE", file=sys.stderr)
    sys.exit(1)

if "caddy works" in body.lower():
    print("DEFAULT_PAGE", file=sys.stderr)
    sys.exit(2)

status, _ = get("/api/auth/me")
if status != 401:
    print(f"BAD_API_STATUS {status}", file=sys.stderr)
    sys.exit(3)
PYEOF

case "$VERIFY_RC" in
  0) echo "    Caddy is serving the ShopDocs frontend and proxying /api/* to the backend." ;;
  1) fail "Caddy did not respond on http://127.0.0.1/ within 10s. Check: journalctl -u caddy -e" ;;
  2) fail "Caddy is still serving its default placeholder page instead of /etc/caddy/Caddyfile. Check: journalctl -u caddy -e" ;;
  3) fail "Expected /api/* to be proxied to the ShopDocs backend (got a non-401 status from http://127.0.0.1/api/auth/me). Check: journalctl -u caddy -e and journalctl -u shopdocs-backend -e" ;;
  *) fail "Post-install verification failed unexpectedly (exit $VERIFY_RC)." ;;
esac

IP=$(hostname -I | awk '{print $1}')
echo
echo "==========================================="
echo " ShopDocs is live at:  http://$IP/"
echo " Backend logs:        journalctl -u shopdocs-backend -f"
echo "==========================================="
