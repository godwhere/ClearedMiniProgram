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
  const release = cloudConfigForEnvironment('release');
  assert.strictEqual(release.enabled, false);
  assert.strictEqual(release.migrationEnabled, false);
  assert.strictEqual(release.testOnly, false);
  assert.strictEqual(release.productionOnly, true);
  assert.strictEqual(cloudConfigForEnvironment('unknown').enabled, false);
};
