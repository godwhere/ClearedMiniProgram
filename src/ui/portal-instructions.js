'use strict';

const INITIAL = '路径会通过传送门抵达另一个传送门';
const CONTINUE = '到达传送门后松手，再从另一扇门继续';

function forState(state) {
  const phase = state && state.phase || 'READY';
  if (phase === 'PORTAL_LOCKED' || phase === 'PORTAL_WAIT') return CONTINUE;
  if (phase === 'READY') return INITIAL;
  if (phase === 'DRAWING' && !(state && state.usedPairIds && state.usedPairIds.length)) return INITIAL;
  return null;
}

module.exports = Object.freeze({ INITIAL, CONTINUE, forState });
