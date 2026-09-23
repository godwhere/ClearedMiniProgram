const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const budget = require('../scripts/check-package-budget.js');

function run() {
  const root = path.resolve(__dirname, '..');
  const report = budget.checkProject(root);
  assert.deepStrictEqual(report.errors, []);
  assert.strictEqual(report.packages.length, 12, 'main plus ten theme packages and one audio package');
  assert(report.packages.every(row => row.passed));
  assert(report.total.passed);
  assert.strictEqual(report.total.bytes, report.packages.reduce((sum, row) => sum + row.bytes, 0));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const packages = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8')).subpackages;
  ['output/pdf/example.pdf', 'tmp/previews/page.png'].forEach(file => {
    assert.strictEqual(budget.isIgnored(file, config.packOptions.ignore), true, 'local artifacts must not ship');
  });
  ['data/daily-mechanic-pack.js', 'data/daily-mechanic-solutions.js',
    'data/daily-four-week-pack.js', 'data/daily-four-week-solutions.js'].forEach(file => {
    assert.strictEqual(budget.isIgnored(file, config.packOptions.ignore), false, 'daily content must ship');
  });
  require('../src/skins/index.js').filter(skin => skin.id !== 'classic').forEach(skin => {
    assert.strictEqual(budget.isIgnored(skin.assets.tileSheet, config.packOptions.ignore), false);
    assert.strictEqual(budget.packageForFile(skin.assets.tileSheet, packages), `theme-${skin.id}`);
    const row = report.packages.find(item => item.name === `theme-${skin.id}`);
    assert(row.largestFiles.some(file => file.path === skin.assets.tileSheet));
    assert.strictEqual(budget.packageForFile(skin.preview, packages), 'main',
      `${skin.id}: small preview stays outside its board-art subpackage`);
    assert.strictEqual(budget.isIgnored(skin.preview, config.packOptions.ignore), false);
  });
  ['game.js', 'src/bootstrap.js', 'core/game-runner.js', 'data/solutions.js',
    'src/skins/classic.js', 'assets/logo.png', 'assets/icons/portal.png',
    'assets/effects/fade/preview.png'].forEach(source => {
    assert.strictEqual(budget.packageForFile(source, packages), 'main');
    assert.strictEqual(budget.isIgnored(source, config.packOptions.ignore), false);
  });
  const bgm = 'assets/audio/bgm/cleared-bgm.m4a';
  assert.strictEqual(budget.packageForFile(bgm, packages), 'audio-bgm');
  assert.strictEqual(budget.isIgnored(bgm, config.packOptions.ignore), false);
  const audioRow = report.packages.find(item => item.name === 'audio-bgm');
  assert(audioRow.largestFiles.some(file => file.path === bgm));
  assert.strictEqual(fs.existsSync(path.join(root, 'assets/audio/cleared-bgm.m4a')), false,
    'the BGM has no duplicate main-package original');
  Object.values(require('../src/config/audio.js').sfx).forEach(definition => {
    assert.strictEqual(budget.packageForFile(definition.src, packages), 'main');
    assert.strictEqual(budget.isIgnored(definition.src, config.packOptions.ignore), false);
  });
  assert.strictEqual(budget.BUDGETS.main, Math.floor(1.6 * 1024 * 1024));
  ['none', 'fade'].forEach(id => {
    const preview = `assets/effects/${id}/preview.png`;
    assert.strictEqual(budget.packageForFile(preview, packages), 'main');
    assert.strictEqual(budget.isIgnored(preview, config.packOptions.ignore), false);
    assert.strictEqual(budget.isIgnored(`scripts/gallery-preview-sources/effects/${id}.png`,
      config.packOptions.ignore), true, 'full-size effect source art never ships');
  });

  const fixturePackages = [{ name: 'theme-a', root: 'assets/a/' }];
  const entry = { path: 'assets/a/game.js', bytes: 0 };
  const fixtures = [entry, { path: 'main.js', bytes: 100 }, { path: 'assets/a/sheet.png', bytes: 200 },
    { path: 'assets/ab/logo.png', bytes: 50 }, { path: '.git/objects/abc', bytes: 99999999 },
    { path: 'docs/large.md', bytes: 99999999 }, { path: 'readme', bytes: 99999999 }];
  const ignore = [{ type: 'folder', value: 'docs' }, { type: 'file', value: 'readme' }];
  const small = budget.analyzePackageBudget(fixtures, fixturePackages, ignore);
  assert.strictEqual(small.packages[0].bytes, 150);
  assert.strictEqual(small.packages[1].bytes, 200);
  assert.strictEqual(small.total.bytes, 350);
  assert.strictEqual(small.packages[0].largestFiles[0].path, 'main.js');
  assert.strictEqual(budget.isIgnored('docs-extra/a', ignore), false);
  assert.strictEqual(budget.isIgnored('readme/child', ignore), false);
  const exactMetadata = [
    { type: 'file', value: '.DS_Store' },
    { type: 'file', value: 'assets/.DS_Store' },
    { type: 'file', value: 'src/.DS_Store' }
  ];
  exactMetadata.forEach(rule => {
    assert.strictEqual(budget.isIgnored(rule.value, exactMetadata), true);
    assert.strictEqual(budget.isIgnored(`${rule.value}/child`, exactMetadata), false);
  });
  assert.strictEqual(budget.isIgnored('nested/.DS_Store', exactMetadata), false,
    'metadata exclusion remains an exact approved path list');

  const limits = budget.BUDGETS;
  const at = budget.analyzePackageBudget([entry,
    { path: 'main.js', bytes: limits.main }, { path: 'assets/a/sheet', bytes: limits.subpackage }
  ], fixturePackages, []);
  assert.deepStrictEqual(at.errors, [], 'inclusive project limits');
  const over = budget.analyzePackageBudget([entry,
    { path: 'main.js', bytes: limits.main + 1 }, { path: 'assets/a/sheet', bytes: limits.subpackage + 1 }
  ], fixturePackages, []);
  assert.strictEqual(over.errors.length, 2);
  const hard = budget.analyzePackageBudget([entry, { path: 'main.js', bytes: limits.platformHardLimit }],
    fixturePackages, [], Object.assign({}, limits, { main: limits.platformHardLimit }));
  assert(hard.errors.some(message => message.includes('strictly below')));
  const total = budget.analyzePackageBudget(fixtures, fixturePackages, ignore, Object.assign({}, limits, { total: 349 }));
  assert.deepStrictEqual(total.errors, ['total exceeds project budget']);
  assert.deepStrictEqual(budget.analyzePackageBudget(fixtures, fixturePackages, ignore,
    Object.assign({}, limits, { total: 350 })).errors, []);
  for (const rootValue of ['assets/a', '/assets/a/', '../assets/a/', 'assets/../a/', 'assets\\a/', 'assets//a/']) {
    assert.throws(() => budget.validateSubpackages([{ name: 'a', root: rootValue }]));
  }
  for (const extra of [
    { name: 'other', root: 'assets/a/' }, { name: 'other', root: 'assets/a/nested/' },
    { name: 'other', root: 'assets/' }, { name: 'theme-a', root: 'assets/b/' }
  ]) assert.throws(() => budget.validateSubpackages(fixturePackages.concat([extra])));
  assert.throws(() => budget.validateSubpackages([{ name: '__proto__', root: 'assets/a/' }]));
  assert.throws(() => budget.validateSubpackages([{ name: 'a', root: 'assets/a/', independent: true }]));
  assert.throws(() => budget.analyzePackageBudget([], fixturePackages, []), /Missing published entry/);
  assert.throws(() => budget.analyzePackageBudget([entry], fixturePackages,
    [{ type: 'file', value: entry.path }]), /Missing published entry/);
  assert.throws(() => budget.analyzePackageBudget([], [], [{ type: 'unknown', value: 'x' }]), /Unsupported/);

  // CLI must fail for actual source files over budget, without checking in a
  // large fixture. The sparse file lives only in a temporary directory.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cleared-budget-'));
  try {
    fs.writeFileSync(path.join(temporary, 'game.json'), JSON.stringify({ subpackages: [] }));
    fs.writeFileSync(path.join(temporary, 'project.config.json'), JSON.stringify({ packOptions: { ignore: [] } }));
    const big = path.join(temporary, 'large.bin');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, limits.main + 1);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-package-budget.js'), temporary], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1);
    assert(result.stdout.includes('FAIL main'));
    assert(result.stdout.includes('large.bin'));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = run;
