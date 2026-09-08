const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');
const ClearedApp = require('../src/app.js');
const dailySolutions = require('../data/daily-solutions.js');

function fakeContext() {
  const context = {};
  [
    'save', 'restore', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'arc', 'translate',
    'drawImage', 'fillText', 'scale', 'strokeRect'
  ].forEach(method => { context[method] = function () {}; });
  return context;
}

function createPlatform() {
  const storage = {};
  const context = fakeContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; },
    createImage() {
      const image = {};
      Object.defineProperty(image, 'src', {
        set() { if (image.onload) image.onload(); }
      });
      return image;
    },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  const api = {
    storage,
    createCanvas() { return canvas; },
    getWindowInfo() {
      return {
        windowWidth: 390,
        windowHeight: 844,
        pixelRatio: 2,
        safeArea: { top: 44, bottom: 810 }
      };
    },
    getMenuButtonBoundingClientRect() { return { bottom: 40 }; },
    getStorageSync(key) { return storage[key] || null; },
    setStorageSync(key, value) {
      storage[key] = JSON.parse(JSON.stringify(value));
    },
    createInnerAudioContext() {
      return {
        play() { return Promise.resolve(); },
        pause() {},
        stop() {},
        seek() {},
        destroy() {},
        onError() {}
      };
    },
    vibrateShort() {},
    onTouchStart() {},
    onTouchMove() {},
    onTouchEnd() {},
    onTouchCancel() {},
    onHide() {},
    onShow() {},
    onWindowResize() {}
  };
  return { platform: new WechatPlatform(api), storage };
}

function playCurrentLevelPaths(app, paths) {
  app.tick(Date.now() + 1000);
  const level = app.daily.challenge;
  const board = app.renderer.boardLayout;
  assert(level && board && paths, 'daily level must have a board and solution');
  paths.forEach(path => {
    const point = index => ({
      x: board.x + (index % level.Width + 0.5) * board.cell,
      y: board.y + (Math.floor(index / level.Width) + 0.5) * board.cell,
      id: 11
    });
    app.onPointerStart(point(path[0]));
    path.slice(1).forEach(index => app.onPointerMove(point(index)));
    app.onPointerEnd(point(path[path.length - 1]));
    if (app.scene !== 'daily') return;
  });
}

function solveCurrentLevel(app) {
  playCurrentLevelPaths(app, dailySolutions.ByChallengeId[app.daily.challengeId]);
}

