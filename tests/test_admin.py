import asyncio
import csv
import hashlib
import io
import json
import zipfile

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main as core
from app import admin
from app.geocoding import validate_document

AUTH = {"X-Admin-Key": "test-admin-key"}
ORIGINAL_LOOKUP = core.lookup_business_statuses
HEADERS = ["사업자번호", "가맹점번호", "가맹점명", "사업장주소", "가맹점업종명", "사업자 상태"]


def incoming(letter, number=None, status="계속사업자", address=None):
    return [number or f"123456789{ord(letter)-65}", f"M-{letter}", letter, address or f"광주 동구 서남로 {ord(letter)-64}", "일반한식", status]


def csv_bytes(rows):
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return stream.getvalue().encode()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", "test-admin-key")
    monkeypatch.setenv("ADMIN_COOKIE_SECURE", "false")
    monkeypatch.setenv("LOAD_SAMPLE_DATA", "false")
    monkeypatch.delenv("ADMIN_ORIGIN", raising=False)
    monkeypatch.setattr(core, "DATA_DIR", tmp_path)
    monkeypatch.setattr(core, "DB_PATH", tmp_path / "test.db")
    async def statuses(numbers):
        return {number: "계속사업자" for number in numbers}
    async def coordinates(rows):
        return [{**row, "lat": 35.1459, "lng": 126.9231} for row in rows]
    monkeypatch.setattr(core, "lookup_business_statuses", statuses)
    monkeypatch.setattr(core, "attach_coordinates", coordinates)
    with TestClient(core.app) as c:
        with core.db_connect() as db:
            for i, letter in enumerate("ABC", 1):
                data = {"id": i, "name": letter, "address": incoming(letter)[3], "category": "일반한식", "lat": 35.1459, "lng": 126.9231, "phones": ["062-123-4567"]}
                db.execute("INSERT INTO merchants(id,business_no,merchant_no,name,address,category,lat,lng,uploaded_at,public_json) VALUES(?,?,?,?,?,?,?,?,?,?)", (i, incoming(letter)[0], f"M-{letter}", letter, data["address"], data["category"], data["lat"], data["lng"], admin.now(), admin.dumps(data)))
                db.execute("INSERT INTO business_links VALUES(?,?)", (i, incoming(letter)[0]))
        yield c


def upload(client, rows=None):
    response = client.post("/api/admin/batches", headers=AUTH, files={"file": ("monthly.csv", csv_bytes(rows or [incoming(x) for x in "ABD"]), "text/csv")})
    assert response.status_code == 200, response.text
    result = response.json()
    detail = client.get(f"/api/admin/batches/{result['id']}", headers=AUTH).json()
    return detail


def approve(client, batch, items):
    return client.post(f"/api/admin/batches/{batch['id']}/approve", headers=AUTH, json={"ids": [item["id"] for item in items], "reason": "담당자 확인"})


def test_diff_and_explicit_approval(client):
    before = client.get("/api/merchants").json()
    batch = upload(client)
    by_name = {(item["after"] or item["before"])["name"]: item for item in batch["items"]}
    assert {name: row["kind"] for name, row in by_name.items()} == {"A": "keep", "B": "keep", "C": "remove", "D": "add"}
    assert client.get("/api/merchants").json() == before
    assert approve(client, batch, [by_name["D"]]).json() == {"approved": 1}
    assert approve(client, batch, [by_name["C"]]).json() == {"approved": 1}
    processed = client.get(f"/api/admin/batches/{batch['id']}", headers=AUTH).json()["items"]
    assert next(row for row in processed if row["id"] == by_name["D"]["id"])["currently_registered"]
    assert not next(row for row in processed if row["id"] == by_name["C"]["id"])["currently_registered"]
    assert {m["name"] for m in client.get("/api/merchants").json()["items"]} == {"A", "B", "D"}
    logs = client.get("/api/admin/history", headers=AUTH).json()["items"]
    assert {row["action"] for row in logs} == {"add", "remove"}
    assert logs[0]["before"]["name"] == "C"
    # Repeating an approval must never add twice.
    assert approve(client, batch, [by_name["D"]]).status_code == 409


