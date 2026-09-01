const assert = require('assert');
const BoardInputController = require('../src/gameplay/board-input-controller.js');
const InteractionMap = require('../src/ui/board/interaction-map.js');

function result(overrides) {
  return Object.assign({
    changed: false,
    status: 'ignored',
    phase: 'READY',
    expectedExit: null,
    expectedExits: [],
    commit: null,
    outcome: 'playing'
  }, overrides || {});
}

function point(cell, id) {
  return { x: cell * 100 + 50, y: 50, id };
}

function locator() {
  const map = new InteractionMap();
  map.setBoardLayout({ x: 0, y: 0, cell: 100, cols: 5, rows: 1 });
  return map;
}

function run() {
  const ordinaryCalls = [];
  const commit = {
    lineIndex: 0,
    cells: [0, 1, 2, 3, 4],
    segments: [[0, 1, 2, 3, 4]],
    teleports: []
  };
  const ordinaryRunner = {
    startGesture(cell) {
      ordinaryCalls.push(['start', cell]);
      return result({ changed: true, status: 'drawing', phase: 'DRAWING' });
    },
    moveGesture(cell) {
      ordinaryCalls.push(['move', cell]);
      return result({ changed: true, status: 'drawing', phase: 'DRAWING' });
    },
    endGesture(cell) {
      ordinaryCalls.push(['end', cell]);
      return result({ changed: true, status: 'completed', phase: 'READY', commit, outcome: 'won' });
    },
    cancelGesture(reason) {
      ordinaryCalls.push(['cancel', reason]);
      return result({ changed: true, status: 'cancelled', phase: 'READY' });
    }
  };
  const ordinary = new BoardInputController(ordinaryRunner, locator());
  assert.deepStrictEqual(ordinary.start(point(0, 1)).map(event => event.type), ['selection-started']);
  assert.strictEqual(ordinary.isActive(), true);
  assert.deepStrictEqual(ordinary.move(point(4, 2)), [], 'a second pointer cannot move the board gesture');
  const moveEvents = ordinary.move(point(4, 1));
  assert.deepStrictEqual(moveEvents.map(event => event.type), ['step']);
  assert.strictEqual(moveEvents[0].count, 4,
    'one pointer dispatch emits one feedback event while retaining its sampled step count');
  assert.deepStrictEqual(ordinaryCalls.filter(call => call[0] === 'move').map(call => call[1]), [1, 2, 3, 4],
    '0.32-cell sampling visits every crossed cell during a large move');
  const endEvents = ordinary.end(point(4, 1));
  assert.deepStrictEqual(endEvents.map(event => event.type), ['path-completed']);
  assert.strictEqual(endEvents[0].commit, commit);
  assert.strictEqual(endEvents[0].outcome, 'won');
  assert.deepStrictEqual(ordinaryCalls[ordinaryCalls.length - 1], ['end', 4]);
  assert.strictEqual(ordinary.isActive(), false);

  const portalMoves = [];
  const portalRunner = {
    startGesture() {
      return result({ changed: true, status: 'drawing', phase: 'DRAWING' });
    },
    moveGesture(cell) {
      portalMoves.push(cell);
      return result({
        changed: true,
        status: 'drawing',
        phase: cell === 2 ? 'PORTAL_LOCKED' : 'DRAWING',
        expectedExit: cell === 2 ? 4 : null,
        expectedExits: cell === 2 ? [3, 4] : []
      });
    },
    endGesture(cell) {
      assert.strictEqual(cell, 4, 'release coordinate is forwarded after locking at the entry');
      return result({
        changed: true,
        status: 'portal-wait',
        phase: 'PORTAL_WAIT',
        expectedExit: 4,
        expectedExits: [3, 4]
      });
    },
    cancelGesture() {
      return result({ changed: true, status: 'cancelled' });
    }
  };
  const portal = new BoardInputController(portalRunner, locator());
  portal.start(point(0, 3));
  const portalStep = portal.move(point(4, 3));
  assert.deepStrictEqual(portalStep.map(event => event.type), ['step']);
  assert.strictEqual(portalStep[0].count, 2);
  assert.deepStrictEqual(portalMoves, [1, 2], 'sampling stops immediately at PORTAL_LOCKED');
  assert.deepStrictEqual(portal.move(point(3, 3)), []);
  assert.deepStrictEqual(portalMoves, [1, 2], 'later moves remain inert until the locked pointer is released');
  const waitEvents = portal.end(point(4, 3));
  assert.deepStrictEqual(waitEvents.map(event => event.type), ['portal-wait']);
  assert.strictEqual(waitEvents[0].expectedExit, 4);
  assert.deepStrictEqual(waitEvents[0].expectedExits, [3, 4]);
  waitEvents[0].expectedExits.push(99);
  assert.deepStrictEqual(portalRunner.endGesture(4).expectedExits, [3, 4],
    'controller events copy candidate exit arrays');

  let invalidStarts = 0;
  const invalid = new BoardInputController({
    startGesture(cell) {
      invalidStarts += 1;
      assert.strictEqual(cell, -1);
      return result();
    }
  }, locator());
  assert.deepStrictEqual(invalid.start({ x: -10, y: 50, id: 4 }).map(event => event.type),
    ['invalid-selection']);
  assert.strictEqual(invalidStarts, 1);
  assert.strictEqual(invalid.isActive(), false);

  const cancelledReasons = [];
  const cancellable = new BoardInputController({
    startGesture() {
      return result({ changed: true, status: 'drawing', phase: 'DRAWING' });
    },
    moveGesture() { return result(); },
    endGesture() { return result(); },
    cancelGesture(reason) {
      cancelledReasons.push(reason);
      return result({ changed: true, status: 'cancelled', phase: 'READY' });
    }
  }, locator());
  cancellable.start(point(0, 7));
  assert.deepStrictEqual(cancellable.cancel(point(0, 8)), [], 'a second pointer cannot cancel the active gesture');
  assert.strictEqual(cancellable.isActive(), true);
  assert.deepStrictEqual(cancellable.cancel(point(0, 7)).map(event => event.type), ['cancelled']);
  assert.deepStrictEqual(cancelledReasons, ['pointer-cancel']);
  assert.strictEqual(cancellable.isActive(), false);

  cancellable.start(point(0, 9));
  assert.deepStrictEqual(cancellable.cancel(null, 'navigation').map(event => event.type), ['cancelled']);
  assert.deepStrictEqual(cancelledReasons, ['pointer-cancel', 'navigation']);

  const unmoved = new BoardInputController({
    startGesture() {
      return result({ changed: true, status: 'drawing', phase: 'DRAWING' });
    },
    moveGesture() { return result(); },
    endGesture(cell) {
      assert.strictEqual(cell, 0);
      return result({ changed: true, status: 'cancelled', phase: 'READY' });
    }
  }, locator());
  unmoved.start(point(0, 11));
  assert.deepStrictEqual(unmoved.end(point(0, 11)).map(event => event.type), ['invalid-selection'],
    'an unmoved release remains player-visible invalid selection feedback');

  const wrongExit = new BoardInputController({
    startGesture() {
      return result({ changed: true, status: 'cancelled', phase: 'READY' });
    }
  }, locator());
  assert.deepStrictEqual(wrongExit.start(point(1, 10)).map(event => event.type), ['cancelled']);
  assert.strictEqual(wrongExit.isActive(), false, 'a rejected portal exit never captures the pointer');
}

module.exports = run;
