#!/usr/bin/env bash
# In-place updater for an existing ShopDocs installation. Run as root on the
# target VM after pulling new code — this is NOT a substitute for
# deploy/install.sh, which does full OS package installation for a
# first-time (or offline-bundle) setup. See "install.sh vs update.sh" in
# deploy/README.md for how the two relate.
#
# Workflow:
#   Builder VM:  git add . && git commit -m "..." && git push
#   Target VM:   cd ~/SHOPDOCS && git pull && sudo bash deploy/update.sh
#
# Guarantees:
#   - Never touches MongoDB data (no drop/reinit — mongod is only started if
#     it isn't already running).
#   - Never overwrites backend/.env, or Caddy/systemd config that hasn't
#     actually changed.
#   - Safe to run repeatedly: skips work (frontend rebuild, config reinstall,
#     dependency pruning) whenever there's nothing to do.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT="$(cd "$HERE/.." && pwd)"
DEPLOY_SRC="$HERE"

# shellcheck source=./lib.sh
source "$HERE/lib.sh"

require_root
check_ubuntu_2204

[[ -d "$REPO_ROOT/backend" && -d "$REPO_ROOT/frontend" ]] \
  || fail "backend/ and frontend/ were not found next to deploy/ ($REPO_ROOT). Run this from a full ShopDocs git checkout (cd into the repo, then sudo bash deploy/update.sh)."
[[ -f "$REPO_ROOT/backend/requirements-prod.txt" ]] \
  || fail "backend/requirements-prod.txt is missing from $REPO_ROOT."

for bin in mongod caddy "$PY" rsync yarn; do
  command -v "$bin" >/dev/null 2>&1 \
    || fail "'$bin' not found. This doesn't look like a provisioned ShopDocs host yet — run 'sudo bash deploy/install.sh' first."
done

existing_install_present \
  || fail "No existing ShopDocs installation found at $APP (missing backend/.env or the shopdocs-backend systemd unit). Run 'sudo bash deploy/install.sh' for a first-time install — update.sh only handles in-place upgrades."

echo "==> Updating existing ShopDocs installation at $APP"

# ---------- Frontend: rebuild only if source actually changed ----------
HASH_FILE="$APP/.frontend_src_hash"
NEW_HASH=$(
  { find "$REPO_ROOT/frontend/src" "$REPO_ROOT/frontend/public" -type f 2>/dev/null
    printf '%s\n' "$REPO_ROOT/frontend/package.json" "$REPO_ROOT/frontend/yarn.lock"
  } | sort | xargs sha256sum | sha256sum | cut -d' ' -f1
)
OLD_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

if [[ "$NEW_HASH" == "$OLD_HASH" && -d "$APP/frontend/build" ]]; then
  info "Frontend unchanged since last update — skipping rebuild."
  FRONTEND_CHANGED=0
else
  info "Building frontend production bundle (this can take a minute)"
  build_frontend "$REPO_ROOT"
  FRONTEND_CHANGED=1
fi

# ---------- Backend: track whether source/deps actually changed ----------
BACKEND_HASH_FILE="$APP/.backend_src_hash"
NEW_BACKEND_HASH=$(
  find "$REPO_ROOT/backend" -type f -not -path '*/__pycache__/*' -not -path '*/.venv/*' \
  | sort | xargs sha256sum | sha256sum | cut -d' ' -f1
)
OLD_BACKEND_HASH=$(cat "$BACKEND_HASH_FILE" 2>/dev/null || echo "")
BACKEND_CHANGED=0
[[ "$NEW_BACKEND_HASH" != "$OLD_BACKEND_HASH" ]] && BACKEND_CHANGED=1

# ---------- Stage + sync backend/frontend code ----------
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
stage_app_src "$REPO_ROOT" "$STAGE"

info "Syncing backend + frontend into $APP (uploads/, .env, import_staging/ and the venv are never touched)"
rsync -a --delete --exclude='uploads' --exclude='.env' --exclude='backend/.venv' \
      --exclude='backend/import_staging' "$STAGE/" "$APP/"

[[ "$FRONTEND_CHANGED" -eq 1 ]] && echo "$NEW_HASH" > "$HASH_FILE"
echo "$NEW_BACKEND_HASH" > "$BACKEND_HASH_FILE"

