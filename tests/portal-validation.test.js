'use strict';

const assert = require('assert');
const portalSchema = require('../core/portal-schema.js');
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
  [
    'validate',
    'validatePortalData',
    'validatePortal',
    'validateLevel',
    'validatePortalLevel'
  ].forEach(name => {
    assert.strictEqual(portalValidation[name], portalValidation,
      `${name} must remain an alias of the default validator export`);
  });
  assert.strictEqual(portalValidation.validateSolution,
    portalValidation.validatePortalSolution);
  assert.strictEqual(portalValidation.ERROR_CODES, portalValidation.codes);
  assert.deepStrictEqual(Object.values(portalValidation.codes).sort(), [
    'portal-blocked-conflict',
    'portal-blocked-duplicate',
    'portal-blocked-integer',
    'portal-blocked-out-of-range',
    'portal-blocked-required-array',
    'portal-board-dimensions-invalid',
    'portal-cell-count-insufficient',
    'portal-cell-duplicate',
    'portal-cell-integer',
    'portal-cell-out-of-range',
    'portal-cells-array-invalid',
    'portal-endpoint-conflict',
    'portal-ice-invalid',
    'portal-id-duplicate',
    'portal-id-required',
    'portal-mechanic-invalid',
    'portal-network-count-invalid',
    'portal-not-object',
    'portal-pair-count-exceeded',
    'portal-pair-required',
    'portal-rules-version-invalid',
    'portal-solution-required',
    'portal-v2-pair-fields-forbidden',
    'portals-required-array',
    'solution-cell-non-integer',
    'solution-cell-out-of-range',
    'solution-end-mismatch',
    'solution-incomplete',
    'solution-line-count',
    'solution-overlap',
    'solution-path-duplicate',
    'solution-portal-network-invalid',
    'solution-portal-order',
    'solution-portal-pair-invalid',
    'solution-portal-reuse',
    'solution-portal-transition-required',
    'solution-portal-use-count-exceeded',
    'solution-segment-non-adjacent',
    'solution-segment-not-object',
    'solution-segment-required',
    'solution-start-mismatch',
    'solution-through-blocked'
  ]);
  assert.strictEqual(portalValidation.normalizePortals, portalSchema.normalizePortals,
    'validator must re-export the shared portal normalizer');
  assert.strictEqual(portalValidation.buildPortalIndex, portalSchema.buildPortalIndex,
    'validator must re-export the shared portal index builder');

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

  // v2 declares one neutral portal network with two or more interchangeable
  // cells. Unused portal cells are optional coverage, while a stored answer
  // still records the concrete exit chosen for deterministic replay.
  const v2Level = baseLevel({
    PortalRulesVersion: 2,
    Width: 4,
    Height: 2,
    Blocked: [5],
    Lines: [{ Start: 0, End: 2 }],
    Portals: [{ Id: 'P1', Cells: [1, 4, 6] }]
  });
  const v2Solution = [{
    Segments: [
      { Cells: [0, 1], Exit: { PortalId: 'P1', From: 1, To: 6 } },
      { Cells: [6, 7, 3, 2] }
    ]
  }];
  const v2Structural = validatePortals(v2Level);
  assert.strictEqual(v2Structural.ok, true);
  assert.deepStrictEqual(v2Structural.portals[0].cells, [1, 4, 6]);
  assert.deepStrictEqual(v2Structural.portalByCell[1].exits, [4, 6]);
  assert.deepStrictEqual(v2Structural.portalByCell[4].exits, [1, 6]);
  assert.strictEqual(validatePortalSolution(v2Level, v2Solution).ok, true,
    'the unused portal at cell 4 must not be required for v2 coverage');
  assert.deepStrictEqual(normalizePortalSolution(v2Level, v2Solution)[0].Segments[0].Exit, {
    From: 1,
    To: 6,
    PortalId: 'P1'
  });

  const v2PairIdAlias = JSON.parse(JSON.stringify(v2Solution));
  v2PairIdAlias[0].Segments[0].Exit.PairId =
    v2PairIdAlias[0].Segments[0].Exit.PortalId;
  delete v2PairIdAlias[0].Segments[0].Exit.PortalId;
  assert.strictEqual(validatePortalSolution(v2Level, v2PairIdAlias).ok, true,
    'v2 readers keep PairId compatibility for existing tooling');

  [
    [baseLevel({ PortalRulesVersion: 2, Portals: [] }), 'portal-network-count-invalid'],
    [baseLevel({ PortalRulesVersion: 2, Portals: [
      { Id: 'P1', Cells: [1, 6] },
      { Id: 'P2', Cells: [2, 5] }
    ] }), 'portal-network-count-invalid'],
    [baseLevel({ PortalRulesVersion: 2, Portals: [{ Id: 'P1', Cells: [1] }] }),
      'portal-cell-count-insufficient'],
    [baseLevel({ PortalRulesVersion: 2, Portals: [
      { Id: 'P1', Cells: [1, 6], A: 2, B: 5 }
    ] }), 'portal-v2-pair-fields-forbidden'],
    [baseLevel({ PortalRulesVersion: 2, Portals: [{ Id: 'P1', Cells: [1, 1, 6] }] }),
      'portal-cell-duplicate'],
    [baseLevel({ PortalRulesVersion: 2, Portals: [{ Id: 'P1', Cells: [1, , 6] }] }),
      'portal-cell-integer'],
    [baseLevel({ PortalRulesVersion: 2, Portals: [{ Id: 'P1', Cells: [1, 99] }] }),
      'portal-cell-out-of-range'],
    [baseLevel({ PortalRulesVersion: 2, Portals: [{ Id: 'P1', Cells: [0, 6] }] }),
      'portal-endpoint-conflict'],
    [baseLevel({ PortalRulesVersion: 2, Blocked: [6], Portals: [{ Id: 'P1', Cells: [1, 6] }] }),
      'portal-blocked-conflict']
  ].forEach(([item, code]) => {
    const invalid = validatePortals(item);
    assert.strictEqual(invalid.ok, false);
    assert(has(invalid, code), `${code} should be reported for v2`);
  });

  const v2SelfExit = JSON.parse(JSON.stringify(v2Solution));
  v2SelfExit[0].Segments[0].Exit.To = 1;
  v2SelfExit[0].Segments[1].Cells[0] = 1;
  let v2Result = validatePortalSolution(v2Level, v2SelfExit);
  assert.strictEqual(v2Result.ok, false);
  assert(has(v2Result, 'solution-portal-network-invalid'));

  const v2MissingTransition = [{ Segments: [{ Cells: [0, 3, 2] }] }];
  v2Result = validatePortalSolution(v2Level, v2MissingTransition);
  assert.strictEqual(v2Result.ok, false);
  assert(has(v2Result, 'solution-portal-transition-required'),
    'a portal level must exercise the mechanic even though unused gates are optional');

  const v2Repeated = [{ Segments: [
    { Cells: [0, 1], Exit: { PortalId: 'P1', From: 1, To: 6 } },
    { Cells: [6, 4], Exit: { PortalId: 'P1', From: 4, To: 1 } },
    { Cells: [1, 2] }
  ] }];
  v2Result = validatePortalSolution(v2Level, v2Repeated);
  assert.strictEqual(v2Result.ok, false);
  assert(has(v2Result, 'solution-portal-use-count-exceeded'));

  const v2SparseSolution = JSON.parse(JSON.stringify(v2Solution));
  v2SparseSolution[0].Segments[1].Cells = [6, , 7, 3, 2];
  v2Result = validatePortalSolution(v2Level, v2SparseSolution);
  assert.strictEqual(v2Result.ok, false);
  assert(has(v2Result, 'solution-cell-non-integer'),
    'sparse solution cell arrays cannot bypass adjacency validation');

  const sparsePortals = baseLevel({ PortalRulesVersion: 2, Portals: new Array(1) });
  const sparsePortalResult = validatePortals(sparsePortals);
  assert.strictEqual(sparsePortalResult.ok, false);
  assert(has(sparsePortalResult, 'portal-not-object'),
    'sparse portal descriptor arrays are rejected at the publishing boundary');

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
    [baseLevel({ PortalRulesVersion: 3 }), 'portal-rules-version-invalid'],
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
