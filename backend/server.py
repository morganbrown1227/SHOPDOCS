from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import uuid
import logging
import mimetypes
import bcrypt
import jwt
import qrcode
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Annotated
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse, FileResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict, BeforeValidator
from bson import ObjectId

# ---------- Configuration ----------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
ACCESS_TTL_MIN = 60 * 12  # 12 hours; suitable for shift-based shop-floor use
REFRESH_TTL_DAYS = 7
UPLOAD_DIR = Path(os.environ.get('UPLOAD_DIR', ROOT_DIR / 'uploads'))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Air-Gapped Document Management")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Helpers ----------
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TTL_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                        max_age=ACCESS_TTL_MIN * 60, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax",
                        max_age=REFRESH_TTL_DAYS * 86400, path="/")


def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user["_id"])
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_roles(*roles: str):
    async def _dep(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return _dep


async def log_audit(user: dict, action: str, target_type: str, target_id: str, meta: Optional[dict] = None):
    await db.audit_logs.insert_one({
        "user_id": user["id"],
        "user_email": user["email"],
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "meta": meta or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# ---------- Models ----------
class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: str
    created_at: Optional[str] = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "viewer"  # admin | editor | viewer


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class EquipmentIn(BaseModel):
    name: str
    equipment_id: str  # human-readable asset tag, e.g. "PRESS-12"
    qr_code: Optional[str] = None  # if omitted, defaults to equipment_id
    line: Optional[str] = None
    location: Optional[str] = None
    model: Optional[str] = None
    revision: Optional[str] = None
    notes: Optional[str] = None


class EquipmentOut(EquipmentIn):
    id: str
    created_at: str
    updated_at: str


class DocumentOut(BaseModel):
    id: str
    equipment_id: str
    title: str
    category: str  # drawing | manual | other
    revision: Optional[str] = None
    filename: str
    content_type: str
    size: int
    uploaded_by: str
    uploaded_at: str
    version: int = 1
    parent_id: Optional[str] = None
    is_latest: bool = True


# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.equipment.create_index("equipment_id", unique=True)
    await db.equipment.create_index("qr_code", unique=True)
    await db.documents.create_index("equipment_id")
    await db.audit_logs.create_index([("timestamp", -1)])

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@local.app")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin user {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email},
                                  {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Updated admin password from .env")


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ---------- Health ----------
@api.get("/")
async def root():
    return {"status": "ok", "service": "doc-mgmt"}


# ---------- Auth ----------
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    uid = str(user["_id"])
    access = create_access_token(uid, email, user["role"])
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    return {"id": uid, "email": user["email"], "name": user["name"], "role": user["role"]}


@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    clear_auth_cookies(response)
    return {"ok": True}


@api.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return UserOut(**user)


@api.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(str(user["_id"]), user["email"], user["role"])
        response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                            max_age=ACCESS_TTL_MIN * 60, path="/")
        return {"ok": True}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------- Users (admin only) ----------
@api.get("/users", response_model=List[UserOut])
async def list_users(_: dict = Depends(require_roles("admin"))):
    out = []
    async for u in db.users.find().sort("created_at", -1):
        out.append(UserOut(id=str(u["_id"]), email=u["email"], name=u["name"],
                           role=u["role"], created_at=u.get("created_at")))
    return out


@api.post("/users", response_model=UserOut)
async def create_user(payload: UserCreate, actor: dict = Depends(require_roles("admin"))):
    if payload.role not in {"admin", "editor", "viewer"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "created_at": now,
    }
    res = await db.users.insert_one(doc)
    await log_audit(actor, "user.create", "user", str(res.inserted_id), {"email": email, "role": payload.role})
    return UserOut(id=str(res.inserted_id), email=email, name=payload.name, role=payload.role, created_at=now)


@api.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, payload: UserUpdate, actor: dict = Depends(require_roles("admin"))):
    upd = {}
    if payload.name is not None:
        upd["name"] = payload.name
    if payload.role is not None:
        if payload.role not in {"admin", "editor", "viewer"}:
            raise HTTPException(status_code=400, detail="Invalid role")
        upd["role"] = payload.role
    if payload.password:
        upd["password_hash"] = hash_password(payload.password)
    if not upd:
        raise HTTPException(status_code=400, detail="No changes")
    res = await db.users.find_one_and_update({"_id": ObjectId(user_id)}, {"$set": upd},
                                              return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="User not found")
    await log_audit(actor, "user.update", "user", user_id, {"changed": list(upd.keys())})
    return UserOut(id=str(res["_id"]), email=res["email"], name=res["name"],
                   role=res["role"], created_at=res.get("created_at"))


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, actor: dict = Depends(require_roles("admin"))):
    if user_id == actor["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    res = await db.users.delete_one({"_id": ObjectId(user_id)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await log_audit(actor, "user.delete", "user", user_id, {})
    return {"ok": True}


# ---------- Equipment ----------
def equipment_doc_to_out(d: dict) -> EquipmentOut:
    return EquipmentOut(
        id=str(d["_id"]),
        name=d["name"],
        equipment_id=d["equipment_id"],
        qr_code=d.get("qr_code") or d["equipment_id"],
        line=d.get("line"),
        location=d.get("location"),
        model=d.get("model"),
        revision=d.get("revision"),
        notes=d.get("notes"),
        created_at=d["created_at"],
        updated_at=d["updated_at"],
    )


@api.get("/equipment", response_model=List[EquipmentOut])
async def list_equipment(q: Optional[str] = None, line: Optional[str] = None,
                          location: Optional[str] = None,
                          _: dict = Depends(get_current_user)):
    query: dict = {}
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"name": rx}, {"equipment_id": rx}, {"model": rx},
                        {"line": rx}, {"location": rx}, {"qr_code": rx}]
    if line:
        query["line"] = line
    if location:
        query["location"] = location
    out = []
    async for d in db.equipment.find(query).sort("name", 1):
        out.append(equipment_doc_to_out(d))
    return out


