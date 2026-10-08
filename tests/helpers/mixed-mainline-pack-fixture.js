'use strict';

const assert = require('assert');
const crypto = require('crypto');
const catalog = require('../../data/catalog-v2.js');
const normal = require('../../data/solutions.js');
const portal = require('../../data/portal-solutions.js');
const GameRunner = require('../../core/game-runner.js');
const HintService = require('../../src/services/hint-service.js');
const App = require('../../src/app.js');
const Platform = require('../../src/platform/wechat.js');
const { fakeApi } = require('../account-bootstrap.test.js');
const evaluate = require('../../scripts/evaluate-level-difficulty.js');
const solveWithoutPortals = require('../../scripts/solve-no-portal.js');
const portalValidation = require('../../core/portal-validation.js');
const { transformCell } = require('../../scripts/level-copilot/candidate.js');

const transform = (cell, variant) => transformCell(cell, 8, 8, variant);
const pathsFor = answer => answer.map(line => Array.isArray(line) ? [line] : line.Segments.map(segment => segment.Cells));
const answerFor = entry => entry.game.Mechanic === 'portal' ? portal.ByLevelId[entry.game.Id] :
  normal.ByLevelId[entry.game.Id] || normal.sets[entry.setIndex][entry.levelIndex];

function canonical(game) {
  return Array.from({ length: 8 }, (_, variant) => {
    const pairs = game.Lines.map(line => [transform(line.Start, variant), transform(line.End, variant)]
      .sort((a, b) => a - b).join(':')).sort().join('|');
    const ice = (game.IceCells || []).map(cell => transform(cell, variant)).sort((a, b) => a - b).join(',');
    const doors = (game.Portals || []).flatMap(network => network.Cells || [network.A, network.B])
      .map(cell => transform(cell, variant)).sort((a, b) => a - b).join(',');
    return `${pairs}@${ice}#${doors}`;
  }).sort()[0];
}

function replay(runner, groups) {
  groups.forEach(paths => paths.forEach((cells, index) => {
    assert.strictEqual(runner.touchStart(cells[0]), true);
    cells.slice(1).forEach(cell => assert.strictEqual(runner.touchMove(cell), true));
    assert.strictEqual(runner.touchEnd(cells[cells.length - 1]), index === paths.length - 1);
  }));
}

