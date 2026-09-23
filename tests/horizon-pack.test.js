'use strict';

const assert = require('assert');
const catalog = require('../data/catalog-v2.js');
const ordinarySolutions = require('../data/solutions.js');
const portalSolutions = require('../data/portal-solutions.js');
const GameRunner = require('../core/game-runner.js');
const HintService = require('../src/services/hint-service.js');
const evaluate = require('../scripts/evaluate-level-difficulty.js');
const solveWithoutPortals = require('../scripts/solve-no-portal.js');
const portalValidation = require('../core/portal-validation.js');

const START = 168;
const GRADES = [1, 2, 2, 3, 1, 2, 3, 2, 1, 3, 2, 2, 3, 2, 4, 1,
  2, 3, 2, 1, 3, 2, 2, 3, 1, 2, 3, 2, 4, 1, 2, 1];
const PORTAL_SLOTS = new Set([5, 11, 17, 21, 26, 30]);
const ICE = new Map([
  [2, [2, 1]], [9, [8, 3]], [14, [12, 3]],
  [18, [4, 2]], [23, [8, 2]], [28, [12, 3]]
]);

function transform(cell, variant) {
  let x = cell % 8;
  let y = Math.floor(cell / 8);
  if (variant >= 4) x = 7 - x;
  for (let turn = 0; turn < variant % 4; turn += 1) [x, y] = [7 - y, x];
  return y * 8 + x;
}

function canonical(game) {
  return Array.from({ length: 8 }, (_, variant) => {
    const endpoints = game.Lines.map(line => [transform(line.Start, variant), transform(line.End, variant)]
      .sort((one, two) => one - two).join(':')).sort().join('|');
    const ice = (game.IceCells || []).map(cell => transform(cell, variant))
      .sort((one, two) => one - two).join(',');
    const portals = (game.Portals || []).flatMap(network => network.Cells || [network.A, network.B])
      .map(cell => transform(cell, variant)).sort((one, two) => one - two).join(',');
    return `${endpoints}@${ice}#${portals}`;
  }).sort()[0];
}

function answerFor(game) {
  return game.Mechanic === 'portal'
    ? portalSolutions.ByLevelId[game.Id]
    : ordinarySolutions.ByLevelId[game.Id];
}

function pathsFor(answer) {
  return answer.map(line => Array.isArray(line) ? [line] : line.Segments.map(segment => segment.Cells));
}

function transformAnswer(answer, variant) {
  return answer.map(line => {
    if (Array.isArray(line)) return line.map(cell => transform(cell, variant));
    return {
      Segments: line.Segments.map(segment => {
        const result = { Cells: segment.Cells.map(cell => transform(cell, variant)) };
        if (segment.Exit) result.Exit = {
          PortalId: segment.Exit.PortalId,
          From: transform(segment.Exit.From, variant),
          To: transform(segment.Exit.To, variant)
        };
        return result;
      })
    };
  });
}

function transformLevel(game, variant) {
  const transformed = Object.assign({}, game, {
    Lines: game.Lines.map(line => ({
      Start: transform(line.Start, variant),
      End: transform(line.End, variant)
    }))
  });
  if (game.IceCells) transformed.IceCells = game.IceCells.map(cell => transform(cell, variant));
  if (game.Portals) transformed.Portals = game.Portals.map(network => ({
    Id: network.Id,
    Cells: network.Cells.map(cell => transform(cell, variant))
  }));
  return transformed;
}

function replay(game, answer, reverseOrder) {
  const runner = new GameRunner(game, catalog.sets[4].Palette);
  const lines = pathsFor(answer);
  const order = Array.from({ length: lines.length }, (_, index) => index);
  if (reverseOrder) order.reverse();
  order.forEach(lineIndex => {
    lines[lineIndex].forEach((path, segmentIndex, segments) => {
      assert.strictEqual(runner.touchStart(path[0]), true, `${game.Id}: start ${lineIndex}/${segmentIndex}`);
      path.slice(1).forEach(cell => assert.strictEqual(runner.touchMove(cell), true,
        `${game.Id}: move ${lineIndex}/${cell}`));
      assert.strictEqual(runner.touchEnd(path[path.length - 1]), segmentIndex === segments.length - 1,
        `${game.Id}: end ${lineIndex}/${segmentIndex}`);
    });
  });
  assert.strictEqual(runner.outcome, GameRunner.OUTCOME.WON, `${game.Id}: official answer must win`);
}

