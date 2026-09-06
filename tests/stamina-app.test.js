'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const GameRunner = require('../core/game-runner.js');
const catalog = require('../data/catalog-v2.js');
const dailySolutions = require('../data/daily-solutions.js');
const { createStaminaFixture, STORAGE_KEY, NOW, INTERVAL, clone } = require('./helpers/stamina-fixture.js');

function fixture(balance, unlocked) {
  const f = createStaminaFixture({ schemaVersion: 1, balance,
    nextRecoveryAt: balance < 5 ? NOW + INTERVAL : null, unlockedLevels: [], refundedLevels: [] });
  f.app = new App(f.platform, { stamina: f.service, clock: f.clock,
    progressionConfig: { unlockAllLevelsInDevTools: unlocked === true } });
  return f;
}

function finishLine(app, path, line, elapsedMs = 60001) {
  const runner = app.activeRunner();
  runner.touchStart(path[0]);
  path.slice(1).forEach(cell => runner.touchMove(cell));
  runner.touchEnd(path[path.length - 1]);
  // Unlock-only cases finish outside the refund window; refund cases inject
  // their exact boundary time without changing the global clock.
  runner.elapsedMs = () => elapsedMs;
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
  const resumeCalls = [];
  const cloudOpen = createStaminaFixture();
  const cloudOpenApp = new App(cloudOpen.platform, { clock: cloudOpen.clock,
    progressSync: { enqueueLastPlayed(input) { resumeCalls.push(input); return true; } } });
  assert(cloudOpenApp.openLevel(0, 0));
  assert.deepStrictEqual(resumeCalls, [{ setIndex: 0, levelIndex: 0, occurredAtClient: NOW }],
    'a persisted ordinary open reaches the last-played sync boundary');
  cloudOpenApp.dispose();

  const failedOpen = createStaminaFixture(); const originalSetStorage = failedOpen.platform.setStorage.bind(failedOpen.platform);
  const failedResumeCalls = [];
  failedOpen.platform.setStorage = (key, value) => key === 'cleared:minigame:progress:v2'
    ? false : originalSetStorage(key, value);
  const failedOpenApp = new App(failedOpen.platform, { clock: failedOpen.clock,
    progressSync: { enqueueLastPlayed(input) { failedResumeCalls.push(input); return true; } } });
  assert(failedOpenApp.openLevel(0, 0));
  assert.deepStrictEqual(failedResumeCalls, [], 'an unpersisted last-played value is never queued');
  failedOpenApp.dispose();

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
  assert.strictEqual(f.writes.length, 1, 'home permanently unlocks the first level once');
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
  assert.strictEqual(f.service.snapshot().balance, 4, 'result replay is free');
  finishLine(f.app, [0, 1, 2, 3, 4], 0);
  f.app.performAction('result:next');
  assert.strictEqual(f.app.levelIndex, 1);
  assert.strictEqual(f.service.snapshot().balance, 3, 'the next new level costs one unlock');
  f.app.performAction('play:back');
  f.app.performAction('level:0:1');
  assert.strictEqual(f.service.snapshot().balance, 3, 'returning from selector reuses the permanent unlock');
  f.app.performAction('play:back');
  f.app.performAction('level:1');
  assert.strictEqual(f.service.snapshot().balance, 3, 'legacy card action also reuses the unlock');
  assert.strictEqual(f.writes.length, 2);
  f.app.dispose();

  const failure = fixture(1);
  failure.app.createOrdinaryRunner = () => new GameRunner({ Width: 3, Height: 2,
    Lines: [{ Start: 0, End: 1 }, { Start: 3, End: 4 }] }, ['#f00', '#0f0']);
  assert(failure.app.openLevel(0, 0));
  finishLine(failure.app, [0, 1], 0, 1000); finishLine(failure.app, [3, 4], 1, 1000);
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
      ['result', 'result:next']]) {
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

  const repeat = fixture(2, true);
  assert(repeat.app.openLevel(portalLevel.setIndex, portalLevel.levelIndex));
  assert(repeat.app.openLevel(0, 0));
  assert.strictEqual(repeat.service.snapshot().balance, 0);
  finishLine(repeat.app, [0, 1, 2, 3, 4], 0);
  repeat.failStorage(true);
  repeat.app.performAction('result:replay');
  assert.strictEqual(repeat.app.scene, 'play', 'completed replay remains free at zero');
  assert.strictEqual(repeat.service.snapshot().balance, 0);
  repeat.app.dispose();
  const restarted = new App(repeat.platform, { clock: repeat.clock,
    progressionConfig: { unlockAllLevelsInDevTools: true } });
  assert(restarted.openLevel(portalLevel.setIndex, portalLevel.levelIndex), 'unfinished Portal unlock survives restart and a different lastPlayed');
  assert.strictEqual(restarted.staminaSnapshot.balance, 0);
  restarted.performAction('play:back');
  restarted.performAction(`level:${portalLevel.setIndex}:${portalLevel.levelIndex}`);
  assert.strictEqual(restarted.scene, 'play');
  assert.strictEqual(repeat.writes.length, 2, 'all later entries avoid both debits and writes');
  restarted.dispose();

  const legacy = createStaminaFixture({ schemaVersion: 1, balance: 0, nextRecoveryAt: NOW + INTERVAL });
  legacy.raw.storage['cleared:minigame:progress:v2'] = { schemaVersion: 2, completed: { '0:0': true },
    lastPlayed: { setIndex: 0, levelIndex: 1 } };
  const migrated = new App(legacy.platform, { clock: legacy.clock });
  assert.deepStrictEqual(legacy.raw.storage[STORAGE_KEY].unlockedLevels, ['0:0', '0:1']);
  assert(migrated.openLevel(0, 0)); assert(migrated.openLevel(0, 1));
  assert.strictEqual(migrated.staminaSnapshot.balance, 0, 'known legacy completion and last-played access remain free');
  migrated.dispose();

  const daily = fixture(0);
  daily.app.stamina.unlockOrdinaryLevel = () => { throw new Error('daily cannot consume ordinary stamina'); };
  daily.app.stamina.refundQuickClear = () => { throw new Error('daily cannot refund ordinary stamina'); };
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

  const home = fixture(4);
  home.app.tick(NOW);
  const homeState = preservedState(home.app);
  const storage = clone(home.raw.storage);
  assert.strictEqual(home.app.buildModel().homeStaminaExpanded, false);
  const hit = home.app.renderer.hits.find(item => item.id === 'home:stamina');
  const point = { x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2, id: 7 };
  home.app.onPointerStart(point); home.app.onPointerEnd(point);
  assert.strictEqual(home.app.buildModel().homeStaminaExpanded, true);
  assert.deepStrictEqual(preservedState(home.app), homeState);
  assert.deepStrictEqual(home.raw.storage, storage, 'viewing stamina does not debit or save UI state');
  home.app.onPointerStart(point); home.app.onPointerEnd(point);
  assert.strictEqual(home.app.buildModel().homeStaminaExpanded, false);
  home.app.performAction('home:stamina');
  home.app.performAction('home:levels');
  assert.strictEqual(home.app.performAction('home:stamina'), false, 'home-only action');
  home.app.performAction('levels:home');
  assert.strictEqual(home.app.buildModel().homeStaminaExpanded, false);
  home.app.performAction('home:stamina'); home.app.onHide(); home.app.onShow();
  assert.strictEqual(home.app.buildModel().homeStaminaExpanded, false);
  home.app.dispose();

  const fast = fixture(5);
  assert(fast.app.openLevel(0, 0));
  finishLine(fast.app, [0, 1, 2, 3, 4], 0, 60000);
  assert.strictEqual(fast.app.result.elapsedMs, 60000);
  assert.strictEqual(fast.app.staminaSnapshot.balance, 5);
  assert.strictEqual(fast.app.result.staminaRefunded, 1);
  assert.strictEqual(fast.app.buildModel().staminaRefund.status, 'claimed');
  assert.strictEqual(fast.app.staminaFeedback.reason, 'quick-clear-refund');
  fast.app.performAction('result:replay');
  finishLine(fast.app, [0, 1, 2, 3, 4], 0, 1000);
  assert.strictEqual(fast.app.result.staminaRefunded, 0);
  assert.strictEqual(fast.app.staminaSnapshot.balance, 5);
  fast.app.dispose();

  const laterFast = fixture(5);
  assert(laterFast.app.openLevel(0, 0));
  finishLine(laterFast.app, [0, 1, 2, 3, 4], 0, 60001);
  assert.strictEqual(laterFast.app.buildModel().staminaRefund.status, 'available');
  assert.strictEqual(laterFast.app.staminaSnapshot.balance, 4);
  laterFast.app.performAction('result:replay');
  finishLine(laterFast.app, [0, 1, 2, 3, 4], 0, 59999);
  assert.strictEqual(laterFast.app.result.firstClear, false);
  assert.strictEqual(laterFast.app.result.staminaRefunded, 1, 'first fast clear is independent from first completion');
  laterFast.app.dispose();

  const refundFailure = fixture(5);
  assert(refundFailure.app.openLevel(0, 0));
  refundFailure.failStorage(true);
  finishLine(refundFailure.app, [0, 1, 2, 3, 4], 0, 15000);
  assert.strictEqual(refundFailure.app.scene, 'result');
  assert.strictEqual(refundFailure.app.staminaSnapshot.balance, 4);
  assert.strictEqual(refundFailure.app.buildModel().staminaRefund.status, 'pending');
  assert.strictEqual(refundFailure.raw.storage['cleared:minigame:progress:v2'].bestMs['0:0'], 15000);
  refundFailure.app.dispose(); refundFailure.failStorage(false);
  const recoveredRefund = new App(refundFailure.platform, { clock: refundFailure.clock });
  assert.strictEqual(recoveredRefund.staminaSnapshot.balance, 5, 'saved fast completion recovers an interrupted refund on restart');
  assert.strictEqual(recoveredRefund.stamina.quickClearRefundState('0:0').status, 'claimed');
  recoveredRefund.onShow();
  assert.strictEqual(recoveredRefund.staminaSnapshot.balance, 5);
  recoveredRefund.dispose();

  const oldFast = createStaminaFixture({ schemaVersion: 1, balance: 5, nextRecoveryAt: null });
  oldFast.raw.storage['cleared:minigame:progress:v2'] = { schemaVersion: 2,
    completed: { '0:0': true }, bestMs: { '0:0': 15000 }, lastPlayed: { setIndex: 0, levelIndex: 0 } };
  const oldFastApp = new App(oldFast.platform, { clock: oldFast.clock });
  assert.strictEqual(oldFastApp.staminaSnapshot.balance, 6, 'known legacy fast records qualify once as well');
  oldFastApp.onShow();
  assert.strictEqual(oldFastApp.staminaSnapshot.balance, 6);
  oldFastApp.dispose();

  const portalFast = fixture(5, true);
  assert(portalFast.app.openLevel(1, 4));
  const segments = [[0, 1, 6, 5, 10, 11, 16, 15, 20, 21], [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24]];
  segments.forEach(cells => {
    portalFast.app.runner.touchStart(cells[0]);
    cells.slice(1).forEach(cell => portalFast.app.runner.touchMove(cell));
    portalFast.app.runner.touchEnd(cells[cells.length - 1]);
  });
  assert.strictEqual(portalFast.app.runner.getViewState().outcome, 'won');
  portalFast.app.runner.elapsedMs = () => 45000;
  portalFast.app.onPathCompleted(0, segments.flat(), segments);
  assert.strictEqual(portalFast.app.staminaSnapshot.balance, 5);
  assert.strictEqual(portalFast.app.result.staminaRefunded, 1);
  portalFast.app.dispose();
}

module.exports = run;
