const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const dataDir = path.resolve(__dirname, '..', 'data');
  const names = [
    'clearedset_train', 'clearedset5', 'clearedset6',
    'clearedset7', 'clearedset8', 'clearedset9'
  ];

  names.forEach(name => {
    const json = JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));
    const compiled = require(path.join(dataDir, `${name}.js`));
    assert.deepStrictEqual(compiled, json, `${name}.js must match its JSON source`);
  });

  const catalogSource = fs.readFileSync(path.join(dataDir, 'catalog.js'), 'utf8');
  assert.strictEqual(/require\([^)]*\.json/.test(catalogSource), false);
  const runtimeCatalog = fs.readFileSync(path.join(dataDir, 'catalog-v2.js'), 'utf8');
  assert.strictEqual(/require\([^)]*\.json/.test(runtimeCatalog), false);
  const appSource = fs.readFileSync(path.resolve(dataDir, '..', 'src', 'app.js'), 'utf8');
  assert(appSource.includes("../data/catalog-v2.js"));
}

module.exports = run;