// Shared append-only mixed-pack checks keep older pack tests bounded as the catalog grows.
module.exports = function verifyPack({ start, idPrefix, grades: GRADES, portalSlots: PORTAL_SLOTS,
  iceSlots: ICE_SLOTS, previousHash, fivePositions }) {
  const entries = catalog.levels.slice(start, start + GRADES.length);
  const firstIndex = start - 32;
  function preservePublishedLevels() {
    // Captured before the append: includes every old board, official answer,
    // difficulty, stable coordinate and its position in the display sequence.
    const previous = catalog.levels.slice(0, start).map(entry => ({
      setIndex: entry.setIndex, levelIndex: entry.levelIndex, game: entry.game, answer: answerFor(entry)
    }));
    assert.strictEqual(crypto.createHash('sha256').update(JSON.stringify(previous)).digest('hex'),
      previousHash,
      `the original ${start} levels, answers, coordinates, difficulties and order must not change`);
  }

  function contentAndReplay() {
    assert.strictEqual(entries.length, 50);
    assert.deepStrictEqual(entries.map(entry => entry.game.Difficulty), GRADES);
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(grade =>
      entries.filter(entry => entry.game.Difficulty === grade).length), [11, 19, 12, 3, 5]);
    assert.deepStrictEqual(entries.map((entry, index) => entry.game.Difficulty === 5 ? start + index + 1 : null)
      .filter(Boolean), fivePositions);
    assert.strictEqual(entries.filter(entry => !entry.game.Mechanic).length, 30);
    assert.strictEqual(entries.filter(entry => entry.game.Mechanic === 'portal').length, 10);
    assert.strictEqual(entries.filter(entry => entry.game.Mechanic === 'ice').length, 10);

    const seen = new Set(catalog.levels.slice(0, start).filter(entry =>
      entry.game.Width === 8 && entry.game.Height === 8).map(entry => canonical(entry.game)));
    const hints = new HintService({ solutionCatalog: normal, portalSolutions: portal });
    entries.forEach((entry, index) => {
      const { game, setIndex, levelIndex } = entry;
      assert.deepStrictEqual([setIndex, levelIndex], [4, firstIndex + index]);
      assert.strictEqual(game.Id, `${idPrefix}${String(index + 1).padStart(2, '0')}`);
      assert.deepStrictEqual([game.Width, game.Height], [8, 8]);
      assert.strictEqual(game.Blocked, undefined);
      assert.strictEqual(game.Mechanic, PORTAL_SLOTS.has(index) ? 'portal' : ICE_SLOTS.has(index) ? 'ice' : undefined);
      assert(game.Lines.length >= 5 && game.Lines.length <= 9);
      const key = canonical(game);
      assert(!seen.has(key), `${game.Id}: repeated board under rotation, reflection or recoloring`);
      seen.add(key);
      const answer = answerFor(entry);
      const groups = pathsFor(answer);
      const ice = new Set(game.IceCells || []);
      const coverage = new Array(64).fill(0);
      groups.forEach((paths, color) => {
        const cells = paths.flat();
        assert.strictEqual(new Set(cells).size, cells.length, `${game.Id}: repeated cell on one route`);
        assert.strictEqual(cells[0], game.Lines[color].Start);
        assert.strictEqual(cells[cells.length - 1], game.Lines[color].End);
        const start = cells[0], end = cells[cells.length - 1];
        assert(Math.abs(start % 8 - end % 8) + Math.abs((start >> 3) - (end >> 3)) > 1);
        cells.forEach(cell => coverage[cell]++);
      });
      coverage.forEach((count, cell) => assert.strictEqual(count, ice.has(cell) ? 2 : 1));
      const rating = evaluate(game, answer);
      assert.strictEqual(rating.grade, GRADES[index], `${game.Id}: stored grade must match unchanged scoring`);
      const maximumLength = game.Mechanic === 'portal' ? 20 : game.Mechanic === 'ice' ? 18 : 16;
      assert(rating.lengths.every(length => length >= 4 && length <= maximumLength));
      if (!game.Mechanic && game.Difficulty <= 2) assert(rating.easyLines >= (game.Difficulty === 1 ? 4 : 2));
      if (ice.size) {
        assert.strictEqual(game.IceRulesVersion, 1);
        assert.strictEqual(ice.size, ICE_SLOTS.get(index)[0]);
        assert.strictEqual(rating.iceGroups, ICE_SLOTS.get(index)[1]);
        assert.strictEqual(game.Portals, undefined);
      }
      if (game.Mechanic === 'portal') {
        assert.strictEqual(game.PortalRulesVersion, 2);
        assert.strictEqual(game.Portals.length, 1);
        assert.strictEqual(game.Portals[0].Cells.length, 2);
        assert.strictEqual(groups.filter(paths => paths.length === 2).length, 1);
        assert.strictEqual(game.IceCells, undefined);
        const validation = portalValidation.validatePortalSolution(game, answer);
        assert.strictEqual(validation.ok, true, `${game.Id}: ${validation.errors.join(',')}`);
        assert.strictEqual(solveWithoutPortals(game, { maxStates: 250000 }).status, 'unsatisfiable',
          `${game.Id}: Portal must be necessary; a search limit is not proof`);
      }

      // Rotate/reflect the actual board and answer, then reverse both the route
      // ordering and drawing direction; these may not change rating or victory.
      for (let variant = 0; variant < 8; variant++) {
        const rotated = Object.assign({}, game, {
          Lines: game.Lines.map(line => ({ Start: transform(line.Start, variant), End: transform(line.End, variant) }))
        });
        if (ice.size) rotated.IceCells = game.IceCells.map(cell => transform(cell, variant));
        if (game.Portals) rotated.Portals = game.Portals.map(network => ({
          Id: network.Id, Cells: network.Cells.map(cell => transform(cell, variant))
        }));
        const rotatedGroups = groups.map(paths => paths.map(cells => cells.map(cell => transform(cell, variant))));
        for (const reverse of [false, true]) {
          const ordered = reverse ? rotatedGroups.slice().reverse().map(paths =>
            paths.slice().reverse().map(cells => cells.slice().reverse())) : rotatedGroups;
          assert.strictEqual(evaluate(rotated, ordered.map(paths => ({
            Segments: paths.map(cells => ({ Cells: cells }))
          }))).score, rating.score);
          const runner = new GameRunner(rotated, catalog.sets[4].Palette);
          replay(runner, ordered);
          assert.strictEqual(runner.outcome, GameRunner.OUTCOME.WON, game.Id);
        }
      }
      const runner = new GameRunner(game, catalog.sets[4].Palette);
      const complete = hints.findComplete(runner, setIndex, levelIndex);
      assert(complete && complete.paths.length === game.Lines.length, `${game.Id}: complete hint missing`);
      assert.deepStrictEqual(complete.paths.map(line => line.segments ? line.segments.flat() : line.path),
        groups.map(paths => paths.flat()));
      replay(runner, [groups[0]]);
      const partial = runner.snapshot();
      assert(hints.findComplete(runner, setIndex, levelIndex));
      assert.deepStrictEqual(runner.snapshot(), partial, `${game.Id}: hint must preserve partial play`);
    });
  }

  function appFlow() {
    for (const width of [280, 320, 390]) {
      const raw = fakeApi();
      raw.getWindowInfo = () => ({ windowWidth: width, windowHeight: 640, pixelRatio: 2,
        safeArea: { top: 44, bottom: 616 } });
      const platform = new Platform(raw);
      const options = { solutionCatalog: normal, portalSolutions: portal,
        progressionConfig: { unlockAllLevelsInDevTools: false } };
      const app = new App(platform, options);
      assert.strictEqual(app.openLevel(4, firstIndex), false);
      app.progress.recordCompletion(4, firstIndex - 1, 65000);
      app.recoverRewardUnlocks();
      const balance = app.rewardUnlocks.view().balance;
      const stamina = app.stamina.snapshot(Date.now()).balance;
      entries.forEach((entry, index) => {
        app.performAction('home:levels');
        app.levelPageIndex = Math.floor((start + index) / 25);
        app.tick(Date.now());
        const model = app.buildModel();
        assert.strictEqual(model.levelPageCount, Math.ceil(catalog.levels.length / 25));
        const item = model.levelItems.find(item => item.action === `level:4:${entry.levelIndex}`);
        assert(item && item.unlocked && item.displayNumber === start + index + 1 && item.difficulty === GRADES[index]);
        assert(app.renderer.hits.some(hit => hit.id === item.action));
        app.performAction(item.action);
        assert.strictEqual(app.runContext.progressionScope, 'ordinary');
        assert.strictEqual(app.stamina.snapshot(Date.now()).balance, stamina - 1);
        const initial = app.runner.snapshot();
        assert(app.showHint());
        assert.strictEqual(!!app.hintPreview.manual, entry.game.Mechanic === 'ice');
        assert.deepStrictEqual(app.runner.snapshot(), initial);
        app.showHint(); app.tick(Date.now());
        const board = app.renderer.boardLayout;
        const point = cell => ({ x: board.x + (cell % 8 + 0.5) * board.cell,
          y: board.y + ((cell >> 3) + 0.5) * board.cell, id: 21 });
        pathsFor(answerFor(entry)).forEach(paths => paths.forEach(cells => {
          app.onPointerStart(point(cells[0]));
          cells.slice(1).forEach(cell => app.onPointerMove(point(cell)));
          app.onPointerEnd(point(cells[cells.length - 1]));
        }));
        assert.strictEqual(app.scene, 'result');
        assert(app.progress.isCompleted(4, entry.levelIndex));
        assert.strictEqual(app.rewardUnlocks.view().balance, balance + (index + 1) * 100);
        assert.strictEqual(app.stamina.snapshot(Date.now()).balance, stamina);
      });
      const hasNext = start + entries.length < catalog.levels.length;
      assert.strictEqual(app.buildModel().hasNext, hasNext);
      if (!hasNext) {
        app.performAction('result:next');
        assert.strictEqual(app.scene, 'levels');
        assert.strictEqual(app.levelPageIndex, Math.floor((start + entries.length - 1) / 25));
      }
      app.dispose();
      const restored = new App(platform, options);
      entries.forEach(entry => assert(restored.progress.isCompleted(4, entry.levelIndex)));
      assert.strictEqual(restored.openLevel(4, firstIndex + entries.length - 1), true);
      assert.strictEqual(restored.rewardUnlocks.view().balance, balance + entries.length * 100);
      assert.strictEqual(restored.stamina.snapshot(Date.now()).balance, stamina);
      restored.dispose();
    }
  }

  preservePublishedLevels();
  contentAndReplay();
  appFlow();
};
