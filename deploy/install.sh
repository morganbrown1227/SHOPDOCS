#!/usr/bin/env bash
# Installer for ShopDocs. Run as root on Ubuntu 22.04.
#
# Two install paths, auto-detected:
#   OFFLINE — this script is sitting inside an extracted offline bundle
#             (vendor/debs + vendor/wheels present, built by offline_bundle.sh).
#             Nothing here touches the network; only vendor/debs and
#             vendor/wheels are used.
#   ONLINE  — no bundle found (e.g. running straight from a git checkout:
#             `git clone ... && cd shopdocs && sudo bash deploy/install.sh`).
#             MongoDB, Caddy and Node are installed from their official apt
#             repositories, and the frontend is built locally.
set -euo pipefail

UPGRADE=0
[[ "${1:-}" == "--upgrade" ]] && UPGRADE=1

HERE=$(cd "$(dirname "$0")" && pwd)
APP=/opt/shopdocs
DATA=/opt/shopdocs/uploads
USER=shopdocs
PY=python3.10
NODE_MAJOR=20

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "run this as root (sudo bash install.sh)."

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
    echo "WARNING: this installer targets Ubuntu 22.04 (found ${PRETTY_NAME:-unknown}). Continuing anyway." >&2
  fi
fi

STAGE=""
trap '[[ -n "$STAGE" ]] && rm -rf "$STAGE"' EXIT

