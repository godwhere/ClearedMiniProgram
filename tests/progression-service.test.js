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
}

module.exports = run;
