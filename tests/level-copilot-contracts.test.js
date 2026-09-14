'use strict';

const assert = require('assert');
const contracts = require('../scripts/level-copilot/contracts.js');

function brief(overrides) {
  return Object.assign({
    schemaVersion: 1,
    mechanic: 'ordinary',
    width: 5,
    height: 5,
    colorCount: 4,
    targetGrade: 2,
    designIntent: 'A clear opening with a small middle-board detour.'
  }, overrides);
}

function candidate(colorCount) {
  return {
    schemaVersion: 1,
    paths: Array.from({ length: colorCount || 4 }, (_, index) => ({ cells: [index, index + 5] })),
    designSummary: 'Short summary.'
  };
}

function code(result) {
  return result.error && result.error.code;
}

function run() {
  assert.strictEqual(contracts.validateBrief(brief()).ok, true);
  assert.strictEqual(contracts.validateBrief(brief({ width: 6, height: 6, colorCount: 6, targetGrade: 3,
    designIntent: '有明显起手，并包含少量绕行。' })).ok, true);
  assert.strictEqual(code(contracts.validateBrief(brief({ schemaVersion: 2 }))), 'BRIEF_SCHEMA_VERSION_UNSUPPORTED');
  assert.strictEqual(code(contracts.validateBrief(brief({ mechanic: 'portal' }))), 'BRIEF_MECHANIC_UNSUPPORTED');
  for (const dimensions of [{ width: 7, height: 7 }, { width: 5, height: 6 }, { width: 5.5, height: 5.5 }]) {
    assert.strictEqual(code(contracts.validateBrief(brief(dimensions))), 'BRIEF_BOARD_SIZE_UNSUPPORTED');
  }
  for (const colorCount of [3, 7, 4.5]) {
    assert.strictEqual(code(contracts.validateBrief(brief({ colorCount }))), 'BRIEF_COLOR_COUNT_INVALID');
  }
  for (const targetGrade of [0, 4, 2.5]) {
    assert.strictEqual(code(contracts.validateBrief(brief({ targetGrade }))), 'BRIEF_TARGET_GRADE_INVALID');
  }
  for (const designIntent of ['', 'bad\nintent', 'x'.repeat(301)]) {
    assert.strictEqual(code(contracts.validateBrief(brief({ designIntent }))), 'BRIEF_INTENT_INVALID');
  }
  const extra = brief(); extra.future = true;
  const extraResult = contracts.validateBrief(extra);
  assert.strictEqual(code(extraResult), 'BRIEF_UNKNOWN_FIELD');
  assert.deepStrictEqual(extraResult.error.details.fields, ['future']);

  const schema = contracts.candidateSchema(brief({ width: 6, height: 6, colorCount: 6 }));
  assert.strictEqual(schema.additionalProperties, false);
  assert.deepStrictEqual(schema.required, ['schemaVersion', 'paths', 'designSummary']);
  assert.deepStrictEqual(schema.properties.designSummary.type, ['string', 'null']);
  assert.strictEqual(schema.properties.paths.minItems, 6);
  assert.strictEqual(schema.properties.paths.maxItems, 6);
  assert.strictEqual(schema.properties.paths.items.additionalProperties, false);
  assert.strictEqual(schema.properties.paths.items.properties.cells.maxItems, 36);
  assert.strictEqual(schema.properties.paths.items.properties.cells.items.maximum, 35);

  assert.strictEqual(contracts.validateCandidateStructure(brief(), candidate()).ok, true);
  assert.strictEqual(contracts.validateCandidateStructure(brief(),
    Object.assign(candidate(), { designSummary: null })).ok, true);
  assert.strictEqual(code(contracts.validateCandidateStructure(brief(), candidate(5))),
    'CANDIDATE_PATH_COUNT_MISMATCH');
  for (const invalid of [
    null,
    { schemaVersion: 2, paths: [] },
    { schemaVersion: 1, paths: 'no' },
    { schemaVersion: 1, paths: candidate().paths },
    Object.assign(candidate(), { unexpected: true }),
    Object.assign(candidate(), { designSummary: 'x'.repeat(241) }),
    Object.assign(candidate(), { paths: [{ cells: [0] }].concat(candidate().paths.slice(1)) }),
    Object.assign(candidate(), { paths: [{ cells: [0, 1], extra: true }].concat(candidate().paths.slice(1)) })
  ]) {
    assert.strictEqual(code(contracts.validateCandidateStructure(brief(), invalid)),
      'CANDIDATE_SCHEMA_INVALID');
  }
}

module.exports = run;
