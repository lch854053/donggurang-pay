import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = 'https://apis.data.go.kr/B190001/localFranchisesV3/franchiseV3';
const sourceUrl = 'https://www.data.go.kr/data/15119539/openapi.do';
const normalize = (value) => String(value || '').normalize('NFKC')
  .replace(/^전남광주통합특별시|^광주광역시|^광주(?=\s)/, '광주').replace(/[\s,]/g, '');

export function normalizePhone(value) {
  const text = String(value || '').trim();
  if (!/^[\d\s()-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  const match = digits.match(/^(02)(\d{3,4})(\d{4})$/) ||
    digits.match(/^(0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4]))(\d{3,4})(\d{4})$/) ||
    digits.match(/^(0(?:10|11|16|17|18|19|70|80|50))(\d{3,4})(\d{4})$/) ||
    digits.match(/^(1[568]\d{2})(\d{4})$/);
  if (!match) return null;
  const subscriber = match.slice(2).join('');
  if (/^(\d)\1+$/.test(subscriber) || ['1234567', '12345678'].includes(subscriber)) return null;
  return match.slice(1).join('-');
}

export function matchPhones(merchants, rows) {
  const index = new Map();
  for (const row of rows) {
    if (!['12210', '29110'].includes(row.usage_rgn_cd)) continue;
    if (!/^광주(?:광역시)?\s+동구\s|^전남광주통합특별시\s+동구\s/.test(row.frcs_addr || '')) continue;
    const key = `${normalize(row.frcs_nm)}|${normalize(`${row.frcs_addr} ${row.frcs_dtl_addr || ''}`)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  const phones = {}, results = [];
  for (const merchant of merchants) {
    const candidates = [...new Set([merchant.name, ...(merchant.nameAliases || [])])]
      .flatMap((name) => index.get(`${normalize(name)}|${normalize(merchant.address)}`) || []);
    const active = candidates.filter((row) => row.bzmn_stts === '01' && ['01', '02'].includes(row.frcs_reg_se));
    const numbers = [...new Set(active.map((row) => normalizePhone(row.frcs_rprs_telno)).filter(Boolean))];
    // Even older, inactive records with another valid number make the match ambiguous.
    const allNumbers = [...new Set(candidates.map((row) => normalizePhone(row.frcs_rprs_telno)).filter(Boolean))];
    const reason = !candidates.length ? 'no_exact_match' : !active.length ? 'inactive' :
      !numbers.length ? 'missing_or_invalid_phone' : allNumbers.length > 1 ? 'conflicting_phones' : 'matched';
    if (reason === 'matched') {
      const sourceDates = [...new Set(active.filter((row) => normalizePhone(row.frcs_rprs_telno) === numbers[0])
        .map((row) => row.crtr_ymd).filter(Boolean))].sort();
      phones[merchant.id] = { phone: numbers[0], sourceDate: sourceDates.at(-1) || null };
    }
    results.push({ id: merchant.id, name: merchant.name, address: merchant.address, reason,
      ...(candidates.length ? { candidates: candidates.map((row) => ({ name: row.frcs_nm,
        address: `${row.frcs_addr} ${row.frcs_dtl_addr || ''}`.trim(), phone: normalizePhone(row.frcs_rprs_telno),
        status: row.bzmn_stts, registration: row.frcs_reg_se, sourceDate: row.crtr_ymd,
        provider: row.pvsn_inst_cd })) } : {}) });
  }
  return { phones, results };
}

async function download() {
  const key = process.env.KOMSCO_SERVICE_KEY;
  if (!key) throw new Error('KOMSCO_SERVICE_KEY를 .env에 설정하세요 (node --env-file=.env).');
  const rows = [];
  let expected;
  // The provider currently uses 12210 for Gwangju Dong-gu, not the legal code 29110.
  for (let page = 1; page <= 100; page++) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ serviceKey: key, page: String(page), perPage: '1000',
      'cond[usage_rgn_cd::EQ]': '12210', returnType: 'JSON' });
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(60000) }); }
    catch { throw new Error(`API ${page}페이지 연결 실패. 기존 공개 자료는 변경하지 않습니다.`); }
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);
    let result;
    try { result = await response.json(); } catch { throw new Error('API 응답이 JSON이 아닙니다. 인증/승인 상태를 확인하세요.'); }
    if (!Array.isArray(result.data) || !Number.isInteger(result.matchCount) || result.matchCount < 1 ||
      result.currentCount !== result.data.length || result.page !== page) throw new Error('API 응답 형식/건수를 확인하세요.');
    expected ??= result.matchCount;
    if (expected !== result.matchCount) throw new Error('조회 중 원본 건수가 변경되었습니다. 다시 조회하세요.');
    rows.push(...result.data);
    console.log(`API ${page}페이지: ${rows.length}/${expected}건`);
    if (rows.length === expected) return { fetchedAt: new Date().toISOString(), regionCode: '12210', rows };
    if (!result.data.length || rows.length > expected) break;
  }
  throw new Error('전체 페이지를 확보하지 못했습니다. 기존 공개 자료는 변경하지 않습니다.');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const cachePath = path.join(root, 'data/komsco-donggu.json');
  const dataset = args.has('--cached') ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : await download();
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'static/merchant-data.js'), 'utf8'), sandbox, { timeout: 3000 });
  const merchants = sandbox.window.DONGGURANG_MERCHANTS;
  const { phones, results } = matchPhones(merchants, dataset.rows);
  const counts = results.reduce((summary, item) => ({ ...summary, [item.reason]: (summary[item.reason] || 0) + 1 }), {});
  const metadata = { source: '한국조폐공사 통합 가맹점기본정보', sourceUrl, fetchedAt: dataset.fetchedAt,
    totalMerchants: merchants.length, phoneCount: Object.keys(phones).length, sourceRows: dataset.rows.length, counts };
  console.log(JSON.stringify(metadata, null, 2));
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  if (!args.has('--cached')) fs.writeFileSync(cachePath, JSON.stringify(dataset));
  if (!args.has('--apply')) return;
  if (!Object.keys(phones).length) throw new Error('연결 가능한 번호가 없습니다. 기존 공개 자료는 변경하지 않습니다.');
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/merchant-phones.json'), JSON.stringify({ ...metadata, results }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'static/merchant-phones.js'),
    '/* Public merchant phone numbers from KOMSCO. No API key is included. */\n' +
    `window.DONGGURANG_PHONE_META=${JSON.stringify(metadata)};\n` +
    `window.DONGGURANG_PHONES=${JSON.stringify(phones)};\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
