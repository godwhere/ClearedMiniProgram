'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

module.exports = function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cleared-stage4-seed-'));
  const privateRoot = path.join(temporary, '.config', 'cleared-cloudbase-private');
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const player = 'player_disposable_A';
  fs.writeFileSync(path.join(privateRoot, 'cloudbase-d9gpluqt21ba89532.stage4-gates.json'), JSON.stringify({
    schemaVersion: 1, environmentId: 'cloudbase-d9gpluqt21ba89532', mutationPlayerAllowlist: [player]
  }), { mode: 0o600 });
  const backup = {
    schemaVersion: 1, environmentId: 'cloudbase-d9gpluqt21ba89532', accountLabel: 'A',
    binding: { mode: 'cloud', ownerId: player, bindingEpoch: 1, environmentId: 'cloudbase-d9gpluqt21ba89532' },
    createdAt: 1, excludedKeys: ['cleared:minigame:events:v1', 'cleared:minigame:session:v1'],
    entries: [
      { key: 'cleared:minigame:progress:v2', value: {} },
      { key: 'cleared:minigame:reward-unlocks:v1', value: {} },
      { key: 'cleared:minigame:stamina:v1', value: {} },
      { key: 'cleared:minigame:online:v1', value: {} }
    ]
  };
  backup.sha256 = hash(backup);
  const backupFile = path.join(privateRoot, 'stage4-client-backup-A-test.json');
  fs.writeFileSync(backupFile, JSON.stringify(backup), { mode: 0o600 });
  const script = path.resolve(__dirname, '../scripts/prepare-stage4-synthetic-save.js');
  const args = [script, '--env-id', 'cloudbase-d9gpluqt21ba89532', '--account-label', 'A', '--backup', backupFile];
  try {
    const prepared = spawnSync(process.execPath, args, { encoding: 'utf8',
      env: Object.assign({}, process.env, { HOME: temporary }) });
    assert.strictEqual(prepared.status, 0, prepared.stderr);
    assert(!prepared.stdout.includes(player), 'sanitized output must not reveal the internal player id');
    const result = JSON.parse(prepared.stdout); assert(result.ok); assert.strictEqual(result.entryCount, 4);
    assert.strictEqual(result.sourceBackupChecksumVerified, true);
    assert.strictEqual(result.syntheticChecksumVerified, true);
    assert.strictEqual(result.expected.openingBalance, 12700);
    assert.strictEqual(result.expected.dailyDateKey, '2026-09-01');
    const stat = fs.lstatSync(result.output); assert.strictEqual(stat.mode & 0o077, 0);
    const seed = JSON.parse(fs.readFileSync(result.output, 'utf8'));
    assert.strictEqual(seed.binding.ownerId, player); assert.strictEqual(seed.entries.length, 4);
    assert(!seed.entries.some(item => item.key === 'cleared:minigame:session:v1'));
    const checksum = seed.sha256; delete seed.sha256; assert.strictEqual(checksum, hash(seed));

    const corrupt = JSON.parse(JSON.stringify(backup)); corrupt.sha256 = '0'.repeat(64);
    const corruptFile = path.join(privateRoot, 'stage4-client-backup-A-corrupt.json');
    fs.writeFileSync(corruptFile, JSON.stringify(corrupt), { mode: 0o600 });
    const refused = spawnSync(process.execPath, args.slice(0, -1).concat(corruptFile), { encoding: 'utf8',
      env: Object.assign({}, process.env, { HOME: temporary }) });
    assert.notStrictEqual(refused.status, 0); assert(!refused.stdout.includes(player)); assert(!refused.stderr.includes(player));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
};
