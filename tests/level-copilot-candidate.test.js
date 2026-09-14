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
      Start: tools.transformCell(line.End, level.Width, transform),
      End: tools.transformCell(line.Start, level.Width, transform)
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
  const different = JSON.parse(JSON.stringify(compiled.level));
  different.Lines[0].End = 3;
  assert.notStrictEqual(tools.layoutKey(different), originalKey);
  assert.throws(() => tools.layoutKey({ Width: 5, Height: 6, Lines: [] }), /square/);
}

module.exports = run;
