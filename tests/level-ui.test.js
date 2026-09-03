'use strict';

const assert = require('assert');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');
const portalInstructions = require('../src/ui/portal-instructions.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const { createUnlimitedStaminaFixture } = require('./helpers/stamina-fixture.js');
const FIRST = '连接两个相同的色块或物体';
const FOLLOWING = '别漏掉空白格，全部消除才能通关哦';

function fixture(width, height) {
  const raw = fakeApi();
  raw.getWindowInfo = () => ({ windowWidth: width, windowHeight: height, pixelRatio: 2,
    safeArea: { top: 44, bottom: height - 24 } });
  const app = new App(new Platform(raw), { solutionCatalog: solutions,
    clock: () => new Date('2026-08-31T00:00:00Z'),
    progressionConfig: { unlockAllLevelsInDevTools: true }, stamina: createUnlimitedStaminaFixture() });
  const renderer = app.renderer;
  const texts = []; const icons = []; const prompts = [];
  const text = renderer.text.bind(renderer);
  renderer.text = (value, x, y, size, options) => {
    texts.push({ value: String(value), x, y, size, options: options || {} });
    text(value, x, y, size, options);
  };
  const icon = renderer.drawIcon.bind(renderer);
  renderer.drawIcon = (type, x, y, size) => { icons.push({ type, x, y, size }); icon(type, x, y, size); };
  const prompt = renderer.drawPlayInstruction.bind(renderer);
  renderer.drawPlayInstruction = (value, rect, now) => {
    if (value) prompts.push({ value, rect });
    prompt(value, rect, now);
  };
  return { app, renderer, texts, icons, prompts,
    open(index) {
      const level = catalog.levels[index];
      assert(app.openLevel(level.setIndex, level.levelIndex));
    },
    render(model) {
      texts.length = 0; icons.length = 0; prompts.length = 0;
      renderer.render(model || app.buildModel(), Date.now() + 1000);
    } };
}

function bestTimes() {
  for (const width of [280, 320, 390]) {
    const f = fixture(width, 568);
    const first = catalog.levels[0]; const later = catalog.levels[25];
    f.app.progress.recordCompletion(first.setIndex, first.levelIndex, 90000);
    f.app.progress.recordCompletion(first.setIndex, first.levelIndex, 105000);
    f.app.progress.recordCompletion(later.setIndex, later.levelIndex, 125000);
    f.app.performAction('home:levels');
    f.app.levelPageIndex = 0;
    const model = f.app.buildModel();
    assert.strictEqual(model.levelItems[0].bestMs, 90000, 'selector uses the best result, not the latest run');
    const values = [90000, 61000, 3600000, 999, undefined, 123000, 150000, Infinity, -1, NaN];
    model.levelItems.forEach((item, i) => Object.assign(item, {
      completed: i < values.length && i !== 5, unlocked: i !== 6, bestMs: values[i]
    }));
    f.render(Object.assign({}, model, { levelItems: model.levelItems.map(item => Object.assign({}, item, { bestMs: undefined })) }));
    const hits = JSON.stringify(f.renderer.hits);
    f.render(model);
    assert.strictEqual(JSON.stringify(f.renderer.hits), hits, 'best time text does not change selector touch targets');
    const timeTexts = f.texts.filter(item => /^\d+:\d{2}$/.test(item.value));
    assert.deepStrictEqual(timeTexts.map(item => item.value), ['1:30', '1:01', '60:00', '0:00'],
      'missing/invalid, unfinished and locked records do not display a time');
    timeTexts.forEach((time, i) => {
      const item = model.levelItems[i];
      const rect = f.renderer.hits.find(hit => hit.id === item.action).rect;
      const number = f.texts.find(text => text.value === String(item.displayNumber));
      assert.strictEqual(time.x, rect.x + rect.w / 2);
      assert(time.y - time.size / 2 > number.y + number.size / 2, 'time stays below the number with a visible gap');
      assert(time.y + time.size / 2 < rect.y + rect.h);
      assert(time.options.maxWidth <= rect.w - 8);
      assert.strictEqual(f.renderer.hitTest(time.x, time.y), item.action);
    });
    f.app.performAction('levels:next'); f.render();
    assert(f.texts.some(item => item.value === '2:05'), 'best records use catalog coordinates across pages');
    f.app.dispose();
  }
}

function galleryBackButtons() {
  for (const width of [280, 320, 390]) {
    const f = fixture(width, 568);
    f.app.performAction('home:corridor'); f.render();
    const home = f.renderer.hits.find(hit => hit.id === 'corridor:home').rect;
    assert.strictEqual(home.w, 44, 'the corridor home button is unchanged');
    assert(f.icons.some(icon => icon.type === 'home' && icon.x === home.x + home.w / 2));
    for (const scene of ['themes', 'effects']) {
      f.app.performAction('corridor:' + scene); f.render();
      const back = f.renderer.hits.find(hit => hit.id === scene + ':corridor');
      const sound = f.renderer.hits.find(hit => hit.id === scene + ':sound');
      assert(back && sound);
      assert(back.rect.w > 44 && back.rect.h > 44, 'the return touch target is enlarged');
      assert(back.rect.y >= f.app.platform.metrics.safeTop);
      assert.strictEqual(back.rect.y + back.rect.h / 2, sound.rect.y + sound.rect.h / 2);
      const arrow = f.icons.find(icon => icon.x === back.rect.x + back.rect.w / 2 && icon.y === back.rect.y + back.rect.h / 2);
      assert(arrow && arrow.type === 'back' && arrow.size > 44 * 0.48, 'return uses a larger arrow');
      assert.strictEqual(f.renderer.hits.filter(hit => hit.id === scene + ':corridor').length, 1);
      assert(!f.renderer.hits.some(hit => hit.id === scene + ':home'));
      const cards = f.renderer.hits.filter(hit => hit.id.startsWith(scene === 'themes' ? 'theme:' : 'effect:'));
      assert(cards.length);
      assert(back.rect.y + back.rect.h <= Math.min(...cards.map(hit => hit.rect.y)), 'back cannot overlap gallery cards');
      const point = { x: back.rect.x + back.rect.w - 2, y: back.rect.y + back.rect.h / 2, id: 7 };
      f.app.onPointerStart(point); f.app.onPointerEnd(point);
      assert.strictEqual(f.app.scene, 'corridor', 'the enlarged outer edge returns to the corridor');
    }
    f.app.performAction('corridor:home');
    f.app.performAction('home:themes'); f.render();
    assert(f.renderer.hits.some(hit => hit.id === 'themes:home'), 'legacy direct navigation retains its original action');
    f.app.dispose();
  }
}

function beginnerInstructions() {
  for (const width of [280, 320, 390]) {
    for (const height of [568, 844]) {
      const f = fixture(width, height);
      for (let i = 0; i < 5; i++) {
        f.open(i);
        const model = f.app.buildModel(); const expected = i === 0 ? FIRST : FOLLOWING;
        assert.strictEqual(model.beginnerInstruction, expected);
        f.render(model);
        assert.strictEqual(f.prompts.length, 1);
        assert.strictEqual(f.prompts[0].value, expected);
        const rect = f.prompts[0].rect; const board = f.renderer.getBoardLayout();
        assert.strictEqual(rect.x + rect.w / 2, width / 2);
        assert.strictEqual(rect.y + rect.h, board.y, 'tutorial uses the Portal prompt band directly above the board');
        assert(rect.y >= f.app.platform.metrics.safeTop);
        assert(rect.x >= 0 && rect.x + rect.w <= width);
        const timer = f.texts.find(text => text.value === model.elapsedText);
        assert(rect.y > timer.y + timer.size / 2, 'tutorial does not cover the level timer');
        const label = f.texts.find(text => text.value === expected);
        assert(label.options.maxWidth <= rect.w);
        const button = f.renderer.hits.find(hit => hit.id === 'play:hint').rect;
        assert(board.y + board.rows * board.cell < button.y);
      }
      f.open(5); f.render();
      assert.strictEqual(f.app.buildModel().beginnerInstruction, null);
      assert.strictEqual(f.prompts.length, 0, 'the sixth level has no beginner copy');
      f.open(6); f.render();
      assert.strictEqual(f.app.buildModel().beginnerInstruction, null);
      assert.strictEqual(f.prompts[0].value, portalInstructions.INITIAL, 'later Portal guidance remains intact');
      f.open(25); f.render();
      assert.strictEqual(f.prompts.length, 0, 'a later catalog page does not restart the tutorial');
      f.open(0); f.render();
      assert.strictEqual(f.prompts[0].value, FIRST, 'replaying the first level retains its instruction');
      const board = f.renderer.getBoardLayout();
      assert(f.app.showHint()); f.render();
      assert.deepStrictEqual(f.renderer.getBoardLayout(), board, 'hint preview retains tutorial and board geometry');
      assert.strictEqual(f.prompts[0].value, FIRST);
      f.app.performAction('play:back'); f.app.performAction('levels:home');
      f.app.performAction('home:dailyChallenge'); f.render();
      assert.strictEqual(f.app.scene, 'daily');
      assert.strictEqual(f.app.buildModel().beginnerInstruction, undefined);
      assert.strictEqual(f.prompts.length, 0, 'daily challenges do not receive the mainline tutorial');
      f.app.dispose();
    }
  }
}

module.exports = function run() {
  bestTimes();
  galleryBackButtons();
  beginnerInstructions();
};
