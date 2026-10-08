'use strict';

const assert = require('assert');
const ProgressStore = require('../src/services/progress-store.js');
const PreferencesService = require('../src/services/preferences-service.js');
const { RewardPlatform } = require('./helpers/reward-fixture.js');

module.exports = function run() {
  const platform = new RewardPlatform(); const progress = new ProgressStore(platform);
  const preferences = new PreferencesService(progress); let refreshes = 0;
  const refresh = { refreshSetting() { refreshes++; } };
  const registry = { get(id) { return ['classic', 'gem', 'none', 'fade'].includes(id) ? { id } : null; },
    refreshSetting: refresh.refreshSetting };
  preferences.bind({ skins: registry, clearEffects: registry, audio: refresh,
    canUse: (kind, id) => (kind === 'theme' && id === 'classic') || (kind === 'effect' && id === 'none') });
  const fallback = preferences.applyAuthoritativeSnapshot({ schemaVersion: 1,
    skinId: 'gem', clearEffectId: 'fade', soundEnabled: false }, []);
  assert(fallback.ok); assert.strictEqual(progress.getSetting('skinId'), 'classic');
  assert.strictEqual(progress.getSetting('clearEffectId'), 'none');
  assert.strictEqual(progress.getSetting('soundEnabled'), false);
  assert.strictEqual(progress.getSetting('clearMode'), 'simultaneous', 'old cloud snapshots use the current default');

  preferences.bind({ skins: registry, clearEffects: registry, audio: refresh, canUse: () => true });
  const overlay = preferences.applyAuthoritativeSnapshot({ schemaVersion: 1,
    skinId: 'classic', clearEffectId: 'none', soundEnabled: true }, [
    { domain: 'preferences', type: 'PREFERENCE_FIELD_SET', payload: { field: 'skinId', value: 'gem' } },
    { domain: 'preferences', type: 'PREFERENCE_FIELD_SET', payload: { field: 'soundEnabled', value: false } }
  ]);
  assert(overlay.ok); assert.deepStrictEqual(preferences.exportAuthoritativeSnapshot().snapshot,
    { schemaVersion: 1, skinId: 'gem', clearEffectId: 'none', clearMode: 'simultaneous', soundEnabled: false });
  assert(refreshes >= 6, 'each authoritative apply refreshes theme, effect and audio caches');
  const chosen = { schemaVersion: 1, skinId: 'classic', clearEffectId: 'none', soundEnabled: true, clearMode: 'sequential' };
  assert(preferences.applyAuthoritativeSnapshot(chosen, []).ok);
  assert.strictEqual(progress.getSetting('clearMode'), 'sequential', 'explicit cloud choices remain selected');
  assert(preferences.applyAuthoritativeSnapshot({ schemaVersion: 1, skinId: 'classic', clearEffectId: 'none', soundEnabled: true }, [
    { domain: 'preferences', type: 'PREFERENCE_FIELD_SET', payload: { field: 'clearMode', value: 'sequential' } }
  ]).ok);
  assert.strictEqual(progress.getSetting('clearMode'), 'sequential', 'pending offline choices override a missing cloud field');

  platform.writeFailures[ProgressStore.STORAGE_KEY] = true;
  const before = JSON.stringify(progress.state);
  assert.strictEqual(preferences.applyAuthoritativeSnapshot({ schemaVersion: 1,
    skinId: 'classic', clearEffectId: 'none', soundEnabled: true }, []).reason, 'persist-failed');
  assert.strictEqual(JSON.stringify(progress.state), before);
};