function testDailyStoreCompatibilityWiring() {
  const { platform } = createPlatform();
  const storeCalls = [];
  const queuedEntries = [];
  const queuedCompletions = [];
  const store = {
    canEnter(input) {
      storeCalls.push({ method: 'canEnter', receiver: this, args: Array.from(arguments) });
      return typeof input === 'object' ? { allowed: true, compatibility: 'object' } : false;
    },
    recordEntry(input) {
      storeCalls.push({ method: 'recordEntry', receiver: this, args: Array.from(arguments) });
      if (typeof input === 'object') return null;
      return {
        ok: true,
        persisted: true,
        entriesUsed: 2,
        remainingEntries: 1,
        compatibility: 'positional'
      };
    },
    recordLevelCompletion(input) {
      storeCalls.push({ method: 'recordLevelCompletion', receiver: this, args: Array.from(arguments) });
      if (typeof input === 'object') return null;
      return { ok: true, persisted: true, firstClear: true, compatibility: 'positional' };
    }
  };
  const syncStore = {
    authorityMode() { return 'cloud-authoritative'; },
    context() { return { ownerId: 'player_A', bindingEpoch: 2, activationSequence: 3 }; }
  };
  const progressSync = {
    store: syncStore,
    enqueueDailyEntry(payload) {
      queuedEntries.push(payload);
      return { ok: true, operationId: 'entry-op' };
    },
    enqueueDailyCompletion(payload, observer) {
      queuedCompletions.push({ payload, observer });
      return { ok: true, operationId: 'completion-op' };
    }
  };
  const now = new Date('2026-09-08T02:03:04.005Z');
  const app = new ClearedApp(platform, {
    clock: () => now,
    dailyStore: store,
    progressSync,
    syncStore
  });
  const resolution = {
    status: 'available',
    dateKey: '2026-09-08',
    dayId: 'daily-2026-09-08-v1',
    challengeId: 'daily-2026-09-08-v1',
    levels: [{ Id: 'daily-first' }, { Id: 'daily-second' }]
  };
  const numbers = { entryLimit: 3, entriesUsed: 1, entriesRemaining: 2 };

  const gate = app.dailyCallCanEnter(resolution, numbers);
  assert.strictEqual(gate.allowed, true);
  assert.strictEqual(gate.raw.compatibility, 'object');
  assert.deepStrictEqual(storeCalls.slice(0, 2).map(call => call.args), [
    ['2026-09-08', 3],
    [{ dateKey: '2026-09-08', dayId: 'daily-2026-09-08-v1', entryLimit: 3 }]
  ]);
  storeCalls.slice(0, 2).forEach(call => assert.strictEqual(call.receiver, store));

  const originalDateNow = Date.now;
  Date.now = () => 1788832984005;
  try {
    const entry = app.dailyRecordEntry(resolution, numbers);
    assert.strictEqual(entry.ok, true);
    assert.strictEqual(entry.persisted, true);
    assert.strictEqual(entry.entriesUsed, 2);
    assert.strictEqual(entry.entriesRemaining, 1);
    assert.strictEqual(entry.compatibility, 'positional');
    assert.deepStrictEqual(entry.cloudQueued, { ok: true, operationId: 'entry-op' });
  } finally {
    Date.now = originalDateNow;
  }
  const entryCalls = storeCalls.filter(call => call.method === 'recordEntry');
  const entryKey = '2026-09-08:daily-2026-09-08-v1:entry:1788832984005:1';
  assert.deepStrictEqual(entryCalls.map(call => call.args), [
    [{
      dateKey: '2026-09-08',
      dayId: 'daily-2026-09-08-v1',
      entryLimit: 3,
      levelIds: ['daily-first', 'daily-second'],
      idempotencyKey: entryKey,
      unlimited: false
    }],
    ['2026-09-08', 3, 'daily-2026-09-08-v1', ['daily-first', 'daily-second'], { unlimited: false }]
  ]);
  entryCalls.forEach(call => assert.strictEqual(call.receiver, store));
  assert.deepStrictEqual(queuedEntries, [{
    dateKey: '2026-09-08',
    dayId: 'daily-2026-09-08-v1',
    entryKey,
    entryLimit: 3,
    levelIds: ['daily-first', 'daily-second']
  }]);

  store.recordEntry = function () {
    assert.strictEqual(this, store);
    return { ok: false, reason: 'persist-failed', persisted: false };
  };
  const queueCountBeforeRejectedEntry = queuedEntries.length;
  assert.deepStrictEqual(app.dailyRecordEntry(resolution, numbers), {
    ok: false,
    reason: 'persist-failed',
    persisted: false
  });
  assert.strictEqual(queuedEntries.length, queueCountBeforeRejectedEntry,
    'a rejected local entry write must not create a cloud operation');

  const controlRejections = [
    {
      raw: { ok: true, allowed: false },
      expected: { ok: true, reason: 'entry-limit-reached', allowed: false }
    },
    {
      raw: { ok: true, error: 'persist-failed', persisted: false },
      expected: {
        ok: true,
        reason: 'entry-limit-reached',
        error: 'persist-failed',
        persisted: false
      }
    }
  ];
  controlRejections.forEach(item => {
    store.recordEntry = function () { assert.strictEqual(this, store); return item.raw; };
    const queueCountBefore = queuedEntries.length;
    assert.deepStrictEqual(app.dailyRecordEntry(resolution, numbers), item.expected);
    assert.strictEqual(queuedEntries.length, queueCountBefore,
      'legacy rejection control must prevent cloud enqueue even when the raw ok field is true');
  });

  app.daily = Object.assign(app.emptyDailyState(), {
    dateKey: resolution.dateKey,
    dayId: resolution.dayId,
    levels: resolution.levels,
    resolution
  });
  const observer = function () {};
  const completion = app.dailyCompletionCall(resolution.levels[1], 1, 1234.6, observer);
  assert.strictEqual(completion.ok, true);
  assert.strictEqual(completion.persisted, true);
  assert.strictEqual(completion.firstClear, true);
  assert.strictEqual(completion.compatibility, 'positional');
  assert.deepStrictEqual(completion.cloudQueued, { ok: true, operationId: 'completion-op' });
  const completionCalls = storeCalls.filter(call => call.method === 'recordLevelCompletion');
  assert.strictEqual(completionCalls.length, 2);
  assert.deepStrictEqual(completionCalls[0].args, [{
    dateKey: '2026-09-08',
    dayId: 'daily-2026-09-08-v1',
    levelId: 'daily-second',
    challengeId: 'daily-second',
    levelIndex: 1,
    levelCount: 2,
    levelIds: ['daily-first', 'daily-second'],
    elapsedMs: 1234.6,
    completedAt: now.getTime()
  }]);
  assert.deepStrictEqual(completionCalls[1].args, [
    '2026-09-08', 'daily-second', 1234.6, now.getTime()
  ]);
  completionCalls.forEach(call => assert.strictEqual(call.receiver, store));
  assert.strictEqual(queuedCompletions.length, 1);
  assert.deepStrictEqual(queuedCompletions[0].payload, {
    dateKey: '2026-09-08',
    dayId: 'daily-2026-09-08-v1',
    levelId: 'daily-second',
    levelIndex: 1,
    levelCount: 2,
    levelIds: ['daily-first', 'daily-second'],
    elapsedMs: 1235,
    completedAtClient: now.getTime()
  });
  assert.strictEqual(queuedCompletions[0].observer, observer);

  app.dailyProgress = null;
  const nonce = app.dailyEntryNonce;
  const queueCount = queuedEntries.length;
  const localEntry = app.dailyRecordEntry(resolution, numbers);
  assert.strictEqual(localEntry.persisted, false);
  assert.strictEqual(app.dailyEntryNonce, nonce,
    'a missing store exits before generating an idempotency key or incrementing the nonce');
  assert.strictEqual(queuedEntries.length, queueCount);
  const localCompletion = app.dailyCompletionCall(resolution.levels[0], 0, 500, observer);
  assert.strictEqual(localCompletion.persisted, false);
  assert.strictEqual(queuedCompletions.length, 1,
    'a non-persisted lightweight-host completion must not enter the cloud queue');
  app.dispose();

  const explicitFalseStore = {
    canEnter(dateKey, entryLimit) {
      assert.strictEqual(this, explicitFalseStore);
      assert.strictEqual(dateKey, '2026-09-08');
      assert.strictEqual(entryLimit, 3);
      explicitFalseStore.calls++;
      return false;
    },
    calls: 0
  };
  const explicitFalseApp = new ClearedApp(createPlatform().platform, { dailyStore: explicitFalseStore });
  assert.deepStrictEqual(explicitFalseApp.dailyCallCanEnter(resolution, numbers), {
    allowed: false,
    source: 'store',
    raw: false
  });
  assert.strictEqual(explicitFalseStore.calls, 1,
    'a two-argument store explicitly rejecting entry must not be retried with an object');
  explicitFalseApp.dispose();
}

