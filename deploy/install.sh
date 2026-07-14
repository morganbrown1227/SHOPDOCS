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
NODE_MAJOR=20

# shellcheck source=./lib.sh
source "$HERE/lib.sh"

require_root
check_ubuntu_2204

# Routine "pull new code, redeploy" updates should go through update.sh —
# it's faster (skips OS package/apt work entirely) and safer (only restarts
# services whose config actually changed). install.sh --upgrade still works
# for the heavier case update.sh doesn't handle: refreshing OS packages, or
# an offline-bundle upgrade that doesn't come from a live git checkout.
if [[ $UPGRADE -eq 0 ]] && existing_install_present; then
  echo "An existing ShopDocs installation was found at $APP."
  echo "For a routine code update, use the lighter-weight updater instead:"
  echo
  echo "    sudo bash deploy/update.sh"
  echo
  echo "(Run 'sudo bash deploy/install.sh --upgrade' instead if you specifically need to refresh OS packages.)"
  exit 0
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

id -u $SVC_USER >/dev/null 2>&1 || useradd --system --home $APP --shell /usr/sbin/nologin $SVC_USER

mkdir -p $APP $DATA

if [[ $OFFLINE -eq 0 ]]; then
  echo "==> Building frontend production bundle (this can take a minute)"
  build_frontend "$REPO_ROOT"

  STAGE=$(mktemp -d)
  stage_app_src "$REPO_ROOT" "$STAGE"

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

ensure_backend_env
fix_app_permissions

echo "==> Installing systemd unit + Caddy config"
install -m 644 "$DEPLOY_SRC/shopdocs-backend.service" /etc/systemd/system/
install -m 644 "$DEPLOY_SRC/Caddyfile" /etc/caddy/Caddyfile

echo "==> Preparing Caddy log path"
prepare_caddy_log

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

echo "==> Trusting Caddy's internal CA on this host"
caddy_trust

echo "==> Verifying ShopDocs is actually being served"
verify_services_active
verify_serving

echo
echo "==========================================="
echo " ShopDocs is live at:  https://shopdocs/"
echo " (adjust deploy/Caddyfile's site address if your LAN hostname differs)"
echo
echo " Other devices (phones, tablets, other desktops) will see a"
echo " certificate warning until they trust Caddy's internal CA too —"
echo " see \"Trusting the certificate on client devices\" in deploy/README.md."
echo
echo " Backend logs:        journalctl -u shopdocs-backend -f"
echo "==========================================="
