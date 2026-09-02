'use strict';
const assert = require('assert');
const accountLayout = require('../src/ui/account-layout.js');
module.exports = function run() {
  [{ width: 280, height: 568, safeTop: 44, safeBottom: 540 },
    { width: 390, height: 844, safeTop: 94, safeBottom: 810 },
    { width: 844, height: 390, safeTop: 44, safeBottom: 366 }].forEach(metrics => {
    const layout = accountLayout(metrics);
    Object.values(layout).forEach(rect => {
      assert(rect.w > 0 && rect.h > 0);
      assert(rect.x >= 0 && rect.x + rect.w <= metrics.width);
      assert(rect.y >= metrics.safeTop && rect.y + rect.h <= metrics.safeBottom);
    });
    assert(layout.profileButton.y + layout.profileButton.h < layout.retryButton.y);
    assert(layout.retryButton.y + layout.retryButton.h < layout.privacyButton.y);
    assert(layout.profileButton.w * layout.profileButton.h < metrics.width * metrics.height / 5);
  });
};