# ---------- Python dependencies: reuse the venv, add/upgrade, prune safely ----------
info "Syncing Python dependencies"
if [[ ! -d "$APP/backend/.venv" ]]; then
  warn "No existing venv found at $APP/backend/.venv — creating one (unexpected for an update; did a previous install get interrupted?)."
  $PY -m venv "$APP/backend/.venv"
fi
"$APP/backend/.venv/bin/pip" install -q -r "$APP/backend/requirements.txt" \
  || fail "pip failed to install backend dependencies. Check network connectivity and re-run."

# Prune dependencies requirements.txt no longer needs. Restricted to "leaf"
# packages — ones nothing else currently installed depends on — via `pip
# list --not-required`, so this can never break the install by removing a
# transitive dependency something else still needs.
REQ_NAMES=$(grep -v '^\s*#' "$APP/backend/requirements.txt" \
            | sed -E 's/[[:space:]]*@.*//; s/[<>=!~;].*//; s/\[[^]]*\]//' \
            | tr -d ' \t\r' | tr 'A-Z' 'a-z' | tr '_' '-' \
            | grep -v '^$' | sort -u)
LEAF_PKGS=$("$APP/backend/.venv/bin/pip" list --not-required --format=freeze 2>/dev/null \
            | cut -d'=' -f1 || true)
for pkg in $LEAF_PKGS; do
  norm=$(echo "$pkg" | tr 'A-Z' 'a-z' | tr '_' '-')
  case "$norm" in
    pip|setuptools|wheel) continue ;;
  esac
  if ! grep -qx "$norm" <<< "$REQ_NAMES"; then
    info "Removing dependency no longer required: $pkg"
    "$APP/backend/.venv/bin/pip" uninstall -y "$pkg" >/dev/null
  fi
done

# ---------- Config: never overwritten unless it actually changed ----------
ensure_backend_env
ensure_import_staging_dir
fix_app_permissions

SVC_CHANGED=0
if ! cmp -s "$DEPLOY_SRC/shopdocs-backend.service" /etc/systemd/system/shopdocs-backend.service 2>/dev/null; then
  info "systemd unit changed — installing"
  install -m 644 "$DEPLOY_SRC/shopdocs-backend.service" /etc/systemd/system/
  SVC_CHANGED=1
else
  info "systemd unit unchanged — skipping reinstall."
fi
[[ "$SVC_CHANGED" -eq 1 ]] && systemctl daemon-reload

prepare_caddy_log
if ! cmp -s "$DEPLOY_SRC/Caddyfile" /etc/caddy/Caddyfile 2>/dev/null; then
  info "Caddy config changed — validating before activating"
  caddy validate --config "$DEPLOY_SRC/Caddyfile" --adapter caddyfile \
    || fail "New Caddy config failed validation — leaving the existing (working) config in place. See errors above."
  install -m 644 "$DEPLOY_SRC/Caddyfile" /etc/caddy/Caddyfile
  # 'reload' re-reads config without dropping listeners/connections; only
  # fall back to a full restart if Caddy isn't in a state reload can handle.
  systemctl reload caddy 2>/dev/null || systemctl restart caddy \
    || fail "caddy failed to activate the new config. Check: journalctl -u caddy -e"
else
  info "Caddy config unchanged — skipping reload (no downtime)."
fi

# ---------- Restart backend only if something it depends on actually changed ----------
if [[ "$BACKEND_CHANGED" -eq 1 || "$SVC_CHANGED" -eq 1 ]]; then
  info "Backend code, dependencies, or unit file changed — restarting shopdocs-backend"
  systemctl restart shopdocs-backend \
    || fail "shopdocs-backend failed to restart. Check: journalctl -u shopdocs-backend -e"
else
  info "Backend unchanged — leaving it running (starting it only if it isn't already)."
  systemctl start shopdocs-backend \
    || fail "shopdocs-backend failed to start. Check: journalctl -u shopdocs-backend -e"
fi

# no-op if already enabled/running — never touches data, only ensures the
# service is up (mongod itself is never stopped, dropped, or reinitialized
# anywhere in this script)
systemctl enable --now mongod >/dev/null

echo "==> Trusting Caddy's internal CA on this host"
caddy_trust

echo "==> Verifying ShopDocs is actually being served"
verify_services_active
verify_serving

echo
echo "==========================================="
echo " ShopDocs updated successfully."
echo " Backend logs:  journalctl -u shopdocs-backend -f"
echo "==========================================="
