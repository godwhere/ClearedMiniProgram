'use strict';

const assert = require('assert');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');
const GameRunner = require('../core/game-runner.js');
const HintService = require('../src/services/hint-service.js');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const BackupSnapshot = require('../src/services/backup-snapshot.js');
const PreferencesService = require('../src/services/preferences-service.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const evaluate = require('../scripts/evaluate-level-difficulty.js');
const level = catalog.sets[4].Games[105];
const paths = solutions.ByLevelId['ice-main-8x8-01'];
const now = Date.now();

function connect(runner, path) {
  assert(runner.touchStart(path[0]));
  path.slice(1).forEach(cell => assert(runner.touchMove(cell)));
  assert(runner.touchEnd(path[path.length - 1]));
}

function content() {
  assert.strictEqual(catalog.levels[137].game, level);
  assert.strictEqual(level.Id, 'ice-main-8x8-01');
  assert.deepStrictEqual([level.Width, level.Height, level.Difficulty], [8, 8, 1]);
  assert.deepStrictEqual(level.IceCells, [9]);
  assert.strictEqual(catalog.levels.filter(entry => entry.game.Mechanic === 'ice').length, 13);
  assert.strictEqual(evaluate(level, paths).grade, 1);
  assert.strictEqual(evaluate(level, paths).easyLines, 8);
  for (const order of [paths, paths.slice().reverse()]) {
    for (const reverse of [false, true]) {
      const runner = new GameRunner(level, catalog.sets[4].Palette);
      order.forEach(path => connect(runner, reverse ? path.slice().reverse() : path));
      assert.strictEqual(runner.outcome, GameRunner.OUTCOME.WON);
      assert.strictEqual(runner.getMechanicState().cells[0].remainingLayers, 0);
      assert.strictEqual(evaluate(level, order).score, evaluate(level, paths).score);
    }
  }
  const runner = new GameRunner(level, catalog.sets[4].Palette);
  const hints = new HintService(solutions);
  connect(runner, paths[0]);
  const partial = runner.snapshot();
  const hint = hints.findComplete(runner, 4, 105);
  assert.strictEqual(hint.steps.length, 9);
  assert.strictEqual(hint.steps[0].remainingLayers[9], 2);
  assert.strictEqual(hint.steps[1].remainingLayers[9], 1);
  assert.strictEqual(hint.steps[2].remainingLayers[9], 0);
  assert.deepStrictEqual(runner.snapshot(), partial, 'hint preview never plays the real board');
  connect(runner, paths[1]);
  assert.strictEqual(runner.getMechanicState().cells[0].remainingLayers, 0);
  assert(runner.undo());
  assert.strictEqual(runner.getMechanicState().cells[0].remainingLayers, 1);
  const restored = new GameRunner(level, catalog.sets[4].Palette);
  restored.restore(partial);
  assert.strictEqual(restored.getMechanicState().cells[0].remainingLayers, 1);
  const broken = paths.map(path => path.slice()); broken[0] = [8, 9, 10];
  assert.strictEqual(hints.iceProvider.findComplete(runner.getViewState(), broken), null);
  for (const patch of [{ IceRulesVersion: 2 }, { IceCells: [] }, { IceCells: [9, 17] }, { IceCells: [8] }]) {
    assert.throws(() => evaluate(Object.assign({}, level, patch), paths), /Ice difficulty/);
  }
}

async function appFlow(width) {
  const raw = fakeApi();
  raw.getWindowInfo = () => ({ windowWidth: width, windowHeight: 640, pixelRatio: 2,
    safeArea: { top: 44, bottom: 616 } });
  const platform = new Platform(raw);
  const options = { clock: () => new Date(now), solutionCatalog: solutions,
    progressionConfig: { unlockAllLevelsInDevTools: false } };
  const app = new App(platform, options);
  const beforeLocked = app.stamina.snapshot(now).balance;
  assert.strictEqual(app.openLevel(4, 105), false, 'new ice level follows ordinary progression');
  assert.strictEqual(app.stamina.snapshot(now).balance, beforeLocked);
  app.progress.recordCompletion(4, 9, 65000);
  app.recoverRewardUnlocks();
  const balance = app.rewardUnlocks.view().balance;
  app.performAction('home:levels'); app.levelPageIndex = 5; app.tick(Date.now());
  const item = app.buildModel().levelItems.find(value => value.action === 'level:4:105');
  assert(item && item.displayNumber === 138 && item.difficulty === 1 && item.unlocked);
  app.performAction(item.action);
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.runContext.source.kind, 'catalog');
  assert.strictEqual(app.runContext.progressionScope, 'ordinary');
  assert.strictEqual(app.stamina.snapshot(now).balance, beforeLocked - 1);
  assert.strictEqual(app.buildModel().trial, false);
  assert(app.buildModel().beginnerInstruction.includes('冰封格需要两次连线'));
  const boardBeforeHint = app.runner.snapshot();
  let permissionCalls = 0;
  const requestHint = app.engagement.requestHint.bind(app.engagement);
  app.engagement.requestHint = input => { permissionCalls++; return requestHint(input); };
  assert.strictEqual(app.requestHint(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(permissionCalls, 1, 'mainline ice must request normal hint permission, not trial free access');
  assert(app.hintPreview && app.hintPreview.manual && app.hintPreview.frames.length === 9);
  app.performAction('hint:next');
  assert.strictEqual(app.hintPreview.index, 1);
  assert.deepStrictEqual(app.runner.snapshot(), boardBeforeHint);
  app.requestHint();
  assert.strictEqual(app.hintPreview, null);
  function play() {
    app.tick(Date.now() + 1000);
    const board = app.renderer.boardLayout;
    assert.strictEqual(board.cols, 8); assert.strictEqual(board.rows, 8);
    paths.forEach(path => {
      const point = cell => ({ x: board.x + (cell % 8 + 0.5) * board.cell,
        y: board.y + (Math.floor(cell / 8) + 0.5) * board.cell, id: 12 });
      app.onPointerStart(point(path[0]));
      path.slice(1).forEach(cell => app.onPointerMove(point(cell)));
      app.onPointerEnd(point(path[path.length - 1]));
    });
  }
  play();
  assert.strictEqual(app.scene, 'result');
  assert(app.progress.isCompleted(4, 105));
  assert.strictEqual(app.result.firstClear, true);
  assert.strictEqual(app.rewardUnlocks.view().balance, balance + 100);
  assert.strictEqual(app.stamina.snapshot(now).balance, beforeLocked, 'first quick clear refunds once');
  const snapshot = new BackupSnapshot({ progress: app.progress, daily: app.dailyProgress,
    rewards: app.rewardUnlocks, stamina: app.stamina, preferences: new PreferencesService(app.progress) },
  { dateKey: () => '2026-09-07' }).build();
  assert(snapshot.ok, snapshot.reason);
  assert(snapshot.snapshot.domains.progress.levels['4:105'].completed);
  assert(snapshot.snapshot.domains.economy.claimedOrdinary['4:105']);
  app.tick(Date.now() + 10000);
  app.performAction('result:replay');
  assert.strictEqual(app.scene, 'play');
  assert.strictEqual(app.stamina.snapshot(now).balance, beforeLocked, 'replay stays free');
  play();
  assert.strictEqual(app.rewardUnlocks.view().balance, balance + 100, 'no duplicate first-clear coins');
  assert.strictEqual(app.stamina.snapshot(now).balance, beforeLocked, 'no duplicate ice quick-clear refund');
  app.dispose();
  const restarted = new App(platform, options);
  assert(restarted.progress.isCompleted(4, 105));
  assert.strictEqual(restarted.openLevel(4, 105), true);
  assert.strictEqual(restarted.stamina.snapshot(now).balance, beforeLocked);
  restarted.dispose();
}

module.exports = async function run() {
  content();
  for (const width of [280, 320, 390]) await appFlow(width);
};
