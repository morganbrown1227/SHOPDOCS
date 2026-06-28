#!/usr/bin/env bash
# Build an offline install tarball for an air-gapped server.
# Run on an internet-connected Linux box.
set -euo pipefail

STAMP=$(date +%Y%m%d)
OUT="shopdocs-offline-${STAMP}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT
DEST="$WORK/$OUT"
mkdir -p "$DEST"/{app,vendor/wheels,vendor/debs,deploy}

echo "==> Copying app source"
rsync -a --exclude='node_modules' --exclude='__pycache__' --exclude='uploads' \
      --exclude='.git' --exclude='build' \
      "$ROOT/backend" "$ROOT/frontend" "$DEST/app/"

echo "==> Building frontend production bundle"
( cd "$ROOT/frontend" && yarn install --frozen-lockfile && yarn build )
rsync -a "$ROOT/frontend/build" "$DEST/app/frontend/"

echo "==> Downloading Python wheels"
pip download -d "$DEST/vendor/wheels" -r "$ROOT/backend/requirements.txt"

echo "==> Downloading system .deb packages (mongo, caddy, python3.11)"
# Add MongoDB + Caddy apt repos on a sacrificial container or use pre-downloaded URLs.
# For brevity here we expect the operator to drop the .deb files manually if their
# distro's mirrors are unreachable; the install.sh will apt-install whatever it finds.
apt-get install -y --download-only --reinstall -o Dir::Cache::archives="$DEST/vendor/debs" \
    mongodb-org caddy python3.11 python3.11-venv ca-certificates || \
    echo "  (note) some packages unavailable on this builder — populate vendor/debs manually."

cp "$ROOT/deploy/install.sh"          "$DEST/install.sh"
cp "$ROOT/deploy/README.md"           "$DEST/README.md"
cp "$ROOT/deploy/shopdocs-backend.service" "$DEST/deploy/"
cp "$ROOT/deploy/Caddyfile"           "$DEST/deploy/"
cp "$ROOT/deploy/env.example"         "$DEST/deploy/"

echo "==> Creating tarball"
( cd "$WORK" && tar czf "$ROOT/${OUT}.tar.gz" "$OUT" )
echo "Done: ${ROOT}/${OUT}.tar.gz"
