const assert = require('assert');
const ProgressionService = require('../src/services/progression-service.js');

class ProgressMock {
  constructor() { this.completed = {}; }
  isCompleted(setIndex, levelIndex) { return !!this.completed[`${setIndex}:${levelIndex}`]; }
  complete(setIndex, levelIndex) { this.completed[`${setIndex}:${levelIndex}`] = true; }
}

function run() {
  const sets = [
    { Games: [{}, {}] },
    { Games: [{}, {}] }
  ];
  const progress = new ProgressMock();
  const global = new ProgressionService(progress, sets, { unlockAcrossSets: true });

  assert.strictEqual(global.isUnlocked(0, 0), true);
  assert.strictEqual(global.isUnlocked(0, 1), false);
  assert.strictEqual(global.isUnlocked(1, 0), false);
  progress.complete(0, 0);
  assert.strictEqual(global.isUnlocked(0, 1), true);
  progress.complete(0, 1);
  assert.strictEqual(global.isUnlocked(1, 0), true, 'finishing a set unlocks the next set');
  assert.strictEqual(global.isUnlocked(1, 1), false);
  progress.complete(1, 1);
  assert.strictEqual(global.isUnlocked(1, 1), true, 'completed levels remain accessible');
  assert.strictEqual(global.isUnlocked(9, 0), false);
  assert.deepStrictEqual(global.nextLevel(0, 1), { setIndex: 1, levelIndex: 0 });
  assert.strictEqual(global.nextLevel(1, 1), null);

  const independent = new ProgressionService(new ProgressMock(), sets, { unlockAcrossSets: false });
  assert.strictEqual(independent.isUnlocked(0, 0), true);
  assert.strictEqual(independent.isUnlocked(1, 0), true);
  assert.strictEqual(independent.isUnlocked(1, 1), false);

  const catalog = require('../data/catalog-v2.js');
  const catalogProgress = new ProgressMock();
  const catalogProgression = new ProgressionService(catalogProgress, catalog.sets, { unlockAcrossSets: true });

  // 6 -> 7 -> 8:
  assert.deepStrictEqual(catalogProgression.nextLevel(1, 3), { setIndex: 1, levelIndex: 4 });
  assert.deepStrictEqual(catalogProgression.nextLevel(1, 4), { setIndex: 2, levelIndex: 0 });

  // 16 -> 17 -> 18:
  assert.deepStrictEqual(catalogProgression.nextLevel(2, 8), { setIndex: 2, levelIndex: 9 });
  assert.deepStrictEqual(catalogProgression.nextLevel(2, 9), { setIndex: 3, levelIndex: 0 });

  // 31 -> 32 -> 33:
  assert.deepStrictEqual(catalogProgression.nextLevel(3, 13), { setIndex: 3, levelIndex: 14 });
  assert.deepStrictEqual(catalogProgression.nextLevel(3, 14), { setIndex: 4, levelIndex: 0 });

  // 46 -> 47 -> 48:
  assert.deepStrictEqual(catalogProgression.nextLevel(4, 13), { setIndex: 4, levelIndex: 14 });
  assert.deepStrictEqual(catalogProgression.nextLevel(4, 14), { setIndex: 4, levelIndex: 15 });

  for (let i = 0; i < 2; i++) catalogProgress.complete(0, i);
  for (let i = 0; i < 3; i++) catalogProgress.complete(1, i);
  assert.strictEqual(catalogProgression.isUnlocked(1, 3), true);
  assert.strictEqual(catalogProgression.isUnlocked(1, 4), false);
  catalogProgress.complete(1, 3);
  assert.strictEqual(catalogProgression.isUnlocked(1, 4), true, 'completing level 6 unlocks level 7 (portal milestone)');
  assert.strictEqual(catalogProgression.isUnlocked(2, 0), false);
  catalogProgress.complete(1, 4);
  assert.strictEqual(catalogProgression.isUnlocked(2, 0), true, 'completing level 7 unlocks level 8');
}

module.exports = run;
