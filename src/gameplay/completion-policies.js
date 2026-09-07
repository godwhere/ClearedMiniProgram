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
  if (context.progressionScope === 'trial' && context.source && context.source.kind === 'trial') {
    return { outcome: 'won', elapsedMs: Math.max(1, Number(services && services.elapsedMs) || 0) };
  }
  return null;
}

module.exports = {
  settle,
  settleOrdinary,
  settleDaily
};
