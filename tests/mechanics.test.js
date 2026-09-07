'use strict';

const assert = require('assert');
const mechanics = require('../src/mechanics/index.js');
const portal = require('../src/mechanics/portal.js');
const ice = require('../src/mechanics/ice.js');
const coreMechanics = require('../core/mechanics/index.js');

function run() {
  assert.deepStrictEqual({
    id: portal.id,
    kind: portal.kind,
    mechanic: portal.mechanic,
    rulesVersion: portal.rulesVersion,
    supportedRulesVersions: portal.supportedRulesVersions
  }, {
    id: 'portal',
    kind: 'gameplay-extension',
    mechanic: 'portal',
    rulesVersion: 2,
    supportedRulesVersions: [1, 2]
  }, 'published portal manifest contract must remain stable');
  assert.strictEqual(portal.trial, undefined, 'retired trial content is not part of the mechanic definition');
  assert(Object.isFrozen(portal.supportedRulesVersions),
    'supported portal rules versions must remain immutable');
  assert.deepStrictEqual(mechanics.all(), [portal, ice]);
  assert.strictEqual(mechanics.get('ice'), ice);
  assert.strictEqual(coreMechanics.supported('ice', 1), true);
  assert.strictEqual(coreMechanics.supported('ice', 2), false);
  assert.strictEqual(coreMechanics.supported('portal', 1), true);
  assert.strictEqual(coreMechanics.supported('portal', 2), true);
  assert.strictEqual(coreMechanics.supported('portal', 3), false);
  assert.strictEqual(coreMechanics.resolve('unknown', 1), null);
  assert.strictEqual(mechanics.get('portal'), portal,
    'the definition registry resolves the stable portal id');
  assert.strictEqual(mechanics.get('unknown'), null,
    'unknown gameplay extensions are not executable');
  const definitions = mechanics.all();
  assert.deepStrictEqual(definitions, [portal, ice]);
  definitions.length = 0;
  assert.deepStrictEqual(mechanics.all(), [portal, ice],
    'registry enumeration returns a detached array');
}

module.exports = run;
