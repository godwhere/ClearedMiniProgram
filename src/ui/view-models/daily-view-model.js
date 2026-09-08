'use strict';

/**
 * Map the already-resolved daily session projection into renderer fields.
 * The input projection is read-only and this function owns no runtime state.
 */
function buildDailyViewModel(input) {
  const data = input || {};
  const levels = Array.isArray(data.levels) ? data.levels : [];
  const levelResults = Array.isArray(data.levelResults) ? data.levelResults : [];
  const boardView = data.boardView || null;
  const mechanic = boardView && boardView.mechanic
    ? boardView.mechanic
    : { portal: null };
  const portalStatus = mechanic.portal;
  const debugUnlimited = data.debugUnlimited === true;
  return {
    dailyAvailable: !!data.challenge,
    dailyEntryAvailable: debugUnlimited || data.entriesRemaining > 0,
    dailyCanEnter: debugUnlimited || data.entriesRemaining > 0,
    dailyDateKey: data.dateKey,
    dailyDayId: data.dayId,
    dailyChallengeId: data.challengeId,
    dailyCompleted: data.completed,
    challenge: data.challenge,
    levels,
    dailyLevels: levels,
    levelIndex: data.levelIndex,
    dailyLevelIndex: data.levelIndex,
    levelCount: levels.length,
    dailyLevelCount: levels.length,
    dailyLevelResults: levelResults,
    dailyDifficulty: data.challenge &&
      (data.challenge.Difficulty || data.challenge.difficulty || null),
    dailyEntriesUsed: data.entriesUsed,
    dailyEntryLimit: data.entryLimit,
    dailyEntriesRemaining: debugUnlimited ? null : data.entriesRemaining,
    dailyDebugUnlimited: debugUnlimited,
    board: boardView && boardView.board,
    mechanic,
    elapsedText: boardView ? boardView.elapsedText : '0:00',
    canUndo: !!(boardView && boardView.canUndo),
    levelEnteredAt: data.enteredAt,
    clearAnimation: data.clearAnimation,
    hintAvailable: !!boardView && !boardView.terminal && data.hintEnabled === true,
    result: data.result,
    firstClearRewardAmount: data.firstClearRewardAmount,
    resultVisibleAt: data.resultVisibleAt,
    runStartedAt: data.runStartedAt,
    elapsedBeforeLevel: data.elapsedBeforeLevel,
    dailyTotalElapsedMs: data.result && data.result.elapsedMs,
    dailyResultVisibleAt: data.resultVisibleAt,
    portals: portalStatus ? portalStatus.portals : [],
    portalStatus,
    expectedExit: portalStatus ? portalStatus.expectedExit : null,
    expectedExits: portalStatus ? portalStatus.expectedExits : [],
    portalInstruction: portalStatus ? portalStatus.instruction : null
  };
}

module.exports = buildDailyViewModel;
