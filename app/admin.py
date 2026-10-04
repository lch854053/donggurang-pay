"""Review-only imports and transactional approvals on the existing SQLite database.

Public snapshots are a whitelist projection. Source workbooks never touch disk.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app import main as core

router = APIRouter()
PUBLIC_FIELDS = {"id", "name", "address", "category", "categories", "nameAliases", "locality", "lat", "lng", "geocode_method", "geocode_address", "approximate", "phone", "phones", "phoneSource"}
KINDS = {"closed": "폐업한 가게입니다", "unavailable": "동구랑페이 사용이 안 됩니다", "name": "상호명이 다릅니다", "address": "주소가 다릅니다", "phone": "전화번호가 다릅니다", "category": "업종이 다릅니다", "other": "기타"}


def now() -> str:
    return datetime.now(UTC).isoformat()


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def read_js_assignment(path: Path, variable: str):
    text = path.read_text(encoding="utf-8")
    match = re.search(r"window\." + re.escape(variable) + r"\s*=\s*", text)
    if not match:
        raise ValueError(f"공개 자료 형식 오류: {path.name}")
    return json.JSONDecoder().raw_decode(text[match.end():])[0]


def bundled_merchants() -> list[dict]:
    merchants = read_js_assignment(core.STATIC_DIR / "merchant-data.js", "DONGGURANG_MERCHANTS")
    phones = read_js_assignment(core.STATIC_DIR / "merchant-phones.js", "DONGGURANG_PHONES")
    reviewed = read_js_assignment(core.STATIC_DIR / "merchant-reviewed-phones.js", "DONGGURANG_REVIEWED_PHONES")
    result = []
    for merchant in merchants:
        item = dict(merchant) if "phones" in merchant else {**merchant, **phones.get(str(merchant["id"]), {}), **reviewed.get(str(merchant["id"]), {})}
        item.setdefault("phones", [item["phone"]] if item.get("phone") else [])
        result.append(public_projection(item))
    return result


def public_projection(item: dict) -> dict:
    return {key: value for key, value in item.items() if key in PUBLIC_FIELDS}


def initialize_admin_database() -> None:
    with core.db_connect() as db:
        columns = {r[1] for r in db.execute("PRAGMA table_info(merchants)")}
        for name, definition in (("active", "INTEGER NOT NULL DEFAULT 1"), ("revision", "INTEGER NOT NULL DEFAULT 0"), ("public_json", "TEXT")):
            if name not in columns:
                db.execute(f"ALTER TABLE merchants ADD COLUMN {name} {definition}")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS business_links (
            merchant_id INTEGER NOT NULL REFERENCES merchants(id), business_no TEXT NOT NULL,
            PRIMARY KEY(merchant_id,business_no));
        CREATE INDEX IF NOT EXISTS idx_business_links_number ON business_links(business_no);
        CREATE TABLE IF NOT EXISTS admin_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO admin_state VALUES(1,0);
        CREATE TABLE IF NOT EXISTS batches (id INTEGER PRIMARY KEY, filename TEXT NOT NULL, created_at TEXT NOT NULL,
            revision INTEGER NOT NULL, summary TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS candidates (id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id),
            merchant_id INTEGER REFERENCES merchants(id), business_no TEXT NOT NULL, kind TEXT NOT NULL,
            before_json TEXT, after_json TEXT, status TEXT NOT NULL, source_status TEXT NOT NULL DEFAULT '',
            decision TEXT NOT NULL DEFAULT 'pending', options_json TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS change_logs (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL,
            action TEXT NOT NULL, merchant_id INTEGER, before_json TEXT, after_json TEXT, reason TEXT NOT NULL,
            request_id INTEGER);
        CREATE TABLE IF NOT EXISTS correction_requests (id INTEGER PRIMARY KEY, merchant_id INTEGER NOT NULL,
            merchant_json TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '미처리', resolution TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
            PRIMARY KEY(key,bucket));
        CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at REAL NOT NULL, actor TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS publications (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, revision INTEGER NOT NULL,
            content TEXT NOT NULL, digest TEXT NOT NULL, pr_url TEXT, state TEXT NOT NULL DEFAULT 'generated', publish_started_at REAL);
        """)
        db.execute("INSERT OR IGNORE INTO business_links SELECT id,business_no FROM merchants WHERE business_no != ''")
        if "publish_started_at" not in {row[1] for row in db.execute("PRAGMA table_info(publications)")}:
            db.execute("ALTER TABLE publications ADD COLUMN publish_started_at REAL")
        if "options_json" not in {row[1] for row in db.execute("PRAGMA table_info(candidates)")}:
            db.execute("ALTER TABLE candidates ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]'")


