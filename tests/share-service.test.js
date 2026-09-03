'use strict';
const assert = require('assert');
const ShareService = require('../src/services/share-service.js');
const SyncStore = require('../src/services/sync-store.js');
const ApiClient = require('../src/services/api-client.js');

function fixture() {
  const storage = {}; const shares = []; const requests = []; const events = [];
  let listener; let installs = 0; let userId = 'user1'; let fails = false;
  const platform = { getStorage: key => storage[key], setStorage(key, value) { if (fails) return false; storage[key] = JSON.parse(JSON.stringify(value)); return true; },
    onShareAppMessage(fn) { installs++; listener = fn; return true; }, offShareAppMessage(fn) { assert.strictEqual(fn, listener); listener = null; },
    showShareMenu() {}, shareAppMessage(payload) { shares.push(payload); return { initiated: true, reason: 'initiated' }; } };
  const auth = { current: () => userId ? { userId } : null, ensureSession: async () => ({ ok: true }) };
  const api = { isConfigured: () => true, request: async options => { requests.push(options); return { ok: true, data: options.path === ApiClient.PATHS.shareIntents ? { shareId: 'shr_test123', expiresAt: Date.now() + 60000 } : { attributed: true } }; } };
  const store = new SyncStore(platform);
  const config = { menuEnabled: true, resultEnabled: true, attributionEnabled: true };
  const behavior = { track: (name, properties) => events.push({ name, properties }) };
  const service = new ShareService(platform, api, auth, store, config, behavior);
  return { service, platform, api, auth, store, config, behavior, shares, requests, events, storage,
    installs: () => installs, menu: () => listener(), user: id => { userId = id; }, failStorage: flag => { fails = flag; } };
}

async function run() {
  const f = fixture(); let context = { scene: 'home' };
  assert(f.service.install(() => context)); assert.strictEqual(f.service.install(() => context), false); assert.strictEqual(f.installs(), 1);
  assert(f.menu().query.includes('scene=home'));
  context = { scene: 'ordinary_result', completed: true, levelKey: '0:0', accessToken: 'secret', userId: 'private', installId: 'private' };
  await f.service.prepareContext(context);
  assert.strictEqual(f.requests[0].path, ApiClient.PATHS.shareIntents);
  assert.deepStrictEqual(f.requests[0].body, { scene: 'ordinary_result', context: { levelKey: '0:0' } });
  assert.strictEqual(f.menu().query, 'sv=1&sid=shr_test123&scene=ordinary_result');
  const initiated = await f.service.share(context);
  assert.strictEqual(initiated.initiated, true); assert.strictEqual(initiated.rewarded, undefined); assert.strictEqual(initiated.shared, undefined);
  assert(f.shares[0].query.length <= 256);
  assert.strictEqual(f.requests.some(item => item.path === ApiClient.PATHS.rewards), false);
  f.user(null); assert(!(await f.service.share(context)).rewarded); assert(!f.shares[1].query.includes('sid='));
  f.user('other'); assert(!f.service.buildPayload(context).query.includes('sid='));
  f.service.uninstall(); assert(f.service.install(() => context)); assert.strictEqual(f.installs(), 2);

  const blocked = fixture(); blocked.api.request = () => new Promise(() => {});
  blocked.service.prepareContext(context);
  assert.strictEqual((await blocked.service.share(context)).initiated, true, 'sharing never waits for an intent request');
  assert(!blocked.shares[0].query.includes('sid='));
  assert.strictEqual((await blocked.service.share({ scene: 'ordinary_result', completed: false })).initiated, false);
  const invites = fixture(); invites.config.rewardsEnabled = true;
  await invites.service.prepareContext(context);
  assert.strictEqual(invites.requests[0].body.rewardAction, 'daily_extra_entry');
  await invites.service.share(context);
  assert.strictEqual(invites.requests.filter(request => request.path === ApiClient.PATHS.rewards).length, 0);
  const firstEntry = { scene: 1007, query: { sv: '1', sid: 'shr_self', scene: 'home' } };
  const nextEntry = { scene: 1007, query: { sv: '1', sid: 'shr_valid', scene: 'home' } };
  invites.service.captureEntry(firstEntry); invites.service.captureEntry(nextEntry);
  invites.api.request = async options => options.body.shareId === 'shr_self'
    ? { ok: false, error: { code: 'SELF_INVITE' } }
    : { ok: true, data: { alreadyAttributed: true, attributionId: options.body.attributionId, shareId: options.body.shareId,
      grant: { amount: 99999 } } };
  assert((await invites.service.consumePendingAttribution(invites.auth.current())).ok);
  assert.strictEqual(invites.service.pending.length, 0, 'a rejected self invite cannot block later valid entries');
  assert.strictEqual(invites.service.captureEntry(firstEntry), false);
  assert.strictEqual(invites.events.filter(event => event.name === 'reward_granted').length, 0);

  // Restored analytics are filtered again before crossing an account boundary.
  const Behavior = require('../src/services/behavior-service.js');
  const analytics = fixture(); const eventId = analytics.store.nextId('evt_');
  analytics.storage[Behavior.STORAGE_KEY] = { schemaVersion: 1, events: [{ eventId, name: 'share_attributed', version: 1,
    occurredAtClient: 1, installId: analytics.store.state.installId, sessionId: 'appses_test', userId: 'user1', accessToken: 'secret',
    properties: { scene: 'home', nickname: 'private', avatarUrl: 'https://private.test', reason: 'https://private.test' } }] };
  let batch = null; analytics.api.sessions = { current: () => ({ userId: 'user2' }) };
  analytics.api.request = async options => { batch = options.body.events; return { ok: true, data: { acceptedEventIds: [eventId] } }; };
  const behavior = new Behavior(analytics.platform, analytics.api, analytics.store, { uploadEnabled: true });
  assert.strictEqual(JSON.stringify(behavior.events).includes('secret'), false);
  await behavior.flush(); assert.strictEqual(batch, null, 'old account events cannot be uploaded under the new session');
  analytics.api.sessions.current = () => ({ userId: 'user1' });
  await behavior.flush(); assert.deepStrictEqual(batch[0].properties, { scene: 'home' });
}
run.fixture = fixture;
module.exports = run;
