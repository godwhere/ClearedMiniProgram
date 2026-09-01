'use strict';

const assert = require('assert');
const portal = require('../src/mechanics/portal.js');
const portalDemo = require('../data/portal-demo.js');
const portalSolutions = require('../data/portal-solutions.js');

function run() {
  assert.strictEqual(portal.kind, 'gameplay-extension');
  assert.strictEqual(portal.mechanic, 'portal');
  assert.strictEqual(portal.rulesVersion, 1);
  assert.strictEqual(portal.trial.action, 'home:portalTrial');
  assert.strictEqual(portal.trial.set, portalDemo);
  assert.strictEqual(portal.trial.solutions, portalSolutions);
}

module.exports = run;
