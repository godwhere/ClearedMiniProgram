'use strict';

const MAX_TIMESTAMP = 8640000000000000;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const levelKey = value => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value);

function snapshot(value) {
  return record(value) && value.schemaVersion === 1 && integer(value.balance) &&
    (value.balance >= 5 ? value.nextRecoveryAt === null : integer(value.nextRecoveryAt) && value.nextRecoveryAt <= MAX_TIMESTAMP) &&
    Array.isArray(value.unlockedLevels) && value.unlockedLevels.every(levelKey) &&
    new Set(value.unlockedLevels).size === value.unlockedLevels.length &&
    Array.isArray(value.refundedLevels) && value.refundedLevels.every(key => levelKey(key) && value.unlockedLevels.includes(key)) &&
    new Set(value.refundedLevels).size === value.refundedLevels.length;
}

function valid(type, payload) {
  if (!record(payload)) return false;
  if (type === 'STAMINA_BOOTSTRAP') return Object.keys(payload).length === 1 && snapshot(payload.snapshot);
  if (type === 'STAMINA_LEVEL_UNLOCKED') return Object.keys(payload).length === 1 && levelKey(payload.levelKey);
  return type === 'STAMINA_QUICK_CLEAR_REFUNDED' && Object.keys(payload).length === 2 && levelKey(payload.levelKey) &&
    Number.isSafeInteger(payload.elapsedMs) && payload.elapsedMs > 0 && payload.elapsedMs <= 60000;
}

module.exports = { valid };
