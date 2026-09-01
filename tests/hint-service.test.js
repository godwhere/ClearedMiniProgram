const assert = require('assert');
const HintService = require('../src/services/hint-service.js');
const GameRunner = require('../core/game-runner.js');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');

function run() {
  const game = catalog.sets[0].Games[1];
  const runner = new GameRunner(game, catalog.sets[0].Palette);
  const hints = new HintService(solutions);
  const first = hints.find(runner, 0, 1);
  assert(first);
  assert.strictEqual(first.source, 'solution');
  assert.deepStrictEqual(first.path, solutions.sets[0][1][0]);

  runner.touchStart(first.path[0]);
  first.path.slice(1).forEach(index => runner.touchMove(index));
  assert.strictEqual(runner.touchEnd(first.path[first.path.length - 1]), true);
  const second = hints.find(runner, 0, 1);
  assert(second);
  assert.strictEqual(second.lineIndex, 1);

  const fallback = new HintService();
  const searched = fallback.find(new GameRunner(game, catalog.sets[0].Palette), 0, 1);
  assert(searched);
  assert.strictEqual(searched.source, 'search');

  const blockedLevel = {
    Width: 3,
    Height: 2,
    Blocked: [1],
    Lines: [{ Start: 0, End: 2 }]
  };
  const blockedRunner = new GameRunner(blockedLevel, ['#f00']);
  const blockedSolutions = { sets: [[[0, 1, 2]]] };
  const blockedHint = new HintService(blockedSolutions).find(blockedRunner, 0, 0);
  assert(blockedHint);
  assert.strictEqual(blockedHint.source, 'search',
    'a stored path through a blocked cell must fall back to search');
  assert.strictEqual(blockedHint.path.indexOf(1), -1);

  const dailySolutions = {
    SchemaVersion: 1,
    ByChallengeId: { 'daily-test-v1': [[0, 1, 2]] }
  };
  const dailyRunner = new GameRunner(blockedLevel, ['#f00']);
  const dailyHint = new HintService().findDaily(dailyRunner, 'daily-test-v1', dailySolutions);
  assert(dailyHint);
  assert.strictEqual(dailyHint.source, 'search');
  assert.strictEqual(dailyHint.path.indexOf(1), -1);
  assert.strictEqual(new HintService(dailySolutions)
    .dailySolutionFor('daily-test-v1')[0][1], 1);
}

module.exports = run;
