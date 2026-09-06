'use strict';

// Saves a clipboard/console export of gameplay storage outside the repository.
// Authentication sessions and telemetry are deliberately not accepted.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENVIRONMENT_ID = 'cloudbase-d9gpluqt21ba89532';
const EXCLUDED = new Set(['cleared:minigame:session:v1', 'cleared:minigame:events:v1']);
const FORBIDDEN_FIELDS = new Set(['accessToken', 'refreshToken', 'sessionKey', 'session_key',
  'openid', 'OPENID', 'unionid', 'UNIONID', 'appSecret', 'AppSecret', 'loginCode']);
const argument = name => {
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null;
};
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);

function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw Error('Private account gate must be a regular 0600 file');
  }
}

function approvedPlayer(privateRoot) {
  const rootStat = fs.lstatSync(privateRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o077) !== 0) {
    throw Error('Private backup directory must be a regular 0700 directory');
  }
  const file = path.join(privateRoot, ENVIRONMENT_ID + '.stage4-gates.json');
  privateFile(file);
  const gate = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!record(gate) || gate.schemaVersion !== 1 || gate.environmentId !== ENVIRONMENT_ID ||
      !Array.isArray(gate.mutationPlayerAllowlist) || gate.mutationPlayerAllowlist.length !== 1 ||
      !/^player_[A-Za-z0-9_-]{1,120}$/.test(gate.mutationPlayerAllowlist[0]) ||
      Object.keys(gate).some(key => !['schemaVersion', 'environmentId', 'mutationPlayerAllowlist'].includes(key))) {
    throw Error('Private account gate does not select exactly one approved player');
  }
  return gate.mutationPlayerAllowlist[0];
}

function containsCredential(value, depth) {
  if ((depth || 0) > 40) throw Error('Backup payload is too deep');
  if (Array.isArray(value)) return value.some(item => containsCredential(item, (depth || 0) + 1));
  if (!record(value)) return false;
  return Object.keys(value).some(key => FORBIDDEN_FIELDS.has(key) || containsCredential(value[key], (depth || 0) + 1));
}

async function main() {
  if (argument('--env-id') !== ENVIRONMENT_ID || argument('--account-label') !== 'A') {
    throw Error('Use the approved test environment and explicit disposable account label A');
  }
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 16 * 1024 * 1024) throw Error('Backup input exceeds 16 MiB');
    chunks.push(chunk);
  }
  const privateRoot = path.join(os.homedir(), '.config', 'cleared-cloudbase-private');
  const selectedPlayer = approvedPlayer(privateRoot);
  const source = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!record(source) || source.schemaVersion !== 1 || source.source !== 'wechat-devtools-copy' ||
      !record(source.binding) || !Array.isArray(source.entries) || !source.entries.length ||
      Object.keys(source).some(key => !['schemaVersion', 'source', 'binding', 'entries'].includes(key)) ||
      Object.keys(source.binding).length !== 4 || source.binding.mode !== 'cloud' ||
      source.binding.ownerId !== selectedPlayer || source.binding.environmentId !== ENVIRONMENT_ID ||
      !Number.isSafeInteger(source.binding.bindingEpoch) || source.binding.bindingEpoch < 1 ||
      !['mode', 'ownerId', 'bindingEpoch', 'environmentId'].every(key =>
        Object.prototype.hasOwnProperty.call(source.binding, key))) {
    throw Error('Unexpected client backup envelope');
  }
  const keys = new Set(); const entries = source.entries.map(item => {
    if (!record(item) || Object.keys(item).length !== 2 || typeof item.key !== 'string' ||
        !/^cleared(?::minigame)?:[A-Za-z0-9:_-]{1,180}$/.test(item.key) ||
        EXCLUDED.has(item.key) || keys.has(item.key) || containsCredential(item.value)) {
      throw Error('Client backup contains a duplicate, excluded or unsafe entry');
    }
    keys.add(item.key); return { key: item.key, value: item.value };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const required of ['cleared:minigame:progress:v2', 'cleared:minigame:reward-unlocks:v1',
    'cleared:minigame:stamina:v1', 'cleared:minigame:online:v1']) {
    if (!keys.has(required)) throw Error('Client backup is missing a required gameplay storage key');
  }
  const backup = { schemaVersion: 1, environmentId: ENVIRONMENT_ID, accountLabel: 'A', binding: source.binding,
    createdAt: Date.now(), excludedKeys: Array.from(EXCLUDED).sort(), entries };
  backup.sha256 = crypto.createHash('sha256').update(JSON.stringify(backup)).digest('hex');
  const output = path.join(privateRoot, `stage4-client-backup-A-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(output, JSON.stringify(backup), { flag: 'wx', mode: 0o600 });
  const stat = fs.lstatSync(output);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Backup permissions are not private');
  const verified = JSON.parse(fs.readFileSync(output, 'utf8')); const expectedSha256 = verified.sha256;
  delete verified.sha256;
  if (expectedSha256 !== crypto.createHash('sha256').update(JSON.stringify(verified)).digest('hex')) {
    throw Error('Backup checksum verification failed');
  }
  console.log(JSON.stringify({ ok: true, accountLabel: 'A', environmentId: ENVIRONMENT_ID,
    entryCount: entries.length, bytes: stat.size, checksumRecorded: true, checksumVerified: true,
    mode: '0600', output }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
