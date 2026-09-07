'use strict';

// Review preview lane, including first-time player onboarding. Selected by
// trial or an uploaded develop preview; rejected by the release runtime.
module.exports = {
  enabled: true,
  env: 'cloudbase-d9gpluqt21ba89532',
  identityEnabled: true,
  readEnabled: true,
  writeEnabled: true,
  migrationEnabled: true,
  economyEnabled: true,
  staminaEnabled: true,
  preferencesEnabled: true,
  localBackupEnabled: false,
  testOnly: true,
  productionOnly: false
};
