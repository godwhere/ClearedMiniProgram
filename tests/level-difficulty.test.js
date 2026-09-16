'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const catalog = require('../data/catalog-v2.js');
const normal = require('../data/solutions.js');
const portal = require('../data/portal-solutions.js');
const evaluate = require('../scripts/evaluate-level-difficulty.js');
const solveWithoutPortals = require('../scripts/solve-no-portal.js');
const candidateTools = require('../scripts/level-copilot/candidate.js');
const GameRunner = require('../core/game-runner.js');
const HintService = require('../src/services/hint-service.js');
const ProgressionService = require('../src/services/progression-service.js');
const ProgressStore = require('../src/services/progress-store.js');
const StaminaService = require('../src/services/stamina-service.js');
const RewardUnlockService = require('../src/services/reward-unlock-service.js');
const App = require('../src/app.js');
const { createStaminaFixture, NOW, INTERVAL, STORAGE_KEY, clone } = require('./helpers/stamina-fixture.js');

const key = entry => `${entry.setIndex}:${entry.levelIndex}`;
const coordinates = entry => ({ setIndex: entry.setIndex, levelIndex: entry.levelIndex });
const segments = line => Array.isArray(line) ? [line] : line.Segments.map(segment => segment.Cells);
const answerFor = (game, index) => game.Mechanic === 'portal' ? portal.ByLevelId[game.Id] :
  normal.ByLevelId[game.Id] || normal.sets[4][index];
const histogram = games => [1, 2, 3, 4, 5].map(grade => games.filter(game => game.Difficulty === grade).length);

function canonicalLayout(game) {
  return Array.from({ length: 8 }, (_, transform) => {
    const cell = value => {
      let x = value % 8, y = value >> 3;
      if (transform >= 4) x = 7 - x;
      for (let i = 0; i < transform % 4; i++) [x, y] = [7 - y, x];
      return y * 8 + x;
    };
    return game.Lines.map(line => [cell(line.Start), cell(line.End)].sort((a, b) => a - b).join('-')).sort().join('|') +
      '@' + (game.Portals || []).flatMap(network => network.Cells || [network.A, network.B]).map(cell).sort((a, b) => a - b).join(',');
  }).sort()[0];
}

function replay(game, answer) {
  const runner = new GameRunner(game, catalog.sets[4].Palette);
  answer.forEach(line => segments(line).forEach((path, index, paths) => {
    assert.strictEqual(runner.touchStart(path[0]), true, `${game.Id}: start`);
    path.slice(1).forEach(cell => assert.strictEqual(runner.touchMove(cell), true, `${game.Id}: move ${cell}`));
    assert.strictEqual(runner.touchEnd(path[path.length - 1]), index === paths.length - 1, `${game.Id}: end`);
  }));
  assert.strictEqual(runner.outcome, GameRunner.OUTCOME.WON, game.Id);
}

