const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const subpackageConfig = require('../src/config/subpackages.js');
const skins = require('../src/skins/index.js');
const dailyConfig = require('../src/config/daily.js');
const cloudbaseInternal = require('../src/config/cloudbase.internal.js');
const cloudbaseRelease = require('../src/config/cloudbase.release.js');
const { isIgnored } = require('../scripts/check-package-budget.js');

function run() {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const gameConfig = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));

  assert.strictEqual(config.compileType, 'game');
  // Keep the smoke contract aligned with the AppID currently configured for
  // this imported project.
  assert.strictEqual(config.appid, 'wx7fb1a0811192cd97');
  assert.strictEqual(config.setting.compileHotReLoad, false);
  assert.strictEqual(dailyConfig.debugUnlimitedEntries, false);
  assert.strictEqual(cloudbaseInternal.enabled, true);
  assert.strictEqual(cloudbaseInternal.env, 'cloudbase-d9gpluqt21ba89532');
  assert.strictEqual(cloudbaseInternal.testOnly, true);
  assert.strictEqual(cloudbaseInternal.productionOnly, false);
  assert.strictEqual(typeof cloudbaseInternal.migrationEnabled, 'boolean');
  assert.strictEqual(cloudbaseInternal.economyEnabled, true);
  assert.strictEqual(cloudbaseRelease.enabled, true);
  assert.strictEqual(cloudbaseRelease.env, 'cloudbase-d9gpluqt21ba89532');
  assert.strictEqual(cloudbaseRelease.testOnly, false);
  assert.strictEqual(cloudbaseRelease.productionOnly, true);
  assert.strictEqual(fs.existsSync(path.join(root, 'game.js')), true);
  assert.strictEqual(gameConfig.deviceOrientation, 'portrait');
  const packages = gameConfig.subpackages;
  assert.strictEqual(packages.length, 12);
  assert.deepStrictEqual(packages, subpackageConfig.packages.map(item => ({ name: item.name, root: item.root })));
  const themeIds = ['gem', 'animals', 'fruits', 'desserts', 'space',
    'ocean', 'spring', 'festival', 'music', 'vehicles'];
  const themePackages = packages.slice(0, themeIds.length);
  const audioPackage = packages[themeIds.length];
  assert.deepStrictEqual(themePackages.map(item => item.name), themeIds.map(id => `theme-${id}`));
  assert.deepStrictEqual(audioPackage, { name: 'audio-bgm', root: 'assets/audio/bgm/' });
  assert.deepStrictEqual(packages[11], { name: 'audio-candy-day-stroll', root: 'assets/audio/candy-day-stroll/' });
  assert.strictEqual(new Set(packages.map(item => item.name)).size, 12);
  assert.strictEqual(new Set(packages.map(item => item.root)).size, 12);
  const ignored = source => isIgnored(source, config.packOptions.ignore);
  themePackages.forEach((item, index) => {
    assert.strictEqual(item.root, `assets/skins/${themeIds[index]}/`);
    assert.deepStrictEqual(Object.keys(item).sort(), ['name', 'root']);
    assert(!packages.some(other => other !== item && other.root.startsWith(item.root)));
    assert(fs.statSync(path.join(root, item.root)).isDirectory());
    const entry = `${item.root}game.js`;
    assert(fs.statSync(path.join(root, entry)).isFile());
    assert(!ignored(entry));
    // An asset-only entry can run with no require, wx or GameGlobal, and must
    // leave the host global unchanged and export only an empty object.
    const sandbox = { module: { exports: null } };
    vm.runInNewContext(fs.readFileSync(path.join(root, entry), 'utf8'), sandbox);
    assert.deepStrictEqual(Object.keys(sandbox), ['module']);
    assert.strictEqual(JSON.stringify(sandbox.module.exports), '{}');
    const runtime = subpackageConfig.packages[index];
    assert.deepStrictEqual(runtime.themeIds, [themeIds[index]]);
    assert.deepStrictEqual(runtime.assetPrefixes, [item.root]);
    const theme = skins.find(skin => skin.id === themeIds[index]);
    const sheet = theme.assets.tileSheet;
    assert(sheet.startsWith(item.root));
    assert(fs.statSync(path.join(root, sheet)).isFile());
    assert(!ignored(sheet), 'formal theme sheets must ship in their subpackage');
  });
  const audioRuntime = subpackageConfig.packages[themeIds.length];
  assert.deepStrictEqual(audioRuntime.themeIds, []);
  assert.deepStrictEqual(audioRuntime.assetPrefixes, ['assets/audio/bgm/']);
  const audioEntry = `${audioPackage.root}game.js`;
  assert(fs.statSync(path.join(root, audioEntry)).isFile());
  assert(!ignored(audioEntry));
  const audioSandbox = { module: { exports: null } };
  vm.runInNewContext(fs.readFileSync(path.join(root, audioEntry), 'utf8'), audioSandbox);
  assert.deepStrictEqual(Object.keys(audioSandbox), ['module']);
  assert.strictEqual(JSON.stringify(audioSandbox.module.exports), '{}');
  assert(fs.statSync(path.join(root, 'assets/audio/bgm/cleared-bgm.m4a')).isFile());
  assert.strictEqual(fs.existsSync(path.join(root, 'assets/audio/cleared-bgm.m4a')), false);
  assert(!ignored('assets/icons/portal.png'));
  assert(ignored('src/config/cloudbase.local.js'));
  assert(!ignored('src/config/cloudbase.internal.js'));
  assert(ignored('assets/skins/animals/drafts/example.png'));
  ['pages', 'app.js', 'app.json', 'app.wxss', 'sitemap.json', 'design-qa.md',
    'assets/audio/victory.m4a', 'assets/icons/bomb.png'].forEach(file => {
    assert.strictEqual(fs.existsSync(path.join(root, file)), false,
      `${file} must not return as a parallel or obsolete artifact`);
  });
  ['docs/package-splitting.md', '.github/workflows/check.yml', 'AGENTS.md',
    '.gitattributes', '.gitignore'].forEach(file => assert(ignored(file), file));
  ['.DS_Store', 'assets/.DS_Store', 'src/.DS_Store'].forEach(file => {
    assert.strictEqual(ignored(file), true, `${file} is excluded by an exact file rule`);
    assert.strictEqual(ignored(`${file}/child`), false, `${file} rule must not become a folder prefix`);
  });
  ['src/bootstrap.js', 'core/game-runner.js', 'data/catalog.js', 'src/skins/classic.js',
    'assets/audio/bgm/cleared-bgm.m4a'].forEach(file => assert(!ignored(file), file));

  const runtimeFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const source = path.join(directory, entry.name);
    return entry.isDirectory() ? runtimeFiles(source) : [source];
  });
  runtimeFiles(path.join(root, 'src')).filter(file => file.endsWith('.js')).forEach(file => {
    if (file === path.join(root, 'src/platform/wechat.js')) return;
    assert(!/\bwx\s*(?:\.|\[)/.test(fs.readFileSync(file, 'utf8')), `${file} bypasses platform boundary`);
  });
}

module.exports = run;
