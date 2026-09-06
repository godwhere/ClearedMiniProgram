'use strict';

const SyncStore = require('../../src/services/sync-store.js');
const ProgressStore = require('../../src/services/progress-store.js');
const DailyStore = require('../../src/services/daily-progress-store.js');
const Rewards = require('../../src/services/reward-unlock-service.js');
const SessionStore = require('../../src/services/session-store.js');
const Stamina = require('../../src/services/stamina-service.js');
const Applier = require('../../src/services/authoritative-state-applier.js');
const rewardConfig = require('../../src/config/rewards.js');
const { RewardPlatform } = require('../helpers/reward-fixture.js');

function revisions(value) {
  return Object.fromEntries(SyncStore.DOMAINS.map(domain => [domain,
    value && value[domain] !== undefined ? value[domain] : 0]));
}

function setup(options = {}) {
  const platform = options.platform || new RewardPlatform(); const store = new SyncStore(platform);
  const progress = new ProgressStore(platform); const daily = new DailyStore(platform);
  const rewards = new Rewards(platform, rewardConfig); const stamina = new Stamina(platform);
  const sessions = new SessionStore(platform);
  assertScope(store);
  const guard = {
    capture() {
      const scope = store.context();
      return { ownerIdAtStart: scope.ownerId, bindingEpochAtStart: scope.bindingEpoch,
        environmentIdAtStart: scope.environmentId, activationSequenceAtStart: scope.activationSequence,
        accountGenerationAtStart: 1, identityAtStart: 'cloud:test-env:player_A:1' };
    },
    matches(token) {
      const scope = store.context();
      return !!token && token.ownerIdAtStart === scope.ownerId && token.bindingEpochAtStart === scope.bindingEpoch &&
        token.environmentIdAtStart === scope.environmentId && token.activationSequenceAtStart === scope.activationSequence;
    }
  };
  const applier = new Applier({ progress, daily, rewards, stamina, syncStore: store, sessions }, guard);
  const auth = { mode: 'cloud', readOnlyPhase: false, current: () => ({ mode: 'cloud', ownerId: 'player_A',
    bindingEpoch: 1, environmentId: 'test-env', generation: 1 }) };
  return { platform, store, progress, daily, rewards, stamina, sessions, guard, applier, auth };
}

function assertScope(store) {
  if (!store.activateScope('player_A', 1, 'test-env', true).ok) throw Error('scope');
  store.state.localOwnerId = 'player_A'; store.state.localEnvironmentId = 'test-env';
  if (!store.save() || !store.setAuthorityMode('cloud-authoritative', store.context())) throw Error('authority');
}

function player(state, hasCloud = true) {
  return { playerId: 'player_A', bindingEpoch: 1, migrationState: hasCloud ? 'complete' : 'none',
    hasCloudState: hasCloud, completedDomains: hasCloud ? SyncStore.CORE_DOMAINS.slice() : [],
    deferredDomains: ['stamina', 'preferences'], migrationImportId: hasCloud ? 'import_one' : null,
    migrationReceiptId: hasCloud ? 'migration_one' : null };
}

function envelope(requestId, data, revisionValues) {
  return { ok: true, code: 'OK', protocolVersion: 1, requestId, retryable: false,
    environmentId: 'test-env', serverTimeMs: Date.parse('2026-09-03T16:00:00.000Z'),
    serverDateKey: '2026-09-04', player: player(revisionValues !== false),
    revisions: revisions(revisionValues || {}), data };
}

function core(balance, levels) {
  return { progress: { schemaVersion: 1, levels: levels || {}, lastPlayed: null },
    daily: { schemaVersion: 1, days: {} },
    economy: { schemaVersion: 1, balance: balance || 0, claimedOrdinary: {}, claimedDaily: {} },
    entitlements: { schemaVersion: 1, ownedRewards: { 'theme:classic': true, 'effect:none': true } } };
}

module.exports = { setup, revisions, player, envelope, core };
