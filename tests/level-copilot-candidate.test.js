'use strict';

const assert = require('assert');
const tools = require('../scripts/level-copilot/candidate.js');

const brief = {
  schemaVersion: 1,
  mechanic: 'ordinary',
  width: 5,
  height: 5,
  colorCount: 5,
  targetGrade: 1,
  designIntent: 'Fixture.'
};

function cover() {
  return {
    schemaVersion: 1,
    designSummary: null,
    paths: Array.from({ length: 5 }, (_, row) => ({
      cells: Array.from({ length: 5 }, (_, column) => row * 5 + (row % 2 ? 4 - column : column))
    }))
  };
}

function changed(mutator) {
  const value = cover();
  mutator(value);
  return value;
}

function code(value) {
  const result = tools.validatePathCover(brief, value);
  return result.error && result.error.code;
}

function transformed(level, transform) {
  return {
    Width: level.Width,
    Height: level.Height,
    Lines: level.Lines.slice().reverse().map(line => ({
      Start: tools.transformCell(line.End, level.Width, level.Height, transform),
      End: tools.transformCell(line.Start, level.Width, level.Height, transform)
    }))
  };
}

function run() {
  assert.strictEqual(tools.validatePathCover(brief, cover()).ok, true);
  assert.strictEqual(code(changed(value => { value.paths[0].cells[1] = 1.5; })),
    'CANDIDATE_CELL_OUT_OF_RANGE');
  assert.strictEqual(code(changed(value => { value.paths[0].cells[1] = 25; })),
    'CANDIDATE_CELL_OUT_OF_RANGE');
  assert.strictEqual(code(changed(value => { value.paths[0].cells[2] = 1; })),
    'CANDIDATE_CELL_DUPLICATE');
  assert.strictEqual(code(changed(value => { value.paths[1].cells[0] = 0; })),
    'CANDIDATE_CELL_DUPLICATE');
  assert.strictEqual(code(changed(value => { [value.paths[0].cells[1], value.paths[0].cells[2]] =
    [value.paths[0].cells[2], value.paths[0].cells[1]]; })), 'CANDIDATE_STEP_NON_ADJACENT');
  assert.strictEqual(code(changed(value => { value.paths[4].cells.pop(); })),
    'CANDIDATE_COVERAGE_MISSING');

  const compiled = tools.compileCandidate(brief, cover());
  assert.deepStrictEqual(compiled.level.Lines[0], { Start: 0, End: 4 });
  assert.deepStrictEqual(compiled.level.Lines[1], { Start: 9, End: 5 });
  assert.deepStrictEqual(compiled.solution[2], [10, 11, 12, 13, 14]);
  const originalKey = tools.layoutKey(compiled.level);
  for (let transform = 0; transform < 8; transform += 1) {
    assert.strictEqual(tools.layoutKey(transformed(compiled.level, transform)), originalKey);
  }
  assert.strictEqual(tools.transformCell(4, 5, 1),
    tools.transformCell(4, 5, 5, 1), 'the square helper shorthand remains compatible');
  const different = JSON.parse(JSON.stringify(compiled.level));
  different.Lines[0].End = 3;
  assert.notStrictEqual(tools.layoutKey(different), originalKey);

  const rectangular = {
    Width: 8,
    Height: 10,
    Lines: Array.from({ length: 10 }, (_, row) => ({
      Start: row * 8,
      End: row * 8 + 7
    }))
  };
  const rectangularKey = tools.layoutKey(rectangular);
  for (let transform = 0; transform < 4; transform += 1) {
    assert.strictEqual(tools.layoutKey(transformed(rectangular, transform)), rectangularKey);
  }
  assert(rectangularKey.startsWith('8x10:'));
  assert.throws(() => tools.transformCell(0, 8, 10, 4), /rectangular transform/);
  assert.throws(() => tools.layoutKey({ Width: 8, Height: 10,
    Lines: [{ Start: 0, End: 80 }] }), /rectangular level/);
}

module.exports = run;
