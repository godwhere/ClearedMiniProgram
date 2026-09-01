const assert = require('assert');
const GameRunner = require('../core/game-runner.js');
const portalValidation = require('../core/portal-validation.js');

function portalLevel(lines, portals, extra) {
  return Object.assign({
    Id: 'portal-test',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 6,
    Height: 6,
    Lines: lines,
    Portals: portals
  }, extra || {});
}

function runnerWithPortal(lines) {
  return new GameRunner(
    portalLevel(
      lines || [{ Start: 0, End: 35 }],
      [{ Id: 'P1', A: 7, B: 28 }]
    ),
    ['#f00', '#0f0']
  );
}

function assertPhase(runner, phase) {
  const status = runner.portalStatus();
  assert(status, `expected portal status ${phase}`);
  assert.strictEqual(status.phase, phase);
  return status;
}

function movePath(runner, cells) {
  assert(cells.length > 0);
  assert.strictEqual(runner.touchStart(cells[0]), true);
  cells.slice(1).forEach(cell => {
    assert.strictEqual(runner.touchMove(cell), true, `move to ${cell}`);
  });
}

function startAtPortalAndRelease(runner, cells) {
  movePath(runner, cells);
  assertPhase(runner, 'PORTAL_LOCKED');
  // A release outside the board is still a release at the locked portal.
  assert.strictEqual(runner.touchEnd(-1), false);
  return assertPhase(runner, 'PORTAL_WAIT');
}

