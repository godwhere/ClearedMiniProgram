'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const GameRunner = require('../core/game-runner.js');
const catalog = require('../data/catalog-v2.js');
const dailySolutions = require('../data/daily-solutions.js');
const { createStaminaFixture, STORAGE_KEY, NOW, INTERVAL, clone } = require('./helpers/stamina-fixture.js');

function fixture(balance, unlocked) {
  const f = createStaminaFixture({ schemaVersion: 1, balance,
    nextRecoveryAt: balance < 5 ? NOW + INTERVAL : null });
  f.app = new App(f.platform, { stamina: f.service, clock: f.clock,
    progressionConfig: { unlockAllLevelsInDevTools: unlocked === true } });
  return f;
}

function finishLine(app, path, line) {
  const runner = app.activeRunner();
  runner.touchStart(path[0]);
  path.slice(1).forEach(cell => runner.touchMove(cell));
  runner.touchEnd(path[path.length - 1]);
  app.onPathCompleted(line, path);
}

function preservedState(app) {
  return {
    scene: app.scene, runner: app.runner, runContext: app.runContext, result: app.result,
    inputRunner: app.boardInput.runner, setIndex: app.setIndex, levelIndex: app.levelIndex,
    levelPageIndex: app.levelPageIndex, levelEnteredAt: app.levelEnteredAt,
    hint: app.hint, hintRequest: app.hintRequest, clearAnimation: app.clearAnimation,
    resultVisibleAt: app.resultVisibleAt, progress: clone(app.progress.state)
  };
}

