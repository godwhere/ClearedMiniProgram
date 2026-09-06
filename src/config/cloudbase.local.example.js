'use strict';

// Copy to cloudbase.local.js (Git-ignored) only after the test deployment and
// permissions are verified. Release/unknown runtimes never load this override.
module.exports = {
  enabled: false,
  env: '',
  identityEnabled: false,
  readEnabled: false,
  migrationEnabled: false,
  writeEnabled: false,
  economyEnabled: false,
  staminaEnabled: false,
  preferencesEnabled: false,
  // Optional Stage 4 develop/trial acceptance aid. Use an existing manifest
  // date such as 2026-09-01, then remove it after the daily sync check.
  dailyTestDateKey: '',
  testOnly: true
};
