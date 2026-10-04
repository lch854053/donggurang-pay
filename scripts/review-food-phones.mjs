import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { normalizePhone } from './import-merchant-phones.mjs';
import { csvText, roadAddress } from './export-phone-candidates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const services = { general_restaurants: '일반음식점', rest_cafes: '휴게음식점', bakeries: '제과점영업' };
const compact = (value) => String(value || '').normalize('NFKC').replace(/[\s,]/g, '').toLocaleLowerCase('ko-KR');
const addressKey = (value) => compact(String(value || '').replace(/^전남광주통합특별시|^광주광역시|^광주(?=\s)/, '광주'));

async function fetchPage(service, page) {
  const key = process.env.MOIS_SERVICE_KEY;
  if (!key) throw new Error('MOIS_SERVICE_KEY를 .env에 설정하세요.');
  const url = new URL(`https://apis.data.go.kr/1741000/${service}/info`);
  url.search = new URLSearchParams({ serviceKey: key, pageNo: String(page), numOfRows: '100', returnType: 'JSON',
    'cond[OPN_ATMY_GRP_CD::EQ]': '5805000' });
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(60000) }); }
  catch { throw new Error(`${service} ${page}페이지 연결 실패`); }
  if (!response.ok) throw new Error(`${service} HTTP ${response.status}`);
  let json;
  try { json = await response.json(); } catch { throw new Error(`${service} JSON 응답 아님`); }
  const result = json.response;
  if (String(result?.header?.resultCode) !== '0') throw new Error(`${service} API 오류 ${result?.header?.resultCode || 'unknown'}`);
  const body = result.body, rows = body?.items?.item;
  if (!Array.isArray(rows) || !Number.isInteger(body.totalCount) || Number(body.pageNo) !== page) throw new Error(`${service} 응답 형식 오류`);
  return { rows, total: body.totalCount };
}

async function download(service) {
  const first = await fetchPage(service, 1), rows = [...first.rows];
  if (!first.total) throw new Error(`${service} 조회 결과 0건. 자치단체코드를 확인하세요.`);
  for (let page = 2; rows.length < first.total && page <= 200; page++) {
    const result = await fetchPage(service, page);
    if (result.total !== first.total || !result.rows.length) throw new Error(`${service} 조회 중 건수 변경 또는 페이지 누락`);
    rows.push(...result.rows);
  }
  if (rows.length !== first.total || new Set(rows.map((row) => row.MNG_NO)).size !== rows.length ||
    rows.some((row) => row.OPN_ATMY_GRP_CD !== '5805000')) throw new Error(`${service} 전체 페이지/중복/지역 검증 실패`);
  console.log(`${services[service]} 전체 ${rows.length}건 조회 완료`);
  return { service, fetchedAt: new Date().toISOString(), municipalityCode: '5805000', rows };
}

