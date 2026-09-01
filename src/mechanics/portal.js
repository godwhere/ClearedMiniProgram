'use strict';

const trialSet = require('../../data/portal-demo.js');
const solutions = require('../../data/portal-solutions.js');

// Data-only definition for the portal gameplay extension.  Gameplay
// extensions are intentionally separate from themes and clear effects: they
// may change board topology and rule-state, while visual registries may not.
module.exports = Object.freeze({
  id: 'portal',
  name: '传送门',
  kind: 'gameplay-extension',
  mechanic: 'portal',
  rulesVersion: 1,
  icon: 'assets/icons/portal.png',
  enabled: true,
  trial: Object.freeze({
    label: '传送门试玩',
    action: 'home:portalTrial',
    set: trialSet,
    solutions
  })
});