if [[ -d "$HERE/vendor/debs" && -d "$HERE/vendor/wheels" ]]; then
  # ---------------------------------------------------------------- OFFLINE
  OFFLINE=1
  echo "==> Offline bundle detected (vendor/debs + vendor/wheels) — installing with no network access"

  shopt -s nullglob
  DEBS=("$HERE"/vendor/debs/*.deb)
  WHEELS=("$HERE"/vendor/wheels/*.whl)
  [[ ${#DEBS[@]} -gt 0 ]]   || fail "vendor/debs is empty — this bundle was not built correctly (see deploy/offline_bundle.sh)."
  [[ ${#WHEELS[@]} -gt 0 ]] || fail "vendor/wheels is empty — this bundle was not built correctly (see deploy/offline_bundle.sh)."
  [[ -d "$HERE/app/backend" ]] || fail "app/backend is missing from this bundle."

  APP_SRC="$HERE/app"
  DEPLOY_SRC="$HERE/deploy"

  echo "==> Installing OS packages (mongod, mongosh, mongodb-database-tools, caddy, ${PY}) from vendor/debs — offline"
  # Passing the local .deb paths directly lets apt resolve inter-package
  # dependencies from this explicit file list plus what's already installed,
  # without touching the network. If a dependency is missing from vendor/debs
  # this fails loudly instead of hanging on an unreachable mirror.
  apt-get install -y "${DEBS[@]}" \
    || fail "apt failed to install the bundled .deb packages. If this looks like a missing dependency, rebuild the bundle with offline_bundle.sh — do not run 'apt-get -f install' here, it requires internet on an air-gapped box."
else
  # ----------------------------------------------------------------- ONLINE
  OFFLINE=0
  echo "==> No offline bundle found (vendor/debs, vendor/wheels) — installing online from package repositories"

  REPO_ROOT="$(cd "$HERE/.." && pwd)"
  [[ -d "$REPO_ROOT/backend" && -d "$REPO_ROOT/frontend" ]] \
    || fail "backend/ and frontend/ were not found next to deploy/ ($REPO_ROOT). Run this from a full ShopDocs git checkout (sudo bash deploy/install.sh from the repo root), or supply an offline bundle with vendor/debs + vendor/wheels."
  [[ -f "$REPO_ROOT/backend/requirements-prod.txt" ]] \
    || fail "backend/requirements-prod.txt is missing from $REPO_ROOT."

  DEPLOY_SRC="$HERE"

  echo "==> Adding MongoDB 7.0, Caddy and Node ${NODE_MAJOR}.x apt repositories"
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    || fail "could not install ca-certificates/curl/gnupg — check network connectivity."

  curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    || fail "could not fetch/dearmor the MongoDB 7.0 apt signing key — check network connectivity."
  cat > /etc/apt/sources.list.d/mongodb-org-7.0.list <<'EOF'
deb [ arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse
EOF

  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    || fail "could not fetch/dearmor the Caddy stable apt signing key — check network connectivity."
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list \
    || fail "could not fetch the Caddy apt repo definition — check network connectivity."

  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg \
    || fail "could not fetch/dearmor the NodeSource apt signing key — check network connectivity."
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  echo "==> Installing OS packages (mongod, mongosh, mongodb-database-tools, caddy, ${PY}, node) from their repositories"
  apt-get update
  apt-get install -y \
      mongodb-org-server mongodb-mongosh mongodb-database-tools \
      caddy "$PY" "${PY}-venv" python3-pip nodejs \
    || fail "apt failed to install MongoDB/Caddy/Node from their repositories. Check network connectivity and apt sources, then re-run."
  command -v yarn >/dev/null 2>&1 || npm install -g yarn \
    || fail "could not install yarn (npm install -g yarn failed)."
fi

command -v mongod >/dev/null 2>&1 || fail "mongod not found after package install — mongodb-org-server did not install correctly."
command -v caddy  >/dev/null 2>&1 || fail "caddy not found after package install."
command -v $PY    >/dev/null 2>&1 || fail "$PY not found after package install."

id -u $USER >/dev/null 2>&1 || useradd --system --home $APP --shell /usr/sbin/nologin $USER

mkdir -p $APP $DATA

if [[ $OFFLINE -eq 0 ]]; then
  # REACT_APP_BACKEND_URL is a Create React App *build-time* env var — it gets
  # baked into the JS bundle by `yarn build` below. Left unset, api.js ends up
  # with the literal string "undefined/api" as its base URL: a relative path
  # that never resolves to Caddy's /api/* proxy rule, so every request (login,
  # auth/me, everything) silently misroutes to the SPA's static-file fallback.
  # Empty string = same-origin ("/api"), correct for this single-host reverse
  # proxy setup where Caddy serves the frontend and proxies /api/* itself.
  echo "==> Configuring frontend build (same-origin API base)"
  echo 'REACT_APP_BACKEND_URL=' > "$REPO_ROOT/frontend/.env"

  echo "==> Building frontend production bundle (this can take a minute)"
  ( cd "$REPO_ROOT/frontend" && yarn install --frozen-lockfile && yarn build ) \
    || fail "frontend build failed — see yarn output above."

  STAGE=$(mktemp -d)
  mkdir -p "$STAGE/backend" "$STAGE/frontend"
  rsync -a --exclude='__pycache__' --exclude='uploads' --exclude='.venv' \
        "$REPO_ROOT/backend/" "$STAGE/backend/"
  # The shipped requirements.txt is the runtime-only subset (see requirements-prod.txt);
  # the full dev/test requirements.txt is not needed on the server.
  cp "$REPO_ROOT/backend/requirements-prod.txt" "$STAGE/backend/requirements.txt"
  rm -f "$STAGE/backend/requirements-prod.txt"
  rsync -a --exclude='node_modules' "$REPO_ROOT/frontend/" "$STAGE/frontend/"

  APP_SRC="$STAGE"
fi

if [[ $UPGRADE -eq 0 ]] || [[ ! -d $APP/backend ]]; then
  rsync -a --delete --exclude='uploads' --exclude='.env' "$APP_SRC/" "$APP/"
else
  rsync -a --delete --exclude='uploads' --exclude='.env' \
        --exclude='backend/.venv' "$APP_SRC/" "$APP/"
fi

echo "==> Python venv + dependencies"
$PY -m venv $APP/backend/.venv
if [[ $OFFLINE -eq 1 ]]; then
  $APP/backend/.venv/bin/pip install --no-index --find-links "$HERE/vendor/wheels" \
      -r $APP/backend/requirements.txt
else
  $APP/backend/.venv/bin/pip install -r $APP/backend/requirements.txt \
    || fail "pip failed to install backend dependencies. Check network connectivity and re-run."
fi

if [[ ! -f $APP/backend/.env ]]; then
  echo "==> Creating /opt/shopdocs/backend/.env"
  SECRET=$($PY -c 'import secrets;print(secrets.token_hex(32))')
  cat > $APP/backend/.env <<EOF
MONGO_URL="mongodb://127.0.0.1:27017"
DB_NAME="shopdocs"
CORS_ORIGINS="*"
JWT_SECRET="$SECRET"
ADMIN_EMAIL="admin@local.app"
ADMIN_PASSWORD="Southwire123!@#"
UPLOAD_DIR="$DATA"
EOF
  chmod 600 $APP/backend/.env
  echo "==> Seeded default admin admin@local.app — change this password after first login."
fi

chown -R $USER:$USER $APP

# $APP itself is only ever created via 'mkdir -p' above, so its mode comes
# from whatever umask happened to be active (e.g. a hardened root umask of
# 077 leaves it drwx------, which blocks caddy — a different user, not in
# group shopdocs — from traversing into it at all, even though the files
# underneath are readable). rsync -a preserves source permissions for
# everything it copies, but never rewrites the mode of a pre-existing
# destination directory like $APP itself, so this has to be set explicitly.
chmod 755 $APP
find $APP/frontend -type d -exec chmod 755 {} +
find $APP/frontend -type f -exec chmod 644 {} +

echo "==> Installing systemd unit + Caddy config"
install -m 644 "$DEPLOY_SRC/shopdocs-backend.service" /etc/systemd/system/
install -m 644 "$DEPLOY_SRC/Caddyfile" /etc/caddy/Caddyfile

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
# curl isn't guaranteed present on a minimized Ubuntu Server install (offline
# path) and this check should behave identically on both install paths.
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

status, body = None, ""
for _ in range(10):
    status, body = get("/")
    if status is not None:
        break
    time.sleep(1)

if status is None:
    print("UNREACHABLE", file=sys.stderr)
    sys.exit(1)

if status == 403:
    print("FORBIDDEN", file=sys.stderr)
    sys.exit(4)

if status != 200:
    print(f"BAD_ROOT_STATUS {status}", file=sys.stderr)
    sys.exit(5)

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
  4) fail "Frontend directory permissions prevent Caddy access. Check: namei -l $APP/frontend/build/index.html — every parent directory (including $APP itself) must be traversable (o+x) by the caddy user." ;;
  5) fail "Caddy responded with an unexpected HTTP status at http://127.0.0.1/ (expected 200). Check: journalctl -u caddy -e" ;;
  *) fail "Post-install verification failed unexpectedly (exit $VERIFY_RC)." ;;
esac

IP=$(hostname -I | awk '{print $1}')
echo
echo "==========================================="
echo " ShopDocs is live at:  http://$IP/"
echo " Backend logs:        journalctl -u shopdocs-backend -f"
echo "==========================================="
