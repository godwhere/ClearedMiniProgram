'use strict';
const assert = require('assert');
const Runner = require('../core/game-runner.js');
const Daily = require('../src/services/daily-challenge-service.js');
const Hint = require('../src/services/hint-service.js');
const App = require('../src/app.js');
const Platform = require('../src/platform/wechat.js');
const LocaleService = require('../src/services/locale-service.js');
const { fakeApi } = require('./account-bootstrap.test.js');
const pack = require('../data/daily-mechanic-pack.js');
const manifest = require('../data/daily-challenges.js');
const solutions = require('../data/daily-solutions.js');
const clone = value => JSON.parse(JSON.stringify(value));
const segments = line => Array.isArray(line) ? [line] : line.Segments.map(segment => segment.Cells);
const cells = line => [].concat(...segments(line));
function connect(runner, line, reverse) {
  let parts = segments(line);
  if (reverse) parts = parts.slice().reverse().map(part => part.slice().reverse());
  parts.forEach((part, i) => {
    assert(runner.touchStart(part[0]), 'route start');
    part.slice(1).forEach(cell => assert(runner.touchMove(cell), 'route move ' + cell));
    assert.strictEqual(runner.touchEnd(part[part.length - 1]), i === parts.length - 1, 'portal wait vs completed route');
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
    return JSON.stringify({ lines: game.Lines.map(line => [line.Start, line.End].sort((a,b) => a-b)).sort(),
      ice: (game.IceCells || []).sort((a,b) => a-b),
      doors: (game.Portals || []).flatMap(portal => portal.Cells).sort((a,b) => a-b) });
  }).sort()[0];
}
function content() {
  const service = new Daily(manifest, { solutions });
  const hints = new Hint();
  assert.strictEqual(pack.length, 10);
  assert.strictEqual(new Set(pack.map(canonical)).size, 10, 'no mirrored/recolored duplicate boards');
  assert.strictEqual(service.resolve(new Date('2026-09-15T15:59:59.999Z')).status, 'unavailable');
  pack.forEach((level, index) => {
    const date = '2026-09-' + (16 + index);
    assert.strictEqual(level.DateKey, date);
    assert.strictEqual(level.Id, 'daily-' + date + '-v1-extreme-v1');
    assert.strictEqual(level.Mechanic, index === 3 || index === 4 ? 'ice' : 'portal');
    assert.strictEqual(!!level.IceCells, index >= 3);
    assert.strictEqual((level.IceCells || []).length, [0, 0, 0, 4, 8, 2, 6, 6, 10, 12][index]);
    assert.strictEqual((level.Portals || []).flatMap(portal => portal.Cells).length, [2, 2, 4, 0, 0, 2, 2, 4, 4, 4][index]);
    assert.strictEqual(level.Lines.length, 8);
    const resolved = service.resolve(new Date(date + 'T00:00:00+08:00'));
    assert.strictEqual(resolved.status, 'available', JSON.stringify(resolved));
    assert.strictEqual(resolved.dateKey, date);
    assert.strictEqual(resolved.levels.length, 2);
    assert.strictEqual(resolved.entryLimit, 3);
    assert.strictEqual(service.resolve(new Date(date + 'T23:59:59.999+08:00')).dateKey, date);
    const paths = solutions.ByChallengeId[level.Id];
    assert(service.validateSolution(level, paths).ok, level.Id);
    assert(paths.every(line => cells(line).length <= 17), 'avoid a board-dominating long route');
    if (level.Portals) {
      // Without teleports each path has a fixed checkerboard imbalance. Ice
      // counts twice, optional portal squares do not count at all.
      const parity = cell => (cell % 8 + Math.floor(cell / 8)) % 2 ? -1 : 1;
      const doors = level.Portals.flatMap(portal => portal.Cells);
      const required = Array.from({ length: 80 }, (_, cell) => doors.includes(cell) ? 0 :
        parity(cell) * ((level.IceCells || []).includes(cell) ? 2 : 1)).reduce((a,b) => a+b, 0);
      const noPortal = level.Lines.reduce((sum, line) => sum +
        (parity(line.Start) === parity(line.End) ? parity(line.Start) : 0), 0);
      assert.notStrictEqual(required, noPortal, 'a solution must actually use a portal');
      if (level.IceCells) assert(paths.some(line => line.Segments.length > 1 &&
        cells(line).some(cell => level.IceCells.includes(cell))), 'mixed solution combines both mechanics');
    }
    for (const flip of [0, 1, 2, 3]) {
      const transformed = transform(level, paths, flip);
      assert(service.validateSolution(transformed.level, transformed.paths).ok, 'symmetry preserves solution');
      for (let offset = 0; offset < paths.length; offset++) {
        for (const reverse of [false, true]) {
          const runner = new Runner(transformed.level, level.Palette);
          let order = transformed.paths.slice(offset).concat(transformed.paths.slice(0, offset));
          if (reverse) order = order.slice().reverse();
          order.forEach(line => connect(runner, line, reverse));
          assert.strictEqual(runner.outcome, Runner.OUTCOME.WON);
          if (level.IceCells) assert(runner.getBoardState().remainingLayers.every(layer => layer === 0));
        }
      }
    }
    const runner = new Runner(level, level.Palette);
    const before = runner.snapshot();
    const hint = hints.findDailyComplete(runner, level.Id, solutions);
    assert(hint && hint.paths.length === 8, 'complete preset hint');
    assert.deepStrictEqual(runner.snapshot(), before, 'hint leaves gameplay untouched');
    if (level.IceCells) {
      assert.strictEqual(hint.steps.length, 8);
      assert(hint.steps.some(step => step.breaksIce));
      assert(hint.steps.some(step => step.clearsIce));
      if (level.Portals) assert(hint.paths.some(line => line.segments.length === 2));
      assert.strictEqual(hints.findDaily(runner, level.Id, solutions), null, 'ice does not offer misleading partial hints');
      const ice = level.IceCells[0];
      const routes = paths.filter(line => cells(line).includes(ice));
      assert.strictEqual(routes.length, 2);
      connect(runner, routes[0]);
      assert.strictEqual(runner.getBoardState().remainingLayers[ice], 1);
      const partial = runner.snapshot();
      connect(runner, routes[1]);
      assert.strictEqual(runner.getBoardState().remainingLayers[ice], 0);
      assert(runner.undo());
      assert.strictEqual(runner.getBoardState().remainingLayers[ice], 1);
      const restored = new Runner(level, level.Palette); restored.restore(partial);
      assert.strictEqual(restored.getBoardState().remainingLayers[ice], 1);
      restored.reset(); assert.strictEqual(restored.getBoardState().remainingLayers[ice], 2);
    }
  });
  assert.strictEqual(service.resolve(new Date('2026-09-25T16:00:00Z')).status, 'unavailable');
  const mixed = pack[5]; const paths = solutions.ByChallengeId[mixed.Id];
  const invalid = [{ PortalRulesVersion: 1 }, { IceRulesVersion: 2 }, { IceCells: [] },
    { IceCells: [mixed.IceCells[0], mixed.IceCells[0]] }, { IceCells: [mixed.Lines[0].Start] },
    { IceCells: [mixed.Portals[0].Cells[0]] }, { IceCells: [80] }, { IceCells: [null] },
    { Blocked: [mixed.IceCells[0]] }, { IceCells: new Array(2) }];
  invalid.forEach(patch => assert.strictEqual(service.validate(Object.assign({}, mixed, patch)).ok, false));
  const extraIce = Array.from({ length: 80 }, (_, cell) => cell).find(cell =>
    !mixed.IceCells.includes(cell) && !mixed.Portals[0].Cells.includes(cell) &&
    !mixed.Lines.some(line => line.Start === cell || line.End === cell));
  const underfilled = Object.assign({}, mixed, { IceCells: mixed.IceCells.concat(extraIce) });
  assert.strictEqual(service.validateSolution(underfilled, paths).ok, false, 'one visit cannot clear ice');
  assert.strictEqual(hints.findDailyComplete(new Runner(underfilled, mixed.Palette), mixed.Id, solutions), null);
  assert.strictEqual(service.validateSolution(mixed, paths.map(cells)).ok, false, 'teleport metadata is required');
  const runner = new Runner(mixed, mixed.Palette);
  const portalRoute = paths.find(line => line.Segments.length > 1);
  const entry = portalRoute.Segments[0].Cells;
  const before = runner.getBoardState().remainingLayers;
  runner.touchStart(entry[0]); entry.slice(1).forEach(cell => runner.touchMove(cell)); runner.touchEnd(entry[entry.length - 1]);
  assert.strictEqual(runner.getMechanicState().phase, 'PORTAL_WAIT');
  assert.deepStrictEqual(runner.getBoardState().remainingLayers, before, 'unfinished portal route consumes no ice');
  runner.cancelGesture('pointer-cancel');
  assert.deepStrictEqual(runner.getBoardState().remainingLayers, before);
  runner.reset(); assert.deepStrictEqual(runner.getBoardState().remainingLayers, before);
}
function play(app, paths) {
  app.tick(Date.now() + 1000);
  const board = app.renderer.boardLayout;
  const width = app.daily.challenge.Width;
  paths.forEach(line => segments(line).forEach(part => {
    const point = cell => ({ x: board.x + (cell % width + 0.5) * board.cell,
      y: board.y + (Math.floor(cell / width) + 0.5) * board.cell, id: 11 });
    app.onPointerStart(point(part[0]));
    part.slice(1).forEach(cell => app.onPointerMove(point(cell)));
    app.onPointerEnd(point(part[part.length - 1]));
  }));
}
function appFlow() {
  for (const width of [280, 320, 390]) for (const level of pack) {
    const raw = fakeApi();
    raw.getWindowInfo = () => ({ windowWidth: width, windowHeight: 640, pixelRatio: 2,
      safeArea: { top: 44, bottom: 616 } });
    let now = new Date(level.DateKey + 'T23:59:00+08:00');
    const platform = new Platform(raw);
    const locale = new LocaleService(platform);
    locale.select(width === 320 ? 'en-US' : 'zh-CN');
    const app = new App(platform, { clock: () => now, locale });
    const ordinary = clone(app.progress.state);
    const stamina = app.stamina.snapshot(now).balance;
    const balance = app.rewardUnlocks.view().balance;
    assert(app.enterDaily());
    assert.strictEqual(app.daily.entriesUsed, 1);
    play(app, solutions.ByChallengeId[app.daily.challengeId]);
    assert.strictEqual(app.daily.challengeId, level.Id);
    assert.strictEqual(app.daily.entriesUsed, 1, 'warmup transition consumes no extra entry');
    app.tick(Date.now() + 2000);
    const model = app.buildModel();
    if (level.Portals) assert(model.portalInstruction && model.portals.length);
    if (level.IceCells) assert(model.board.cells.some(cell => cell.frozen));
    assert(app.renderer.boardLayout.y >= 44);
    assert(app.showDailyHint());
    if (level.IceCells) {
      assert(app.hintPreview.manual);
      app.performAction('hint:next'); assert.strictEqual(app.hintPreview.index, 1);
      app.performAction('hint:prev'); assert.strictEqual(app.hintPreview.index, 0);
      app.tick(Date.now() + 60000); assert(app.hintPreview, 'manual preview does not expire');
      const board = app.renderer.boardLayout;
      const from = { x: board.x + board.cell * 6, y: board.y + board.cell * 4, id: 18 };
      const to = Object.assign({}, from, { x: from.x - 70 });
      app.onPointerStart(from); app.onPointerMove(to); app.onPointerEnd(to);
      assert.strictEqual(app.hintPreview.index, 1, 'daily supports the same swipe control');
    }
    app.clearHintPreview();
    now = new Date(now.getTime() + 120000);
    play(app, solutions.ByChallengeId[level.Id]);
    assert.strictEqual(app.scene, 'dailyResult', level.Id);
    assert.strictEqual(app.daily.dateKey, level.DateKey, 'midnight never changes the active session');
    assert.strictEqual(app.rewardUnlocks.view().balance, balance + 500);
    assert.deepStrictEqual(app.progress.state, ordinary, 'daily writes no mainline progress');
    assert.strictEqual(app.stamina.snapshot(now).balance, stamina);
    app.dispose();
  }
}
module.exports = function run() { content(); appFlow(); };
