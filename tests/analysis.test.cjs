const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const context = vm.createContext({ window: {}, console });
  for (const file of ['analysis.js', 'dong-boundaries.js', 'merchant-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static', file), 'utf8'), context);
  }
  return context.window;
}

test('spatial join handles polygon holes, multipolygons, and missing coordinates', () => {
  const { DonggurangAnalysis: a } = setup();
  const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];
  const polygon = { type: 'Polygon', coordinates: [outer, hole] };
  assert.equal(a.inGeometry([3, 3], polygon), true);
  assert.equal(a.inGeometry([1.5, 1.5], polygon), false);
  assert.equal(a.inGeometry([5, 5], polygon), false);
  assert.equal(a.inGeometry([4, 3], polygon), true);
  assert.equal(a.inGeometry([3, 3], { type: 'MultiPolygon', coordinates: [[outer, hole]] }), true);
  const boundary = { features: [{ properties: { name: '테스트동' }, geometry: polygon }] };
  const result = a.assignDongs([{ lat: 3, lng: 3 }, { lat: null, lng: null }, { lat: 90, lng: 180 }], boundary);
  assert.deepEqual(Array.from(result, (m) => m.analysisDong), ['테스트동', '미분류', '미분류']);
});

test('published boundaries contain 13 dongs and preserve all merchants without mutating them', () => {
  const { DonggurangAnalysis: a, DONGGURANG_BOUNDARIES: b, DONGGURANG_MERCHANTS: merchants } = setup();
  assert.equal(b.features.length, 13);
  assert.equal(new Set(b.features.map((f) => f.properties.name)).size, 13);
  assert.ok(b.attribution.includes('SGIS'));
  const original = JSON.stringify(merchants);
  const joined = a.assignDongs(merchants, b);
  assert.equal(joined.length, merchants.length);
  assert.equal(JSON.stringify(merchants), original);
  assert.ok(joined.filter((m) => m.analysisDong !== '미분류').length > merchants.length * .95);
  const sample = joined.find((m) => m.name === '푸른할인마트');
  // The legal-dong address must not override the administrative boundary join.
  assert.equal(sample.locality, '동명동');
  assert.equal(sample.analysisDong, '충장동');
  assert.equal(a.counts(joined, 'analysisDong').reduce((sum, [, n]) => sum + n, 0), merchants.length);
});

test('grid bins preserve counts, ignore invalid coordinates, and stay fixed for a selected size', () => {
  const { DonggurangAnalysis: a } = setup();
  const items = [{ lat: 35.146, lng: 126.923 }, { lat: 35.146, lng: 126.923 }, { lat: 35.16, lng: 126.94 }, { lat: null, lng: 126.92 }];
  for (const size of [250, 500, 1000]) {
    const cells = a.gridCells(items, size);
    assert.equal(cells.reduce((sum, c) => sum + c.count, 0), 3);
    assert.deepEqual(a.gridCells(items.slice(0, 1), size)[0].bounds, cells[0].bounds);
  }
  assert.equal(a.gridCells([], 250).length, 0);
  assert.equal(a.validPoint({ lat: 100, lng: 126 }), false);
});

test('dong comparison uses each dong denominator and primary industry, not absolute shop totals', () => {
  const { DonggurangAnalysis: a } = setup();
  const items = [
    { analysisDong: 'A동', group: '음식점·카페', groups: ['음식점·카페', '식품·마트'] },
    { analysisDong: 'A동', group: '식품·마트' },
    { analysisDong: 'B동', group: '음식점·카페' },
    { analysisDong: 'B동', group: '음식점·카페' },
    { analysisDong: 'B동', group: '음식점·카페' },
    { analysisDong: 'B동', group: '패션·뷰티' },
    { analysisDong: '미분류', group: '기타' }
  ];
  const original = JSON.stringify(items);
  const result = a.compareDongs(items, ['A동', 'B동']);
  assert.deepEqual(Array.from(result.regions, (r) => r.total), [2, 4]);
  const food = result.rows.find((r) => r.group === '음식점·카페');
  assert.deepEqual(Array.from(food.values, (v) => [v.count, v.share, v.gap]), [[1, 50, 0], [3, 75, 25]]);
  assert.equal(result.rows.find((r) => r.group === '식품·마트').values[1].gap, -50);
  assert.equal(result.rows.length, 8);
  result.regions.forEach((region, i) => {
    assert.equal(result.rows.reduce((sum, row) => sum + row.values[i].count, 0), region.total);
    assert.equal(result.rows.reduce((sum, row) => sum + row.values[i].share, 0), 100);
  });
  assert.equal(JSON.stringify(items), original);
});

test('comparison supports multiple dongs, deduplicates selections, and handles no data without NaN', () => {
  const { DonggurangAnalysis: a } = setup();
  const result = a.compareDongs([{ analysisDong: 'A동', group: '기타' }], ['A동', 'B동', 'C동', 'D동', 'A동']);
  assert.equal(result.regions.length, 4);
  assert.equal(result.regions[1].total, 0);
  result.rows.forEach((row) => {
    assert.equal(row.values[1].count, 0);
    assert.equal(row.values[1].share, 0);
    assert.equal(row.values[1].gap, null);
  });
  const emptyBase = a.compareDongs([{ analysisDong: 'B동', group: '기타' }], ['A동', 'B동']);
  assert.equal(emptyBase.rows[7].values[1].gap, null);
});

