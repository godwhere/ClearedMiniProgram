#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { decodePng } = require('./validate-theme-assets.js');
const { isIgnored, packageForFile } = require('./check-package-budget.js');

const SIZE = 128;
const MAX_COLORS = 128;
const MAX_BYTES = 8 * 1024;
const SAFE_MARGIN = 2;
const ALPHA_THRESHOLD = 8;

function analyzePreviewImage(image, bytes, kind) {
  const issues = [];
  if (image.width !== SIZE || image.height !== SIZE) issues.push('expected 128x128 pixels');
  if (image.colorType !== 3 || image.bitDepth !== 8) issues.push('expected indexed PNG-8');
  if (bytes > MAX_BYTES) issues.push('preview exceeds 8 KiB');
  const colors = new Set();
  let transparent = false;
  let visible = false;
  for (let offset = 0; offset < image.rgba.length; offset += 4) {
    colors.add(image.rgba.readUInt32BE(offset));
    const alpha = image.rgba[offset + 3];
    transparent = transparent || alpha === 0;
    visible = visible || alpha > ALPHA_THRESHOLD;
  }
  if (colors.size > MAX_COLORS) issues.push('preview exceeds 128 RGBA colors');
  if (!transparent || !visible) issues.push('preview must contain transparent and visible pixels');

  if (kind === 'theme' && image.width === SIZE && image.height === SIZE) {
    const cell = SIZE / 2;
    for (let slot = 0; slot < 4; slot++) {
      let count = 0;
      let touchesEdge = false;
      const x0 = (slot % 2) * cell;
      const y0 = Math.floor(slot / 2) * cell;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          if (image.rgba[((y0 + y) * SIZE + x0 + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
          count++;
          if (x < SAFE_MARGIN || y < SAFE_MARGIN || x >= cell - SAFE_MARGIN || y >= cell - SAFE_MARGIN) {
            touchesEdge = true;
          }
        }
      }
      if (!count) issues.push(`theme slot ${slot} is empty`);
      if (touchesEdge) issues.push(`theme slot ${slot} needs a 2px transparent safety edge`);
    }
  }
  return { issues, colors: colors.size };
}

function previewAssets(root) {
  const themes = require(path.join(root, 'src/skins/index.js')).filter(theme => theme.id !== 'classic');
  const effects = require(path.join(root, 'src/effects/index.js')).filter(effect => effect.preview);
  return themes.map(theme => ({
    id: theme.id, kind: 'theme', source: theme.preview,
    expected: `assets/theme-previews/${theme.id}.png`
  })).concat(effects.map(effect => ({
    id: effect.id, kind: 'effect', source: effect.preview,
    expected: `assets/effects/${effect.id}/preview.png`
  })));
}

function checkProject(root = path.resolve(__dirname, '..')) {
  const game = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const assets = previewAssets(root);
  const paths = new Set();
  const report = assets.map(asset => {
    if (asset.source !== asset.expected) throw new Error(`${asset.id}: expected preview '${asset.expected}'`);
    if (paths.has(asset.source)) throw new Error(`duplicate preview: ${asset.source}`);
    paths.add(asset.source);
    if (isIgnored(asset.source, project.packOptions.ignore) || packageForFile(asset.source, game.subpackages) !== 'main') {
      throw new Error(`${asset.source}: preview must ship in the main package`);
    }
    const buffer = fs.readFileSync(path.join(root, asset.source));
    const image = decodePng(buffer);
    const analysis = analyzePreviewImage(image, buffer.length, asset.kind);
    if (analysis.issues.length) throw new Error(`${asset.source}: ${analysis.issues.join('; ')}`);
    return Object.assign({}, asset, { bytes: buffer.length, colors: analysis.colors });
  });
  // Stale or unregistered outputs also cost main-package bytes.
  const directory = path.join(root, 'assets/theme-previews');
  fs.readdirSync(directory).forEach(name => {
    if (!paths.has(`assets/theme-previews/${name}`)) throw new Error(`unregistered theme preview: ${name}`);
  });
  return { assets: report, totalBytes: report.reduce((sum, item) => sum + item.bytes, 0) };
}

module.exports = { SIZE, MAX_COLORS, MAX_BYTES, analyzePreviewImage, previewAssets, checkProject };

if (require.main === module) {
  try {
    const report = checkProject();
    report.assets.forEach(asset => console.log(`PASS ${asset.source}: ${asset.bytes} bytes, ${asset.colors} colors`));
    console.log(`PASS ${report.assets.length} gallery previews: ${report.totalBytes} bytes total`);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
