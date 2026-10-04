import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneCandidates, csvText } from '../scripts/export-phone-candidates.mjs';
import { reviewFoodPhones } from '../scripts/review-food-phones.mjs';

const merchant = { id: 1, name: '우리상점', address: '광주 동구 동명로 1 101호 (동명동)' };
const komsco = (overrides = {}) => ({ frcs_nm: '우리상점', frcs_addr: '광주 동구 동명로 1',
  frcs_dtl_addr: '(동명동, 101호)', usage_rgn_cd: '12210', frcs_rprs_telno: '0622345678',
  bzmn_stts: '01', frcs_reg_se: '01', crtr_ymd: '20261001', ...overrides });
const food = (overrides = {}) => ({ BPLC_NM: '우리상점', ROAD_NM_ADDR: '전남광주통합특별시 동구 동명로 1, 101호 (동명동)',
  TELNO: '0622345678', SALS_STTS_CD: '01', DTL_SALS_STTS_CD: '01', CLSBIZ_YMD: '',
  OPN_ATMY_GRP_CD: '5805000', ...overrides });
const dataset = (rows, service = 'general_restaurants') => ({ service, rows });

test('exports review-only candidates with detail differences, deduplicates raw rows, and skips already published phones', () => {
  const rows = [komsco(), komsco(), komsco({ frcs_dtl_addr: '102호 (동명동)' }),
    komsco({ frcs_addr: '광주 동구 동명로 2' }), komsco({ frcs_nm: '다른가게' }),
    komsco({ bzmn_stts: '03' }), komsco({ frcs_rprs_telno: '0620000000' })];
  const results = phoneCandidates([merchant], {}, rows, {});
  assert.equal(results.length, 2);
  assert.equal(results[0].sourceCount, 2);
  assert.ok(results.every((row) => row.review.includes('층·호수')));
  assert.equal(phoneCandidates([merchant], { 1: { phone: '062-234-5678' } }, rows, {}).length, 0);
  assert.equal(merchant.phone, undefined);
});

test('keeps unit differences as review candidates and ignores closed, wrong-region, different-name or dummy-number food records', () => {
  const result = reviewFoodPhones([merchant], {}, [dataset([food(), food({ ROAD_NM_ADDR: '광주 동구 동명로 1 102호 (동명동)' }),
    food({ SALS_STTS_CD: '03' }), food({ DTL_SALS_STTS_CD: '02' }), food({ CLSBIZ_YMD: '20261001' }),
    food({ OPN_ATMY_GRP_CD: '9999999' }), food({ TELNO: '0620000000' }), food({ BPLC_NM: '다른상점' })])]);
  assert.equal(result.additions.length, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].candidateAddress, '광주 동구 동명로 1 102호 (동명동)');
});

test('conflicting food numbers across APIs remain candidates; existing phone differences never become additions', () => {
  const datasets = [dataset([food()]), dataset([food({ TELNO: '0622345679' })], 'rest_cafes')];
  const result = reviewFoodPhones([merchant], {}, datasets);
  assert.equal(result.additions.length, 0);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((row) => row.decision.includes('번호 충돌')));
  const published = { 1: { phone: '062-234-5678' } };
  const existing = reviewFoodPhones([merchant], published, datasets);
  assert.equal(existing.existingDifferences.length, 1);
  assert.equal(existing.additions.length, 0);
  assert.equal(published[1].phone, '062-234-5678');
  const priorConflict = reviewFoodPhones([merchant], {}, [dataset([food()])], { 1: 'conflicting_phones' });
  assert.ok(priorConflict.additions[0].decision.includes('조폐공사 번호 충돌 이력'));
  assert.equal(priorConflict.additions[0].previousReason, 'conflicting_phones');
});

test('CSV preserves Korean, quoted text, commas and newlines and escapes formula-like cells', () => {
  const csv = csvText(['상호', '번호'], [['가게,"본점"\n1층', '062-234-5678'], ['=1+1', '@name']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"가게,""본점""\n1층"'));
  assert.ok(csv.includes('"\'=1+1","\'@name"'));
  assert.ok(csv.endsWith('\r\n'));
});
