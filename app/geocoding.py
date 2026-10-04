"""Server equivalent of the existing conservative coordinate script's validation."""
import math
import re


def validate_document(document: dict, address: str) -> bool:
    try:
        lat, lng = float(document["y"]), float(document["x"])
        if not math.isfinite(lat + lng) or not (35.08 <= lat <= 35.19 and 126.88 <= lng <= 127.01):
            return False
        text = " ".join(str(d.get("address_name", "")) for d in (document, document.get("road_address") or {}, document.get("address") or {}))
        if not re.search(r"(광주광역시|전남광주통합특별시|광주)\s*동구", text):
            return False
        expected = re.search(r"동구\s+([가-힣0-9]+(?:대로|로|길))(\s+지하)?\s*(\d+(?:-\d+)?)(?=\s|$|\(|,)", address)
        if expected:
            road = document.get("road_address") or {}
            number = str(road.get("main_building_no", ""))
            if road.get("sub_building_no") not in (None, "", "0"):
                number += "-" + str(road["sub_building_no"])
            return road.get("road_name", "").replace(" ", "") == expected[1] and number == expected[3] and (not expected[2] or road.get("underground_yn") == "Y")
        expected = re.search(r"동구\s+([가-힣0-9]+(?:동|가))\s+(\d+(?:-\d+)?)(?=\s|번지|$|,|\()", address)
        if expected:
            lot = document.get("address") or {}
            number = str(lot.get("main_address_no", ""))
            if lot.get("sub_address_no") not in (None, "", "0"):
                number += "-" + str(lot["sub_address_no"])
            normalize = lambda value: re.sub(r"([가-힣]+)\d+동$", r"\1동", value)
            return normalize(lot.get("region_3depth_name", "")) == normalize(expected[1]) and number == expected[2]
        return False
    except (KeyError, TypeError, ValueError, AttributeError):
        return False
