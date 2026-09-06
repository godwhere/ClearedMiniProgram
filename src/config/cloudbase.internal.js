'use strict';

// Checked-in Phase 6 internal preview lane. It is selected by trial, or by an
// uploaded QR preview reported as develop after the local override is removed.
// CloudFunctionTransport independently rejects it in release.
module.exports = {
  enabled: true,
  env: 'cloudbase-d9gpluqt21ba89532',
  identityEnabled: true,
  readEnabled: true,
  writeEnabled: true,
  migrationEnabled: false,
  economyEnabled: true,
  staminaEnabled: true,
  preferencesEnabled: true,
  testOnly: true,
  productionOnly: false
};
