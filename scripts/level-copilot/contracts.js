'use strict';

const BRIEF_FIELDS = [
  'schemaVersion', 'mechanic', 'width', 'height',
  'colorCount', 'targetGrade', 'designIntent'
];
const CANDIDATE_FIELDS = ['schemaVersion', 'paths', 'designSummary'];
const PATH_FIELDS = ['cells'];

const ERROR_CODES = Object.freeze({
  BRIEF_SCHEMA_VERSION_UNSUPPORTED: 'BRIEF_SCHEMA_VERSION_UNSUPPORTED',
  BRIEF_MECHANIC_UNSUPPORTED: 'BRIEF_MECHANIC_UNSUPPORTED',
  BRIEF_BOARD_SIZE_UNSUPPORTED: 'BRIEF_BOARD_SIZE_UNSUPPORTED',
  BRIEF_COLOR_COUNT_INVALID: 'BRIEF_COLOR_COUNT_INVALID',
  BRIEF_TARGET_GRADE_INVALID: 'BRIEF_TARGET_GRADE_INVALID',
  BRIEF_INTENT_INVALID: 'BRIEF_INTENT_INVALID',
  BRIEF_UNKNOWN_FIELD: 'BRIEF_UNKNOWN_FIELD',
  CANDIDATE_SCHEMA_INVALID: 'CANDIDATE_SCHEMA_INVALID',
  CANDIDATE_PATH_COUNT_MISMATCH: 'CANDIDATE_PATH_COUNT_MISMATCH'
});

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function result(code, details) {
  return { ok: false, error: { code, details: details || null } };
}

function unknownFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter(key => allowed.indexOf(key) < 0).sort();
}

function validateBrief(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return result(ERROR_CODES.BRIEF_SCHEMA_VERSION_UNSUPPORTED);
  }
  const unknown = unknownFields(input, BRIEF_FIELDS);
  if (unknown.length) return result(ERROR_CODES.BRIEF_UNKNOWN_FIELD, { fields: unknown });
  if (input.schemaVersion !== 1) return result(ERROR_CODES.BRIEF_SCHEMA_VERSION_UNSUPPORTED);
  if (input.mechanic !== 'ordinary') return result(ERROR_CODES.BRIEF_MECHANIC_UNSUPPORTED);
  if ((input.width !== 5 && input.width !== 6) || input.height !== input.width) {
    return result(ERROR_CODES.BRIEF_BOARD_SIZE_UNSUPPORTED);
  }
  if (!Number.isInteger(input.colorCount) || input.colorCount < 4 || input.colorCount > 6 ||
      input.colorCount * 2 > input.width * input.height) {
    return result(ERROR_CODES.BRIEF_COLOR_COUNT_INVALID);
  }
  if (!Number.isInteger(input.targetGrade) || input.targetGrade < 1 || input.targetGrade > 3) {
    return result(ERROR_CODES.BRIEF_TARGET_GRADE_INVALID);
  }
  const intentLength = typeof input.designIntent === 'string'
    ? Array.from(input.designIntent).length : 0;
  if (!intentLength || intentLength > 300 || /[\u0000-\u001f\u007f-\u009f]/.test(input.designIntent)) {
    return result(ERROR_CODES.BRIEF_INTENT_INVALID);
  }
  const value = {};
  BRIEF_FIELDS.forEach(field => { value[field] = input[field]; });
  return { ok: true, value };
}

function candidateSchema(brief) {
  const area = brief.width * brief.height;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'paths', 'designSummary'],
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      paths: {
        type: 'array',
        minItems: brief.colorCount,
        maxItems: brief.colorCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['cells'],
          properties: {
            cells: {
              type: 'array',
              minItems: 2,
              maxItems: area,
              items: { type: 'integer', minimum: 0, maximum: area - 1 }
            }
          }
        }
      },
      designSummary: { type: ['string', 'null'], maxLength: 240 }
    }
  };
}

function validateCandidateStructure(brief, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      unknownFields(input, CANDIDATE_FIELDS).length || input.schemaVersion !== 1 ||
      !own(input, 'paths') || !Array.isArray(input.paths) || !own(input, 'designSummary')) {
    return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
  }
  if (input.paths.length !== brief.colorCount) {
    return result(ERROR_CODES.CANDIDATE_PATH_COUNT_MISMATCH, {
      expected: brief.colorCount,
      actual: input.paths.length
    });
  }
  if (input.designSummary !== null &&
      (typeof input.designSummary !== 'string' || Array.from(input.designSummary).length > 240 ||
       /[\u0000-\u001f\u007f-\u009f]/.test(input.designSummary))) {
    return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
  }
  for (const path of input.paths) {
    if (!path || typeof path !== 'object' || Array.isArray(path) ||
        unknownFields(path, PATH_FIELDS).length || !Array.isArray(path.cells) ||
        path.cells.length < 2 || path.cells.length > brief.width * brief.height) {
      return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
    }
  }
  return { ok: true, value: input };
}

module.exports = {
  ERROR_CODES,
  validateBrief,
  candidateSchema,
  validateCandidateStructure
};
