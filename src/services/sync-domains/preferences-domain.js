'use strict';
const clearTiming = require('../clear-animation-timing.js');

const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const FIELDS = ['skinId', 'clearEffectId', 'clearMode', 'soundEnabled'];

function snapshot(value) {
  return record(value) && Object.keys(value).length === (value.clearMode === undefined ? 4 : 5) && value.schemaVersion === 1 &&
    (value.clearMode === undefined || clearTiming.validMode(value.clearMode)) &&
    validId(value.skinId) && validId(value.clearEffectId) && typeof value.soundEnabled === 'boolean';
}

function valid(type, payload) {
  if (!record(payload)) return false;
  if (type === 'PREFERENCES_BOOTSTRAP') return Object.keys(payload).length === 1 && snapshot(payload.snapshot);
  return type === 'PREFERENCE_FIELD_SET' && Object.keys(payload).length === 2 && FIELDS.includes(payload.field) &&
    (payload.field === 'soundEnabled' ? typeof payload.value === 'boolean'
      : payload.field === 'clearMode' ? clearTiming.validMode(payload.value) : validId(payload.value));
}

module.exports = { valid };
