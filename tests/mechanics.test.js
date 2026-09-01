'use strict';

const assert = require('assert');
const mechanics = require('../src/mechanics/index.js');
const portal = require('../src/mechanics/portal.js');
const coreMechanics = require('../core/mechanics/index.js');
const portalDemo = require('../data/portal-demo.js');
const portalSolutions = require('../data/portal-solutions.js');

function run() {
  assert.deepStrictEqual({
    id: portal.id,
    kind: portal.kind,
    mechanic: portal.mechanic,
    rulesVersion: portal.rulesVersion,
    supportedRulesVersions: portal.supportedRulesVersions,
    trialAction: portal.trial.action
  }, {
    id: 'portal',
    kind: 'gameplay-extension',
    mechanic: 'portal',
    rulesVersion: 2,
    supportedRulesVersions: [1, 2],
    trialAction: 'home:portalTrial'
  }, 'published portal manifest contract must remain stable');
  assert.strictEqual(portal.trial.set, portalDemo);
  assert.strictEqual(portal.trial.solutions, portalSolutions);
  assert(Object.isFrozen(portal.supportedRulesVersions),
    'supported portal rules versions must remain immutable');
  assert.deepStrictEqual(mechanics.all(), [portal]);
  assert.strictEqual(coreMechanics.supported('portal', 1), true);
  assert.strictEqual(coreMechanics.supported('portal', 2), true);
  assert.strictEqual(coreMechanics.supported('portal', 3), false);
  assert.strictEqual(coreMechanics.resolve('unknown', 1), null);
  assert(portalDemo.Games.every(game => game.PortalRulesVersion === portal.rulesVersion),
    'the published trial set must use the manifest current rules version');
  assert.strictEqual(mechanics.get('portal'), portal,
    'the definition registry resolves the stable portal id');
  assert.strictEqual(mechanics.get('unknown'), null,
    'unknown gameplay extensions are not executable');
  const definitions = mechanics.all();
  assert.deepStrictEqual(definitions, [portal]);
  definitions.length = 0;
  assert.deepStrictEqual(mechanics.all(), [portal],
    'registry enumeration returns a detached array');
}

module.exports = run;
