'use strict';

const assert = require('assert');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');
const portalSolutions = require('../data/portal-solutions.js');
const GameRunner = require('../core/game-runner.js');
const HintService = require('../src/services/hint-service.js');
const solveWithoutPortals = require('../scripts/solve-no-portal.js');
const ProgressionService = require('../src/services/progression-service.js');

const SPECS = [
  [68, '错层回廊', 6, null],
  [69, '双侧收束', 6, null],
  [70, '隔岸接力', 6, 'required'],
  [71, '中心让行', 6, null],
  [72, '折线围合', 7, null],
  [73, '对角换轨', 6, 'required'],
  [74, '窄桥争夺', 7, null],
  [75, '内外分区', 7, null],
  [76, '双解岔路', 6, 'optional'],
  [77, '边缘回收', 7, null],
  [78, '错位锁扣', 7, null],
  [79, '中段跃迁', 7, 'required'],
  [80, '四区拼接', 7, null],
  [81, '回字封口', 8, null],
  [82, '逆序穿越', 7, 'required'],
  [83, '密点疏线', 8, null],
  [84, '镜像旁路', 7, 'optional'],
  [85, '双环交错', 8, null],
  [86, '边界压缩', 8, null],
  [87, '窄口换岸', 8, 'required'],
  [88, '中心封锁', 8, null],
  [89, '全盘改线', 7, 'optional'],
  [90, '九色织网', 9, null],
  [91, '终局预演', 8, null],
  [92, '双门终章', 8, 'required'],
  [93, '折巷分流', 8, null],
  [94, '隔层换岸', 7, 'required'],
  [95, '内外套接', 8, null],
  [96, '九色锁扣', 9, null],
  [97, '双岸合围', 8, 'required']
];

const REVIEWED_NO_PORTAL = {
  "portal-8x8-14": [{"Segments":[{"Cells":[30,38,46,54,53,52,51,50,49]}]},{"Segments":[{"Cells":[23,31,39,47,55,63,62,61,60,59]}]},{"Segments":[{"Cells":[7,15,14,13,21,29,37]}]},{"Segments":[{"Cells":[27,19,18,26,34,35,36,28,20,12,4,5,6]}]},{"Segments":[{"Cells":[11,3,2,10,9,17,25,33,32,24,16,8,0]}]},{"Segments":[{"Cells":[45,44,43,42,41,40,48,56,57,58]}]}],
  "portal-8x8-22": [{"Segments":[{"Cells":[38,46,45,37,29,21,20,19,18,26,25,24,32,40]}]},{"Segments":[{"Cells":[39,47,55,63]}]},{"Segments":[{"Cells":[7,6,5,4,3,2,1,0,8]}]},{"Segments":[{"Cells":[56,48,49,41,33,34,35,27,28]}]},{"Segments":[{"Cells":[57,58,59,60,61,62,54]}]},{"Segments":[{"Cells":[36,44,43,42,50,51,52]}]},{"Segments":[{"Cells":[30,31,23,22,14,13,12,11,10,9,17,16]}]}],
  "portal-8x8-27": [{"Segments":[{"Cells":[24,16,17,18,10,11,19,20,28]}]},{"Segments":[{"Cells":[33,41,42,43,44,45,53]}]},{"Segments":[{"Cells":[14,15,23,31,39,47,55,63]}]},{"Segments":[{"Cells":[56,57,58,59,60,61,62,54]}]},{"Segments":[{"Cells":[9,8,0,1,2,3,4,12,13,5,6,7]}]},{"Segments":[{"Cells":[52,51,50,49,48,40,32]}]},{"Segments":[{"Cells":[34,26,27,35,36,37,38,30,22,21,29]}]}]
};

function segmentsOf(line) {
  return Array.isArray(line) ? [{ Cells: line }] : line.Segments;
}

function flattened(line) {
  return segmentsOf(line).reduce((cells, segment) => cells.concat(segment.Cells), []);
}

function replay(level, answer) {
  const runner = new GameRunner(level, catalog.sets[4].Palette);
  answer.forEach((line, lineIndex) => {
    const segments = segmentsOf(line);
    segments.forEach((segment, segmentIndex) => {
      const cells = segment.Cells;
      assert.strictEqual(runner.touchStart(cells[0]), true,
        `${level.Id} line ${lineIndex} start`);
      cells.slice(1).forEach(cell => {
        assert.strictEqual(runner.touchMove(cell), true,
          `${level.Id} line ${lineIndex} move ${cell}`);
      });
      assert.strictEqual(runner.touchEnd(cells[cells.length - 1]),
        segmentIndex === segments.length - 1,
        `${level.Id} line ${lineIndex} completion`);
    });
  });
  assert.strictEqual(runner.outcome, GameRunner.OUTCOME.WON, `${level.Id} must replay to WON`);
  return runner;
}

