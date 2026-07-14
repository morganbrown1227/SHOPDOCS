#!/usr/bin/env bash
# Shared helpers for deploy/install.sh and deploy/update.sh — sourced, not
# executed directly. Keeping this logic in one place means a fix (like the
# REACT_APP_BACKEND_URL build-time bug, or the post-deploy verification
# checks) can't silently drift out of sync between the two entry points the
# way it did before this file existed.
#
# Not sourced by deploy/offline_bundle.sh: that script runs on a separate
# internet-connected *builder* machine, not the target VM, and only needs the
# one-line frontend/.env fix (duplicated there intentionally — pulling in the
# rest of this file's target-VM assumptions would be more confusing than the
# duplication it'd save).

# ---------- Shared constants ----------
APP=/opt/shopdocs
DATA=/opt/shopdocs/uploads
SVC_USER=shopdocs
PY=python3.10

# ---------- Output helpers ----------
if [[ -t 1 ]]; then
  C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'; C_RED=$'\033[0;31m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

info() { echo "==> $*"; }
ok()   { echo "    ${C_GREEN}OK${C_RESET} $*"; }
warn() { echo "${C_YELLOW}WARNING:${C_RESET} $*" >&2; }
fail() { echo "${C_RED}ERROR:${C_RESET} $*" >&2; exit 1; }

# ---------- Safety checks ----------
require_root() {
  [[ $EUID -eq 0 ]] || fail "run this as root (sudo bash $0)."
}

check_ubuntu_2204() {
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" ]]; then
      warn "this script targets Ubuntu 22.04 (found ${PRETTY_NAME:-unknown}). Continuing anyway."
    fi
  fi
}

existing_install_present() {
  [[ -f "$APP/backend/.env" && -f /etc/systemd/system/shopdocs-backend.service ]]
}

# ---------- Frontend ----------
# REACT_APP_BACKEND_URL is a Create React App *build-time* env var — it gets
# baked into the JS bundle by `yarn build`. Left unset, api.js ends up with
# the literal string "undefined/api" as its base URL: a relative path that
# never resolves to Caddy's /api/* proxy rule, so every request (login,
# auth/me, everything) silently misroutes to the SPA's static-file fallback.
# Empty string = same-origin ("/api"), correct for this single-host reverse
# proxy setup where Caddy serves the frontend and proxies /api/* itself.
write_frontend_env() {
  local repo_root="$1"
  echo 'REACT_APP_BACKEND_URL=' > "$repo_root/frontend/.env"
}

build_frontend() {
  local repo_root="$1"
  write_frontend_env "$repo_root"
  ( cd "$repo_root/frontend" && yarn install --frozen-lockfile && yarn build ) \
    || fail "frontend build failed — see yarn output above."
}

# $APP itself is only ever created via 'mkdir -p', so its mode comes from
# whatever umask was active (e.g. a hardened root umask of 077 leaves it
# drwx------, which blocks caddy — a different user, not in group shopdocs —
# from traversing into it at all, even though the files underneath are
# readable). rsync -a preserves source permissions for everything it copies
# but never rewrites the mode of a pre-existing destination directory like
# $APP itself, so this has to be set explicitly.
fix_app_permissions() {
  chown -R "$SVC_USER:$SVC_USER" "$APP"
  chmod 755 "$APP"
  find "$APP/frontend" -type d -exec chmod 755 {} +
  find "$APP/frontend" -type f -exec chmod 644 {} +
}

# ---------- Staging ----------
# Copies backend/ + frontend/ from a git checkout into a clean staging dir,
# stripping dev-only cruft (__pycache__, node_modules, .venv) and swapping in
# the runtime-only requirements-prod.txt. Identical work for a fresh install
# and an in-place update, so both scripts stage through this rather than
# rsyncing the repo checkout straight into $APP.
stage_app_src() {
  local repo_root="$1" stage_dir="$2"
  mkdir -p "$stage_dir/backend" "$stage_dir/frontend"
  rsync -a --exclude='__pycache__' --exclude='uploads' --exclude='.venv' \
        "$repo_root/backend/" "$stage_dir/backend/"
  # The shipped requirements.txt is the runtime-only subset (see
  # requirements-prod.txt); the full dev/test requirements.txt is not needed
  # on the server.
  cp "$repo_root/backend/requirements-prod.txt" "$stage_dir/backend/requirements.txt"
  rm -f "$stage_dir/backend/requirements-prod.txt"
  rsync -a --exclude='node_modules' "$repo_root/frontend/" "$stage_dir/frontend/"
}

# ---------- Backend env ----------
# Never touches an existing .env — only ever fills one in if it's genuinely
# missing (fresh install, or someone deleted it by hand).
ensure_backend_env() {
  if [[ ! -f "$APP/backend/.env" ]]; then
    info "Creating $APP/backend/.env"
    local secret
    secret=$($PY -c 'import secrets;print(secrets.token_hex(32))')
    cat > "$APP/backend/.env" <<EOF
MONGO_URL="mongodb://127.0.0.1:27017"
DB_NAME="shopdocs"
CORS_ORIGINS="*"
JWT_SECRET="$secret"
ADMIN_EMAIL="admin@local.app"
ADMIN_PASSWORD="Southwire123!@#"
UPLOAD_DIR="$DATA"
EOF
    chmod 600 "$APP/backend/.env"
    ok "Seeded default admin admin@local.app — change this password after first login."
  fi
}

# The caddy .deb's postinst starts caddy.service immediately on package
# install using its own stock Caddyfile (the "Caddy works!" placeholder), and
# only chowns /var/log/caddy to caddy:caddy the first time that directory is
# created. Neither of those covers our shopdocs.log path, so set it up
# explicitly and idempotently rather than relying on the package.
prepare_caddy_log() {
  id -u caddy >/dev/null 2>&1 || fail "caddy system user not found — the caddy package did not install correctly."
  mkdir -p /var/log/caddy
  touch /var/log/caddy/shopdocs.log
  chown -R caddy:caddy /var/log/caddy
  chmod 750 /var/log/caddy
  chmod 644 /var/log/caddy/shopdocs.log
}

# Installs Caddy's internal-CA root certificate into this host's OS-wide
# trust store, so HTTPS requests made FROM this machine (verify_serving
# below, and this host's own browser if it's ever used to view ShopDocs)
# don't hit certificate warnings. Idempotent — safe to call on every
# install/update. This does nothing for other devices (iPads, phones, other
# desktops on the LAN): each of those needs the same root CA installed
# separately once — see "Trusting the certificate on client devices" in
# deploy/README.md for how to export and install it.
caddy_trust() {
  caddy trust --config /etc/caddy/Caddyfile \
    || warn "caddy trust failed — this host's own HTTPS requests to https://127.0.0.1 may show certificate warnings. Other devices are unaffected either way (they need their own CA install regardless)."
}

# ---------- Verification ----------
verify_services_active() {
  systemctl is-active --quiet mongod && ok "mongod is running." \
    || fail "mongod is not running. Check: journalctl -u mongod -e"
  systemctl is-active --quiet shopdocs-backend && ok "shopdocs-backend is running." \
    || fail "shopdocs-backend is not running. Check: journalctl -u shopdocs-backend -e"
  systemctl is-active --quiet caddy && ok "caddy is running." \
    || fail "caddy is not running. Check: journalctl -u caddy -e"
}

# Confirms Caddy is actually serving the ShopDocs frontend build (not its
# stock placeholder page) and correctly proxying /api/* to the backend.
# Shared so install.sh and update.sh fail loudly and identically if
# something didn't come back up correctly.
verify_serving() {
  # Uses $PY instead of curl, since curl isn't guaranteed present on a
  # minimized Ubuntu Server install (offline path) and this check should
  # behave identically everywhere.
  local rc=0
  $PY - <<'PYEOF' || rc=$?
import ssl, sys, time, urllib.request, urllib.error

def get(path, timeout=3):
    try:
        with urllib.request.urlopen(f"https://127.0.0.1{path}", timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except ssl.SSLCertVerificationError:
        raise
    except Exception:
        return None, ""

status, body = None, ""
try:
    for _ in range(10):
        status, body = get("/")
        if status is not None:
            break
        time.sleep(1)
except ssl.SSLCertVerificationError:
    print("UNTRUSTED_CERT", file=sys.stderr); sys.exit(6)

if status is None:
    print("UNREACHABLE", file=sys.stderr); sys.exit(1)
if status == 403:
    print("FORBIDDEN", file=sys.stderr); sys.exit(4)
if status != 200:
    print(f"BAD_ROOT_STATUS {status}", file=sys.stderr); sys.exit(5)
if "caddy works" in body.lower():
    print("DEFAULT_PAGE", file=sys.stderr); sys.exit(2)

status = None
try:
    for _ in range(10):
        status, _ = get("/api/auth/me")
        if status == 401:
            break
        time.sleep(1)
except ssl.SSLCertVerificationError:
    print("UNTRUSTED_CERT", file=sys.stderr); sys.exit(6)

if status != 401:
    print(f"BAD_API_STATUS {status}", file=sys.stderr); sys.exit(3)
PYEOF

  case "$rc" in
    0) ok "Caddy is serving the ShopDocs frontend and proxying /api/* to the backend." ;;
    1) fail "Caddy did not respond on https://127.0.0.1/ within 10s. Check: journalctl -u caddy -e" ;;
    2) fail "Caddy is still serving its default placeholder page instead of /etc/caddy/Caddyfile. Check: journalctl -u caddy -e" ;;
    3) fail "Expected /api/* to be proxied to the ShopDocs backend (got a non-401 status from https://127.0.0.1/api/auth/me). Check: journalctl -u caddy -e and journalctl -u shopdocs-backend -e" ;;
    4) fail "Frontend directory permissions prevent Caddy access. Check: namei -l $APP/frontend/build/index.html — every parent directory (including $APP itself) must be traversable (o+x) by the caddy user." ;;
    5) fail "Caddy responded with an unexpected HTTP status at https://127.0.0.1/ (expected 200). Check: journalctl -u caddy -e" ;;
    6) fail "Caddy's certificate isn't trusted by this host yet — 'caddy trust' should have handled this. Try running it manually: caddy trust --config /etc/caddy/Caddyfile" ;;
    *) fail "Post-deploy verification failed unexpectedly (exit $rc)." ;;
  esac
}
