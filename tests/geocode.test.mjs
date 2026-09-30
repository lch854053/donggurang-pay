import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { queries, validate } from '../scripts/rebuild-merchant-coordinates.mjs';

test('normalizes only the lookup address and strips detailed shop information', () => {
  const address = '광주 동구 의재로 149-7 상가 303호 (운림동, 라인2차아파트)';
  assert.deepEqual(queries(address).slice(0, 2), [
    ['normalized_full', '광주광역시 동구 의재로 149-7 상가 303호'],
    ['normalized_road_address', '광주광역시 동구 의재로 149-7']
  ]);
  assert.equal(queries('전남광주통합특별시 동구 남문로622번길 20 1층')[1][1], '광주광역시 동구 남문로622번길 20');
});

test('rejects wrong road, building number, district and distant coordinates', () => {
  const address = '광주 동구 동명로 35 1층';
  const result = { address_name: '전남광주통합특별시 동구 동명로 35', x: '126.92', y: '35.15',
    road_address: { road_name: '동명로', main_building_no: '35', sub_building_no: '0' } };
  assert.equal(validate(result, address), null);
  assert.equal(validate({ ...result, road_address: { ...result.road_address, road_name: '무등로' } }, address), 'road_name_or_number_mismatch');
  assert.equal(validate({ ...result, address_name: '전남광주통합특별시 북구 동명로 35' }, address), 'district_mismatch');
  assert.equal(validate({ ...result, y: '36.1' }, address), 'outside_donggu_bbox');
});

test('published data has no locality-preview coordinates', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../static/merchant-data.js', import.meta.url), 'utf8'), context);
  const items = context.window.DONGGURANG_MERCHANTS;
  assert.equal(items.length, 3803);
  assert.equal(items.filter((item) => item.approximate === false && Number.isFinite(item.lat) && Number.isFinite(item.lng)).length, 3767);
  assert.equal(items.filter((item) => item.approximate === true && item.lat === null && item.lng === null).length, 36);
  assert.equal(context.window.DONGGURANG_DATA_META.coordinates, 'address-geocoded');
});
