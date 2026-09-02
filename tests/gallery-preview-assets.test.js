'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { decodePng } = require('../scripts/validate-theme-assets.js');
const { MAX_BYTES, analyzePreviewImage, previewAssets, checkProject } = require('../scripts/validate-gallery-previews.js');

function run() {
  const root = path.resolve(__dirname, '..');
  const report = checkProject(root);
  assert.strictEqual(report.assets.length, previewAssets(root).length,
    'every registered bitmap preview is checked, including newly added themes/effects');
  assert(report.assets.some(asset => asset.kind === 'theme'));
  assert(report.assets.some(asset => asset.kind === 'effect'));
  assert.strictEqual(report.totalBytes, report.assets.reduce((sum, asset) => sum + asset.bytes, 0));

  const theme = report.assets.find(asset => asset.kind === 'theme');
  const buffer = fs.readFileSync(path.join(root, theme.source));
  const image = decodePng(buffer);
  const issues = (override, bytes = buffer.length) =>
    analyzePreviewImage(Object.assign({}, image, override), bytes, 'theme').issues.join('; ');
  assert.strictEqual(issues({}), '');
  assert.match(issues({ width: 96 }), /128x128/);
  assert.match(issues({ colorType: 6 }), /indexed PNG-8/);
  assert.match(issues({ bitDepth: 4 }), /indexed PNG-8/);
  assert.match(issues({}, MAX_BYTES + 1), /8 KiB/);

  const colorful = Buffer.from(image.rgba);
  for (let color = 0; color < 129; color++) colorful.writeUInt32BE((color << 8) | 255, color * 4);
  assert.match(issues({ rgba: colorful }), /128 RGBA colors/,
    'an indexed PNG with too many actual colors must fail');
  const blank = Buffer.alloc(image.rgba.length);
  assert.match(issues({ rgba: blank }), /visible pixels/);
  assert.match(issues({ rgba: blank }), /slot 0 is empty/);
  const opaque = Buffer.from(image.rgba);
  for (let offset = 3; offset < opaque.length; offset += 4) opaque[offset] = 255;
  assert.match(issues({ rgba: opaque }), /transparent and visible/);
  const edge = Buffer.from(image.rgba);
  edge[3] = 255;
  assert.match(issues({ rgba: edge }), /2px transparent safety edge/,
    'visible pixels at a frame edge must fail even when dimensions are correct');
}

module.exports = run;
