'use strict';

const assert = require('assert');
const portalValidation = require('../core/portal-validation.js');

const {
  validatePortals,
  validatePortalLevel,
  validatePortalSolution,
  normalizePortals,
  normalizePortalSolution,
  buildPortalIndex
} = portalValidation;

function baseLevel(overrides) {
  return Object.assign({
    Id: 'portal-fixture',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 4,
    Height: 2,
    Blocked: [],
    Lines: [
      { Start: 0, End: 7 },
      { Start: 2, End: 3 },
      { Start: 4, End: 5 }
    ],
    Portals: [{ Id: 'P1', A: 1, B: 6 }]
  }, overrides || {});
}

function validSolution() {
  return [
    {
      Segments: [
        { Cells: [0, 1], Exit: { PairId: 'P1', From: 1, To: 6 } },
        { Cells: [6, 7] }
      ]
    },
    { Segments: [{ Cells: [2, 3] }] },
    { Segments: [{ Cells: [4, 5] }] }
  ];
}

function has(result, code) {
  return result.errors.indexOf(code) >= 0;
}

function run() {
  // Ordinary levels remain valid and do not acquire portal requirements.
  const ordinary = {
    Width: 3,
    Height: 1,
    Lines: [{ Start: 0, End: 2 }]
  };
  assert.strictEqual(validatePortals(ordinary).ok, true);
  assert.strictEqual(validatePortalLevel(ordinary).ok, true);

  const level = baseLevel();
  const structural = validatePortals(level);
  assert.strictEqual(structural.ok, true);
  assert.deepStrictEqual(normalizePortals(level)[0].A, 1);
  assert.deepStrictEqual(normalizePortals(level)[0].B, 6);
  assert.strictEqual(structural.portalByCell[1].exit, 6);
  assert.strictEqual(structural.portalByCell[6].exit, 1,
    'portal lookup is bidirectional');
  assert.strictEqual(structural.portalById.P1.A, 1);
  assert.strictEqual(validatePortalLevel(level, validSolution()).ok, true);
  assert.strictEqual(validatePortalSolution(level, validSolution()).ok, true);

  // Compact Cells authoring form normalizes to canonical A/B fields.
  const compact = baseLevel({ Portals: [{ id: 'P1', Cells: [1, 6] }] });
  assert.strictEqual(validatePortals(compact).ok, true);
  assert.deepStrictEqual(normalizePortals(compact)[0].id, 'P1');

  // No mutation of authoring data occurs while building maps or canonical
  // solution output.
  const source = baseLevel();
  const sourceCopy = JSON.parse(JSON.stringify(source));
  normalizePortals(source);
  buildPortalIndex(source);
  normalizePortalSolution(source, validSolution());
  assert.deepStrictEqual(source, sourceCopy);

  const malformedCases = [
    [baseLevel({ Mechanic: undefined }), 'portal-mechanic-invalid'],
    [baseLevel({ Portals: null }), 'portals-required-array'],
    [baseLevel({ Portals: [{}] }), 'portal-id-required'],
    [baseLevel({ Portals: [{ Id: 'P1', A: '1', B: 6 }] }), 'portal-cell-integer'],
    [baseLevel({ Portals: [{ Id: 'P1', A: 1, B: 99 }] }), 'portal-cell-out-of-range'],
    [baseLevel({ Portals: [{ Id: 'P1', A: 1, B: 1 }] }), 'portal-cell-duplicate'],
    [baseLevel({ Portals: [{ Id: 'P1', A: 1, B: 6 }, { Id: 'P2', A: 2, B: 5 }] }), 'portal-pair-count-exceeded'],
    [baseLevel({ Portals: [{ Id: 'P1', A: 1, B: 6 }, { Id: 'P1', A: 2, B: 5 }] }), 'portal-id-duplicate'],
    [baseLevel({ Portals: [{ Id: 'P1', A: 1, B: 6 }, { Id: 'P2', A: 6, B: 5 }] }), 'portal-cell-duplicate'],
    [baseLevel({ Portals: [{ Id: 'P1', A: 0, B: 6 }] }), 'portal-endpoint-conflict'],
    [baseLevel({ Blocked: [6] }), 'portal-blocked-conflict'],
    [baseLevel({ PortalRulesVersion: undefined }), 'portal-rules-version-invalid'],
    [baseLevel({ Blocked: null }), 'portal-blocked-required-array'],
    [baseLevel({ Blocked: [2.5] }), 'portal-blocked-integer'],
    [baseLevel({ Blocked: [-1] }), 'portal-blocked-out-of-range'],
    [baseLevel({
      Lines: [{ Start: 0, End: 7 }],
      Blocked: [2, 2]
    }), 'portal-blocked-duplicate'],
    [baseLevel({ PortalRulesVersion: 2 }), 'portal-rules-version-invalid'],
    [baseLevel({ Portals: [] }), 'portal-pair-required'],
    [{ Mechanic: 'normal', Portals: [{ Id: 'P1', A: 1, B: 6 }] }, 'portal-mechanic-invalid']
  ];
  malformedCases.forEach(([item, code]) => {
    const result = validatePortals(item);
    assert.strictEqual(result.ok, false, `${code} case should fail`);
    assert(has(result, code), `${code} should be reported: ${result.errors.join(',')}`);
  });

  const noSolution = validatePortalLevel(level, { requireSolution: true });
  assert.strictEqual(noSolution.ok, false);
  assert(has(noSolution, 'portal-solution-required'));
  assert.strictEqual(validatePortalSolution(level, null).ok, false);
  assert(has(validatePortalSolution(level, null), 'portal-solution-required'));

  const badTransition = validSolution();
  badTransition[0].Segments[0].Exit.To = 7;
  let result = validatePortalSolution(level, badTransition);
  assert.strictEqual(result.ok, false);
  assert(has(result, 'solution-portal-pair-invalid'));
  assert(has(result, 'solution-portal-order'));

  const missingTransition = validSolution();
  delete missingTransition[0].Segments[0].Exit;
  result = validatePortalSolution(level, missingTransition);
  assert.strictEqual(result.ok, false);
  assert(has(result, 'solution-portal-transition-required'));
  assert(has(result, 'solution-segment-non-adjacent'));

  const reused = validSolution();
  reused[0].Segments.splice(1, 0, {
    Cells: [6, 2],
    Exit: { PairId: 'P1', From: 6, To: 1 }
  });
  result = validatePortalSolution(level, reused);
  assert.strictEqual(result.ok, false);
  assert(has(result, 'solution-portal-reuse'));

  const overlap = validSolution();
  overlap[1].Segments[0].Cells = [2, 1, 0, 3];
  result = validatePortalSolution(level, overlap);
  assert.strictEqual(result.ok, false);
  assert(has(result, 'solution-overlap'));

  const wrongShape = [
    [0, 1, 6, 7],
    { Segments: [{ Cells: [2, 3] }] },
    { Segments: [{ Cells: [4, 5] }] }
  ];
  result = validatePortalSolution(level, wrongShape);
  assert.strictEqual(result.ok, false);
  assert(has(result, 'solution-segment-required'));

  const splitWithoutEdge = validSolution();
  splitWithoutEdge[1].Segments = [{ Cells: [2] }, { Cells: [3] }];
  result = validatePortalSolution(level, splitWithoutEdge);
  assert.strictEqual(result.ok, false);
  assert(has(result, 'solution-portal-order'));

  const wrongCount = validSolution().slice(0, 2);
  result = validatePortalSolution(level, wrongCount);
  assert.strictEqual(result.ok, false);
  assert(has(result, 'solution-line-count'));

  // One-line wrapper and lower-case segment/exit aliases are accepted.
  const oneLine = {
    segments: [
      { cells: [0, 1], exit: { pairId: 'P1', from: 1, to: 6 } },
      { cells: [6, 7] }
    ]
  };
  const oneLineLevel = baseLevel({
    Lines: [{ Start: 0, End: 7 }],
    Blocked: [2, 3, 4, 5]
  });
  assert.strictEqual(validatePortalSolution(oneLineLevel, oneLine).ok, true);

  // An out-of-range Blocked value is both invalid authoring data and cannot
  // lower the expected coverage count to disguise a missing real cell.
  const forgedCoverageLevel = baseLevel({
    Lines: [
      { Start: 0, End: 4 },
      { Start: 2, End: 7 }
    ],
    Portals: [{ Id: 'P1', A: 1, B: 5 }],
    Blocked: [99]
  });
  const forgedCoverageSolution = [
    {
      Segments: [
        { Cells: [0, 1], Exit: { PairId: 'P1', From: 1, To: 5 } },
        { Cells: [5, 4] }
      ]
    },
    { Segments: [{ Cells: [2, 3, 7] }] }
  ];
  const forgedCoverage = validatePortalSolution(
    forgedCoverageLevel,
    forgedCoverageSolution
  );
  assert.strictEqual(forgedCoverage.ok, false);
  assert(has(forgedCoverage, 'portal-blocked-out-of-range'));
  assert(has(forgedCoverage, 'solution-incomplete'),
    'invalid blockers must not reduce required in-range coverage');
}

module.exports = run;
