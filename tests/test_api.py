import csv
import io
import os

os.environ["ADMIN_KEY"] = "test-admin-key"
os.environ["LOAD_SAMPLE_DATA"] = "false"

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app, db_connect, parse_csv, parse_excel
import pytest


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


def test_parser_discards_known_pii_columns():
    content = workbook_bytes([["1234567890", "M-1", "동구상점", "광주 동구 서남로 1", "소매", "홍길동", "010-1234-5678"]])
    parsed = parse_excel(content, review=True)
    assert len(parsed) == 1
    assert "대표자명" not in parsed[0] and "휴대전화번호" not in parsed[0]


def test_parser_blocks_pii_in_safe_column():
    content = workbook_bytes([["1234567890", "M-1", "연락처 010-2222-3333", "광주 동구 서남로 1", "소매", "", ""]])
    with pytest.raises(ValueError, match="휴대전화번호 패턴"):
        parse_excel(content, review=True)


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


def test_legacy_parser_and_disabled_replacement(tmp_path, monkeypatch):
    monkeypatch.setattr("app.main.DATA_DIR", tmp_path)
    monkeypatch.setattr("app.main.DB_PATH", tmp_path / "test.db")
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["사업자번호", "가맹점번호", "가맹점명", "사업장주소", "가맹점업종명", "사업자 상태", "폐업일"])
    sheet.append(["1234567890", "M-1", "동구분식", "광주 동구 서남로 1", "스넥", "계속사업자", None])
    sheet.append(["1234567891", "M-2", "폐업마트", "광주 동구 서남로 2", "슈퍼 마켓", "폐업자", "2026.09.01"])
    sheet.append([None, None, None, None, None, "=1/0", None])
    output = io.BytesIO()
    workbook.save(output)
    assert len(parse_excel(output.getvalue())) == 1
    assert len(parse_excel(output.getvalue(), review=True)) == 2
    with TestClient(app) as client:
        response = client.post(
            "/api/admin/upload", headers={"X-Admin-Key": "test-admin-key"},
            files={"file": ("merchants.xlsx", output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 410, response.text
        with db_connect() as connection:
            assert connection.execute("SELECT COUNT(*) FROM merchants").fetchone()[0] == 0
        assert client.get("/api/categories").json() == {"items": []}


def test_csv_closed_row_does_not_trigger_duplicate_number():
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["사업자번호", "가맹점번호", "가맹점명", "사업장주소", "가맹점업종명", "사업자 상태"])
    writer.writerow(["1234567890", "M-1", "옛가게", "광주 동구 서남로 1", "스넥", "폐업자"])
    writer.writerow(["1234567890", "M-1", "새가게", "광주 동구 서남로 1", "스넥", "계속사업자"])
    assert [item["가맹점명"] for item in parse_csv(output.getvalue().encode())] == ["새가게"]
