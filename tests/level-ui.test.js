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

function fixture(width, height, safeTop = 44) {
  const raw = fakeApi();
  raw.getWindowInfo = () => ({ windowWidth: width, windowHeight: height, pixelRatio: 2,
    safeArea: { top: safeTop, bottom: height - 24 } });
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

function difficultyBars() {
  for (const width of [280, 320, 390]) {
    const f = fixture(width, 568);
    f.app.performAction('home:levels'); f.app.levelPageIndex = 2;
    const model = f.app.buildModel();
    f.render(model);
    const rectangles = new Map(f.renderer.hits.map(hit => [hit.id, hit.rect]));
    const bars = [];
    const context = f.renderer.ctx;
    const fillRect = context.fillRect;
    context.fillRect = (x, y, w, h) => {
      if (h === 2 && w <= 2.5) bars.push({ x, y, w, h, alpha: context.globalAlpha });
      fillRect.call(context, x, y, w, h);
    };
    model.levelItems.forEach((item, i) => Object.assign(item, {
      difficulty: i % 5 + 1, unlocked: i !== 1, completed: i === 0, bestMs: i === 0 ? 90000 : null
    }));
    f.render(model);
    assert.strictEqual(bars.length, model.levelItems.length * 5);
    const hits = JSON.stringify(f.renderer.hits);
    model.levelItems.forEach((item, i) => {
      const rect = rectangles.get(item.action);
      const group = bars.slice(i * 5, i * 5 + 5);
      group.forEach((bar, index) => {
        assert(bar.x > rect.x && bar.x + bar.w < rect.x + rect.w);
        assert(bar.y > rect.y && bar.y + bar.h < rect.y + rect.h);
        assert.strictEqual(bar.alpha, (index < item.difficulty ? 0.85 : 0.18) * (item.unlocked ? 1 : 0.5));
      });
      const number = f.texts.find(text => text.value === String(item.displayNumber));
      assert(group[0].y + group[0].h < number.y - number.size / 2, 'bars stay above number and record');
    });
    assert(f.texts.some(text => text.value === '1:30'));
    assert(f.texts.some(text => text.value === '✓'));
    assert(f.texts.some(text => text.value.includes('难度 1–5 格')));
    bars.length = 0;
    model.levelItems.forEach((item, i) => { item.difficulty = [null, 0, 6, 1.5, '3'][i % 5]; });
    f.render(model);
    assert.strictEqual(bars.length, 0, 'invalid/unrated difficulty is not shown');
    assert.strictEqual(JSON.stringify(f.renderer.hits), hits, 'rating cannot change touch targets');
    f.app.dispose();
  }
}

function earlyLevelDifficultyBars() {
  for (const width of [280, 320, 390]) {
    const f = fixture(width, 568);
    f.app.performAction('home:levels');
    const bars = [];
    const context = f.renderer.ctx;
    const fillRect = context.fillRect;
    context.fillRect = (x, y, w, h) => {
      if (h === 2 && w <= 2.5) bars.push({ x, y, alpha: context.globalAlpha });
      fillRect.call(context, x, y, w, h);
    };
    const seen = new Set();
    for (const page of [0, 1]) {
      f.app.levelPageIndex = page;
      const model = f.app.buildModel();
      bars.length = 0;
      f.render(model);
      assert.strictEqual(bars.length, model.levelItems.length * 5, 'real first/second pages must include every rating');
      model.levelItems.forEach((item, i) => {
        if (item.displayNumber > 32) return;
        seen.add(item.displayNumber);
        assert.strictEqual(item.difficulty, catalog.levels[item.displayNumber - 1].game.Difficulty);
        assert(Number.isInteger(item.difficulty) && item.difficulty >= 1 && item.difficulty <= 5);
        bars.slice(i * 5, i * 5 + 5).forEach((bar, index) => {
          assert.strictEqual(bar.alpha, (index < item.difficulty ? 0.85 : 0.18) * (item.unlocked ? 1 : 0.5));
        });
      });
    }
    assert.strictEqual(seen.size, 32, 'all 32 early levels are checked without injecting fake grades');
    f.app.dispose();
  }
}

function galleryBackButtons() {
  for (const width of [280, 320, 390]) {
    const f = fixture(width, 568);
    f.app.performAction('home:corridor'); f.render();
    const home = f.renderer.hits.find(hit => hit.id === 'corridor:home').rect;
    assert.strictEqual(home.w, 48, 'the corridor home button uses the shared top-bar size');
    assert(!f.renderer.hits.some(hit => hit.id === 'corridor:sound'), 'corridor has no sound switch');
    assert(f.icons.some(icon => icon.type === 'home' && icon.x === home.x + home.w / 2));
    for (const scene of ['themes', 'effects']) {
      f.app.performAction('corridor:' + scene); f.render();
      const back = f.renderer.hits.find(hit => hit.id === scene + ':corridor');
      assert(back);
      assert(!f.renderer.hits.some(hit => hit.id === scene + ':sound'), 'gallery has no sound switch');
      assert.strictEqual(back.rect.w, 48);
      assert.strictEqual(back.rect.h, 48);
      assert(back.rect.y >= f.app.platform.metrics.safeTop);
      const arrow = f.icons.find(icon => icon.x === back.rect.x + back.rect.w / 2 && icon.y === back.rect.y + back.rect.h / 2);
      assert(arrow && arrow.type === 'back' && arrow.size === 48 * 0.48, 'return uses the shared icon size');
      assert.strictEqual(f.renderer.hits.filter(hit => hit.id === scene + ':corridor').length, 1);
      assert(!f.renderer.hits.some(hit => hit.id === scene + ':home'));
      const cards = f.renderer.hits.filter(hit => hit.id.startsWith(scene === 'themes' ? 'theme:' : 'effect:'));
      assert(cards.length);
      assert(back.rect.y + back.rect.h <= Math.min(...cards.map(hit => hit.rect.y)), 'back cannot overlap gallery cards');
      const point = { x: back.rect.x + back.rect.w - 2, y: back.rect.y + back.rect.h / 2, id: 7 };
      f.app.onPointerStart(point); f.app.onPointerEnd(point);
      assert.strictEqual(f.app.scene, 'corridor', 'the outer edge returns to the corridor');
    }
    f.app.performAction('corridor:home');
    f.app.performAction('home:themes'); f.render();
    assert(f.renderer.hits.some(hit => hit.id === 'themes:home'), 'legacy direct navigation retains its original action');
    f.app.dispose();
  }
}

function topBarAlignment() {
  for (const [width, height, safeTop] of [[280, 568, 44], [320, 568, 54], [390, 844, 94]]) {
    const f = fixture(width, height, safeTop);
    const expected = { x: 16, y: safeTop + 12, w: 48, h: 48 };
    const centerY = safeTop + 36;
    const check = (action, title) => {
      f.render();
      const hit = f.renderer.hits.find(item => item.id === action);
      assert(hit, `${action} is present`);
      assert.deepStrictEqual(hit.rect, expected, `${action} uses the shared top-bar slot`);
      if (action !== 'home:account') {
        const icon = f.icons.find(item => item.x === expected.x + 24 && item.y === centerY);
        assert(icon && icon.size === 48 * 0.48, `${action} uses the shared icon size`);
      }
      if (title) {
        const heading = f.texts.find(item => typeof title === 'string'
          ? item.value === title : title.test(item.value));
        assert(heading && heading.y === centerY, `${action} aligns with the page heading`);
      }
    };

    check('home:account');
    const sound = f.renderer.hits.find(hit => hit.id === 'home:sound').rect;
    const stamina = f.renderer.hits.find(hit => hit.id === 'home:stamina').rect;
    assert.strictEqual(sound.y + sound.h / 2, centerY);
    assert.strictEqual(stamina.y + stamina.h / 2, centerY);
    assert(sound.x >= expected.x + expected.w && sound.x + sound.w < stamina.x);
    assert.deepStrictEqual(f.app.homeProfileButtonRect(), {
      x: 16, y: safeTop + 68, w: 160, h: 38
    }, 'the native profile button starts below the avatar');

    f.app.performAction('home:account'); check('account:back', '账号');
    f.app.performAction('account:back');
    f.app.performAction('home:levels'); check('levels:home', '选择关卡');
    f.open(0);
    check('play:back', '1 / ' + catalog.levels.length);
    const reset = f.renderer.hits.find(hit => hit.id === 'play:reset').rect;
    assert.deepStrictEqual(reset, { x: width - 64, y: safeTop + 12, w: 48, h: 48 });
    f.app.performAction('play:back');
    f.app.performAction('levels:home');

    f.app.performAction('home:corridor'); check('corridor:home', '回廊');
    f.app.performAction('corridor:themes'); check('themes:corridor', '主题');
    f.app.performAction('themes:corridor');
    f.app.performAction('corridor:effects'); check('effects:corridor', '消除特效');
    f.app.performAction('effects:corridor');
    f.app.performAction('corridor:home');

    assert(f.app.enterDaily());
    check('daily:home', /^每日挑战/);
    assert.deepStrictEqual(f.renderer.hits.find(hit => hit.id === 'daily:reset').rect,
      { x: width - 64, y: safeTop + 12, w: 48, h: 48 });
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
        for (const outcome of ['won', 'failed']) {
          for (const resultVisibleAt of [0, Date.now() + 5000]) {
            f.render(Object.assign({}, model, { scene: 'result',
              result: { outcome, elapsedMs: 1000, remainingCells: 1 }, resultVisibleAt }));
            assert.strictEqual(f.prompts.length, 0, 'result scenes hide tutorial copy, including before the panel appears');
            assert(!f.texts.some(text => text.value === expected), 'tutorial text is not drawn behind the result panel');
            if (outcome === 'failed') {
              assert.deepStrictEqual(f.renderer.getBoardLayout(), board, 'hiding copy retains the prompt band and failed-board geometry');
            }
          }
        }
      }
      f.open(5); f.render();
      assert.strictEqual(f.app.buildModel().beginnerInstruction, null);
      assert.strictEqual(f.prompts.length, 0, 'the sixth level has no beginner copy');
      f.open(6); f.render();
      assert.strictEqual(f.app.buildModel().beginnerInstruction, null);
      assert.strictEqual(f.prompts[0].value, portalInstructions.INITIAL, 'later Portal guidance remains intact');
      f.render(Object.assign({}, f.app.buildModel(), { scene: 'result',
        result: { outcome: 'won', elapsedMs: 1000 }, resultVisibleAt: 0 }));
      assert.strictEqual(f.prompts.length, 0, 'Portal guidance is also hidden after completion');
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
  difficultyBars();
  earlyLevelDifficultyBars();
  galleryBackButtons();
  topBarAlignment();
  beginnerInstructions();
};
