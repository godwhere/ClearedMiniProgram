'use strict';

const assert = require('assert');
const Runner = require('../core/game-runner.js');
const DailyChallengeService = require('../src/services/daily-challenge-service.js');
const HintService = require('../src/services/hint-service.js');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const LocaleService = require('../src/services/locale-service.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const previousPack = require('../data/daily-mechanic-pack.js');
const pack = require('../data/daily-four-week-pack.js');
const manifest = require('../data/daily-challenges.js');
const solutions = require('../data/daily-solutions.js');

const clone = value => JSON.parse(JSON.stringify(value));
const segments = line => Array.isArray(line) ? [line] : line.Segments.map(segment => segment.Cells);
const cells = line => segments(line).flat();

function connect(runner, line, reverse = false) {
  let parts = segments(line);
  if (reverse) parts = parts.slice().reverse().map(part => part.slice().reverse());
  parts.forEach((part, index) => {
    assert(runner.touchStart(part[0]), 'route starts');
    part.slice(1).forEach(cell => assert(runner.touchMove(cell), `route moves through ${cell}`));
    assert.strictEqual(runner.touchEnd(part[part.length - 1]), index === parts.length - 1,
      'Portal routes wait between segments and complete at the final endpoint');
  });
}

function transform(level, paths, flip) {
  const at = cell => (flip & 1 ? 7 - cell % 8 : cell % 8) +
    8 * (flip & 2 ? 9 - Math.floor(cell / 8) : Math.floor(cell / 8));
  const result = clone(level);
  result.Lines = result.Lines.map(line => ({ Start: at(line.Start), End: at(line.End) }));
  result.Blocked = result.Blocked.map(at);
  if (result.IceCells) result.IceCells = result.IceCells.map(at);
  if (result.Portals) result.Portals.forEach(portal => { portal.Cells = portal.Cells.map(at); });
  const answers = paths.map(line => Array.isArray(line) ? line.map(at) : {
    Segments: line.Segments.map(segment => Object.assign({ Cells: segment.Cells.map(at) }, segment.Exit ? {
      Exit: Object.assign({}, segment.Exit, { From: at(segment.Exit.From), To: at(segment.Exit.To) })
    } : {}))
  });
  return { level: result, paths: answers };
}

function canonical(level) {
  return [0, 1, 2, 3].map(flip => {
    const game = transform(level, [], flip).level;
    return JSON.stringify({
      blocked: game.Blocked.sort((one, two) => one - two),
      lines: game.Lines.map(line => [line.Start, line.End].sort((one, two) => one - two)).sort(),
      ice: (game.IceCells || []).sort((one, two) => one - two),
      doors: (game.Portals || []).flatMap(portal => portal.Cells).sort((one, two) => one - two)
    });
  }).sort()[0];
}

function expectedDate(index) {
  return new Date(Date.UTC(2026, 8, 26 + index)).toISOString().slice(0, 10);
}

function assertPortalNecessary(level) {
  const parity = cell => (cell % 8 + Math.floor(cell / 8)) % 2 ? -1 : 1;
  const doors = level.Portals.flatMap(portal => portal.Cells);
  const required = Array.from({ length: 80 }, (_, cell) => doors.includes(cell) ? 0 :
    parity(cell) * ((level.IceCells || []).includes(cell) ? 2 : 1)).reduce((one, two) => one + two, 0);
  const withoutPortal = level.Lines.reduce((sum, line) => sum +
    (parity(line.Start) === parity(line.End) ? parity(line.Start) : 0), 0);
  assert.notStrictEqual(required, withoutPortal, `${level.Id} cannot be completed as a plain adjacent board`);
}

function validateContent() {
  const service = new DailyChallengeService(manifest, { solutions });
  const hints = new HintService();
  assert.strictEqual(pack.length, 28, 'four complete seven-day arcs');
  assert.deepStrictEqual(pack.slice(0, 7).map(level => level.Blocked.length), [4, 6, 8, 8, 10, 10, 12]);
  assert.deepStrictEqual(pack.slice(7, 14).map(level => level.Portals[0].Cells.length), [2, 2, 2, 4, 4, 4, 4]);
  assert.deepStrictEqual(pack.slice(14, 21).map(level => level.IceCells.length), [2, 4, 4, 6, 6, 8, 8]);
  assert.deepStrictEqual(pack.slice(21).map(level => level.Portals[0].Cells.length), [2, 2, 2, 4, 4, 4, 4]);
  assert.deepStrictEqual(pack.slice(21).map(level => level.IceCells.length), [2, 4, 4, 6, 6, 8, 8]);

  const allBoards = previousPack.concat(pack);
  assert.strictEqual(new Set(allBoards.map(canonical)).size, allBoards.length,
    'no new board is a mirrored or recolored duplicate of this or the previous pack');

  pack.forEach((level, index) => {
    const date = expectedDate(index);
    assert.strictEqual(level.DateKey, date);
    assert.strictEqual(level.Id, `daily-${date}-v1-extreme-v1`);
    assert.strictEqual(level.Lines.length, 8);
    assert.strictEqual(level.PieceCount, 8);
    if (index < 7) assert.strictEqual(level.Mechanic, undefined);
    else if (index < 14) {
      assert.strictEqual(level.Mechanic, 'portal');
      assert.strictEqual(level.IceCells, undefined);
    } else if (index < 21) {
      assert.strictEqual(level.Mechanic, 'ice');
      assert.strictEqual(level.Portals, undefined);
    } else {
      assert.strictEqual(level.Mechanic, 'portal');
      assert(level.IceCells.length > 0);
    }

    const resolved = service.resolve(new Date(`${date}T00:00:00+08:00`));
    assert.strictEqual(resolved.status, 'available', JSON.stringify(resolved));
    assert.strictEqual(resolved.dateKey, date);
    assert.strictEqual(resolved.levels.length, 2);
    assert.strictEqual(resolved.entryLimit, 3);
    const paths = solutions.ByChallengeId[level.Id];
    assert(service.validateSolution(level, paths).ok, level.Id);
    assert(paths.every(line => cells(line).length <= 17), 'no line dominates most of the board');

    for (const flip of [0, 1, 2, 3]) {
      const mirrored = transform(level, paths, flip);
      assert(service.validateSolution(mirrored.level, mirrored.paths).ok,
        `${level.Id} remains valid under rectangular reflection ${flip}`);
    }

    for (const reverse of [false, true]) {
      const runner = new Runner(level, level.Palette);
      const order = reverse ? paths.slice().reverse() : paths;
      order.forEach(line => connect(runner, line, reverse));
      assert.strictEqual(runner.outcome, Runner.OUTCOME.WON, level.Id);
      if (level.IceCells) assert(runner.getBoardState().remainingLayers.every(layer => layer === 0));
    }

    const runner = new Runner(level, level.Palette);
    const before = runner.snapshot();
    const hint = hints.findDailyComplete(runner, level.Id, solutions);
    assert(hint && hint.paths.length === 8, `${level.Id} has a complete hint`);
    assert.deepStrictEqual(runner.snapshot(), before, 'hint lookup is read-only');
    if (level.Portals) {
      assertPortalNecessary(level);
      assert(hint.paths.some(line => line.segments.length > 1));
    }
    if (level.IceCells) {
      level.IceCells.forEach(ice => {
        assert.strictEqual(paths.filter(line => cells(line).includes(ice)).length, 2,
          `${level.Id} ice ${ice} is crossed by two distinct routes`);
      });
      assert(hint.steps.some(step => step.breaksIce));
      assert(hint.steps.some(step => step.clearsIce));
      if (level.Portals) assert(paths.some(line => line.Segments.length > 1 &&
        cells(line).some(cell => level.IceCells.includes(cell))), 'mixed routes combine both mechanics');
    }
  });

  assert.strictEqual(service.resolve(new Date('2026-10-23T15:59:59.999Z')).dateKey, '2026-10-23');
  assert.strictEqual(service.resolve(new Date('2026-10-23T16:00:00.000Z')).status, 'unavailable');
}

function pointerPlay(app, paths) {
  app.tick(Date.now() + 1000);
  const board = app.renderer.boardLayout;
  const width = app.daily.challenge.Width;
  paths.forEach(line => segments(line).forEach(part => {
    const point = cell => ({
      x: board.x + (cell % width + 0.5) * board.cell,
      y: board.y + (Math.floor(cell / width) + 0.5) * board.cell,
      id: 27
    });
    app.onPointerStart(point(part[0]));
    part.slice(1).forEach(cell => app.onPointerMove(point(cell)));
    app.onPointerEnd(point(part[part.length - 1]));
  }));
}

function validateAppFlow() {
  [0, 7, 14, 21].forEach((packIndex, sampleIndex) => {
    const level = pack[packIndex];
    const raw = fakeApi();
    raw.getWindowInfo = () => ({
      windowWidth: [280, 320, 390, 320][sampleIndex], windowHeight: 640, pixelRatio: 2,
      safeArea: { top: 44, bottom: 616 }
    });
    let now = new Date(`${level.DateKey}T23:59:00+08:00`);
    const platform = new Platform(raw);
    const locale = new LocaleService(platform);
    locale.select(sampleIndex % 2 ? 'en-US' : 'zh-CN');
    const app = new App(platform, { clock: () => now, locale });
    const ordinary = clone(app.progress.state);
    const stamina = app.stamina.snapshot(now).balance;
    const balance = app.rewardUnlocks.view().balance;
    assert(app.enterDaily());
    pointerPlay(app, solutions.ByChallengeId[app.daily.challengeId]);
    assert.strictEqual(app.daily.challengeId, level.Id);
    assert.strictEqual(app.daily.entriesUsed, 1, 'the warm-up transition costs no second entry');
    const model = app.buildModel();
    assert(app.renderer.boardLayout.y >= 44);
    if (level.Portals) assert(model.portalInstruction && model.portals.length);
    if (level.IceCells) assert(model.board.cells.some(cell => cell.frozen));
    now = new Date(now.getTime() + 120000);
    pointerPlay(app, solutions.ByChallengeId[level.Id]);
    assert.strictEqual(app.scene, 'dailyResult');
    assert.strictEqual(app.daily.dateKey, level.DateKey, 'the active run keeps its Shanghai date across midnight');
    assert.strictEqual(app.rewardUnlocks.view().balance, balance + 500);
    assert.deepStrictEqual(app.progress.state, ordinary, 'daily completion never writes ordinary progress');
    assert.strictEqual(app.stamina.snapshot(now).balance, stamina);
    app.dispose();
  });
}

module.exports = function run() {
  validateContent();
  validateAppFlow();
};
