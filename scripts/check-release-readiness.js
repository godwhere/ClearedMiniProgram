#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { isIgnored } = require('./check-package-budget.js');

const APPROVED_SINGLE_ENVIRONMENT_ID = 'cloudbase-d9gpluqt21ba89532';
const GATES = Object.freeze(['identityEnabled', 'readEnabled', 'writeEnabled', 'migrationEnabled',
  'economyEnabled', 'staminaEnabled', 'preferencesEnabled']);
const validEnvironment = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function auditRelease(input) {
  const failures = [];
  const daily = input.daily || {}; const internal = input.internal || {}; const release = input.release || {}; const ads = input.ads || {};
  const mode = input.mode || 'closed';
  if (daily.debugUnlimitedEntries !== false) failures.push('daily-debug-unlimited');
  if (release.testOnly !== false || release.productionOnly !== true) failures.push('production-runtime-boundary');
  // The test-only lane may explicitly exercise first-save migration. Its
  // switches never authorize release; the release gates are checked below.
  if (internal.enabled !== true || internal.env !== APPROVED_SINGLE_ENVIRONMENT_ID ||
      internal.testOnly !== true || internal.productionOnly !== false || typeof internal.migrationEnabled !== 'boolean' ||
      ['identityEnabled', 'readEnabled', 'writeEnabled', 'economyEnabled', 'staminaEnabled', 'preferencesEnabled']
        .some(key => internal[key] !== true)) failures.push('internal-preview-boundary');
  if (!GATES.every(key => typeof release[key] === 'boolean') || typeof release.enabled !== 'boolean') {
    failures.push('cloud-gate-shape');
  }
  if (!validEnvironment(release.env)) failures.push('production-env-missing');
  else if (release.env !== APPROVED_SINGLE_ENVIRONMENT_ID) failures.push('production-env-not-approved');
  if (input.localOverridePresent && !input.localOverrideIgnored) failures.push('local-test-override-would-be-packaged');
  const rules = ads.rules || {}; const rewarded = ads.rewarded || {}; const interstitial = ads.interstitial || {};
  if (rules.hintRewardedEnabled === true && !rewarded.hint) failures.push('hint-ad-unit-missing');
  if (rules.rewardUnlockRewardedEnabled === true && !rewarded.rewardUnlock) failures.push('reward-ad-unit-missing');
  if (rules.dailyExtraEntryEnabled === true && !rewarded.dailyExtraEntry) failures.push('daily-ad-unit-missing');
  if (rules.interstitialEveryClears > 0 && interstitial.levelComplete === '' && input.interstitialEnabled === true) {
    failures.push('interstitial-ad-unit-missing');
  }
  if (mode === 'closed') {
    if (release.enabled !== false || GATES.some(key => release[key] !== false)) failures.push('closed-release-gates-open');
  } else if (mode === 'rollout') {
    if (release.enabled !== true || release.identityEnabled !== true || release.readEnabled !== true ||
        release.writeEnabled !== true || release.migrationEnabled !== true || release.economyEnabled !== true ||
        release.staminaEnabled !== true || release.preferencesEnabled !== true) failures.push('rollout-release-gates-incomplete');
    if (release.localBackupEnabled !== false) failures.push('rollout-save-protocol-mismatch');
  } else failures.push('unknown-release-mode');
  return { ready: failures.length === 0, mode, failures };
}

function inspect(projectRoot, mode) {
  const project = JSON.parse(fs.readFileSync(path.join(projectRoot, 'project.config.json'), 'utf8'));
  const override = 'src/config/cloudbase.local.js';
  const defaults = require(path.join(projectRoot, 'src/config/cloudbase.js'));
  const internal = Object.assign({}, defaults, require(path.join(projectRoot, 'src/config/cloudbase.internal.js')));
  const release = Object.assign({}, defaults, require(path.join(projectRoot, 'src/config/cloudbase.release.js')));
  return auditRelease({
    mode,
    daily: require(path.join(projectRoot, 'src/config/daily.js')),
    internal,
    release,
    ads: require(path.join(projectRoot, 'src/config/ads.js')),
    localOverridePresent: fs.existsSync(path.join(projectRoot, override)),
    localOverrideIgnored: isIgnored(override, project.packOptions.ignore),
    interstitialEnabled: false
  });
}

if (require.main === module) {
  const args = process.argv.slice(2); const index = args.indexOf('--mode');
  const mode = index >= 0 ? args[index + 1] : 'closed';
  const result = inspect(path.resolve(__dirname, '..'), mode);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
}

module.exports = { APPROVED_SINGLE_ENVIRONMENT_ID, GATES, validEnvironment, auditRelease, inspect };
