import fs from 'node:fs';

export function validatePublicData(source) {
  const match = source.match(/^\s*(?:\/\*[\s\S]*?\*\/\s*)?window\.DONGGURANG_DATA_META\s*=\s*(\{[\s\S]*?\});\s*window\.DONGGURANG_MERCHANTS\s*=\s*(\[[\s\S]*\]);?\s*$/);
  if (!match) throw new Error('Public file must contain only two JSON assignments');
  const meta = JSON.parse(match[1]), items = JSON.parse(match[2]);
  const metaFields = new Set(['count', 'revision', 'generatedAt', 'coordinates', 'deduplicatedRecords']);
  if (Object.keys(meta).some(key => !metaFields.has(key))) throw new Error('Unknown metadata field');
  if (meta.revision !== undefined && (!Number.isSafeInteger(meta.revision) || meta.revision < 0)) throw new Error('Invalid publication revision');
  if (!Array.isArray(items) || !items.length || meta?.count !== items.length) throw new Error('Missing, empty or inconsistent public snapshot');
  const allowed = new Set(['id', 'name', 'address', 'category', 'categories', 'nameAliases', 'locality', 'lat', 'lng', 'geocode_method', 'geocode_address', 'approximate', 'phone', 'phones', 'phoneSource']);
  const ids = new Set();
  for (const item of items) {
    if (Object.keys(item).some(key => !allowed.has(key))) throw new Error('Private or unknown public field');
    if (!Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id)) throw new Error('Invalid or repeated merchant ID');
    ids.add(item.id);
    for (const key of ['name', 'address', 'category']) if (typeof item[key] !== 'string' || !item[key].trim()) throw new Error('Missing merchant field');
    for (const key of ['categories', 'nameAliases', 'phones']) if (item[key] !== undefined && (!Array.isArray(item[key]) || item[key].some(value => typeof value !== 'string'))) throw new Error('Invalid merchant list field');
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng) || item.lat < 35.08 || item.lat > 35.19 || item.lng < 126.88 || item.lng > 127.01) throw new Error('Invalid Dong-gu coordinates');
  }
  return { count: items.length, revision: meta.revision || 0 };
}

if (process.argv[1]?.endsWith('validate-public-data.mjs')) {
  const result = validatePublicData(fs.readFileSync('static/merchant-data.js', 'utf8'));
  if (process.argv[2]) {
    const previous = validatePublicData(fs.readFileSync(process.argv[2], 'utf8'));
    if (result.revision < previous.revision) throw new Error('Older admin publication cannot replace a newer version');
  }
  console.log(`Public snapshot validated: ${result.count} merchants, revision ${result.revision}`);
}