function contentAndRating() {
  const games = catalog.sets[4].Games.slice(0, 105);
  assert.deepStrictEqual(histogram(games), [16, 27, 51, 9, 2]);
  assert.deepStrictEqual(histogram(games.slice(65)), [16, 18, 6, 0, 0]);
  const seen = new Set(games.slice(0, 65).map(canonicalLayout));
  const hints = new HintService(normal);
  games.forEach((game, index) => {
    assert.strictEqual(game.IceCells, undefined, 'the original 137 levels must not gain ice');
    const answer = answerFor(game, index);
    const rating = evaluate(game, answer);
    assert.strictEqual(rating.grade, game.Difficulty, `${game.Id || index}: published grade drift`);
    // Scores cannot depend on orientation, color labels, or answer direction.
    const rotated = Object.assign({}, game, {
      Lines: game.Lines.slice().reverse().map(line => ({ Start: 63 - line.End, End: 63 - line.Start })),
      Portals: (game.Portals || []).map(network => ({ Cells: (network.Cells || [network.A, network.B]).map(cell => 63 - cell) }))
    });
    const rotatedAnswer = answer.slice().reverse().map(line => ({ Segments: segments(line).slice().reverse()
      .map(path => ({ Cells: path.slice().reverse().map(cell => 63 - cell) })) }));
    assert.strictEqual(evaluate(rotated, rotatedAnswer).score, rating.score);
    if (index < 65) return;
    assert.strictEqual(game.Id, `recovery-8x8-${String(index - 64).padStart(2, '0')}`);
    assert.strictEqual(game.Mechanic, index >= 99 ? 'portal' : undefined);
    const layout = canonicalLayout(game);
    assert(!seen.has(layout), `${game.Id}: duplicate under symmetry/color permutation`);
    seen.add(layout);
    const cells = answer.flatMap(line => segments(line).flat());
    assert.strictEqual(cells.length, 64);
    assert.strictEqual(new Set(cells).size, 64);
    assert(rating.lengths.every(length => length >= 4 && length <= 16));
    if (rating.grade <= 2) assert(rating.easyLines >= (rating.grade === 1 ? 4 : 2));
    game.Lines.forEach(line => assert(Math.abs(line.Start % 8 - line.End % 8) +
      Math.abs((line.Start >> 3) - (line.End >> 3)) > 1));
    if (game.Mechanic === 'portal') {
      assert.strictEqual(game.PortalRulesVersion, 2);
      assert.strictEqual(game.Portals.length, 1);
      assert.strictEqual(game.Portals[0].Cells.length, 2);
      assert.strictEqual(solveWithoutPortals(game).status, 'unsatisfiable', `${game.Id}: Portal must be meaningful`);
    }
    replay(game, answer);
    replay(game, answer.slice(2).concat(answer.slice(0, 2)));
    replay(game, answer.slice().reverse().map(line => ({ Segments: segments(line).slice().reverse()
      .map(path => ({ Cells: path.slice().reverse() })) })));
    const runner = new GameRunner(game, catalog.sets[4].Palette);
    assert.strictEqual(hints.find(runner, 4, index).source, 'solution');
    const complete = hints.findComplete(runner, 4, index);
    assert.deepStrictEqual(complete.paths.map(line => line.segments ? line.segments.flat() : line.path),
      answer.map(line => segments(line).flat()));
  });
  const rows = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => row * 8 + col));
  const simple = { Width: 8, Height: 8, Lines: rows.map(path => ({ Start: path[0], End: path[7] })) };
  assert.strictEqual(evaluate(simple, rows).grade, 1, 'eight clear colors need not be hard');
  assert.throws(() => evaluate(Object.assign({}, simple, { IceCells: [] }), rows), /ordinary\/Portal/);
}

