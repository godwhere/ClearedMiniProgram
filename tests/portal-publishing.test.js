'use strict';

const assert = require('assert');
const GameRunner = require('../core/game-runner.js');
const portalValidation = require('../core/portal-validation.js');
const HintService = require('../src/services/hint-service.js');
const portalSolutions = require('../data/portal-solutions.js');
const catalog = require('../data/catalog-v2.js');

const PORTAL_8X8_PILOT = [
  { id: 'portal-8x8-01', name: '双岸交织', lineCount: 5, portalLineIndex: 2 },
  { id: 'portal-8x8-02', name: '回环抉择', lineCount: 5, portalLineIndex: 0 },
  { id: 'portal-8x8-03', name: '中轴换位', lineCount: 5, portalLineIndex: 4 },
  { id: 'portal-8x8-04', name: '夹层穿梭', lineCount: 6, portalLineIndex: 3 },
  { id: 'portal-8x8-05', name: '边界折返', lineCount: 6, portalLineIndex: 1 }
];

const PORTAL_8X8_OPTIONAL_ROUTE = [
  { Segments: [{ Cells: [26, 18, 19, 11, 3, 4, 5, 13, 21, 29, 37, 45] }] },
  { Segments: [{ Cells: [17, 25, 24, 16, 8, 9, 10, 2, 1, 0] }] },
  { Segments: [{ Cells: [12, 20, 28, 27, 35, 36, 44, 43, 42, 34, 33, 32, 40, 41] }] },
  { Segments: [{ Cells: [56, 57, 49, 50, 51, 52, 53, 54, 46, 38] }] },
  { Segments: [{ Cells: [58, 59, 60, 61, 62, 63, 55, 47, 39, 31, 23, 15, 7, 6, 14, 22] }] }
];

function solutionLineLengths(answer) {
  return answer.map(lineAnswer => (lineAnswer.Segments || [])
    .reduce((total, segment) => total + (segment.Cells || []).length, 0));
}

function flattenedLine(lineAnswer) {
  return (lineAnswer.Segments || []).reduce((cells, segment) =>
    cells.concat(segment.Cells || []), []);
}

function replay(level, answer, palette) {
  const runner = new GameRunner(level, palette || ['#f00']);
  answer.forEach((lineAnswer, lineIndex) => {
    const segments = lineAnswer.Segments || [];
    segments.forEach((segment, segmentIndex) => {
      const cells = segment.Cells || [];
      assert(cells.length > 0);
      assert.strictEqual(runner.touchStart(cells[0]), true,
        `${level.Id} line ${lineIndex} segment ${segmentIndex} start`);
      cells.slice(1).forEach(cell => {
        assert.strictEqual(runner.touchMove(cell), true,
          `${level.Id} line ${lineIndex} move ${cell}`);
      });
      const connected = runner.touchEnd(cells[cells.length - 1]);
      assert.strictEqual(connected, segmentIndex === segments.length - 1,
        `${level.Id} line ${lineIndex} segment ${segmentIndex} completion`);
    });
  });
  return runner;
}

function portalCells(level) {
  const result = new Set();
  (level.Portals || []).forEach(portal => {
    const cells = Array.isArray(portal.Cells) ? portal.Cells : [portal.A, portal.B];
    cells.forEach(cell => result.add(cell));
  });
  return result;
}

function requiredCells(level) {
  const portals = portalCells(level);
  const blocked = new Set(level.Blocked || []);
  const result = [];
  for (let index = 0; index < level.Width * level.Height; index += 1) {
    if (!blocked.has(index) && !portals.has(index)) result.push(index);
  }
  return result;
}

