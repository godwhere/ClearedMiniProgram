'use strict';

const bootstrap = require('../../src/bootstrap.js');
const defaults = require('../../src/config/cloudbase.js');
const SyncStore = require('../../src/services/sync-store.js');
const SessionStore = require('../../src/services/session-store.js');
const { fakeApi } = require('../account-bootstrap.test.js');
const { canonical } = require('../../src/services/sync-payload.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const revisions = () => Object.fromEntries(SyncStore.DOMAINS.map(key => [key, 0]));

function envelope(request, owner = 'player_A', epoch = 1) {
  const data = { ok: true, code: 'OK', protocolVersion: 1, requestId: request.requestId, retryable: false,
    environmentId: 'test-fixture', serverTimeMs: Date.parse('2026-09-03T16:00:00.000Z'), serverDateKey: '2026-09-04',
    player: { playerId: owner, bindingEpoch: epoch, migrationState: 'none', hasCloudState: false,
      completedDomains: [], deferredDomains: ['stamina', 'preferences'], migrationImportId: null,
      migrationReceiptId: null }, revisions: revisions() };
  if (request.action === 'identity.init') data.bindingStatus = 'UNBOUND';
  else data.data = { changedDomains: {}, hasCloudState: false, readOnlyPhase: false,
    completedDomains: [], deferredDomains: ['stamina', 'preferences'] };
  return data;
}

function fixture(options = {}) {
  const native = options.native || fakeApi(); const calls = []; const waits = [];
  native.getAccountInfoSync = () => ({ miniProgram: { envVersion: options.version || 'develop' } });
  native.request = native.login = () => { throw Error('Cloud identity must not use HTTP/login'); };
  const f = { native, calls, waits, owner: 'player_A', epoch: 1, paused: options.paused || new Set() };
  f.reply = request => envelope(request, f.owner, f.epoch);
  native.cloud = { init() { native.events.push('cloud:init'); if (options.initFail) throw Error('init unavailable'); },
    callFunction(call) {
      calls.push(call); native.events.push(call.data.action);
      if (f.paused.has(call.data.action)) waits.push(call);
      else call.success({ result: f.reply(call.data) });
    } };
  const oldWx = global.wx;
  const testConfig = Object.assign({}, defaults, {
    enabled: true,
    env: 'test-fixture',
    identityEnabled: true,
    readEnabled: true,
    timeoutMs: 1000
  }, options.config);
  try {
    global.wx = native;
    f.app = bootstrap.start({ loadLocalCloudConfig: () => testConfig });
  } finally {
    global.wx = oldWx;
  }
  f.auth = f.app.auth; f.sessions = f.auth.sessions; f.sync = f.app.syncStore;
  return f;
}

function business(f) {
  const storage = Object.fromEntries(Object.entries(f.native.storage).filter(([key]) =>
    ![SessionStore.STORAGE_KEY, SyncStore.STORAGE_KEY].includes(key)));
  const a = f.app;
  return canonical({ storage, progress: a.progress.state, daily: a.dailyProgress.state,
    rewards: a.rewardUnlocks.state, stamina: a.stamina.exportAuthoritativeSnapshot(), hints: a.hintAccess.state,
    skin: a.skins.current().id, effect: a.currentEffectId() });
}

module.exports = { fixture, envelope, business, tick, clone, revisions };