function assertNoOneOrTwoLineBypass(level, answer) {
  const paths = answer.map(flattened);
  const portalLine = answer.findIndex(line => line.Segments.some(segment => segment.Exit));
  for (let other = -1; other < level.Lines.length; other += 1) {
    if (other === portalLine) continue;
    const moving = other < 0 ? [portalLine] : [portalLine, other];
    const movingSet = new Set(moving);
    const fixedCells = paths.reduce((cells, path, index) =>
      movingSet.has(index) ? cells : cells.concat(path), []);
    const reduced = Object.assign({}, level, {
      Lines: moving.map(index => level.Lines[index]),
      Blocked: fixedCells
    });
    const audit = solveWithoutPortals(reduced);
    assert.strictEqual(audit.status, 'unsatisfiable',
      `${level.Id} must require at least three colors to reroute; free colors ${moving.join(',')} gave ${audit.status}`);
  }
}

function canonicalLayout(level) {
  const transforms = [
    (row, col) => [row, col],
    (row, col) => [col, 7 - row],
    (row, col) => [7 - row, 7 - col],
    (row, col) => [7 - col, row],
    (row, col) => [row, 7 - col],
    (row, col) => [7 - row, col],
    (row, col) => [col, row],
    (row, col) => [7 - col, 7 - row]
  ];
  return transforms.map(transform => {
    const cell = index => {
      const mapped = transform(Math.floor(index / 8), index % 8);
      return mapped[0] * 8 + mapped[1];
    };
    const pairs = level.Lines.map(line =>
      [cell(line.Start), cell(line.End)].sort((one, two) => one - two).join('-')).sort();
    const portals = (level.Portals || []).reduce((cells, network) =>
      cells.concat(network.Cells || []), []).map(cell).sort((one, two) => one - two);
    return pairs.join('|') + '@' + portals.join(',');
  }).sort()[0];
}

