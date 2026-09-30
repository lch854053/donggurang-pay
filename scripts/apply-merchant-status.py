"""Remove closed merchants from the published map using the matching source workbook.

Usage: uv run --with openpyxl python scripts/apply-merchant-status.py <source.xlsx>
The workbook is read only and never copied into the repository.
"""

import json
import re
import sys
from pathlib import Path

from openpyxl import load_workbook

SOURCE = Path(__file__).resolve().parent.parent / "static" / "merchant-data.js"
PREFIX = "window.DONGGURANG_MERCHANTS="


def main(workbook_path: str) -> None:
    source = SOURCE.read_text(encoding="utf-8")
    match = re.search(r"window\.DONGGURANG_MERCHANTS=(\[.*\]);?\s*$", source, re.S)
    if not match:
        raise ValueError("가맹점 지도 자료의 형식이 올바르지 않습니다.")
    merchants = json.loads(match.group(1))

    workbook = load_workbook(workbook_path, read_only=True, data_only=True)
    try:
        rows = workbook.active.values
        headers = [re.sub(r"\s+", " ", str(value or "")).strip() for value in next(rows)]
        columns = {name: headers.index(name) for name in ("가맹점명", "사업장주소", "가맹점업종명", "사업자 상태")}
        statuses = []
        for row in rows:
            status = row[columns["사업자 상태"]]
            if status not in ("계속사업자", "휴업자", "폐업자"):
                continue  # Spreadsheet error rows have no business status or merchant fields.
            statuses.append(row)
    finally:
        workbook.close()

    if len(statuses) != len(merchants):
        raise ValueError(f"엑셀 {len(statuses)}건과 지도 {len(merchants)}건이 일치하지 않습니다. 기존 자료를 덮어쓰지 않습니다.")
    for index, (merchant, row) in enumerate(zip(merchants, statuses), 1):
        if any(merchant[field] != str(row[columns[column]]).strip() for field, column in (
            ("name", "가맹점명"), ("address", "사업장주소"), ("category", "가맹점업종명")
        )):
            raise ValueError(f"{index}번째 가맹점이 일치하지 않습니다. 기존 자료를 덮어쓰지 않습니다.")

    open_merchants = [merchant for merchant, row in zip(merchants, statuses)
                      if row[columns["사업자 상태"]] != "폐업자"]
    metadata = json.loads(re.search(r"window\.DONGGURANG_DATA_META=({[^;]+});", source).group(1))
    metadata["count"] = len(open_merchants)
    SOURCE.write_text(
        "/* Generated from merchant business addresses via Kakao address search. No API key is included. */\n"
        + "window.DONGGURANG_DATA_META=" + json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + ";\n"
        + PREFIX + json.dumps(open_merchants, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"폐업 {len(merchants) - len(open_merchants)}건 제외, 공개 가맹점 {len(open_merchants)}건")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/apply-merchant-status.py <source.xlsx>")
    main(sys.argv[1])
