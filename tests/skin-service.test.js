const assert = require('assert');
const SkinService = require('../src/services/skin-service.js');
const CanvasRenderer = require('../src/ui/canvas-renderer.js');

function run() {
  const settings = { skinId: 'night' };
  const progress = {
    getSetting(name, fallback) { return settings[name] === undefined ? fallback : settings[name]; },
    setSetting(name, value) { settings[name] = value; return true; }
  };
  const skins = new SkinService(progress, [{
    id: 'night',
    name: '夜间',
    colors: { text: '#111111' },
    assets: { logo: 'assets/night.png' },
    setStyles: {
      '5 x 5': { background: '#222222', palette: ['#abcdef'] }
    }
  }], () => true);

  assert.strictEqual(skins.current().id, 'night');
  assert.strictEqual(skins.current().colors.text, '#111111');
  assert.strictEqual(skins.current().colors.icon, '#ffffff', 'missing tokens inherit classic defaults');
  assert.deepStrictEqual(skins.setStyle({
    Name: '5 x 5', Color: '#00aba9', Palette: ['#f00']
  }), { background: '#222222', palette: ['#abcdef'] });
  assert.strictEqual(skins.select('classic'), true);
  assert.strictEqual(settings.skinId, 'classic');
  assert.strictEqual(skins.select('missing'), false);

  const locked = new SkinService(progress, [{ id: 'locked', name: '锁定' }]);
  assert.strictEqual(locked.select('locked'), false, 'selection requires explicit ownership');
  let saveAllowed = false;
  const unreliable = new SkinService({ getSetting: () => 'classic', setSetting: () => saveAllowed }, [{ id: 'night', name: '夜间' }], () => true);
  assert.strictEqual(unreliable.select('night'), false);
  assert.strictEqual(unreliable.current().id, 'classic');
  saveAllowed = true;
  assert.strictEqual(unreliable.select('night'), true);

  const loads = [];
  const renderer = new CanvasRenderer({
    context: {},
    createImage(source, callback) { loads.push({ source, callback }); return {}; }
  }, skins);
  skins.select('night');
  renderer.loadSkinAssets();
  loads[0].callback(null, { id: 'old-logo' });
  assert.strictEqual(renderer.images.logo, undefined, 'late assets from the old skin are ignored');
  loads[1].callback(null, { id: 'night-logo' });
  assert.strictEqual(renderer.images.logo.id, 'night-logo');
}

module.exports = run;
