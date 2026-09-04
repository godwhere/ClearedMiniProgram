'use strict';

// Phase 1 is a disabled client seam, not a deployed identity or save service.
module.exports = {
  enabled: false,
  env: '',
  functions: {
    identity: 'identity-api',
    playerState: 'player-state-api',
    economy: 'economy-api'
  },
  timeoutMs: 8000
};