function testBuiltInFinalEntryKeepsLegacyCloudQueueBoundary() {
  const { platform } = createPlatform();
  const queuedEntries = [];
  const syncStore = {
    authorityMode() { return 'cloud-authoritative'; },
    context() { return { ownerId: 'player_A', bindingEpoch: 1, activationSequence: 1 }; }
  };
  const progressSync = {
    store: syncStore,
    enqueueDailyEntry(payload) { queuedEntries.push(payload); return { ok: true }; }
  };
  const app = new ClearedApp(platform, {
    clock: () => new Date('2026-09-07T07:00:00.000Z'),
    progressSync,
    syncStore
  });

  for (let entryNumber = 1; entryNumber <= 3; entryNumber++) {
    assert.strictEqual(app.enterDaily(), true);
    assert.strictEqual(app.daily.entriesUsed, entryNumber);
    app.performAction('daily:home');
  }
  assert.strictEqual(app.daily.entriesRemaining, 0);
  assert.strictEqual(app.daily.entryState.ok, true);
  assert.strictEqual(app.daily.entryState.canEnter, false);
  assert.strictEqual(queuedEntries.length, 2,
    'the third successful entry keeps the legacy no-enqueue boundary; changing it needs separate approval');
  app.dispose();
}

function testDailyFailureFlow() {
  const { platform, storage } = createPlatform();
  const callbackEvents = [];
  const app = new ClearedApp(platform, {
    clock: () => new Date('2026-08-31T15:00:00.000Z'),
    onDailyCompleted(event) { callbackEvents.push(event); }
  });

  assert.strictEqual(app.enterDaily(), true);
  const storageKey = 'cleared:minigame:daily:v1';
  const dateKey = app.daily.dateKey;
  const introId = app.daily.levels[0].Id;
  const extremeId = app.daily.levels[1].Id;

  // Both lines are valid, but their shortest paths leave four playable cells
  // empty. This must fail the first level without persisting completion or
  // advancing to the extreme level.
  playCurrentLevelPaths(app, [
    [0, 1, 2],
    [3, 6]
  ]);
  assert.strictEqual(app.scene, 'dailyResult');
  assert.strictEqual(app.daily.result.outcome, 'failed');
  assert.strictEqual(app.daily.result.reason, 'unfilled-cells');
  assert.strictEqual(app.daily.result.remainingCells, 4);
  assert.strictEqual(app.currentEffectId(), 'none');
  assert.strictEqual(app.daily.clearAnimation, null,
    'daily boards share the no-effect snapshot semantics');
  const originalBuildBoardViewModel = app.buildBoardViewModel;
  let boardModelCalls = 0;
  app.buildBoardViewModel = function () {
    boardModelCalls++;
    return originalBuildBoardViewModel.apply(this, arguments);
  };
  const failedModel = app.buildModel();
  app.buildBoardViewModel = originalBuildBoardViewModel;
  assert.strictEqual(boardModelCalls, 1,
    'the daily model delegates one already-built board projection');
  assert.strictEqual(failedModel.board.clearAnimation, null);
  assert.strictEqual(failedModel.result, app.daily.result,
    'the App-owned result object must not be replaced by ViewModel mapping');
  assert.strictEqual(failedModel.levels, app.daily.levels);
  assert.strictEqual(failedModel.dailyLevelResults, app.daily.levelResults);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(failedModel, 'runner'), false);
  assert.strictEqual(app.daily.levelIndex, 0);
  assert.deepStrictEqual(app.daily.levelResults, []);
  assert.strictEqual(app.daily.elapsedBeforeLevel, 0);
  assert.strictEqual(app.daily.completionRecorded, false);
  assert.strictEqual(callbackEvents.length, 0);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[introId].completed, false);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[extremeId].completed, false);

  const entriesUsed = app.daily.entriesUsed;
  const entriesRemaining = app.daily.entriesRemaining;
  const storedEntriesUsed = storage[storageKey].entries[dateKey].entriesUsed;
  const failedRunner = app.daily.runner;
  app.performAction('dailyFailure:retry');
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.runner, failedRunner);
  assert.strictEqual(app.daily.runner.outcome, 'playing');
  assert.strictEqual(app.daily.runner.completed.every(completed => !completed), true);
  assert.strictEqual(app.daily.result, null);
  assert.strictEqual(app.daily.levelIndex, 0);
  assert.strictEqual(app.daily.entriesUsed, entriesUsed);
  assert.strictEqual(app.daily.entriesRemaining, entriesRemaining);
  assert.strictEqual(storage[storageKey].entries[dateKey].entriesUsed, storedEntriesUsed);

  // A retry can complete level one normally. Failing level two must retain
  // that first-level result while still avoiding a day completion write.
  solveCurrentLevel(app);
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.levelResults.length, 1);
  const firstLevelResult = JSON.parse(JSON.stringify(app.daily.levelResults[0]));
  const elapsedBeforeLevel = app.daily.elapsedBeforeLevel;

  const incompleteExtremePaths = dailySolutions.ByChallengeId[app.daily.challengeId]
    .map(path => path.slice());
  incompleteExtremePaths[1] = [5, 6, 14, 13, 12, 11];
  playCurrentLevelPaths(app, incompleteExtremePaths);
  assert.strictEqual(app.scene, 'dailyResult');
  assert.strictEqual(app.daily.result.outcome, 'failed');
  assert.strictEqual(app.daily.result.remainingCells, 2);
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.levelResults.length, 1);
  assert.deepStrictEqual(app.daily.levelResults[0], firstLevelResult);
  assert.strictEqual(app.daily.elapsedBeforeLevel, elapsedBeforeLevel);
  assert.strictEqual(app.daily.completionRecorded, false);
  assert.strictEqual(callbackEvents.length, 0);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[introId].completed, true);
  assert.strictEqual(storage[storageKey].entries[dateKey].levels[extremeId].completed, false);
  assert.strictEqual(storage[storageKey].entries[dateKey].completed, false);

  app.performAction('dailyFailure:retry');
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.result, null);
  assert.strictEqual(app.daily.runner.outcome, 'playing');
  assert.deepStrictEqual(app.daily.levelResults[0], firstLevelResult);
  assert.strictEqual(app.daily.elapsedBeforeLevel, elapsedBeforeLevel);
  assert.strictEqual(app.daily.entriesUsed, entriesUsed);
  assert.strictEqual(app.daily.entriesRemaining, entriesRemaining);
  assert.strictEqual(storage[storageKey].entries[dateKey].entriesUsed, storedEntriesUsed);
}

