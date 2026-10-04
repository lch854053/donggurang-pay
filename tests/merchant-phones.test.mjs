import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizePhone, matchPhones } from '../scripts/import-merchant-phones.mjs';

const merchant = { id: 1, name: '우리 상점', address: '광주 동구 동명로 1 101호 (동명동)' };
const row = (overrides = {}) => ({ frcs_nm: '우리상점', frcs_addr: '광주광역시 동구 동명로 1',
  frcs_dtl_addr: '101호 (동명동)', usage_rgn_cd: '12210', frcs_rprs_telno: '0622345678',
  bzmn_stts: '01', frcs_reg_se: '01', crtr_ymd: '20261001', ...overrides });

test('formats national, Seoul, mobile, and service numbers; rejects dummy or malformed numbers', () => {
  for (const [value, expected] of [['0622345678', '062-234-5678'], ['0223456789', '02-2345-6789'],
    ['01012345679', '010-1234-5679'], ['070-7614-3579', '070-7614-3579'], ['15778007', '1577-8007']]) {
    assert.equal(normalizePhone(value), expected);
  }
  for (const value of [null, '', '0620000000', '06211111111', '0621234567', '12345', '06212345678x', '9992345678']) {
    assert.equal(normalizePhone(value), null);
  }
});

test('matches exact name and full address, preserving unit/floor and original merchants', () => {
  const result = matchPhones([merchant], [row(), row({ frcs_rprs_telno: '062-234-5678' })]);
  assert.equal(result.phones[1].phone, '062-234-5678');
  assert.equal(result.phones[1].sourceDate, '20261001');
  assert.equal(merchant.phone, undefined);
  for (const overrides of [{ frcs_nm: '다른상점' }, { frcs_dtl_addr: '102호 (동명동)' },
    { frcs_dtl_addr: '2층 (동명동)' }, { frcs_dtl_addr: '(동명동)' },
    { frcs_addr: '광주 동구 동명로 2' }, { usage_rgn_cd: '12300' }, { frcs_addr: '광주 북구 동명로 1' }]) {
    assert.equal(Object.keys(matchPhones([merchant], [row(overrides)]).phones).length, 0);
  }
});

test('rejects conflicting numbers, closed/suspended/cancelled records, and missing/dummy numbers', () => {
  assert.equal(matchPhones([merchant], [row(), row({ frcs_rprs_telno: '0622345679' })]).results[0].reason, 'conflicting_phones');
  assert.equal(matchPhones([merchant], [row(), row({ frcs_rprs_telno: '0622345679', bzmn_stts: '03' })]).results[0].reason, 'conflicting_phones');
  for (const overrides of [{ bzmn_stts: '03' }, { bzmn_stts: '02' }, { frcs_reg_se: '03' },
    { frcs_rprs_telno: null }, { frcs_rprs_telno: '0620000000' }]) {
    assert.equal(Object.keys(matchPhones([merchant], [row(overrides)]).phones).length, 0);
  }
});

test('published numbers agree with audit and only refer to existing merchants', () => {
  const context = { window: {} };
  for (const filename of ['merchant-data.js', 'merchant-phones.js']) {
    vm.runInNewContext(fs.readFileSync(new URL(`../static/${filename}`, import.meta.url), 'utf8'), context);
  }
  const { DONGGURANG_MERCHANTS: merchants, DONGGURANG_PHONES: phones, DONGGURANG_PHONE_META: metadata } = context.window;
  const ids = new Set(merchants.map((item) => String(item.id)));
  const audit = JSON.parse(fs.readFileSync(new URL('../reports/merchant-phones.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(phones).length, metadata.phoneCount);
  assert.equal(audit.results.length, merchants.length);
  assert.equal(audit.results.filter((item) => item.reason === 'matched').length, metadata.phoneCount);
  for (const [id, entry] of Object.entries(phones)) {
    assert.ok(ids.has(id));
    assert.equal(normalizePhone(entry.phone), entry.phone);
    const reviewed = audit.results.find((item) => String(item.id) === id);
    assert.equal(reviewed.reason, 'matched');
    assert.ok(reviewed.candidates.some((item) => item.phone === entry.phone && item.status === '01'));
    assert.equal(new Set(reviewed.candidates.map((item) => item.phone).filter(Boolean)).size, 1);
  }
});
