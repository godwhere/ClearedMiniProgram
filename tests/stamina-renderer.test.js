'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const skins = require('../src/skins/index.js');
const { createStaminaFixture, NOW, INTERVAL, clone } = require('./helpers/stamina-fixture.js');

function fixture(width, skin) {
  const f = createStaminaFixture({ schemaVersion: 1, balance: 5, nextRecoveryAt: null });
  f.platform.metrics = { width, height: 844, safeTop: 44, safeBottom: 810, dpr: 2 };
  const app = new App(f.platform, { clock: f.clock,
    progressionConfig: { unlockAllLevelsInDevTools: true } });
  app.skins.select(skin.id);
  const renderer = app.renderer;
  const badges = []; const texts = []; const prompts = [];
  const status = renderer.drawStaminaStatus.bind(renderer);
  renderer.drawStaminaStatus = (stamina, rect, options) => {
    if (stamina && stamina.enabled) badges.push(rect);
    return status(stamina, rect, options);
  };
  const text = renderer.text.bind(renderer);
  renderer.text = (value, x, y, size, options) => {
    texts.push({ value: String(value), x, y, size, options: options || {} });
    text(value, x, y, size, options);
  };
  const prompt = renderer.drawPlayInstruction.bind(renderer);
  renderer.drawPlayInstruction = (instruction, rect, now) => {
    prompts.push(clone(rect)); prompt(instruction, rect, now);
  };
  const render = (model, now) => {
    badges.length = 0; texts.length = 0; prompts.length = 0;
    renderer.render(model, now === undefined ? NOW + 100000 : now);
  };
  return { app, renderer, badges, texts, prompts, render };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function run() {
  const f = fixture(320, skins[0]);
  const rect = { x: 56, y: 40, w: 52, h: 44 };
  const stamina = { enabled: true, balance: 4, naturalCap: 5, recovering: true,
    remainingMs: 184000, overflow: 0 };
  const cases = [
    [stamina, '03:04'],
    [Object.assign({}, stamina, { remainingMs: 1 }), '00:01'],
    [Object.assign({}, stamina, { remainingMs: 999 }), '00:01'],
    [Object.assign({}, stamina, { remainingMs: 0 }), '00:00'],
    [Object.assign({}, stamina, { balance: 5, recovering: false }), '体力已满'],
    [Object.assign({}, stamina, { balance: 8, recovering: false, overflow: 3 }), '体力已满']
  ];
  f.renderer.platform.createImage = () => { throw new Error('stamina must not load images'); };
  for (const [snapshot, label] of cases) {
    f.texts.length = 0;
    const hits = clone(f.renderer.hits);
    f.renderer.drawStaminaStatus(Object.freeze(snapshot), rect, { compact: true });
    assert(f.texts.some(call => call.value === label));
    assert(f.texts.some(call => call.value === String(snapshot.balance)));
    assert(!f.texts.some(call => call.value.includes('/')),
      'stamina shows the current amount without a natural-cap denominator');
    assert(!f.texts.some(call => call.value.startsWith('额外 +')));
    assert.deepStrictEqual(f.renderer.hits, hits);
  }
  let fills = 0; let segments = 0;
  f.renderer.ctx.fill = () => { fills++; assert.strictEqual(f.renderer.ctx.fillStyle, f.app.skins.current().colors.icon); };
  f.renderer.ctx.lineTo = () => { segments++; };
  f.renderer.drawIcon('stamina', 10, 10, 18);
  assert.strictEqual(fills, 1); assert.strictEqual(segments, 5, 'lightning is a filled Canvas path');
  f.app.dispose();

  for (const skin of skins) {
    for (const width of [320, 390]) {
      const ui = fixture(width, skin);
      const { app, renderer, render, badges, texts, prompts } = ui;
      const assertBadge = () => {
        assert.strictEqual(badges.length, 1);
        const badge = badges[0];
        assert(badge.x >= 0 && badge.x + badge.w <= width);
        assert(badge.y >= 44 && badge.y + badge.h <= 810);
        assert(!renderer.hits.some(hit => hit.id !== 'home:stamina' && overlaps(badge, hit.rect)),
          `${skin.id}/${width}: badge avoids other buttons`);
        assert(!renderer.hits.some(hit => hit.id.startsWith('stamina:')));
        assert.strictEqual(renderer.hits.some(hit => hit.id === 'home:stamina'), app.scene === 'home');
      };
      render(app.buildModel()); assertBadge();
      const homeBadge = renderer.hits.find(hit => hit.id === 'home:stamina');
      const sound = renderer.hits.find(hit => hit.id === 'home:sound');
      assert.deepStrictEqual(homeBadge.rect, { x: width - 78, y: sound.rect.y, w: 64, h: 44 });
      assert(sound.rect.x + sound.rect.w < homeBadge.rect.x,
        'the currency display sits between sound and stamina');
      for (const [snapshot, label] of cases) {
        const home = Object.assign({}, app.buildModel(), { stamina: snapshot });
        render(home);
        assert(!texts.some(call => call.value === label), 'home details stay hidden until tapped');
        render(Object.assign({}, home, { homeStaminaExpanded: true }));
        const detail = texts.find(call => call.value === label);
        assert(detail && detail.y > homeBadge.rect.y + homeBadge.rect.h, 'details open below the stamina button');
        assert.strictEqual(renderer.hitTest(detail.x, detail.y), null, 'expanded text has no extra hit');
      }
      app.scene = 'levels';
      const levels = app.buildModel();
      levels.stamina = Object.assign({}, stamina, { balance: 0 });
      render(levels); assertBadge();
      assert(!texts.some(call => call.value === '03:04' || call.value === '体力已满'),
        'level selection shows only the stamina amount');
      const title = texts.find(call => call.value === '选择关卡');
      const selectorStamina = texts.find(call => call.value === '0');
      const homeControl = renderer.hits.find(hit => hit.id === 'levels:home');
      assert.deepStrictEqual(badges[0], { x: width - 78, y: homeControl.rect.y, w: 64, h: 44 },
        'level selection uses the compact current-amount badge');
      assert.strictEqual(selectorStamina.y, title.y);
      assert.strictEqual(selectorStamina.y, homeControl.rect.y + homeControl.rect.h / 2,
        'selector title, home button and stamina share the same center line');
      assert(title.x + title.size * 2 < badges[0].x, 'narrow selector title clears the badge');
      assert(renderer.hits.some(hit => hit.id === 'level:0:0' && hit.enabled !== false), 'zero stamina leaves unlocked cards clickable');
      const levelHits = clone(renderer.hits);
      render(Object.assign({}, levels, { stamina: { enabled: false } }));
      assert.deepStrictEqual(renderer.hits, levelHits);

      for (const [setIndex, levelIndex] of [[0, 0], [1, 4]]) {
        assert(app.openLevel(setIndex, levelIndex));
        for (const scene of ['play', 'result']) {
          app.scene = scene;
          for (const outcome of scene === 'play' ? [null] : ['won', 'failed']) {
            app.result = outcome ? { outcome, remainingCells: 2, elapsedMs: 1000 } : null;
            app.resultVisibleAt = NOW;
            const model = app.buildModel();
            model.stamina = Object.assign({}, model.stamina, { balance: 19 });
            render(Object.assign({}, model, { stamina: { enabled: false } }));
            const layout = clone(renderer.getBoardLayout());
            const hits = clone(renderer.hits);
            const promptRects = clone(prompts);
            render(model);
            assert.strictEqual(badges.length, 0, 'ordinary play and result headers do not show stamina');
            assert(!texts.some(call => call.value === '19'));
            assert(!texts.some(call => call.value === '05:00' || call.value === '体力已满'),
              'ordinary play and result headers hide stamina details');
            const refundRule = texts.find(call => call.value === '本关首次在1分钟内通关，返还1点体力');
            assert.strictEqual(refundRule, undefined, 'result panels do not display the refund explanation');
            assert.deepStrictEqual(renderer.getBoardLayout(), layout, 'stamina cannot resize or move the board');
            assert.deepStrictEqual(renderer.hits, hits, 'existing interactions stay unchanged');
            assert.deepStrictEqual(prompts, promptRects, 'Portal band geometry stays unchanged');
            if (setIndex === 1) assert.strictEqual(prompts.length, 1);
            const title = texts.find(call => call.value === model.ordinaryLevelNumber + ' / ' + model.ordinaryLevelCount);
            assert.strictEqual(title.x, width / 2, 'the level title stays centered without stamina');
            if (scene === 'play') {
              ['play:back', 'play:sound', 'play:reset'].forEach(id => {
                const control = renderer.hits.find(hit => hit.id === id);
                assert.strictEqual(control.rect.y + control.rect.h / 2, title.y);
              });
            }
          }
        }
      }
      assert(app.enterDaily());
      render(app.buildModel()); assert.strictEqual(badges.length, 0);
      assert(!texts.some(call => call.value.includes('返还1点体力')), 'daily does not promise ordinary stamina');
      app.scene = 'dailyResult'; app.daily.resultVisibleAt = NOW;
      for (const outcome of ['won', 'failed']) {
        app.daily.result = { outcome, remainingCells: 2, elapsedMs: 1000 };
        render(app.buildModel()); assert.strictEqual(badges.length, 0);
      }

      app.scene = 'home';
      const model = app.buildModel();
      model.stamina = Object.assign({}, stamina, { balance: 0, remainingMs: 272000 });
      model.staminaFeedback = Object.freeze({ reason: 'insufficient-stamina', until: NOW + 2200 });
      render(model, NOW);
      assert(texts.some(call => call.value === '体力不足，04:32 后恢复 1 点'));
      const hits = clone(renderer.hits);
      render(model, NOW + 2200);
      assert(!texts.some(call => call.value.startsWith('体力不足')));
      assert.deepStrictEqual(renderer.hits, hits, 'feedback never owns a hit');
      render(Object.assign({}, model, { staminaFeedback: { reason: 'persist-failed', until: NOW + INTERVAL } }), NOW);
      assert(texts.some(call => call.value === '体力状态保存失败，请重试'));
      render(Object.assign({}, model, { staminaFeedback: { reason: 'quick-clear-refund', amount: 1, until: NOW + INTERVAL } }), NOW);
      assert(texts.some(call => call.value === '1分钟内通关，体力 +1'));
      app.dispose();
    }
  }

  const compactResult = fixture(320, skins[0]);
  compactResult.app.platform.metrics.height = 568;
  compactResult.app.platform.metrics.safeBottom = 548;
  compactResult.app.openLevel(0, 0);
  compactResult.app.scene = 'result';
  compactResult.app.resultVisibleAt = NOW;
  compactResult.app.result = { elapsedMs: 15000, bestMs: 15000, staminaRefunded: 1 };
  for (const sharing of [false, true]) {
    for (const [status, label] of [['available', '尚未达成，可重玩挑战'], ['claimed', '已返还1点体力'],
      ['pending', '返还待保存，将自动重试']]) {
      const model = Object.assign({}, compactResult.app.buildModel(), { shareAvailable: sharing,
        staminaRefund: { status, amount: 1 } });
      compactResult.render(model);
      const statusText = compactResult.texts.find(call => call.value === label);
      assert.strictEqual(statusText, undefined, 'refund status is not printed in the result panel');
      const timeText = compactResult.texts.find(call => call.value.startsWith('本次 '));
      assert(timeText);
      const hits = compactResult.renderer.hits.filter(hit => hit.id.startsWith('result:'));
      assert(hits.every(hit => timeText.y + timeText.size / 2 + 8 <= hit.rect.y));
      assert(hits.every(hit => hit.rect.y + hit.rect.h <= 548), 'result buttons fit the short safe area');
      compactResult.app.result.staminaRefunded = 0;
      compactResult.render(Object.assign({}, model, { staminaRefund: { status: 'claimed', amount: 1 } }));
      assert(!compactResult.texts.some(call => call.value === '本关体力已返还，不再重复领取'));
      compactResult.app.result.staminaRefunded = 1;
    }
  }
  compactResult.app.dispose();
}

module.exports = run;
