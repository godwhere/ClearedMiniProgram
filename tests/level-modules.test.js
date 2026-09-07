const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const dataDir = path.resolve(__dirname, '..', 'data');
  const names = [
    'clearedset_train', 'clearedset5', 'clearedset6',
    'clearedset7', 'clearedset8'
  ];

  names.forEach(name => {
    const json = JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));
    const compiled = require(path.join(dataDir, `${name}.js`));
    assert.deepStrictEqual(compiled, json, `${name}.js must match its JSON source`);
  });

  assert.strictEqual(fs.existsSync(path.join(dataDir, 'clearedset9.json')), false);
  assert.strictEqual(fs.existsSync(path.join(dataDir, 'clearedset9.js')), false);

  const catalogSource = fs.readFileSync(path.join(dataDir, 'catalog.js'), 'utf8');
  assert.strictEqual(/require\([^)]*\.json/.test(catalogSource), false);
  const runtimeCatalog = fs.readFileSync(path.join(dataDir, 'catalog-v2.js'), 'utf8');
  assert.strictEqual(/require\([^)]*\.json/.test(runtimeCatalog), false);
  const catalog = require(path.join(dataDir, 'catalog-v2.js'));
  assert.strictEqual(catalog.sets.length, 5);
  assert.strictEqual(catalog.levels.length, 137);

  const portalPositions = [
    { index: 6, setIndex: 1, levelIndex: 4, id: 'portal-main-5x5-01', name: '传送初识' },
    { index: 16, setIndex: 2, levelIndex: 9, id: 'portal-main-6x6-01', name: '跨区接力' },
    { index: 31, setIndex: 3, levelIndex: 14, id: 'portal-main-7x7-01', name: '出口选择' },
    { index: 46, setIndex: 4, levelIndex: 14, id: 'portal-main-8x8-01', name: '传送规划' }
  ];

  portalPositions.forEach(pos => {
    const entry = pos.setIndex === 4 ? catalog.levels.find(level =>
      level.setIndex === pos.setIndex && level.levelIndex === pos.levelIndex) : catalog.levels[pos.index];
    assert(entry, `level position ${pos.index} must exist in catalog`);
    assert.strictEqual(entry.setIndex, pos.setIndex);
    assert.strictEqual(entry.levelIndex, pos.levelIndex);
    assert.strictEqual(entry.game.Id, pos.id);
    assert.strictEqual(entry.game.Name, pos.name);
    assert.strictEqual(entry.game.Mechanic, 'portal');
  });

  const appSource = fs.readFileSync(path.resolve(dataDir, '..', 'src', 'app.js'), 'utf8');
  assert(appSource.includes("../data/catalog-v2.js"));
}

module.exports = run;
