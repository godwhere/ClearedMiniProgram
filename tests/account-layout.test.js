'use strict';
const assert = require('assert');
const accountLayout = require('../src/ui/account-layout.js');
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const separate = (left, right) => left.x + left.w <= right.x || right.x + right.w <= left.x ||
  left.y + left.h <= right.y || right.y + right.h <= left.y;
module.exports = function run() {
  [{ width: 280, height: 568, safeTop: 44, safeBottom: 540 },
    { width: 390, height: 844, safeTop: 94, safeBottom: 810 },
    { width: 844, height: 390, safeTop: 44, safeBottom: 366 }].forEach(metrics => {
    [false, true].forEach(backupMode => {
      const layout = accountLayout(metrics, { backupMode });
      Object.values(layout).forEach(rect => {
        assert(rect.w > 0 && rect.h > 0);
        assert(rect.x >= 0 && rect.x + rect.w <= metrics.width);
        assert(rect.y >= metrics.safeTop && rect.y + rect.h <= metrics.safeBottom);
      });
      assert.deepStrictEqual(layout.backButton,
        { x: 16, y: metrics.safeTop + 12, w: 48, h: 48 },
        'portrait and landscape account pages share the top-bar slot');
      assert.strictEqual(layout.profileButton, undefined, 'the account screen has no profile authorization row');
      assert(contains(layout.profileSection, layout.summary));
      assert(contains(layout.profileSection, layout.retryButton), 'cloud state belongs with profile and save');
      assert(contains(layout.settingsSection, layout.languageRow));
      assert(contains(layout.settingsSection, layout.clearModeButton), 'both settings share one section');
      assert(contains(layout.settingsSection, layout.volumeRow));
      assert(contains(layout.volumeRow, layout.volumeControl));
      assert(contains(layout.volumeControl, layout.volumeTrack));
      assert(layout.volumeTrack.x + layout.volumeTrack.w + 7 <= layout.volumeRow.x + layout.volumeRow.w - 12 - 32,
        'the full-volume thumb stays clear of the reserved percentage text');
      assert(layout.volumeControl.h >= 44);
      assert(layout.clearModeButton.y + layout.clearModeButton.h < layout.volumeRow.y);
      assert(separate(layout.profileSection, layout.settingsSection));
      assert(separate(layout.profileSection, layout.privacyButton));
      assert(separate(layout.settingsSection, layout.privacyButton), 'privacy is a separate footer action');
      assert(layout.profileHeading.y + layout.profileHeading.h <= layout.profileSection.y);
      assert(layout.settingsHeading.y + layout.settingsHeading.h <= layout.settingsSection.y);
      assert(layout.summary.y + layout.summary.h < layout.retryButton.y);
      assert(layout.languageRow.y + layout.languageRow.h < layout.clearModeButton.y);
      assert(layout.clearModeButton.h >= 44);
      assert.strictEqual(!!layout.restoreButton, backupMode,
        'the unused cloud-restore row is absent outside backup mode');
      if (layout.restoreButton) {
        assert(layout.retryButton.y + layout.retryButton.h < layout.restoreButton.y);
        assert(contains(layout.profileSection, layout.restoreButton));
      }
      assert(layout.languagePrevious.x >= layout.languageRow.x);
      assert(layout.languageNext.x + layout.languageNext.w <= layout.languageRow.x + layout.languageRow.w);
      assert(layout.languagePrevious.w >= 44 && layout.languagePrevious.h >= 44);
      assert(layout.languageNext.w >= 44 && layout.languageNext.h >= 44);
      ['Previous', 'Value', 'Next'].forEach(part => {
        const control = layout[`clearMode${part}`];
        const language = layout[`language${part}`];
        assert(contains(layout.clearModeButton, control));
        assert.strictEqual(control.x, language.x, 'setting selector columns align');
        assert.strictEqual(control.w, language.w);
        assert.strictEqual(control.h, language.h);
      });
    });
  });
};
