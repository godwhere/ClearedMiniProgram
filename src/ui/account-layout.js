'use strict';

function accountLayout(metrics) {
  const width = Math.max(1, Number(metrics.width) || 1);
  const height = Math.max(1, Number(metrics.height) || 1);
  const safeTop = Math.max(0, Math.min(height, Number(metrics.safeTop) || 0));
  const safeBottom = Math.max(safeTop, Math.min(height, Number(metrics.safeBottom) || height));
  const margin = Math.min(24, width * 0.06);
  const panelWidth = Math.min(360, width - margin * 2);
  const panelTop = safeTop + 64;
  const available = Math.max(0, safeBottom - panelTop - 16);
  const panelHeight = Math.min(400, available);
  const x = (width - panelWidth) / 2;
  const gap = Math.min(12, panelHeight * 0.03);
  const buttonHeight = Math.min(48, panelHeight * 0.13);
  const buttonY = panelTop + panelHeight - (buttonHeight + gap) * 3;
  return {
    backButton: { x: margin, y: safeTop + 8, w: 44, h: 44 },
    panel: { x, y: panelTop, w: panelWidth, h: panelHeight },
    profileButton: { x: x + 12, y: buttonY, w: panelWidth - 24, h: buttonHeight },
    retryButton: { x: x + 12, y: buttonY + buttonHeight + gap, w: panelWidth - 24, h: buttonHeight },
    privacyButton: { x: x + 12, y: buttonY + (buttonHeight + gap) * 2, w: panelWidth - 24, h: buttonHeight }
  };
}

module.exports = accountLayout;