function verifyCoverage(game, answer) {
  const ice = new Set(game.IceCells || []);
  const coverage = new Array(64).fill(0);
  pathsFor(answer).forEach((segments, color) => {
    const lineCells = segments.flat();
    assert.strictEqual(new Set(lineCells).size, lineCells.length, `${game.Id}: line ${color} repeats a cell`);
    assert.strictEqual(lineCells[0], game.Lines[color].Start);
    assert.strictEqual(lineCells[lineCells.length - 1], game.Lines[color].End);
    lineCells.forEach(cell => coverage[cell]++);
  });
  coverage.forEach((count, cell) => assert.strictEqual(count, ice.has(cell) ? 2 : 1,
    `${game.Id}: cell ${cell} coverage`));
}

module.exports = function run() {
  const entries = catalog.levels.slice(START, START + GRADES.length);
  assert.strictEqual(entries.length, 32);
  assert.deepStrictEqual(entries.map(entry => entry.game.Difficulty), GRADES);
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(grade =>
    entries.filter(entry => entry.game.Difficulty === grade).length), [8, 14, 8, 2, 0]);
  assert.strictEqual(entries.filter(entry => !entry.game.Mechanic).length, 20);
  assert.strictEqual(entries.filter(entry => entry.game.Mechanic === 'portal').length, 6);
  assert.strictEqual(entries.filter(entry => entry.game.Mechanic === 'ice').length, 6);

  const seen = new Set(catalog.levels.slice(0, START)
    .filter(entry => entry.game.Width === 8 && entry.game.Height === 8)
    .map(entry => canonical(entry.game)));
  const hints = new HintService({ solutionCatalog: ordinarySolutions, portalSolutions });

  entries.forEach(({ game, setIndex, levelIndex }, index) => {
    assert.deepStrictEqual([setIndex, levelIndex], [4, 136 + index]);
    assert.strictEqual(game.Id, `horizon-8x8-${String(index + 1).padStart(2, '0')}`);
    assert.strictEqual(game.Width, 8);
    assert.strictEqual(game.Height, 8);
    assert.strictEqual(game.Blocked, undefined);
    assert(game.Lines.length >= 6 && game.Lines.length <= 9);
    game.Lines.forEach(line => assert(Math.abs(line.Start % 8 - line.End % 8) +
      Math.abs(Math.floor(line.Start / 8) - Math.floor(line.End / 8)) > 1,
    `${game.Id}: same-color endpoints cannot be adjacent`));

    if (PORTAL_SLOTS.has(index)) {
      assert.strictEqual(game.Mechanic, 'portal');
      assert.strictEqual(game.PortalRulesVersion, 2);
      assert.strictEqual(game.Portals.length, 1);
      assert.strictEqual(game.Portals[0].Cells.length, 2);
      assert.strictEqual(game.IceCells, undefined);
    } else if (ICE.has(index)) {
      assert.strictEqual(game.Mechanic, 'ice');
      assert.strictEqual(game.IceRulesVersion, 1);
      assert.strictEqual(game.IceCells.length, ICE.get(index)[0]);
      assert.strictEqual(game.Portals, undefined);
    } else {
      assert.strictEqual(game.Mechanic, undefined);
      assert.strictEqual(game.IceCells, undefined);
      assert.strictEqual(game.Portals, undefined);
    }

    const layout = canonical(game);
    assert(!seen.has(layout), `${game.Id}: duplicate under symmetry and color relabeling`);
    seen.add(layout);
    const answer = answerFor(game);
    assert(Array.isArray(answer), `${game.Id}: answer missing`);
    verifyCoverage(game, answer);
    const rating = evaluate(game, answer);
    assert.strictEqual(rating.grade, GRADES[index]);
    assert(rating.lengths.every(length => length >= 4 && length <= 16));
    if (ICE.has(index)) assert.deepStrictEqual([rating.iceCells, rating.iceGroups], ICE.get(index));
    if (PORTAL_SLOTS.has(index)) {
      const validation = portalValidation.validatePortalSolution(game, answer);
      assert.strictEqual(validation.ok, true, `${game.Id}: ${validation.errors.join(',')}`);
      assert.strictEqual(solveWithoutPortals(game, { maxStates: 250000 }).status, 'unsatisfiable',
        `${game.Id}: Portal must be required, not an authoring decoration`);
    }

    replay(game, answer, false);
    replay(game, answer, true);
    for (let variant = 0; variant < 8; variant += 1) {
      const rotatedGame = transformLevel(game, variant);
      const rotatedAnswer = transformAnswer(answer, variant);
      assert.strictEqual(evaluate(rotatedGame, rotatedAnswer).score, rating.score,
        `${game.Id}: difficulty must be orientation-invariant`);
      replay(rotatedGame, rotatedAnswer, variant % 2 === 1);
    }

    const runner = new GameRunner(game, catalog.sets[4].Palette);
    const complete = hints.findComplete(runner, 4, levelIndex);
    assert(complete && complete.paths.length === game.Lines.length, `${game.Id}: complete hint missing`);
  });
};
