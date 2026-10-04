"""Build the user-confirmed phone overlay from the three reviewed CSV snapshots.

Usage: python3 scripts/apply-reviewed-phones.py [--apply]
Business status is authoritative in the original merchant dataset; this script
never changes merchants or interprets source API status as current business status.
"""

import csv
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEWED = {
    "komsco-phone-candidates.csv": "38e86ae05be889076df09ef747d4031014113cf3bc80c8829004bc1b6df748c5",
    "food-phone-review-candidates.csv": "1b3d03fe5d9600edb7088d63f38b8a0ad85fd4a64b77e97a00df8ccc290bfab0",
    "food-phone-additions.csv": "d6bc0233869cd37510bf90f25b17b7460b6df71df03613b0652e83d8e262161e",
}
EXCLUDED = {("komsco-phone-candidates.csv", 2802)}


def load_assignment(filename, variable):
    source = (ROOT / "static" / filename).read_text(encoding="utf-8")
    match = re.search(r"window\." + variable + r"=(.*);", source)
    if not match:
        raise ValueError(f"Missing {variable}")
    return json.loads(match.group(1))


def build_overlay():
    merchants = load_assignment("merchant-data.js", "DONGGURANG_MERCHANTS")
    base = load_assignment("merchant-phones.js", "DONGGURANG_PHONES")
    by_id = {item["id"]: item for item in merchants}
    reviewed_rows, skipped_rows, groups = [], [], {}
    for filename, expected_hash in REVIEWED.items():
        file = ROOT / "reports" / filename
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected_hash:
            raise ValueError(f"Reviewed CSV has changed; confirmation applies to the recorded snapshot: {filename}")
        with file.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                merchant_id = int(row["가맹점ID"])
                merchant = by_id.get(merchant_id)
                if not merchant or merchant["name"] != row["가맹점명"] or merchant["address"] != row["현재주소"]:
                    raise ValueError(f"Original merchant identity changed: {filename} ID {merchant_id}")
                record = {"file": filename, "merchantId": merchant_id, "row": row}
                if (filename, merchant_id) in EXCLUDED:
                    skipped_rows.append(record)
                    continue
                phone = row["후보전화번호"]
                if not re.fullmatch(r"\d{2,4}-\d{3,4}-\d{4}|1[568]\d{2}-\d{4}", phone):
                    raise ValueError(f"Invalid reviewed phone: ID {merchant_id}")
                reviewed_rows.append(record)
                entry = groups.setdefault(str(merchant_id), {"phones": [], "phoneSource": "사용자 확인 전화번호"})
                if phone not in entry["phones"]:
                    entry["phones"].append(phone)
    for merchant_id, entry in groups.items():
        for phone in base.get(merchant_id, {}).get("phones", [base.get(merchant_id, {}).get("phone")]):
            if phone and phone not in entry["phones"]:
                entry["phones"].append(phone)
        entry["phone"] = entry["phones"][0]
    summary = {
        "confirmedAt": "2026-10-04",
        "businessStatusAuthority": "사업자등록번호로 영업·폐업 여부를 확인한 기존 원 데이터",
        "csvHashes": REVIEWED,
        "basePhoneCount": len(base),
        "reviewedMerchantCount": len(groups),
        "newPhoneMerchantCount": len(set(groups) - set(base)),
        "phoneCount": len(set(groups) | set(base)),
        "totalMerchants": len(merchants),
        "reviewedPhoneCount": sum(len(item["phones"]) for item in groups.values()),
        "multiplePhoneMerchantCount": sum(len(item["phones"]) > 1 for item in groups.values()),
        "excluded": [{"file": file, "merchantId": merchant_id} for file, merchant_id in sorted(EXCLUDED)],
    }
    return groups, summary, reviewed_rows, skipped_rows


def main():
    overlay, summary, reviewed_rows, skipped_rows = build_overlay()
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if "--apply" not in sys.argv:
        return
    report = {**summary, "phones": overlay, "reviewedRows": reviewed_rows, "excludedRows": skipped_rows}
    (ROOT / "reports" / "reviewed-phone-connections.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "static" / "merchant-reviewed-phones.js").write_text(
        "/* User-confirmed public merchant phones. Business status uses original merchant data. */\n"
        + f"window.DONGGURANG_REVIEWED_PHONE_META={compact(summary)};\n"
        + f"window.DONGGURANG_REVIEWED_PHONES={compact(overlay)};\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
