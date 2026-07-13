#!/usr/bin/env bash
# Build a self-contained offline install tarball for an air-gapped Ubuntu
# 22.04 server. Run on any Linux/macOS box with internet access.
#
# Requires: docker, rsync, yarn, python3/pip, curl, gpg.
#
# Docker is required (not optional) because MongoDB and Caddy's .deb
# packages, plus their full transitive dependency chains, are resolved
# inside a *pristine* `ubuntu:22.04` container. Resolving them against the
# builder's own apt cache is unreliable: any package already installed on
# the builder is silently treated as "satisfied" and skipped, so the bundle
# ends up missing dependencies that a genuinely clean target VM needs. A
# throwaway container matching the target OS exactly closes that gap.
set -euo pipefail

PY_MAJOR_MINOR="3.10"     # Ubuntu 22.04's default python3 — must match the
                           # cp310 wheel tag below and deploy/install.sh
TARGET_IMAGE="ubuntu:22.04"
DEB_PKGS="ca-certificates gnupg mongodb-org caddy python3.10 python3.10-venv python3-pip"

STAMP=$(date +%Y%m%d)
OUT="shopdocs-offline-${STAMP}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
DEST="$WORK/$OUT"
mkdir -p "$DEST"/{app,vendor/wheels,vendor/debs,deploy}

fail() { echo "ERROR: $*" >&2; exit 1; }

for bin in docker rsync yarn pip curl gpg; do
  command -v "$bin" >/dev/null 2>&1 || fail "'$bin' is required on the build machine but was not found."
done

echo "==> Copying app source"
rsync -a --exclude='node_modules' --exclude='__pycache__' --exclude='uploads' \
      --exclude='.git' --exclude='build' \
      "$ROOT/backend" "$ROOT/frontend" "$DEST/app/"
# The shipped requirements.txt is the runtime-only subset (see requirements-prod.txt);
# the full dev/test requirements.txt is not needed on the server and is not bundled.
cp "$ROOT/backend/requirements-prod.txt" "$DEST/app/backend/requirements.txt"
rm -f "$DEST/app/backend/requirements-prod.txt"

echo "==> Building frontend production bundle"
( cd "$ROOT/frontend" && yarn install --frozen-lockfile && yarn build )
rm -rf "$DEST/app/frontend/build" "$DEST/app/frontend/node_modules"
rsync -a "$ROOT/frontend/build" "$DEST/app/frontend/"

echo "==> Downloading Python ${PY_MAJOR_MINOR} (cp310) wheels for the production dependency set"
pip download -d "$DEST/vendor/wheels" \
    --python-version "${PY_MAJOR_MINOR}" --implementation cp --abi cp310 \
    --platform manylinux2014_x86_64 --platform manylinux_2_17_x86_64 \
    --only-binary=:all: \
    -r "$ROOT/backend/requirements-prod.txt" \
  || fail "pip download failed to fetch a cp310 manylinux wheel for every dependency. Fix requirements-prod.txt (pin an available version) — do not let this build silently continue with a partial wheel set."

echo "==> Fetching MongoDB 7.0 + Caddy apt signing keys and repo definitions"
APT_EXTRA="$WORK/apt-extra"
mkdir -p "$APT_EXTRA"
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o "$APT_EXTRA/mongodb-server-7.0.gpg" \
  || fail "could not fetch/dearmor the MongoDB 7.0 apt signing key."
cat > "$APT_EXTRA/mongodb-org-7.0.list" <<'EOF'
deb [ arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse
EOF
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o "$APT_EXTRA/caddy-stable-archive-keyring.gpg" \
  || fail "could not fetch/dearmor the Caddy stable apt signing key."
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o "$APT_EXTRA/caddy-stable.list" \
  || fail "could not fetch the Caddy apt repo definition."

echo "==> Resolving mongodb-org + caddy + python${PY_MAJOR_MINOR} and their full dependency closure in a clean Ubuntu 22.04 container"
docker run --rm \
  -v "$APT_EXTRA:/apt-extra:ro" \
  -v "$DEST/vendor/debs:/out" \
  -e DEBIAN_FRONTEND=noninteractive \
  "$TARGET_IMAGE" bash -euo pipefail -c "
    cp /apt-extra/*.gpg /usr/share/keyrings/
    cp /apt-extra/*.list /etc/apt/sources.list.d/
    apt-get update
    # Full recursive dependency closure as package names, then download every
    # one of them with --reinstall so packages already satisfied inside this
    # throwaway container (e.g. base-image extras) are still captured — a
    # genuinely clean target VM won't have them pre-installed.
    ALL_PKGS=\$(apt-cache depends --recurse \
        --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances \
        $DEB_PKGS 2>/dev/null | grep -E '^[a-zA-Z0-9]' | sort -u)
    apt-get install -y --download-only --reinstall -o Dir::Cache::archives=/out \$ALL_PKGS
    rm -rf /out/partial /out/lock
  " || fail "docker-based .deb resolution failed — MongoDB/Caddy/Python packages were not fully bundled. Refusing to produce a partial offline installer."

echo "==> Verifying required .deb packages were actually bundled"
for want in mongodb-org-server_ caddy_ python3.10_ python3.10-venv_ python3-pip_; do
  ls "$DEST/vendor/debs/${want}"* >/dev/null 2>&1 \
    || fail "expected a '${want}*.deb' in vendor/debs but none was found — the offline bundle would not be self-contained."
done

cp "$ROOT/deploy/install.sh"                "$DEST/install.sh"
cp "$ROOT/deploy/README.md"                 "$DEST/README.md"
cp "$ROOT/deploy/shopdocs-backend.service"  "$DEST/deploy/"
cp "$ROOT/deploy/Caddyfile"                 "$DEST/deploy/"
cp "$ROOT/deploy/env.example"               "$DEST/deploy/"
chmod +x "$DEST/install.sh"

echo "==> Creating tarball"
( cd "$WORK" && tar czf "$ROOT/${OUT}.tar.gz" "$OUT" )
echo "Done: ${ROOT}/${OUT}.tar.gz"
