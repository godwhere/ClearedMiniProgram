const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const gameConfig = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8'));

  assert.strictEqual(config.compileType, 'game');
  // Keep the smoke contract aligned with the AppID currently configured for
  // this imported project.
  assert.strictEqual(config.appid, 'wx7fb1a0811192cd97');
  assert.strictEqual(config.setting.compileHotReLoad, false);
  assert.strictEqual(fs.existsSync(path.join(root, 'game.js')), true);
  assert.strictEqual(gameConfig.deviceOrientation, 'portrait');
}

module.exports = run;
