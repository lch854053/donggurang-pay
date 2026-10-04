import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

function loadData() {
  const context = { window: {} };
  for (const filename of ['merchant-data.js', 'merchant-phones.js', 'merchant-reviewed-phones.js']) {
    vm.runInNewContext(fs.readFileSync(new URL(`../static/${filename}`, import.meta.url), 'utf8'), context);
  }
  return context.window;
}

test('connects all confirmed CSV rows except the specific KOMSCO merchant and retains source numbers', () => {
  const data = loadData();
  const report = JSON.parse(fs.readFileSync(new URL('../reports/reviewed-phone-connections.json', import.meta.url), 'utf8'));
  const overlay = data.DONGGURANG_REVIEWED_PHONES;
  const merged = { ...data.DONGGURANG_PHONES, ...overlay };
  assert.equal(Object.keys(overlay).length, 135);
  assert.equal(Object.keys(merged).length, 2323);
  assert.equal(merged[2802], undefined);
  assert.equal(merged[3997].phone, '062-227-6581');
  assert.equal(report.excludedRows.length, 1);
  assert.equal(report.excludedRows[0].row['가맹점명'], '행복식당');
  assert.equal(report.reviewedRows.length, 150);
  for (const { merchantId, row } of report.reviewedRows) {
    assert.ok(overlay[merchantId].phones.includes(row['후보전화번호']));
    const merchant = data.DONGGURANG_MERCHANTS.find((item) => item.id === merchantId);
    assert.equal(merchant.name, row['가맹점명']);
    assert.equal(merchant.address, row['현재주소']);
  }
  for (const [filename, sha] of Object.entries(report.csvHashes)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(`../reports/${filename}`, import.meta.url))).digest('hex'), sha);
  }
  assert.equal(data.DONGGURANG_MERCHANTS.length, 3762);
});

test('keeps distinct confirmed numbers from multiple sources and merges duplicate numbers', () => {
  const { DONGGURANG_REVIEWED_PHONES: phones } = loadData();
  assert.deepEqual([...phones[178].phones], ['062-226-0107', '062-226-0108']);
  assert.deepEqual([...phones[897].phones], ['062-417-7979', '062-413-7979']);
  assert.equal(phones[1438].phones.length, 1);
  assert.equal(Object.values(phones).filter((item) => item.phones.length > 1).length, 9);
  assert.equal(Object.values(phones).reduce((count, item) => count + item.phones.length, 0), 144);
  for (const item of Object.values(phones)) assert.equal(new Set(item.phones).size, item.phones.length);
});

test('rebuilding the confirmed overlay is deterministic and preserves base merchant/phone datasets', () => {
  const files = ['static/merchant-data.js', 'static/merchant-phones.js', 'static/merchant-reviewed-phones.js', 'reports/reviewed-phone-connections.json'];
  const root = new URL('../', import.meta.url);
  const before = files.map((file) => fs.readFileSync(new URL(file, root)));
  execFileSync('python3', ['scripts/apply-reviewed-phones.py', '--apply'], { cwd: root, stdio: 'pipe' });
  for (const [index, file] of files.entries()) assert.ok(fs.readFileSync(new URL(file, root)).equals(before[index]), file);
});
