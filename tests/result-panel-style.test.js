'use strict';

const assert = require('assert');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');
const classic = require('../src/skins/classic.js');

function fixture(metrics) {
  const calls = [];
  const context = { calls };
  ['save', 'restore', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo',
    'closePath', 'fill', 'stroke', 'arc', 'translate', 'fillText'].forEach(method => {
    context[method] = (...args) => calls.push({ method, args, fill: context.fillStyle, font: context.font });
  });
  const renderer = new CanvasRenderer({ context, metrics, createImage() {} }, { current: () => classic });
  const buttons = [];
  const button = renderer.button.bind(renderer);
  renderer.button = (id, rect, label, options, pressedId) => {
    buttons.push({ id, rect, label, options });
    button(id, rect, label, options, pressedId);
  };
  const previews = [];
  renderer.drawThemeElementsPreview = (preview, rect) => previews.push({ preview, rect });
  return { renderer, calls, buttons, previews };
}

function purchase(state, conditionType, mode) {
  return {
    rewardDialog: {
      rewardId: 'theme:desserts', mode: mode || 'condition', state: state || 'idle',
      title: '甜点', message: '10000 货币解锁（余额 10000）',
      primaryAction: state === 'retry-save' ? 'reward:retry' : 'reward:unlock',
      primaryLabel: state === 'retry-save' ? '重试保存' : '确认购买', primaryEnabled: true,
      secondaryAction: 'reward:close', secondaryLabel: '关闭',
      preview: { id: 'desserts', name: '甜点', reward: { conditionType: conditionType || 'currency' } }
    }
  };
}

