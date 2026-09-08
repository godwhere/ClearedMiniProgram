'use strict';
const assert = require('assert');
const accountLayout = require('../src/ui/account-layout.js');
module.exports = function run() {
  [{ width: 280, height: 568, safeTop: 44, safeBottom: 540 },
    { width: 390, height: 844, safeTop: 94, safeBottom: 810 },
    { width: 844, height: 390, safeTop: 44, safeBottom: 366 }].forEach(metrics => {
    [false, true].forEach(backupMode => [false, true].forEach(profileSupported => {
      const layout = accountLayout(metrics, { backupMode, profileSupported });
      Object.values(layout).forEach(rect => {
        assert(rect.w > 0 && rect.h > 0);
        assert(rect.x >= 0 && rect.x + rect.w <= metrics.width);
        assert(rect.y >= metrics.safeTop && rect.y + rect.h <= metrics.safeBottom);
      });
      assert.strictEqual(!!layout.profileButton, profileSupported,
        'the profile row exists only when authorization is available');
      if (layout.profileButton) {
        assert(layout.languageRow.y + layout.languageRow.h < layout.profileButton.y);
        assert(layout.profileButton.y + layout.profileButton.h < layout.retryButton.y);
        assert(layout.profileButton.w * layout.profileButton.h < metrics.width * metrics.height / 5);
      } else assert(layout.languageRow.y + layout.languageRow.h < layout.retryButton.y);
      assert(layout.retryButton.y + layout.retryButton.h < layout.privacyButton.y);
      assert.strictEqual(!!layout.restoreButton, backupMode,
        'the unused cloud-restore row is absent outside backup mode');
      if (layout.restoreButton) {
        assert(layout.retryButton.y + layout.retryButton.h < layout.restoreButton.y);
        assert(layout.restoreButton.y + layout.restoreButton.h < layout.privacyButton.y);
      }
      assert(layout.languagePrevious.x >= layout.languageRow.x);
      assert(layout.languageNext.x + layout.languageNext.w <= layout.languageRow.x + layout.languageRow.w);
      assert(layout.languagePrevious.w >= 44 && layout.languagePrevious.h >= 44);
      assert(layout.languageNext.w >= 44 && layout.languageNext.h >= 44);
    }));
  });
};
