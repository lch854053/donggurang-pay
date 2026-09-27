import csv
import io
import os

os.environ["ADMIN_KEY"] = "test-admin-key"
os.environ["LOAD_SAMPLE_DATA"] = "false"

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app, parse_csv


def workbook_bytes(rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["사업자번호", "가맹점번호", "가맹점명", "사업장주소", "가맹점업종명", "대표자명", "휴대전화번호"])
    for row in rows:
        sheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_health_and_empty_list(tmp_path, monkeypatch):
    monkeypatch.setattr("app.main.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.main.DB_PATH", tmp_path / "test.db")
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/api/merchants").json() == {"items": [], "total": 0}


def test_upload_discards_known_pii_columns(tmp_path, monkeypatch):
    monkeypatch.setattr("app.main.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.main.DB_PATH", tmp_path / "test.db")
    content = workbook_bytes([["1234567890", "M-1", "동구상점", "광주 동구 서남로 1", "소매", "홍길동", "010-1234-5678"]])
    with TestClient(app) as client:
        response = client.post(
            "/api/admin/upload",
            headers={"X-Admin-Key": "test-admin-key"},
            files={"file": ("merchants.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 200
        assert response.json()["imported"] == 1


def test_upload_blocks_pii_in_safe_column(tmp_path, monkeypatch):
    monkeypatch.setattr("app.main.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.main.DB_PATH", tmp_path / "test.db")
    content = workbook_bytes([["1234567890", "M-1", "연락처 010-2222-3333", "광주 동구 서남로 1", "소매", "", ""]])
    with TestClient(app) as client:
        response = client.post(
            "/api/admin/upload",
            headers={"X-Admin-Key": "test-admin-key"},
            files={"file": ("merchants.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 422
        assert "휴대전화번호 패턴" in response.json()["detail"]


def test_parse_cp949_csv_skips_empty_error_row():
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["", "사업자번호", "가맹점번호", "가맹점명", "사업장주소", "가맹점업종명", ""])
    writer.writerow(["1", "123-45-67890", "M-1", "동구상점", "광주 동구 서남로 1", "일반한식", ""])
    writer.writerow([])
    writer.writerow(["#REF!", "", "", "", "", "", ""])

    rows = parse_csv(output.getvalue().encode("cp949"))

    assert rows == [{
        "사업자번호": "1234567890",
        "가맹점번호": "M-1",
        "가맹점명": "동구상점",
        "사업장주소": "광주 동구 서남로 1",
        "가맹점업종명": "일반한식",
    }]
