'use strict';

const BRIEF_FIELDS = [
  'schemaVersion', 'mechanic', 'width', 'height',
  'colorCount', 'targetGrade', 'designIntent'
];
const ORDINARY_CANDIDATE_FIELDS = ['schemaVersion', 'paths', 'designSummary'];
const PORTAL_CANDIDATE_FIELDS = ['schemaVersion', 'portalCells', 'paths', 'designSummary'];
const PATH_FIELDS = ['cells'];
const PORTAL_PATH_FIELDS = ['segments'];
const SEGMENT_FIELDS = ['cells'];
const SUPPORTED_BOARD_SIZES = Object.freeze([
  Object.freeze({ width: 5, height: 5 }),
  Object.freeze({ width: 6, height: 6 }),
  Object.freeze({ width: 7, height: 7 }),
  Object.freeze({ width: 8, height: 8 }),
  Object.freeze({ width: 8, height: 10 })
]);
const MIN_COLOR_COUNT = 4;
const MAX_COLOR_COUNT = 10;

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

function isSupportedBoardSize(width, height) {
  return SUPPORTED_BOARD_SIZES.some(size => size.width === width && size.height === height);
}

function validateBrief(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return result(ERROR_CODES.BRIEF_SCHEMA_VERSION_UNSUPPORTED);
  }
  const unknown = unknownFields(input, BRIEF_FIELDS);
  if (unknown.length) return result(ERROR_CODES.BRIEF_UNKNOWN_FIELD, { fields: unknown });
  if (input.schemaVersion !== 1) return result(ERROR_CODES.BRIEF_SCHEMA_VERSION_UNSUPPORTED);
  if (input.mechanic !== 'ordinary' && input.mechanic !== 'portal') {
    return result(ERROR_CODES.BRIEF_MECHANIC_UNSUPPORTED);
  }
  if (!isSupportedBoardSize(input.width, input.height)) {
    return result(ERROR_CODES.BRIEF_BOARD_SIZE_UNSUPPORTED);
  }
  // Portal authoring reuses the existing exact no-Portal audit, whose supported
  // Portal frontier is currently capped at 8x8. Ordinary 8x10 stays supported.
  if (input.mechanic === 'portal' && input.height > 8) {
    return result(ERROR_CODES.BRIEF_BOARD_SIZE_UNSUPPORTED);
  }
  if (!Number.isInteger(input.colorCount) || input.colorCount < MIN_COLOR_COUNT ||
      input.colorCount > MAX_COLOR_COUNT ||
      input.colorCount * (input.mechanic === 'portal' ? 4 : 2) > input.width * input.height) {
    return result(ERROR_CODES.BRIEF_COLOR_COUNT_INVALID);
  }
  const minimumGrade = input.mechanic === 'portal' ? 2 : 1;
  const maximumGrade = input.mechanic === 'portal' ? 5 : 3;
  if (!Number.isInteger(input.targetGrade) || input.targetGrade < minimumGrade ||
      input.targetGrade > maximumGrade) {
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
  if (brief.mechanic === 'portal') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'portalCells', 'paths', 'designSummary'],
      properties: {
        schemaVersion: { type: 'integer', const: 1 },
        portalCells: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'integer', minimum: 0, maximum: area - 1 }
        },
        paths: {
          type: 'array',
          minItems: brief.colorCount,
          maxItems: brief.colorCount,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['segments'],
            properties: {
              segments: {
                type: 'array',
                minItems: 1,
                maxItems: 2,
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
              }
            }
          }
        },
        designSummary: { type: ['string', 'null'], maxLength: 240 }
      }
    };
  }
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

function portalSeedSchema(brief) {
  const area = brief.width * brief.height;
  const seedPathCount = brief.colorCount - 1;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'paths', 'designSummary'],
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      paths: {
        type: 'array',
        minItems: seedPathCount,
        maxItems: seedPathCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['cells'],
          properties: {
            cells: {
              type: 'array',
              minItems: 4,
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

function generationSchema(brief) {
  return brief.mechanic === 'portal' ? portalSeedSchema(brief) : candidateSchema(brief);
}

function validatePortalSeedStructure(brief, input) {
  if (brief.mechanic !== 'portal') return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
  const seedBrief = Object.assign({}, brief, {
    mechanic: 'ordinary',
    colorCount: brief.colorCount - 1
  });
  return validateCandidateStructure(seedBrief, input);
}

function validateCandidateStructure(brief, input) {
  const portal = brief.mechanic === 'portal';
  const allowedFields = portal ? PORTAL_CANDIDATE_FIELDS : ORDINARY_CANDIDATE_FIELDS;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      unknownFields(input, allowedFields).length || input.schemaVersion !== 1 ||
      !own(input, 'paths') || !Array.isArray(input.paths) || !own(input, 'designSummary')) {
    return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
  }
  if (portal && (!own(input, 'portalCells') || !Array.isArray(input.portalCells) ||
      input.portalCells.length !== 2)) {
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
    if (!portal) {
      if (!path || typeof path !== 'object' || Array.isArray(path) ||
          unknownFields(path, PATH_FIELDS).length || !Array.isArray(path.cells) ||
          path.cells.length < 2 || path.cells.length > brief.width * brief.height) {
        return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
      }
      continue;
    }
    if (!path || typeof path !== 'object' || Array.isArray(path) ||
        unknownFields(path, PORTAL_PATH_FIELDS).length || !Array.isArray(path.segments) ||
        path.segments.length < 1 || path.segments.length > 2) {
      return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
    }
    for (const segment of path.segments) {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment) ||
          unknownFields(segment, SEGMENT_FIELDS).length || !Array.isArray(segment.cells) ||
          segment.cells.length < 2 || segment.cells.length > brief.width * brief.height) {
        return result(ERROR_CODES.CANDIDATE_SCHEMA_INVALID);
      }
    }
  }
  return { ok: true, value: input };
}

module.exports = {
  ERROR_CODES,
  SUPPORTED_BOARD_SIZES,
  MIN_COLOR_COUNT,
  MAX_COLOR_COUNT,
  isSupportedBoardSize,
  validateBrief,
  candidateSchema,
  generationSchema,
  portalSeedSchema,
  validateCandidateStructure,
  validatePortalSeedStructure
};
