'use strict';

const i18n = require('../i18n/index.js');

const INITIAL = '路径会通过传送门抵达另一个传送门';
const CONTINUE = '到达传送门后松手，再从另一扇门继续';

function localized(locale, key) {
  try {
    if (locale && typeof locale.t === 'function') return locale.t(key);
    if (typeof locale === 'string') return i18n.translate(locale, key);
  } catch (error) {}
  return i18n.translate('zh-CN', key);
}

function initial(locale, hasIce) {
  return localized(locale, hasIce ? 'portal.instruction.mixed' : 'portal.instruction.initial');
}

function continued(locale) {
  return localized(locale, 'portal.instruction.continue');
}

function forState(state, locale) {
  const phase = state && state.phase || 'READY';
  if (phase === 'PORTAL_LOCKED' || phase === 'PORTAL_WAIT') return continued(locale);
  if (phase === 'READY') return initial(locale, !!(state && state.ice));
  if (phase === 'DRAWING' && !(state && state.usedPairIds && state.usedPairIds.length)) return initial(locale, !!(state && state.ice));
  return null;
}

module.exports = Object.freeze({ INITIAL, CONTINUE, initial, continued, forState });