function testDailyAcceptanceDateOverride() {
  const { platform } = createPlatform();
  const realNow = new Date('2026-09-04T14:30:00.000Z');
  const app = new ClearedApp(platform, {
    clock: () => realNow,
    dailyTestDateKey: '2026-09-01'
  });
  assert.strictEqual(app.clockNow().toISOString(), realNow.toISOString(),
    'the daily test date must not replace the app or device clock');
  const resolved = app.resolveDaily();
  assert.strictEqual(resolved.status, 'available');
  assert.strictEqual(resolved.dateKey, '2026-09-01');
  assert.strictEqual(resolved.levels.length, 2);
  assert.strictEqual(app.enterDaily(), true);
  assert.strictEqual(app.daily.dateKey, '2026-09-01');
  app.dispose();

  const invalid = new ClearedApp(createPlatform().platform, {
    clock: () => realNow,
    dailyTestDateKey: '2026-02-30'
  });
  assert.strictEqual(invalid.resolveDaily().reason, 'no-challenge',
    'an invalid override is ignored instead of inventing content');
  invalid.dispose();
}

function testDailyCompletionKeepsEnteredDateAcrossShanghaiMidnight() {
  const { platform, storage } = createPlatform();
  let now = new Date('2026-09-01T15:59:59.999Z');
  const queuedEntries = [];
  const queuedCompletions = [];
  const syncStore = {
    state: { boundUserId: null },
    authorityMode() { return 'cloud-authoritative'; },
    context() {
      return {
        ownerId: 'player_A',
        bindingEpoch: 1,
        activationSequence: 1,
        environmentId: 'test-env'
      };
    }
  };
  const progressSync = {
    store: syncStore,
    enqueueDailyEntry(payload) { queuedEntries.push(payload); return { ok: true }; },
    enqueueDailyCompletion(payload, observer) {
      queuedCompletions.push(payload);
      if (payload.levelIndex === 1 && observer) {
        observer({
          status: 'ACKED',
          details: { rewardGranted: true, rewardAmount: 20 }
        });
      }
      return { ok: true };
    }
  };
  const app = new ClearedApp(platform, {
    clock: () => now,
    progressSync,
    syncStore
  });

  assert.strictEqual(app.enterDaily(), true);
  const enteredDayId = app.daily.dayId;
  const enteredLevelIds = app.daily.levels.map(level => level.Id);
  assert.strictEqual(app.daily.dateKey, '2026-09-01');
  assert.strictEqual(queuedEntries.length, 1);
  assert.strictEqual(queuedEntries[0].dateKey, '2026-09-01');

  now = new Date('2026-09-01T16:00:00.000Z');
  assert.strictEqual(app.dailyService.dateKey(now), '2026-09-02');
  solveCurrentLevel(app);
  solveCurrentLevel(app);

  assert.strictEqual(app.scene, 'dailyResult');
  assert.strictEqual(app.daily.result.dateKey, '2026-09-01');
  assert.strictEqual(app.daily.result.dayId, enteredDayId);
  assert.deepStrictEqual(app.daily.result.levelIds, enteredLevelIds);
  assert.deepStrictEqual(app.daily.result.currencyReward, { status: 'granted', amount: 20 },
    'a cloud receipt arriving before the final result object is created is applied after construction');
  assert.strictEqual(queuedCompletions.length, 2);
  queuedCompletions.forEach((payload, levelIndex) => {
    assert.strictEqual(payload.dateKey, '2026-09-01');
    assert.strictEqual(payload.dayId, enteredDayId);
    assert.strictEqual(payload.levelIndex, levelIndex);
    assert.deepStrictEqual(payload.levelIds, enteredLevelIds);
    assert.strictEqual(payload.completedAtClient, now.getTime());
  });
  const entries = storage['cleared:minigame:daily:v1'].entries;
  assert.strictEqual(entries['2026-09-01'].completed, true);
  assert.strictEqual(entries['2026-09-02'], undefined,
    'finishing the locked challenge must not consume the new Shanghai date');
  app.dispose();
}

