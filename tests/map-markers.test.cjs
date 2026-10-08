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
  assert.equal(all.length, 3761);

  let created = 0;
  context.L = {
    marker: () => { created++; return { on() { return this; } }; },
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
    marker: (_, options) => { icons.push(options.icon); return { on() { return this; } }; },
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

test('vehicle and pet categories use 기타, including animal hospitals before the hospital rule', () => {
  const context = vm.createContext({
    window: { location: { search: '' } }, URLSearchParams,
    document: { querySelector: () => null }, clearTimeout, setTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'merchant-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8').replace(/main\(\);\s*$/, ''), context);
  const result = vm.runInContext(`prepareMerchants([
    '자동차정비', '자동차부품', '자동차시트/타이어', '카인테리어', '세차장', '주차장',
    '이륜차판매', '렌트카', '유류판매', '현대정유오일뱅크', 'LPG', 'SK가스충전소',
    '애완동물', '동물병원', '의원', '세탁소', '스포츠레져용품'
  ].map(category => ({ name: '테스트', category })))`, context);
  assert.deepEqual(Array.from(result, (m) => m.group), [
    ...Array(14).fill('기타'), '의료·건강', '생활·주거', '스포츠·여가'
  ]);
  const actual = vm.runInContext(`prepareMerchants(window.DONGGURANG_MERCHANTS)
    .filter(m => /자동차|오토바이|렌터|주차|세차|타이어|주유|가스충전|반려동물|동물병원/.test(m.category))`, context);
  assert.ok(actual.length > 0);
  assert.ok(actual.every((m) => m.group === '기타'));
});

test('a merchant marker click selects its sheet content without binding a popup', () => {
  const context = vm.createContext({
    window: { location: { search: '' } }, URLSearchParams,
    document: { querySelector: () => null }, clearTimeout, setTimeout
  });
  const markers = [];
  context.L = {
    marker: () => {
      const marker = { on(event, callback) { this[event] = callback; return this; } };
      markers.push(marker);
      return marker;
    },
    divIcon: (options) => options
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8').replace(/main\(\);\s*$/, ''), context);
  vm.runInContext(`state.filtered = prepareMerchants([{ name: '우리약국', category: '약국', lat: 35.15, lng: 126.92 }]);
    state.map = { getBounds: () => ({ pad: () => ({ contains: () => true }) }) };
    state.markerLayer = { addLayers() {}, removeLayers() {} };
    showSelectedMerchants = (items) => { state.selectedMerchants = items; };
    renderVisibleMarkers()`, context);
  assert.equal(markers.length, 1);
  markers[0].click();
  assert.equal(vm.runInContext('state.selectedMerchants[0].name', context), '우리약국');
  assert.equal(markers[0].merchant.name, '우리약국');
});

test('max-zoom clusters select every merchant at a real shared address, otherwise zoom in', () => {
  const context = vm.createContext({
    window: { location: { search: '' } }, URLSearchParams,
    document: { querySelector: () => null }, clearTimeout, setTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'merchant-data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8').replace(/main\(\);\s*$/, ''), context);
  let zoom = 18;
  let zoomed = false;
  context.__map = { getZoom: () => zoom, getMaxZoom: () => 19 };
  const merchants = vm.runInContext(`prepareMerchants(window.DONGGURANG_MERCHANTS)
    .filter(m => m.lat === 35.1478384174223 && m.lng === 126.920021781811)`, context);
  assert.equal(merchants.length, 85);
  context.__cluster = {
    getAllChildMarkers: () => Array.from(merchants, (merchant) => ({ merchant })),
    zoomToBounds: () => { zoomed = true; }
  };
  vm.runInContext(`state.map = __map; showSelectedMerchants = (items) => { state.selectedMerchants = items; }; selectMapCluster(__cluster)`, context);
  assert.equal(zoomed, true);
  assert.equal(vm.runInContext('state.selectedMerchants', context), null);
  zoom = 19;
  vm.runInContext('selectMapCluster(__cluster)', context);
  assert.equal(vm.runInContext('state.selectedMerchants.length', context), 85);
  assert.deepEqual(Array.from(vm.runInContext('state.selectedMerchants', context), (m) => m.id), Array.from(merchants, (m) => m.id));
});
