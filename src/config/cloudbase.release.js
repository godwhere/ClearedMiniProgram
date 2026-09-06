'use strict';

// Checked-in production lane. The existing CloudBase environment was
// explicitly approved as the game's single environment; cloud gates remain
// closed until the internal rollout is deployed and its final device checks pass.
module.exports = {
  enabled: false,
  env: 'cloudbase-d9gpluqt21ba89532',
  identityEnabled: false,
  readEnabled: false,
  writeEnabled: false,
  migrationEnabled: false,
  economyEnabled: false,
  staminaEnabled: false,
  preferencesEnabled: false,
  testOnly: false,
  productionOnly: true
};
