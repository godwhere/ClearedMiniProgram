const assert = require('assert');
const catalog = require('../data/catalog-v2.js');
const solutions = require('../data/solutions.js');
const GameRunner = require('../core/game-runner.js');

function adjacent(one, two, width) {
  return Math.abs((one % width) - (two % width)) +
    Math.abs(Math.floor(one / width) - Math.floor(two / width)) === 1;
}

function run() {
  assert(Array.isArray(solutions.sets), 'solutions must expose sets');
  assert.strictEqual(solutions.sets.length, catalog.sets.length);
  assert.deepStrictEqual(solutions.sets.map(set => set.length), [2, 5, 10, 15, 30]);
  assert.strictEqual(solutions.sets.reduce((total, set) => total + set.length, 0), 62,
    'the flat solution table reserves 62 ordinary-set slots');
  assert.strictEqual(solutions.sets[1][4], null, 'level 7 slot must be null');
  assert.strictEqual(solutions.sets[2][9], null, 'level 17 slot must be null');
  assert.strictEqual(solutions.sets[3][14], null, 'level 32 slot must be null');
  assert.strictEqual(solutions.sets[4][14], null, 'level 47 slot must be null');
  const nonNullCount = solutions.sets.reduce((total, set) =>
    total + set.filter(sol => sol !== null).length, 0);
  assert.strictEqual(nonNullCount, 58,
    'the legacy flat solution table contains exactly 58 non-Portal level solutions');
  assert(solutions.ByLevelId && typeof solutions.ByLevelId === 'object',
    'mixed chapter ordinary solutions must expose a stable-ID table');
  assert.strictEqual(Object.keys(solutions.ByLevelId).length, 19,
    'the mixed chapter must publish exactly 19 additional ordinary solutions');

  const ordinaryIds = new Set();
  let ordinaryCount = 0;

  catalog.sets.forEach((set, setIndex) => {
    const setSolutions = solutions.sets[setIndex];
    assert(Array.isArray(setSolutions), `${set.Name} solutions missing`);
    const ordinaryGames = (set.Games || []).reduce((result, game, levelIndex) => {
      if (!game || game.Mechanic === 'portal' || game.mechanic === 'portal') return result;
      result.push({ game, levelIndex });
      return result;
    }, []);
    ordinaryGames.forEach(({ game, levelIndex }) => {
      ordinaryCount += 1;
      const keyed = game.Id && Object.prototype.hasOwnProperty.call(solutions.ByLevelId, game.Id)
        ? solutions.ByLevelId[game.Id] : null;
      if (keyed) ordinaryIds.add(game.Id);
      const paths = keyed || setSolutions[levelIndex];
      const total = game.Width * game.Height;
      assert(Array.isArray(paths), `${set.Name}/${game.Name} paths missing`);
      assert.strictEqual(paths.length, game.Lines.length);
      const covered = [];
      game.Lines.forEach((line, lineIndex) => {
        const path = paths[lineIndex];
        assert(Array.isArray(path) && path.length >= 2,
          `${set.Name}/${game.Name}/${lineIndex} path missing`);
        assert.strictEqual(path[0], line.Start);
        assert.strictEqual(path[path.length - 1], line.End);
        const seen = new Set();
        path.forEach((cell, order) => {
          assert(Number.isInteger(cell) && cell >= 0 && cell < total,
            `${set.Name}/${game.Name}/${lineIndex} cell out of range`);
          assert(!seen.has(cell), `${set.Name}/${game.Name}/${lineIndex} repeats a cell`);
          seen.add(cell);
          if (order > 0) assert(adjacent(path[order - 1], cell, game.Width),
            `${set.Name}/${game.Name}/${lineIndex} has a non-adjacent step`);
          covered.push(cell);
        });
      });
      assert.strictEqual(covered.length, total, `${set.Name}/${game.Name} does not cover board`);
      assert.strictEqual(new Set(covered).size, total, `${set.Name}/${game.Name} overlaps paths`);

      const runner = new GameRunner(game, set.Palette || []);
      paths.forEach((path, lineIndex) => {
        assert.strictEqual(runner.touchStart(path[0]), true,
          `${set.Name}/${game.Name}/${lineIndex} runtime start rejected`);
        path.slice(1).forEach(cell => {
          assert.strictEqual(runner.touchMove(cell), true,
            `${set.Name}/${game.Name}/${lineIndex} runtime move rejected`);
        });
        assert.strictEqual(runner.touchEnd(path[path.length - 1]), true,
          `${set.Name}/${game.Name}/${lineIndex} runtime completion rejected`);
      });
      assert.strictEqual(runner.outcome, GameRunner.OUTCOME.WON,
        `${set.Name}/${game.Name} official solution must win`);
    });
  });
  assert.strictEqual(ordinaryCount, 77,
    'the 97-level catalog must contain 77 ordinary and 20 Portal levels');
  assert.deepStrictEqual(Array.from(ordinaryIds).sort(), Object.keys(solutions.ByLevelId).sort(),
    'the ID-indexed ordinary table must not contain stale or Portal-only entries');
}

module.exports = run;