async function extraEntryActionAliases() {
  const actions = ['daily:extraEntry', 'daily:revive', 'dailyResult:revive'];
  for (const enabled of [true, false]) for (const scene of ['home', 'dailyResult', 'daily', 'levels', 'account', 'failure']) {
    for (const action of actions) {
      const { platform } = createPlatform(); let finish; const calls = [];
      const app = new ClearedApp(platform, { clock: () => new Date('2026-08-31T00:00:00Z'), rewards: {},
        engagement: { canRequestDailyExtraEntry: () => enabled,
          requestDailyExtraEntry(context) { calls.push(context); return new Promise(resolve => { finish = resolve; }); } } });
      if (scene === 'dailyResult' || scene === 'daily' || scene === 'failure') {
        app.performAction('home:dailyChallenge');
        if (scene === 'dailyResult') { solveCurrentLevel(app); solveCurrentLevel(app); }
        if (scene === 'failure') playCurrentLevelPaths(app, [[0, 1, 2], [3, 6]]);
      } else if (scene === 'levels') app.performAction('home:levels');
      else if (scene === 'account') app.performAction('home:account');
      const allowed = enabled && (scene === 'home' || scene === 'dailyResult');
      const progress = JSON.stringify(app.dailyProgress.state);
      assert.strictEqual(app.performAction(action), allowed, `${action} must have canonical routing for ${scene}, enabled=${enabled}`);
      if (allowed) {
        assert.deepStrictEqual(calls[0], app.dailyRewardContext());
        actions.forEach(other => assert.strictEqual(app.performAction(other), false, 'aliases share one pending guard'));
        assert.strictEqual(calls.length, 1);
        finish({ ok: false, reason: 'closed' });
        await new Promise(resolve => setImmediate(resolve));
      } else {
        assert.strictEqual(calls.length, 0);
        assert.strictEqual(app.dailyExtraRequest, null);
      }
      assert.strictEqual(JSON.stringify(app.dailyProgress.state), progress);
      if (scene === 'failure') {
        const entriesUsed = app.daily.entriesUsed;
        app.performAction('dailyFailure:retry');
        assert.strictEqual(app.scene, 'daily'); assert.strictEqual(app.daily.entriesUsed, entriesUsed);
        assert.strictEqual(calls.length, 0, 'free retry does not request an ad or reward even when enabled');
      }
      app.dispose();
    }
  }
}

