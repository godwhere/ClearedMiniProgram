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

function portalCandidate(colorCount) {
  return {
    schemaVersion: 1,
    portalCells: [1, 8],
    paths: Array.from({ length: colorCount || 4 }, (_, index) => ({
      segments: [{ cells: [index * 4, index * 4 + 1] }]
    })),
    designSummary: null
  };
}

function code(result) {
  return result.error && result.error.code;
}

function run() {
  assert.strictEqual(contracts.validateBrief(brief()).ok, true);
  for (const dimensions of [
    { width: 6, height: 6, colorCount: 6 },
    { width: 7, height: 7, colorCount: 7 },
    { width: 8, height: 8, colorCount: 8 },
    { width: 8, height: 10, colorCount: 10 }
  ]) {
    assert.strictEqual(contracts.validateBrief(brief(Object.assign({}, dimensions, {
      targetGrade: 3, designIntent: '有明显起手，并包含少量绕行。'
    }))).ok, true);
  }
  assert.strictEqual(code(contracts.validateBrief(brief({ schemaVersion: 2 }))), 'BRIEF_SCHEMA_VERSION_UNSUPPORTED');
  assert.strictEqual(contracts.validateBrief(brief({
    mechanic: 'portal', width: 8, height: 8, colorCount: 6, targetGrade: 4
  })).ok, true);
  const portalEightByTen = contracts.validateBrief(brief({
    mechanic: 'portal', width: 8, height: 10, colorCount: 8, targetGrade: 3
  }));
  assert.strictEqual(portalEightByTen.ok, true);
  assert.strictEqual(portalEightByTen.value.portalCellCount, 2);
  assert.strictEqual(contracts.validateBrief(brief({
    mechanic: 'portal', width: 8, height: 10, colorCount: 8, targetGrade: 4,
    portalCellCount: 4
  })).ok, true);
  for (const portalCellCount of [1, 3, 5, 6, 4.5]) {
    assert.strictEqual(code(contracts.validateBrief(brief({
      mechanic: 'portal', width: 8, height: 10, colorCount: 8, targetGrade: 3,
      portalCellCount
    }))), 'BRIEF_PORTAL_CELL_COUNT_INVALID');
  }
  assert.strictEqual(code(contracts.validateBrief(brief({ portalCellCount: 2 }))),
    'BRIEF_PORTAL_CELL_COUNT_INVALID');
  assert.strictEqual(code(contracts.validateBrief(brief({ mechanic: 'ice' }))),
    'BRIEF_MECHANIC_UNSUPPORTED');
  for (const dimensions of [
    { width: 5, height: 6 }, { width: 7, height: 8 }, { width: 8, height: 9 },
    { width: 10, height: 8 }, { width: 5.5, height: 5.5 }
  ]) {
    assert.strictEqual(code(contracts.validateBrief(brief(dimensions))), 'BRIEF_BOARD_SIZE_UNSUPPORTED');
  }
  for (const colorCount of [3, 11, 4.5]) {
    assert.strictEqual(code(contracts.validateBrief(brief({ colorCount }))), 'BRIEF_COLOR_COUNT_INVALID');
  }
  for (const targetGrade of [0, 4, 2.5]) {
    assert.strictEqual(code(contracts.validateBrief(brief({ targetGrade }))), 'BRIEF_TARGET_GRADE_INVALID');
  }
  for (const targetGrade of [1, 6, 2.5]) {
    assert.strictEqual(code(contracts.validateBrief(brief({
      mechanic: 'portal', width: 8, height: 8, colorCount: 6, targetGrade
    }))), 'BRIEF_TARGET_GRADE_INVALID');
  }
  assert.strictEqual(code(contracts.validateBrief(brief({
    mechanic: 'portal', width: 5, height: 5, colorCount: 7, targetGrade: 2
  }))), 'BRIEF_COLOR_COUNT_INVALID');
  for (const designIntent of ['', 'bad\nintent', 'x'.repeat(301)]) {
    assert.strictEqual(code(contracts.validateBrief(brief({ designIntent }))), 'BRIEF_INTENT_INVALID');
  }
  const extra = brief(); extra.future = true;
  const extraResult = contracts.validateBrief(extra);
  assert.strictEqual(code(extraResult), 'BRIEF_UNKNOWN_FIELD');
  assert.deepStrictEqual(extraResult.error.details.fields, ['future']);

  const schema = contracts.candidateSchema(brief({ width: 8, height: 10, colorCount: 10 }));
  assert.strictEqual(schema.additionalProperties, false);
  assert.deepStrictEqual(schema.required, ['schemaVersion', 'paths', 'designSummary']);
  assert.deepStrictEqual(schema.properties.designSummary.type, ['string', 'null']);
  assert.strictEqual(schema.properties.paths.minItems, 10);
  assert.strictEqual(schema.properties.paths.maxItems, 10);
  assert.strictEqual(schema.properties.paths.items.additionalProperties, false);
  assert.strictEqual(schema.properties.paths.items.properties.cells.maxItems, 80);
  assert.strictEqual(schema.properties.paths.items.properties.cells.items.maximum, 79);

  const portalBrief = brief({
    mechanic: 'portal', width: 8, height: 8, colorCount: 4, targetGrade: 4
  });
  const portalSchema = contracts.candidateSchema(portalBrief);
  assert.deepStrictEqual(portalSchema.required,
    ['schemaVersion', 'portalCells', 'paths', 'designSummary']);
  assert.strictEqual(portalSchema.properties.portalCells.minItems, 2);
  assert.strictEqual(portalSchema.properties.portalCells.maxItems, 2);
  assert.strictEqual(portalSchema.properties.paths.items.properties.segments.maxItems, 2);
  assert.strictEqual(portalSchema.properties.paths.items.properties.segments.items
    .properties.cells.maxItems, 64);
  const portalGenerationSchema = contracts.generationSchema(portalBrief);
  assert.deepStrictEqual(portalGenerationSchema.required,
    ['schemaVersion', 'paths', 'designSummary']);
  assert.strictEqual(portalGenerationSchema.properties.paths.minItems, 3);
  assert.strictEqual(portalGenerationSchema.properties.paths.maxItems, 3);
  assert.strictEqual(portalGenerationSchema.properties.paths.items.properties.cells.minItems, 4);
  assert.strictEqual(portalGenerationSchema.properties.portalCells, undefined);
  assert.strictEqual(contracts.validateCandidateStructure(portalBrief, portalCandidate()).ok, true);
  assert.strictEqual(code(contracts.validateCandidateStructure(portalBrief,
    Object.assign(portalCandidate(), { portalCells: [1] }))), 'CANDIDATE_SCHEMA_INVALID');
  const fourGateBrief = Object.assign({}, portalBrief, {
    width: 8, height: 10, colorCount: 6, portalCellCount: 4
  });
  const fourGateSchema = contracts.candidateSchema(fourGateBrief);
  assert.strictEqual(fourGateSchema.properties.portalCells.minItems, 4);
  assert.strictEqual(fourGateSchema.properties.portalCells.maxItems, 4);
  const fourGateGenerationSchema = contracts.generationSchema(fourGateBrief);
  assert.strictEqual(fourGateGenerationSchema.properties.paths.minItems, 4);
  assert.strictEqual(fourGateGenerationSchema.properties.paths.maxItems, 4);
  const malformedPortalPath = portalCandidate();
  malformedPortalPath.paths[0] = { cells: [0, 1] };
  assert.strictEqual(code(contracts.validateCandidateStructure(portalBrief, malformedPortalPath)),
    'CANDIDATE_SCHEMA_INVALID');

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
