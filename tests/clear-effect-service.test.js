const assert = require('assert');
const ClearEffectService = require('../src/services/clear-effect-service.js');
const effects = require('../src/effects/index.js');
const none = require('../src/effects/none.js');
const fade = require('../src/effects/fade.js');

class MemoryProgress {
  constructor(settings) {
    this.settings = Object.assign({}, settings || {});
    this.writes = [];
  }

  getSetting(name, fallback) {
    return this.settings[name] === undefined ? fallback : this.settings[name];
  }

  setSetting(name, value) {
    this.settings[name] = value;
    this.writes.push({ name, value });
    return true;
  }
}

function run() {
  const progress = new MemoryProgress();
  const service = new ClearEffectService(progress, [], () => true);
  assert.deepStrictEqual(effects.map(effect => effect.id), ['none', 'fade']);
  assert.strictEqual(service.current().id, 'none');
  assert.deepStrictEqual(service.get('none'), none);
  assert.deepStrictEqual(service.get('fade'), fade);
  assert.strictEqual(service.get('missing'), null);
  assert.strictEqual(service.resolve('missing').id, 'fade');
  assert.strictEqual(new ClearEffectService(new MemoryProgress()).select('fade'), false,
    'fade requires explicit ownership');
  assert.deepStrictEqual(service.list(), [
    {
      id: 'none',
      name: '无特效',
      type: 'none',
      preview: 'assets/effects/none/preview.png'
    },
    {
      id: 'fade',
      name: '逐渐消失',
      type: 'fade',
      preview: 'assets/effects/fade/preview.png'
    }
  ]);

  // Returned manifests/descriptors must not mutate the registry.
  const current = service.current();
  current.params.changed = true;
  current.name = 'changed';
  assert.strictEqual(service.current().params.changed, undefined);
  assert.strictEqual(service.current().name, '无特效');

  const custom = {
    id: 'soft',
    name: '柔和',
    type: 'custom',
    preview: 'assets/effects/soft/preview.png',
    durationMs: 240,
    params: {
      alphaFrom: 0.9,
      alphaTo: 0.1,
      scaleFrom: 1,
      scaleTo: 1.05,
      staggerRatio: 0.02
    }
  };
  const withCustom = new ClearEffectService(progress, [
    { id: 'fade', name: '伪造渐隐', type: 'none', durationMs: 0, params: {} },
    { id: '0', name: '数字 ID', type: 'fade' },
    custom,
    custom,
    null,
    {
    id: 'bad-network', name: '坏', type: 'fade', preview: 'https://example.com/x.png'
  }, {
    id: 'bad-function', name: '坏', type: 'fade', render() {}
  }, {
    id: '__proto__', name: '坏', type: 'fade'
  }], () => true);
  assert.strictEqual(withCustom.get('soft').durationMs, 240);
  assert.strictEqual(withCustom.get('soft').preview, 'assets/effects/soft/preview.png');
  assert.deepStrictEqual(withCustom.list().map(item => item.id), ['none', 'fade', '0', 'soft'],
    'gallery order follows registration order even for integer-like IDs');
  assert.deepStrictEqual(withCustom.get('fade'), fade,
    'extensions must not overwrite the built-in compatibility fallback');
  assert.strictEqual(withCustom.list().filter(item => item.id === 'soft').length, 1);
  assert.strictEqual(withCustom.get('bad-network'), null);
  assert.strictEqual(withCustom.get('bad-function'), null);
  assert.strictEqual(withCustom.get('__proto__'), null);
  const hiddenFunction = { id: 'hidden-function', name: '坏', type: 'fade' };
  Object.defineProperty(hiddenFunction, 'render', { value() {}, enumerable: false });
  assert.strictEqual(new ClearEffectService(new MemoryProgress(), [hiddenFunction]).get('hidden-function'), null);
  const noPreview = new ClearEffectService(new MemoryProgress(), [{
    id: 'no-preview', name: '无预览', type: 'fade'
  }]);
  assert.strictEqual(noPreview.get('no-preview').preview, undefined,
    'missing custom previews should use renderer fallback, not fade artwork');
  const embeddedUrl = new ClearEffectService(new MemoryProgress(), [{
    id: 'embedded-url', name: '坏', type: 'fade', preview: 'assets/http://evil.example/x.png'
  }]);
  assert(embeddedUrl.get('embedded-url'), 'invalid preview must not disable the effect itself');
  assert.strictEqual(embeddedUrl.get('embedded-url').preview, undefined);
  assert.strictEqual(withCustom.select('soft'), true);
  assert.strictEqual(withCustom.current().id, 'soft');
  assert.strictEqual(progress.settings.clearEffectId, 'soft');
  assert.strictEqual(withCustom.select('missing'), false);
  assert.strictEqual(progress.settings.clearEffectId, 'soft');
  const failingProgress = new MemoryProgress();
  failingProgress.setSetting = () => false;
  const failingSelection = new ClearEffectService(failingProgress, [], () => true);
  assert.strictEqual(failingSelection.select('fade'), false);
  assert.strictEqual(failingSelection.current().id, 'none');

  // A corrupt saved selection falls back without rewriting unrelated settings.
  const corruptProgress = new MemoryProgress({
    clearEffectId: { toString() { throw new Error('must not coerce'); } },
    skinId: 'classic'
  });
  const recovered = new ClearEffectService(corruptProgress, [custom]);
  assert.strictEqual(recovered.current().id, 'none');
  assert.strictEqual(corruptProgress.settings.skinId, 'classic');
  assert.strictEqual(corruptProgress.writes.length, 0);

  // Numeric values are bounded and normalized to safe finite values.
  const bounded = new ClearEffectService(new MemoryProgress(), [{
    id: 'bounded',
    name: '边界',
    type: 'fade',
    durationMs: 9999,
    params: {
      alphaFrom: -2,
      alphaTo: 5,
      scaleFrom: 0,
      scaleTo: Infinity,
      staggerRatio: 1
    }
  }]);
  // Infinity makes the manifest invalid as a whole; only the guaranteed
  // built-in fallback remains available.
  assert.strictEqual(bounded.get('bounded'), null);
  assert.strictEqual(bounded.resolve('bounded').id, 'fade');
}

module.exports = run;