function testSeptember7Challenge() {
  const { platform, storage } = createPlatform();
  const app = new ClearedApp(platform, { clock: () => new Date('2026-09-07T07:00:00.000Z') });
  const ordinary = JSON.stringify(app.progress.state);
  app.tick(Date.now());
  assert.strictEqual(app.buildModel().dailyEntryAvailable, true);
  assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'home:dailyChallenge'), true);
  app.performAction('home:dailyChallenge');
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 0);
  assert.strictEqual(app.daily.entriesUsed, 1);
  solveCurrentLevel(app);
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.challengeId, 'daily-2026-09-07-v1-extreme-v1');
  assert.strictEqual(app.daily.entriesUsed, 1, 'advancing to the screenshot board costs no extra entry');
  app.tick(Date.now() + 2000);
  assert.strictEqual(app.renderer.boardLayout.cols, 8);
  assert.strictEqual(app.renderer.boardLayout.rows, 10);
  app.daily.challenge.Blocked.forEach(index => assert.strictEqual(app.daily.runner.isPlayableCell(index), false));
  solveCurrentLevel(app);
  assert.strictEqual(app.scene, 'dailyResult', 'all new paths win through the real pointer and completion flow');
  assert.strictEqual(app.daily.result.levelResults.length, 2);
  assert(app.daily.result.levelResults.every(level => level.completed));
  assert.strictEqual(storage['cleared:minigame:daily:v1'].entries['2026-09-07'].entriesUsed, 1);
  assert.strictEqual(storage['cleared:minigame:daily:v1'].entries['2026-09-07'].completed, true);
  assert.strictEqual(JSON.stringify(app.progress.state), ordinary, 'daily content never changes ordinary progress');
  app.dispose();
}

