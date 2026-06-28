# ShopDocs — Air-Gapped Document Management

## Original Problem Statement
A web-based internal document management app for a small manufacturing team. Engineers scan a QR code on a phone/tablet, open the matching equipment page, and access locally hosted drawings and manuals on a local network server. Air-gapped: no internet dependency after install.

## Tech Stack
- Frontend: React + Tailwind + Shadcn UI + html5-qrcode
- Backend: FastAPI + Motor (MongoDB)
- Auth: JWT in httpOnly cookies, bcrypt-hashed passwords
- File storage: Local filesystem (`/app/backend/uploads/<equipment_id>/...`)

## User Personas
- **Admin** – manages users, equipment, documents, audit log.
- **Editor / Document Manager** – manages equipment & uploads/replaces docs.
- **Viewer / Engineer** – browses, scans QR, views + downloads docs (read-only).

## Core Requirements (static)
1. Local auth with RBAC (admin / editor / viewer).
2. Equipment CRUD with asset tag, QR code, line, location, model, revision, notes.
3. QR workflow: phone scan or `/qr/:code` URL resolves to equipment detail.
4. Local document storage with category (drawing / manual / other) + revision.
5. In-browser PDF preview + download.
6. QR code generation (PNG) + printable view.
7. Basic audit log (create/update/delete/upload/view/download).
8. Mobile-first rugged industrial UI, large touch targets.

## What's Been Implemented (2026-02 — v1.1)
- **v1.1 (P1 backlog)** — 2026-02-Iter2
  - Bulk CSV import of equipment via `/api/equipment/import` + Admin UI dialog with template download.
  - Multi-equipment printable QR label sheet at `/admin/qr-sheet` (multi-select, layout cols, popup print view).
  - Document version history: optional `replaces_id` on upload chains revisions; main list shows only latest, History dialog and `/api/documents/{id}/versions` expose chain; deleting the latest promotes prior version.
  - Dashboard dedicated line + location filter dropdowns backed by `/api/equipment-facets`.
  - Tested by `testing_agent_v3` iteration_2 — 100% pass.
- **v1.0** (2026-02 — initial MVP)
- Backend `/api`: `auth/{login,logout,me,refresh}`, `users` (admin CRUD), `equipment` (CRUD + by-qr + qr.png), `equipment/{id}/documents`, `documents/{id}/{file,delete}`, `audit-logs`.
- Admin seed (`admin@local.app` / `admin123`) created on startup, password kept in sync with `.env`.
- Indexes: `users.email` unique, `equipment.equipment_id`/`qr_code` unique, `audit_logs.timestamp` desc.
- Frontend pages: Login, Dashboard (search + filter), Equipment Detail (tabs: Drawings/Manuals/Other, PDF preview, QR dialog, upload), QR Scan (camera + manual entry), `/qr/:code` resolver, Admin Equipment List + Form, Admin Users, Admin Audit Log.
- Mobile bottom nav + desktop sidebar layout, Chivo + IBM Plex Sans, Swiss high-contrast theme.
- Tested end-to-end by `testing_agent_v3` (iteration_1) — 100% pass, no failures.

## Backlog / Next Tasks
**P1 (shipped in v1.1)**
- ✅ Bulk CSV import of equipment.
- ✅ Multi-equipment printable QR label sheet (`/admin/qr-sheet`).
- ✅ Document version history (Replace + History).
- ✅ Line/location dropdown filters on dashboard.

**P2**
- Maintenance/service notes timeline per equipment.
- Audit log filters and CSV export.
- Offline browser caching (Service Worker) for frequently accessed records.
- Optional CAD/DWG viewer.

**P3**
- Dockerized offline deployment bundle + install script.
- 2FA for admin accounts.

## Deployment Notes (air-gapped)
- Source-code delivery: copy `/app` to target machine, install Python deps + Node deps via local mirrors.
- Required env: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `UPLOAD_DIR`.
- Frontend uses `REACT_APP_BACKEND_URL` — set to internal LAN address before `yarn build`.

## Credentials (dev)
See `/app/memory/test_credentials.md`.