function earlyLevelRating() {
  const early = catalog.levels.slice(0, 32);
  assert.deepStrictEqual(histogram(early.map(entry => entry.game)), [8, 16, 8, 0, 0]);
  early.forEach(entry => {
    const game = entry.game;
    const answer = game.Mechanic === 'portal' ? portal.ByLevelId[game.Id] :
      normal.ByLevelId[game.Id] || normal.sets[entry.setIndex][entry.levelIndex];
    const rating = evaluate(game, answer);
    assert.strictEqual(rating.grade, game.Difficulty, `${key(entry)}: early published grade drift`);
    const last = game.Width * game.Height - 1;
    const rotated = Object.assign({}, game, {
      Lines: game.Lines.slice().reverse().map(line => ({ Start: last - line.End, End: last - line.Start })),
      Portals: (game.Portals || []).map(network => ({ Cells: network.Cells.map(cell => last - cell) }))
    });
    const rotatedAnswer = answer.slice().reverse().map(line => ({ Segments: segments(line).slice().reverse()
      .map(path => ({ Cells: path.slice().reverse().map(cell => last - cell) })) }));
    assert.strictEqual(evaluate(rotated, rotatedAnswer).score, rating.score, 'small and rectangular boards stay orientation invariant');
  });
  const training = { Width: 5, Height: 1, Lines: [{ Start: 0, End: 4 }] };
  assert.strictEqual(evaluate(training, [[0, 1, 2, 3, 4]]).score, 0);
  const largeRows = Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 8 }, (_, column) => row * 8 + column));
  const large = {
    Width: 8,
    Height: 10,
    Lines: largeRows.map(path => ({ Start: path[0], End: path[path.length - 1] }))
  };
  const largeRating = evaluate(large, largeRows);
  assert.strictEqual(largeRating.grade, 1);
  assert.strictEqual(largeRating.score, 10);
  assert.strictEqual(largeRating.easyLines, 10);
  assert.strictEqual(solveWithoutPortals(large).status, 'solved');
  const frontierBrief = {
    schemaVersion: 1,
    mechanic: 'portal',
    width: 8,
    height: 10,
    colorCount: 10,
    targetGrade: 3,
    designIntent: 'Portal authoring boundary fixture.',
    portalCellCount: 4
  };
  const frontierSeed = {
    schemaVersion: 1,
    paths: [
      { cells: [0, 8, 9, 1, 2, 10, 11, 3, 4, 12, 13, 5, 6, 14, 15, 7] },
      { cells: [16, 24, 25, 17, 18, 26, 27, 19, 20, 28, 29, 21, 22, 30, 31, 23] }
    ].concat(Array.from({ length: 6 }, (_, row) => ({
      cells: Array.from({ length: 8 }, (_, column) => (row + 4) * 8 + column)
    }))),
    designSummary: null
  };
  const expandedFrontier = candidateTools.expandPortalSeedCandidates(
    frontierBrief, frontierSeed);
  assert.strictEqual(expandedFrontier.ok, true);
  const compiledFrontier = candidateTools.compileCandidate(
    frontierBrief, expandedFrontier.candidates[0]);
  const frontierRating = evaluate(compiledFrontier.level, compiledFrontier.solution);
  assert.strictEqual(frontierRating.doors, 4);
  assert.notStrictEqual(solveWithoutPortals(compiledFrontier.level).status, 'invalid');
  replay(compiledFrontier.level, compiledFrontier.solution);
  assert.strictEqual(solveWithoutPortals(Object.assign({}, large, { Height: 9 })).status, 'invalid');
  assert.strictEqual(solveWithoutPortals(Object.assign({}, large, { Blocked: [9] })).status, 'invalid');
  assert.throws(() => evaluate(Object.assign({}, large, { Blocked: [9] }), largeRows), /ordinary\/Portal/);
  for (const dimensions of [
    { Width: 0 }, { Width: 5.5 }, { Width: 8, Height: 9 }, { Width: 10, Height: 8 }
  ]) {
    assert.throws(() => evaluate(Object.assign({}, training, dimensions), [[0, 1, 2, 3, 4]]), /ordinary\/Portal/);
  }
}

function sequence() {
  assert.strictEqual(catalog.orderValid, true);
  assert.strictEqual(catalog.orderVersion, 1);
  assert.strictEqual(catalog.levels.length, 168);
  assert.strictEqual(new Set(catalog.levels.map(key)).size, 168);
  const canonical = catalog.sets.flatMap((set, setIndex) => set.Games.map((game, levelIndex) => ({ setIndex, levelIndex, game })));
  assert.deepStrictEqual(catalog.levels.slice(0, 32).map(key), canonical.slice(0, 32).map(key));
  catalog.levels.forEach(entry => assert.strictEqual(entry.game, catalog.sets[entry.setIndex].Games[entry.levelIndex]));
  const grades = catalog.levels.slice(32).map(entry => entry.game.Difficulty);
  assert.deepStrictEqual(grades.slice(0, 3), [1, 1, 1]);
  for (let i = 0; i <= grades.length - 10; i++) assert(grades.slice(i, i + 10).filter(grade => grade <= 2).length >= 4);
  grades.forEach((grade, index) => { if (grade >= 4) assert(grades[index + 1] <= 2); });

  const completed = new Set();
  const store = { isCompleted: (set, index) => completed.has(`${set}:${index}`) };
  const progression = new ProgressionService(store, catalog.sets, {}, { levels: catalog.levels });
  assert.deepStrictEqual(progression.resumeTarget(null), coordinates(catalog.levels[0]));
  assert.deepStrictEqual(progression.resumeTarget({ setIndex: 4, levelIndex: 999 }), coordinates(catalog.levels[0]));
  assert.deepStrictEqual(progression.resumeTarget(coordinates(catalog.levels[70])), coordinates(catalog.levels[0]),
    'a locked stale last position must find an accessible unfinished level');
  catalog.levels.forEach((entry, index) => {
    assert(progression.isUnlocked(entry.setIndex, entry.levelIndex));
    const next = progression.nextLevel(entry.setIndex, entry.levelIndex);
    assert.deepStrictEqual(next, catalog.levels[index + 1] ? coordinates(catalog.levels[index + 1]) : null);
    if (next) assert(!progression.isUnlocked(next.setIndex, next.levelIndex));
    completed.add(key(entry));
    assert.deepStrictEqual(progression.resumeTarget(coordinates(entry)), next || coordinates(entry));
  });
  for (const invalid of [[], catalog.levels.slice(1), catalog.levels.map(() => catalog.levels[0])]) {
    assert.deepStrictEqual(new ProgressionService(store, catalog.sets, {}, { levels: invalid }).levels, canonical.map(coordinates));
  }
  // A corrupt packaged order retains every stable entry and advertises fallback.
  const source = fs.readFileSync(require.resolve('../data/catalog-v2.js'), 'utf8');
  for (const order of [null, {}, { version: 2, eightByLevelIndex: [] }, { version: 1, eightByLevelIndex: new Array(136).fill(0) },
    { version: 1, eightByLevelIndex: Array.from({ length: 136 }, (_, i) => i === 135 ? 136 : i) }]) {
    const context = { module: { exports: {} }, require: name => name === './level-order.js' ? order : require('../data/' + name.slice(2)) };
    vm.runInNewContext(source, context);
    assert.strictEqual(context.module.exports.orderValid, false);
    assert.deepStrictEqual(Array.from(context.module.exports.levels, key), canonical.map(key));
  }
}