@pytest.mark.parametrize("missing_status", ["폐업자", "계속사업자", "조회 실패"])
def test_missing_business_never_auto_deleted(client, monkeypatch, missing_status):
    async def statuses(numbers):
        return {number: missing_status if number == incoming("C")[0] else "계속사업자" for number in numbers}
    monkeypatch.setattr(core, "lookup_business_statuses", statuses)
    batch = upload(client)
    candidate = next(row for row in batch["items"] if row["kind"] == "remove")
    assert candidate["status"] == missing_status
    assert candidate["exists_in_upload"] is False
    assert len(client.get("/api/merchants").json()["items"]) == 3


def test_new_closed_excluded_and_source_status_authoritative(client, monkeypatch):
    async def statuses(numbers):
        return {number: "폐업자" if number == incoming("D")[0] else "계속사업자" for number in numbers}
    monkeypatch.setattr(core, "lookup_business_statuses", statuses)
    batch = upload(client)
    new = next(row for row in batch["items"] if (row["after"] or row["before"])["name"] == "D")
    assert new["kind"] == "closed" and not new["ready"]
    assert approve(client, batch, [new]).status_code == 409
    # Original closed status cannot be overridden by an external API's active status.
    async def active(numbers):
        return {number: "계속사업자" for number in numbers}
    monkeypatch.setattr(core, "lookup_business_statuses", active)
    source_closed = upload(client, [incoming(x) for x in "AB"] + [incoming("D", status="폐업자")])
    assert next(r for r in source_closed["items"] if r["kind"] == "closed")["source_status"] == "폐업자"


@pytest.mark.parametrize("status", ["조회 실패", "휴업자", "미등록"])
def test_new_unverified_status_cannot_be_approved(client, monkeypatch, status):
    async def statuses(numbers):
        return {number: status for number in numbers}
    monkeypatch.setattr(core, "lookup_business_statuses", statuses)
    batch = upload(client)
    new = next(row for row in batch["items"] if row["kind"] == "add")
    assert not new["ready"]
    assert approve(client, batch, [new]).status_code == 409


def test_missing_coordinates_block_entire_selection(client, monkeypatch):
    async def no_coordinates(rows):
        return [{**row, "lat": None, "lng": None} for row in rows]
    monkeypatch.setattr(core, "attach_coordinates", no_coordinates)
    batch = upload(client)
    assert batch["summary"]["coordinate_needed"] == 1
    selected = [row for row in batch["items"] if row["kind"] in {"add", "remove"}]
    assert approve(client, batch, selected).status_code == 409
    assert len(client.get("/api/merchants").json()["items"]) == 3


def test_duplicate_business_and_conflicts(client):
    rows = [incoming(x) for x in "ABD"] + [incoming("D")]
    batch = upload(client, rows)
    assert batch["summary"]["duplicates"] == 1
    assert len([row for row in batch["items"] if row["kind"] == "add"]) == 1
    conflict = incoming("D"); conflict[2] = "다른 상점"; conflict[1] = "M-D2"
    batch = upload(client, [incoming(x) for x in "ABD"] + [conflict])
    assert batch["summary"]["review"] == 1 and batch["summary"]["add"] == 0
    options = next(row for row in batch["items"] if row["kind"] == "review")["options"]
    assert {item["name"] for item in options} == {"D", "다른 상점"}
    assert all("사업자번호" not in item for item in options)


def test_changes_preserve_id_phones_and_require_approval(client):
    row = incoming("B"); row[2] = "새 상호"
    batch = upload(client, [incoming("A"), row, incoming("C")])
    change = next(r for r in batch["items"] if r["kind"] == "change")
    assert change["merchant_id"] == 2
    assert client.get("/api/merchants").json()["items"][1]["name"] == "B"
    assert approve(client, batch, [change]).status_code == 200
    updated = client.get("/api/merchants").json()["items"][1]
    assert updated["id"] == 2 and updated["name"] == "새 상호" and updated["phones"] == ["062-123-4567"]


