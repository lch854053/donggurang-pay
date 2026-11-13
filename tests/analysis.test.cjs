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
