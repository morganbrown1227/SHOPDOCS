# ShopDocs — On-Prem / Air-Gapped Install Guide

Target layout: air-gapped plant network · single Linux server on the plant LAN · phones/tablets on plant Wi-Fi · all docs stored on the server's filesystem.

## Server requirements
- Linux (Ubuntu 22.04 LTS recommended; Debian 12 / RHEL 9 also fine)
- 2 vCPU, 4 GB RAM, 50+ GB disk (sized for your PDF library)
- Static LAN IP (e.g. `10.10.20.5`) reachable from the plant Wi-Fi VLAN
- Ports `80` (HTTPS optional via self-signed cert) and `27017` (Mongo, localhost-only)

## Software stack (all installed offline by the bundle)
- Python 3.11 · Node 20 · MongoDB 7 · Caddy (single-binary reverse proxy)

---

## STEP 1 — Build the offline bundle (on an internet-connected machine)
Run on any Linux/macOS box with internet:
```bash
cd /app/deploy
sudo bash offline_bundle.sh
```
Produces `shopdocs-offline-<date>.tar.gz` (~400 MB) containing:
- App source (backend + frontend pre-built `dist/`)
- Python wheels (`vendor/wheels/`)
- Node modules already installed (`frontend/node_modules`)
- MongoDB 7, Caddy, Python 3.11 `.deb`s (`vendor/debs/`)
- This README + `install.sh` + systemd units

Carry the tarball to the plant on a USB stick.

## STEP 2 — Install on the air-gapped server
```bash
tar xzf shopdocs-offline-<date>.tar.gz
cd shopdocs-offline-<date>
sudo bash install.sh
```
The installer will:
1. `apt install` the bundled `.deb`s from `vendor/debs/` (no internet).
2. Create system user `shopdocs`, copy app to `/opt/shopdocs/`.
3. Generate `/opt/shopdocs/backend/.env` with a fresh `JWT_SECRET` and prompt for `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. Install backend deps from `vendor/wheels/` into a venv (offline).
5. Enable services: `mongod`, `shopdocs-backend`, `caddy`.
6. Print the LAN URL you'll hand out (e.g. `http://10.10.20.5/`).

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
