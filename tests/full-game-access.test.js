'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const catalog = require('../data/catalog-v2.js');
const appProductConfig = require('./fixtures/app-product-policy.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { createUnlimitedStaminaFixture } = require('./helpers/stamina-fixture.js');
const { FakeFullGameStore, snapshot, result, deferred } = require('./helpers/fake-full-game-store.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function fixture(initialSnapshot) {
  const raw = fakeApi();
  const store = new FakeFullGameStore(initialSnapshot || snapshot({ revision: 1 }));
  const baseStamina = createUnlimitedStaminaFixture();
  let unlockCalls = 0;
  const stamina = Object.assign({}, baseStamina, {
    unlockOrdinaryLevel(levelKey, now) {
      unlockCalls++;
      return baseStamina.unlockOrdinaryLevel(levelKey, now);
    }
  });
  const app = new App(new Platform(raw), {
    productPolicy: appProductConfig,
    fullGameStore: store,
    stamina
  });
  return { raw, store, app, unlockCalls: () => unlockCalls };
}

function completeFreePreview(app) {
  appProductConfig.freeLevelKeys.forEach((key, index) => {
    const [setIndex, levelIndex] = key.split(':').map(Number);
    app.progress.recordCompletion(setIndex, levelIndex, 1000 + index);
  });
  assert.strictEqual(app.progress.save(), true);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function run() {
  const gated = fixture();
  gated.app.start();
  await flush();
  assert.strictEqual(gated.store.subscribeCalls, 1);
  assert.strictEqual(gated.store.listenerCount(), 1);
  assert.strictEqual(gated.app.openLevel(0, 1), false,
    'a commercially free preview level still requires its progression prerequisite');
  assert.strictEqual(gated.app.storeDialog, null,
    'a progression lock does not masquerade as a purchase requirement');
  assert.strictEqual(gated.unlockCalls(), 0);
  completeFreePreview(gated.app);

  assert.strictEqual(gated.app.openLevel(1, 3), true, 'the sixth fixed preview level remains playable');
  gated.app.performAction('play:back');
  const beforeRestricted = {
    progress: clone(gated.app.progress.state),
    currency: clone(gated.app.rewardUnlocks.view()),
    staminaCalls: gated.unlockCalls()
  };
  assert.strictEqual(gated.app.openLevel(1, 4), false, 'the seventh level is commercially restricted');
  assert(gated.app.storeDialog);
  assert.strictEqual(gated.app.runner, null);
  assert.strictEqual(gated.unlockCalls(), beforeRestricted.staminaCalls,
    'commercial access is checked before stamina');
  assert.deepStrictEqual(gated.app.progress.state, beforeRestricted.progress);
  assert.deepStrictEqual(gated.app.rewardUnlocks.view(), beforeRestricted.currency);
  assert.strictEqual(gated.store.calls.filter(call => call.method === 'purchase').length, 0,
    'opening restricted content never starts a purchase');

  gated.app.tick(Date.now());
  assert(gated.app.renderer.hits.some(hit => hit.id === 'store:purchaseFullGame'));
  assert(gated.app.renderer.hits.some(hit => hit.id === 'store:restorePurchases'));
  assert(gated.app.renderer.hits.some(hit => hit.id === 'store:close'));
  assert.strictEqual(gated.app.buildModel().storeDialog.purchaseLabel, gated.app.t('store.purchase'),
    'missing store price metadata never produces a guessed price');
  gated.app.performAction('store:close');

  gated.app.scene = 'home';
  gated.app.runner = null;
  gated.app.runContext = null;
  assert.strictEqual(gated.app.performAction('home:start'), undefined);
  assert(gated.app.storeDialog, 'home resume uses the same commercial gate');
  gated.app.dismissStoreDialog();

  gated.app.scene = 'home';
  gated.app.performAction('home:levels');
  const seventh = gated.app.buildModel().levelItems.find(item =>
    item.setIndex === 1 && item.levelIndex === 4);
  assert(seventh && seventh.requiresFullGame && seventh.actionable && !seventh.unlocked);
  gated.app.performAction(seventh.action);
  assert(gated.app.storeDialog, 'the level selector opens the shared store panel');
  gated.app.dismissStoreDialog();

  gated.app.runContext = require('../src/gameplay/run-context.js')
    .createCatalogRunContext(catalog, 1, 3);
  gated.app.runner = {};
  gated.app.scene = 'result';
  gated.app.result = { outcome: 'won', elapsedMs: 1000, bestMs: 1000 };
  assert.strictEqual(gated.app.buildModel().nextRequiresFullGame, true);
  gated.app.performAction('result:next');
  assert(gated.app.storeDialog, 'result next cannot skip the commercial gate');
  assert.strictEqual(gated.app.scene, 'result');
  gated.app.dismissStoreDialog();

  gated.app.scene = 'home';
  gated.app.runner = null;
  gated.app.runContext = null;
  assert.strictEqual(gated.app.openIceTrial(), false);
  assert(gated.app.storeDialog, 'the hidden ice trial entry is gated too');
  gated.app.dismissStoreDialog();

  gated.store.publish(snapshot({ status: 'owned_verified', transactionId: 'owned-1',
    verifiedAt: 100, revision: 5 }));
  assert.strictEqual(gated.app.scene, 'home', 'an entitlement update never auto-enters content');
  assert.strictEqual(gated.app.runner, null);
  assert.strictEqual(gated.app.openLevel(1, 4), true);
  assert.strictEqual(gated.unlockCalls(), beforeRestricted.staminaCalls + 1);
  gated.app.progress.recordCompletion(1, 4, 2000);
  gated.app.progress.save();
  gated.app.performAction('play:back');

  gated.store.publish(snapshot({ status: 'revoked', revision: 7 }));
  assert.strictEqual(gated.app.openLevel(1, 4), false,
    'completed progress cannot bypass a later revocation');
  gated.app.dismissStoreDialog();
  gated.store.publish(snapshot({ status: 'owned_verified', transactionId: 'stale',
    verifiedAt: 50, revision: 6 }));
  assert.strictEqual(gated.app.fullGameSnapshot.status, 'revoked',
    'an older revision cannot overwrite the current projection');

  const revokedReplay = fixture(snapshot({ status: 'owned_verified', revision: 30,
    transactionId: 'replay-owned', verifiedAt: 300 }));
  completeFreePreview(revokedReplay.app);
  revokedReplay.app.start();
  await flush();
  assert.strictEqual(revokedReplay.app.openLevel(1, 4), true);
  const paidRunner = revokedReplay.app.runner;
  let paidResetCalls = 0;
  const paidReset = paidRunner.reset.bind(paidRunner);
  paidRunner.reset = () => { paidResetCalls++; return paidReset(); };
  const paidStaminaCalls = revokedReplay.unlockCalls();
  revokedReplay.store.publish(snapshot({ status: 'revoked', revision: 31 }));
  assert.strictEqual(revokedReplay.app.performAction('play:reset'), false);
  assert.strictEqual(revokedReplay.app.scene, 'play');
  assert.strictEqual(paidResetCalls, 0, 'revocation prevents resetting an active paid runner');
  assert(revokedReplay.app.storeDialog);
  revokedReplay.app.dismissStoreDialog();
  revokedReplay.app.scene = 'result';
  revokedReplay.app.result = { outcome: 'failed' };
  assert.strictEqual(revokedReplay.app.performAction('failure:retry'), false);
  assert.strictEqual(revokedReplay.app.scene, 'result');
  assert.strictEqual(revokedReplay.app.runner, paidRunner);
  assert.strictEqual(paidResetCalls, 0, 'revocation prevents resetting an existing paid runner');
  assert.strictEqual(revokedReplay.unlockCalls(), paidStaminaCalls,
    'a rejected retry neither creates a runner nor charges stamina');
  assert(revokedReplay.app.storeDialog);
  revokedReplay.app.dismissStoreDialog();

  revokedReplay.store.publish(snapshot({ status: 'owned_verified', revision: 32,
    transactionId: 'trial-owned', verifiedAt: 320 }));
  revokedReplay.app.scene = 'home';
  assert.strictEqual(revokedReplay.app.openIceTrial(), true);
  const trialRunner = revokedReplay.app.runner;
  let trialResetCalls = 0;
  const trialReset = trialRunner.reset.bind(trialRunner);
  trialRunner.reset = () => { trialResetCalls++; return trialReset(); };
  revokedReplay.app.scene = 'result';
  revokedReplay.app.result = { outcome: 'won' };
  revokedReplay.store.publish(snapshot({ status: 'revoked', revision: 33 }));
  assert.strictEqual(revokedReplay.app.performAction('result:replay'), false);
  assert.strictEqual(revokedReplay.app.scene, 'result');
  assert.strictEqual(revokedReplay.app.runner, trialRunner);
  assert.strictEqual(trialResetCalls, 0, 'revocation prevents replaying an existing paid trial');
  assert(revokedReplay.app.storeDialog);
  revokedReplay.app.dispose();

  const lifecycle = fixture(snapshot({ status: 'not_owned', revision: 40 }));
  const delayedStartRefresh = deferred();
  lifecycle.store.enqueue('refresh', delayedStartRefresh.promise);
  lifecycle.app.start();
  lifecycle.store.enqueue('refresh', result(snapshot({ status: 'owned_verified', revision: 42,
    transactionId: 'foreground-owned', verifiedAt: 420 }),
  { type: 'refresh', status: 'success' }));
  lifecycle.raw.show({ scene: 1001 });
  await flush();
  assert.strictEqual(lifecycle.app.fullGameRevision, 42);
  delayedStartRefresh.resolve(result(snapshot({ status: 'not_owned', revision: 41 }),
    { type: 'refresh', status: 'success' }));
  await flush();
  assert.strictEqual(lifecycle.app.fullGameRevision, 42,
    'a delayed start query cannot overwrite a newer foreground result');
  assert.strictEqual(lifecycle.app.fullGameSnapshot.status, 'owned_verified');
  lifecycle.store.enqueue('refresh', () => Promise.reject(new Error('store unavailable')));
  lifecycle.raw.show({ scene: 1001 });
  await flush();
  assert.strictEqual(lifecycle.app.fullGameSnapshot.status, 'owned_verified',
    'a later refresh failure cannot synthesize revocation');
  assert.strictEqual(lifecycle.app.scene, 'home');
  assert.strictEqual(lifecycle.app.runner, null,
    'background entitlement refreshes never auto-enter content');
  assert.deepStrictEqual(lifecycle.store.calls.filter(call => call.method === 'refresh')
    .map(call => call.reason), ['start', 'foreground', 'foreground']);
  lifecycle.app.dispose();

  gated.app.scene = 'home';
  gated.app.performAction('home:account');
  gated.app.tick(Date.now() + 1);
  assert(gated.app.renderer.hits.some(hit => hit.id === 'store:restorePurchases'),
    'restore remains discoverable from the account screen');
  assert(gated.raw.show, 'the App lifecycle listener is installed');
  gated.raw.show({ scene: 1001 });
  await flush();
  assert(gated.store.calls.some(call => call.method === 'refresh' && call.reason === 'start'));
  assert(gated.store.calls.some(call => call.method === 'refresh' && call.reason === 'foreground'));
  gated.app.dispose();
  assert.strictEqual(gated.store.unsubscribeCalls, 1);
  assert.strictEqual(gated.store.listenerCount(), 0,
    'disposing the App removes its provider subscription');
  assert.strictEqual(gated.store.disposeCalls, 0,
    'disposing a shared App only unbinds; the host still owns the provider');
  const disposedRevision = gated.app.fullGameRevision;
  gated.store.publish(snapshot({ status: 'owned_verified', revision: disposedRevision + 100,
    transactionId: 'disposed-app', verifiedAt: 300 }));
  assert.strictEqual(gated.app.fullGameRevision, disposedRevision,
    'an invalidated App instance no longer consumes provider events');

  const operations = fixture(snapshot({ revision: 10 }));
  completeFreePreview(operations.app);
  operations.app.start();
  await flush();
  operations.app.openLevel(1, 4);
  const unchanged = {
    progress: clone(operations.app.progress.state),
    currency: clone(operations.app.rewardUnlocks.view()),
    staminaCalls: operations.unlockCalls()
  };

  operations.store.enqueue('purchase', result(snapshot({ status: 'pending', revision: 11 }),
    { type: 'purchase', status: 'pending' }));
  await operations.app.performAction('store:purchaseFullGame');
  assert.strictEqual(operations.app.fullGameSnapshot.status, 'pending');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'pending');
  assert.deepStrictEqual(operations.app.progress.state, unchanged.progress);
  assert.deepStrictEqual(operations.app.rewardUnlocks.view(), unchanged.currency);
  assert.strictEqual(operations.unlockCalls(), unchanged.staminaCalls);

  operations.store.enqueue('purchase', result(snapshot({ status: 'not_owned', revision: 12 }),
    { type: 'purchase', status: 'cancelled' }));
  await operations.app.performAction('store:purchaseFullGame');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'cancelled');
  assert.strictEqual(operations.app.checkContentAccess({ type: 'level', setIndex: 1, levelIndex: 4 }).allowed, false);
  assert.deepStrictEqual(operations.app.progress.state, unchanged.progress);
  assert.deepStrictEqual(operations.app.rewardUnlocks.view(), unchanged.currency);
  assert.strictEqual(operations.unlockCalls(), unchanged.staminaCalls);
  operations.store.publish(snapshot({ status: 'owned_verified', revision: 12,
    transactionId: 'duplicate-revision', verifiedAt: 120 }));
  assert.strictEqual(operations.app.fullGameSnapshot.status, 'not_owned',
    'a duplicate revision cannot replace an already accepted snapshot');

  operations.store.enqueue('purchase', () => Promise.reject(new Error('provider persist failed')));
  await operations.app.performAction('store:purchaseFullGame');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'failed');
  assert.strictEqual(operations.app.storeDialog.operation.retryable, true);
  assert.deepStrictEqual(operations.app.progress.state, unchanged.progress);
  assert.deepStrictEqual(operations.app.rewardUnlocks.view(), unchanged.currency);
  assert.strictEqual(operations.unlockCalls(), unchanged.staminaCalls);

  operations.store.enqueue('restore', result(snapshot({ status: 'pending', revision: 13 }),
    { type: 'restore', status: 'pending' }));
  await operations.app.performAction('store:restorePurchases');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'pending');
  assert.strictEqual(operations.app.storeDialogView().message, operations.app.t('store.operation.pending'));
  assert.strictEqual(operations.app.checkContentAccess({ type: 'level', setIndex: 1, levelIndex: 4 }).allowed, false);
  assert.strictEqual(operations.app.scene, 'home');
  assert.strictEqual(operations.app.runner, null);

  operations.store.enqueue('restore', result(snapshot({ status: 'not_owned', revision: 14 }),
    { type: 'restore', status: 'not_found' }));
  await operations.app.performAction('store:restorePurchases');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'not_found');
  assert.strictEqual(operations.app.storeDialogView().message, operations.app.t('store.operation.not_found'));

  operations.store.enqueue('restore', result(snapshot({ status: 'not_owned', revision: 15 }),
    { type: 'restore', status: 'failed', retryable: false }));
  await operations.app.performAction('store:restorePurchases');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'failed');
  assert.strictEqual(operations.app.storeDialog.operation.retryable, false);
  assert.strictEqual(operations.app.storeDialogView().retryAction, null,
    'an explicit non-retryable provider failure cannot expose a retry action');
  assert.strictEqual(operations.app.storeDialogView().message, operations.app.t('store.operation.failed'));

  operations.store.enqueue('restore', result(snapshot({ status: 'not_owned', revision: 16 }),
    { type: 'restore', status: 'failed', retryable: true }));
  await operations.app.performAction('store:restorePurchases');
  assert.strictEqual(operations.app.storeDialog.operation.retryable, true);
  assert.strictEqual(operations.app.storeDialogView().retryAction, 'store:retry');
  assert.deepStrictEqual(operations.app.progress.state, unchanged.progress);
  assert.deepStrictEqual(operations.app.rewardUnlocks.view(), unchanged.currency);
  assert.strictEqual(operations.unlockCalls(), unchanged.staminaCalls);

  const pendingPurchase = deferred();
  operations.store.enqueue('purchase', pendingPurchase.promise);
  const purchaseTask = operations.app.performAction('store:purchaseFullGame');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'working');
  assert.strictEqual(operations.app.performAction('store:purchaseFullGame'), false,
    'a repeated action cannot start a second concurrent provider request');
  operations.app.performAction('store:close');
  pendingPurchase.resolve(result(snapshot({ status: 'owned_verified', revision: 20,
    transactionId: 'late-owned', verifiedAt: 200 }), { type: 'purchase', status: 'success' }));
  await purchaseTask;
  assert.strictEqual(operations.app.storeDialog, null,
    'closing the panel discards stale UI feedback');
  assert.strictEqual(operations.app.fullGameSnapshot.status, 'owned_verified',
    'closing the panel does not discard a valid provider update');
  assert.strictEqual(operations.app.scene, 'home');
  assert.strictEqual(operations.app.runner, null);
  operations.store.publish(snapshot({ status: 'revoked', revision: 19 }));
  assert.strictEqual(operations.app.fullGameSnapshot.status, 'owned_verified');

  operations.store.publish(snapshot({ status: 'revoked', revision: 22 }));
  operations.app.scene = 'home';
  operations.app.runner = null;
  operations.app.runContext = null;
  assert.strictEqual(operations.app.openLevel(1, 4), false);
  const scenePurchase = deferred();
  operations.store.enqueue('purchase', scenePurchase.promise);
  const scenePurchaseTask = operations.app.performAction('store:purchaseFullGame');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'working');
  assert.strictEqual(operations.app.openLevel(0, 0), true,
    'a direct valid scene transition remains possible for the host');
  assert.strictEqual(operations.app.scene, 'play');
  assert.strictEqual(operations.app.storeDialog, null,
    'changing scene immediately invalidates the old store panel');
  scenePurchase.resolve(result(snapshot({ status: 'owned_verified', revision: 23,
    transactionId: 'scene-owned', verifiedAt: 230 }), { type: 'purchase', status: 'success' }));
  await scenePurchaseTask;
  assert.strictEqual(operations.app.storeDialog, null,
    'a late operation cannot write feedback into the discarded panel');
  assert.strictEqual(operations.app.fullGameSnapshot.status, 'owned_verified',
    'scene invalidation still consumes the provider-owned entitlement snapshot');
  const beforeRestoreSuccess = {
    progress: clone(operations.app.progress.state),
    currency: clone(operations.app.rewardUnlocks.view()),
    staminaCalls: operations.unlockCalls()
  };

  operations.store.enqueue('restore', result(snapshot({ status: 'owned_verified', revision: 24,
    transactionId: 'restored', verifiedAt: 240 }), { type: 'restore', status: 'success' }));
  const restoreCallsBeforeSuccess = operations.store.calls.filter(call => call.method === 'restore').length;
  operations.app.scene = 'account';
  operations.app.runner = null;
  operations.app.runContext = null;
  await operations.app.performAction('store:restorePurchases');
  assert.strictEqual(operations.store.calls.filter(call => call.method === 'restore').length,
    restoreCallsBeforeSuccess + 1);
  assert(operations.app.storeDialog, 'direct restore opens the same shared panel');
  assert.strictEqual(operations.app.storeDialog.operation.status, 'success');
  assert.strictEqual(operations.app.fullGameSnapshot.status, 'owned_verified');
  assert.strictEqual(operations.app.fullGameSnapshot.revision, 24);
  assert.strictEqual(operations.app.scene, 'account', 'restore success never auto-enters content');
  assert.strictEqual(operations.app.runner, null);
  assert.deepStrictEqual(operations.app.progress.state, beforeRestoreSuccess.progress);
  assert.deepStrictEqual(operations.app.rewardUnlocks.view(), beforeRestoreSuccess.currency);
  assert.strictEqual(operations.unlockCalls(), beforeRestoreSuccess.staminaCalls);
  operations.app.dispose();
}

module.exports = run;
