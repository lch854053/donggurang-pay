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
  assert.equal(all.length, 4038);

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
  assert.ok(first > 0 && first < 4038, `initial viewport: ${first}`);
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
