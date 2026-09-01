'use strict';

const assert = require('assert');
const portal = require('../src/mechanics/portal.js');
const portalDemo = require('../data/portal-demo.js');
const portalSolutions = require('../data/portal-solutions.js');

function run() {
  assert.deepStrictEqual({
    id: portal.id,
    kind: portal.kind,
    mechanic: portal.mechanic,
    rulesVersion: portal.rulesVersion,
    trialAction: portal.trial.action
  }, {
    id: 'portal',
    kind: 'gameplay-extension',
    mechanic: 'portal',
    rulesVersion: 1,
    trialAction: 'home:portalTrial'
  }, 'published portal manifest contract must remain stable');
  assert.strictEqual(portal.trial.set, portalDemo);
  assert.strictEqual(portal.trial.solutions, portalSolutions);
}

module.exports = run;
