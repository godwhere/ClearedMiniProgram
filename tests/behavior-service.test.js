'use strict';
const assert = require('assert');
const BehaviorService = require('../src/services/behavior-service.js');
const SyncStore = require('../src/services/sync-store.js');
module.exports = async function run() {
  const storage = {};
  const platform = { getStorage: key => storage[key], setStorage(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); return true; } };
  let batch;
  const api = { isConfigured: () => true, sessions: { current: () => null }, request: async request => {
    batch = request.body.events;
    return { ok: true, data: { acceptedEventIds: [batch[0].eventId, 'unknown'] } };
  } };
  const behavior = new BehaviorService(platform, api, new SyncStore(platform), { uploadEnabled: true });
  assert.strictEqual(behavior.track('reward_proof', {}), false);
  behavior.track('share_initiated', { scene: 'home', accessToken: 'secret', nickname: 'name', avatarUrl: 'https://x.test', error: {} });
  assert.deepStrictEqual(behavior.events[0].properties, { scene: 'home' });
  for (let i = 0; i < 201; i++) behavior.track('ad_requested', { placement: 'hint' });
  assert.strictEqual(behavior.events.length, 200);
  const p = behavior.flush(); assert.strictEqual(p, behavior.flush()); await p;
  assert.strictEqual(batch.length, 50); assert.strictEqual(behavior.events.length, 199);
  assert.strictEqual(storage[BehaviorService.STORAGE_KEY].events.length, 199);
};
