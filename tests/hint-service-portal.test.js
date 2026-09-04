'use strict';

const assert = require('assert');
const HintService = require('../src/services/hint-service.js');
const PortalHintProvider = require('../src/services/hints/portal-hint-provider.js');
const portalSolution = require('../core/portal-solution.js');
const GameRunner = require('../core/game-runner.js');
const catalog = require('../data/catalog-v2.js');
const portalSet = catalog.sets[1];
const portalSolutions = require('../data/portal-solutions.js');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach(key => deepFreeze(value[key]));
  return Object.freeze(value);
}

function purePortalContext(level) {
  const total = level.Width * level.Height;
  const blocked = Array.isArray(level.Blocked) ? level.Blocked.slice() : [];
  const blockedMask = new Array(total).fill(false);
  blocked.forEach(index => { blockedMask[index] = true; });
  const fixedLine = new Array(total).fill(-1);
  level.Lines.forEach((line, lineIndex) => {
    fixedLine[line.Start] = lineIndex;
    fixedLine[line.End] = lineIndex;
  });
  return {
    outcome: 'playing',
    levelId: level.Id,
    board: {
      width: level.Width,
      height: level.Height,
      lines: level.Lines.map(line => Object.assign({}, line)),
      blocked,
      blockedMask,
      owner: new Array(total).fill(-1),
      fixedLine
    },
    completedLines: new Array(level.Lines.length).fill(false),
    completedPaths: new Array(level.Lines.length).fill(null),
    selection: { lineIndex: -1, cells: [], segments: [], teleports: [] },
    mechanic: {
      id: 'portal',
      rulesVersion: level.PortalRulesVersion,
      phase: 'READY',
      portals: level.Portals.map(portal => {
        const cells = portal.Cells || portal.cells;
        return Array.isArray(cells)
          ? { id: portal.Id || portal.id, cells: cells.slice() }
          : Object.assign({}, portal);
      }),
      pending: null,
      locked: null,
      usedPairIds: []
    }
  };
}

