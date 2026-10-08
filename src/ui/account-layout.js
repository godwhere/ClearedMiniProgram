'use strict';

const topBarLayout = require('./top-bar-layout.js');

function accountLayout(metrics, options) {
  const width = Math.max(1, Number(metrics.width) || 1);
  const height = Math.max(1, Number(metrics.height) || 1);
  const safeTop = Math.max(0, Math.min(height, Number(metrics.safeTop) || 0));
  const safeBottom = Math.max(safeTop, Math.min(height, Number(metrics.safeBottom) || height));
  const backupMode = !!(options && options.backupMode);
  const margin = Math.min(24, width * 0.06);
  const landscape = width > height * 1.2;
  const panelWidth = Math.min(landscape ? 620 : 360, width - margin * 2);
  const panelTop = safeTop + (landscape ? 52 : 64);
  const available = Math.max(1, safeBottom - panelTop - (landscape ? 12 : 16));
  const x = (width - panelWidth) / 2;
  const compact = available < 480;
  const inset = Math.min(compact ? 6 : 12, panelWidth * 0.04);
  const headingHeight = compact ? 18 : 24;
  const sectionGap = compact ? 8 : 20;
  const footerGap = compact ? 4 : 12;
  const rowCount = 5 + (backupMode ? 1 : 0);
  const profileRows = 1 + (backupMode ? 1 : 0);
  const rowGap = compact ? 4 : 8;
  let profileSection;
  let settingsSection;
  let summary;
  let rowHeight;
  let privacyButton;

  if (landscape) {
    const profileWidth = Math.min(220, panelWidth * 0.36);
    rowHeight = Math.min(48, (available - headingHeight - inset * 2 - rowGap * 2 - footerGap) / 4, Math.max(1,
      (available - headingHeight - inset * 2 - 72 - rowGap * profileRows) / profileRows));
    const summaryHeight = Math.min(144,
      available - headingHeight - inset * 2 - profileRows * (rowHeight + rowGap));
    profileSection = { x, y: panelTop + headingHeight, w: profileWidth,
      h: summaryHeight + inset * 2 + profileRows * (rowHeight + rowGap) };
    settingsSection = { x: x + profileWidth + sectionGap, y: panelTop + headingHeight,
      w: panelWidth - profileWidth - sectionGap, h: inset * 2 + rowHeight * 3 + rowGap * 2 };
    summary = { x: x + inset, y: profileSection.y + inset,
      w: profileWidth - inset * 2, h: summaryHeight };
    privacyButton = { x: settingsSection.x, y: settingsSection.y + settingsSection.h + footerGap,
      w: settingsSection.w, h: rowHeight };
  } else {
    const fixedHeight = headingHeight * 2 + inset * 4 + rowGap * (profileRows + 2) + sectionGap + footerGap;
    rowHeight = Math.min(52, Math.max(44, (available - fixedHeight - 112) / rowCount));
    // Only unusually short viewports compress below 44px; keep all actions visible.
    if (available < fixedHeight + 40 + rowHeight * rowCount) {
      rowHeight = Math.max(1, (available - fixedHeight - 40) / rowCount);
    }
    const summaryHeight = Math.min(112, available - fixedHeight - rowHeight * rowCount);
    profileSection = { x, y: panelTop + headingHeight, w: panelWidth,
      h: summaryHeight + inset * 2 + profileRows * (rowHeight + rowGap) };
    settingsSection = { x, y: profileSection.y + profileSection.h + sectionGap + headingHeight,
      w: panelWidth, h: inset * 2 + rowHeight * 3 + rowGap * 2 };
    summary = { x: x + inset, y: profileSection.y + inset,
      w: panelWidth - inset * 2, h: summaryHeight };
    privacyButton = { x, y: settingsSection.y + settingsSection.h + footerGap,
      w: panelWidth, h: rowHeight };
  }

  const languageRow = {
    x: settingsSection.x + inset,
    y: settingsSection.y + inset,
    w: settingsSection.w - inset * 2,
    h: rowHeight
  };
  const arrowSize = Math.min(44, languageRow.h);
  const languageControlWidth = Math.min(184, languageRow.w * 0.64);
  const languageControlX = languageRow.x + languageRow.w - languageControlWidth;
  const result = {
    backButton: topBarLayout.leading(metrics),
    panel: {
      x,
      y: panelTop,
      w: panelWidth,
      h: Math.max(profileSection.y + profileSection.h, privacyButton.y + privacyButton.h) - panelTop
    },
    profileSection,
    settingsSection,
    profileHeading: { x: profileSection.x, y: panelTop, w: profileSection.w, h: headingHeight },
    settingsHeading: { x: settingsSection.x, y: settingsSection.y - headingHeight,
      w: settingsSection.w, h: headingHeight },
    summary,
    privacyButton,
    languageRow,
    languagePrevious: {
      x: languageControlX,
      y: languageRow.y + (languageRow.h - arrowSize) / 2,
      w: arrowSize,
      h: arrowSize
    },
    languageValue: {
      x: languageControlX + arrowSize,
      y: languageRow.y,
      w: Math.max(1, languageControlWidth - arrowSize * 2),
      h: languageRow.h
    },
    languageNext: {
      x: languageRow.x + languageRow.w - arrowSize,
      y: languageRow.y + (languageRow.h - arrowSize) / 2,
      w: arrowSize,
      h: arrowSize
    }
  };
  result.clearModeButton = { x: languageRow.x, y: languageRow.y + rowHeight + rowGap,
    w: languageRow.w, h: rowHeight };
  ['Previous', 'Value', 'Next'].forEach(part => {
    result[`clearMode${part}`] = Object.assign({}, result[`language${part}`],
      { y: result[`language${part}`].y + rowHeight + rowGap });
  });
  result.volumeRow = { x: languageRow.x, y: result.clearModeButton.y + rowHeight + rowGap,
    w: languageRow.w, h: rowHeight };
  result.volumeControl = { x: languageControlX, y: result.volumeRow.y,
    w: languageControlWidth, h: rowHeight };
  result.volumeTrack = { x: languageControlX + 10, y: result.volumeRow.y + rowHeight / 2 - 3,
    w: Math.max(1, languageControlWidth - 66), h: 6 };
  result.retryButton = { x: summary.x, y: summary.y + summary.h + rowGap,
    w: summary.w, h: rowHeight };
  if (backupMode) result.restoreButton = { x: summary.x,
    y: result.retryButton.y + rowHeight + rowGap, w: summary.w, h: rowHeight };
  return result;
}

module.exports = accountLayout;
