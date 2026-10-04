# 동구랑페이 가맹점 지도

Leaflet 기반 모바일 친화 가맹점 지도와 FastAPI 기반 가맹점 관리 API입니다. API 없이 `static/index.html`을 열어도 제공된 2026년 9월 7일 기준 명단에서 폐업자 235곳, 위치 미확인 6곳과 확실한 중복 35건을 제외한 광주 동구 가맹점 3,762개의 자료로 화면을 확인할 수 있습니다. 카드사 업종명은 화면에서 분식·마트·악기 등 익숙한 명칭으로 표시합니다.

## 제공 기능

- 세로 목록과 접힘·기본·크게 펼침 3단 높이를 지원하는 모바일 바텀시트, 데스크톱 2단형 반응형 지도
- 현재 위치, 현재 지도 영역, 상호명·주소, 업종, 거리 검색
- VWorld 지도 타일과 카카오 주소 좌표 변환
- 검색창 아래 아이콘형 업종 선택 (자동차·오토바이·반려동물 관련은 기타 업종)
- 지도 마커 선택 시 팝업 대신 가맹점 목록에 정보 표시, 최대 확대 클러스터 선택 시 포함된 가맹점 전체 표시
- 마커 클러스터링 및 가맹점 카드 연동, 전체 목록으로 돌아가기와 가맹점 더 보기
- `.xlsx`·`.csv` 전체 교체 업로드와 관리자 키 인증
- 허용된 5개 컬럼만 저장하는 화이트리스트 방식
- 주민등록번호, 휴대전화, 유선전화, 이메일 패턴 탐지 시 전체 업로드 차단
- 국세청 API를 이용한 주 1회 사업자 상태 확인 및 폐업 가맹점 검색 제외
- 제공된 엑셀의 `사업자 상태`가 `폐업자`인 가맹점은 정적 지도에서도 제외

## 바로 미리보기

`preview.bat`을 실행하거나 `static/index.html`을 브라우저에서 엽니다. CDN에서 Leaflet과 VWorld 지도 타일을 불러오므로 인터넷 연결이 필요합니다. 가맹점 사업장 주소를 카카오 주소검색 API로 사전 지오코딩하여 생성한 좌표를 사용하며, 위치를 확인할 수 없는 6곳은 공개 명단에서 제외했습니다. 제외 내역은 `excluded-merchants.csv`에 기록되어 있습니다.

원본 명단의 폐업 상태를 최초 반영할 때는 `uv run --with openpyxl python scripts/apply-merchant-status.py "명단.xlsx"`를 실행합니다. 스크립트는 상호명·주소·업종·행 순서가 기존 공개 자료와 정확히 일치할 때만 폐업자를 제거하고 좌표를 보존합니다. 원본 엑셀은 저장소에 복사하지 않습니다.

모바일 시범 화면은 `mobile-preview.bat`을 실행하거나 `static/mobile-preview.html`을 엽니다. 390×844 화면과 운영 자료에서 분리된 테스트 가맹점 12개로 검색, 필터, 지도 이동을 확인할 수 있습니다. 서버 실행 중에는 `http://127.0.0.1:8000/mobile-preview`에서도 확인할 수 있습니다.

## 공개 지도 배포

- 저장소: https://github.com/lch854053/donggurang-pay
- 공개 지도: https://lch854053.github.io/donggurang-pay/
- 모바일 시범 화면: https://lch854053.github.io/donggurang-pay/mobile-preview.html

`main` 브랜치에 푸시하면 GitHub Actions가 `static/`의 공개 지도 파일을 GitHub Pages에 배포합니다. 페이지는 2026년 9월 7일 기준 가맹점 자료와 사전 생성된 주소별 좌표를 정적으로 표시합니다. 관리자 업로드 및 사업자 상태 갱신 API는 GitHub Pages에서 실행되지 않으며, FastAPI 서버를 별도로 실행해야 사용할 수 있습니다. Pages 배포와 브라우저 실행에는 카카오 API 키가 필요하지 않습니다.

## 정적 지도 좌표 재생성

### 공개 가맹점 중복 정리

`node scripts/deduplicate-merchants.mjs`로 중복 건수를 검토하고, `--apply`를 붙이면 정적 자료에 반영합니다. 상호명·상세주소의 공백만 정규화하고 좌표까지 일치하는 행을 병합합니다. 층·호수를 제거하거나 같은 건물의 좌표만으로 병합하지 않으며, 주소 표기 위치 차이는 스크립트에 명시된 개별 검토 사례만 허용합니다.

대표 행의 ID·주소·좌표는 유지합니다. 업종이 다른 중복은 `categories`에 모두 보존해 각 업종 필터와 검색에서 찾을 수 있고, 공백 표기가 다른 상호명은 `nameAliases`로 보존합니다. 2026년 10월 4일 정리한 30개 가맹점의 원본 행과 병합 사유는 `reports/merchant-deduplication.json`에 기록했습니다. 중복 없이 다시 실행하면 자료와 보고서를 변경하지 않습니다.

### 좌표 갱신

Node.js 20 이상에서 실행합니다. `.env`는 Git에 포함되지 않으며, `.env.example`의 `KAKAO_REST_API_KEY` 변수에 발급받은 키를 설정합니다. **기존 좌표나 운영 DB 좌표는 읽어서 재사용하지 않습니다.** 원본 가맹점의 `address`만 사용하여 고유 주소별로 다시 조회합니다.