async function run() {
  testDailyStoreCompatibilityWiring();
  testBuiltInFinalEntryKeepsLegacyCloudQueueBoundary();
  testSeptember7Challenge();
  await extraEntryActionAliases();
  testDailyAcceptanceDateOverride();
  testDailyCompletionKeepsEnteredDateAcrossShanghaiMidnight();
  testDailyFailureFlow();

  const { platform, storage } = createPlatform();
  const callbackEvents = [];
  const app = new ClearedApp(platform, {
    clock: () => new Date('2026-08-31T15:00:00.000Z'),
    onDailyCompleted(event) { callbackEvents.push(event); }
  });

  app.tick(Date.now());
  const mainHits = app.renderer.hits.filter(hit =>
    /^home:(dailyChallenge|themes|start)$/.test(hit.id)
  );
  assert.deepStrictEqual(mainHits.map(hit => hit.id), [
    'home:dailyChallenge', 'home:themes', 'home:start'
  ]);
  assert.strictEqual(mainHits[1].rect.y, mainHits[0].rect.y);
  assert.strictEqual(mainHits[1].rect.x > mainHits[0].rect.x, true);
  assert.strictEqual(mainHits[2].rect.y - mainHits[1].rect.y, 66);
  assert.strictEqual(mainHits[2].rect.w > mainHits[1].rect.w, true);
  assert.strictEqual(app.buildModel().dailyEntryLimit, 3);
  assert.strictEqual(app.buildModel().dailyEntriesRemaining, 3);

  assert.strictEqual(app.enterDaily(), true);
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 0);
  assert.strictEqual(app.daily.challenge.Width, 3);
  assert.strictEqual(app.daily.challenge.Height, 3);
  assert.strictEqual(app.daily.challenge.Lines.length, 2);
  assert.strictEqual(app.daily.entriesUsed, 1);
  assert.strictEqual(app.daily.entriesRemaining, 2);
  const firstDailyModel = app.buildModel();
  assert.strictEqual(firstDailyModel.dailyLevelIndex, 0);
  assert.strictEqual(firstDailyModel.dailyLevelCount, 2);
  assert.strictEqual(firstDailyModel.dailyChallengeId, app.daily.challengeId);
  assert.strictEqual(firstDailyModel.dailyEntriesRemaining, 2);

  app.tick(Date.now() + 1000);
  const introBoard = app.renderer.boardLayout;
  assert.strictEqual(introBoard.cols, 3);
  assert.strictEqual(introBoard.rows, 3);
  solveCurrentLevel(app);
  assert.strictEqual(app.scene, 'daily');
  assert.strictEqual(app.daily.levelIndex, 1);
  assert.strictEqual(app.daily.challenge.Width, 8);
  assert.strictEqual(app.daily.challenge.Height, 10);
  assert.strictEqual(app.daily.entriesUsed, 1);
  assert.strictEqual(app.daily.entriesRemaining, 2);
  const secondDailyModel = app.buildModel();
  assert.strictEqual(secondDailyModel.dailyLevelIndex, 1);
  assert.strictEqual(secondDailyModel.challenge, app.daily.challenge);
  assert.strictEqual(secondDailyModel.dailyLevelResults, app.daily.levelResults);

  app.tick(Date.now() + 2000);
  const hardBoard = app.renderer.boardLayout;
  assert.strictEqual(hardBoard.cols, 8);
  assert.strictEqual(hardBoard.rows, 10);
  const holePoint = {
    x: hardBoard.x + (3 % 8 + 0.5) * hardBoard.cell,
    y: hardBoard.y + (Math.floor(3 / 8) + 0.5) * hardBoard.cell,
    id: 12
  };
  assert.strictEqual(app.daily.runner.isPlayableCell(3), false);
  assert.strictEqual(app.daily.runner.touchStart(3), false);
  app.onPointerStart(holePoint);
  assert.strictEqual(app.daily.runner.selectedLine, -1);

  solveCurrentLevel(app);
  assert.strictEqual(app.scene, 'dailyResult');
  assert.strictEqual(app.daily.result.levelResults.length, 2);
  assert.strictEqual(app.daily.result.levelResults[0].completed, true);
  assert.strictEqual(app.daily.result.levelResults[1].completed, true);
  assert.strictEqual(app.daily.result.elapsedMs >= 1, true);
  assert.strictEqual(callbackEvents.length, 1);
  assert.strictEqual(callbackEvents[0].firstClear, true);
  assert.strictEqual(app.progress.completedCount(), 0);
  assert.strictEqual(app.progress.state.stats.totalClears, 0);
  assert.strictEqual(storage['cleared:minigame:daily:v1'].entries['2026-08-31'].entriesUsed, 1);
  const resultModel = app.buildModel();
  assert.strictEqual(resultModel.result, app.daily.result);
  assert.strictEqual(resultModel.dailyTotalElapsedMs, app.daily.result.elapsedMs);
  assert.strictEqual(resultModel.dailyCompleted, true);

  // Three entries per day: consume the remaining two entries via fresh runs.
  app.tick(Date.now() + 5000);
  assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'dailyResult:replay'), true);
  assert.strictEqual(app.renderer.hits.filter(hit => hit.id === 'dailyResult:home').length, 1);
  assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'dailyResult:back'), true);
  app.performAction('dailyResult:replay');
  assert.strictEqual(app.scene, 'daily');
  for (let attempt = 3; attempt <= 3; attempt++) {
    app.performAction('daily:home');
    app.tick(Date.now() + attempt * 1000);
    assert.strictEqual(app.enterDaily(), true, `entry ${attempt} should be available`);
  }
  assert.strictEqual(app.daily.entriesUsed, 3);
  assert.strictEqual(app.daily.entriesRemaining, 0);
  app.performAction('daily:home');
  app.tick(Date.now() + 7000);
  assert.strictEqual(app.buildModel().dailyEntryAvailable, false);
  assert.strictEqual(app.renderer.hits.some(hit => hit.id === 'home:dailyChallenge'), false);
  assert.strictEqual(app.enterDaily(), false);

  // Development/debug mode deliberately bypasses the finite budget while
  // retaining the same persisted attempt counter.
  const debugApp = new ClearedApp(platform, {
    clock: () => new Date('2026-08-31T15:00:00.000Z'),
    dailyDebugUnlimited: true
  });
  assert.strictEqual(debugApp.dailyProgress.debugUnlimited, true);
  debugApp.tick(Date.now());
  assert.strictEqual(debugApp.buildModel().dailyDebugUnlimited, true);
  assert.strictEqual(debugApp.buildModel().dailyEntryAvailable, true);
  assert.strictEqual(debugApp.enterDaily(), true);
  debugApp.performAction('daily:home');
  debugApp.tick(Date.now());
  assert.strictEqual(debugApp.enterDaily(), true, 'debug mode remains unlimited after the third entry');
  const revive = debugApp.requestDailyRevive('ad', 'ad-test-1');
  assert.strictEqual(revive.implemented, false);
}

module.exports = run;
