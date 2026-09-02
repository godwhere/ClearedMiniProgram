const assert = require('assert');
const HintService = require('../src/services/hint-service.js');
const OrdinaryHintProvider = require('../src/services/hints/ordinary-hint-provider.js');
const GameRunner = require('../core/game-runner.js');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(key => deepFreeze(value[key]));
  return Object.freeze(value);
}

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

  const stateBeforeCompleteHint = runner.getViewState();
  const complete = hints.findComplete(runner, 0, 1);
  assert(complete, 'complete hint remains available after a line is completed');
  assert.deepStrictEqual(complete.paths.map(item => item.path), solutions.sets[0][1]);
  assert.deepStrictEqual(runner.getViewState(), stateBeforeCompleteHint,
    'complete hint lookup cannot mutate the live Runner');

  const mixedGame = catalog.sets[4].Games[35];
  assert.strictEqual(mixedGame.Id, 'portal-8x8-06');
  assert.strictEqual(mixedGame.Mechanic, undefined,
    'a preserved Portal-prefixed ID must not enable Portal rules on an ordinary level');
  const mixedRunner = new GameRunner(mixedGame, catalog.sets[4].Palette);
  const mixedHint = hints.find(mixedRunner, 4, 35);
  assert(mixedHint && mixedHint.source === 'solution');
  assert.deepStrictEqual(mixedHint.path, solutions.ByLevelId[mixedGame.Id][0],
    'mixed chapter ordinary hints must use the stable-ID solution table');
  const mixedComplete = hints.findComplete(mixedRunner);
  assert(mixedComplete && mixedComplete.source === 'solution');
  assert.deepStrictEqual(mixedComplete.paths.map(item => item.path), solutions.ByLevelId[mixedGame.Id],
    'full ordinary hints must resolve by ID even without legacy catalog coordinates');

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
  const blockedSolutions = { sets: [[[[0, 1, 2]]]] };
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
  assert.strictEqual(
    new HintService().findDailyComplete(dailyRunner, 'daily-test-v1', dailySolutions),
    null,
    'an illegal stored daily path fails as a whole without BFS fallback'
  );

  const dailyCompleteSolutions = {
    ByChallengeId: { 'daily-complete-v1': [[0, 3, 4, 5, 2]] }
  };
  const dailyComplete = new HintService().findDailyComplete(
    dailyRunner,
    'daily-complete-v1',
    dailyCompleteSolutions
  );
  assert.deepStrictEqual(dailyComplete.paths[0].path, [0, 3, 4, 5, 2]);

  assert.strictEqual(
    new HintService({ sets: [[[[0, 3, 4, 5]]]] }).findComplete(
      new GameRunner({ Width: 3, Height: 2, Lines: [{ Start: 0, End: 5 }] }, ['#f00']),
      0,
      0
    ),
    null,
    'a preset that does not cover the initial board is not a complete hint'
  );

  const pureContext = deepFreeze({
    outcome: 'playing',
    levelId: 'ordinary-provider-test',
    board: {
      width: 3,
      height: 2,
      lines: [{ Start: 0, End: 2 }],
      blocked: [1],
      blockedMask: [false, true, false, false, false, false],
      owner: [-1, -1, -1, -1, -1, -1],
      fixedLine: [0, -1, 0, -1, -1, -1]
    },
    completedLines: [false],
    completedPaths: [null],
    selection: { lineIndex: -1, cells: [], segments: [], teleports: [] },
    mechanic: { id: null, rulesVersion: null, phase: 'READY', portals: [], pending: null, locked: null }
  });
  const beforeProvider = JSON.stringify(pureContext);
  const providerHint = new OrdinaryHintProvider().find(pureContext, [[0, 1, 2]]);
  assert(providerHint);
  assert.strictEqual(providerHint.source, 'search');
  assert.deepStrictEqual(providerHint.path, [0, 3, 4, 5, 2]);
  assert.strictEqual(JSON.stringify(pureContext), beforeProvider,
    'ordinary provider must not mutate its read-only context');

  const pureCatalog = { sets: [[[[0, 3, 4, 5, 2]]]] };
  const facadeHint = new HintService({
    solutionCatalog: pureCatalog,
    dailySolutions
  }).find(pureContext, 0, 0);
  assert(facadeHint);
  assert.strictEqual(facadeHint.source, 'solution');
  assert.deepStrictEqual(facadeHint.path, [0, 3, 4, 5, 2]);
  assert.deepStrictEqual(
    new HintService().findAvailablePath(pureContext).path,
    [0, 3, 4, 5, 2]
  );
  assert.deepStrictEqual(
    new HintService().pickStoredPath([[0, 3, 4, 5, 2]], pureContext).path,
    [0, 3, 4, 5, 2]
  );
  assert.strictEqual(JSON.stringify(pureContext), beforeProvider,
    'HintService must clone a pure context before routing it');
}

module.exports = run;
