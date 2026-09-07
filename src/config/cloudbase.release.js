'use strict';

// Authorized full-player review candidate, using the existing cloud settlement
// protocol. Only release reads this lane; local-backup is a separate switch.
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
  testOnly: false,
  productionOnly: true
};
