"""Extract Dong-gu boundaries; no merchant data or coordinates are modified."""
import json
import urllib.request
from pathlib import Path

SOURCE = "https://raw.githubusercontent.com/vuski/admdongkor/d5d5a821c8de6cc337d47eeca604d7af76271c9b/ver20261001/HangJeongDong_ver20261001.geojson"
ATTRIBUTION = "본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다."

if __name__ == "__main__":
    with urllib.request.urlopen(SOURCE, timeout=120) as response:
        data = json.load(response)
    features = [f for f in data["features"] if f["properties"]["sgg"] == "12210"]
    assert len(features) == 13, "Expected Dong-gu's 13 administrative dongs"
    for feature in features:
        p = feature["properties"]
        feature["properties"] = {"code": p["adm_cd2"], "name": p["adm_nm"].split()[-1]}
    output = {"type": "FeatureCollection", "source": SOURCE, "date": "2026-10-01",
              "attribution": ATTRIBUTION, "features": features}
    target = Path(__file__).resolve().parents[1] / "static/dong-boundaries.js"
    target.write_text("window.DONGGURANG_BOUNDARIES=" + json.dumps(output, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"Wrote {len(features)} administrative dongs to {target}")