export function reviewFoodPhones(merchants, phones, datasets, previousReasons = {}) {
  const records = datasets.flatMap((dataset) => dataset.rows.map((row) => ({ service: dataset.service, ...row })));
  const active = records.filter((row) => row.SALS_STTS_CD === '01' && row.DTL_SALS_STTS_CD === '01' &&
    !row.CLSBIZ_YMD && row.OPN_ATMY_GRP_CD === '5805000' &&
    /^광주(?:광역시)?\s+동구\s|^전남광주통합특별시\s+동구\s/.test(row.ROAD_NM_ADDR || ''));
  const byName = new Map();
  for (const row of active) {
    const key = compact(row.BPLC_NM);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  const additions = [], candidates = [], existingDifferences = [];
  for (const merchant of merchants) {
    const rows = [...new Set([merchant.name, ...(merchant.nameAliases || [])].map(compact))]
      .flatMap((name) => byName.get(name) || []).filter((row) => normalizePhone(row.TELNO));
    const exact = rows.filter((row) => addressKey(row.ROAD_NM_ADDR) === addressKey(merchant.address));
    const numbers = [...new Set(exact.map((row) => normalizePhone(row.TELNO)))];
    for (const row of rows) {
      const fullMatch = exact.includes(row);
      if (!fullMatch && (!roadAddress(merchant.address) || roadAddress(merchant.address) !== roadAddress(row.ROAD_NM_ADDR))) continue;
      const phone = normalizePhone(row.TELNO);
      const entry = { id: merchant.id, name: merchant.name, address: merchant.address, existingPhone: phones[merchant.id]?.phone || '',
        previousReason: previousReasons[merchant.id] || '',
        source: services[row.service], candidateName: row.BPLC_NM, candidateAddress: row.ROAD_NM_ADDR, phone,
        status: row.SALS_STTS_NM, detailStatus: row.DTL_SALS_STTS_NM, modifiedAt: row.LAST_MDFCN_PNT,
        updatedAt: row.DAT_UPDT_PNT, managementNo: row.MNG_NO,
        decision: (fullMatch ? numbers.length === 1 ? '상호·상세주소 일치 / 단일 번호' : '상세주소 일치 / 번호 충돌' : '상호·도로명·건물번호 일치 / 상세주소 검토 필요') +
          (previousReasons[merchant.id] === 'conflicting_phones' ? ' / 조폐공사 번호 충돌 이력 확인 필요' :
            previousReasons[merchant.id] === 'inactive' ? ' / 조폐공사와 영업·등록 상태 차이 확인 필요' : '') };
      if (phones[merchant.id]) {
        if (fullMatch && phones[merchant.id].phone !== phone) existingDifferences.push(entry);
      } else if (fullMatch && numbers.length === 1) additions.push(entry);
      else candidates.push(entry);
    }
  }
  const summary = Object.fromEntries(datasets.map((dataset) => [dataset.service, { name: services[dataset.service],
    fetchedAt: dataset.fetchedAt, totalRows: dataset.rows.length,
    activeRows: active.filter((row) => row.service === dataset.service).length,
    activeValidPhoneRows: active.filter((row) => row.service === dataset.service && normalizePhone(row.TELNO)).length,
    additionalMerchants: new Set(additions.filter((row) => row.source === services[dataset.service]).map((row) => row.id)).size }]));
  return { summary, additions, candidates, existingDifferences };
}

async function main() {
  const cached = process.argv.includes('--cached');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const datasets = await Promise.all(Object.keys(services).map(async (service) => {
    const filename = path.join(root, `data/mois-${service}.json`);
    if (cached) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const dataset = await download(service);
    fs.writeFileSync(filename, JSON.stringify(dataset));
    return dataset;
  }));
  const context = { window: {} };
  for (const filename of ['merchant-data.js', 'merchant-phones.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, 'static', filename), 'utf8'), context);
  }
  const previousReport = JSON.parse(fs.readFileSync(path.join(root, 'reports/merchant-phones.json'), 'utf8'));
  const previousReasons = Object.fromEntries(previousReport.results.map((item) => [item.id, item.reason]));
  const review = reviewFoodPhones(context.window.DONGGURANG_MERCHANTS, context.window.DONGGURANG_PHONES, datasets, previousReasons);
  const headers = ['가맹점ID', '가맹점명', '현재주소', '현재전화번호', '기존조폐공사제외사유', '출처API', '인허가사업장명', '인허가도로명주소',
    '후보전화번호', '영업상태', '상세영업상태', '원본최종수정일', '데이터갱신일', '관리번호', '검토결과'];
  const fields = ['id', 'name', 'address', 'existingPhone', 'previousReason', 'source', 'candidateName', 'candidateAddress', 'phone',
    'status', 'detailStatus', 'modifiedAt', 'updatedAt', 'managementNo', 'decision'];
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  for (const [key, filename] of [['additions', 'food-phone-additions.csv'], ['candidates', 'food-phone-review-candidates.csv'],
    ['existingDifferences', 'food-phone-existing-differences.csv']]) {
    fs.writeFileSync(path.join(root, 'reports', filename), csvText(headers, review[key].map((row) => fields.map((field) => row[field]))));
  }
  const totals = { existingPhoneCount: Object.keys(context.window.DONGGURANG_PHONES).length,
    additionalMerchants: new Set(review.additions.map((row) => row.id)).size,
    candidateMerchants: new Set(review.candidates.map((row) => row.id)).size,
    existingDifferentMerchants: new Set(review.existingDifferences.map((row) => row.id)).size };
  fs.writeFileSync(path.join(root, 'reports/food-phone-api-review.json'), JSON.stringify({ totals, ...review }, null, 2) + '\n');
  console.log(JSON.stringify({ totals, services: review.summary }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
