import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { normalizePhone } from './import-merchant-phones.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compact = (value) => String(value || '').normalize('NFKC').replace(/[\s,]/g, '');
const nameKey = (value) => compact(value).replace(/주식회사|유한회사|㈜|\(주\)/g, '').replace(/[()（）.:：&＆-]/g, '').toLocaleLowerCase('ko-KR');
const addressKey = (value) => compact(String(value || '').replace(/^전남광주통합특별시|^광주광역시|^광주(?=\s)/, '광주'));
export function roadAddress(value) {
  const text = String(value || '').normalize('NFKC');
  const match = text.match(/동구\s+([가-힣a-zA-Z0-9·]+(?:대로|로|길))\s*(지하\s*)?(\d+(?:-\d+)?)(?=\s|$|\(|,)/);
  return match ? `${match[1]}|${match[2] ? '지하' : ''}|${match[3]}` : null;
}

function similarName(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  const table = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) table[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return table[a.length][b.length] <= 1;
}

export function phoneCandidates(merchants, phones, rows, reasons) {
  const byRoad = new Map();
  const phoneUsage = new Map();
  for (const row of rows) {
    const phone = normalizePhone(row.frcs_rprs_telno);
    if (phone) {
      if (!phoneUsage.has(phone)) phoneUsage.set(phone, new Set());
      phoneUsage.get(phone).add(compact(row.frcs_nm));
    }
  }
  for (const row of rows) {
    const address = `${row.frcs_addr || ''} ${row.frcs_dtl_addr || ''}`.trim();
    const road = roadAddress(address), phone = normalizePhone(row.frcs_rprs_telno);
    if (!road || !phone || !['12210', '29110'].includes(row.usage_rgn_cd) ||
      !/^광주(?:광역시)?\s+동구\s|^전남광주통합특별시\s+동구\s/.test(address) ||
      row.bzmn_stts !== '01' || !['01', '02'].includes(row.frcs_reg_se)) continue;
    if (!byRoad.has(road)) byRoad.set(road, []);
    byRoad.get(road).push({ row, address, phone });
  }
  const candidates = new Map();
  for (const merchant of merchants) {
    if (phones[merchant.id]) continue;
    for (const { row, address, phone } of byRoad.get(roadAddress(merchant.address)) || []) {
      const aliases = [merchant.name, ...(merchant.nameAliases || [])];
      const exactName = aliases.some((name) => compact(name) === compact(row.frcs_nm));
      const notationName = aliases.some((name) => nameKey(name) === nameKey(row.frcs_nm));
      if (!exactName && !notationName && !aliases.some((name) => similarName(nameKey(name), nameKey(row.frcs_nm)))) continue;
      const exactAddress = addressKey(merchant.address) === addressKey(address);
      const key = JSON.stringify([merchant.id, row.frcs_nm, address, phone, row.pvsn_inst_cd]);
      if (candidates.has(key)) {
        const entry = candidates.get(key);
        entry.sourceCount++;
        entry.sourceDate = [entry.sourceDate, row.crtr_ymd || ''].sort().at(-1);
        continue;
      }
      candidates.set(key, { id: merchant.id, name: merchant.name, address: merchant.address,
        previousReason: reasons[merchant.id] || '', candidateName: row.frcs_nm, candidateAddress: address, phone,
        nameComparison: exactName ? '상호 일치(공백 제외)' : notationName ? '법인·기호 표기 차이' : '상호 1글자 차이',
        addressComparison: exactAddress ? '상세주소 일치' : '도로명·건물번호 일치 / 상세주소 차이',
        review: [!exactName && !notationName ? '상호가 다르므로 동일 업체인지 확인' : '',
          exactAddress ? '기존 번호 충돌·제외 사유 확인' : '층·호수·건물명·괄호 위치 확인 필요',
          (phoneUsage.get(phone)?.size || 0) >= 10 ? '동일 번호가 10개 이상 상호에 등록됨: 대표/임시번호 여부 확인' : '',
          /^0(?:2|3\d|4\d|5\d|6\d)-/.test(phone) && !phone.startsWith('062-') ? '광주 외 지역번호: 확인 필요' : ''].filter(Boolean).join(' / '),
        sourceDate: row.crtr_ymd || '', provider: row.pvsn_inst_cd || '', sourceCount: 1 });
    }
  }
  return [...candidates.values()].sort((a, b) => a.id - b.id || a.phone.localeCompare(b.phone));
}

export function csvText(headers, rows) {
  const cell = (value) => {
    const text = String(value ?? '');
    return `"${(/^[=+@-]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

function main() {
  const context = { window: {} };
  for (const filename of ['merchant-data.js', 'merchant-phones.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, 'static', filename), 'utf8'), context);
  }
  const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/komsco-donggu.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/merchant-phones.json'), 'utf8'));
  const reasons = Object.fromEntries(report.results.map((item) => [item.id, item.reason]));
  const candidates = phoneCandidates(context.window.DONGGURANG_MERCHANTS, context.window.DONGGURANG_PHONES, dataset.rows, reasons);
  const headers = ['가맹점ID', '가맹점명', '현재주소', '기존제외사유', '조폐공사상호명', '조폐공사주소', '후보전화번호',
    '상호비교', '주소비교', '검토사항', '원본기준일', '제공기관', '중복원본행수'];
  const fields = ['id', 'name', 'address', 'previousReason', 'candidateName', 'candidateAddress', 'phone',
    'nameComparison', 'addressComparison', 'review', 'sourceDate', 'provider', 'sourceCount'];
  const filename = path.join(root, 'reports/komsco-phone-candidates.csv');
  fs.writeFileSync(filename, csvText(headers, candidates.map((item) => fields.map((field) => item[field]))));
  console.log(JSON.stringify({ file: filename, candidates: candidates.length, merchants: new Set(candidates.map((item) => item.id)).size,
    sourceFetchedAt: dataset.fetchedAt, note: '검토용 후보이며 자동 반영하지 않았습니다.' }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
