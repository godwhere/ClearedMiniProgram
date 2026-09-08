'use strict';

const assert = require('assert');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');
const evaluate = require('../scripts/evaluate-level-difficulty.js');
const verifyPack = require('./helpers/mainline-pack-fixture.js');

module.exports = function run() {
  verifyPack({ start: 138, idPrefix: 'thaw-8x8-',
    grades: [1, 2, 2, 3, 1, 2, 2, 3, 4, 1],
    iceCounts: [0, 2, 2, 0, 0, 6, 6, 8, 12, 0],
    groupCounts: [0, 1, 2, 0, 0, 1, 3, 3, 3, 0] });
  const entries = catalog.levels.slice(138, 148);
  assert(evaluate(entries[2].game, solutions.ByLevelId[entries[2].game.Id]).factors.mechanic >
    evaluate(entries[1].game, solutions.ByLevelId[entries[1].game.Id]).factors.mechanic,
  'separated ice and extra sharing pairs add planning load at equal ice count');
};