function run() {
  const direct = createStaminaFixture();
  const directApp = new App(direct.platform, { clock: direct.clock });
  assert.strictEqual(directApp.staminaSnapshot.balance, 5, 'direct construction enables stamina');
  assert(directApp.openLevel(0, 0));
  assert.strictEqual(direct.raw.storage[STORAGE_KEY].balance, 4);
  directApp.dispose();

  const gates = fixture(5);
  for (const target of [[-1, 0], [0, 999], [1.5, 0], ['0', 0], [0, 1]]) {
    const before = preservedState(gates.app);
    assert.strictEqual(gates.app.openLevel(...target), false);
    assert.deepStrictEqual(preservedState(gates.app), before);
  }
  assert.strictEqual(gates.writes.length, 0, 'invalid and locked targets never debit');
  assert.strictEqual(gates.app.createOrdinaryRunner({ level: null, set: {} }), null);
  gates.app.createOrdinaryRunner = () => null;
  assert.strictEqual(gates.app.openLevel(0, 0), false);
  assert.strictEqual(gates.writes.length, 0);
  gates.app.dispose();

  const f = fixture(5);
  f.app.performAction('home:start');
  assert.strictEqual(f.app.scene, 'play');
  assert.strictEqual(f.service.snapshot().balance, 4);
  assert.strictEqual(f.writes.length, 1, 'home starts exactly one attempt');
  assert.deepStrictEqual(f.app.progress.state.lastPlayed, { setIndex: 0, levelIndex: 0 });
  const runner = f.app.runner;
  f.app.performAction('play:reset');
  assert.strictEqual(f.app.runner, runner);
  assert.strictEqual(f.service.snapshot().balance, 4);
  finishLine(f.app, [0, 1, 2, 3, 4], 0);
  assert.strictEqual(f.app.scene, 'result');
  assert.strictEqual(f.service.snapshot().balance, 4, 'settlement does not debit');
  f.app.performAction('result:replay');
  assert.notStrictEqual(f.app.runner, runner);
  assert.strictEqual(f.service.snapshot().balance, 3);
  finishLine(f.app, [0, 1, 2, 3, 4], 0);
  f.app.performAction('result:next');
  assert.strictEqual(f.app.levelIndex, 1);
  assert.strictEqual(f.service.snapshot().balance, 2);
  f.app.performAction('play:back');
  f.app.performAction('level:0:1');
  assert.strictEqual(f.service.snapshot().balance, 1, 'returning from selector creates another attempt');
  f.app.performAction('play:back');
  f.app.performAction('level:1');
  assert.strictEqual(f.service.snapshot().balance, 0, 'legacy card action also debits once');
  assert.strictEqual(f.writes.length, 5);
  f.app.dispose();

  const failure = fixture(1);
  failure.app.createOrdinaryRunner = () => new GameRunner({ Width: 3, Height: 2,
    Lines: [{ Start: 0, End: 1 }, { Start: 3, End: 4 }] }, ['#f00', '#0f0']);
  assert(failure.app.openLevel(0, 0));
  finishLine(failure.app, [0, 1], 0); finishLine(failure.app, [3, 4], 1);
  assert.strictEqual(failure.app.result.outcome, 'failed');
  const failedRunner = failure.app.runner;
  failure.app.performAction('failure:retry');
  assert.strictEqual(failure.app.runner, failedRunner);
  assert.strictEqual(failure.app.scene, 'play');
  assert.strictEqual(failure.app.runner.getViewState().outcome, 'playing');
  assert.strictEqual(failure.service.snapshot().balance, 0);
  failure.app.performAction('play:reset');
  assert.strictEqual(failure.service.snapshot().balance, 0);
  assert.strictEqual(failure.writes.length, 1);
  failure.app.dispose();

  // Each denied action preserves the entire current run, result and progress.
  for (const diskFailure of [false, true]) {
    for (const [scene, action] of [['home', 'home:start'], ['levels', 'level:0:1'],
      ['result', 'result:replay'], ['result', 'result:next']]) {
      const denied = fixture(diskFailure ? 5 : 1, true);
      assert(denied.app.openLevel(0, 0));
      finishLine(denied.app, [0, 1, 2, 3, 4], 0);
      denied.app.scene = scene; denied.app.levelPageIndex = 3;
      denied.app.hintRequest = { pending: true };
      denied.failStorage(diskFailure);
      const before = preservedState(denied.app);
      const persisted = clone(denied.raw.storage);
      denied.app.performAction(action);
      assert.deepStrictEqual(preservedState(denied.app), before, `${scene}/${action}`);
      assert.strictEqual(denied.app.runner, before.runner);
      assert.strictEqual(denied.app.runContext, before.runContext);
      assert.strictEqual(denied.app.result, before.result);
      assert.deepStrictEqual(denied.raw.storage, persisted);
      assert.strictEqual(denied.app.staminaFeedback.reason, diskFailure ? 'persist-failed' : 'insufficient-stamina');
      assert.strictEqual(denied.app.staminaFeedback.until, NOW + 2200);
      denied.app.dispose();
    }
  }

  const final = fixture(1, true);
  const last = catalog.levels[catalog.levels.length - 1];
  assert(final.app.openLevel(last.setIndex, last.levelIndex));
  final.app.scene = 'result'; final.app.result = { outcome: 'won' };
  final.app.performAction('result:next');
  assert.strictEqual(final.app.scene, 'levels');
  assert.strictEqual(final.app.levelPageIndex, 3);
  assert.strictEqual(final.writes.length, 1);
  final.app.dispose();

  const portal = fixture(5, true);
  const portalLevel = catalog.levels.find(item => item.game.Mechanic === 'portal');
  assert(portal.app.openLevel(portalLevel.setIndex, portalLevel.levelIndex));
  assert.strictEqual(portal.app.runContext.progressionScope, 'ordinary');
  assert.strictEqual(portal.service.snapshot().balance, 4);
  portal.app.dispose();

  const daily = fixture(0);
  daily.app.stamina.consumeOrdinaryAttempt = () => { throw new Error('daily cannot consume ordinary stamina'); };
  assert(daily.app.enterDaily());
  const dateKey = daily.app.daily.dateKey;
  const entry = daily.app.dailyProgress.getDay(dateKey);
  const firstDailyRunner = daily.app.daily.runner;
  daily.app.performAction('daily:reset');
  assert.strictEqual(daily.app.daily.runner, firstDailyRunner);
  finishLine(daily.app, [0, 1, 2], 0); finishLine(daily.app, [3, 6], 1);
  assert.strictEqual(daily.app.scene, 'dailyResult');
  daily.app.performAction('dailyFailure:retry');
  assert.strictEqual(daily.app.scene, 'daily');
  for (let i = 0; i < 2; i++) {
    const paths = dailySolutions.ByChallengeId[daily.app.daily.challengeId];
    paths.forEach((path, line) => finishLine(daily.app, path, line));
  }
  assert.strictEqual(daily.app.scene, 'dailyResult');
  assert.strictEqual(daily.app.daily.result.completed, true);
  assert.strictEqual(daily.app.dailyProgress.getDay(dateKey).entriesUsed, entry.entriesUsed);
  daily.app.performAction('dailyResult:replay');
  assert.strictEqual(daily.app.scene, 'daily');
  assert.strictEqual(daily.service.snapshot().balance, 0);
  assert.strictEqual(daily.writes.length, 0);
  daily.app.dispose();

  const lifecycle = fixture(3);
  assert(lifecycle.app.openLevel(0, 0));
  const current = lifecycle.app.runner;
  lifecycle.app.onHide();
  lifecycle.setNow(NOW + 720000);
  lifecycle.app.onShow();
  assert.strictEqual(lifecycle.app.runner, current);
  assert.strictEqual(lifecycle.app.scene, 'play');
  assert.strictEqual(lifecycle.app.staminaSnapshot.balance, 4);
  assert.strictEqual(lifecycle.app.staminaSnapshot.remainingMs, 180000);
  assert.strictEqual(lifecycle.writes.length, 2, 'hide/show only writes changed recovery once');
  lifecycle.app.onShow();
  assert.strictEqual(lifecycle.writes.length, 2);
  lifecycle.app.dispose();

  for (const throws of [false, true]) {
    const progressFailure = fixture(5);
    progressFailure.app.progress.save = () => { if (throws) throw Error('progress disk failure'); return false; };
    assert(progressFailure.app.openLevel(0, 0));
    assert.strictEqual(progressFailure.app.scene, 'play');
    assert(progressFailure.app.runner);
    assert.strictEqual(progressFailure.service.snapshot().balance, 4);
    progressFailure.app.dispose();
  }

  const frames = fixture(0);
  const renders = [];
  frames.app.renderer.render = model => renders.push(model);
  frames.app.tick(NOW); frames.app.tick(NOW + 1); frames.app.tick(NOW + 999);
  assert.strictEqual(renders.length, 1, 'no redraw while displayed second is unchanged');
  frames.app.tick(NOW + 1000);
  assert.strictEqual(renders.length, 2);
  frames.setNow(NOW + 1000); frames.app.performAction('home:start');
  frames.app.tick(NOW + 1000);
  assert(renders[renders.length - 1].staminaFeedback);
  frames.app.tick(NOW + 3199);
  const beforeExpiry = renders.length;
  assert(renders[renders.length - 1].staminaFeedback);
  frames.app.tick(NOW + 3200);
  assert.strictEqual(renders.length, beforeExpiry + 1, 'expiration redraws even within the same countdown second');
  assert.strictEqual(renders[renders.length - 1].staminaFeedback, null, 'expiration renders a cleanup frame');
  const model = frames.app.buildModel(); model.stamina.balance = 999;
  assert.strictEqual(frames.app.staminaSnapshot.balance, 0);
  assert.strictEqual(frames.writes.length, 0);
  frames.app.dispose();
}

module.exports = run;
