'use strict';

const assert = require('assert');
const { cloudConfigForEnvironment } = require('../src/bootstrap.js');
const defaults = require('../src/config/cloudbase.js');
const internal = require('../src/config/cloudbase.internal.js');
const releaseConfig = require('../src/config/cloudbase.release.js');

module.exports = function run() {
  const sourcesBefore = [defaults, internal, releaseConfig].map(value => JSON.stringify(value));
  const local = { enabled: true, env: 'local-develop', identityEnabled: true,
    localBackupEnabled: true };
  const localBefore = JSON.stringify(local);
  const develop = cloudConfigForEnvironment('develop', () => local);
  assert.strictEqual(develop.env, 'local-develop');
  assert.strictEqual(develop.localBackupEnabled, false,
    'a developer override cannot enable a second settlement protocol');
  assert.strictEqual(JSON.stringify(local), localBefore, 'config selection never mutates the supplied override');
  const uploadedDevelop = cloudConfigForEnvironment('develop', () => { throw Error('not packaged'); });
  assert.strictEqual(uploadedDevelop.enabled, true);
  assert.strictEqual(uploadedDevelop.env, 'cloudbase-d9gpluqt21ba89532');
  assert.strictEqual(uploadedDevelop.testOnly, true);
  assert.strictEqual(uploadedDevelop.productionOnly, false);
  assert.strictEqual(uploadedDevelop.economyEnabled, true);
  assert.strictEqual(uploadedDevelop.migrationEnabled, require('../src/config/cloudbase.internal.js').migrationEnabled);
  assert.strictEqual(cloudConfigForEnvironment('trial').enabled, true);
  assert.strictEqual(cloudConfigForEnvironment('trial').migrationEnabled, uploadedDevelop.migrationEnabled);
  assert.strictEqual(cloudConfigForEnvironment('trial').testOnly, true);
  const release = cloudConfigForEnvironment('release', () => { throw Error('release must never read local config'); });
  const trial = cloudConfigForEnvironment('trial');
  const unknown = cloudConfigForEnvironment('unknown');
  for (const lane of [release, trial, uploadedDevelop, unknown]) {
    assert.strictEqual(lane.localBackupEnabled, false,
      'every normal runtime lane keeps the backup settlement protocol unreachable');
  }
  for (const lane of [release, trial, uploadedDevelop]) {
    for (const flag of ['enabled', 'identityEnabled', 'readEnabled', 'writeEnabled', 'migrationEnabled',
      'economyEnabled', 'staminaEnabled', 'preferencesEnabled']) assert.strictEqual(lane[flag], true, flag);
  }
  assert.strictEqual(release.testOnly, false);
  assert.strictEqual(release.productionOnly, true);
  assert.strictEqual(unknown.enabled, false);
  assert.notStrictEqual(unknown, defaults, 'unknown runtime selection returns an isolated config object');
  assert.deepStrictEqual([defaults, internal, releaseConfig].map(value => JSON.stringify(value)), sourcesBefore,
    'environment selection never mutates an imported config object');
};