function run() {
  const hints = new HintService(null, null, portalSolutions);

  // 1. Solution catalog lookup for mainline level 7
  const level1 = portalSet.Games[4];
  const runner1 = new GameRunner(level1, portalSet.Palette);
  const hint1 = hints.find(runner1);
  assert(hint1, 'hint must be found for mainline level 7');
  assert.strictEqual(hint1.lineIndex, 0);
  assert.strictEqual(hint1.source, 'solution');
  assert.strictEqual(hint1.requiresRelease, true);
  assert(Array.isArray(hint1.segments), 'hint must have segments');
  assert.strictEqual(hint1.segments.length, 2, 'mainline level 7 has 2 segments');
  assert.deepStrictEqual(hint1.segments[0], [0, 1, 6, 5, 10, 11, 16, 15, 20, 21]);
  assert.deepStrictEqual(hint1.segments[1], [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24]);
  assert.strictEqual(hint1.teleports.length, 1);
  assert.strictEqual(hint1.teleports[0].from, 21);
  assert.strictEqual(hint1.teleports[0].to, 2);

  const completeHint1 = hints.findPortalComplete(runner1);
  assert(completeHint1, 'Portal complete hint is available from preset data');
  assert.strictEqual(completeHint1.paths.length, level1.Lines.length);
  assert.deepStrictEqual(completeHint1.paths[0].segments, hint1.segments);
  assert.deepStrictEqual(completeHint1.paths[0].teleports, hint1.teleports);
  assert.strictEqual(completeHint1.paths[0].path[0], level1.Lines[0].Start);
  assert.strictEqual(
    completeHint1.paths[0].path[completeHint1.paths[0].path.length - 1],
    level1.Lines[0].End
  );

  // 2. In PORTAL_WAIT: hint should only return remaining segment after exit B
  runner1.touchStart(0);
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => runner1.touchMove(c));
  assert.strictEqual(runner1.portalPhase, 'PORTAL_LOCKED');
  runner1.touchEnd(-1);
  assert.strictEqual(runner1.portalPhase, 'PORTAL_WAIT');

  // Snapshot equality must not race the elapsed-time clock.
  runner1.pause();
  const waitStateBeforeComplete = runner1.getViewState();
  const waitComplete = hints.findComplete(runner1);
  assert.deepStrictEqual(waitComplete.paths[0].segments, completeHint1.paths[0].segments,
    'complete Portal preview uses the full preset rather than the pending remainder');
  assert.deepStrictEqual(runner1.getViewState(), waitStateBeforeComplete,
    'complete Portal lookup preserves pending state and selection');

  const waitHint = hints.find(runner1);
  assert(waitHint, 'hint should be available in PORTAL_WAIT');
  assert.strictEqual(waitHint.lineIndex, 0);
  assert.strictEqual(waitHint.requiresRelease, false);
  assert.strictEqual(waitHint.segments.length, 1, 'only 1 remaining segment');
  assert.deepStrictEqual(waitHint.segments[0], [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24]);

  runner1.pause();
  const runnerStateBeforeHint = runner1.getViewState();
  assert(hints.find(runner1));
  assert.deepStrictEqual(runner1.getViewState(), runnerStateBeforeHint,
    'requesting a portal hint cannot mutate Runner state');

  // 3. The same stored answer is usable from the opposite endpoint. Entering
  // the stored B side means the wait hint must continue from A toward Start.
  const reverseRunner = new GameRunner(level1, portalSet.Palette);
  reverseRunner.touchStart(24);
  [23, 22, 17, 18, 19, 14, 13, 12, 7, 8, 9, 4, 3, 2]
    .forEach(cell => reverseRunner.touchMove(cell));
  assert.strictEqual(reverseRunner.portalPhase, 'PORTAL_LOCKED');
  reverseRunner.touchEnd(-1);
  assert.strictEqual(reverseRunner.portalPhase, 'PORTAL_WAIT');
  assert.strictEqual(reverseRunner.portalPending.entry, 2);
  assert.deepStrictEqual(reverseRunner.portalPending.eligibleExits, [21]);
  assert.strictEqual(reverseRunner.portalPending.selectedExit, null);

  const reverseHint = hints.find(reverseRunner);
  assert(reverseHint, 'reverse portal entry must have a wait hint');
  assert.strictEqual(reverseHint.source, 'solution');
  assert.strictEqual(reverseHint.requiresRelease, false);
  assert.deepStrictEqual(reverseHint.segments, [
    [21, 20, 15, 16, 11, 10, 5, 6, 1, 0]
  ]);

  // 4. A player may reach the stored portal through a different route. If
  // that route occupies cells in the stored remainder, reject it and search
  // from the actual exit to the actual target without crossing entry cells.
  const deviatedRunner = new GameRunner(level1, portalSet.Palette);
  const deviatedEntry = [0, 1, 6, 7, 12, 11, 16, 15, 20, 21];
  deviatedRunner.touchStart(deviatedEntry[0]);
  deviatedEntry.slice(1).forEach(cell => deviatedRunner.touchMove(cell));
  deviatedRunner.touchEnd(-1);
  assert.strictEqual(deviatedRunner.portalPhase, 'PORTAL_WAIT');

  const deviatedHint = hints.find(deviatedRunner);
  assert(deviatedHint, 'deviated entry route must fall back to a safe hint');
  assert.strictEqual(deviatedHint.source, 'search');
  assert.strictEqual(deviatedHint.path[0], 2, 'fallback starts at the actual portal exit');
  assert.strictEqual(deviatedHint.path[deviatedHint.path.length - 1], 24, 'fallback targets the opposite endpoint');
  assert.strictEqual(
    deviatedHint.path.some(cell => deviatedEntry.indexOf(cell) >= 0),
    false,
    'fallback must not traverse the occupied entry segment'
  );

  // 5. Fallback search must teleport as soon as it enters a portal cell. The
  // shorter-looking 0 -> 1 -> 2 route is not executable because 1 locks P1.
  const forcedTeleportLevel = {
    Id: 'forced-portal-search-test',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 3,
    Height: 2,
    Lines: [{ Start: 0, End: 2 }],
    Portals: [{ Id: 'P1', A: 1, B: 5 }]
  };
  const forcedTeleportRunner = new GameRunner(forcedTeleportLevel, ['#f00']);
  const forcedTeleportHint = new HintService().find(forcedTeleportRunner);
  assert(forcedTeleportHint, 'forced portal route must be found');
  assert.strictEqual(forcedTeleportHint.source, 'search');
  assert.deepStrictEqual(forcedTeleportHint.path, [0, 1, 5, 2]);
  assert.deepStrictEqual(forcedTeleportHint.segments, [[0, 1], [5, 2]]);
  assert.deepStrictEqual(forcedTeleportHint.teleports, [
    { pairId: 'P1', from: 1, to: 5 }
  ]);

  // 6. A forced portal leading into a sealed exit is genuinely unsolvable;
  // search must not escape by walking through the entry as an ordinary cell.
  const noSolutionLevel = {
    Id: 'sealed-portal-search-test',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 4,
    Height: 3,
    Blocked: [2, 4, 5, 8, 10],
    Lines: [{ Start: 0, End: 3 }],
    Portals: [{ Id: 'P1', A: 1, B: 9 }]
  };
  const noSolutionRunner = new GameRunner(noSolutionLevel, ['#f00']);
  assert.strictEqual(new HintService().find(noSolutionRunner), null);

  // 7. Fallback to portal-aware BFS search
  const fallbackHints = new HintService();
  const searchLevel = {
    Id: 'search-portal-test',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 4,
    Height: 4,
    Lines: [{ Start: 0, End: 15 }],
    Portals: [{ Id: 'P1', A: 1, B: 14 }]
  };
  const searchRunner = new GameRunner(searchLevel, ['#f00']);
  const searchHint = fallbackHints.find(searchRunner);
  assert(searchHint, 'search must find a path with portals');
  assert.strictEqual(searchHint.source, 'search');
  assert.strictEqual(searchHint.segments.length, 2);
  assert.strictEqual(searchHint.teleports.length, 1);
  assert.strictEqual(searchHint.teleports[0].from, 1);
  assert.strictEqual(searchHint.teleports[0].to, 14);
  assert.strictEqual(searchHint.segments[0][0], 0);
  assert.strictEqual(searchHint.segments[0][searchHint.segments[0].length - 1], 1);
  assert.strictEqual(searchHint.segments[1][0], 14);
  assert.strictEqual(searchHint.segments[1][searchHint.segments[1].length - 1], 15);

  // Every published mainline Portal level keeps a valid keyed hint.
  catalog.levels.filter(entry => entry.game.Mechanic === 'portal').forEach(entry => {
    const runner = new GameRunner(entry.game, entry.palette);
    const hint = hints.find(runner);
    assert(hint, `${entry.game.Id} must produce a stored hint`);
    assert.strictEqual(hint.source, 'solution');
  });

  // v2 branches from one entry to every other portal in the neutral network.
  // The first listed exit (5) is a dead end after the network has been used,
  // so search must continue with exit 6 rather than committing to one pair.
  const networkLevel = {
    Id: 'portal-v2-network-search',
    Mechanic: 'portal',
    PortalRulesVersion: 2,
    Width: 4,
    Height: 2,
    Lines: [{ Start: 0, End: 3 }],
    Portals: [{ Id: 'P1', Cells: [1, 5, 6] }]
  };
  const networkContext = deepFreeze(purePortalContext(networkLevel));
  const networkHint = new PortalHintProvider().find(networkContext, null);
  assert(networkHint, 'v2 search must explore all eligible exits');
  assert.deepStrictEqual(networkHint.path, [0, 1, 6, 7, 3]);
  assert.deepStrictEqual(networkHint.segments, [[0, 1], [6, 7, 3]]);
  assert.deepStrictEqual(networkHint.teleports, [
    { from: 1, to: 6, portalId: 'P1' }
  ]);

  const networkStored = [{ Segments: [
    { Cells: [0, 1], Exit: { PortalId: 'P1', From: 1, To: 6 } },
    { Cells: [6, 7, 3] }
  ] }];
  const networkReadyHint = new PortalHintProvider().find(networkContext, networkStored);
  assert.strictEqual(networkReadyHint.source, 'solution');
  assert.deepStrictEqual(networkReadyHint.teleports, [
    { from: 1, to: 6, portalId: 'P1' }
  ]);

  const networkWaitContext = purePortalContext(networkLevel);
  networkWaitContext.selection = {
    lineIndex: 0,
    cells: [0, 1],
    segments: [[0, 1]],
    teleports: []
  };
  networkWaitContext.mechanic.phase = 'PORTAL_WAIT';
  networkWaitContext.mechanic.pending = {
    lineIndex: 0,
    portalId: 'P1',
    entry: 1,
    eligibleExits: [5, 6],
    entryCells: [0, 1]
  };
  const networkWaitHint = new PortalHintProvider().find(
    deepFreeze(networkWaitContext),
    networkStored
  );
  assert(networkWaitHint);
  assert.strictEqual(networkWaitHint.source, 'solution');
  assert.strictEqual(networkWaitHint.recommendedExit, 6);
  assert.deepStrictEqual(networkWaitHint.segments, [[6, 7, 3]]);
  assert.deepStrictEqual(networkWaitHint.teleports, []);

  const pairIdCompatibility = JSON.parse(JSON.stringify(networkStored));
  pairIdCompatibility[0].Segments[0].Exit.PairId =
    pairIdCompatibility[0].Segments[0].Exit.PortalId;
  delete pairIdCompatibility[0].Segments[0].Exit.PortalId;
  const compatibilityHint = new PortalHintProvider().find(networkContext, pairIdCompatibility);
  assert.deepStrictEqual(compatibilityHint.teleports, [
    { from: 1, to: 6, portalId: 'P1' }
  ], 'v2 hint output canonicalizes the legacy PairId alias to portalId');

  // 9. Legacy non-portal levels return legacy format without segments
  const legacyLevel = {
    Width: 3,
    Height: 1,
    Lines: [{ Start: 0, End: 2 }]
  };
  const legacyRunner = new GameRunner(legacyLevel, ['#f00']);
  const legacyHint = fallbackHints.find(legacyRunner);
  assert(legacyHint);
  assert.strictEqual(legacyHint.source, 'search');
  assert.deepStrictEqual(legacyHint.path, [0, 1, 2]);
  assert.strictEqual(legacyHint.segments, undefined);

  // 10. Stored-solution normalization/reversal is pure core data logic.
  const rawStored = portalSolutions.ByLevelId[level1.Id][0];
  const rawBefore = JSON.stringify(rawStored);
  const normalized = portalSolution.normalizeStoredPortalLine(rawStored);
  assert(normalized);
  assert.deepStrictEqual(
    portalSolution.flattenPortalSegments(normalized.segments),
    normalized.path
  );
  const reversed = portalSolution.reverseStoredPortalLine(normalized);
  assert(reversed);
  assert.strictEqual(reversed.start, 24);
  assert.strictEqual(reversed.end, 0);
  assert.deepStrictEqual(reversed.teleports, [{ from: 2, to: 21, portalId: 'P1' }]);
  assert.strictEqual(JSON.stringify(rawStored), rawBefore,
    'portal solution helpers must not mutate catalog data');
  assert.strictEqual(portalSolution.normalizeStoredPortalLine({
    Segments: [{ Cells: [0, , 1] }]
  }), null, 'stored hints reject sparse cell arrays');
  assert.strictEqual(portalSolution.normalizeStoredPortalLine({
    Segments: new Array(1)
  }), null, 'stored hints reject sparse segment arrays');

  // 11. Provider and facade both consume a frozen, runner-free context. This
  // also proves routing uses mechanic.id rather than a mutable runner flag.
  const pureContext = deepFreeze(purePortalContext(level1));
  const contextBefore = JSON.stringify(pureContext);
  const directHint = new PortalHintProvider().find(
    pureContext,
    portalSolutions.ByLevelId[level1.Id]
  );
  assert(directHint);
  assert.strictEqual(directHint.source, 'solution');
  assert.deepStrictEqual(directHint.segments, hint1.segments);
  assert.strictEqual(JSON.stringify(pureContext), contextBefore,
    'portal provider must not mutate its read-only context');

  const facadeHint = hints.find(pureContext);
  assert(facadeHint);
  assert.deepStrictEqual(facadeHint.segments, hint1.segments);
  assert.deepStrictEqual(
    hints.pickStoredPortalPath(portalSolutions.ByLevelId[level1.Id], pureContext).segments,
    hint1.segments
  );
  assert.deepStrictEqual(hints.normalizeStoredPortalLine(rawStored), normalized);
  assert.deepStrictEqual(hints.reverseStoredPortalLine(normalized), reversed);
  assert.deepStrictEqual(hints.flattenPortalSegments(normalized.segments), normalized.path);
  assert.strictEqual(JSON.stringify(pureContext), contextBefore,
    'HintService must clone a pure portal context before routing it');

  const waitContext = purePortalContext(level1);
  waitContext.selection = {
    lineIndex: 0,
    cells: [0, 1, 6, 5, 10, 11, 16, 15, 20, 21],
    segments: [[0, 1, 6, 5, 10, 11, 16, 15, 20, 21]],
    teleports: []
  };
  waitContext.mechanic.phase = 'PORTAL_WAIT';
  waitContext.mechanic.pending = {
    lineIndex: 0,
    portalId: 'P1',
    entry: 21,
    eligibleExits: [2],
    entryCells: waitContext.selection.cells.slice(),
    usedPairIds: []
  };
  const pureWaitHint = new PortalHintProvider().find(
    deepFreeze(waitContext),
    portalSolutions.ByLevelId[level1.Id]
  );
  assert(pureWaitHint);
  assert.strictEqual(pureWaitHint.requiresRelease, false);
  assert.deepStrictEqual(pureWaitHint.segments, waitHint.segments);
}

module.exports = run;
