const assert = require('assert');
const DailyChallengeService = require('../src/services/daily-challenge-service.js');
const manifest = require('../data/daily-challenges.js');
const solutions = require('../data/daily-solutions.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function run() {
  const service = new DailyChallengeService(manifest, {
    timeZone: 'Asia/Shanghai',
    clock: () => new Date('2026-08-31T15:59:00.000Z')
  });
  assert.strictEqual(service.dateKey(), '2026-08-31');
  assert.strictEqual(service.dateKey(new Date('2026-08-31T16:00:00.000Z')), '2026-09-01');

  const resolved = service.resolve();
  assert.strictEqual(resolved.status, 'available');
  assert.strictEqual(resolved.dayId, 'daily-2026-08-31-v1');
  assert.strictEqual(resolved.challengeId, 'daily-2026-08-31-v1');
  assert.strictEqual(resolved.levelCount, 2);
  assert.strictEqual(resolved.entryLimit, 3);
  assert.strictEqual(resolved.levels[0].Width, 3);
  assert.strictEqual(resolved.levels[0].Height, 3);
  assert.strictEqual(resolved.levels[0].Lines.length, 2);
  assert.strictEqual(resolved.levels[0].Difficulty, 'intro');
  assert.strictEqual(resolved.levels[0].PieceCount, 2);
  assert.strictEqual(resolved.levels[1].Width, 8);
  assert.strictEqual(resolved.levels[1].Height, 10);
  assert.strictEqual(resolved.levels[1].Difficulty, 'extreme');
  assert.strictEqual(resolved.levels[1].PieceCount, 10);
  assert.strictEqual(resolved.levels[1].ChallengeStyle, 'sheep-sheep');
  assert.strictEqual(resolved.levels[1].Lines.length, 10);
  assert.strictEqual(service.validate(resolved.challenge).ok, true);
  assert.strictEqual(service.validateDay(service.days[0]).ok, true);
  const authoringDay = JSON.parse(JSON.stringify(manifest.Days[0]));
  authoringDay.Levels.forEach(level => {
    delete level.DateKey;
    delete level.ContentVersion;
  });
  assert.strictEqual(service.validateDay(authoringDay).ok, true,
    'day-owned date/version fields may be inherited by level validation');
  assert.strictEqual(service.validateSolution(
    resolved.levels[0],
    solutions.ByChallengeId[resolved.levels[0].Id]
  ).ok, true);
  assert.strictEqual(service.validateSolution(
    resolved.levels[1],
    solutions.ByChallengeId[resolved.levels[1].Id]
  ).ok, true);

  // Resolution returns a snapshot, not a mutable reference to the manifest.
  resolved.challenge.Blocked.push(8);
  assert.strictEqual(manifest.Days[0].Levels[0].Blocked.indexOf(8), -1);

  const next = service.resolve(new Date('2026-08-31T16:00:00.000Z'));
  assert.strictEqual(next.status, 'available');
  assert.strictEqual(next.dateKey, '2026-09-01');
  assert.strictEqual(new DailyChallengeService(manifest).resolve(new Date('2030-01-01')).reason,
    'no-challenge');

  const duplicate = clone(manifest);
  duplicate.Days.push(clone(duplicate.Days[0]));
  duplicate.Days[2].Id = 'daily-duplicate-id';
  const duplicateResult = new DailyChallengeService(duplicate).resolve(
    new Date('2026-08-31T00:00:00Z')
  );
  assert.strictEqual(duplicateResult.status, 'unavailable');
  assert.strictEqual(duplicateResult.reason, 'duplicate-date-key');

  const invalidCases = [
    ['width', Object.assign(clone(manifest.Challenges[0]), { Width: 7 })],
    ['height', Object.assign(clone(manifest.Challenges[0]), { Height: 9 })],
    ['blocked duplicate', Object.assign(clone(manifest.Challenges[0]), { Blocked: [3, 3] })],
    ['blocked endpoint', Object.assign(clone(manifest.Challenges[0]), { Blocked: [0] })],
    ['endpoint duplicate', Object.assign(clone(manifest.Challenges[0]), {
      Lines: [{ Start: 0, End: 2 }, { Start: 2, End: 28 }]
    })]
  ];
  invalidCases.forEach(item => {
    const result = service.validate(item[1]);
    assert.strictEqual(result.ok, false, `${item[0]} should be rejected`);
    assert(result.errors.length > 0, `${item[0]} should expose an error code`);
  });

  const badPaths = clone(solutions.ByChallengeId[resolved.levels[1].Id]);
  badPaths[0][1] = 3;
  const solutionResult = service.validateSolution(resolved.levels[1], badPaths);
  assert.strictEqual(solutionResult.ok, false);
  assert(solutionResult.errors.indexOf('solution-through-blocked') >= 0);

  const solutionAware = new DailyChallengeService(manifest, { solutions });
  assert.strictEqual(solutionAware.resolve(new Date('2026-08-31T00:00:00Z')).status, 'available');

  const twoArgSolutionAware = new DailyChallengeService(manifest, solutions);
  assert.strictEqual(twoArgSolutionAware.resolve(new Date('2026-08-31T00:00:00Z')).status, 'available');
  const limitManifest = clone(manifest);
  delete limitManifest.EntryLimit;
  limitManifest.Days.forEach(day => { delete day.EntryLimit; });
  const configuredLimit = new DailyChallengeService(limitManifest, {
    entryLimit: 7,
    timeZone: 'Asia/Shanghai'
  });
  assert.strictEqual(configuredLimit.resolve(new Date('2026-08-31T00:00:00Z')).entryLimit, 7);

  // A legacy flat manifest remains readable with its original three-line
  // solution alias while canonical Days use the two-level package.
  const legacyOnly = { SchemaVersion: 1, TimeZone: 'Asia/Shanghai', Challenges: manifest.Challenges };
  const legacyService = new DailyChallengeService(legacyOnly, { solutions });
  const legacyResolved = legacyService.resolve(new Date('2026-08-31T00:00:00Z'));
  assert.strictEqual(legacyResolved.status, 'available');
  assert.strictEqual(legacyResolved.levelCount, 1);
}

module.exports = run;
