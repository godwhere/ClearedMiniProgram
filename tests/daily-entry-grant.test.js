'use strict';
const assert = require('assert');
const DailyStore = require('../src/services/daily-progress-store.js');
const ClearedApp = require('../src/app.js');
const WechatPlatform = require('../src/platform/wechat.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { fixture, context, grant } = require('./reward-service.test.js');

module.exports = async function run() {
  const f = fixture(); const daily = new DailyStore(f.platform);
  for (let i = 0; i < 3; i++) assert(daily.recordEntry(Object.assign({}, context, { entryLimit: 3, idempotencyKey: `entry${i}` })).ok);
  assert.strictEqual(daily.canEnter(context.dateKey, 3), false);
  const input = Object.assign({}, context, { grantId: 'grt_1', entryLimit: 4, grantedAt: 1000 });
  assert(daily.applyAuthorizedEntryGrant(input).ok);
  assert.strictEqual(daily.applyAuthorizedEntryGrant(input).alreadyApplied, true);
  assert.strictEqual(new DailyStore(f.platform).applyAuthorizedEntryGrant(input).alreadyApplied, true);
  assert.strictEqual(daily.getDay(context.dateKey).entriesUsed, 3);
  assert(daily.recordEntry(Object.assign({}, context, { idempotencyKey: 'entry4' })).ok);
  assert.strictEqual(daily.canEnter(context.dateKey, 3), false);
  assert.strictEqual(daily.applyAuthorizedEntryGrant(Object.assign({}, input, { grantId: 'grt_2', entryLimit: 2 })).reason, 'entry-limit-decreased');
  assert.strictEqual(daily.applyAuthorizedEntryGrant(Object.assign({}, input, { dayId: 'another' })).reason, 'challenge-mismatch');
  assert.strictEqual(daily.applyAuthorizedEntryGrant(Object.assign({}, input, { dateKey: '2026-02-31' })).reason, 'invalid-grant');
  assert.strictEqual(daily.applyAuthorizedEntryGrant(Object.assign({}, input, { dateKey: '2026-09-01' })).reason, 'grant-context-mismatch');
  const before = daily.state; f.failStorage(true);
  assert.strictEqual(daily.applyAuthorizedEntryGrant(Object.assign({}, input, { grantId: 'grt_next', entryLimit: 5 })).reason, 'persist-failed');
  assert.strictEqual(daily.state, before); f.failStorage(false);
  assert.strictEqual(daily.requestEntryIncrease({ source: 'ad' }).implemented, false);

  const appFixture = fixture(); const platform = new WechatPlatform(fakeApi()); let finish;
  const app = new ClearedApp(platform, { clock: () => new Date('2026-08-31T00:00:00Z'), auth: appFixture.auth, rewards: appFixture.service,
    engagement: { canRequestDailyExtraEntry: () => true, requestDailyExtraEntry: () => new Promise(resolve => { finish = resolve; }) } });
  const day = app.resolveDaily(); const ctx = { dateKey: day.dateKey, dayId: day.dayId };
  for (let i = 0; i < 3; i++) app.dailyProgress.recordEntry(Object.assign({}, ctx, { idempotencyKey: `used${i}` }));
  assert.strictEqual(app.buildModel().dailyEntryAvailable, false);
  const ordinary = JSON.stringify(app.progress.state);
  assert.strictEqual(app.requestDailyExtraEntry(), true); assert.strictEqual(app.requestDailyExtraEntry(), false);
  app.performAction('home:levels');
  finish(Object.assign(grant(), { userId: 'user1', context: ctx }));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(app.scene, 'levels'); assert.strictEqual(app.dailyProgress.getDay(day.dateKey).entryLimit, 4);
  assert.strictEqual(JSON.stringify(app.progress.state), ordinary);
  app.scene = 'home'; assert.strictEqual(app.buildModel().dailyEntryAvailable, true);
  appFixture.user('other'); assert.strictEqual(app.applyDailyGrant(Object.assign(grant(), { userId: 'user1', context: ctx })).ok, false);
};