function run() {
  // Legacy levels without Portals retain the old runner behavior and expose
  // inert portal queries.
  const legacy = new GameRunner({
    Width: 5,
    Height: 1,
    Lines: [{ Start: 0, End: 4 }]
  }, ['#f00']);
  assert.strictEqual(legacy.portalAt(0), null);
  assert.strictEqual(legacy.portalExit(0), -1);
  assert.strictEqual(legacy.isPortalCell(0), false);
  assert.strictEqual(legacy.portalStatus(), null);
  movePath(legacy, [0, 1, 2, 3, 4]);
  assert.strictEqual(legacy.touchEnd(4), true);
  assert.strictEqual(legacy.isGameOver, true);
  assert.deepStrictEqual(legacy.completedPaths[0], [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(legacy.owner, [0, 0, 0, 0, 0]);

  // Runtime and authoring validation consume the same normalized descriptor
  // and index contract, including compact/lower-case field aliases.
  const sharedSchemaLevel = portalLevel(
    [{ Start: 0, End: 35 }],
    [{ id: 'P1', Cells: [7, 28] }]
  );
  const sharedValidation = portalValidation.validatePortals(sharedSchemaLevel);
  const sharedRunner = new GameRunner(sharedSchemaLevel, ['#f00']);
  assert.strictEqual(sharedValidation.ok, true);
  assert.deepStrictEqual(
    sharedRunner.portals.map(portal => ({ id: portal.id, A: portal.A, B: portal.B })),
    sharedValidation.portals.map(portal => ({ id: portal.id, A: portal.A, B: portal.B }))
  );
  [7, 28].forEach(cell => {
    const runtime = sharedRunner.portalAt(cell);
    const validated = sharedValidation.portalByCell[cell];
    assert.deepStrictEqual(runtime, {
      id: validated.id,
      entry: validated.entry,
      exit: validated.exit
    });
  });

  // Runtime enables portal movement only for the explicit v1 contract.
  // Stray portal fields, missing versions, and future versions retain normal
  // four-direction movement rather than partially activating the mechanic.
  [
    { Mechanic: undefined, PortalRulesVersion: 1 },
    { Mechanic: 'portal', PortalRulesVersion: undefined },
    { Mechanic: 'portal', PortalRulesVersion: 2 },
    { Mechanic: 'normal', PortalRulesVersion: 1 }
  ].forEach(contract => {
    const ordinaryLevel = portalLevel(
      [{ Start: 0, End: 4 }],
      [{ Id: 'P1', A: 1, B: 3 }],
      Object.assign({ Width: 5, Height: 1 }, contract)
    );
    const ordinaryRunner = new GameRunner(ordinaryLevel, ['#f00']);
    assert.strictEqual(ordinaryRunner.portalEnabled, false);
    assert.strictEqual(ordinaryRunner.portalAt(1), null);
    movePath(ordinaryRunner, [0, 1, 2, 3, 4]);
    assert.strictEqual(ordinaryRunner.touchEnd(4), true);
    assert.deepStrictEqual(ordinaryRunner.completedPaths[0], [0, 1, 2, 3, 4]);
  });

  const ignoredOptionPortals = new GameRunner({
    Width: 5,
    Height: 1,
    Lines: [{ Start: 0, End: 4 }]
  }, ['#f00'], null, { portals: [{ Id: 'P1', A: 1, B: 3 }] });
  assert.strictEqual(ignoredOptionPortals.portalEnabled, false,
    'runtime options cannot bypass the level mechanic/version contract');

  [
    [{ A: 1, B: 3 }],
    [{ Id: 7, A: 1, B: 3 }],
    [{ Id: 'P1', A: 1, B: 1 }],
    [{ Id: 'P1', A: 1, B: 10 }],
    [{ Id: 'P1', A: 1, B: 3 }, { Id: 'P2', A: 6, B: 8 }]
  ].forEach(portals => {
    const invalidRuntime = new GameRunner(portalLevel(
      [{ Start: 0, End: 9 }],
      portals,
      { Width: 5, Height: 2 }
    ), ['#f00']);
    assert.strictEqual(invalidRuntime.portalEnabled, false,
      'malformed v1 portal declarations fall back to ordinary movement');
  });

  // Portal v2 models one neutral network. Reaching any member exposes every
  // other currently available member, while the legacy single-exit query is
  // deliberately inert so callers cannot pick an arbitrary v2 destination.
  const networkLevel = portalLevel(
    [{ Start: 0, End: 4 }],
    [{ Id: 'P1', Cells: [1, 2, 3] }],
    { PortalRulesVersion: 2, Width: 5, Height: 1 }
  );
  const network = new GameRunner(networkLevel, ['#f00']);
  assert.strictEqual(network.getMechanicState().rulesVersion, 2);
  assert.deepStrictEqual(network.portalExits(1), [2, 3]);
  assert.strictEqual(network.portalExit(1), -1);
  assert.strictEqual(network.touchStart(0), true);
  const networkLock = network.moveGesture(1);
  assert.strictEqual(networkLock.phase, 'PORTAL_LOCKED');
  assert.strictEqual(networkLock.expectedExit, null);
  assert.deepStrictEqual(networkLock.expectedExits, [2, 3]);
  const exposedLock = network.getMechanicState().locked;
  exposedLock.eligibleExits.push(99);
  assert.deepStrictEqual(network.portalLock.eligibleExits, [2, 3],
    'v2 lock candidates are exposed as copies');
  assert.strictEqual(network.touchEnd(-1), false);
  assert.strictEqual(network.touchStart(2), true, 'the first candidate exit is accepted');
  assert.strictEqual(network.touchEnd(2), false, 'an empty exit segment returns to waiting');
  assert.deepStrictEqual(network.portalStatus().eligibleExits, [2, 3]);
  assert.strictEqual(network.touchStart(3), true, 'a different candidate can be chosen on retry');
  assert.strictEqual(network.touchMove(4), true);
  assert.strictEqual(network.touchEnd(4), true);
  assert.strictEqual(network.outcome, 'won');
  assert.strictEqual(network.owner[2], -1,
    'an unused v2 portal is optional and remains unowned');
  assert.strictEqual(network.remainingCellCount(), 0);
  assert.deepStrictEqual(network.getCompletedLine(0).teleports, [
    { portalId: 'P1', from: 1, to: 3 }
  ]);

  const ambiguousNetwork = new GameRunner(portalLevel(
    [{ Start: 0, End: 4 }],
    [{ Id: 'P1', Cells: [1, 3], A: 1, B: 2 }],
    { PortalRulesVersion: 2, Width: 5, Height: 1 }
  ), ['#f00']);
  assert.strictEqual(ambiguousNetwork.portalEnabled, false,
    'v2 pair fields are rejected instead of being silently ignored');
  const sparseNetwork = new GameRunner(portalLevel(
    [{ Start: 0, End: 4 }],
    [{ Id: 'P1', Cells: [1, , 3] }],
    { PortalRulesVersion: 2, Width: 5, Height: 1 }
  ), ['#f00']);
  assert.strictEqual(sparseNetwork.portalEnabled, false,
    'sparse v2 cell arrays are rejected at the runtime boundary');

  const filteredNetwork = new GameRunner(networkLevel, ['#f00']);
  filteredNetwork.owner[2] = 1;
  assert.strictEqual(filteredNetwork.touchStart(0), true);
  const filteredLock = filteredNetwork.moveGesture(1);
  assert.deepStrictEqual(filteredLock.expectedExits, [3],
    'occupied exits are removed without disabling other network exits');

  const oneUseNetwork = new GameRunner(portalLevel(
    [{ Start: 0, End: 6 }],
    [{ Id: 'P1', Cells: [1, 3, 5] }],
    { PortalRulesVersion: 2, Width: 7, Height: 1 }
  ), ['#f00']);
  assert.strictEqual(oneUseNetwork.touchStart(0), true);
  assert.strictEqual(oneUseNetwork.touchMove(1), true);
  oneUseNetwork.touchEnd(-1);
  assert.strictEqual(oneUseNetwork.touchStart(3), true);
  assert.strictEqual(oneUseNetwork.touchMove(4), true);
  assert.strictEqual(oneUseNetwork.touchMove(5), false,
    'v2 limits one line to one network transition');

  // Portal lookup is symmetric and does not turn a portal pair into ordinary
  // grid adjacency.
  const lookup = runnerWithPortal();
  const atA = lookup.portalAt(7);
  const atB = lookup.portalAt(28);
  assert(atA);
  assert.strictEqual(atA.id, 'P1');
  assert.strictEqual(atA.entry, 7);
  assert.strictEqual(atA.exit, 28);
  assert(atB);
  assert.strictEqual(atB.id, 'P1');
  assert.strictEqual(atB.entry, 28);
  assert.strictEqual(atB.exit, 7);
  assert.strictEqual(lookup.portalExit(7), 28);
  assert.strictEqual(lookup.portalExit(28), 7);
  assert.strictEqual(lookup.portalExit(0), -1);
  assert.strictEqual(lookup.isPortalCell(7), true);
  assert.strictEqual(lookup.isPortalCell(28), true);
  assert.strictEqual(lookup.isPortalCell(0), false);

  // Entering A locks the current pointer. Moves after A cannot skip the
  // required release, and release enters a persistent waiting state.
  const locked = runnerWithPortal();
  movePath(locked, [0, 1, 7]);
  const cellsAtA = locked.selectedCells.slice();
  const lockedStatus = assertPhase(locked, 'PORTAL_LOCKED');
  assert.strictEqual(lockedStatus.lineIndex, 0);
  assert.strictEqual(lockedStatus.pairId, 'P1');
  assert.strictEqual(lockedStatus.entry, 7);
  assert.strictEqual(lockedStatus.exit, 28);
  assert.deepStrictEqual(lockedStatus.entryCells, [0, 1, 7]);
  assert.strictEqual(locked.touchMove(8), false);
  assert.deepStrictEqual(locked.selectedCells, cellsAtA);

  // An OS-level cancellation after reaching the entry is treated as the
  // required release, preserving A and entering the reconnect wait state.
  const cancelledAtEntry = runnerWithPortal();
  movePath(cancelledAtEntry, [0, 1, 7]);
  const entryCellsBeforeCancel = cancelledAtEntry.selectedCells.slice();
  assert.strictEqual(cancelledAtEntry.handlePointerCancel(), true);
  assertPhase(cancelledAtEntry, 'PORTAL_WAIT');
  assert.deepStrictEqual(cancelledAtEntry.selectedCells, entryCellsBeforeCancel);
  assert.strictEqual(cancelledAtEntry.handlePointerCancel(), false,
    'a late cancellation while already waiting is inert');
  assertPhase(cancelledAtEntry, 'PORTAL_WAIT');
  // The same pointer is released after the lock; it must not be interpreted
  // as a normal endpoint redraw.
  assert.strictEqual(locked.touchEnd(-1), false);
  const waitStatus = assertPhase(locked, 'PORTAL_WAIT');
  assert.strictEqual(waitStatus.phase, 'PORTAL_WAIT');
  assert.deepStrictEqual(waitStatus.entryCells, [0, 1, 7]);
  assert.deepStrictEqual(locked.selectedCells, cellsAtA);

  // A wrong press in PORTAL_WAIT rolls back the whole A segment to the
  // pre-line state. It must not start the accidentally pressed line or add an
  // undo entry. A following gesture can still start that other line normally.
  const wrong = runnerWithPortal([
    { Start: 0, End: 35 },
    { Start: 5, End: 30 }
  ]);
  startAtPortalAndRelease(wrong, [0, 1, 7]);
  const undoBeforeWrong = wrong.undoStack.length;
  assert.strictEqual(wrong.touchStart(5), false, 'wrong endpoint only cancels pending portal');
  assert.strictEqual(wrong.portalStatus(), null);
  assert.strictEqual(wrong.selectedLine, -1);
  assert.deepStrictEqual(wrong.selectedCells, []);
  assert.strictEqual(wrong.completedPaths[0], null);
  assert.strictEqual(wrong.owner[7], -1);
  assert.strictEqual(wrong.undoStack.length, undoBeforeWrong);
  assert.strictEqual(wrong.touchStart(5), true, 'the next gesture may start the other line');
  wrong.cancelSelection();

  // If the portal line was a redraw, an erroneous exit restores the completed
  // path that existed before the redraw began, not merely an empty line.
  const redraw = runnerWithPortal([
    { Start: 0, End: 5 },
    { Start: 30, End: 35 }
  ]);
  movePath(redraw, [0, 1, 2, 3, 4, 5]);
  assert.strictEqual(redraw.touchEnd(5), true);
  const oldPath = redraw.completedPaths[0].slice();
  const undoBeforeRedraw = redraw.undoStack.length;
  startAtPortalAndRelease(redraw, [0, 6, 7]);
  assert.strictEqual(redraw.touchStart(30), false);
  assert.strictEqual(redraw.portalStatus(), null);
  assert.deepStrictEqual(redraw.completedPaths[0], oldPath);
  oldPath.forEach(cell => assert.strictEqual(redraw.owner[cell], 0));
  assert.strictEqual(redraw.owner[7], -1);
  assert.strictEqual(redraw.undoStack.length, undoBeforeRedraw);

  // Correct B continuation resumes the same line. Releasing immediately at B
  // keeps A and returns to PORTAL_WAIT; moving out of B and reaching the target
  // then commits one complete line with both portal cells covered.
  const continuation = runnerWithPortal();
  startAtPortalAndRelease(continuation, [0, 1, 7]);
  assert.strictEqual(continuation.outcome, 'playing', 'PORTAL_WAIT must not evaluate the unfinished line');
  assert.strictEqual(continuation.failureReason, null);
  assert.strictEqual(continuation.isTerminal(), false);
  assert.strictEqual(continuation.touchStart(28), true);
  const continueStatus = assertPhase(continuation, 'PORTAL_CONTINUE');
  assert.strictEqual(continueStatus.lineIndex, 0);
  assert.strictEqual(continueStatus.entry, 7);
  assert.strictEqual(continueStatus.exit, 28);
  assert.strictEqual(continuation.outcome, 'playing', 'PORTAL_CONTINUE must not evaluate the unfinished line');
  assert.strictEqual(continuation.isTerminal(), false);
  assert.strictEqual(continuation.touchEnd(28), false);
  assertPhase(continuation, 'PORTAL_WAIT');
  assert.strictEqual(continuation.outcome, 'playing', 'returning to PORTAL_WAIT must remain playable');
  assert.strictEqual(continuation.owner[7], -1);
  assert.strictEqual(continuation.owner[28], -1);

  assert.strictEqual(continuation.touchStart(28), true);
  assertPhase(continuation, 'PORTAL_CONTINUE');
  assert.strictEqual(continuation.touchMove(29), true);
  assert.strictEqual(continuation.touchMove(35), true);
  assert.strictEqual(continuation.outcome, 'playing', 'reaching the target must not fail before commit');
  assert.strictEqual(continuation.touchEnd(35), true);
  assert.strictEqual(continuation.portalStatus(), null);
  assert.strictEqual(continuation.selectedLine, -1);
  assert.deepStrictEqual(continuation.selectedCells, []);
  assert.strictEqual(continuation.completedPaths[0][0], 0);
  assert.strictEqual(continuation.completedPaths[0].includes(7), true);
  assert.strictEqual(continuation.completedPaths[0].includes(28), true);
  assert.strictEqual(continuation.completedPaths[0].includes(35), true);
  assert.strictEqual(continuation.owner[7], 0);
  assert.strictEqual(continuation.owner[28], 0);
  assert(continuation.filledCount() >= 5, 'both portal cells count toward coverage');
  assert.strictEqual(continuation.outcome, 'failed', 'a committed portal line that leaves cells empty must fail');
  assert.strictEqual(continuation.failureReason, 'unfilled-cells');
  assert.strictEqual(continuation.isGameOver, false, 'legacy victory flag must stay false on failure');
  assert.strictEqual(continuation.isTerminal(), true);
  assert.strictEqual(continuation.remainingCellCount(), 30);
  assert.strictEqual(continuation.remainingPlayableCells, 30);

  // Resetting a terminal portal failure clears both ordinary outcome state and
  // transient portal state so the same level can be attempted again.
  continuation.reset();
  assert.strictEqual(continuation.outcome, 'playing');
  assert.strictEqual(continuation.failureReason, null);
  assert.strictEqual(continuation.isGameOver, false);
  assert.strictEqual(continuation.isTerminal(), false);
  assert.strictEqual(continuation.remainingPlayableCells, 0);
  assert.strictEqual(continuation.finishedAt, 0);
  assert.strictEqual(continuation.portalStatus(), null);
  assert.strictEqual(continuation.portalPhase, 'READY');
  assert.strictEqual(continuation.selectedLine, -1);
  assert.deepStrictEqual(continuation.selectedCells, []);

  // Cancelling after starting or extending the exit-side gesture clears only
  // that temporary segment and returns to the same pending exit.
  const cancelledAtExit = runnerWithPortal();
  startAtPortalAndRelease(cancelledAtExit, [0, 1, 7]);
  assert.strictEqual(cancelledAtExit.touchStart(28), true);
  assert.strictEqual(cancelledAtExit.touchMove(29), true);
  assert.strictEqual(cancelledAtExit.touchMove(35), true);
  assert.strictEqual(cancelledAtExit.handlePointerCancel(), true);
  const exitCancelStatus = assertPhase(cancelledAtExit, 'PORTAL_WAIT');
  assert.deepStrictEqual(exitCancelStatus.entryCells, [0, 1, 7]);
  assert.deepStrictEqual(cancelledAtExit.selectedCells, [0, 1, 7]);
  assert.strictEqual(cancelledAtExit.touchStart(28), true,
    'the expected exit remains available after pointer cancellation');
  assert.strictEqual(cancelledAtExit.cancelPortalContinuation(), true,
    'explicit lifecycle cancellation still clears the full pending line');
  assert.strictEqual(cancelledAtExit.portalStatus(), null);

  // Explicit cancellation has the same stable cleanup semantics as a wrong
  // choice and leaves the ordinary undo stack untouched.
  const cancelled = runnerWithPortal();
  startAtPortalAndRelease(cancelled, [0, 1, 7]);
  const undoBeforeCancel = cancelled.undoStack.length;
  assert.strictEqual(cancelled.cancelPortalContinuation(), true);
  assert.strictEqual(cancelled.portalStatus(), null);
  assert.strictEqual(cancelled.selectedLine, -1);
  assert.deepStrictEqual(cancelled.selectedCells, []);
  assert.strictEqual(cancelled.owner[7], -1);
  assert.strictEqual(cancelled.owner[28], -1);
  assert.strictEqual(cancelled.undoStack.length, undoBeforeCancel);
  assert.strictEqual(cancelled.cancelPortalContinuation(), false);

  // Ordinary pointer cancellation keeps legacy abort semantics, including
  // restoration of a completed path that was being redrawn.
  const ordinaryCancel = new GameRunner({
    Width: 5,
    Height: 2,
    Lines: [
      { Start: 0, End: 4 },
      { Start: 5, End: 9 }
    ]
  }, ['#f00', '#0f0']);
  movePath(ordinaryCancel, [0, 1, 2, 3, 4]);
  assert.strictEqual(ordinaryCancel.touchEnd(4), true);
  assert.strictEqual(ordinaryCancel.touchStart(0), true);
  assert.strictEqual(ordinaryCancel.touchMove(1), true);
  assert.strictEqual(ordinaryCancel.handlePointerCancel(), true);
  assert.deepStrictEqual(ordinaryCancel.completedPaths[0], [0, 1, 2, 3, 4]);
  assert.strictEqual(ordinaryCancel.selectedLine, -1);

  // Bidirectional entry: Entering from B (28) and exiting at A (7)
  const bToA = runnerWithPortal();
  movePath(bToA, [0, 6, 12, 18, 24, 25, 26, 27, 28]);
  assertPhase(bToA, 'PORTAL_LOCKED');
  bToA.touchEnd(-1);
  const bWait = assertPhase(bToA, 'PORTAL_WAIT');
  assert.strictEqual(bWait.entry, 28);
  assert.strictEqual(bWait.exit, 7);
  assert.strictEqual(bToA.touchStart(7), true);
  assertPhase(bToA, 'PORTAL_CONTINUE');
  assert.strictEqual(bToA.touchMove(1), true);
  assert.strictEqual(bToA.touchMove(2), true);
  assert.strictEqual(bToA.touchMove(3), true);
  assert.strictEqual(bToA.touchMove(4), true);
  assert.strictEqual(bToA.touchMove(5), true);
  assert.strictEqual(bToA.touchMove(11), true);
  assert.strictEqual(bToA.touchMove(17), true);
  assert.strictEqual(bToA.touchMove(23), true);
  assert.strictEqual(bToA.touchMove(29), true);
  assert.strictEqual(bToA.touchMove(35), true);
  assert.strictEqual(bToA.touchEnd(35), true);
  assert.strictEqual(bToA.completedPaths[0].includes(28), true);
  assert.strictEqual(bToA.completedPaths[0].includes(7), true);

  // Portal exit B unavailable when blocked
  const blockedExitLevel = portalLevel(
    [{ Start: 0, End: 35 }],
    [{ Id: 'P1', A: 7, B: 28 }],
    { Blocked: [28] }
  );
  const blockedExitRunner = new GameRunner(blockedExitLevel, ['#f00']);
  assert.strictEqual(blockedExitRunner.portalAt(7), null, 'portal with blocked exit ignored');

  // Portal exit B unavailable when occupied by another completed line
  const occupiedExitRunner = runnerWithPortal([
    { Start: 0, End: 35 },
    { Start: 2, End: 34 }
  ]);
  occupiedExitRunner.owner[28] = 1; // Simulated completed line 1 occupying B=28
  const portalAt7 = occupiedExitRunner.portalAt(7);
  assert(portalAt7);
  assert.strictEqual(occupiedExitRunner.portalExitAvailable(portalAt7, 0), false);
  assert.strictEqual(occupiedExitRunner.canEnterPortal(portalAt7), false);

  // Now try line 0 moving into A=7 when exit B=28 is occupied
  assert.strictEqual(occupiedExitRunner.touchStart(0), true);
  assert.strictEqual(occupiedExitRunner.touchMove(1), true);
  assert.strictEqual(occupiedExitRunner.touchMove(7), false, 'cannot enter A when B is occupied');

  // Undo in PORTAL_WAIT cancels pending state atomically
  const undoWaitRunner = runnerWithPortal();
  startAtPortalAndRelease(undoWaitRunner, [0, 1, 7]);
  assert.strictEqual(undoWaitRunner.canUndo(), true);
  assert.strictEqual(undoWaitRunner.undo(), true);
  assert.strictEqual(undoWaitRunner.portalStatus(), null);
  assert.strictEqual(undoWaitRunner.selectedLine, -1);
  assert.deepStrictEqual(undoWaitRunner.selectedCells, []);

  // Undo is explicit cancellation and therefore still clears the whole
  // pending portal line even after an exit continuation has started.
  const undoContinueRunner = runnerWithPortal();
  startAtPortalAndRelease(undoContinueRunner, [0, 1, 7]);
  assert.strictEqual(undoContinueRunner.touchStart(28), true);
  assert.strictEqual(undoContinueRunner.touchMove(29), true);
  assert.strictEqual(undoContinueRunner.undo(), true);
  assert.strictEqual(undoContinueRunner.portalStatus(), null);
  assert.strictEqual(undoContinueRunner.selectedLine, -1);
  assert.deepStrictEqual(undoContinueRunner.selectedCells, []);

  // Reset clears all portal state
  const resetRunner = runnerWithPortal();
  startAtPortalAndRelease(resetRunner, [0, 1, 7]);
  resetRunner.reset();
  assert.strictEqual(resetRunner.portalStatus(), null);
  assert.strictEqual(resetRunner.selectedLine, -1);
  assert.deepStrictEqual(resetRunner.selectedCells, []);
  assert.strictEqual(resetRunner.portalPhase, 'READY');
}

module.exports = run;
