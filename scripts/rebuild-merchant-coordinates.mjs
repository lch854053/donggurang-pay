import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const sourcePath = path.join(root, 'static', 'merchant-data.js');
const args = new Set(process.argv.slice(2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (address) => address.trim().replace(/^전남광주통합특별시|^광주광역시|^광주(?=\s+동구)/, '광주광역시').replace(/\s+/g, ' ');
const withoutParens = (address) => address.replace(/\s*\([^)]*\)/g, '').trim();
const roadParts = (address) => {
  const match = address.match(/동구\s+([가-힣0-9]+(?:대로|로|길))(\s+지하)?\s*(\d+(?:-\d+)?)(?=\s|$|\(|,)/);
  return match ? { road: match[1], underground: Boolean(match[2]), number: match[3] } : null;
};
const roadOnly = (address) => {
  const parts = roadParts(address);
  return parts ? `광주광역시 동구 ${parts.road}${parts.underground ? ' 지하' : ''} ${parts.number}` : null;
};

export function queries(address) {
  const normalized = normalize(address);
  const variants = [
    ['normalized_full', withoutParens(normalized)],
    ['normalized_road_address', roadOnly(normalized)],
    ['normalized_without_detail', withoutParens(normalized).replace(/(?:\s|,)+(?:\d+층|\d+호|상가\s*\d+호|\d+동\s*\d+호|[가-힣]+아파트)(?=\s|,|$).*$/, '').trim()],
    ['original', address.trim()]
  ];
  return variants.filter(([_, query], index) => query && variants.findIndex((v) => v[1] === query) === index);
}

function loadSource() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { timeout: 3000 });
  return [...sandbox.window.DONGGURANG_MERCHANTS];
}

function loadKey() {
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  }
  if (!process.env.KAKAO_REST_API_KEY) throw new Error('KAKAO_REST_API_KEY is required');
  return process.env.KAKAO_REST_API_KEY;
}

