'use strict';

const assert = require('assert');
const path = require('path');
const skins = require('../src/skins/index.js');
const {
  EXPECTED_HEIGHT,
  EXPECTED_WIDTH,
  SAFE_MARGIN,
  SLOT_COUNT,
  validateFile
} = require('../scripts/validate-theme-assets.js');

function run() {
  const root = path.resolve(__dirname, '..');
  const themes = skins.filter(skin => skin.id !== 'classic');
  assert.strictEqual(themes.length, 10, 'all ten non-classic theme manifests must be validated');

  const assetPaths = themes.map(theme => {
    assert(theme.assets && theme.assets.tileSheet, `${theme.id}: tileSheet asset is required`);
    return path.resolve(root, theme.assets.tileSheet);
  });
  assert.strictEqual(new Set(assetPaths).size, themes.length,
    'each non-classic theme must use a unique sprite sheet');

  themes.forEach((theme, index) => {
    const assetPath = assetPaths[index];
    const { image, analysis } = validateFile(assetPath);
    assert.strictEqual(image.width, EXPECTED_WIDTH, `${theme.id}: sprite-sheet width`);
    assert.strictEqual(image.height, EXPECTED_HEIGHT, `${theme.id}: sprite-sheet height`);
    assert.strictEqual(image.rgba.length, EXPECTED_WIDTH * EXPECTED_HEIGHT * 4,
      `${theme.id}: decoded RGBA byte count`);
    assert.strictEqual(analysis.slots.length, SLOT_COUNT, `${theme.id}: analyzed slot count`);
    assert.strictEqual(analysis.populatedSlots, SLOT_COUNT, `${theme.id}: populated slot count`);
    assert(analysis.minMargin >= SAFE_MARGIN,
      `${theme.id}: minimum transparent edge is ${analysis.minMargin}px`);
    analysis.slots.forEach(slot => {
      assert.strictEqual(slot.empty, false, `${theme.id}: slot ${slot.slot} must not be empty`);
      Object.keys(slot.margins).forEach(side => {
        assert(slot.margins[side] >= SAFE_MARGIN,
          `${theme.id}: slot ${slot.slot} ${side} edge is ${slot.margins[side]}px`);
      });
    });
    assert.deepStrictEqual(analysis.issues, [],
      `${theme.id}: ${analysis.issues.join('; ')}`);
  });
}

module.exports = run;
