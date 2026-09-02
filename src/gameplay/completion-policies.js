'use strict';

function settleOrdinary(context, services) {
  const deps = services || {};
  if (!context || context.progressionScope !== 'ordinary' ||
      !Number.isInteger(context.setIndex) || !Number.isInteger(context.levelIndex) ||
      !deps.progress || typeof deps.progress.recordCompletion !== 'function') return null;
  const elapsedMs = Math.max(1, Number(deps.elapsedMs) || 0);
  const completion = deps.progress.recordCompletion(
    context.setIndex,
    context.levelIndex,
    elapsedMs
  );
  if (!completion) return null;
  if (deps.ads && typeof deps.ads.onLevelCompleted === 'function') {
    const clears = deps.progress.state && deps.progress.state.stats
      ? deps.progress.state.stats.totalClears
      : 0;
    try {
      const notification = deps.ads.onLevelCompleted(clears);
      if (notification && typeof notification.catch === 'function') {
        notification.catch(function () {});
      }
    } catch (error) {
      // Completion persistence and result navigation are authoritative;
      // optional ad failures must never strand a won board in the play scene.
    }
  }
  return Object.assign({ elapsedMs, persisted: true }, completion);
}

function settleDaily(context, services) {
  const deps = services || {};
  if (!context || context.progressionScope !== 'daily' ||
      typeof deps.complete !== 'function') return null;
  return deps.complete(context);
}

function settle(context, services) {
  if (!context) return null;
  if (context.progressionScope === 'ordinary') return settleOrdinary(context, services);
  if (context.progressionScope === 'daily') return settleDaily(context, services);
  return null;
}

module.exports = {
  settle,
  settleOrdinary,
  settleDaily
};