```powershell
Copy-Item .env.example .env
# .env에서 KAKAO_REST_API_KEY=... 설정 후
node scripts/rebuild-merchant-coordinates.mjs
```

macOS/Linux에서는 `KAKAO_REST_API_KEY=... node scripts/rebuild-merchant-coordinates.mjs`도 가능합니다. 스크립트는 4개 작업자로 카카오 주소 검색을 수행하고 일시적 장애에 재시도합니다. 성공한 좌표만 `static/merchant-data.js`에 기록하며, 실패/의심 주소의 좌표는 `null`로 저장합니다. 원본 표시 주소는 보존합니다. `data/geocode-failures.json`, `data/geocode-suspicious.json`, `data/geocode-report.json`에 검토 자료와 통계·지역별 표본·동일 좌표 상위 20개를 기록합니다. `data/`는 Git에서 제외됩니다. 공개 배포에 새로운 결과를 반영하려면 재생성된 `static/merchant-data.js`를 별도로 커밋해야 합니다.

동일 건물의 여러 가맹점은 주소 좌표가 같을 수 있습니다. 의심 결과는 수동 확인 후 원본 주소를 바로잡고 다시 실행하세요. API 키는 브라우저나 생성된 JS 파일에 포함되지 않습니다.

## API 서버 실행

Python 3.11 이상에서 실행합니다.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

`.env`의 값을 현재 셸 환경변수로 적용한 후 서버를 실행합니다. FastAPI 자체는 `.env` 파일을 자동으로 읽지 않으므로 배포 플랫폼의 환경변수 설정을 사용하거나 아래처럼 지정합니다.

```powershell
$env:ADMIN_KEY="충분히-긴-관리자-비밀키"
$env:VWORLD_API_KEY="발급받은-VWorld-키"
$env:KAKAO_REST_API_KEY="발급받은-카카오-REST-키"
$env:NTS_SERVICE_KEY="공공데이터포털-서비스키"
uvicorn app.main:app --reload
```

- 지도: `http://127.0.0.1:8000`
- 관리자 업로드: `http://127.0.0.1:8000/admin`
- API 문서: `http://127.0.0.1:8000/docs`
- 상태 확인: `http://127.0.0.1:8000/health`

VWorld 키가 없으면 VWorld 공개 기본지도를 사용하고, 키가 있으면 인증형 WMTS 주소를 사용합니다. 카카오 키가 없으면 기존에 좌표가 저장된 주소는 유지되지만 신규 주소는 지도에 표시되지 않으며 업로드 결과의 `geocode_failed`에 집계됩니다.

## 엑셀·CSV 처리 규칙

필수 컬럼은 다음 5개입니다.

```text
사업자번호, 가맹점번호, 가맹점명, 사업장주소, 가맹점업종명
```

원본 파일의 `대표자명`, `휴대전화번호` 컬럼은 메모리에 읽힌 직후 폐기하며 저장하거나 로그에 남기지 않습니다. 두 컬럼을 제외한 원본의 모든 셀은 개인정보 패턴을 검사합니다. 따라서 가맹점명이나 주소 등 다른 컬럼에 전화번호·주민등록번호·이메일이 섞여 있으면 업로드 전체를 차단합니다.

선택 컬럼 `사업자 상태`가 있으면 `폐업`으로 표시된 행은 업로드에서 제외하고, 나머지 행의 상태는 저장합니다. `폐업일` 컬럼도 입력받을 수 있지만 저장하지 않습니다. 업로드에 상태 컬럼이 없으면 기존 사업자 상태를 유지합니다.

업로드는 스냅샷 방식입니다. 모든 행의 검증과 주소 변환이 끝난 뒤 하나의 트랜잭션에서 기존 목록을 교체하므로, 검증에 실패한 파일은 기존 데이터에 영향을 주지 않습니다. 원본 엑셀·CSV 파일 자체는 서버에 저장하지 않습니다.

CSV는 UTF-8과 CP949 인코딩을 지원합니다. 빈 행과 필수 5개 컬럼이 모두 빈 오류 행은 건너뛰며, 나머지 행에는 엑셀과 동일한 검증 규칙을 적용합니다.

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/admin/upload" `
  -H "X-Admin-Key: 충분히-긴-관리자-비밀키" `
  -F "file=@가맹점.xlsx"
```

## 테스트

```powershell
pip install -r requirements-dev.txt
pytest
```

## 운영 전 확인

- HTTPS 역방향 프록시 뒤에서 실행하고 관리자 경로에 기관 인증 또는 VPN 접근 제어를 추가하세요.
- `ADMIN_KEY`는 소스나 엑셀에 넣지 말고 비밀 저장소에서 주입하세요.
- VWorld 허용 도메인, 카카오 플랫폼 도메인, 공공데이터포털 활용 신청 상태를 확인하세요.
- SQLite 파일이 있는 `DATA_DIR`를 정기 백업하고 서버 계정 외 파일 접근 권한을 제한하세요.
- 다중 서버 인스턴스로 확장할 때는 SQLite를 PostgreSQL로 교체하고 주간 작업을 별도 스케줄러로 단일 실행하세요.
