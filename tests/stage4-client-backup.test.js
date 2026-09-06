'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cleared-stage4-backup-'));
  const privateRoot = path.join(temporary, '.config', 'cleared-cloudbase-private');
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(privateRoot, 'cloudbase-d9gpluqt21ba89532.stage4-gates.json'), JSON.stringify({
    schemaVersion: 1, environmentId: 'cloudbase-d9gpluqt21ba89532',
    mutationPlayerAllowlist: ['player_disposable_A']
  }), { mode: 0o600 });
  const script = path.resolve(__dirname, '../scripts/save-stage4-client-backup.js');
  const args = [script, '--env-id', 'cloudbase-d9gpluqt21ba89532', '--account-label', 'A'];
  const base = { schemaVersion: 1, source: 'wechat-devtools-copy', binding: {
    mode: 'cloud', ownerId: 'player_disposable_A', bindingEpoch: 1,
    environmentId: 'cloudbase-d9gpluqt21ba89532'
  }, entries: [
    { key: 'cleared:minigame:progress:v2', value: { schemaVersion: 2 } },
    { key: 'cleared:minigame:reward-unlocks:v1', value: { schemaVersion: 1 } },
    { key: 'cleared:minigame:stamina:v1', value: { schemaVersion: 1 } },
    { key: 'cleared:minigame:online:v1', value: { schemaVersion: 2 } }
  ] };
  try {
    const saved = spawnSync(process.execPath, args, { input: JSON.stringify(base), encoding: 'utf8',
      env: Object.assign({}, process.env, { HOME: temporary }) });
    assert.strictEqual(saved.status, 0, saved.stderr);
    const result = JSON.parse(saved.stdout); assert(result.ok); assert.strictEqual(result.mode, '0600');
    assert.strictEqual(result.checksumVerified, true);
    assert.strictEqual(path.dirname(result.output), privateRoot);
    const stat = fs.statSync(result.output); assert.strictEqual(stat.mode & 0o077, 0);
    const backup = JSON.parse(fs.readFileSync(result.output, 'utf8'));
    assert.strictEqual(backup.accountLabel, 'A'); assert.strictEqual(backup.entries.length, 4);
    assert.strictEqual(backup.binding.ownerId, 'player_disposable_A');
    assert(/^[a-f0-9]{64}$/.test(backup.sha256));

    const wrongAccount = JSON.parse(JSON.stringify(base)); wrongAccount.binding.ownerId = 'player_protected_B';
    const refused = spawnSync(process.execPath, args, { input: JSON.stringify(wrongAccount), encoding: 'utf8',
      env: Object.assign({}, process.env, { HOME: temporary }) });
    assert.notStrictEqual(refused.status, 0);
    assert(!refused.stdout.includes('player_protected_B')); assert(!refused.stderr.includes('player_protected_B'));

    const unsafe = JSON.parse(JSON.stringify(base));
    unsafe.entries.push({ key: 'cleared:minigame:session:v1', value: { accessToken: 'must-not-save' } });
    const rejected = spawnSync(process.execPath, args, { input: JSON.stringify(unsafe), encoding: 'utf8',
      env: Object.assign({}, process.env, { HOME: temporary }) });
    assert.notStrictEqual(rejected.status, 0); assert(!rejected.stdout.includes('must-not-save'));
    assert(!rejected.stderr.includes('must-not-save'));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
};
