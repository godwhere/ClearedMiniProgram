const assert = require('assert');
const GameRunner = require('../core/game-runner.js');
const catalog = require('../data/catalog.js');

function level(width, height, lines) {
  return { Width: width, Height: height, Lines: lines };
}

function connect(runner, cells) {
  assert.strictEqual(runner.touchStart(cells[0]), true);
  cells.slice(1).forEach(cell => assert.strictEqual(runner.touchMove(cell), true));
  return runner.touchEnd(cells[cells.length - 1]);
}

function run() {
  const training = new GameRunner(level(5, 1, [{ Start: 0, End: 4 }]), ['#f00']);
  assert.strictEqual(connect(training, [0, 1, 2, 3, 4]), true);
  assert.strictEqual(training.isGameOver, true);
  assert.strictEqual(training.outcome, GameRunner.OUTCOME.WON);
  assert.strictEqual(training.isTerminal(), true);
  assert.deepStrictEqual(training.owner, [0, 0, 0, 0, 0]);
  assert.deepStrictEqual(training.completedPaths[0], [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(training.snapshot(), {
    completedPaths: [[0, 1, 2, 3, 4]]
  }, 'ordinary snapshot shape does not leak terminal fields');

  const boundary = new GameRunner(level(5, 2, [{ Start: 4, End: 5 }]), ['#f00']);
  assert.strictEqual(boundary.adjacent(4, 5), false, 'row edges must not wrap');
  assert.strictEqual(boundary.touchStart(10), false);
  assert.strictEqual(boundary.touchStart(NaN), false);
  assert.strictEqual(boundary.touchStart(4.5), false);
  assert.strictEqual(boundary.touchStart(4), true);
  assert.strictEqual(boundary.touchMove(11), false);
  assert.strictEqual(boundary.touchMove(NaN), false);
  assert.strictEqual(boundary.touchMove(5), false);
  boundary.cancelSelection();

  const board = new GameRunner(level(3, 2, [
    { Start: 0, End: 2 },
    { Start: 3, End: 5 }
  ]), ['#f00', '#0f0']);
  assert.strictEqual(board.touchStart(0), true);
  assert.strictEqual(board.touchMove(3), false, 'foreign endpoint must block a path');
  assert.strictEqual(board.touchMove(1), true);
  assert.strictEqual(board.touchMove(2), true);
  assert.strictEqual(board.touchEnd(2), true);
  assert.strictEqual(board.isGameOver, false);
  assert.strictEqual(board.touchStart(3), true);
  assert.strictEqual(board.touchMove(0), false, 'completed cells must block other paths');
  board.cancelSelection();

  const unfilled = new GameRunner(level(3, 2, [
    { Start: 0, End: 1 },
    { Start: 3, End: 4 }
  ]), ['#f00', '#0f0']);
  assert.strictEqual(connect(unfilled, [0, 1]), true);
  assert.strictEqual(unfilled.outcome, GameRunner.OUTCOME.PLAYING,
    'one completed line must not fail early');
  assert.strictEqual(connect(unfilled, [3, 4]), true);
  assert.strictEqual(unfilled.outcome, GameRunner.OUTCOME.FAILED);
  assert.strictEqual(unfilled.failureReason, 'unfilled-cells');
  assert.strictEqual(unfilled.remainingCellCount(), 2);
  assert.strictEqual(unfilled.remainingPlayableCells, 2);
  assert.strictEqual(unfilled.isGameOver, false, 'legacy isGameOver remains win-only');
  assert.strictEqual(unfilled.isTerminal(), true);
  const failedElapsed = unfilled.elapsedMs();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2000;
    assert.strictEqual(unfilled.elapsedMs(), failedElapsed, 'failed timer is frozen');
  } finally {
    Date.now = realNow;
  }
  assert.strictEqual(unfilled.touchStart(0), false, 'failed board rejects new input');
  assert.strictEqual(unfilled.undo(), false, 'failed board can only be restarted');
  unfilled.reset();
  assert.strictEqual(unfilled.outcome, GameRunner.OUTCOME.PLAYING);
  assert.strictEqual(unfilled.failureReason, null);
  assert.strictEqual(unfilled.isTerminal(), false);
  assert.strictEqual(unfilled.remainingPlayableCells, 0);

  const blockedFailure = new GameRunner(level(3, 2, [
    { Start: 0, End: 1 }
  ]), ['#f00'], null, { blocked: [2, 3, 3, -1, 99] });
  assert.strictEqual(connect(blockedFailure, [0, 1]), true);
  assert.strictEqual(blockedFailure.outcome, GameRunner.OUTCOME.FAILED);
  assert.strictEqual(blockedFailure.remainingCellCount(), 2,
    'remaining count excludes normalized blocked cells');

  const blockedRelease = new GameRunner(level(3, 2, [
    { Start: 0, End: 2 },
    { Start: 3, End: 5 }
  ]), ['#f00', '#0f0']);
  blockedRelease.touchStart(0);
  blockedRelease.touchMove(1);
  blockedRelease.touchMove(2);
  assert.strictEqual(blockedRelease.touchEnd(5), false, 'lifting on a blocked cell must not complete');

  blockedRelease.touchStart(0);
  blockedRelease.touchMove(1);
  blockedRelease.touchMove(2);
  assert.strictEqual(blockedRelease.touchEnd(6), false, 'out-of-range release must not complete');

  const backtrack = new GameRunner(level(3, 2, [{ Start: 0, End: 2 }]), ['#f00']);
  backtrack.touchStart(0);
  [1, 4, 5].forEach(cell => backtrack.touchMove(cell));
  assert.deepStrictEqual(backtrack.selectedCells, [0, 1, 4, 5]);
  assert.strictEqual(backtrack.touchMove(4), true);
  assert.deepStrictEqual(backtrack.selectedCells, [0, 1, 4]);
  backtrack.cancelSelection();

  const redraw = new GameRunner(level(3, 2, [
    { Start: 0, End: 2 },
    { Start: 3, End: 5 }
  ]), ['#f00', '#0f0']);
  connect(redraw, [0, 1, 2]);
  assert.deepStrictEqual(redraw.completedPaths[0], [0, 1, 2]);
  redraw.touchStart(0);
  redraw.touchEnd(0);
  assert.strictEqual(redraw.completedPaths[0], null, 'invalid redraw leaves the old path cleared');
  assert.strictEqual(redraw.canUndo(), true, 'clearing a path is undoable');
  assert.strictEqual(redraw.undo(), true);
  assert.deepStrictEqual(redraw.completedPaths[0], [0, 1, 2]);

  redraw.touchStart(0);
  redraw.touchMove(1);
  const undoDepthBeforeAbort = redraw.undoStack.length;
  assert.strictEqual(redraw.abortSelection(), true);
  assert.deepStrictEqual(redraw.completedPaths[0], [0, 1, 2], 'system abort restores a cleared path');
  assert.strictEqual(redraw.undoStack.length, undoDepthBeforeAbort, 'system abort must not create an undo action');

  const undo = new GameRunner(level(3, 2, [
    { Start: 0, End: 2 },
    { Start: 3, End: 5 }
  ]), ['#f00', '#0f0']);
  connect(undo, [0, 1, 2]);
  assert.strictEqual(undo.filledCount(), 3);
  assert.strictEqual(undo.undo(), true);
  assert.strictEqual(undo.filledCount(), 0);

  // Optional blocked cells are generic runner configuration and must not
  // alter the legacy three-argument constructor behaviour.
  const blocked = new GameRunner(level(3, 2, [
    { Start: 0, End: 1 },
    { Start: 2, End: 5 }
  ]), ['#f00', '#0f0'], null, { blocked: [3, 4] });
  assert.deepStrictEqual(blocked.blockedMask, [false, false, false, true, true, false]);
  assert.deepStrictEqual(blocked.fixedLine, [0, 0, 1, -1, -1, 1]);
  assert.strictEqual(blocked.isPlayableCell(3), false);
  assert.strictEqual(blocked.isPlayableCell(0), true);
  assert.strictEqual(blocked.touchStart(3), false, 'blocked cells cannot start a path');
  assert.strictEqual(blocked.touchStart(0), true);
  assert.strictEqual(blocked.touchMove(3), false, 'blocked cells cannot be traversed');
  assert.strictEqual(blocked.touchEnd(3), false, 'blocked release cancels the selection');
  assert.strictEqual(blocked.selectedLine, -1);
  assert.strictEqual(blocked.restore({ completedPaths: [[0, 3], null] }), false,
    'snapshots containing blocked cells are rejected');
  assert.strictEqual(blocked.owner[3], -1);

  assert.strictEqual(connect(blocked, [0, 1]), true);
  assert.strictEqual(connect(blocked, [2, 5]), true);
  assert.strictEqual(blocked.isGameOver, true, 'completion ignores blocked cells');
  assert.strictEqual(blocked.outcome, GameRunner.OUTCOME.WON);
  assert.deepStrictEqual(blocked.owner, [0, 0, 1, -1, -1, 1]);
  assert.strictEqual(blocked.filledCount(), 4, 'filledCount excludes blocked cells');

  let levels = 0;
  catalog.sets.forEach(set => {
    (set.Games || []).forEach(game => {
      levels++;
      const endpoints = {};
      (game.Lines || []).forEach(line => {
        [line.Start, line.End].forEach(index => {
          assert(index >= 0 && index < game.Width * game.Height);
          assert.strictEqual(endpoints[index], undefined, 'endpoints must be unique');
          endpoints[index] = true;
        });
      });
    });
  });
  assert.deepStrictEqual(catalog.sets.map(set => (set.Games || []).length), [2, 10, 20, 30, 30, 30]);
  assert.strictEqual(levels, 122);
}

module.exports = run;