def revision(db) -> int:
    return db.execute("SELECT revision FROM admin_state WHERE id=1").fetchone()[0]


def record_public(row) -> dict:
    if row["public_json"]:
        return public_projection(json.loads(row["public_json"]))
    return {**{key: row[key] for key in ("id", "name", "address", "category", "lat", "lng")}, "phones": []}


def has_valid_coordinates(item: dict | None) -> bool:
    if not item:
        return False
    lat, lng = item.get("lat"), item.get("lng")
    return isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and 35.08 <= lat <= 35.19 and 126.88 <= lng <= 127.01


def log(db, action, merchant_id, before, after, reason, request_id=None, actor="admin"):
    db.execute("INSERT INTO change_logs(created_at,actor,action,merchant_id,before_json,after_json,reason,request_id) VALUES(?,?,?,?,?,?,?,?)",
               (now(), actor, action, merchant_id, dumps(before) if before is not None else None, dumps(after) if after is not None else None, reason, request_id))


def bootstrap(rows: list[dict]) -> dict:
    """Connect original identities to published IDs; never modify the published map."""
    baseline = bundled_merchants()
    audit = json.loads((core.BASE_DIR / "reports/merchant-deduplication.json").read_text())
    aliases = {m["keptId"]: m["records"] for m in audit["merges"]}
    by_identity = defaultdict(set)
    for row in rows:
        by_identity[(row["가맹점명"], row["사업장주소"])].add(row["사업자번호"])
    links = {}
    missing = []
    for item in baseline:
        identities = [(v["name"], v["address"]) for v in [item, *aliases.get(item["id"], [])]]
        numbers = set().union(*(by_identity.get(identity, set()) for identity in identities))
        if not numbers:
            missing.append(item["id"])
        links[item["id"]] = sorted(numbers)
    if missing:
        raise ValueError(f"기존 가맹점 {len(missing)}개의 원본 연결이 없습니다. 원본 기준 명단을 확인하세요. 지도 ID: {missing[:20]}")
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT COUNT(*) FROM merchants").fetchone()[0]:
            raise ValueError("초기화는 빈 DB에서만 가능합니다. 기존 DB를 백업하고 확인하세요.")
        for item in baseline:
            numbers = links[item["id"]]
            db.execute("""INSERT INTO merchants(id,business_no,merchant_no,name,address,category,lat,lng,uploaded_at,public_json)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""", (item["id"], numbers[0], f"published-{item['id']}", item["name"], item["address"], item["category"], item["lat"], item["lng"], now(), dumps(item)))
            db.executemany("INSERT INTO business_links VALUES(?,?)", [(item["id"], number) for number in numbers])
        metadata = read_js_assignment(core.STATIC_DIR / "merchant-data.js", "DONGGURANG_DATA_META")
        db.execute("UPDATE admin_state SET revision=?", (max(revision(db), metadata.get("revision", 0)) + 1,))
        log(db, "초기 연결", None, None, {"count": len(baseline)}, "공개 지도 ID/좌표/전화번호 보존")
    return {"connected": len(baseline)}