@api.get("/equipment-facets")
async def equipment_facets(_: dict = Depends(get_current_user)):
    lines = await db.equipment.distinct("line")
    locations = await db.equipment.distinct("location")
    return {
        "lines": sorted([x for x in lines if x]),
        "locations": sorted([x for x in locations if x]),
    }


@api.post("/equipment/import")
async def import_equipment(file: UploadFile = File(...),
                            actor: dict = Depends(require_roles("admin", "editor"))):
    import csv as _csv
    contents = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = _csv.DictReader(io.StringIO(contents))
    expected = {"equipment_id", "name"}
    if not expected.issubset(set([h.strip() for h in (reader.fieldnames or [])])):
        raise HTTPException(status_code=400,
                             detail="CSV must include 'equipment_id' and 'name' headers")
    now = datetime.now(timezone.utc).isoformat()
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):  # row 1 is header
        eq_id = (row.get("equipment_id") or "").strip()
        name = (row.get("name") or "").strip()
        if not eq_id or not name:
            errors.append({"row": i, "error": "Missing equipment_id or name"})
            continue
        if await db.equipment.find_one({"equipment_id": eq_id}):
            skipped += 1
            continue
        qr = (row.get("qr_code") or eq_id).strip()
        if await db.equipment.find_one({"qr_code": qr}):
            errors.append({"row": i, "error": f"QR code '{qr}' already exists"})
            continue
        doc = {
            "equipment_id": eq_id,
            "name": name,
            "qr_code": qr,
            "line": (row.get("line") or "").strip() or None,
            "location": (row.get("location") or "").strip() or None,
            "model": (row.get("model") or "").strip() or None,
            "revision": (row.get("revision") or "").strip() or None,
            "notes": (row.get("notes") or "").strip() or None,
            "created_at": now,
            "updated_at": now,
        }
        await db.equipment.insert_one(doc)
        created += 1
    await log_audit(actor, "equipment.import", "equipment", "bulk",
                    {"created": created, "skipped": skipped, "errors": len(errors)})
    return {"created": created, "skipped": skipped, "errors": errors}


@api.post("/equipment", response_model=EquipmentOut)
async def create_equipment(payload: EquipmentIn, actor: dict = Depends(require_roles("admin", "editor"))):
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc["qr_code"] = (doc.get("qr_code") or doc["equipment_id"]).strip()
    doc["equipment_id"] = doc["equipment_id"].strip()
    if await db.equipment.find_one({"equipment_id": doc["equipment_id"]}):
        raise HTTPException(status_code=409, detail="Equipment ID already exists")
    if await db.equipment.find_one({"qr_code": doc["qr_code"]}):
        raise HTTPException(status_code=409, detail="QR code already exists")
    doc["created_at"] = now
    doc["updated_at"] = now
    res = await db.equipment.insert_one(doc)
    doc["_id"] = res.inserted_id
    await log_audit(actor, "equipment.create", "equipment", str(res.inserted_id),
                    {"equipment_id": doc["equipment_id"]})
    return equipment_doc_to_out(doc)