function oldSave() {
  const saved = { schemaVersion: 1, balance: 0, nextRecoveryAt: NOW + INTERVAL,
    unlockedLevels: ['4:14'], refundedLevels: [] };
  const f = createStaminaFixture(saved);
  assert.strictEqual(f.service.isPermanentlyUnlocked('4:14'), true, 'read before first settle');
  assert.strictEqual(f.service.isPermanentlyUnlocked('4:13'), false);
  assert.strictEqual(f.service.isPermanentlyUnlocked('__proto__'), false);
  assert.deepStrictEqual(f.writes, [], 'navigation never writes or recovers stamina');
  assert.deepStrictEqual(f.raw.storage[STORAGE_KEY], saved);
  const fail = new StaminaService({ getStorage() { throw new Error('unavailable'); } });
  assert.strictEqual(fail.isPermanentlyUnlocked('4:14'), false);

  const progress = new ProgressStore(f.platform);
  progress.recordCompletion(4, 55, 80000);
  progress.markOpened(4, 14); progress.save();
  const rewards = new RewardUnlockService(f.platform, require('../src/config/rewards.js'));
  assert(rewards.reconcile({ ordinary: { ok: true, levelKeys: ['4:55'] }, daily: { ok: true, days: [] } }).ok);
  const economy = clone(rewards.exportMigrationSnapshot());
  for (let restart = 0; restart < 2; restart++) {
    const stamina = restart ? new StaminaService(f.platform, { clock: f.clock }) : f.service;
    const app = new App(f.platform, { stamina, solutionCatalog: normal, clock: () => new Date(NOW) });
    const oldPosition = app.catalogLevelPosition(4, 14);
    const previous = catalog.levels[oldPosition - 1];
    assert(!app.progress.isCompleted(previous.setIndex, previous.levelIndex));
    assert(app.progression.isUnlocked(4, 14), 'new prerequisite cannot revoke paid old access');
    assert(!app.progression.isUnlocked(4, 999));
    app.performAction('home:start');
    assert.strictEqual(app.setIndex, 4); assert.strictEqual(app.levelIndex, 14);
    assert.strictEqual(app.stamina.snapshot(NOW).balance, 0, 'reopening cannot charge again');
    assert.strictEqual(app.progress.state.bestMs['4:55'], 80000);
    assert(app.progress.isCompleted(4, 55));
    assert.deepStrictEqual(app.rewardUnlocks.exportMigrationSnapshot(), economy, 'reorder cannot award twice or move ownership');
    const animal = app.themeDescriptors().find(item => item.id === 'animals');
    assert.strictEqual(animal.reward.displayLevel, app.catalogLevelPosition(4, 55) + 1);
    app.dispose();
  }
}

module.exports = function run() { contentAndRating(); earlyLevelRating(); sequence(); oldSave(); };
