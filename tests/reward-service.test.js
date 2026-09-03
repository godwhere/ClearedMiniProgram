'use strict';
const assert = require('assert');
const RewardService = require('../src/services/reward-service.js');
const SyncStore = require('../src/services/sync-store.js');
const ApiClient = require('../src/services/api-client.js');
const Engagement = require('../src/services/engagement-service.js');
const context = { dateKey: '2026-08-31', dayId: 'daily-2026-08-31-v1' };
const input = { source: 'rewarded_ad', action: 'daily_extra_entry', placement: 'dailyExtraEntry', idempotencyKey: 'adatt_test_1', context };
function grant(id, limit, version) {
  return { ok: true, granted: true, alreadyGranted: false, grantId: id || 'grt_1', action: 'daily_extra_entry', stateVersion: version || 1,
    entitlement: { dateKey: context.dateKey, entryLimit: limit || 4, entriesUsed: 3, entriesRemaining: (limit || 4) - 3 } };
}
function fixture() {
  const storage = {}; const requests = []; let userId = 'user1'; let fail = false;
  const platform = { getStorage: key => storage[key], setStorage(key, value) { if (fail) return false; storage[key] = JSON.parse(JSON.stringify(value)); return true; } };
  const auth = { current: () => ({ userId }), ensureSession: async () => ({ ok: true }) };
  const api = { isConfigured: () => true, request: async options => { requests.push(options); return { ok: true, data: options.method === 'GET' ? { dayId: context.dayId, grants: [grant()] } : grant() }; } };
  const store = new SyncStore(platform);
  const service = new RewardService(platform, api, auth, store, { enabled: true });
  return { platform, api, auth, store, service, storage, requests, user: id => { userId = id; }, failStorage: value => { fail = value; } };
}
async function run() {
  const f = fixture();
  const first = f.service.claim(input); assert.strictEqual(first, f.service.claim(input));
  const result = await first; assert(result.granted); assert.strictEqual(f.requests.length, 1);
  assert.strictEqual(f.requests[0].idempotencyKey, input.idempotencyKey);
  assert.strictEqual((await f.service.claim(input)).grantId, result.grantId); assert.strictEqual(f.requests.length, 1);
  assert.strictEqual((await f.service.claim(Object.assign({}, input, { amount: 99999 }))).reason, 'invalid-claim');
  assert.strictEqual((await f.service.claim(Object.assign({}, input, { context: { dateKey: '2026-09-01', dayId: 'different' } }))).reason, 'idempotency-conflict');
  const reloaded = new RewardService(f.platform, f.api, f.auth, f.store, { enabled: true });
  assert.strictEqual((await reloaded.claim(input)).alreadyGranted, true);
  f.user('other'); f.store.state.boundUserId = 'user1';
  assert.strictEqual((await f.service.claim(input)).reason, 'account-mismatch');
  assert.strictEqual(f.requests.length, 1);

  const disk = fixture(); disk.failStorage(true);
  assert.strictEqual((await disk.service.claim(input)).reason, 'persist-failed'); assert.strictEqual(disk.requests.length, 0);
  const uncertain = fixture(); let serverClaims = 0;
  uncertain.api.request = async () => { serverClaims++; uncertain.failStorage(true); return { ok: true, data: grant() }; };
  assert.strictEqual((await uncertain.service.claim(input)).reason, 'persist-failed');
  uncertain.failStorage(false);
  const restart = new RewardService(uncertain.platform, uncertain.api, uncertain.auth, uncertain.store, { enabled: true });
  assert.strictEqual(restart.pendingFor(context).idempotencyKey, input.idempotencyKey);
  uncertain.api.request = async options => { serverClaims++; assert.strictEqual(options.body.idempotencyKey, input.idempotencyKey); return { ok: true, data: Object.assign(grant(), { alreadyGranted: true }) }; };
  assert.strictEqual((await restart.claim(input)).grantId, 'grt_1'); assert.strictEqual(serverClaims, 2);

  const invalid = fixture(); invalid.api.request = async () => ({ ok: true, data: grant('grt_bad', -1) });
  assert.strictEqual((await invalid.service.claim(input)).reason, 'invalid-response'); assert.strictEqual(invalid.service.grants.length, 0);
  const denied = fixture(); denied.api.request = async () => ({ ok: false, error: { code: 'DAILY_REWARD_LIMIT_REACHED' } });
  assert.strictEqual((await denied.service.claim(input)).reason, 'DAILY_REWARD_LIMIT_REACHED'); assert.strictEqual(denied.service.grants.length, 0);
  const changed = fixture(); changed.api.request = async () => { changed.user('other'); return { ok: true, data: grant() }; };
  assert.strictEqual((await changed.service.claim(input)).reason, 'account-mismatch'); assert.strictEqual(changed.service.grants.length, 0);

  const recovery = fixture(); const recovered = await recovery.service.recover(context);
  assert.strictEqual(recovered.grants[0].grantId, 'grt_1');
  recovery.api.request = async () => ({ ok: false, error: { code: 'network' } });
  assert.strictEqual((await recovery.service.recover(context)).grants.length, 1);

  const flow = fixture(); let ads = 0;
  const e = new Engagement({ auth: flow.auth, rewards: flow.service, config: { dailyExtraEntryEnabled: true, dailyExtraEntryLimit: 1 },
    ads: { isRewardedConfigured: () => true, showRewarded: async () => { ads++; return { rewarded: false, reason: 'closed', attemptId: input.idempotencyKey }; } } });
  assert.strictEqual((await e.requestDailyExtraEntry(context)).reason, 'closed'); assert.strictEqual(flow.requests.length, 0);
  e.ads.showRewarded = async () => { ads++; return { rewarded: true, reason: 'completed', attemptId: input.idempotencyKey }; };
  const active = e.requestDailyExtraEntry(context); assert.strictEqual((await e.requestDailyExtraEntry(context)).reason, 'busy');
  assert.strictEqual((await active).grantId, 'grt_1');
  assert.strictEqual((await e.requestDailyExtraEntry(context)).reason, 'DAILY_REWARD_LIMIT_REACHED'); assert.strictEqual(ads, 2);
}
run.fixture = fixture; run.context = context; run.input = input; run.grant = grant;
module.exports = run;
