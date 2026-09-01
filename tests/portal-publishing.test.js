'use strict';

const assert = require('assert');
const GameRunner = require('../core/game-runner.js');
const portalValidation = require('../core/portal-validation.js');
const portalDemo = require('../data/portal-demo.js');
const portalSolutions = require('../data/portal-solutions.js');

function run() {
  const games = portalDemo.Games || [];
  assert.strictEqual(games.length, 5);

  games.forEach(game => {
    const validation = portalValidation.validatePortalLevel(game, {
      solution: portalSolutions,
      requireSolution: true
    });
    assert.strictEqual(validation.ok, true,
      `${game.Id} publishing validation failed: ${validation.errors.join(',')}`);

    const answer = portalSolutions.ByLevelId[game.Id];
    assert(Array.isArray(answer));
    const runner = new GameRunner(game, portalDemo.Palette);
    answer.forEach((lineAnswer, lineIndex) => {
      const segments = lineAnswer.Segments || [];
      segments.forEach((segment, segmentIndex) => {
        const cells = segment.Cells || [];
        assert(cells.length > 0);
        assert.strictEqual(runner.touchStart(cells[0]), true,
          `${game.Id} line ${lineIndex} segment ${segmentIndex} start`);
        cells.slice(1).forEach(cell => {
          assert.strictEqual(runner.touchMove(cell), true,
            `${game.Id} line ${lineIndex} move ${cell}`);
        });
        const connected = runner.touchEnd(cells[cells.length - 1]);
        assert.strictEqual(connected, segmentIndex === segments.length - 1,
          `${game.Id} line ${lineIndex} segment ${segmentIndex} completion`);
      });
    });

    const coverable = game.Width * game.Height - (game.Blocked || []).length;
    assert.strictEqual(runner.filledCount(), coverable);
    assert.strictEqual(runner.isGameOver, true, `${game.Id} must replay to completion`);
  });
}

module.exports = run;
