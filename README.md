# 동구랑페이 가맹점 지도

광주 동구 지역화폐 동구랑페이 가맹점을 지도에서 쉽게 검색할 수 있도록 만든 서비스입니다.

## 주요 기능

- 동구랑페이 가맹점 지도
- 상호명·주소·업종 검색 및 업종 필터
- 현재 위치 기반 가까운 가맹점 탐색
- 가맹점 전화번호
- 주민 정보 수정 요청
- 관리자 엑셀 업로드·변경분 비교·선택 승인·변경 이력

## 서비스

공개 지도: https://lch854053.github.io/donggurang-pay/

관리자는 별도 API 서버의 `/admin`에서 운영합니다. 주민 수정 요청은 API 서버 연결 후 사용할 수 있으며, 서버 장애 시에도 정적 지도는 이용할 수 있습니다.

## 기술

- Leaflet · GitHub Pages
- FastAPI · Python · openpyxl
- SQLite (서버 영구 저장소)
- 카카오 주소 검색 · 국세청 사업자 상태조회

## 데이터

현재 공개 지도는 2026년 9월 7일 기준 명단을 정제한 가맹점 3,762개와 확인된 공개 전화번호를 사용합니다. 신규·변경·지도 제외는 관리자 승인 후 반영하며, 사업자등록번호와 업로드 원본은 공개 데이터에 포함하지 않습니다.

## 개발

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --env-file .env
```

지도: `http://127.0.0.1:8000/` · 관리자: `http://127.0.0.1:8000/admin`

검증: `pytest -q` · `node --test tests/*.test.*` · `node scripts/validate-public-data.mjs`

## 관리자

`.env.example`을 `.env`로 복사하고 `ADMIN_KEY`, `DATA_DIR`, `NTS_SERVICE_KEY`, `KAKAO_REST_API_KEY`를 서버에 설정합니다. 로컬 HTTP 테스트는 `ADMIN_COOKIE_SECURE=false`, 운영은 HTTPS와 `ADMIN_COOKIE_SECURE=true`를 사용합니다.

GitHub Pages의 수정 요청 연결은 저장소 변수 `PUBLIC_API_BASE_URL`에 **공개 HTTPS API URL만** 지정합니다. 자동 배포 PR 생성에는 서버의 `GITHUB_PUBLISH_TOKEN`이 필요합니다. 키·토큰은 Pages 설정 파일에 넣지 않습니다.

최초 원본 연결, 월별 갱신, 주민 요청 처리, 서버 배치·백업·배포 절차: **[관리자 운영 매뉴얼](docs/ADMIN.md)**
