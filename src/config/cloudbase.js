'use strict';

// Checked-in defaults never connect to a cloud environment. Phase 3 supports
// only an explicit develop/trial identity + read-only local override.
module.exports = {
  schemaVersion: 1,
  enabled: false,
  env: '',
  identityEnabled: false,
  readEnabled: false,
  writeEnabled: false,
  migrationEnabled: false,
  economyEnabled: false,
  staminaEnabled: false,
  preferencesEnabled: false,
  testOnly: true,
  functions: {
    identity: 'identity-api',
    playerState: 'player-state-api',
    economy: 'economy-api'
  },
  timeoutMs: 8000
};