function run() {
  assert.strictEqual(Object.keys(portalSolutions.ByLevelId).length, 26,
    'published Portal answers contain only the 26 mainline levels');

  // 4 original milestones + 16 original chapter boards + 6 recovery boards.
  // Keep their answers in the ID-indexed Portal table.
  const hints = new HintService({ portalSolutions });
  const allPortalLevels = [];
  const seenPortalIds = new Set();

  const milestoneSpecs = [
    { setIndex: 1, levelIndex: 4, expectedId: 'portal-main-5x5-01' },
    { setIndex: 2, levelIndex: 9, expectedId: 'portal-main-6x6-01' },
    { setIndex: 3, levelIndex: 14, expectedId: 'portal-main-7x7-01' },
    { setIndex: 4, levelIndex: 14, expectedId: 'portal-main-8x8-01' }
  ];

  milestoneSpecs.forEach(spec => {
    const set = catalog.sets[spec.setIndex];
    const game = set && set.Games && set.Games[spec.levelIndex];
    assert(game, `milestone level ${spec.expectedId} must exist at set ${spec.setIndex} level ${spec.levelIndex}`);
    assert.strictEqual(game.Id, spec.expectedId);
    assert.strictEqual(game.Mechanic, 'portal');
    assert.strictEqual(game.PortalRulesVersion, 2);
  });

  const chapterGames = (catalog.sets[4].Games || []).slice(30);
  assert.strictEqual(chapterGames.length, 75,
    'the stable chapter has 35 original boards and 40 appended recovery boards');
  chapterGames.slice(0, 35).forEach((game, index) => {
    const expectedId = `portal-8x8-${String(index + 1).padStart(2, '0')}`;
    assert.strictEqual(game.Id, expectedId,
      `${expectedId} must retain its stable chapter position and ID`);
  });

  // Levels 63-67 are the first content-redesign pilot. They use two portals
  // and balanced 5/6-color routes,
  // and rely on the earlier milestone levels for basic interaction teaching.
  PORTAL_8X8_PILOT.forEach((spec, index) => {
    const game = chapterGames[index];
    const answer = portalSolutions.ByLevelId[spec.id];
    assert.strictEqual(game.Id, spec.id);
    assert.strictEqual(game.Name, spec.name);
    assert.strictEqual(game.Lines.length, spec.lineCount,
      `${spec.id} must retain its reviewed color count`);
    assert.strictEqual(game.Instructions, undefined,
      `${spec.id} must not repeat basic Portal teaching in the 8x8 chapter`);
    assert.strictEqual(game.instructions, undefined,
      `${spec.id} must not publish a lowercase instruction alias`);
    assert.strictEqual(game.Portals.length, 1);
    assert.strictEqual(game.Portals[0].Cells.length, 2,
      `${spec.id} must keep exactly two portal cells before the later four-door chapter`);

    const lengths = solutionLineLengths(answer);
    assert.strictEqual(lengths.length, spec.lineCount);
    assert(lengths.every(length => length >= 8 && length <= 16),
      `${spec.id} must keep substantial balanced paths: ${lengths.join(',')}`);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    assert.strictEqual(total, 64, `${spec.id} stored solution must cover all 64 cells`);
    assert(Math.max.apply(null, lengths) / total <= 0.25,
      `${spec.id} must not regress to a dominant Hamilton-style route: ${lengths.join(',')}`);

    const portalLines = answer.reduce((indices, lineAnswer, lineIndex) => {
      if ((lineAnswer.Segments || []).some(segment => !!segment.Exit)) indices.push(lineIndex);
      return indices;
    }, []);
    assert.deepStrictEqual(portalLines, [spec.portalLineIndex],
      `${spec.id} must retain its reviewed Portal color`);
  });

  // Level 64 intentionally supports a second, no-Portal solution. This
  // reviewed witness reroutes all five colors; mixed-chapter.test.js also
  // rejects any bypass that changes only one or two stored routes.
  const optionalGame = chapterGames[1];
  const optionalRunner = replay(optionalGame, PORTAL_8X8_OPTIONAL_ROUTE,
    catalog.sets[4].Palette);
  const optionalOwner = optionalRunner.getBoardState().owner;
  assert(Array.from(portalCells(optionalGame)).every(cell => optionalOwner[cell] === -1),
    `${optionalGame.Id} no-Portal route must leave both portal cells unused`);
  assert.strictEqual(optionalRunner.remainingCellCount(), 0);
  assert.strictEqual(optionalRunner.outcome, GameRunner.OUTCOME.WON);
  const optionalLengths = solutionLineLengths(PORTAL_8X8_OPTIONAL_ROUTE);
  assert(optionalLengths.every(length => length >= 10 && length <= 16));
  const storedOptional = portalSolutions.ByLevelId[optionalGame.Id];
  const changedLineCount = PORTAL_8X8_OPTIONAL_ROUTE.reduce((count, lineAnswer, lineIndex) =>
    count + (JSON.stringify(flattenedLine(lineAnswer)) !==
      JSON.stringify(flattenedLine(storedOptional[lineIndex])) ? 1 : 0), 0);
  assert.strictEqual(changedLineCount, optionalGame.Lines.length,
    `${optionalGame.Id} reviewed no-Portal witness must change every stored route`);

  catalog.sets.forEach((set, setIndex) => {
    (set.Games || []).forEach((game, levelIndex) => {
      if (!game || (game.Mechanic !== 'portal' && game.mechanic !== 'portal')) return;
      allPortalLevels.push({ set, setIndex, game, levelIndex });
    });
  });

  assert.strictEqual(allPortalLevels.length, 26,
    'the ordinary catalog must contain exactly 26 Portal levels');

  allPortalLevels.forEach(({ set, setIndex, game, levelIndex }) => {
    assert(!seenPortalIds.has(game.Id), `Duplicate portal level ID in ordinary catalog: ${game.Id}`);
    seenPortalIds.add(game.Id);

    assert.strictEqual(game.PortalRulesVersion, 2,
      `${game.Id} must publish with Portal rules v2`);
    assert.strictEqual(game.Instructions, undefined,
      `${game.Id} must use the shared two-message Portal prompt`);
    assert.strictEqual(game.instructions, undefined);
    const validation = portalValidation.validatePortalLevel(game, {
      solution: portalSolutions,
      requireSolution: true
    });
    assert.strictEqual(validation.ok, true,
      `${game.Id} publishing validation failed: ${validation.errors.join(',')}`);

    const answer = portalSolutions.ByLevelId[game.Id];
    assert(Array.isArray(answer), `${game.Id} answer missing in portal-solutions.js`);
    if (game.Id === 'portal-main-8x8-01') {
      const lineLengths = answer.map(lineAnswer => (lineAnswer.Segments || [])
        .reduce((total, segment) => total + (segment.Cells || []).length, 0));
      assert(lineLengths.every(length => length >= 10 && length <= 24),
        `${game.Id} must keep four substantial, balanced paths: ${lineLengths.join(',')}`);
    }
    const hint = hints.find(new GameRunner(game, set.Palette), setIndex, levelIndex);
    assert(hint && hint.source === 'solution',
      `${game.Id} at ${setIndex}:${levelIndex} must expose its keyed Portal hint`);

    answer.forEach(lineAnswer => {
      (lineAnswer.Segments || []).forEach(segment => {
        if (!segment.Exit) return;
        assert.strictEqual(segment.Exit.PortalId, 'P1');
        assert.strictEqual(segment.Exit.PairId, undefined,
          `${game.Id} v2 answers must not publish legacy PairId`);
      });
    });

    const runner = replay(game, answer, set.Palette);
    const owner = runner.getBoardState().owner;
    assert(requiredCells(game).every(cell => owner[cell] >= 0),
      `${game.Id} must cover every required non-portal cell`);
    assert.strictEqual(runner.remainingCellCount(), 0,
      `${game.Id} must leave no required cells unfilled`);
    assert.strictEqual(runner.isGameOver, true,
      `${game.Id} must replay to completion`);
  });

  assert.deepStrictEqual(Array.from(seenPortalIds).sort(), Object.keys(portalSolutions.ByLevelId).sort(),
    'removed trial answers and orphaned level IDs must not remain in the publishing table');

  // Published v2 content may expose more than two exits in one neutral
  // network. A line chooses one other portal and unused portal cells are not
  // part of the required board coverage.
  const threePortalLevel = {
    Id: 'portal-v2-three-cell-fixture',
    Mechanic: 'portal',
    PortalRulesVersion: 2,
    Width: 5,
    Height: 1,
    Lines: [{ Start: 0, End: 4 }],
    Portals: [{ Id: 'P1', Cells: [1, 2, 3] }]
  };
  const threePortalAnswer = [{
    Segments: [
      {
        Cells: [0, 1],
        Exit: { PortalId: 'P1', From: 1, To: 3 }
      },
      { Cells: [3, 4] }
    ]
  }];
  const threePortalValidation = portalValidation.validatePortalLevel(threePortalLevel, {
    solution: threePortalAnswer,
    requireSolution: true
  });
  assert.strictEqual(threePortalValidation.ok, true,
    `three-portal fixture failed: ${threePortalValidation.errors.join(',')}`);
  const threePortalRunner = replay(threePortalLevel, threePortalAnswer);
  const threePortalOwner = threePortalRunner.getBoardState().owner;
  assert.strictEqual(threePortalOwner[1], 0);
  assert.strictEqual(threePortalOwner[3], 0);
  assert.strictEqual(threePortalOwner[2], -1,
    'an unused v2 portal is optional and remains unowned');
  assert.strictEqual(threePortalRunner.remainingCellCount(), 0);
  assert.strictEqual(threePortalRunner.isGameOver, true);

  // Rules v1 remains readable and replayable for already-authored pair data.
  const legacyLevel = {
    Id: 'portal-v1-compat-fixture',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 4,
    Height: 2,
    Lines: [
      { Start: 0, End: 7 },
      { Start: 2, End: 3 },
      { Start: 4, End: 5 }
    ],
    Portals: [{ Id: 'P1', A: 1, B: 6 }]
  };
  const legacyAnswer = [
    {
      Segments: [
        { Cells: [0, 1], Exit: { PairId: 'P1', From: 1, To: 6 } },
        { Cells: [6, 7] }
      ]
    },
    { Segments: [{ Cells: [2, 3] }] },
    { Segments: [{ Cells: [4, 5] }] }
  ];
  const legacyValidation = portalValidation.validatePortalLevel(legacyLevel, {
    solution: legacyAnswer,
    requireSolution: true
  });
  assert.strictEqual(legacyValidation.ok, true,
    `v1 compatibility fixture failed: ${legacyValidation.errors.join(',')}`);
  const legacyRunner = replay(legacyLevel, legacyAnswer);
  assert.strictEqual(legacyRunner.filledCount(), legacyLevel.Width * legacyLevel.Height,
    'v1 continues to require both paired portal cells and every ordinary cell');
  assert.strictEqual(legacyRunner.isGameOver, true);
}

module.exports = run;
