import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, '');
// Individually reviewed address variants. Floor/unit information must agree;
// sharing a building coordinate alone is never sufficient for merging.
const reviewedGroups = [
  { ids: [178, 1004, 1005, 2099, 2222], name: '대한불교조계종증심사',
    addresses: ['광주 동구 증심사길 177 (운림동)', '광주 동구 증심사길 177 증심사 (운림동)'],
    reason: '동일 사찰 주소에 사찰명만 추가 기재' },
  { ids: [188, 2138], name: '더치앤더치',
    addresses: ['광주 동구 예술길 34 ,1층 (대의동)', '광주 동구 예술길 34 (대의동,1층)'],
    reason: '동일 주소 1층의 괄호·쉼표 위치 차이' },
  { ids: [281, 302, 2225], name: '아이멘토학원',
    addresses: ['광주 동구 밤실로30번길 6 ,2층 (지산동)', '광주 동구 밤실로30번길 6 2층 (지산동)'],
    reason: '동일 주소 2층의 공백·쉼표 차이' },
  { ids: [487, 2115], name: '주식회사 로제타트래블',
    addresses: ['광주 동구 서석로 5 (불로동,지하1층)', '광주 동구 서석로 5 (불로동)지하1층'],
    reason: '동일 주소 지하1층의 괄호 위치 차이' },
  { ids: [3040, 3044], name: '주식회사이화원',
    addresses: ['광주 동구 서석로 51 (금남로1가)3층', '광주 동구 서석로 51 3층 (금남로1가)'],
    reason: '동일 주소 3층의 괄호 위치 차이' },
  { ids: [3817, 3818], name: '목재문화카페',
    addresses: ['광주 동구 경양로 310 1층 동구목재문화센터 (산수동)', '광주 동구 경양로 310 1층 (산수동)'],
    reason: '동일 주소 1층에 건물명만 추가 기재' }
];

export function deduplicateMerchants(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (byId.size !== items.length) throw new Error('Duplicate source IDs; audit requires unique IDs');
  const reviewedById = new Map();
  for (const group of reviewedGroups) {
    const records = group.ids.map((id) => byId.get(id)).filter(Boolean);
    if (records.length < 2) continue;
    const first = records[0];
    if (records.some((item) => normalize(item.name) !== normalize(group.name) ||
      !group.addresses.some((address) => normalize(address) === normalize(item.address)) ||
      !Number.isFinite(item.lat) || !Number.isFinite(item.lng) ||
      item.lat !== first.lat || item.lng !== first.lng ||
      !item.geocode_address || normalize(item.geocode_address) !== normalize(first.geocode_address))) {
      throw new Error(`Reviewed group no longer matches source: ${group.name}`);
    }
    records.forEach((item) => reviewedById.set(item.id, group));
  }

  const groups = new Map();
  for (const item of items) {
    const reviewed = reviewedById.get(item.id);
    const valid = normalize(item.name) && normalize(item.address) && Number.isFinite(item.lat) && Number.isFinite(item.lng);
    const key = reviewed ? `reviewed:${reviewed.ids[0]}` : valid
      ? JSON.stringify([normalize(item.name), normalize(item.address), item.lat, item.lng])
      : `unverified:${item.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const merchants = [], merges = [];
  for (const records of groups.values()) {
    const kept = { ...records[0] };
    if (records.length > 1) {
      const categories = [...new Map(records.flatMap((item) => [item.category, ...(item.categories || [])])
        .map((category) => [normalize(category), category])).values()];
      if (categories.length > 1) kept.categories = categories;
      const aliases = [...new Set(records.flatMap((item) => [item.name, ...(item.nameAliases || [])]))]
        .filter((name) => name !== kept.name);
      if (aliases.length) kept.nameAliases = aliases;
      merges.push({ keptId: kept.id, reason: reviewedById.get(kept.id)?.reason || '상호명·상세주소(공백 제외)·좌표 일치', records });
    }
    merchants.push(kept);
  }
  return { merchants, merges, removedCount: items.length - merchants.length };
}

function main() {
  const sourcePath = path.join(root, 'static/merchant-data.js');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { timeout: 3000 });
  const items = sandbox.window.DONGGURANG_MERCHANTS;
  const result = deduplicateMerchants(items);
  console.log(`검토 ${result.merges.length}개 가맹점, 중복 ${result.removedCount}건, ${items.length} → ${result.merchants.length}건`);
  if (!process.argv.includes('--apply') || !result.removedCount) return;
  const report = { beforeCount: items.length, afterCount: result.merchants.length, removedCount: result.removedCount, merges: result.merges };
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/merchant-deduplication.json'), JSON.stringify(report, null, 2) + '\n');
  const metadata = { ...sandbox.window.DONGGURANG_DATA_META, count: result.merchants.length, deduplicatedRecords: result.removedCount };
  fs.writeFileSync(sourcePath,
    '/* Generated from merchant business addresses via Kakao address search. No API key is included. */\n' +
    `window.DONGGURANG_DATA_META=${JSON.stringify(metadata)};\n` +
    `window.DONGGURANG_MERCHANTS=${JSON.stringify(result.merchants)};\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
