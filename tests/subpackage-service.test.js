const assert = require('assert');
const SubpackageService = require('../src/services/subpackage-service.js');
const WechatPlatform = require('../src/platform/wechat.js');
const config = require('../src/config/subpackages.js');

function controlledPlatform() {
  const calls = [];
  return { calls, loadSubpackage(name, handlers) { calls.push({ name, ...handlers }); } };
}

async function run() {
  const platform = controlledPlatform();
  const service = new SubpackageService(platform);
  config.packages.forEach(item => {
    assert.strictEqual(service.packageForTheme(item.themeIds[0]), item.name);
    assert.strictEqual(service.packageForAsset(`${item.root}sheet.png`), item.name);
    assert.strictEqual(service.packageForAsset(`${item.root.slice(0, -1)}-other/sheet.png`), null);
    assert.strictEqual(service.isAssetReady(`${item.root}sheet.png`), false);
  });
  assert.strictEqual(service.isAssetReady('assets/logo.png'), true);
  assert.strictEqual(service.packageForTheme('classic'), null);
  assert.strictEqual((await service.ensureTheme('classic')).status, 'loaded');
  assert.strictEqual(platform.calls.length, 0);
  assert.deepStrictEqual(service.getThemeState('gem'), {
    name: 'theme-gem', status: 'idle', progress: 0, totalBytesWritten: 0,
    totalBytesExpectedToWrite: 0, attempts: 0, errorCode: null
  });
  const first = [];
  const second = [];
  const promise = service.ensureTheme('gem', value => first.push(value));
  assert.strictEqual(service.ensurePackage('theme-gem', value => second.push(value)), promise);
  service.ensureTheme('gem', () => { throw new Error('observer'); });
  assert.strictEqual(platform.calls.length, 1);
  assert.strictEqual(service.getThemeState('gem').status, 'loading');
  platform.calls[0].progress({ progress: 37, totalBytesWritten: 37, totalBytesExpectedToWrite: 100 });
  assert.strictEqual(first[first.length - 1].progress, 37);
  assert.strictEqual(second[second.length - 1].totalBytesWritten, 37);
  first[first.length - 1].status = 'loaded';
  assert.strictEqual(service.getThemeState('gem').status, 'loading', 'observers receive snapshots');
  platform.calls[0].progress({ progress: 150, totalBytesWritten: -1, totalBytesExpectedToWrite: Infinity });
  assert.strictEqual(service.getThemeState('gem').progress, 100);
  assert.strictEqual(service.getThemeState('gem').totalBytesWritten, 0);
  assert.strictEqual(service.getThemeState('gem').totalBytesExpectedToWrite, 0);
  platform.calls[0].success();
  assert.strictEqual((await promise).status, 'loaded');
  assert.strictEqual(service.ensureTheme('gem'), promise, 'success caches the shared promise');
  assert.strictEqual(service.isAssetReady('assets/skins/gem/gem-sprite-sheet.png'), true);
  platform.calls[0].fail(new Error('late failure'));
  assert.strictEqual(service.getThemeState('gem').status, 'loaded');
  assert.strictEqual(new SubpackageService(platform).isPackageReady('theme-gem'), false);

  const failed = service.ensureTheme('animals');
  const rejection = assert.rejects(failed, { code: 'SUBPACKAGE_LOAD_FAILED' });
  platform.calls[1].fail({ errMsg: 'network error with private details', code: 'untrusted' });
  await rejection;
  const snapshot = service.getThemeState('animals');
  assert.strictEqual(snapshot.status, 'failed');
  assert.strictEqual(snapshot.errorCode, 'SUBPACKAGE_LOAD_FAILED');
  assert(!JSON.stringify(snapshot).includes('private'));
  snapshot.status = 'loaded';
  assert.strictEqual(service.isPackageReady('theme-animals'), false);
  const retry = service.ensureTheme('animals');
  assert.notStrictEqual(retry, failed);
  assert.strictEqual(service.getThemeState('animals').attempts, 2);
  platform.calls[1].success();
  platform.calls[1].progress({ progress: 99 });
  assert.strictEqual(service.getThemeState('animals').status, 'loading', 'old callbacks cannot settle retry');
  platform.calls[2].success();
  await retry;

  for (const name of ['missing', '__proto__', 'constructor', 'prototype', null, {}, '../gem']) {
    await assert.rejects(service.ensurePackage(name), { code: 'SUBPACKAGE_INVALID_NAME' });
    await assert.rejects(service.ensureTheme(name), { code: 'SUBPACKAGE_INVALID_THEME' });
    assert.strictEqual(service.packageForTheme(name), null);
    assert.strictEqual(service.isPackageReady(name), false);
  }
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => new SubpackageService(platform, { packages: [{ name: id }] }));
    assert.throws(() => new SubpackageService(platform, { packages: [{
      name: 'safe', themeIds: [id], assetPrefixes: []
    }] }));
  }
  assert.strictEqual({}.polluted, undefined);
  assert.strictEqual(Object.getPrototypeOf(service.records), null);
  for (const host of [{}, { loadSubpackage() { throw new Error('host failed'); } }]) {
    const unsupported = new SubpackageService(host);
    await assert.rejects(unsupported.ensureTheme('gem'), {
      code: host.loadSubpackage ? 'SUBPACKAGE_LOAD_FAILED' : 'SUBPACKAGE_UNSUPPORTED'
    });
    assert.strictEqual(unsupported.getThemeState('gem').status, 'failed');
  }

  // Exercise the actual WeChat adapter without canvas setup or a network.
  const adapter = Object.create(WechatPlatform.prototype);
  adapter.api = {};
  const unsupported = new SubpackageService(adapter);
  await assert.rejects(unsupported.ensureTheme('gem'), { code: 'SUBPACKAGE_UNSUPPORTED' });
  assert.strictEqual(unsupported.isPackageReady('theme-gem'), false);
  let apiHandlers;
  let progress;
  adapter.api.loadSubpackage = handlers => {
    apiHandlers = handlers;
    return { onProgressUpdate(callback) { progress = callback; } };
  };
  const real = new SubpackageService(adapter);
  const loaded = real.ensureTheme('gem');
  assert.strictEqual(apiHandlers.name, 'theme-gem');
  progress({ progress: 25 });
  assert.strictEqual(real.getThemeState('gem').progress, 25);
  apiHandlers.success();
  await loaded;
  const sync = new SubpackageService({ loadSubpackage(name, handlers) { handlers.success(); } });
  const syncPromise = sync.ensureTheme('gem');
  assert.strictEqual(sync.ensureTheme('gem'), syncPromise);
  assert.strictEqual((await syncPromise).status, 'loaded');
}

module.exports = run;
module.exports.controlledPlatform = controlledPlatform;
