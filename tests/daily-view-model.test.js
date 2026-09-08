'use strict';

const assert = require('assert');
const buildDailyViewModel = require('../src/ui/view-models/daily-view-model.js');

function testCompleteDailyModel() {
  const challenge = Object.freeze({ Id: 'second', Difficulty: 5 });
  const levels = Object.freeze([Object.freeze({ Id: 'first' }), challenge]);
  const levelResults = Object.freeze([Object.freeze({ levelId: 'first', completed: true })]);
  const result = Object.freeze({ outcome: 'won', elapsedMs: 4321, currencyReward: { status: 'pending' } });
  const board = Object.freeze({ cols: 8, rows: 10 });
  const portal = Object.freeze({
    portals: Object.freeze([{ id: 'p1' }]),
    expectedExit: 12,
    expectedExits: Object.freeze([12, 20]),
    instruction: '选择出口'
  });
  const mechanic = Object.freeze({ portal });
  const boardView = Object.freeze({
    board,
    mechanic,
    elapsedText: '0:04',
    canUndo: true,
    terminal: false
  });
  const input = Object.freeze({
    challenge,
    levels,
    levelIndex: 1,
    levelResults,
    dateKey: '2026-09-08',
    dayId: 'day-a',
    challengeId: 'second',
    entriesUsed: 3,
    entryLimit: 3,
    entriesRemaining: 0,
    debugUnlimited: false,
    completed: true,
    boardView,
    hintEnabled: true,
    result,
    firstClearRewardAmount: 20,
    enteredAt: 100,
    clearAnimation: null,
    resultVisibleAt: 200,
    runStartedAt: 50,
    elapsedBeforeLevel: 1000
  });
  const model = buildDailyViewModel(input);

  assert.deepStrictEqual(model, {
    dailyAvailable: true,
    dailyEntryAvailable: false,
    dailyCanEnter: false,
    dailyDateKey: '2026-09-08',
    dailyDayId: 'day-a',
    dailyChallengeId: 'second',
    dailyCompleted: true,
    challenge,
    levels,
    dailyLevels: levels,
    levelIndex: 1,
    dailyLevelIndex: 1,
    levelCount: 2,
    dailyLevelCount: 2,
    dailyLevelResults: levelResults,
    dailyDifficulty: 5,
    dailyEntriesUsed: 3,
    dailyEntryLimit: 3,
    dailyEntriesRemaining: 0,
    dailyDebugUnlimited: false,
    board,
    mechanic,
    elapsedText: '0:04',
    canUndo: true,
    levelEnteredAt: 100,
    clearAnimation: null,
    hintAvailable: true,
    result,
    firstClearRewardAmount: 20,
    resultVisibleAt: 200,
    runStartedAt: 50,
    elapsedBeforeLevel: 1000,
    dailyTotalElapsedMs: 4321,
    dailyResultVisibleAt: 200,
    portals: portal.portals,
    portalStatus: portal,
    expectedExit: 12,
    expectedExits: portal.expectedExits,
    portalInstruction: '选择出口'
  });
  assert.strictEqual(model.result, result,
    'the pending reward observer must retain the App-owned result object');
  assert.strictEqual(model.levels, levels);
  assert.strictEqual(model.dailyLevels, levels);
  assert.strictEqual(model.dailyLevelResults, levelResults);
  assert.strictEqual(model.board, board);
  assert.strictEqual(model.mechanic, mechanic);
}

function testBoardAndPortalFallbacks() {
  const result = { outcome: 'failed', elapsedMs: 99 };
  const withoutBoard = buildDailyViewModel({
    challenge: null,
    levels: [],
    levelResults: [],
    entriesRemaining: 2,
    debugUnlimited: false,
    boardView: null,
    hintEnabled: true,
    result
  });
  assert.strictEqual(withoutBoard.dailyAvailable, false);
  assert.strictEqual(withoutBoard.dailyEntryAvailable, true);
  assert.strictEqual(withoutBoard.board, null);
  assert.deepStrictEqual(withoutBoard.mechanic, { portal: null });
  assert.strictEqual(withoutBoard.elapsedText, '0:00');
  assert.strictEqual(withoutBoard.canUndo, false);
  assert.strictEqual(withoutBoard.hintAvailable, false);
  assert.strictEqual(withoutBoard.result, result);
  assert.strictEqual(withoutBoard.dailyTotalElapsedMs, 99);
  assert.deepStrictEqual(withoutBoard.portals, []);
  assert.strictEqual(withoutBoard.portalStatus, null);
  assert.strictEqual(withoutBoard.expectedExit, null);
  assert.deepStrictEqual(withoutBoard.expectedExits, []);
  assert.strictEqual(withoutBoard.portalInstruction, null);

  const mechanic = Object.freeze({});
  const withoutPortal = buildDailyViewModel({
    challenge: { difficulty: 2 },
    levels: [{ Id: 'first' }],
    levelResults: [],
    entriesRemaining: 0,
    debugUnlimited: true,
    boardView: Object.freeze({ board: {}, mechanic, terminal: true }),
    hintEnabled: true,
    result: null
  });
  assert.strictEqual(withoutPortal.dailyEntryAvailable, true);
  assert.strictEqual(withoutPortal.dailyCanEnter, true);
  assert.strictEqual(withoutPortal.dailyEntriesRemaining, null);
  assert.strictEqual(withoutPortal.dailyDebugUnlimited, true);
  assert.strictEqual(withoutPortal.dailyDifficulty, 2);
  assert.strictEqual(withoutPortal.mechanic, mechanic);
  assert.strictEqual(withoutPortal.portalStatus, undefined);
  assert.deepStrictEqual(withoutPortal.portals, []);
  assert.strictEqual(withoutPortal.hintAvailable, false);
  assert.strictEqual(withoutPortal.dailyTotalElapsedMs, null);
}

function run() {
  testCompleteDailyModel();
  testBoardAndPortalFallbacks();
}

module.exports = run;