def throttle(request: Request, scope: str, maximum: int, seconds: int):
    # Do not trust user-supplied Forwarded/X-Forwarded-For headers here.
    address = request.client.host if request.client else "unknown"
    secret = os.getenv("RATE_LIMIT_SECRET") or os.getenv("ADMIN_KEY")
    if not secret:
        raise HTTPException(503, "서버 인증정보가 설정되지 않았습니다.")
    key = hashlib.sha256(f"{secret}:{scope}:{address}".encode()).hexdigest()
    bucket = int(time.time() // seconds) * seconds
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM rate_limits WHERE bucket < ?", (int(time.time()) - 2 * 86400,))
        db.execute("INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1", (key, bucket))
        count = db.execute("SELECT count FROM rate_limits WHERE key=? AND bucket=?", (key, bucket)).fetchone()[0]
    if count > maximum:
        raise HTTPException(429, "요청이 너무 많습니다. 잠시 후 다시 시도하세요.", headers={"Retry-After": str(seconds)})


async def authenticated(request: Request) -> str:
    if request.headers.get("X-Admin-Key"):
        await core.require_admin(request.headers["X-Admin-Key"])
        return "admin"
    token = request.cookies.get("dgp_admin", "")
    with core.db_connect() as db:
        session = db.execute("SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?", (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    if not session:
        raise HTTPException(401, "관리자 로그인이 필요합니다.")
    if request.method not in {"GET", "HEAD"}:
        if request.headers.get("X-Requested-With") != "donggurang-admin":
            raise HTTPException(403, "잘못된 관리자 요청입니다.")
        origin = request.headers.get("origin")
        expected = os.getenv("ADMIN_ORIGIN") or str(request.base_url).rstrip("/")
        if origin and origin != expected:
            raise HTTPException(403, "관리자 요청 출처가 일치하지 않습니다.")
    return session["actor"]


class Login(BaseModel):
    key: str = Field(min_length=1, max_length=512)


@router.post("/api/admin/login")
async def login(body: Login, request: Request):
    throttle(request, "login", 10, 900)
    await core.require_admin(body.key)
    token = secrets.token_urlsafe(32)
    with core.db_connect() as db:
        db.execute("DELETE FROM admin_sessions WHERE expires_at<=?", (time.time(),))
        db.execute("INSERT INTO admin_sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), time.time() + 8 * 3600, "admin"))
    response = JSONResponse({"actor": "admin"})
    response.set_cookie("dgp_admin", token, httponly=True, secure=os.getenv("ADMIN_COOKIE_SECURE", "true").lower() != "false", samesite="strict", max_age=8 * 3600, path="/api/admin")
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/api/admin/logout")
async def logout(request: Request, actor=Depends(authenticated)):
    with core.db_connect() as db:
        db.execute("DELETE FROM admin_sessions WHERE token_hash=?", (hashlib.sha256(request.cookies.get("dgp_admin", "").encode()).hexdigest(),))
    response = JSONResponse({"ok": True})
    response.delete_cookie("dgp_admin", path="/api/admin")
    return response


async def read_upload(file: UploadFile) -> tuple[str, list[dict]]:
    filename = Path(file.filename or "").name[:180]
    extension = Path(filename).suffix.lower()
    if extension not in {".xlsx", ".csv"}:
        raise HTTPException(400, ".xlsx 또는 .csv 파일만 업로드할 수 있습니다.")
    content = await file.read(core.MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(content) > core.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "파일 크기는 10MB를 초과할 수 없습니다.")
    try:
        rows = await run_in_threadpool(core.parse_excel if extension == ".xlsx" else core.parse_csv, content, True)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return filename, rows


@router.post("/api/admin/bootstrap")
async def bootstrap_upload(file: Annotated[UploadFile, File(...)], actor=Depends(authenticated)):
    _, rows = await read_upload(file)
    try:
        return await run_in_threadpool(bootstrap, rows)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


def upload_public(row: dict) -> dict:
    return {"name": row["가맹점명"], "address": row["사업장주소"], "category": row["가맹점업종명"]}


async def create_batch(rows: list[dict], filename: str) -> dict:
    incoming = defaultdict(list)
    for row in rows:
        incoming[row["사업자번호"]].append(row)
    with core.db_connect() as db:
        baseline_revision = revision(db)
        existing = db.execute("SELECT * FROM merchants WHERE active=1").fetchall()
        inactive = db.execute("SELECT * FROM merchants WHERE active=0").fetchall()
        links = defaultdict(set)
        all_links = set()
        for row in db.execute("SELECT * FROM business_links"):
            links[row["merchant_id"]].add(row["business_no"])
            all_links.add(row["business_no"])
        if not existing or any(not links[row["id"]] for row in existing):
            raise HTTPException(409, "현재 지도 원본 연결을 먼저 완료하세요. 초기 연결 또는 DB 이전이 필요합니다.")
    entries = []
    for old in existing:
        numbers = links[old["id"]]
        present = [item for number in numbers for item in incoming.get(number, [])]
        before = record_public(old)
        if not present:
            entries.append({"merchant_id": old["id"], "business_no": old["business_no"], "kind": "remove", "before": before, "after": None, "source_status": "", "numbers": sorted(numbers)})
            continue
        same = any(upload_public(item) == {key: before[key] for key in ("name", "address", "category")} for item in present)
        variants = {dumps(upload_public(item)) for item in present}
        kind = "keep" if same and len(variants) == 1 else "change" if not same and len(variants) == 1 else "review"
        if kind == "change" and any(sum(number in links[item["id"]] for item in existing) > 1 for number in numbers):
            kind = "review"
        after = {**before, **upload_public(present[0])} if kind == "change" else before
        if kind == "change":
            if after["address"] != before["address"]:
                after.update(lat=None, lng=None, phones=[], phone="", phoneSource="")
                for field in ("locality", "geocode_address", "geocode_method"):
                    after.pop(field, None)
            if after["name"] != before["name"]:
                after.pop("nameAliases", None)
            if after["category"] != before["category"]:
                after.pop("categories", None)
        source_status = "폐업자" if all("폐업" in item.get("사업자 상태", "") for item in present) else ""
        if kind == "keep" and source_status:
            kind = "review"
        entries.append({"merchant_id": old["id"], "business_no": old["business_no"], "kind": kind, "before": before, "after": after, "source_status": source_status, "options": [json.loads(value) for value in sorted(variants)] if kind == "review" else []})
    for number, group in incoming.items():
        if number in all_links:
            continue
        variants = {dumps(upload_public(row)) for row in group}
        source_status = "폐업자" if any("폐업" in row.get("사업자 상태", "") for row in group) else ""
        entries.append({"merchant_id": None, "business_no": number, "kind": "add" if len(variants) == 1 else "review", "before": None, "after": {**upload_public(group[0]), "lat": None, "lng": None, "phones": []}, "source_status": source_status, "options": [json.loads(value) for value in sorted(variants)] if len(variants) > 1 else []})
    for old in inactive:
        present = [item for number in links[old["id"]] for item in incoming.get(number, [])]
        if present:
            entries.append({"merchant_id": old["id"], "business_no": old["business_no"], "kind": "review", "before": {**record_public(old), "active": False}, "after": upload_public(present[0]), "source_status": ""})
    numbers = sorted({number for item in entries if item["kind"] != "keep" for number in item.get("numbers", [item["business_no"]])})
    statuses = await core.lookup_business_statuses(numbers)
    pending_coordinates = [item for item in entries if item["kind"] in {"add", "change"} and item["after"].get("lat") is None]
    if pending_coordinates:
        coordinates = await core.attach_coordinates([{"사업장주소": item["after"]["address"]} for item in pending_coordinates])
        for item, coordinate in zip(pending_coordinates, coordinates):
            item["after"].update(lat=coordinate["lat"], lng=coordinate["lng"])
    for item in entries:
        item["status"] = " / ".join(sorted({statuses.get(number, "미조회") for number in item.get("numbers", [item["business_no"]])}))
        if item["kind"] == "add" and ("폐업" in item["status"] or item["source_status"] == "폐업자"):
            item["kind"] = "closed"
    counts = Counter(item["kind"] for item in entries)
    summary = {"uploaded": len(rows), "unique_businesses": len(incoming), "duplicates": len(rows) - len(incoming), **{key: counts[key] for key in ("keep", "change", "add", "closed", "remove", "review")},
               "removed_closed": sum(item["kind"] == "remove" and "폐업" in item["status"] for item in entries),
               "coordinate_needed": sum(item["kind"] in {"add", "change"} and item["after"].get("lat") is None for item in entries)}
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if revision(db) != baseline_revision:
            raise HTTPException(409, "분석 중 데이터가 변경되었습니다. 다시 업로드하세요.")
        batch_id = db.execute("INSERT INTO batches(filename,created_at,revision,summary) VALUES(?,?,?,?)", (filename, now(), baseline_revision, dumps(summary))).lastrowid
        for item in entries:
            db.execute("INSERT INTO candidates(batch_id,merchant_id,business_no,kind,before_json,after_json,status,source_status,options_json) VALUES(?,?,?,?,?,?,?,?,?)",
                       (batch_id, item["merchant_id"], item["business_no"], item["kind"], dumps(item["before"]) if item["before"] else None, dumps(item["after"]) if item["after"] else None, item["status"], item["source_status"], dumps(item.get("options", []))))
    return {"id": batch_id, "summary": summary}


@router.post("/api/admin/batches")
async def upload_batch(file: Annotated[UploadFile, File(...)], actor=Depends(authenticated)):
    filename, rows = await read_upload(file)
    return await create_batch(rows, filename)


def candidate_view(row) -> dict:
    before = json.loads(row["before_json"]) if row["before_json"] else None
    after = json.loads(row["after_json"]) if row["after_json"] else None
    ready = row["decision"] == "pending" and row["kind"] in {"add", "change", "remove"}
    if row["kind"] in {"add", "change"}:
        ready = ready and has_valid_coordinates(after)
    if row["kind"] == "add":
        ready = ready and row["status"] == "계속사업자" and not row["source_status"]
    if row["kind"] == "change" and row["source_status"]:
        ready = False
    return {"id": row["id"], "merchant_id": row["merchant_id"], "kind": row["kind"], "before": before, "after": after, "options": json.loads(row["options_json"]), "status": row["status"], "source_status": row["source_status"], "decision": row["decision"], "ready": bool(ready),
            "exists_in_upload": row["kind"] != "remove", "currently_registered": row["merchant_id"] is not None and (before or {}).get("active", True)}


@router.get("/api/admin/dashboard")
async def dashboard(actor=Depends(authenticated)):
    with core.db_connect() as db:
        return {"revision": revision(db), "registered": db.execute("SELECT COUNT(*) FROM merchants WHERE active=1").fetchone()[0],
                "batches": [dict(row) | {"summary": json.loads(row["summary"])} for row in db.execute("SELECT * FROM batches ORDER BY id DESC LIMIT 100")],
                "publications": [dict(row) for row in db.execute("SELECT id,created_at,revision,digest,pr_url,state FROM publications ORDER BY id DESC LIMIT 30")]}


@router.get("/api/admin/batches/{batch_id}")
async def batch_details(batch_id: int, actor=Depends(authenticated)):
    with core.db_connect() as db:
        batch = db.execute("SELECT * FROM batches WHERE id=?", (batch_id,)).fetchone()
        if not batch:
            raise HTTPException(404, "업로드를 찾을 수 없습니다.")
        active_ids = {row[0] for row in db.execute("SELECT id FROM merchants WHERE active=1")}
        return {"id": batch_id, "filename": batch["filename"], "summary": json.loads(batch["summary"]), "stale": revision(db) != batch["revision"],
                "items": [{**candidate_view(row), "currently_registered": row["merchant_id"] in active_ids} for row in db.execute("SELECT * FROM candidates WHERE batch_id=?", (batch_id,))]}


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[int] = Field(min_length=1, max_length=10000)
    reason: str = Field(min_length=1, max_length=500)
    request_id: int | None = None


@router.post("/api/admin/batches/{batch_id}/approve")
async def approve(batch_id: int, body: Selection, actor=Depends(authenticated)):
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        batch = db.execute("SELECT * FROM batches WHERE id=?", (batch_id,)).fetchone()
        if not batch or batch["revision"] != revision(db):
            raise HTTPException(409, "다른 승인으로 데이터가 변경되었습니다. 최신 파일을 다시 비교하세요.")
        ids = sorted(set(body.ids))
        selected = [db.execute("SELECT * FROM candidates WHERE id=? AND batch_id=?", (item_id, batch_id)).fetchone() for item_id in ids]
        if any(row is None or not candidate_view(row)["ready"] for row in selected):
            raise HTTPException(409, "승인 불가 항목이 포함되어 있습니다. 상태·좌표·처리 여부를 확인하세요.")
        if body.request_id:
            request = db.execute("SELECT merchant_id FROM correction_requests WHERE id=?", (body.request_id,)).fetchone()
            if not request or any(row["merchant_id"] != request[0] for row in selected):
                raise HTTPException(422, "선택 가맹점과 연결된 수정 요청이 아닙니다.")
        for row in selected:
            view = candidate_view(row)
            before, after, merchant_id = view["before"], view["after"], row["merchant_id"]
            if row["kind"] == "remove":
                db.execute("UPDATE merchants SET active=0, revision=revision+1 WHERE id=?", (merchant_id,))
            elif row["kind"] == "add":
                if db.execute("SELECT 1 FROM business_links WHERE business_no=?", (row["business_no"],)).fetchone():
                    raise HTTPException(409, "이미 연결된 사업자입니다. 다시 비교하세요.")
                merchant_id = db.execute("""INSERT INTO merchants(business_no,merchant_no,name,address,category,lat,lng,business_status,uploaded_at)
                     VALUES(?,?,?,?,?,?,?,?,?)""", (row["business_no"], f"approved-{secrets.token_hex(12)}", after["name"], after["address"], after["category"], after["lat"], after["lng"], row["status"], now())).lastrowid
                after["id"] = merchant_id
                db.execute("UPDATE merchants SET public_json=? WHERE id=?", (dumps(after), merchant_id))
                db.execute("INSERT INTO business_links VALUES(?,?)", (merchant_id, row["business_no"]))
            else:
                db.execute("UPDATE merchants SET name=?,address=?,category=?,lat=?,lng=?,public_json=?,revision=revision+1 WHERE id=?",
                           (after["name"], after["address"], after["category"], after["lat"], after["lng"], dumps(after), merchant_id))
            db.execute("UPDATE candidates SET decision='approved',merchant_id=?,after_json=? WHERE id=?", (merchant_id, dumps(after) if after else None, row["id"]))
            log(db, row["kind"], merchant_id, before, after, body.reason, body.request_id, actor)
        db.execute("UPDATE admin_state SET revision=revision+1")
        # Partial approvals in this batch remain usable; all other batches are stale.
        db.execute("UPDATE batches SET revision=? WHERE id=?", (revision(db), batch_id))
    return {"approved": len(selected)}


@router.post("/api/admin/batches/{batch_id}/retry")
async def retry(batch_id: int, actor=Depends(authenticated)):
    with core.db_connect() as db:
        batch = db.execute("SELECT * FROM batches WHERE id=?", (batch_id,)).fetchone()
        if not batch or batch["revision"] != revision(db):
            raise HTTPException(409, "다시 비교해야 하는 업로드입니다.")
        rows = db.execute("SELECT * FROM candidates WHERE batch_id=? AND decision='pending' AND kind IN ('add','change','closed')", (batch_id,)).fetchall()
    statuses = await core.lookup_business_statuses(sorted({row["business_no"] for row in rows}))
    for row in rows:
        after = json.loads(row["after_json"])
        if after.get("lat") is None:
            coordinate = (await core.attach_coordinates([{"사업장주소": after["address"]}]))[0]
            after.update(lat=coordinate["lat"], lng=coordinate["lng"])
        status = statuses.get(row["business_no"], "조회 실패")
        kind = row["kind"]
        if kind in {"closed", "add"}:
            kind = "closed" if "폐업" in status or row["source_status"] else "add"
        with core.db_connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if revision(db) != batch["revision"]:
                raise HTTPException(409, "재검증 중 다른 승인이 발생했습니다. 다시 비교하세요.")
            db.execute("UPDATE candidates SET status=?,kind=?,after_json=? WHERE id=? AND decision='pending'", (status, kind, dumps(after), row["id"]))
    return {"checked": len(rows)}


@router.post("/api/admin/batches/{batch_id}/reject")
async def reject(batch_id: int, body: Selection, actor=Depends(authenticated)):
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        for item_id in set(body.ids):
            row = db.execute("SELECT * FROM candidates WHERE id=? AND batch_id=? AND decision='pending'", (item_id, batch_id)).fetchone()
            if not row:
                raise HTTPException(409, "이미 처리되었거나 다른 업로드의 항목입니다.")
            db.execute("UPDATE candidates SET decision='rejected' WHERE id=?", (item_id,))
            log(db, "후보 보류/반영하지 않음", row["merchant_id"], candidate_view(row)["before"], None, body.reason, actor=actor)
    return {"rejected": len(set(body.ids))}


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    merchantId: int = Field(gt=0)
    kind: Literal["closed", "unavailable", "name", "address", "phone", "category", "other"]
    message: str = Field(default="", max_length=1000)
    website: str = Field(default="", max_length=200)  # honeypot

    @field_validator("message")
    @classmethod
    def plain_text(cls, value):
        if re.search(r"[<>\x00-\x08\x0b\x0c\x0e-\x1f]", value):
            raise ValueError("HTML/script 없이 일반 텍스트로 입력하세요.")
        return value.strip()


@router.post("/api/corrections", status_code=201)
async def submit_correction(body: Correction, request: Request):
    allowed = {origin.strip() for origin in os.getenv("PUBLIC_ORIGINS", "https://lch854053.github.io").split(",")}
    origin = request.headers.get("origin")
    if origin and origin not in allowed and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "허용되지 않은 요청 출처입니다.")
    throttle(request, "corrections-minute", 3, 60)
    throttle(request, "corrections-day", 20, 86400)
    if body.website:
        raise HTTPException(422, "잘못된 요청입니다.")
    with core.db_connect() as db:
        merchant = db.execute("SELECT * FROM merchants WHERE id=? AND active=1", (body.merchantId,)).fetchone()
        if not merchant:
            raise HTTPException(404, "현재 등록된 가맹점을 찾을 수 없습니다.")
        snapshot = {key: merchant[key] for key in ("id", "name", "address", "category")}
        request_id = db.execute("INSERT INTO correction_requests(merchant_id,merchant_json,kind,message,created_at) VALUES(?,?,?,?,?)", (body.merchantId, dumps(snapshot), body.kind, body.message, now())).lastrowid
    return {"id": request_id, "message": "수정 요청을 접수했습니다."}


@router.get("/api/admin/requests")
async def requests(actor=Depends(authenticated)):
    with core.db_connect() as db:
        rows = db.execute("SELECT * FROM correction_requests ORDER BY id DESC").fetchall()
        counts = Counter((row["merchant_id"], row["kind"]) for row in rows if row["status"] in {"미처리", "확인 중"})
        result = []
        for row in rows:
            item = dict(row)
            item["merchant"] = json.loads(item.pop("merchant_json"))
            current = db.execute("SELECT * FROM merchants WHERE id=?", (row["merchant_id"],)).fetchone()
            item["current"] = record_public(current) if current else None
            item["registered"] = bool(current and current["active"])
            item["group_count"] = counts[(row["merchant_id"], row["kind"])]
            result.append(item)
        return {"items": result}


class RequestResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["미처리", "확인 중", "반영 완료", "반영하지 않음"]
    reason: str = Field(min_length=1, max_length=500)


@router.patch("/api/admin/requests/{request_id}")
async def resolve_request(request_id: int, body: RequestResolution, actor=Depends(authenticated)):
    with core.db_connect() as db:
        old = db.execute("SELECT * FROM correction_requests WHERE id=?", (request_id,)).fetchone()
        if not old:
            raise HTTPException(404, "수정 요청이 없습니다.")
        db.execute("UPDATE correction_requests SET status=?,resolution=? WHERE id=?", (body.status, body.reason, request_id))
        log(db, "요청 처리", old["merchant_id"], {"status": old["status"]}, {"status": body.status}, body.reason, request_id, actor)
    return {"ok": True}


class MerchantEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int
    action: Literal["edit", "exclude", "restore"]
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = Field(default=None, min_length=1, max_length=300)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    phones: list[str] | None = Field(default=None, max_length=5)
    reason: str = Field(min_length=1, max_length=500)
    request_id: int | None = None

    @field_validator("name", "address", "category")
    @classmethod
    def validate_text(cls, value):
        if value is not None and (not value.strip() or "<" in value or ">" in value or any(pattern.search(value) for pattern in core.PII_PATTERNS.values())):
            raise ValueError("가맹점 정보는 개인정보/HTML 없이 입력하세요.")
        return value.strip() if value is not None else value

    @field_validator("phones")
    @classmethod
    def validate_phones(cls, values):
        if values is not None and any(not re.fullmatch(r"(?:0\d{1,2}-\d{3,4}-\d{4}|1[568]\d{2}-\d{4})", value) for value in values):
            raise ValueError("전화번호 형식을 확인하세요. 예: 062-123-4567")
        return list(dict.fromkeys(values)) if values is not None else values


@router.get("/api/admin/merchants")
async def admin_merchants(actor=Depends(authenticated)):
    with core.db_connect() as db:
        return {"revision": revision(db), "items": [{"merchant": record_public(row), "active": bool(row["active"]), "revision": row["revision"]} for row in db.execute("SELECT * FROM merchants ORDER BY id")]}


@router.patch("/api/admin/merchants/{merchant_id}")
async def edit_merchant(merchant_id: int, body: MerchantEdit, actor=Depends(authenticated)):
    with core.db_connect() as db:
        row = db.execute("SELECT * FROM merchants WHERE id=?", (merchant_id,)).fetchone()
        if not row:
            raise HTTPException(404, "가맹점이 없습니다.")
        before = record_public(row)
        after = {**before}
        if row["revision"] != body.revision:
            raise HTTPException(409, "다른 담당자가 변경했습니다. 다시 조회하세요.")
    for field in ("name", "address", "category"):
        value = getattr(body, field)
        if value is not None:
            after[field] = value
    if after["address"] != before["address"]:
        coordinate = (await core.attach_coordinates([{"사업장주소": after["address"]}]))[0]
        if coordinate["lat"] is None:
            raise HTTPException(422, "좌표 확인 필요: 주소를 확인한 뒤 다시 시도하세요.")
        after.update(lat=coordinate["lat"], lng=coordinate["lng"], phones=[], phone="", phoneSource="")
        for field in ("locality", "geocode_address", "geocode_method"):
            after.pop(field, None)
    if after["name"] != before["name"]:
        after.pop("nameAliases", None)
    if after["category"] != before["category"]:
        after.pop("categories", None)
    if body.phones is not None:
        after.update(phones=body.phones, phone=body.phones[0] if body.phones else "", phoneSource="관리자 확인")
    if body.action == "restore" and not has_valid_coordinates(after):
        raise HTTPException(422, "좌표 확인 필요")
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT revision FROM merchants WHERE id=?", (merchant_id,)).fetchone()
        if current[0] != body.revision:
            raise HTTPException(409, "변경 충돌: 다시 조회하세요.")
        if body.request_id and not db.execute("SELECT 1 FROM correction_requests WHERE id=? AND merchant_id=?", (body.request_id, merchant_id)).fetchone():
            raise HTTPException(422, "가맹점과 연결된 수정 요청이 아닙니다.")
        active = 0 if body.action == "exclude" else 1 if body.action == "restore" else row["active"]
        db.execute("UPDATE merchants SET name=?,address=?,category=?,lat=?,lng=?,public_json=?,active=?,revision=revision+1 WHERE id=?",
                   (after["name"], after["address"], after["category"], after["lat"], after["lng"], dumps(after), active, merchant_id))
        db.execute("UPDATE admin_state SET revision=revision+1")
        log(db, body.action, merchant_id, {**before, "active": bool(row["active"])}, {**after, "active": bool(active)}, body.reason, body.request_id, actor)
    return {"ok": True}


@router.get("/api/admin/history")
async def history(actor=Depends(authenticated)):
    with core.db_connect() as db:
        return {"items": [{**dict(row), "before": json.loads(row["before_json"]) if row["before_json"] else None, "after": json.loads(row["after_json"]) if row["after_json"] else None} for row in db.execute("SELECT * FROM change_logs ORDER BY id DESC")]}


def snapshot_content(db) -> str:
    items = [record_public(row) for row in db.execute("SELECT * FROM merchants WHERE active=1 ORDER BY id")]
    if not items or any(not has_valid_coordinates(item) for item in items):
        raise HTTPException(409, "공개 데이터가 비어 있거나 좌표가 누락되었습니다.")
    meta = {"count": len(items), "revision": revision(db), "generatedAt": now()}
    # Escape '<' to prevent embedding strings from ever closing a script tag.
    return ("/* Approved public snapshot. No private identifiers. */\nwindow.DONGGURANG_DATA_META=" + dumps(meta) + ";\nwindow.DONGGURANG_MERCHANTS=" + dumps(items) + ";\n").replace("<", "\\u003c")


@router.post("/api/admin/publications")
async def create_publication(actor=Depends(authenticated)):
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        content = snapshot_content(db)
        digest = hashlib.sha256(content.encode()).hexdigest()
        publication_id = db.execute("INSERT INTO publications(created_at,revision,content,digest) VALUES(?,?,?,?)", (now(), revision(db), content, digest)).lastrowid
        log(db, "배포 파일 생성", None, None, {"publication_id": publication_id, "sha256": digest}, "승인된 데이터만 공개 파일로 생성", actor=actor)
    return {"id": publication_id, "digest": digest}


@router.get("/api/admin/publications/{publication_id}/download")
async def download_publication(publication_id: int, actor=Depends(authenticated)):
    with core.db_connect() as db:
        row = db.execute("SELECT * FROM publications WHERE id=?", (publication_id,)).fetchone()
        if not row:
            raise HTTPException(404, "배포 파일이 없습니다.")
    return Response(row["content"], media_type="text/javascript", headers={"Content-Disposition": 'attachment; filename="merchant-data.js"', "Cache-Control": "no-store"})


@router.post("/api/admin/publications/{publication_id}/publish")
async def publish(publication_id: int, actor=Depends(authenticated)):
    from app.publishing import create_deployment_pr
    with core.db_connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM publications WHERE id=?", (publication_id,)).fetchone()
        if not row:
            raise HTTPException(404, "배포 파일이 없습니다.")
        if row["pr_url"]:
            return {"url": row["pr_url"]}
        if row["revision"] != revision(db):
            raise HTTPException(409, "새 승인 내용이 있습니다. 배포 파일을 다시 생성하세요.")
        if row["state"] == "publishing" and row["publish_started_at"] and time.time() - row["publish_started_at"] < 300:
            raise HTTPException(409, "배포 요청이 진행 중입니다. 잠시 후 다시 확인하세요.")
        db.execute("UPDATE publications SET state='publishing',publish_started_at=? WHERE id=?", (time.time(), publication_id))
    try:
        url = await create_deployment_pr(publication_id, row["content"], row["digest"])
    except Exception as exc:
        with core.db_connect() as db:
            db.execute("UPDATE publications SET state='failed' WHERE id=?", (publication_id,))
        raise HTTPException(502, "배포 PR 생성 실패. 기존 지도는 유지됩니다. 서버 설정 또는 GitHub의 같은 배포 브랜치를 확인하고 재시도하세요.") from exc
    with core.db_connect() as db:
        db.execute("UPDATE publications SET state='pr_created',pr_url=? WHERE id=?", (url, publication_id))
        log(db, "배포 PR 생성", None, None, {"url": url, "publication_id": publication_id}, "GitHub 검토/병합 후 Pages 배포", actor=actor)
    return {"url": url}
