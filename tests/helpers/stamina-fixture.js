'use strict';

const Platform = require('../../src/platform/wechat.js');
const StaminaService = require('../../src/services/stamina-service.js');
const { fakeApi } = require('../account-bootstrap.test.js');

const STORAGE_KEY = 'cleared:minigame:stamina:v1';
const NOW = Date.UTC(2026, 7, 31);
const INTERVAL = 300000;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function createStaminaFixture(saved, options) {
  const raw = fakeApi();
  if (saved !== undefined) raw.storage[STORAGE_KEY] = saved;
  let now = NOW;
  let failure = false;
  const writes = [];
  raw.setStorageSync = (key, value) => {
    if (key === STORAGE_KEY) {
      writes.push(clone(value));
      if (failure) throw new Error('storage unavailable');
    }
    raw.storage[key] = clone(value);
  };
  const platform = new Platform(raw);
  const clock = () => now;
  const service = new StaminaService(platform, Object.assign({ clock }, options));
  return {
    raw, platform, service, writes, clock,
    setNow(value) { now = value; },
    failStorage(value) { failure = value; }
  };
}

// Only old tests inject this; production always uses the finite service.
function createUnlimitedStaminaFixture() {
  const snapshot = () => ({ enabled: true, balance: 5, naturalCap: 5,
    ordinaryAttemptCost: 1, recovering: false, nextRecoveryAt: null,
    remainingMs: 0, overflow: 0, canStartOrdinaryAttempt: true, persisted: true });
  return { snapshot, flush: () => true,
    consumeOrdinaryAttempt: () => ({ ok: true, spent: 1, before: 5, after: 5, snapshot: snapshot() }) };
}

module.exports = { createStaminaFixture, createUnlimitedStaminaFixture, STORAGE_KEY, NOW, INTERVAL, clone };