@api.get("/equipment/{eq_id}", response_model=EquipmentOut)
async def get_equipment(eq_id: str, _: dict = Depends(get_current_user)):
    d = await db.equipment.find_one({"_id": ObjectId(eq_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Equipment not found")
    return equipment_doc_to_out(d)


@api.patch("/equipment/{eq_id}", response_model=EquipmentOut)
async def update_equipment(eq_id: str, payload: EquipmentIn,
                            actor: dict = Depends(require_roles("admin", "editor"))):
    upd = payload.model_dump()
    upd["qr_code"] = (upd.get("qr_code") or upd["equipment_id"]).strip()
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.equipment.find_one_and_update({"_id": ObjectId(eq_id)}, {"$set": upd},
                                                  return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Equipment not found")
    await log_audit(actor, "equipment.update", "equipment", eq_id, {"equipment_id": upd["equipment_id"]})
    return equipment_doc_to_out(res)


@api.delete("/equipment/{eq_id}")
async def delete_equipment(eq_id: str, actor: dict = Depends(require_roles("admin", "editor"))):
    res = await db.equipment.delete_one({"_id": ObjectId(eq_id)})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Equipment not found")
    # Delete documents and files
    async for doc in db.documents.find({"equipment_id": eq_id}):
        try:
            Path(doc["file_path"]).unlink(missing_ok=True)
        except Exception:
            pass
    await db.documents.delete_many({"equipment_id": eq_id})
    await log_audit(actor, "equipment.delete", "equipment", eq_id, {})
    return {"ok": True}


@api.get("/equipment/by-qr/{qr_code}", response_model=EquipmentOut)
async def get_by_qr(qr_code: str, _: dict = Depends(get_current_user)):
    d = await db.equipment.find_one({"qr_code": qr_code})
    if not d:
        # also try by equipment_id as a fallback
        d = await db.equipment.find_one({"equipment_id": qr_code})
    if not d:
        raise HTTPException(status_code=404, detail="No equipment matches this code")
    return equipment_doc_to_out(d)


@api.get("/equipment/{eq_id}/qr.png")
async def equipment_qr_png(eq_id: str, _: dict = Depends(get_current_user)):
    d = await db.equipment.find_one({"_id": ObjectId(eq_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Equipment not found")
    code_value = d.get("qr_code") or d["equipment_id"]
    img = qrcode.make(code_value, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png",
                              headers={"Content-Disposition": f'inline; filename="qr-{code_value}.png"'})


# ---------- Documents ----------
def doc_to_out(d: dict) -> DocumentOut:
    return DocumentOut(
        id=str(d["_id"]),
        equipment_id=d["equipment_id"],
        title=d["title"],
        category=d["category"],
        revision=d.get("revision"),
        filename=d["filename"],
        content_type=d["content_type"],
        size=d["size"],
        uploaded_by=d["uploaded_by"],
        uploaded_at=d["uploaded_at"],
        version=d.get("version", 1),
        parent_id=d.get("parent_id"),
        is_latest=d.get("is_latest", True),
    )


@api.get("/equipment/{eq_id}/documents", response_model=List[DocumentOut])
async def list_equipment_docs(eq_id: str, include_history: int = 0,
                               _: dict = Depends(get_current_user)):
    query: dict = {"equipment_id": eq_id}
    if not include_history:
        query["is_latest"] = True
    out = []
    async for d in db.documents.find(query).sort("uploaded_at", -1):
        out.append(doc_to_out(d))
    return out


@api.get("/documents/{doc_id}/versions", response_model=List[DocumentOut])
async def list_doc_versions(doc_id: str, _: dict = Depends(get_current_user)):
    base = await db.documents.find_one({"_id": ObjectId(doc_id)})
    if not base:
        raise HTTPException(status_code=404, detail="Document not found")
    root = base.get("parent_id") or str(base["_id"])
    out = []
    async for d in db.documents.find(
        {"$or": [{"_id": ObjectId(root)}, {"parent_id": root}]}
    ).sort("version", -1):
        out.append(doc_to_out(d))
    return out


@api.post("/equipment/{eq_id}/documents", response_model=DocumentOut)
async def upload_document(
    eq_id: str,
    title: str = Form(...),
    category: str = Form("manual"),
    revision: Optional[str] = Form(None),
    replaces_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    actor: dict = Depends(require_roles("admin", "editor")),
):
    eq = await db.equipment.find_one({"_id": ObjectId(eq_id)})
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    if category not in {"drawing", "manual", "other"}:
        raise HTTPException(status_code=400, detail="Invalid category")

    parent_root: Optional[str] = None
    version = 1
    if replaces_id:
        prev = await db.documents.find_one({"_id": ObjectId(replaces_id)})
        if not prev:
            raise HTTPException(status_code=404, detail="Replaced document not found")
        parent_root = prev.get("parent_id") or str(prev["_id"])
        # find max version in this chain
        max_doc = await db.documents.find_one(
            {"$or": [{"_id": ObjectId(parent_root)}, {"parent_id": parent_root}]},
            sort=[("version", -1)],
        )
        version = (max_doc.get("version", 1) if max_doc else 1) + 1
        # mark prior versions as not latest
        await db.documents.update_many(
            {"$or": [{"_id": ObjectId(parent_root)}, {"parent_id": parent_root}]},
            {"$set": {"is_latest": False}},
        )

    eq_dir = UPLOAD_DIR / eq_id
    eq_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}_{Path(file.filename).name}"
    file_path = eq_dir / safe_name
    contents = await file.read()
    file_path.write_bytes(contents)
    ctype = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "equipment_id": eq_id,
        "title": title,
        "category": category,
        "revision": revision,
        "filename": file.filename,
        "stored_name": safe_name,
        "file_path": str(file_path),
        "content_type": ctype,
        "size": len(contents),
        "uploaded_by": actor["email"],
        "uploaded_at": now,
        "version": version,
        "parent_id": parent_root,
        "is_latest": True,
    }
    res = await db.documents.insert_one(doc)
    doc["_id"] = res.inserted_id
    await log_audit(actor, "document.upload", "document", str(res.inserted_id),
                    {"equipment_id": eq_id, "title": title, "category": category,
                     "version": version, "replaces": replaces_id})
    return doc_to_out(doc)


@api.get("/documents/{doc_id}/file")
async def get_document_file(doc_id: str, download: int = 0, user: dict = Depends(get_current_user)):
    d = await db.documents.find_one({"_id": ObjectId(doc_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    p = Path(d["file_path"])
    if not p.exists():
        raise HTTPException(status_code=404, detail="File missing on server")
    await log_audit(user, "document.view" if not download else "document.download",
                    "document", doc_id, {"filename": d["filename"]})
    disposition = "attachment" if download else "inline"
    return FileResponse(str(p), media_type=d["content_type"],
                         headers={"Content-Disposition": f'{disposition}; filename="{d["filename"]}"'})


@api.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, actor: dict = Depends(require_roles("admin", "editor"))):
    d = await db.documents.find_one({"_id": ObjectId(doc_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        Path(d["file_path"]).unlink(missing_ok=True)
    except Exception:
        pass
    await db.documents.delete_one({"_id": ObjectId(doc_id)})
    # If this was the latest in a chain, promote the next highest version to latest
    if d.get("is_latest"):
        root = d.get("parent_id") or doc_id
        next_doc = await db.documents.find_one(
            {"$or": [{"_id": ObjectId(root)}, {"parent_id": root}]},
            sort=[("version", -1)],
        )
        if next_doc:
            await db.documents.update_one({"_id": next_doc["_id"]}, {"$set": {"is_latest": True}})
    await log_audit(actor, "document.delete", "document", doc_id, {"title": d["title"]})
    return {"ok": True}


# ---------- Audit Logs (admin only) ----------
@api.get("/audit-logs")
async def list_audit(limit: int = Query(200, ge=1, le=1000),
                      _: dict = Depends(require_roles("admin"))):
    out = []
    async for d in db.audit_logs.find().sort("timestamp", -1).limit(limit):
        out.append({
            "id": str(d["_id"]),
            "user_id": d.get("user_id"),
            "user_email": d.get("user_email"),
            "action": d.get("action"),
            "target_type": d.get("target_type"),
            "target_id": d.get("target_id"),
            "meta": d.get("meta", {}),
            "timestamp": d.get("timestamp"),
        })
    return out


# ---------- Mount ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
