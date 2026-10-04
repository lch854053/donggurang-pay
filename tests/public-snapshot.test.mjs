import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicData } from '../scripts/validate-public-data.mjs';

const merchant = { id: 1, name: '가맹점', address: '광주 동구 서남로 1', category: '일반한식', lat: 35.1459, lng: 126.9231, phones: ['062-123-4567'] };
const source = (items = [merchant], metadata = {}) => `window.DONGGURANG_DATA_META=${JSON.stringify({ count: items.length, ...metadata })};\nwindow.DONGGURANG_MERCHANTS=${JSON.stringify(items)};`;

test('validates only JSON assignments and whitelisted public data, with safe coordinates and IDs', () => {
  assert.deepEqual(validatePublicData(source([merchant], { revision: 5 })), { count: 1, revision: 5 });
  assert.throws(() => validatePublicData(source() + '\nprocess.exit();'), /JSON assignments/);
  assert.throws(() => validatePublicData(source([{ ...merchant, business_no: '1234567890' }])), /Private/);
  assert.throws(() => validatePublicData(source([merchant, merchant])), /repeated/);
  assert.throws(() => validatePublicData(source([{ ...merchant, lat: 0 }])), /coordinates/);
  assert.throws(() => validatePublicData(source([], { count: 0 })), /empty/);
  assert.throws(() => validatePublicData(source([merchant], { count: 2 })), /inconsistent/);
  assert.throws(() => validatePublicData(source([merchant], { revision: '5' })), /revision/);
  assert.throws(() => validatePublicData(source([{ ...merchant, phones: '062-123-4567' }])), /list field/);
});
