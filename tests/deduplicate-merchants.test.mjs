import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deduplicateMerchants } from '../scripts/deduplicate-merchants.mjs';

const merchant = (id, overrides = {}) => ({ id, name: '우리상점', address: '광주 동구 동명로 1 101호', category: '일반한식', lat: 35.15, lng: 126.92, ...overrides });

test('merges exact shop identities while retaining category and name variants', () => {
  const items = [merchant(1), merchant(2, { name: '우리 상점', address: '광주 동구 동명로 1 101 호', category: '정 육 점' })];
  const result = deduplicateMerchants(items);
  assert.equal(result.removedCount, 1);
  assert.equal(result.merchants[0].id, 1);
  assert.equal(result.merchants[0].address, items[0].address);
  assert.deepEqual(result.merchants[0].categories, ['일반한식', '정 육 점']);
  assert.deepEqual(result.merchants[0].nameAliases, ['우리 상점']);
  assert.deepEqual(result.merges[0].records, items);
  assert.deepEqual(deduplicateMerchants(result.merchants).merchants, result.merchants);
  assert.equal(deduplicateMerchants(result.merchants).removedCount, 0);
});

test('does not merge different shops, units, floors, addresses, or conflicting/missing coordinates', () => {
  const items = [merchant(1), merchant(2, { name: '다른상점' }), merchant(3, { address: '광주 동구 동명로 1 102호' }),
    merchant(4, { address: '광주 동구 동명로 1 2층' }), merchant(5, { address: '광주 동구 동명로 1' }),
    merchant(6, { lat: 35.151 }), merchant(7, { lat: null }), merchant(8, { lat: null })];
  assert.equal(deduplicateMerchants(items).removedCount, 0);
});

test('fails closed if IDs in individually reviewed cases now refer to different shops', () => {
  assert.throws(() => deduplicateMerchants([merchant(178), merchant(1004)]), /Reviewed group no longer matches/);
});

test('published cleanup is reproducible from the complete audit, lossless for retained data, and idempotent', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../static/merchant-data.js', import.meta.url), 'utf8'), context);
  const published = JSON.parse(JSON.stringify(context.window.DONGGURANG_MERCHANTS));
  const audit = JSON.parse(fs.readFileSync(new URL('../reports/merchant-deduplication.json', import.meta.url), 'utf8'));
  const keptIds = new Set(audit.merges.map((group) => group.keptId));
  const original = [...published.filter((item) => !keptIds.has(item.id)), ...audit.merges.flatMap((group) => group.records)].sort((a, b) => a.id - b.id);
  // The historical deduplication audit predates the requested removal of ID 2936.
  assert.equal(original.length, audit.beforeCount - 1);
  assert.equal(audit.merges.length, 30);
  const result = deduplicateMerchants(original);
  assert.equal(result.removedCount, 35);
  assert.deepEqual(result.merchants, published);
  assert.equal(audit.afterCount - 1, published.length);
  assert.equal(deduplicateMerchants(published).removedCount, 0);
  assert.equal(published.filter((item) => item.name === '대한불교조계종증심사').length, 1);
  assert.deepEqual(published.find((item) => item.id === 178).categories, ['기타숙박업', '기타대인서비스']);
  // Explicitly different floors and incomplete addresses were excluded from merging.
  for (const ids of [[311, 3257], [248, 2244], [1618, 2274], [2001, 3825], [2622, 2632], [2677, 2712]]) {
    assert.ok(ids.every((id) => published.some((item) => item.id === id)));
  }
});
