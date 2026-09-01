'use strict';

const assert = require('assert');
const GameRunner = require('../core/game-runner.js');

function run() {
  const ordinaryLevel = {
    Id: 'contract-ordinary',
    Width: 3,
    Height: 1,
    Blocked: [],
    Lines: [{ Start: 0, End: 2 }]
  };
  const runner = new GameRunner(ordinaryLevel, ['#f00']);

  const initial = runner.getViewState();
  assert.strictEqual(initial.levelId, 'contract-ordinary');
  assert.deepStrictEqual(initial.board.owner, [-1, -1, -1]);
  assert.deepStrictEqual(initial.board.fixedLine, [0, -1, 0]);
  assert.strictEqual(initial.mechanic.id, null);
  initial.board.owner[0] = 99;
  initial.board.fixedLine[1] = 99;
  initial.board.blockedMask[0] = true;
  initial.board.lines[0].Start = 99;
  assert.deepStrictEqual(runner.owner, [-1, -1, -1], 'view owner is a copy');
  assert.deepStrictEqual(runner.fixedLine, [0, -1, 0], 'view fixedLine is a copy');
  assert.strictEqual(runner.blockedMask[0], false, 'view blocked mask is a copy');
  assert.strictEqual(runner.level.Lines[0].Start, 0, 'view lines are copies');

  const start = runner.startGesture(0);
  assert.strictEqual(start.changed, true);
  assert.strictEqual(start.status, 'drawing');
  assert.strictEqual(start.phase, 'DRAWING');
  assert.strictEqual(start.commit, null);
  assert.strictEqual(start.outcome, 'playing');
  const move = runner.moveGesture(1);
  assert.strictEqual(move.changed, true);
  assert.strictEqual(move.status, 'drawing');
  const end = runner.endGesture(2);
  assert.strictEqual(end.changed, true);
  assert.strictEqual(end.status, 'completed');
  assert.strictEqual(end.outcome, 'won');
  assert.deepStrictEqual(end.commit, {
    lineIndex: 0,
    cells: [0, 1, 2],
    segments: null,
    teleports: null
  });

  end.commit.cells[0] = 99;
  const completed = runner.getCompletedLine(0);
  assert.deepStrictEqual(completed.cells, [0, 1, 2]);
  completed.cells[1] = 99;
  assert.deepStrictEqual(runner.completedPaths[0], [0, 1, 2],
    'completed-line queries cannot mutate runner state');

  const selection = runner.getSelectionState();
  selection.cells.push(99);
  selection.segments.push([99]);
  assert.deepStrictEqual(runner.selectedCells, []);
  assert.deepStrictEqual(runner.selectedSegments, []);

  const portalLevel = {
    Id: 'contract-portal',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 4,
    Height: 2,
    Blocked: [],
    Lines: [
      { Start: 0, End: 7 },
      { Start: 2, End: 3 },
      { Start: 4, End: 5 }
    ],
    Portals: [{ Id: 'P1', A: 1, B: 6 }]
  };
  const portal = new GameRunner(portalLevel, ['#f00', '#0f0', '#00f']);
  assert.strictEqual(portal.startGesture(0).status, 'drawing');
  const lock = portal.moveGesture(1);
  assert.strictEqual(lock.phase, 'PORTAL_LOCKED');
  assert.strictEqual(lock.expectedExit, 6);
  const lockedState = portal.getMechanicState();
  assert.strictEqual(lockedState.locked.entry, 1);
  assert.strictEqual(lockedState.portals[0].id, 'P1');
  lockedState.locked.entry = 99;
  lockedState.portals[0].A = 99;
  assert.strictEqual(portal.portalLock.entry, 1);
  assert.strictEqual(portal.portals[0].A, 1);

  const wait = portal.endGesture(-1);
  assert.strictEqual(wait.status, 'portal-wait');
  assert.strictEqual(wait.phase, 'PORTAL_WAIT');
  assert.strictEqual(wait.expectedExit, 6);
  const waitingState = portal.getViewState();
  assert.deepStrictEqual(waitingState.mechanic.pending.entryCells, [0, 1]);
  assert(waitingState.mechanic.pending.usedPairIds.indexOf('P1') >= 0);
  waitingState.mechanic.pending.entryCells[0] = 99;
  waitingState.mechanic.pending.usedPairIds.push('P2');
  assert.deepStrictEqual(portal.portalPending.entrySegments, [[0, 1]]);
  assert.deepStrictEqual(portal.portalPending.usedPairIds, ['P1']);

  const cancelled = portal.cancelGesture('navigation');
  assert.strictEqual(cancelled.changed, true);
  assert.strictEqual(cancelled.status, 'cancelled');
  assert.strictEqual(cancelled.phase, 'READY');
  assert.strictEqual(portal.portalStatus(), null);

  // The legacy boolean API remains available and delegates to the structured
  // contract without changing its established return values.
  const legacy = new GameRunner(ordinaryLevel, ['#f00']);
  assert.strictEqual(legacy.touchStart(0), true);
  assert.strictEqual(legacy.touchMove(1), true);
  assert.strictEqual(legacy.touchEnd(2), true);
}

module.exports = run;
