const assert = require('assert');
const InteractionMap = require('../src/ui/board/interaction-map.js');

function run() {
  const map = new InteractionMap();
  assert.deepStrictEqual(map.hits, []);
  assert.strictEqual(map.getBoardLayout(), null);
  assert.strictEqual(map.hitTest(0, 0), null);
  assert.strictEqual(map.cellAt(0, 0), -1);

  const lowerRect = { x: 10, y: 20, w: 50, h: 40 };
  assert.strictEqual(map.add('lower', lowerRect), true);
  lowerRect.x = 999;
  assert.strictEqual(map.add('disabled', { x: 0, y: 0, w: 100, h: 100 }, false), false);
  assert.strictEqual(map.add('upper', { x: 20, y: 25, w: 10, h: 10 }), true);
  assert.strictEqual(map.hitTest(25, 30), 'upper', 'last added hit wins overlaps');
  assert.strictEqual(map.hitTest(10, 20), 'lower', 'hit rectangles are copied on add');
  assert.strictEqual(map.hitTest(61, 20), null);

  const sourceLayout = { x: 10, y: 20, cell: 30, cols: 3, rows: 2 };
  assert.deepStrictEqual(map.setBoardLayout(sourceLayout), sourceLayout);
  sourceLayout.x = 500;
  const returnedLayout = map.getBoardLayout();
  returnedLayout.y = 500;
  assert.deepStrictEqual(map.getBoardLayout(), { x: 10, y: 20, cell: 30, cols: 3, rows: 2 },
    'layout input and query results do not expose mutable map state');
  assert.strictEqual(map.cellAt(11, 21), 0);
  assert.strictEqual(map.cellAt(99, 79), 5);
  assert.strictEqual(map.cellAt(100, 79), -1);
  assert.strictEqual(map.cellAt(99, 80), -1);

  map.clearHits();
  assert.deepStrictEqual(map.hits, []);
  assert.deepStrictEqual(map.getBoardLayout(), { x: 10, y: 20, cell: 30, cols: 3, rows: 2 },
    'clearing transient UI hits preserves board input geometry until the next frame');

  assert.strictEqual(map.setBoardLayout({ x: 0, y: 0, cell: 0, cols: 3, rows: 2 }), null);
  assert.strictEqual(map.cellAt(11, 21), -1);
  map.setBoardLayout({ x: 0, y: 0, cell: 10, cols: 2, rows: 2 });
  map.clear();
  assert.deepStrictEqual(map.hits, []);
  assert.strictEqual(map.getBoardLayout(), null);
}

module.exports = run;
