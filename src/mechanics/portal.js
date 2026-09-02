'use strict';

// Data-only definition for the portal gameplay extension.  Gameplay
// extensions are intentionally separate from themes and clear effects: they
// may change board topology and rule-state, while visual registries may not.
module.exports = Object.freeze({
  id: 'portal',
  name: '传送门',
  kind: 'gameplay-extension',
  mechanic: 'portal',
  rulesVersion: 2,
  supportedRulesVersions: Object.freeze([1, 2]),
  icon: 'assets/icons/portal.png',
  enabled: true
});
