const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('creates only viewport markers and reuses them on pan and filter changes', () => {
  const root = path.join(__dirname, '..', 'static');
  const context = vm.createContext({
    window: { location: { search: '' } },
    URLSearchParams,
    document: { querySelector: () => null },
    clearTimeout,
    setTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'merchant-data.js'), 'utf8'), context);
  const all = context.window.DONGGURANG_MERCHANTS;
  assert.equal(all.length, 3803);

  let created = 0;
  context.L = {
    marker: () => { created++; return { bindPopup() { return this; } }; },
    divIcon: (options) => options
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/main\(\);\s*$/, ''), context);
  const layers = new Set();
  const cluster = {
    addLayers(markers) { markers.forEach((marker) => layers.add(marker)); },
    removeLayers(markers) { markers.forEach((marker) => layers.delete(marker)); }
  };
  const bounds = (south, north, west, east) => ({
    pad() { return this; },
    contains([lat, lng]) { return lat >= south && lat <= north && lng >= west && lng <= east; }
  });
  const center = bounds(35.142, 35.150, 126.918, 126.927);
  const east = bounds(35.142, 35.150, 126.926, 126.935);
  context.__cluster = cluster;
  context.__all = all;
  context.__bounds = center;
  vm.runInContext('state.map = { getBounds: () => __bounds }; state.markerLayer = __cluster; state.filtered = __all; renderVisibleMarkers()', context);
  const first = layers.size;
  assert.ok(first > 0 && first < all.length, `initial viewport: ${first}`);
  assert.equal(created, first);

  context.__bounds = east;
  vm.runInContext('renderVisibleMarkers()', context);
  const expectedEast = all.filter((m) => east.contains([m.lat, m.lng])).length;
  assert.equal(layers.size, expectedEast);
  assert.ok(created < first + expectedEast, 'overlapping markers should be reused');
  const afterPan = created;
  vm.runInContext('renderVisibleMarkers()', context);
  assert.equal(created, afterPan, 'same viewport should not create more markers');

  context.__subset = all.filter((m) => m.category === '일반한식');
  vm.runInContext('state.filtered = __subset; renderVisibleMarkers()', context);
  assert.equal(layers.size, context.__subset.filter((m) => east.contains([m.lat, m.lng])).length);
});

test('shows modern category names for both static and API merchants', () => {
  const context = vm.createContext({
    window: { location: { search: '' } }, URLSearchParams,
    document: { querySelector: () => null }, clearTimeout, setTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8').replace(/main\(\);\s*$/, ''), context);
  context.__items = [
    { name: '동네분식', category: '스넥' },
    { name: '푸른마트', category: '슈퍼 마켓' },
    { name: '동네악기', category: '악 기 점' },
    { name: '메가커피', category: '서양음식' },
    { name: '폐업상점', category: '편 의 점', business_status: '폐업자' }
  ];
  const result = vm.runInContext('prepareMerchants(__items)', context);
  assert.deepEqual(Array.from(result, (item) => item.category), ['분식', '마트', '악기', '카페']);
  assert.deepEqual(Array.from(result, (item) => item.group), ['음식점·카페', '식품·마트', '교육·문화', '음식점·카페']);
});

test('focuses a selected category when its merchants are outside the map viewport', () => {
  const context = vm.createContext({
    window: { location: { search: '' } }, URLSearchParams,
    document: { querySelector: () => null }, clearTimeout, setTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'merchant-data.js'), 'utf8'), context);
  context.L = { latLngBounds: (points) => points };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8').replace(/main\(\);\s*$/, ''), context);
  const restaurants = vm.runInContext('prepareMerchants(window.DONGGURANG_MERCHANTS).filter((m) => m.group === "음식점·카페")', context);
  assert.ok(restaurants.length > 1000);
  const moves = [];
  context.__moves = moves;
  context.__bounds = { contains: () => false };
  vm.runInContext('state.filtered = prepareMerchants(window.DONGGURANG_MERCHANTS).filter((m) => m.group === "음식점·카페"); state.map = { getBounds: () => __bounds, fitBounds: (points) => __moves.push(points) }; showFilteredMerchantsOnMap()', context);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].length, restaurants.filter((item) => item.lat != null).length);
  context.__bounds = { contains: () => true };
  vm.runInContext('showFilteredMerchantsOnMap()', context);
  assert.equal(moves.length, 1, 'do not move a map that already shows matching merchants');
});

test('map merchants use distinct industry icons on the existing marker background', () => {
  const context = vm.createContext({
    window: { location: { search: '' } }, URLSearchParams,
    document: { querySelector: () => null }, clearTimeout, setTimeout
  });
  const icons = [];
  context.L = {
    marker: (_, options) => { icons.push(options.icon); return { bindPopup() { return this; } }; },
    divIcon: (options) => options
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8').replace(/main\(\);\s*$/, ''), context);
  context.__items = [
    { name: '분식집', category: '스넥', lat: 35.15, lng: 126.92 },
    { name: '슈퍼', category: '슈퍼 마켓', lat: 35.15, lng: 126.92 },
    { name: '약국', category: '약국', lat: 35.15, lng: 126.92 }
  ];
  vm.runInContext(`state.filtered = prepareMerchants(__items);
    state.map = { getBounds: () => ({ pad: () => ({ contains: () => true }) }) };
    state.markerLayer = { addLayers() {}, removeLayers() {} };
    renderVisibleMarkers()`, context);
  assert.equal(icons.length, 3);
  assert.ok(icons.every((icon) => icon.className === 'merchant-marker' && icon.html.startsWith('<svg')));
  assert.equal(new Set(icons.map((icon) => icon.html)).size, 3);
});
