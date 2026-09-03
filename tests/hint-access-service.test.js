'use strict';

const assert = require('assert');
const HintAccess = require('../src/services/hint-access-service.js');
const catalog = require('../data/catalog-v2.js');
const copy = value => JSON.parse(JSON.stringify(value));

module.exports = function run() {
  const storage = { 'cleared:minigame:progress:v2': { completed: { '0:0': true } } };
  const ordinaryBefore = copy(storage['cleared:minigame:progress:v2']);
  let now = new Date('2026-09-03T15:59:59.999Z');
  let fail = false;
  const platform = { getStorage: key => storage[key], setStorage(key, value) {
    if (fail) return false;
    storage[key] = copy(value); return true;
  } };
  const create = () => new HintAccess(platform, { clock: () => now });
  const access = create();
  const key = HintAccess.levelKey({ source: 'catalog', setIndex: 0, levelIndex: 0 });
  const context = { dateKey: access.dateKey(), levelKey: key };
  assert.strictEqual(context.dateKey, '2026-09-03');
  assert.strictEqual(key, 'catalog:0:0');
  assert.strictEqual(access.status(context).unlocked, false);
  assert(access.unlock(context).ok);
  assert.strictEqual(access.unlock(context).alreadyUnlocked, true);
  assert.strictEqual(create().status(context).unlockCount, 1);
  const detached = access.status(context); detached.unlocked = false;
  assert.strictEqual(access.status(context).unlocked, true);

  const portal = catalog.levels.find(entry => entry.game.Mechanic === 'portal');
  const portalContext = { dateKey: context.dateKey, levelKey: HintAccess.levelKey({ source: 'catalog',
    setIndex: portal.setIndex, levelIndex: portal.levelIndex }) };
  assert(access.unlock(portalContext).ok);
  const dailyContext = { dateKey: context.dateKey, levelKey: HintAccess.levelKey({ source: 'daily',
    dayId: 'day:one', challengeId: 'level:one' }) };
  assert(access.unlock(dailyContext).ok);
  assert.strictEqual(access.status(context).unlockCount, 3, 'all level sources share one unique daily count');
  assert.notStrictEqual(dailyContext.levelKey, HintAccess.levelKey({ source: 'daily', dayId: 'day', challengeId: 'one:level:one' }));
  assert.strictEqual(HintAccess.levelKey({ source: 'catalog', setIndex: 999, levelIndex: 0 }), null);
  assert.strictEqual(HintAccess.levelKey({ source: 'daily', dayId: 'day', challengeId: '\n' }), null);

  const next = { dateKey: context.dateKey, levelKey: 'catalog:0:1' };
  const durable = copy(storage[HintAccess.STORAGE_KEY]);
  fail = true;
  assert.strictEqual(access.unlock(next).reason, 'persist-failed');
  assert.strictEqual(access.status(next).unlocked, false);
  assert.strictEqual(access.status(next).pendingSave, true);
  assert.deepStrictEqual(access.status(context).pendingSaveContext, next);
  assert.strictEqual(access.status(next).unlockCount, 3);
  assert.deepStrictEqual(storage[HintAccess.STORAGE_KEY], durable);
  fail = false;
  const repaired = access.retryPendingSave();
  assert(repaired.ok); assert.strictEqual(repaired.levelKey, next.levelKey);
  assert.strictEqual(access.status(context).pendingSaveContext, null);
  assert.strictEqual(create().status(next).unlocked, true);
  assert.strictEqual(access.status(next).unlockCount, 4);
  assert.deepStrictEqual(storage['cleared:minigame:progress:v2'], ordinaryBefore);

  now = new Date('2026-09-03T16:00:00.000Z');
  const tomorrow = { dateKey: '2026-09-04', levelKey: key };
  assert.strictEqual(access.status(tomorrow).unlocked, false, 'Shanghai midnight resets ordinary hints too');
  assert.strictEqual(access.status(tomorrow).unlockCount, 0);
  assert.strictEqual(access.unlock(context).ok, false, 'a late old-day attempt cannot write into today');
  assert.strictEqual(create().status(tomorrow).unlockCount, 0);
  now = new Date('invalid');
  assert.strictEqual(access.unlock(tomorrow).ok, false);
  now = new Date('2026-09-04T00:00:00Z');

  storage[HintAccess.STORAGE_KEY] = { schemaVersion: 1, dateKey: tomorrow.dateKey,
    unlockedLevelKeys: [key, key, '__proto__', 'catalog:999:0', 'daily::x', 'daily:%zz:x', null], token: 'discard' };
  const normalized = create();
  assert.strictEqual(normalized.status(tomorrow).unlockCount, 1);
  assert(normalized.unlock({ dateKey: tomorrow.dateKey, levelKey: 'catalog:0:1' }).ok);
  assert.deepStrictEqual(Object.keys(storage[HintAccess.STORAGE_KEY]), ['schemaVersion', 'dateKey', 'unlockedLevelKeys']);
  storage[HintAccess.STORAGE_KEY] = { schemaVersion: 1, dateKey: '2026-02-31', unlockedLevelKeys: [key] };
  assert.strictEqual(create().status(tomorrow).unlockCount, 0);
  storage[HintAccess.STORAGE_KEY] = { schemaVersion: 1, dateKey: tomorrow.dateKey,
    unlockedLevelKeys: Array.from({ length: 1024 }, (_, i) => `daily:d:level${i}`) };
  assert.strictEqual(create().unlock(tomorrow).reason, 'unlock-limit');
};