function run() {
  const simple = { Width: 2, Height: 1, Lines: [{ Start: 0, End: 1 }] };
  assert.deepStrictEqual(solveWithoutPortals(simple).paths, [[0, 1]]);
  assert.strictEqual(solveWithoutPortals(simple, { maxStates: 1 }).status, 'limit',
    'a bounded audit must not report an exhausted search as impossible');
  assert.strictEqual(solveWithoutPortals({
    Width: 2, Height: 2,
    Lines: [{ Start: 0, End: 3 }, { Start: 1, End: 2 }]
  }).status, 'unsatisfiable');
  assert.strictEqual(solveWithoutPortals({
    Width: 9, Height: 1, Lines: [{ Start: 0, End: 8 }]
  }).status, 'invalid');
  const pilotOptional = catalog.sets[4].Games[31];
  assertNoOneOrTwoLineBypass(pilotOptional, portalSolutions.ByLevelId[pilotOptional.Id]);

  const hints = new HintService(solutions);
  const seenLayouts = new Map();
  catalog.sets[4].Games.slice(0, 35).forEach(game => {
    seenLayouts.set(canonicalLayout(game), game.Id || game.Name);
  });
  let ordinaryCount = 0;
  let portalCount = 0;
  SPECS.forEach(([number, name, colorCount, bypass]) => {
    // number is the historical design number, never the reordered display slot.
    const entry = catalog.levels.find(level => level.setIndex === 4 && level.levelIndex === number - 33);
    const game = entry.game;
    const id = `portal-8x8-${String(number - 62).padStart(2, '0')}`;
    assert.strictEqual(entry.setIndex, 4);
    assert.strictEqual(entry.levelIndex, number - 33);
    assert.strictEqual(game.Id, id, 'mixed content must preserve stable IDs and save coordinates');
    assert.strictEqual(game.Name, name);
    assert.strictEqual(game.Width, 8);
    assert.strictEqual(game.Height, 8);
    assert.strictEqual(game.Lines.length, colorCount);
    assert.strictEqual(game.Instructions, undefined);
    assert.strictEqual(game.instructions, undefined);
    assert.strictEqual(game.Blocked, undefined);

    let answer;
    if (bypass) {
      portalCount += 1;
      assert.strictEqual(game.Mechanic, 'portal');
      assert.strictEqual(game.PortalRulesVersion, 2);
      assert.strictEqual(game.Portals.length, 1);
      assert.strictEqual(game.Portals[0].Cells.length, 2);
      assert.strictEqual(solutions.ByLevelId[id], undefined);
      answer = portalSolutions.ByLevelId[id];
      const before = JSON.stringify(game);
      const audit = solveWithoutPortals(game);
      assert.strictEqual(JSON.stringify(game), before, 'offline search must not mutate content');
      assert.strictEqual(audit.status, bypass === 'required' ? 'unsatisfiable' : 'solved',
        `${id} no-Portal classification`);
      if (bypass === 'optional') {
        const alternate = REVIEWED_NO_PORTAL[id];
        assert(alternate, `${id} must retain its reviewed no-Portal witness`);
        const alternativeRunner = replay(game, alternate);
        const owner = alternativeRunner.getBoardState().owner;
        assert(game.Portals[0].Cells.every(cell => owner[cell] === -1));
        const altLengths = alternate.map(line => flattened(line).length);
        assert(altLengths.every(length => length >= 4 && length <= 20));
        const changed = alternate.filter((line, index) =>
          JSON.stringify(flattened(line)) !== JSON.stringify(flattened(answer[index]))).length;
        assert(changed >= 3, `${id} reviewed bypass must reroute at least three colors`);
        assertNoOneOrTwoLineBypass(game, answer);
      }
    } else {
      ordinaryCount += 1;
      assert.strictEqual(game.Mechanic, undefined);
      assert.strictEqual(game.PortalRulesVersion, undefined);
      assert.strictEqual(game.Portals, undefined);
      assert.strictEqual(portalSolutions.ByLevelId[id], undefined,
        `${id} must not retain a stale Portal answer after becoming ordinary`);
      answer = solutions.ByLevelId[id];
    }

    assert(Array.isArray(answer), `${id} answer missing`);
    const lengths = answer.map(line => flattened(line).length);
    assert(lengths.every(length => length >= 4 && length <= 16),
      `${id} must avoid tiny filler and dominant routes: ${lengths.join(',')}`);
    assert.strictEqual(lengths.reduce((sum, length) => sum + length, 0), 64);
    assert(Math.max.apply(null, lengths) / 64 <= 0.30);
    game.Lines.forEach(line => {
      const distance = Math.abs((line.Start % 8) - (line.End % 8)) +
        Math.abs(Math.floor(line.Start / 8) - Math.floor(line.End / 8));
      assert(distance > 1, `${id} must not contain an adjacent same-color filler pair`);
    });
    replay(game, answer);
    const hintRunner = new GameRunner(game, catalog.sets[4].Palette);
    const hint = hints.find(hintRunner, entry.setIndex, entry.levelIndex);
    const completeHint = hints.findComplete(hintRunner, entry.setIndex, entry.levelIndex);
    assert(hint && hint.source === 'solution', `${id} must expose its official hint`);
    assert(completeHint && completeHint.source === 'solution', `${id} full hint must remain available`);

    if (number >= 93) {
      assert(lengths.every(length => length >= 5 && length <= 14),
        `${id} appended batch must retain its balanced 5-14 cell routes`);
      assert.deepStrictEqual(completeHint.paths.map(line =>
        line.segments ? [].concat(...line.segments) : line.path), answer.map(flattened),
      `${id} complete hint must preserve every stored segment`);
      // Gesture replay deliberately reads only Cells: Runner, not the answer's
      // Exit metadata, must recognize reverse entrance/exit and alternate order.
      const backwards = answer.slice().reverse().map(line => ({
        Segments: segmentsOf(line).slice().reverse().map(segment => ({
          Cells: segment.Cells.slice().reverse()
        }))
      }));
      replay(game, backwards);
      replay(game, answer.slice(2).concat(answer.slice(0, 2)));
      if (bypass) {
        const portalLines = answer.map((line, index) =>
          line.Segments.some(segment => segment.Exit) ? index : -1).filter(index => index >= 0);
        assert.deepStrictEqual(portalLines, [number === 94 ? 2 : 4],
          `${id} must retain one teleport on its reviewed, non-first color`);
      }
    }

    const layout = canonicalLayout(game);
    assert(!seenLayouts.has(layout), `${id} duplicates ${seenLayouts.get(layout)} under symmetry`);
    seenLayouts.set(layout, id);
  });
  assert.strictEqual(ordinaryCount, 19);
  assert.strictEqual(portalCount, 11);
  assert.strictEqual(catalog.sets[4].Games.slice(30, 65).filter(game => game.Mechanic === 'portal').length, 16);

  // Existing level 92 saves unlock the appended batch without renumbering.
  const completed = new Set(['4:59']);
  const progression = new ProgressionService({
    isCompleted: (set, level) => completed.has(`${set}:${level}`)
  }, catalog.sets);
  for (let level = 60; level <= 64; level += 1) {
    assert.deepStrictEqual(progression.nextLevel(4, level - 1), { setIndex: 4, levelIndex: level });
    assert.strictEqual(progression.isUnlocked(4, level), true);
    assert.strictEqual(progression.isUnlocked(4, level + 1), false);
    completed.add(`4:${level}`);
  }
  assert.deepStrictEqual(progression.nextLevel(4, 64), { setIndex: 4, levelIndex: 65 });
}

module.exports = run;
