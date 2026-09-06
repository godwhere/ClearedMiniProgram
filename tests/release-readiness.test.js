'use strict';

const assert = require('assert');
const { auditRelease } = require('../scripts/check-release-readiness.js');

const ads = { rewarded: { hint: '', rewardUnlock: '', dailyExtraEntry: '' },
  interstitial: { levelComplete: '' }, rules: { hintRewardedEnabled: false,
    rewardUnlockRewardedEnabled: false, dailyExtraEntryEnabled: false, interstitialEveryClears: 4 } };
const release = { enabled: false, env: 'cloudbase-d9gpluqt21ba89532', testOnly: false, productionOnly: true,
  identityEnabled: false, readEnabled: false, writeEnabled: false, migrationEnabled: false,
  economyEnabled: false, staminaEnabled: false, preferencesEnabled: false };
const internal = { enabled: true, env: 'cloudbase-d9gpluqt21ba89532', testOnly: true, productionOnly: false,
  identityEnabled: true, readEnabled: true, writeEnabled: true, migrationEnabled: false,
  economyEnabled: true, staminaEnabled: true, preferencesEnabled: true };

module.exports = function run() {
  const base = { mode: 'closed', daily: { debugUnlimitedEntries: false }, internal, release, ads,
    localOverridePresent: false, localOverrideIgnored: false, interstitialEnabled: false };
  assert.deepStrictEqual(auditRelease(base), { ready: true, mode: 'closed', failures: [] });
  assert.deepStrictEqual(auditRelease(Object.assign({}, base, {
    internal: Object.assign({}, internal, { migrationEnabled: true })
  })), { ready: true, mode: 'closed', failures: [] },
  'explicit internal onboarding must not require opening the release lane');
  for (const [change, reason] of [
    [{ daily: { debugUnlimitedEntries: true } }, 'daily-debug-unlimited'],
    [{ release: Object.assign({}, release, { env: '' }) }, 'production-env-missing'],
    [{ release: Object.assign({}, release, { env: 'cloudbase-other' }) }, 'production-env-not-approved'],
    [{ release: Object.assign({}, release, { testOnly: true }) }, 'production-runtime-boundary'],
    [{ internal: Object.assign({}, internal, { productionOnly: true }) }, 'internal-preview-boundary'],
    [{ internal: Object.assign({}, internal, { migrationEnabled: 'true' }) }, 'internal-preview-boundary'],
    [{ localOverridePresent: true }, 'local-test-override-would-be-packaged']
  ]) assert(auditRelease(Object.assign({}, base, change)).failures.includes(reason));
  const rollout = Object.assign({}, release, { enabled: true, identityEnabled: true, readEnabled: true,
    writeEnabled: true, migrationEnabled: true, economyEnabled: true, staminaEnabled: true,
    preferencesEnabled: true });
  assert.deepStrictEqual(auditRelease(Object.assign({}, base, { mode: 'rollout', release: rollout })),
    { ready: true, mode: 'rollout', failures: [] });
  assert(auditRelease(Object.assign({}, base, { mode: 'rollout' })).failures.includes('rollout-release-gates-incomplete'));
  assert(auditRelease(Object.assign({}, base, { mode: 'other' })).failures.includes('unknown-release-mode'));
};
