'use strict';

const assert = require('assert');
const GameRunner = require('../core/game-runner.js');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const trial = require('../data/ice-trial.js');
const { createTrialRunContext, createCatalogRunContext } = require('../src/gameplay/run-context.js');
const completionPolicies = require('../src/gameplay/completion-policies.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { allOwnedRewardService } = require('./helpers/reward-fixture.js');
const HintService = require('../src/services/hint-service.js');

const makeRunner = patch => new GameRunner(Object.assign({}, trial.Games[0], patch), trial.Palette);
const layers = runner => runner.getBoardState().remainingLayers[12];
function connect(runner, path) {
  assert(runner.startGesture(path[0]).changed);
  path.slice(1).forEach(index => assert(runner.moveGesture(index).changed, `cannot enter ${index}`));
  const result = runner.endGesture(path[path.length - 1]);
  assert(result.commit, 'only completed connections consume ice');
  return result;
}

function rules() {
  const context = createTrialRunContext(trial);
  assert(Object.isFrozen(context) && Object.isFrozen(context.source));
  assert.strictEqual(context.setIndex, null);
  assert.deepStrictEqual(context.mechanic, { id: 'ice', rulesVersion: 1 });
  const ordinary = createCatalogRunContext({ sets: [trial] }, 0, 0);
  assert.strictEqual(ordinary.progressionScope, 'ordinary', 'source, not ice, determines progression');
  const settled = completionPolicies.settle(context, {
    elapsedMs: 42,
    progress: { recordCompletion() { throw Error('trial wrote progress'); } }
  });
  assert.deepStrictEqual(settled, { outcome: 'won', elapsedMs: 42 });
  assert.strictEqual(createTrialRunContext({ Id: 'empty', Games: [] }), null);

  // Every connection order and endpoint direction must solve the sample.
  const permutations = values => values.length ? values.flatMap(value =>
    permutations(values.filter(other => other !== value)).map(rest => [value].concat(rest))) : [[]];
  permutations([0, 1, 2, 3]).forEach(order => {
    for (let reversed = 0; reversed < 16; reversed++) {
      const runner = makeRunner();
      order.forEach(index => connect(runner, reversed & (1 << index)
        ? trial.solution[index].slice().reverse() : trial.solution[index]));
      assert.strictEqual(runner.getViewState().outcome, 'won');
      assert.strictEqual(runner.remainingCellCount(), 0);
      assert.strictEqual(layers(runner), 0);
    }
  });

  const runner = makeRunner();
  runner.startGesture(10); runner.moveGesture(11); runner.moveGesture(12);
  runner.moveGesture(11); runner.moveGesture(12);
  assert.strictEqual(layers(runner), 2, 'backtracking is not a second use');
  runner.endGesture(12);
  assert.strictEqual(layers(runner), 2, 'an incomplete line does not break ice');
  connect(runner, trial.solution[0]);
  assert.strictEqual(layers(runner), 1);
  assert.strictEqual(runner.getBoardState().owner[12], -1, 'broken ice exposes playable floor');
  assert.strictEqual(runner.filledCount(), 4, 'first use clears four normal cells, not the icy floor');
  const first = runner.snapshot();
  const detached = runner.getBoardState(); detached.remainingLayers[12] = 99;
  runner.getMechanicState().cells[0].remainingLayers = 99;
  assert.strictEqual(layers(runner), 1, 'views cannot mutate remaining layers');
  runner.startGesture(10);
  assert.strictEqual(layers(runner), 2, 'redrawing removes the prior line contribution');
  runner.cancelGesture('navigation');
  assert.strictEqual(layers(runner), 1, 'lifecycle cancellation restores the stable line and ice');
  connect(runner, trial.solution[0]);
  assert.strictEqual(layers(runner), 1, 'redrawing the same line cannot consume two layers');
  connect(runner, trial.solution[1]);
  assert.strictEqual(layers(runner), 0);
  assert(runner.getBoardState().owner[12] >= 0, 'second use makes the cell unavailable');
  assert(runner.undo()); assert.strictEqual(layers(runner), 1);
  runner.restore(first); assert.strictEqual(layers(runner), 1);
  runner.reset(); assert.strictEqual(layers(runner), 2);

  const hints = new HintService();
  const full = hints.findComplete(runner);
  assert(full && full.steps.length === 4);
  assert.strictEqual(full.steps[0].remainingLayers[12], 2);
  assert.strictEqual(full.steps[1].remainingLayers[12], 1);
  assert.strictEqual(full.steps[2].remainingLayers[12], 0);
  const bad = trial.solution.map(path => path.slice());
  bad[0] = [10, 11, 6, 7, 8, 13, 14];
  assert.strictEqual(hints.iceProvider.findComplete(runner.getViewState(), bad), null,
    'a preset cannot share ordinary floor or miss the second ice use');
  bad[0] = [10, 11, 12, 11, 12, 13, 14];
  assert.strictEqual(hints.iceProvider.findComplete(runner.getViewState(), bad), null,
    'revisiting within one line cannot fake two ice uses');

  const missed = new GameRunner({ Width: 3, Height: 3, Mechanic: 'ice', IceRulesVersion: 1,
    IceCells: [4], Lines: [{ Start: 3, End: 5 }, { Start: 0, End: 2 }, { Start: 6, End: 8 }] });
  [[3, 4, 5], [0, 1, 2], [6, 7, 8]].forEach(path => connect(missed, path));
  assert.strictEqual(missed.getViewState().outcome, 'failed', 'covering every cell once is insufficient');
  assert.strictEqual(missed.remainingCellCount(), 1);

  for (const patch of [{ IceRulesVersion: 2 }, { IceRulesVersion: '1' }, { Mechanic: 'unknown' },
    { IceCells: [] }, { IceCells: [12, 12] }, { IceCells: [10] }, { IceCells: [25] },
    { IceCells: [1.5] }, { IceCells: ['12'] }, { IceCells: null }, { Blocked: [12] }, { Portals: [] }]) {
    assert.strictEqual(makeRunner(patch).getMechanicState().id, null,
      `malformed ice safely retains normal movement: ${JSON.stringify(patch)}`);
  }
}

function appFlow(width, height, effect) {
  const raw = fakeApi();
  raw.getWindowInfo = () => ({ windowWidth: width, windowHeight: height, pixelRatio: 2,
    safeArea: { top: 44, bottom: height - 24 } });
  const app = new App(new Platform(raw), { rewardUnlocks: allOwnedRewardService(),
    clock: () => new Date('2026-09-07T00:00:00Z') });
  app.setClearEffect(effect);
  const before = JSON.stringify(raw.storage);
  const forbidden = () => { throw Error('trial touched an ordinary progression boundary'); };
  app.progress.markOpened = forbidden; app.progress.recordCompletion = forbidden;
  app.stamina.unlockOrdinaryLevel = forbidden; app.stamina.refundQuickClear = forbidden;
  app.ads.onLevelCompleted = forbidden;
  const texts = [];
  const text = app.renderer.text.bind(app.renderer);
  app.renderer.text = (value, ...rest) => { texts.push(String(value)); text(value, ...rest); };
  const render = () => { texts.length = 0; app.renderer.render(app.buildModel(), Date.now() + 1000); };
  render();
  const entrance = app.renderer.hits.find(hit => hit.id === 'home:iceTrial');
  assert.strictEqual(entrance, undefined, 'hidden trial entry has no home touch target');
  assert(!texts.some(value => value.includes('冰封试玩')), 'home does not draw a trial label');
  app.performAction('home:iceTrial');
  assert.strictEqual(app.scene, 'play');
  render();
  assert(texts.includes('冰封试玩'));
  assert(texts.includes('第一次破冰，第二次消除地板'));
  assert(app.renderer.hits.some(hit => hit.id === 'play:hint'));
  const layout = app.renderer.boardLayout;
  assert.strictEqual(layout.cols, 5); assert.strictEqual(layout.rows, 5);
  assert(layout.x >= 0 && layout.x + layout.cell * 5 <= width);
  assert(layout.y >= app.platform.metrics.safeTop &&
    layout.y + layout.cell * 5 < app.platform.metrics.safeBottom - 78);
  const point = index => ({ id: 1, x: layout.x + (index % 5 + 0.5) * layout.cell,
    y: layout.y + (Math.floor(index / 5) + 0.5) * layout.cell });
  const draw = path => {
    app.onPointerStart(point(path[0]));
    path.slice(1).forEach(index => app.onPointerMove(point(index)));
    app.onPointerEnd(point(path[path.length - 1]));
  };
  assert.strictEqual(app.buildModel().board.cells[12].frozen, true);
  app.engagement.requestHint = forbidden;
  const checkHint = () => {
    const snapshot = JSON.stringify(app.runner.snapshot());
    const board = JSON.stringify(app.runner.getBoardState());
    assert.strictEqual(app.requestHint(), true, 'trial hint is free, even without ad/share access');
    const preview = app.hintPreview;
    assert.strictEqual(preview.manual, true);
    assert.strictEqual(preview.index, 0);
    assert.strictEqual(preview.frames.length, 4);
    assert.strictEqual(preview.frames[0].board.cells[12].frozen, true, 'preview always starts with intact ice');
    assert.strictEqual(preview.frames[1].board.cells[12].owner, -1);
    assert.strictEqual(preview.frames[1].board.cells[12].frozen, false);
    assert(preview.frames[2].board.cells[12].owner >= 0);
    const click = id => {
      const hit = app.renderer.hits.find(item => item.id === id);
      assert(hit, `missing control ${id}`);
      const location = { id: 9, x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2 };
      app.onPointerStart(location); app.onPointerEnd(location);
      render();
    };
    const swipe = (dx, dy) => {
      const start = { id: 8, x: width / 2 - dx / 2, y: layout.y + layout.cell * 2.5 };
      const end = { id: 8, x: start.x + dx, y: start.y + dy };
      app.onPointerStart(start); app.onPointerMove(end); app.onPointerEnd(end);
      render();
    };
    app.tick(Date.now() + 20000);
    assert.strictEqual(app.hintPreview, preview, 'manual preview never expires after ten seconds');
    assert.strictEqual(preview.index, 0, 'time alone cannot advance a manual step');
    preview.frames.forEach((frame, index) => {
      if (index) click('hint:next');
      const time = Date.now() + 60000;
      const model = app.buildModel();
      assert.strictEqual(app.renderer.renderBoardViewModel(model, model.level, time), frame);
      texts.length = 0;
      app.renderer.render(model, time);
      assert(texts.includes(frame.hintStepLabel));
      assert(texts.includes(`${index + 1}/4`));
      assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'hint:prev'), index > 0);
      assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'hint:next'), index < 3);
    });
    swipe(-90, 0); assert.strictEqual(preview.index, 3, 'last page cannot wrap');
    click('hint:prev'); assert.strictEqual(preview.index, 2);
    swipe(90, 0); assert.strictEqual(preview.index, 1, 'right swipe goes back');
    swipe(-90, 0); assert.strictEqual(preview.index, 2, 'left swipe advances');
    swipe(0, 80); assert.strictEqual(preview.index, 2, 'vertical movement cannot flip steps');
    swipe(-20, 0); assert.strictEqual(preview.index, 2, 'small movement cannot flip steps');
    const cancelPoint = { id: 8, x: width / 2, y: layout.y + layout.cell * 2 };
    app.onPointerStart(cancelPoint);
    app.onPointerMove(Object.assign({}, cancelPoint, { x: cancelPoint.x - 90 }));
    app.onPointerCancel(cancelPoint);
    assert.strictEqual(preview.index, 2, 'cancelled swipe cannot flip steps');
    click('hint:prev'); click('hint:prev');
    swipe(90, 0); assert.strictEqual(preview.index, 0, 'first page cannot wrap');
    draw(trial.solution[0]);
    app.performAction('play:undo'); app.performAction('play:reset');
    assert.strictEqual(JSON.stringify(app.runner.snapshot()), snapshot, 'preview blocks all board mutations');
    assert.strictEqual(JSON.stringify(app.runner.getBoardState()), board);
    assert.strictEqual(app.requestHint(), true, 'second tap hides preview');
    assert.strictEqual(app.hintPreview, null);
    const model = app.buildModel();
    assert.strictEqual(app.renderer.renderBoardViewModel(model, model.level, Date.now()), model);
    assert.strictEqual(JSON.stringify(app.runner.getBoardState()), board);
    render();
  };
  checkHint();
  draw(trial.solution[0]);
  assert.strictEqual(layers(app.runner), 1);
  assert.strictEqual(app.buildModel().board.cells[12].frozen, false);
  if (effect === 'fade') assert.deepStrictEqual(app.clearAnimation.iceBrokenCells, [12]);
  else assert.strictEqual(app.clearAnimation, null, 'default simultaneous play needs no no-effect snapshot');
  checkHint();
  app.performAction('play:undo');
  assert.strictEqual(layers(app.runner), 2);
  assert.strictEqual(app.clearAnimation, null);
  trial.solution.forEach(draw);
  assert.strictEqual(app.scene, 'result');
  assert.strictEqual(app.buildModel().trial, true);
  assert.strictEqual(app.buildModel().shareAvailable, false);
  assert.strictEqual(app.result.currencyReward, undefined);
  render();
  assert(texts.includes('试玩完成'));
  assert(!app.renderer.hits.some(hit => hit.id === 'result:next' || hit.id === 'result:share'));
  app.performAction('result:replay');
  assert.strictEqual(app.scene, 'play'); assert.strictEqual(layers(app.runner), 2);
  render();
  draw(trial.solution[0]); draw([2, 7, 12, 17, 22]);
  draw(trial.solution[2]); draw(trial.solution[3]);
  assert.strictEqual(app.scene, 'result');
  assert.strictEqual(app.result.outcome, 'failed');
  app.performAction('failure:retry');
  assert.strictEqual(app.scene, 'play'); assert.strictEqual(layers(app.runner), 2);
  app.performAction('play:back');
  assert.strictEqual(app.scene, 'home');
  assert.strictEqual(app.runner, null);
  assert.strictEqual(app.runContext, null);
  assert.strictEqual(JSON.stringify(raw.storage), before, 'enter, win, replay and leave cannot change any save');
  app.dispose();
}

function run() {
  rules();
  for (const effect of ['none', 'fade']) {
    for (const size of [[280, 568], [320, 568], [390, 844]]) appFlow(size[0], size[1], effect);
  }
}

module.exports = run;