def test_stale_batches_and_optimistic_edit_collision(client):
    first = upload(client); second = upload(client)
    new = next(r for r in first["items"] if r["kind"] == "add")
    assert approve(client, first, [new]).status_code == 200
    assert approve(client, second, [next(r for r in second["items"] if r["kind"] == "remove")]).status_code == 409
    edit = {"revision": 0, "action": "edit", "name": "수정 이름", "reason": "확인"}
    assert client.patch("/api/admin/merchants/1", headers=AUTH, json=edit).status_code == 200
    assert client.patch("/api/admin/merchants/1", headers=AUTH, json=edit).status_code == 409


def test_correction_lifecycle_and_manual_exclusion(client):
    response = client.post("/api/corrections", json={"merchantId": 1, "kind": "closed", "message": "현장 확인 필요"}, headers={"Origin": "https://lch854053.github.io"})
    assert response.status_code == 201
    request_id = response.json()["id"]
    requests = client.get("/api/admin/requests", headers=AUTH).json()["items"]
    assert requests[0]["merchant"]["name"] == "A" and requests[0]["status"] == "미처리"
    assert len(client.get("/api/merchants").json()["items"]) == 3
    result = client.patch("/api/admin/merchants/1", headers=AUTH, json={"revision": 0, "action": "exclude", "reason": "폐업 현장 확인", "request_id": request_id})
    assert result.status_code == 200
    assert client.patch(f"/api/admin/requests/{request_id}", headers=AUTH, json={"status": "반영 완료", "reason": "지도 제외 승인 완료"}).status_code == 200
    assert len(client.get("/api/merchants").json()["items"]) == 2
    assert client.get("/api/admin/requests", headers=AUTH).json()["items"][0]["status"] == "반영 완료"
    assert any(log["request_id"] == request_id for log in client.get("/api/admin/history", headers=AUTH).json()["items"])
    assert client.post("/api/corrections", json={"merchantId": 1, "kind": "closed"}).status_code == 404


