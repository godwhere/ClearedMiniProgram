'use strict';

const assert = require('assert');
const catalog = require('../../data/catalog-v2.js');
const solutions = require('../../data/solutions.js');
const GameRunner = require('../../core/game-runner.js');
const HintService = require('../../src/services/hint-service.js');
const evaluate = require('../../scripts/evaluate-level-difficulty.js');
const App = require('../../src/app.js');
const Platform = require('../../src/platform/wechat.js');
const { fakeApi } = require('../account-bootstrap.test.js');

// Shared content and real App-flow checks for append-only ordinary/ice packs.
module.exports = function verifyPack({ start, idPrefix, grades, iceCounts, groupCounts }) {
  const entries = catalog.levels.slice(start, start + grades.length);
  const firstIndex = start - 32;
  function transform(cell, variant) {
    let x = cell % 8, y = Math.floor(cell / 8);
    if (variant >= 4) x = 7 - x;
    for (let i = 0; i < variant % 4; i++) [x, y] = [7 - y, x];
    return y * 8 + x;
  }

  function canonical(game) {
    return Array.from({ length: 8 }, (_, variant) =>
      game.Lines.map(line => [transform(line.Start, variant), transform(line.End, variant)]
        .sort((a, b) => a - b).join(':')).sort().join('|') + '@' +
      (game.IceCells || []).map(cell => transform(cell, variant)).sort((a, b) => a - b).join(',')
    ).sort()[0];
  }

  function connect(runner, path) {
    assert(runner.touchStart(path[0]));
    path.slice(1).forEach(cell => assert(runner.touchMove(cell), `cannot enter ${cell}`));
    assert(runner.touchEnd(path[path.length - 1]));
  }

  function contentAndReplay() {
    assert.strictEqual(entries.length, grades.length);
    const seen = new Set(catalog.levels.slice(0, start).filter(entry => entry.game.Width === 8 &&
      entry.game.Height === 8).map(entry => canonical(entry.game)));
    const hints = new HintService(solutions);
    entries.forEach(({ game, setIndex, levelIndex }, index) => {
      assert.deepStrictEqual([setIndex, levelIndex], [4, firstIndex + index]);
      assert.strictEqual(game.Id, `${idPrefix}${String(index + 1).padStart(2, '0')}`);
      assert.strictEqual(game.Difficulty, grades[index]);
      assert.strictEqual(game.Mechanic, iceCounts[index] ? 'ice' : undefined);
      assert.strictEqual(game.Portals, undefined);
      assert.strictEqual(game.Blocked, undefined);
      const ice = new Set(game.IceCells || []);
      assert.strictEqual(ice.size, iceCounts[index]);
      assert(!seen.has(canonical(game)), `${game.Id}: duplicate including symmetry and recoloring`);
      seen.add(canonical(game));
      const paths = solutions.ByLevelId[game.Id];
      const rating = evaluate(game, paths);
      assert.strictEqual(rating.grade, game.Difficulty);
      assert.strictEqual(rating.iceGroups, groupCounts[index]);
      assert(game.Lines.length >= 6 && game.Lines.length <= catalog.sets[4].Palette.length);
      const coverage = new Array(64).fill(0);
      paths.forEach((path, color) => {
        assert.strictEqual(new Set(path).size, path.length);
        assert.strictEqual(path[0], game.Lines[color].Start);
        assert.strictEqual(path[path.length - 1], game.Lines[color].End);
        path.forEach(cell => coverage[cell]++);
      });
      coverage.forEach((count, cell) => assert.strictEqual(count, ice.has(cell) ? 2 : 1));

      // Eight geometries, every cyclic route order, and both drawing directions.
      for (let variant = 0; variant < 8; variant++) {
        const rotated = Object.assign({}, game, {
          Lines: game.Lines.map(line => ({ Start: transform(line.Start, variant), End: transform(line.End, variant) }))
        });
        if (ice.size) rotated.IceCells = game.IceCells.map(cell => transform(cell, variant));
        const rotatedPaths = paths.map(path => path.map(cell => transform(cell, variant)));
        assert.strictEqual(evaluate(rotated, rotatedPaths).score, rating.score);
        for (let shift = 0; shift < paths.length; shift++) {
          for (const reverse of [false, true]) {
            let order = rotatedPaths.slice(shift).concat(rotatedPaths.slice(0, shift));
            if (reverse) order = order.slice().reverse().map(path => path.slice().reverse());
            assert.strictEqual(evaluate(rotated, order).score, rating.score, 'renumbering shared routes must not change score');
            const runner = new GameRunner(rotated, catalog.sets[4].Palette);
            const remaining = Array.from({ length: 64 }, (_, cell) =>
              rotated.IceCells && rotated.IceCells.includes(cell) ? 2 : 1);
            order.forEach((path, step) => {
              connect(runner, path);
              path.forEach(cell => remaining[cell]--);
              if (ice.size) runner.getMechanicState().cells.forEach(cell =>
                assert.strictEqual(cell.remainingLayers, remaining[cell.index], 'each ice cell consumes exactly one layer per route'));
              assert.strictEqual(runner.outcome, step === order.length - 1 ? GameRunner.OUTCOME.WON : GameRunner.OUTCOME.PLAYING);
            });
            assert(remaining.every(value => value === 0));
          }
        }
      }

      const runner = new GameRunner(game, catalog.sets[4].Palette);
      const hint = hints.findComplete(runner, 4, levelIndex);
      assert(hint && hint.paths.length === paths.length);
      if (!ice.size) { assert.strictEqual(hint.steps, undefined); return; }
      const remaining = coverage.slice();
      hint.steps.forEach((step, color) => {
        assert.deepStrictEqual(step.remainingLayers, remaining);
        assert.strictEqual(step.breaksIce, paths[color].some(cell => ice.has(cell) && remaining[cell] === 2));
        assert.strictEqual(step.clearsIce, paths[color].some(cell => ice.has(cell) && remaining[cell] === 1));
        paths[color].forEach(cell => remaining[cell]--);
      });
      assert(remaining.every(value => value === 0));
      const crossing = paths.find(path => path.some(cell => ice.has(cell)));
      connect(runner, crossing);
      const partial = runner.snapshot();
      const state = runner.getMechanicState();
      connect(runner, crossing.slice().reverse());
      assert.deepStrictEqual(runner.getMechanicState(), state, 'redrawing a route never consumes a second ice layer');
      assert(runner.undo());
      assert.deepStrictEqual(runner.getMechanicState(), state);
      const restored = new GameRunner(game, catalog.sets[4].Palette);
      restored.restore(partial);
      assert.deepStrictEqual(restored.getMechanicState(), state);
      assert(hints.findComplete(restored, 4, levelIndex));
      assert.deepStrictEqual(restored.snapshot(), partial, 'hint lookup preserves partial multi-ice board');
      const illegal = paths.map(path => path.slice());
      illegal[0] = illegal[0].slice(1);
      assert.strictEqual(hints.iceProvider.findComplete(runner.getViewState(), illegal), null);
      restored.reset();
      assert(restored.getMechanicState().cells.every(cell => cell.remainingLayers === 2));
    });

  }

  function appFlow() {
    for (const width of [280, 320, 390]) {
      const raw = fakeApi();
      raw.getWindowInfo = () => ({ windowWidth: width, windowHeight: 640, pixelRatio: 2,
        safeArea: { top: 44, bottom: 616 } });
      const platform = new Platform(raw);
      const options = { solutionCatalog: solutions, progressionConfig: { unlockAllLevelsInDevTools: false } };
      const app = new App(platform, options);
      assert.strictEqual(app.openLevel(4, firstIndex), false);
      app.progress.recordCompletion(4, firstIndex - 1, 65000);
      app.recoverRewardUnlocks();
      const before = app.rewardUnlocks.view().balance;
      const stamina = app.stamina.snapshot(Date.now()).balance;
      entries.forEach(({ game, levelIndex }, index) => {
        app.performAction('home:levels'); app.levelPageIndex = Math.floor((start + index) / 25); app.tick(Date.now());
        const item = app.buildModel().levelItems.find(item => item.action === `level:4:${levelIndex}`);
        assert(item && item.unlocked && item.difficulty === grades[index] && item.displayNumber === start + index + 1);
        assert(app.renderer.hits.some(hit => hit.id === item.action));
        app.performAction(item.action);
        assert.strictEqual(app.runContext.progressionScope, 'ordinary');
        assert.strictEqual(app.stamina.snapshot(Date.now()).balance, stamina - 1);
        const initial = app.runner.snapshot();
        assert(app.showHint());
        assert.strictEqual(!!app.hintPreview.manual, !!game.IceCells);
        if (game.IceCells) {
          assert.strictEqual(app.hintPreview.frames.length, game.Lines.length);
          app.hint.steps.forEach((step, stepIndex) => {
            if (step.breaksIce && step.clearsIce) assert(app.hintPreview.frames[stepIndex].hintStepLabel.includes('破冰并消除已解冻地板'));
          });
          app.performAction('hint:next');
          assert.strictEqual(app.hintPreview.index, 1);
          app.tick(Date.now() + 15000);
          assert(app.isHintPreviewActive(), 'multi-ice hints stay manually paged');
        }
        assert.deepStrictEqual(app.runner.snapshot(), initial);
        app.showHint(); app.tick(Date.now());
        const board = app.renderer.boardLayout;
        const point = cell => ({ x: board.x + (cell % 8 + 0.5) * board.cell,
          y: board.y + (Math.floor(cell / 8) + 0.5) * board.cell, id: 21 });
        solutions.ByLevelId[game.Id].forEach(path => {
          app.onPointerStart(point(path[0]));
          path.slice(1).forEach(cell => app.onPointerMove(point(cell)));
          app.onPointerEnd(point(path[path.length - 1]));
        });
        assert.strictEqual(app.scene, 'result');
        assert(app.progress.isCompleted(4, levelIndex));
        assert.strictEqual(app.rewardUnlocks.view().balance, before + 100 * (index + 1));
        assert.strictEqual(app.stamina.snapshot(Date.now()).balance, stamina);
      });
      assert.strictEqual(app.buildModel().hasNext, start + entries.length < catalog.levels.length);
      app.dispose();
      const restored = new App(platform, options);
      entries.forEach(({ levelIndex }) => assert(restored.progress.isCompleted(4, levelIndex)));
      assert.strictEqual(restored.openLevel(4, firstIndex + entries.length - 1), true);
      assert.strictEqual(restored.rewardUnlocks.view().balance, before + 100 * entries.length);
      assert.strictEqual(restored.stamina.snapshot(Date.now()).balance, stamina);
      restored.dispose();
    }
  }

  contentAndReplay();
  appFlow();
};
