'use strict';

const assert = require('assert');
const HintService = require('../src/services/hint-service.js');
const GameRunner = require('../core/game-runner.js');
const portalDemo = require('../data/portal-demo.js');
const portalSolutions = require('../data/portal-solutions.js');

function run() {
  const hints = new HintService(null, null, portalSolutions);

  // 1. Solution catalog lookup for demo level 1
  const level1 = portalDemo.Games[0];
  const runner1 = new GameRunner(level1, portalDemo.Palette);
  const hint1 = hints.find(runner1);
  assert(hint1, 'hint must be found for demo 1');
  assert.strictEqual(hint1.lineIndex, 0);
  assert.strictEqual(hint1.source, 'solution');
  assert.strictEqual(hint1.requiresRelease, true);
  assert(Array.isArray(hint1.segments), 'hint must have segments');
  assert.strictEqual(hint1.segments.length, 2, 'demo 1 has 2 segments');
  assert.deepStrictEqual(hint1.segments[0], [0, 1, 6, 5, 10, 11, 16, 15, 20, 21]);
  assert.deepStrictEqual(hint1.segments[1], [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24]);
  assert.strictEqual(hint1.teleports.length, 1);
  assert.strictEqual(hint1.teleports[0].from, 21);
  assert.strictEqual(hint1.teleports[0].to, 2);

  // 2. In PORTAL_WAIT: hint should only return remaining segment after exit B
  runner1.touchStart(0);
  [1, 6, 5, 10, 11, 16, 15, 20, 21].forEach(c => runner1.touchMove(c));
  assert.strictEqual(runner1.portalPhase, 'PORTAL_LOCKED');
  runner1.touchEnd(-1);
  assert.strictEqual(runner1.portalPhase, 'PORTAL_WAIT');

  const waitHint = hints.find(runner1);
  assert(waitHint, 'hint should be available in PORTAL_WAIT');
  assert.strictEqual(waitHint.lineIndex, 0);
  assert.strictEqual(waitHint.requiresRelease, false);
  assert.strictEqual(waitHint.segments.length, 1, 'only 1 remaining segment');
  assert.deepStrictEqual(waitHint.segments[0], [2, 3, 4, 9, 8, 7, 12, 13, 14, 19, 18, 17, 22, 23, 24]);

  // 3. Fallback to portal-aware BFS search
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

  // 4. All 5 demo levels have valid stored hints
  portalDemo.Games.forEach((game, idx) => {
    const r = new GameRunner(game, portalDemo.Palette);
    const h = hints.find(r);
    assert(h, `demo level ${idx + 1} (${game.Id}) must produce a hint`);
    assert.strictEqual(h.source, 'solution');
  });

  // 5. Legacy non-portal levels return legacy format without segments
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
}

module.exports = run;
