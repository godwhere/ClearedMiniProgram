'use strict';

const assert = require('assert');
const GameRunner = require('../core/game-runner.js');
const portalValidation = require('../core/portal-validation.js');
const portalDemo = require('../data/portal-demo.js');
const portalSolutions = require('../data/portal-solutions.js');

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
  const games = portalDemo.Games || [];
  assert.strictEqual(games.length, 5);

  games.forEach(game => {
    assert.strictEqual(game.PortalRulesVersion, 2,
      `${game.Id} must publish with the current portal rules version`);
    assert(game.Portals.every(portal => Array.isArray(portal.Cells) && portal.Cells.length >= 2),
      `${game.Id} must use the v2 portal network shape`);
    const validation = portalValidation.validatePortalLevel(game, {
      solution: portalSolutions,
      requireSolution: true
    });
    assert.strictEqual(validation.ok, true,
      `${game.Id} publishing validation failed: ${validation.errors.join(',')}`);

    const answer = portalSolutions.ByLevelId[game.Id];
    assert(Array.isArray(answer));
    answer.forEach(lineAnswer => {
      (lineAnswer.Segments || []).forEach(segment => {
        if (!segment.Exit) return;
        assert.strictEqual(segment.Exit.PortalId, 'P1');
        assert.strictEqual(segment.Exit.PairId, undefined,
          `${game.Id} v2 answers must not publish the legacy PairId field`);
      });
    });
    const runner = replay(game, answer, portalDemo.Palette);

    const owner = runner.getBoardState().owner;
    assert(requiredCells(game).every(cell => owner[cell] >= 0),
      `${game.Id} must cover every required non-portal cell`);
    assert.strictEqual(runner.remainingCellCount(), 0,
      `${game.Id} must leave no required cells unfilled`);
    assert.strictEqual(runner.isGameOver, true, `${game.Id} must replay to completion`);
  });

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
