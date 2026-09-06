'use strict';

const assert = require('assert');
const EconomyService = require('../src/services/economy-service.js');
const ApiClient = require('../src/services/api-client.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const { setup, revisions, envelope } = require('./helpers/cloud-stage4-services.js');

module.exports = async function run() {
  const f = setup(); let first = true; const operationIds = [];
  const api = { request: async request => {
    operationIds.push(request.operationId);
    if (first) { first = false; return ApiClient.failure('timeout', 0, true); }
    return { ok: true, data: envelope(request.requestId, { receiptId: 'purchase_receipt',
      purchase: { operationId: request.operationId, status: 'PURCHASED', kind: 'theme', itemId: 'desserts', cost: 10000,
        balanceBefore: 10000, balanceAfter: 0, newEntitlements: ['theme:desserts'] },
      revisions: revisions({ economy: 1, entitlements: 1 }), domains: {
        economy: { schemaVersion: 1, balance: 0, claimedOrdinary: {}, claimedDaily: {} },
        entitlements: { schemaVersion: 1, ownedRewards: { 'theme:classic': true, 'effect:none': true, 'theme:desserts': true } }
      }, acceptedOperationIds: [], notificationHints: ['theme:desserts'] }, { economy: 1, entitlements: 1 }) };
  } };
  f.rewards.state.balance = 10000; f.rewards.write(f.rewards.state);
  const service = new EconomyService(f.platform, api, f.auth, f.store, f.rewards, f.applier); service.accountGuard = f.guard;
  const timed = await service.purchase('theme:desserts'); assert.strictEqual(timed.reason, 'network-required');
  assert.strictEqual(f.rewards.view().balance, 10000); assert.strictEqual(f.rewards.owned('theme:desserts'), false);
  const pending = service.pending('theme:desserts'); assert(pending);
  const original = f.auth.current;
  f.auth.current = () => ({ mode: 'cloud', ownerId: 'player_B', bindingEpoch: 1,
    environmentId: 'test-env', generation: 2 });
  assert.strictEqual(service.pending('theme:desserts'), undefined,
    'a different account cannot reuse another account purchase request');
  f.auth.current = original;
  assert.strictEqual(service.pending('theme:desserts').operationId, pending.operationId,
    'the original account retains its unknown-result purchase for retry');
  const restartedService = new EconomyService(f.platform, api, f.auth, f.store, f.rewards, f.applier);
  restartedService.accountGuard = f.guard;
  const assetWritesBeforeRecovery = f.platform.writes.filter(write =>
    write.key === RewardUnlockService.STORAGE_KEY).length;
  const recovered = await restartedService.recoverPending(); assert(recovered.ok);
  const bought = recovered.results[0]; assert(bought.ok);
  assert.deepStrictEqual(operationIds, [pending.operationId, pending.operationId], 'timeout retry reuses the durable operation id');
  const assetWrites = f.platform.writes.filter(write => write.key === RewardUnlockService.STORAGE_KEY);
  assert.strictEqual(assetWrites.length, assetWritesBeforeRecovery + 1,
    'one receipt persists economy and entitlements together in one asset write');
  assert.strictEqual(assetWrites[assetWrites.length - 1].value.balance, 0);
  assert.strictEqual(assetWrites[assetWrites.length - 1].value.ownedRewards['theme:desserts'], true);
  assert.strictEqual(f.rewards.view().balance, 0); assert(f.rewards.owned('theme:desserts'));
  assert.strictEqual(restartedService.pending('theme:desserts'), undefined);

  const badPrice = setup(); badPrice.rewards.state.balance = 10000; badPrice.rewards.write(badPrice.rewards.state);
  const badPriceApi = { request: async request => ({ ok: true, data: envelope(request.requestId, {
    receiptId: 'purchase_wrong_price',
    purchase: { operationId: request.operationId, status: 'PURCHASED', kind: 'theme', itemId: 'desserts', cost: 9999,
      balanceBefore: 10000, balanceAfter: 1, newEntitlements: ['theme:desserts'] },
    revisions: revisions({ economy: 1, entitlements: 1 }), domains: {
      economy: { schemaVersion: 1, balance: 1, claimedOrdinary: {}, claimedDaily: {} },
      entitlements: { schemaVersion: 1, ownedRewards: {
        'theme:classic': true, 'effect:none': true, 'theme:desserts': true } }
    }, acceptedOperationIds: [], notificationHints: ['theme:desserts']
  }, { economy: 1, entitlements: 1 }) }) };
  const strictPrice = new EconomyService(badPrice.platform, badPriceApi, badPrice.auth, badPrice.store,
    badPrice.rewards, badPrice.applier); strictPrice.accountGuard = badPrice.guard;
  const rejectedPrice = await strictPrice.purchase('theme:desserts');
  assert.strictEqual(rejectedPrice.reason, 'invalid-response');
  assert.strictEqual(badPrice.rewards.view().balance, 10000);
  assert.strictEqual(badPrice.rewards.owned('theme:desserts'), false);
  assert(strictPrice.pending('theme:desserts'), 'an untrusted price response keeps the same retryable request');

  const badBalance = setup(); badBalance.rewards.state.balance = 10000;
  badBalance.rewards.write(badBalance.rewards.state);
  const badBalanceApi = { request: async request => ({ ok: true, data: envelope(request.requestId, {
    receiptId: 'purchase_wrong_balance',
    purchase: { operationId: request.operationId, status: 'PURCHASED', kind: 'theme', itemId: 'desserts', cost: 10000,
      balanceBefore: 10000, balanceAfter: 0, newEntitlements: ['theme:desserts'] },
    revisions: revisions({ economy: 1, entitlements: 1 }), domains: {
      economy: { schemaVersion: 1, balance: 50, claimedOrdinary: {}, claimedDaily: {} },
      entitlements: { schemaVersion: 1, ownedRewards: {
        'theme:classic': true, 'effect:none': true, 'theme:desserts': true } }
    }, acceptedOperationIds: [], notificationHints: ['theme:desserts']
  }, { economy: 1, entitlements: 1 }) }) };
  const strictBalance = new EconomyService(badBalance.platform, badBalanceApi, badBalance.auth,
    badBalance.store, badBalance.rewards, badBalance.applier); strictBalance.accountGuard = badBalance.guard;
  const rejectedBalance = await strictBalance.purchase('theme:desserts');
  assert.strictEqual(rejectedBalance.reason, 'invalid-response');
  assert.strictEqual(badBalance.rewards.view().balance, 10000);
  assert.strictEqual(badBalance.rewards.owned('theme:desserts'), false);
  assert(strictBalance.pending('theme:desserts'), 'a mismatched wallet snapshot keeps the same retryable request');

  const missingAsset = setup(); missingAsset.rewards.state.balance = 10000; missingAsset.rewards.write(missingAsset.rewards.state);
  const missingAssetApi = { request: async request => ({ ok: true, data: envelope(request.requestId, {
    receiptId: 'purchase_missing_asset',
    purchase: { operationId: request.operationId, status: 'PURCHASED', kind: 'theme', itemId: 'desserts', cost: 10000,
      balanceBefore: 10000, balanceAfter: 0, newEntitlements: ['theme:desserts'] },
    revisions: revisions({ economy: 1, entitlements: 1 }), domains: {
      economy: { schemaVersion: 1, balance: 0, claimedOrdinary: {}, claimedDaily: {} },
      entitlements: { schemaVersion: 1, ownedRewards: { 'theme:classic': true, 'effect:none': true } }
    }, acceptedOperationIds: [], notificationHints: ['theme:desserts']
  }, { economy: 1, entitlements: 1 }) }) };
  const strictAsset = new EconomyService(missingAsset.platform, missingAssetApi, missingAsset.auth, missingAsset.store,
    missingAsset.rewards, missingAsset.applier); strictAsset.accountGuard = missingAsset.guard;
  const rejectedAsset = await strictAsset.purchase('theme:desserts');
  assert.strictEqual(rejectedAsset.reason, 'invalid-response');
  assert.strictEqual(missingAsset.rewards.view().balance, 10000);
  assert.strictEqual(missingAsset.rewards.owned('theme:desserts'), false);
  assert(strictAsset.pending('theme:desserts'), 'an inconsistent ownership snapshot keeps the purchase retryable');

  const alreadyOwned = setup(); alreadyOwned.rewards.state.balance = 250;
  alreadyOwned.rewards.write(alreadyOwned.rewards.state);
  let alreadyOwnedCalls = 0;
  const alreadyOwnedApi = { request: async request => {
    alreadyOwnedCalls++;
    return { ok: true, data: envelope(request.requestId, {
      receiptId: 'purchase_already_owned',
      purchase: { operationId: request.operationId, status: 'ALREADY_OWNED', kind: 'theme', itemId: 'desserts', cost: 10000,
        balanceBefore: 250, balanceAfter: 250, newEntitlements: [] },
      revisions: revisions({ economy: 1, entitlements: 1 }), domains: {
        economy: { schemaVersion: 1, balance: 250, claimedOrdinary: {}, claimedDaily: {} },
        entitlements: { schemaVersion: 1, ownedRewards: {
          'theme:classic': true, 'effect:none': true, 'theme:desserts': true } }
      }, acceptedOperationIds: [], notificationHints: []
    }, { economy: 1, entitlements: 1 }) };
  } };
  const idempotentPurchase = new EconomyService(alreadyOwned.platform, alreadyOwnedApi, alreadyOwned.auth,
    alreadyOwned.store, alreadyOwned.rewards, alreadyOwned.applier);
  idempotentPurchase.accountGuard = alreadyOwned.guard;
  const ownedResult = await idempotentPurchase.purchase('theme:desserts');
  assert(ownedResult.ok); assert.strictEqual(ownedResult.reason, 'already-owned');
  assert.strictEqual(ownedResult.alreadyApplied, true); assert.strictEqual(ownedResult.amountDelta, 0);
  assert.strictEqual(alreadyOwnedCalls, 1); assert.strictEqual(alreadyOwned.rewards.view().balance, 250);
  assert.strictEqual(alreadyOwned.rewards.owned('theme:desserts'), true);
  assert.strictEqual(idempotentPurchase.pending('theme:desserts'), undefined);

  const interrupted = setup(); interrupted.rewards.state.balance = 10000;
  interrupted.rewards.write(interrupted.rewards.state);
  const interruptedOperationIds = []; let interruptedReplies = 0;
  const interruptedApi = { request: async request => {
    interruptedOperationIds.push(request.operationId); interruptedReplies++;
    const purchased = interruptedReplies === 1;
    return { ok: true, data: envelope(request.requestId, {
      receiptId: purchased ? 'purchase_before_restart' : 'purchase_after_restart',
      purchase: { operationId: request.operationId, status: purchased ? 'PURCHASED' : 'ALREADY_OWNED',
        kind: 'theme', itemId: 'desserts', cost: 10000,
        balanceBefore: purchased ? 10000 : 0, balanceAfter: 0,
        newEntitlements: purchased ? ['theme:desserts'] : [] },
      revisions: revisions({ economy: 1, entitlements: 1 }), domains: {
        economy: { schemaVersion: 1, balance: 0, claimedOrdinary: {}, claimedDaily: {} },
        entitlements: { schemaVersion: 1, ownedRewards: {
          'theme:classic': true, 'effect:none': true, 'theme:desserts': true } }
      }, acceptedOperationIds: [], notificationHints: purchased ? ['theme:desserts'] : []
    }, { economy: 1, entitlements: 1 }) };
  } };
  const setStorage = interrupted.platform.setStorage.bind(interrupted.platform);
  let requestStateWrites = 0;
  interrupted.platform.setStorage = (key, value) => {
    if (key === EconomyService.STORAGE_KEY && ++requestStateWrites === 2) return false;
    return setStorage(key, value);
  };
  const interruptedService = new EconomyService(interrupted.platform, interruptedApi, interrupted.auth,
    interrupted.store, interrupted.rewards, interrupted.applier); interruptedService.accountGuard = interrupted.guard;
  const cleanupFailed = await interruptedService.purchase('theme:desserts');
  assert.strictEqual(cleanupFailed.reason, 'persist-failed');
  const interruptedPending = interruptedService.pending('theme:desserts'); assert(interruptedPending);
  assert.strictEqual(interrupted.rewards.view().balance, 0); assert(interrupted.rewards.owned('theme:desserts'));

  const afterRestart = new EconomyService(interrupted.platform, interruptedApi, interrupted.auth,
    interrupted.store, interrupted.rewards, interrupted.applier); afterRestart.accountGuard = interrupted.guard;
  const resumedPurchase = await afterRestart.recoverPending();
  assert(resumedPurchase.ok); assert.strictEqual(resumedPurchase.results[0].reason, 'already-owned');
  assert.deepStrictEqual(interruptedOperationIds,
    [interruptedPending.operationId, interruptedPending.operationId]);
  assert.strictEqual(interrupted.rewards.view().balance, 0);
  assert.strictEqual(afterRestart.pending('theme:desserts'), undefined);

};
