'use strict';

const assert = require('assert');
const { cloudConfigForEnvironment } = require('../src/bootstrap.js');

module.exports = function run() {
  const local = { enabled: true, env: 'local-develop', identityEnabled: true };
  assert.strictEqual(cloudConfigForEnvironment('develop', () => local).env, 'local-develop');
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
  for (const lane of [release, cloudConfigForEnvironment('trial'), uploadedDevelop]) {
    for (const flag of ['enabled', 'identityEnabled', 'readEnabled', 'writeEnabled', 'migrationEnabled',
      'economyEnabled', 'staminaEnabled', 'preferencesEnabled']) assert.strictEqual(lane[flag], true, flag);
    assert.strictEqual(lane.localBackupEnabled, false, 'public admission does not switch save protocols');
  }
  assert.strictEqual(release.testOnly, false);
  assert.strictEqual(release.productionOnly, true);
  assert.strictEqual(cloudConfigForEnvironment('unknown').enabled, false);
};