async function kakao(query, key, stats) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      stats.calls++;
      const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=5`;
      const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(10000) });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
        return { error: `http_${response.status}` };
      }
      if (!response.ok) throw new Error(`Kakao HTTP ${response.status}`);
      return { documents: (await response.json()).documents || [] };
    } catch (error) {
      if (attempt < 2 && (error.name === 'TimeoutError' || error.name === 'TypeError')) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return { error: error.name === 'TimeoutError' ? 'timeout' : 'network_or_api_error' };
    }
  }
}

// Kakao currently returns both '광주광역시' and '전남광주통합특별시' in address_name.
export function validate(document, input) {
  const text = [document.address_name, document.road_address?.address_name, document.address?.address_name].filter(Boolean).join(' ');
  if (!/(광주광역시|전남광주통합특별시|광주)\s*동구/.test(text)) return 'district_mismatch';
  const lat = Number(document.y), lng = Number(document.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 35.08 || lat > 35.19 || lng < 126.88 || lng > 127.01) return 'outside_donggu_bbox';
  const expected = roadParts(input);
  if (expected) {
    const actual = document.road_address;
    if (!actual || actual.road_name?.replace(/\s/g, '') !== expected.road ||
      (expected.underground && actual.underground_yn !== 'Y') ||
      `${actual.main_building_no}${actual.sub_building_no && actual.sub_building_no !== '0' ? '-' + actual.sub_building_no : ''}` !== expected.number) return 'road_name_or_number_mismatch';
  } else {
    const lot = input.match(/동구\s+([가-힣0-9]+(?:동|가))\s+(\d+(?:-\d+)?)(?=\s|번지|$|,|\()/);
    const legalDong = (value) => value?.replace(/([가-힣]+)\d+동$/, '$1동');
    if (lot && (legalDong(document.address?.region_3depth_name) !== legalDong(lot[1]) ||
      `${document.address?.main_address_no}${document.address?.sub_address_no && document.address?.sub_address_no !== '0' ? '-' + document.address?.sub_address_no : ''}` !== lot[2])) return 'lot_address_mismatch';
  }
  return null;
}

function saveJson(name, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2) + '\n');
}

async function main() {
  const merchants = loadSource();
  const originals = new Map(merchants.map((item) => [normalize(item.address), item.address]));
  const addresses = [...originals.keys()];
  if (args.has('--export-queries')) {
    saveJson('geocode-queries.json', addresses.map((address) => ({ address, queries: queries(originals.get(address)) })));
    console.log(`Exported ${addresses.length} unique normalized addresses`);
    return;
  }
  if (args.has('--export-pending')) {
    const responses = JSON.parse(fs.readFileSync(path.join(dataDir, 'geocode-responses.json'), 'utf8'));
    const pending = addresses.filter((address) => !queries(originals.get(address)).some(([_, query]) =>
      responses[query]?.documents?.some((document) => !validate(document, address))));
    const remaining = [...new Set(pending.flatMap((address) => queries(originals.get(address)).map(([_, query]) => query)))]
      .filter((query) => !responses[query] && query !== '광주광역시' && query !== '광주광역시 동구');
    saveJson('geocode-pending.json', remaining);
    console.log(`Unresolved addresses: ${pending.length}, remaining queries: ${remaining.length}`);
    return;
  }
  const replay = args.has('--from-responses');
  const key = replay ? null : loadKey();
  const responses = replay ? JSON.parse(fs.readFileSync(path.join(dataDir, 'geocode-responses.json'), 'utf8')) : {};
  const stats = { calls: 0, cacheHits: merchants.length - addresses.length };
  const results = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < addresses.length) {
      const address = addresses[cursor++];
      let result = null, suspicious = null, reason = 'missing_response';
      for (const [method, query] of queries(originals.get(address))) {
        const response = replay ? responses[query] : await kakao(query, key, stats);
        if (!response) continue;
        if (response.error) { reason = response.error; continue; }
        if (!response.documents?.length) { if (reason === 'missing_response') reason = 'no_result'; continue; }
        for (const document of response.documents) {
          const issue = validate(document, address);
          if (!issue) {
            result = { lat: Number(document.y), lng: Number(document.x), geocode_method: method, geocode_address: query };
            break;
          }
          suspicious ??= { reason: issue, geocode_address: query, candidate_address: document.address_name };
        }
        if (result) break;
      }
      results.set(address, result || suspicious || { reason, geocode_address: queries(originals.get(address))[0]?.[1] || address });
      if (results.size % 200 === 0) console.log(`Processed ${results.size}/${addresses.length}`);
      if (!replay) await sleep(100); // modest aggregate request rate with four workers
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  const failures = [], suspicious = [];
  const output = merchants.map((item) => {
    const found = results.get(normalize(item.address));
    const { lat: oldLat, lng: oldLng, approximate: oldApproximate, geocode_method: oldMethod,
      geocode_address: oldGeocodeAddress, ...original } = item;
    if (found.lat != null) return { ...original, ...found, approximate: false };
    const record = { id: item.id, name: item.name, address: item.address, normalized_address: normalize(item.address), ...found };
    (found.candidate_address ? suspicious : failures).push(record);
    return { ...original, lat: null, lng: null, approximate: true };
  });
  saveJson('geocode-failures.json', failures);
  saveJson('geocode-suspicious.json', suspicious);
  const successful = output.filter((item) => item.approximate === false);
  const distinct = new Map();
  for (const item of successful) {
    const coordinate = `${item.lat},${item.lng}`;
    distinct.set(coordinate, (distinct.get(coordinate) || 0) + 1);
  }
  const top = [...distinct].sort((a, b) => b[1] - a[1]).slice(0, 20);
  let seed = 4038;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const selected = [];
  for (const region of ['계림동', '산수동', '동명동', '지산동', '학동', '소태동', '용산동', '대인동', '충장로', '금남로']) {
    const matches = successful.filter((item) => `${item.address} ${item.locality || ''}`.includes(region));
    if (matches.length) selected.push(matches[Math.floor(random() * matches.length)]);
  }
  const shuffled = [...successful].sort(() => random() - 0.5);
  for (const item of shuffled) {
    if (selected.length >= 20) break;
    if (!selected.includes(item)) selected.push(item);
  }
  const report = { total: merchants.length, uniqueAddresses: addresses.length, success: successful.length, failed: failures.length,
    suspicious: suspicious.length, successRate: (100 * successful.length / merchants.length).toFixed(2) + '%',
    kakaoApiCalls: replay ? Object.keys(responses).length : stats.calls, cacheHits: stats.cacheHits,
    duplicateCoordinatesTop20: top, samples: selected
      .map(({ name, address, locality, geocode_address, lat, lng, geocode_method }) => ({ name, address, locality, geocode_address, lat, lng, geocode_method })) };
  saveJson('geocode-report.json', report);
  if (successful.length / merchants.length < 0.95) {
    throw new Error('Geocoding success below 95%; review reports before replacing merchant-data.js');
  }
  // Never publish any of the old locality-preview coordinates, even for failed lookups.
  const content = `/* Generated from merchant business addresses via Kakao address search. No API key is included. */\n` +
    `window.DONGGURANG_DATA_META=${JSON.stringify({ count: merchants.length, coordinates: 'address-geocoded' })};\n` +
    `window.DONGGURANG_MERCHANTS=${JSON.stringify(output)};\n`;
  fs.writeFileSync(sourcePath, content);
  console.log(JSON.stringify(report, null, 2));
  for (const [coordinate, count] of top) if (count >= 30) console.warn(`Review shared building coordinate ${coordinate}: ${count} merchants`);
  if (failures.length || suspicious.length) console.log(`Review ${failures.length} failures and ${suspicious.length} suspicious entries under data/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
