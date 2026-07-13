# ShopDocs — On-Prem / Air-Gapped Install Guide

Target layout: air-gapped plant network · single Linux server on the plant LAN · phones/tablets on plant Wi-Fi · all docs stored on the server's filesystem.

## Server requirements
- **Ubuntu 22.04 LTS** — the offline bundle only ships `.deb`s and wheels resolved against this exact target. Other distros are not supported by the bundle as-is.
- 2 vCPU, 4 GB RAM, 50+ GB disk (sized for your PDF library)
- Static LAN IP (e.g. `10.10.20.5`) reachable from the plant Wi-Fi VLAN
- Ports `80` (HTTPS optional via self-signed cert) and `27017` (Mongo, localhost-only)

## Software stack (all installed offline by the bundle)
- Python 3.10 (Ubuntu 22.04's default `python3`) · Node 20 (build-time only, not shipped to the server) · MongoDB 7.0 · Caddy (single-binary reverse proxy)

## Build machine requirements
`offline_bundle.sh` needs **Docker** in addition to the usual toolchain (`rsync`, `yarn`, `pip`, `curl`, `gpg`). Docker is used to resolve MongoDB/Caddy/Python `.deb`s — and their *full* transitive dependency chain — inside a throwaway `ubuntu:22.04` container, so the result matches exactly what a clean target VM needs (the builder's own apt cache can't be trusted for this: anything already installed on the builder gets silently skipped). The build machine itself can be any Linux/macOS box; it does not need to be Ubuntu.

---

## Online install (server has internet access)

If the target server can reach the internet, skip the offline bundle entirely:
```bash
git clone <repo-url> shopdocs
cd shopdocs
sudo bash deploy/install.sh
```
`install.sh` auto-detects this case (no `vendor/debs`/`vendor/wheels` next to it) and instead:
1. Adds the MongoDB 7.0, Caddy, and Node 20 apt repositories and installs from them directly.
2. Builds the frontend locally (`yarn install && yarn build`) — a git checkout never ships a pre-built `frontend/build/`.
3. Creates the `python3.10` venv and `pip install`s `backend/requirements-prod.txt` from PyPI.
4. Installs and enables `mongod`, `shopdocs-backend`, and `caddy`, same as the offline path from here on.

Use this for internet-connected deployments (staging, non-air-gapped sites); use the offline bundle (below) for the plant-floor, air-gapped case.

---

## STEP 1 — Build the offline bundle (on an internet-connected machine)
```bash
cd shopdocs/deploy
bash offline_bundle.sh
```
The script fails the build (non-zero exit) rather than continuing quietly if any Python wheel or `.deb`/dependency can't be resolved — a partial bundle is never produced.

Produces `shopdocs-offline-<date>.tar.gz` containing:
- App source (backend + pre-built frontend `build/`)
- Python wheels for the production-only dependency set (`vendor/wheels/`, `backend/requirements-prod.txt` — deliberately a small subset of the full `backend/requirements.txt` used for local dev; the server never needs pytest, mypy, cloud SDKs, etc.)
- MongoDB 7.0, Caddy, Python 3.10 `.deb`s **and every one of their dependencies** (`vendor/debs/`)
- This README + `install.sh` + systemd units

Carry the tarball to the plant on a USB stick.

## STEP 2 — Install on the air-gapped server
```bash
tar xzf shopdocs-offline-<date>.tar.gz
cd shopdocs-offline-<date>
sudo bash install.sh
```
The installer verifies it's on Ubuntu 22.04 and that `vendor/debs`/`vendor/wheels` are non-empty before touching the system, then:
1. Installs the bundled `.deb`s (mongodb-org, caddy, python3.10) by passing their local file paths directly to `apt-get install` — this resolves dependencies from the bundle alone and never touches the network. If a dependency is missing, it fails immediately instead of falling back to `apt-get -f install` (which would need internet).
2. Creates system user `shopdocs`, copies app to `/opt/shopdocs/`.
3. Generates `/opt/shopdocs/backend/.env` with a fresh `JWT_SECRET` and prompts for `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. Installs backend deps from `vendor/wheels/` into a `python3.10` venv (offline, `pip install --no-index`).
5. Enables services: `mongod`, `shopdocs-backend`, `caddy`.
6. Prints the LAN URL you'll hand out (e.g. `http://10.10.20.5/`).

## STEP 3 — Wire it up on the plant network
1. **Static IP** on the server (set in `/etc/netplan/...` or your distro's equivalent).
2. **DNS shortcut (optional)** — add `shopdocs.plant.local → 10.10.20.5` to your plant DNS. QR codes can then encode `http://shopdocs.plant.local/qr/PRESS-12` instead of an IP.
3. **Firewall** (`ufw allow 80/tcp`) — leave Mongo blocked (binds to 127.0.0.1).
4. **Plant Wi-Fi**: ensure the SSID engineers use can route to the server's subnet.
5. Sign in once as admin → create operator accounts (Editor/Viewer) → add device types → import equipment CSV → print QR labels via `/admin/qr-sheet`.

## Backups (recommended)
Run nightly on the server:
```bash
mongodump --db shopdocs --out /var/backups/shopdocs/$(date +%F)
rsync -a /opt/shopdocs/uploads/ /var/backups/shopdocs/uploads/
```
Copy `/var/backups/shopdocs/` to a USB drive weekly.

## Updating later
Build a fresh tarball on the internet box, copy to the server, then:
```bash
sudo bash install.sh --upgrade
```
This preserves `.env`, `/opt/shopdocs/uploads/`, and the Mongo database — only the app code is replaced. The backend's startup task auto-migrates schema changes.

## Resetting admin password
Edit `/opt/shopdocs/backend/.env`, change `ADMIN_PASSWORD`, then:
```bash
sudo systemctl restart shopdocs-backend
```
The seed routine syncs the admin hash on every startup.

## Service control cheatsheet
```bash
sudo systemctl status shopdocs-backend
sudo systemctl restart shopdocs-backend
sudo journalctl -u shopdocs-backend -f
```
