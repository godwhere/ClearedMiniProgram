'use strict';

const record = value => !!value && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

function canonical(value, depth) {
  if ((depth || 0) > 32) throw Error('payload-depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, item => canonical(item, (depth || 0) + 1)).join(',') + ']';
  if (!record(value)) throw Error('invalid-payload');
  return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('invalid-key');
    return JSON.stringify(key) + ':' + canonical(value[key], (depth || 0) + 1);
  }).join(',') + '}';
}

function fingerprint(value) {
  const content = canonical(value);
  // This fingerprint is for local idempotency conflict detection,
  // not a trust or anti-cheat primitive. Also compare canonical content on
  // retries: a short hash collision must never authorize a changed payload.
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619) >>> 0;
  return `local-fnv1a32:${hash.toString(16).padStart(8, '0')}:${content.length}`;
}

const clone = value => JSON.parse(canonical(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

module.exports = { record, validId, canonical, fingerprint, clone, freeze };