def test_request_validation_rate_limit_and_cors(client):
    assert client.post("/api/corrections", json={"merchantId": 1, "kind": "other", "message": "<script>alert(1)</script>"}).status_code == 422
    assert client.post("/api/corrections", json={"merchantId": 1, "kind": "other", "message": "a" * 1001}).status_code == 422
    assert client.post("/api/corrections", json={"merchantId": 1, "kind": "other", "business_no": "1234567890"}).status_code == 422
    assert client.post("/api/corrections", json={"merchantId": 1, "kind": "other"}, headers={"Origin": "https://evil.example"}).status_code == 403
    for _ in range(3):
        assert client.post("/api/corrections", json={"merchantId": 1, "kind": "closed"}).status_code == 201
    assert client.post("/api/corrections", json={"merchantId": 1, "kind": "closed"}, headers={"X-Forwarded-For": "another-ip"}).status_code == 429
    grouped = client.get("/api/admin/requests", headers=AUTH).json()["items"]
    assert grouped[0]["group_count"] == 3
    preflight = client.options("/api/corrections", headers={"Origin": "https://lch854053.github.io", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert preflight.headers["access-control-allow-origin"] == "https://lch854053.github.io"


def test_auth_sessions_csrf_and_logout(client):
    assert client.post("/api/admin/login", json={"key": "잘못된 인증키"}).status_code == 401
    for path in ["/dashboard", "/requests", "/history", "/merchants"]:
        assert client.get("/api/admin" + path).status_code == 401
    response = client.post("/api/admin/login", json={"key": "test-admin-key"})
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"] and "SameSite=strict" in response.headers["set-cookie"]
    assert "test-admin-key" not in response.text
    assert client.get("/api/admin/dashboard").status_code == 200
    assert client.post("/api/admin/publications").status_code == 403
    assert client.post("/api/admin/publications", headers={"X-Requested-With": "donggurang-admin", "Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/admin/logout", headers={"X-Requested-With": "donggurang-admin"}).status_code == 200
    assert client.get("/api/admin/dashboard").status_code == 401


def test_revalidation_rejection_and_excluded_reappearance(client, monkeypatch):
    async def unavailable(numbers):
        return {number: "조회 실패" for number in numbers}
    monkeypatch.setattr(core, "lookup_business_statuses", unavailable)
    batch = upload(client)
    new = next(row for row in batch["items"] if row["kind"] == "add")
    assert not new["ready"]
    async def available(numbers):
        return {number: "계속사업자" for number in numbers}
    monkeypatch.setattr(core, "lookup_business_statuses", available)
    assert client.post(f"/api/admin/batches/{batch['id']}/retry", headers=AUTH).status_code == 200
    refreshed = client.get(f"/api/admin/batches/{batch['id']}", headers=AUTH).json()
    assert next(row for row in refreshed["items"] if row["id"] == new["id"])["ready"]
    assert client.post(f"/api/admin/batches/{batch['id']}/reject", headers=AUTH, json={"ids": [new["id"]], "reason": "명단 확인 후 보류"}).status_code == 200
    assert approve(client, batch, [new]).status_code == 409
    assert client.patch("/api/admin/merchants/3", headers=AUTH, json={"revision": 0, "action": "exclude", "reason": "확인"}).status_code == 200
    reappeared = upload(client, [incoming(x) for x in "ABC"])
    item = next(row for row in reappeared["items"] if row["merchant_id"] == 3)
    assert item["kind"] == "review" and not item["currently_registered"] and not item["ready"]
    assert client.patch("/api/admin/merchants/3", headers=AUTH, json={"revision": 1, "action": "restore", "reason": "등록 가능 확인"}).status_code == 200
    assert len(client.get("/api/merchants").json()["items"]) == 3


def test_daily_limit_survives_minute_bucket_changes(client, monkeypatch):
    clock = [time_value := 1_800_000_000.0]
    monkeypatch.setattr(admin.time, "time", lambda: clock[0])
    for i in range(20):
        clock[0] = time_value + (i // 2) * 61
        assert client.post("/api/corrections", json={"merchantId": 1, "kind": "other"}).status_code == 201
    clock[0] += 61
    assert client.post("/api/corrections", json={"merchantId": 1, "kind": "other"}).status_code == 429


def test_private_publication_and_failure_keeps_public_file(client, monkeypatch):
    file = core.STATIC_DIR / "merchant-data.js"
    original = file.read_bytes()
    batch = upload(client)
    assert approve(client, batch, [next(r for r in batch["items"] if r["kind"] == "add")]).status_code == 200
    publication = client.post("/api/admin/publications", headers=AUTH).json()
    response = client.get(f"/api/admin/publications/{publication['id']}/download", headers=AUTH)
    assert response.status_code == 200
    content = response.text
    assert hashlib.sha256(response.content).hexdigest() == publication["digest"]
    for forbidden in ["business_no", "사업자번호", "1234567890", "test-admin-key"]:
        assert forbidden not in content
    assert '"name":"D"' in content
    async def fail(*args):
        raise RuntimeError("external publication failure")
    monkeypatch.setattr("app.publishing.create_deployment_pr", fail)
    assert client.post(f"/api/admin/publications/{publication['id']}/publish", headers=AUTH).status_code == 502
    assert file.read_bytes() == original
    assert client.get(f"/api/admin/publications/{publication['id']}/download").status_code == 401


def test_weekly_status_is_advisory(client, monkeypatch):
    async def closed(numbers):
        return {n: "폐업자" for n in numbers}
    monkeypatch.setattr(core, "lookup_business_statuses", closed)
    assert client.post("/api/admin/check-business-status", headers=AUTH).status_code == 200
    assert len(client.get("/api/merchants").json()["items"]) == 3


def test_upload_security(client):
    assert client.post("/api/admin/batches", headers=AUTH, files={"file": ("malicious.xlsm", b"test")}).status_code == 400
    assert client.post("/api/admin/batches", headers=AUTH, files={"file": ("fake.xlsx", b"not a zip")}).status_code == 422
    rows = csv_bytes([incoming("D")]).replace(b"\xec\x82\xac\xec\x97\x85\xec\x9e\x90\xeb\xb2\x88\xed\x98\xb8", "이메일".encode(), 1)
    assert client.post("/api/admin/batches", headers=AUTH, files={"file": ("unknown.csv", rows)}).status_code == 422
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        z.writestr('xl/vbaProject.bin', b'macro')
    with pytest.raises(ValueError, match="매크로"):
        core.parse_excel(stream.getvalue(), review=True)


def test_bootstrap_preserves_ids_and_is_atomic(client, monkeypatch):
    with core.db_connect() as db:
        db.execute("DELETE FROM business_links")
        db.execute("DELETE FROM merchants")
    baseline = admin.bundled_merchants()[:2]
    monkeypatch.setattr(admin, "bundled_merchants", lambda: baseline)
    rows = [{key: value for key, value in zip(HEADERS, incoming(letter))} for letter in "AB"]
    rows[0].update(가맹점명=baseline[0]["name"], 사업장주소=baseline[0]["address"])
    with pytest.raises(ValueError, match="연결이 없습니다"):
        admin.bootstrap(rows)
    with core.db_connect() as db:
        assert db.execute("SELECT COUNT(*) FROM merchants").fetchone()[0] == 0
    rows[1].update(가맹점명=baseline[1]["name"], 사업장주소=baseline[1]["address"])
    assert admin.bootstrap(rows)["connected"] == 2
    with core.db_connect() as db:
        actual = [admin.record_public(r) for r in db.execute("SELECT * FROM merchants ORDER BY id")]
    assert actual == baseline
    with pytest.raises(ValueError, match="빈 DB"):
        admin.bootstrap(rows)


def test_geocode_rejects_wrong_building_and_district():
    doc = {"x": "126.9231", "y": "35.1459", "address_name": "광주광역시 동구 서남로 1", "road_address": {"road_name": "서남로", "main_building_no": "1", "sub_building_no": "0"}}
    assert validate_document(doc, "광주 동구 서남로 1")
    assert not validate_document(doc, "광주 동구 서남로 2")
    assert not validate_document({**doc, "address_name": "광주광역시 서구", "road_address": {}}, "광주 동구 서남로 1")


def test_nts_batch_lookup_fail_closed_and_no_key_disclosure(client, monkeypatch):
    monkeypatch.setenv("NTS_SERVICE_KEY", "test-nts-secret")
    seen = []
    def handler(request):
        batch = json.loads(request.content)["b_no"]
        seen.append(batch)
        if len(seen) == 2:
            return httpx.Response(503)
        return httpx.Response(200, json={"data": [{"b_no": batch[0], "b_stt_cd": "03"}, {"b_no": "unexpected", "b_stt_cd": "01"}]})
    original_client = httpx.AsyncClient
    monkeypatch.setattr(core.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    numbers = [str(1234567800 + i) for i in range(101)]
    result = asyncio.run(ORIGINAL_LOOKUP(numbers))
    assert len(seen) == 2 and len(seen[0]) == 100
    assert result[numbers[0]] == "폐업자" and result[numbers[-1]] == "조회 실패"
    assert "unexpected" not in result and "test-nts-secret" not in json.dumps(result)
    monkeypatch.delenv("NTS_SERVICE_KEY")
    assert asyncio.run(ORIGINAL_LOOKUP(numbers)) == {number: "조회 실패" for number in numbers}