function run() {
  const cases = [
    { name: 'ordinary success', method: 'drawResult', height: 246, title: '新纪录',
      model: { result: { newBest: true, elapsedMs: 7000, bestMs: 7000 }, resultVisibleAt: 0, hasNext: true },
      actions: ['result:levels', 'result:replay', 'result:next'] },
    { name: 'daily success', method: 'drawDailyResult', height: 300, title: '每日挑战完成  2 / 2',
      model: { result: { elapsedMs: 7000 }, dailyLevelCount: 2, dailyEntriesRemaining: 1, dailyEntryLimit: 3 },
      actions: ['dailyResult:home', 'dailyResult:replay'] },
    { name: 'ordinary failure', method: 'drawResult', height: 246, title: '挑战失败',
      model: { result: { outcome: 'failed', remainingCells: 3 }, resultVisibleAt: 0 },
      actions: ['result:levels', 'failure:retry'] },
    { name: 'daily failure', method: 'drawDailyResult', height: 268, title: '挑战失败',
      model: { result: { outcome: 'failed', remainingCells: 4 }, dailyResultVisibleAt: 0 },
      actions: ['dailyResult:home', 'dailyFailure:retry'] },
    { name: 'purchase', method: 'drawRewardDialog', height: 246, title: '甜点', model: purchase(),
      actions: ['reward:close', 'reward:unlock'] }
  ];
  const viewports = [
    { width: 280, height: 568, safeTop: 54, safeBottom: 548 },
    { width: 320, height: 568, safeTop: 54, safeBottom: 548 },
    { width: 390, height: 844, safeTop: 44, safeBottom: 810 },
    { width: 390, height: 844, safeTop: 310, safeBottom: 810 },
    { width: 768, height: 1024, safeTop: 30, safeBottom: 1000 }
  ];
  for (const metrics of viewports) for (const test of cases) {
    const f = fixture(metrics);
    const before = JSON.stringify(test.model);
    f.renderer[test.method](test.model, 1000);
    assert.strictEqual(JSON.stringify(test.model), before, `${test.name} remains read-only`);
    const bands = f.calls.filter(call => call.method === 'fillRect' && call.args[2] === metrics.width);
    assert.strictEqual(bands.length, test.name === 'purchase' ? 2 : 1,
      `${test.name} has no extra full-screen dimming layer`);
    const band = bands[bands.length - 1];
    if (test.name === 'purchase') {
      assert.strictEqual(bands[0].fill, classic.colors.homeBackground, 'purchase hides gallery labels inside its band');
      assert.deepStrictEqual(bands[0].args, band.args, 'the opaque base covers only the purchase panel');
    }
    assert.strictEqual(band.fill, classic.colors.strongPanel);
    assert.strictEqual(band.args[0], 0, `${test.name} is edge-to-edge, not a rounded card`);
    assert.strictEqual(band.args[2], metrics.width);
    assert.strictEqual(band.args[3], test.height);
    assert(band.args[1] >= metrics.safeTop && band.args[1] + test.height <= metrics.safeBottom);
    const title = f.calls.find(call => call.method === 'fillText' && call.args[0] === test.title);
    assert(title.font.startsWith('300 27px '), `${test.name} shares the success heading hierarchy`);
    assert.strictEqual(title.args[2], band.args[1] + 92);
    assert.deepStrictEqual(f.renderer.hits.map(hit => hit.id), test.actions);
    for (const { rect, options } of f.buttons) {
      assert.strictEqual(rect.h, 46);
      assert.strictEqual(options.fill, undefined, `${test.name} uses the success button fill`);
      assert.strictEqual(options.stroke, undefined, `${test.name} uses borderless success buttons`);
      assert(rect.x >= 0 && rect.x + rect.w <= metrics.width);
      assert(rect.y >= band.args[1] && rect.y + rect.h <= band.args[1] + test.height);
    }
    if (test.name === 'purchase') assert.strictEqual(f.previews.length, 1, 'purchase keeps its item preview');
  }

  const metrics = viewports[2];
  for (const state of ['idle', 'working', 'loading', 'error', 'retry-save']) {
    const f = fixture(metrics);
    f.renderer.hits = [{ id: 'theme:desserts', rect: { x: 0, y: 0, w: 390, h: 844 } }];
    f.renderer.drawRewardDialog(purchase(state));
    const primary = ['working', 'loading'].includes(state) ? []
      : [state === 'retry-save' ? 'reward:retry' : 'reward:unlock'];
    assert.deepStrictEqual(f.renderer.hits.map(hit => hit.id), ['reward:close'].concat(primary));
    assert(f.calls.some(call => call.method === 'fillRect' && call.args[3] === 246));
  }
  const disabled = fixture(metrics);
  const disabledModel = purchase();
  disabledModel.rewardDialog.primaryEnabled = false;
  disabled.renderer.drawRewardDialog(disabledModel);
  assert.deepStrictEqual(disabled.renderer.hits.map(hit => hit.id), ['reward:close']);

  for (const [condition, mode] of [['ordinary_level', 'condition'], ['rewarded_ad', 'condition'],
    ['share', 'condition'], ['currency', 'unlocked']]) {
    const f = fixture(metrics);
    const cards = [];
    const roundedRect = f.renderer.roundedRect.bind(f.renderer);
    f.renderer.roundedRect = (...args) => { cards.push(args); roundedRect(...args); };
    f.renderer.drawRewardDialog(purchase('idle', condition, mode));
    assert(f.calls.some(call => call.method === 'fillRect' && call.args[3] === metrics.height),
      `${condition}/${mode} retains its existing full-screen dimming`);
    assert(cards.some(args => args[2] === 340 && args[3] === 300 && args[4] === 14),
      `${condition}/${mode} retains its existing rounded reward card`);
  }

  const daily = fixture(viewports[1]);
  daily.renderer.drawDailyResult({ result: { elapsedMs: 7000 }, dailyLevelCount: 2,
    dailyCanEnter: false, shareAvailable: true, dailyExtraEntryAvailable: true }, 1000);
  assert.deepStrictEqual(daily.renderer.hits.map(hit => hit.id),
    ['dailyResult:home', 'dailyResult:share', 'daily:extraEntry'], 'optional actions and disabled replay remain intact');
  daily.buttons.forEach(({ rect }) => assert(rect.y + rect.h <= viewports[1].safeBottom));
}

module.exports = run;
