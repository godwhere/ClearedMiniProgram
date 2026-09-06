'use strict';

// Builds a recognizable legacy save only after a verified private backup of
// disposable account A exists. The result stays outside the repository and
// is not applied to WeChat storage by this script.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ProgressStore = require('../src/services/progress-store.js');
const DailyStore = require('../src/services/daily-progress-store.js');
const Rewards = require('../src/services/reward-unlock-service.js');
const Stamina = require('../src/services/stamina-service.js');
const Builder = require('../src/services/legacy-migration-builder.js');
const rewardConfig = require('../src/config/rewards.js');

const ENVIRONMENT_ID = 'cloudbase-d9gpluqt21ba89532';
const DATE_KEY = '2026-09-01';
const DAY_ID = `daily-${DATE_KEY}-v1`;
const LEVEL_IDS = [`${DAY_ID}-intro-v1`, `${DAY_ID}-extreme-v1`];
const REQUIRED_BACKUP_KEYS = ['cleared:minigame:progress:v2', 'cleared:minigame:reward-unlocks:v1',
  'cleared:minigame:stamina:v1', 'cleared:minigame:online:v1'];
const argument = name => {
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null;
};
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ensure = (condition, message) => { if (!condition) throw Error(message); };

function privateFile(file, label) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    `${label} must be a regular 0600 file`);
  return stat;
}

function privateRoot() {
  const root = path.join(os.homedir(), '.config', 'cleared-cloudbase-private');
  const stat = fs.lstatSync(root);
  ensure(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    'Private directory must be a regular 0700 directory');
  return root;
}

function selectedPlayer(root) {
  const file = path.join(root, ENVIRONMENT_ID + '.stage4-gates.json');
  privateFile(file, 'Private account gate');
  const gate = JSON.parse(fs.readFileSync(file, 'utf8'));
  ensure(record(gate) && gate.schemaVersion === 1 && gate.environmentId === ENVIRONMENT_ID &&
    Array.isArray(gate.mutationPlayerAllowlist) && gate.mutationPlayerAllowlist.length === 1 &&
    /^player_[A-Za-z0-9_-]{1,120}$/.test(gate.mutationPlayerAllowlist[0]) &&
    Object.keys(gate).every(key => ['schemaVersion', 'environmentId', 'mutationPlayerAllowlist'].includes(key)),
  'Private account gate does not select exactly one approved player');
  return gate.mutationPlayerAllowlist[0];
}

function loadBackup(root, approvedPlayer) {
  const requested = argument('--backup');
  ensure(requested, 'Pass the verified private account A backup with --backup');
  const file = path.resolve(requested);
  ensure(path.dirname(file) === root && /^stage4-client-backup-A-[A-Za-z0-9-]+\.json$/.test(path.basename(file)),
    'Backup must be the account A file directly inside the private directory');
  privateFile(file, 'Client backup');
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  ensure(record(backup) && backup.schemaVersion === 1 && backup.environmentId === ENVIRONMENT_ID &&
    backup.accountLabel === 'A' && record(backup.binding) && backup.binding.mode === 'cloud' &&
    backup.binding.ownerId === approvedPlayer && backup.binding.environmentId === ENVIRONMENT_ID &&
    Number.isSafeInteger(backup.binding.bindingEpoch) && backup.binding.bindingEpoch >= 1 &&
    Array.isArray(backup.entries) && typeof backup.sha256 === 'string',
  'Backup is not the approved account A envelope');
  const checksum = backup.sha256; const unsigned = clone(backup); delete unsigned.sha256;
  ensure(/^[a-f0-9]{64}$/.test(checksum) && digest(unsigned) === checksum,
    'Client backup checksum verification failed');
  const keys = new Set(backup.entries.map(item => record(item) && item.key));
  ensure(REQUIRED_BACKUP_KEYS.every(key => keys.has(key)), 'Client backup is missing a required gameplay key');
  return { file, backup, checksum };
}

function syntheticEntries() {
  const completedAt = Date.parse('2026-09-01T04:00:00.000Z');
  return [
    { key: 'cleared:minigame:progress:v2', value: {
      schemaVersion: 2,
      completed: { '0:0': true, '1:2': true },
      bestMs: { '0:0': 42000, '1:2': 73000 },
      lastPlayed: { setIndex: 1, levelIndex: 2 },
      settings: { skinId: 'festival', clearEffectId: 'none', soundEnabled: false },
      stats: { totalClears: 2 }
    } },
    { key: 'cleared:minigame:daily:v1', value: {
      schemaVersion: 1,
      entries: {
        [DATE_KEY]: {
          dayId: DAY_ID, entryLimit: 3, entriesUsed: 1, attempts: 1, completed: false,
          levels: {
            [LEVEL_IDS[0]]: { levelIndex: 0, completed: true, bestMs: 51000, completedAt },
            [LEVEL_IDS[1]]: { levelIndex: 1, completed: false, bestMs: 0 }
          },
          _explicitEntryLimit: true, _levelCount: 2, _levelIds: LEVEL_IDS.slice(),
          _entryKeys: ['stage4-seed-entry-2026-09-01'], _grantIds: [],
          entryHistory: [{ idempotencyKey: 'stage4-seed-entry-2026-09-01' }], _dateKey: DATE_KEY
        }
      }
    } },
    { key: 'cleared:minigame:reward-unlocks:v1', value: {
      schemaVersion: 1, balance: 12700,
      claimedOrdinary: { '0:0': true, '1:2': true }, claimedDaily: {},
      ownedRewards: { 'theme:gem': true, 'theme:festival': true },
      adAttempts: {}, pendingNotices: []
    } },
    { key: 'cleared:minigame:stamina:v1', value: {
      schemaVersion: 1, balance: 7, nextRecoveryAt: null,
      unlockedLevels: ['0:0', '1:2'], refundedLevels: []
    } }
  ].sort((left, right) => left.key.localeCompare(right.key));
}