test('real-data comparison for 계림2동 and 충장동 matches independent filtered totals', () => {
  const { DonggurangAnalysis: a, DONGGURANG_BOUNDARIES: b, DONGGURANG_MERCHANTS: source } = setup();
  const merchants = a.assignDongs(source.map((m) => ({ ...m, group: '기타' })), b);
  const names = ['계림2동', '충장동'];
  const result = a.compareDongs(merchants, names);
  result.regions.forEach((region, i) => {
    const expected = merchants.filter((m) => m.analysisDong === names[i]).length;
    assert.ok(expected > 0);
    assert.equal(region.total, expected);
    assert.equal(result.rows[7].values[i].count, expected);
    assert.equal(result.rows[7].values[i].share, 100);
  });
});

test('LQ uses full dong and district denominators and calculates 1.8, 1, and 0.5', () => {
  const { DonggurangAnalysis: a } = setup();
  const records = (analysisDong, group, count) => Array.from({ length: count }, () => ({ analysisDong, group, groups: [group, '기타'] }));
  const items = [
    ...records('A동', '식품·마트', 18), ...records('A동', '음식점·카페', 10),
    ...records('A동', '패션·뷰티', 10), ...records('A동', '기타', 12),
    ...records('B동', '식품·마트', 22), ...records('B동', '음식점·카페', 30),
    ...records('B동', '패션·뷰티', 70), ...records('미분류', '기타', 28)
  ];
  const original = JSON.stringify(items);
  const result = a.locationQuotients(items, 'A동');
  assert.equal(result.total, 50);
  assert.equal(result.districtTotal, 200);
  const food = result.rows.find((r) => r.group === '식품·마트');
  assert.ok(Math.abs(food.lq - 1.8) < 1e-12);
  assert.equal(food.level.label, '상대적 집중');
  assert.equal(food.share, .36);
  assert.equal(food.districtShare, .2);
  assert.equal(result.rows.find((r) => r.group === '음식점·카페').lq, 1);
  assert.equal(result.rows.find((r) => r.group === '음식점·카페').level.label, '동구 평균');
  assert.equal(result.rows.find((r) => r.group === '패션·뷰티').lq, .5);
  assert.equal(result.rows.find((r) => r.group === '패션·뷰티').level.label, '상대적 낮음');
  assert.equal(result.rows[0].group, '식품·마트');
  assert.equal(result.rows.length, 8);
  assert.equal(JSON.stringify(items), original);
});

test('LQ distinguishes no local industry (zero) from unavailable denominators (null)', () => {
  const { DonggurangAnalysis: a } = setup();
  const items = [{ analysisDong: 'A동', group: '기타' }, { analysisDong: 'B동', group: '식품·마트' }];
  const rows = a.locationQuotients(items, 'A동').rows;
  const zero = rows.find((r) => r.group === '식품·마트');
  assert.equal(zero.lq, 0);
  assert.equal(zero.level.label, '상대적 낮음');
  assert.equal(rows.find((r) => r.group === '패션·뷰티').lq, null);
  for (const result of [a.locationQuotients(items, '빈동'), a.locationQuotients([], '빈동')]) {
    result.rows.forEach((row) => {
      assert.equal(row.lq, null);
      assert.equal(row.level.label, '계산 불가');
    });
  }
  assert.equal(a.lqLevel(1 + Number.EPSILON).label, '동구 평균');
  assert.equal(a.lqLevel(1.001).label, '상대적 집중');
  assert.equal(a.lqLevel(.999).label, '상대적 낮음');
});

test('real published LQs match direct primary-industry counts for each administrative dong', () => {
  const context = vm.createContext({
    window: { location: { search: '' } }, console, URLSearchParams,
    document: { querySelector: () => null }, setTimeout, clearTimeout
  });
  for (const file of ['analysis.js', 'dong-boundaries.js', 'merchant-data.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static', file), 'utf8').replace(/main\(\);\s*$/, ''), context);
  }
  const items = vm.runInContext('window.DonggurangAnalysis.assignDongs(prepareMerchants(window.DONGGURANG_MERCHANTS), window.DONGGURANG_BOUNDARIES)', context);
  const a = context.window.DonggurangAnalysis;
  for (const f of context.window.DONGGURANG_BOUNDARIES.features) {
    const result = a.locationQuotients(items, f.properties.name);
    const local = items.filter((m) => m.analysisDong === f.properties.name);
    assert.equal(result.total, local.length);
    result.rows.forEach((row) => {
      const localCount = local.filter((m) => m.group === row.group).length;
      const districtCount = items.filter((m) => m.group === row.group).length;
      assert.equal(row.count, localCount);
      assert.equal(row.districtCount, districtCount);
      const expected = local.length && districtCount ? (localCount / local.length) / (districtCount / items.length) : null;
      assert.equal(row.lq, expected);
    });
  }
});
