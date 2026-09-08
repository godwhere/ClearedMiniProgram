'use strict';

const assert = require('assert');
const catalog = require('../data/catalog-v2.js');
const verifyPack = require('./helpers/mainline-pack-fixture.js');

module.exports = function run() {
  const entries = catalog.levels.slice(148, 168);
  assert.strictEqual(entries.filter(entry => entry.game.Mechanic === 'ice').length, 6);
  assert(entries.filter(entry => entry.game.Mechanic === 'ice').length <= Math.floor(entries.length / 3));
  assert.strictEqual(entries.filter(entry => !entry.game.Mechanic).length, 14);
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(grade => entries.filter(entry => entry.game.Difficulty === grade).length),
    [5, 8, 6, 1, 0], 'only one difficulty-four challenge; no difficulty-five levels');
  verifyPack({ start: 148, idPrefix: 'meadow-8x8-',
    grades: [1, 2, 2, 3, 1, 2, 3, 3, 1, 2, 2, 3, 3, 1, 2, 2, 3, 2, 4, 1],
    iceCounts: [0, 0, 2, 0, 0, 4, 0, 0, 0, 6, 0, 0, 8, 0, 0, 6, 0, 0, 12, 0],
    groupCounts: [0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 3, 0] });
};