function validate(entries) {
  const storage = Object.fromEntries(entries.map(item => [item.key, clone(item.value)]));
  const platform = {
    getStorage(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? clone(storage[key]) : null; },
    setStorage(key, value) { storage[key] = clone(value); return true; },
    readStorageResult(key) {
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? { ok: true, found: true, value: clone(storage[key]) }
        : { ok: true, found: false, value: null };
    }
  };
  const progress = new ProgressStore(platform); const daily = new DailyStore(platform);
  const rewards = new Rewards(platform, rewardConfig); const stamina = new Stamina(platform);
  const built = new Builder({ progress, daily, rewards, stamina, syncStore: {
    blocked: false, state: { installId: 'stage4_validation_install', migrationId: 'stage4_validation_migration' }
  } }).buildSnapshot();
  ensure(built.ok, 'Synthetic save is not accepted by the migration builder');
  const snapshot = built.snapshot;
  ensure(Object.keys(snapshot.progress.levels).sort().join(',') === '0:0,1:2' &&
    snapshot.progress.levels['0:0'].bestMs === 42000 && snapshot.progress.levels['1:2'].bestMs === 73000 &&
    snapshot.progress.lastPlayed.setIndex === 1 && snapshot.progress.lastPlayed.levelIndex === 2,
  'Synthetic progress summary mismatch');
  const day = snapshot.daily.days[DATE_KEY];
  ensure(day && day.entriesUsed === 1 && day.completed === false && day.levelCount === 2 &&
    day.levels[LEVEL_IDS[0]].completed === true && day.levels[LEVEL_IDS[1]].completed === false,
  'Synthetic daily summary mismatch');
  ensure(snapshot.economy.balance === 12700 && Object.keys(snapshot.economy.claimedOrdinary).length === 2 &&
    Object.keys(snapshot.economy.claimedDaily).length === 0 &&
    snapshot.entitlements.ownedRewards['theme:gem'] === true &&
    snapshot.entitlements.ownedRewards['theme:festival'] === true,
  'Synthetic economy summary mismatch');
  ensure(snapshot.stamina.balance === 7 && snapshot.preferences.skinId === 'festival' &&
    snapshot.preferences.clearEffectId === 'none' && snapshot.preferences.soundEnabled === false,
  'Synthetic deferred-domain summary mismatch');
}

function main() {
  ensure(argument('--env-id') === ENVIRONMENT_ID && argument('--account-label') === 'A',
    'Use the approved test environment and explicit disposable account label A');
  const root = privateRoot(); const approvedPlayer = selectedPlayer(root);
  const source = loadBackup(root, approvedPlayer); const entries = syntheticEntries();
  validate(entries);
  const seed = {
    schemaVersion: 1, purpose: 'cleared-stage4-synthetic-legacy-save-v1',
    environmentId: ENVIRONMENT_ID, accountLabel: 'A', binding: clone(source.backup.binding),
    sourceBackup: { file: path.basename(source.file), sha256: source.checksum },
    expected: {
      ordinaryCompleted: ['0:0', '1:2'], ordinaryBestMs: { '0:0': 42000, '1:2': 73000 },
      lastPlayed: { setIndex: 1, levelIndex: 2 }, dailyDateKey: DATE_KEY,
      dailyIntroCompleted: true, dailyExtremeCompleted: false, openingBalance: 12700,
      claimedOrdinaryCount: 2, claimedDailyCount: 0,
      ownedRewards: ['theme:festival', 'theme:gem'], staminaBalance: 7,
      preferences: { skinId: 'festival', clearEffectId: 'none', soundEnabled: false }
    },
    entries
  };
  seed.sha256 = digest(seed);
  const output = path.join(root, `stage4-synthetic-save-A-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(output, JSON.stringify(seed), { flag: 'wx', mode: 0o600 });
  const stat = privateFile(output, 'Synthetic save'); const verified = JSON.parse(fs.readFileSync(output, 'utf8'));
  const checksum = verified.sha256; delete verified.sha256;
  ensure(checksum === digest(verified), 'Synthetic save checksum verification failed');
  validate(verified.entries);
  console.log(JSON.stringify({ ok: true, accountLabel: 'A', environmentId: ENVIRONMENT_ID,
    entryCount: entries.length, sourceBackupChecksumVerified: true, syntheticChecksumVerified: true,
    mode: '0600', bytes: stat.size, output, expected: seed.expected }));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
