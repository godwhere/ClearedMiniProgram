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
  const inset = Math.min(12, panelWidth * 0.04);
  const rowCount = 3 + (backupMode ? 1 : 0);
  let summary;
  let rowX;
  let rowWidth;
  let rowHeight;
  let rowGap;
  let firstRowY;

  if (landscape) {
    const sectionGap = Math.min(24, panelWidth * 0.04);
    const summaryWidth = Math.min(220, panelWidth * 0.36);
    rowX = x + summaryWidth + sectionGap;
    rowWidth = panelWidth - summaryWidth - sectionGap;
    rowGap = backupMode ? 8 : 12;
    rowHeight = Math.max(24, Math.min(48,
      (available - rowGap * (rowCount - 1)) / rowCount));
    const rowsHeight = rowHeight * rowCount + rowGap * (rowCount - 1);
    summary = { x, y: panelTop, w: summaryWidth, h: rowsHeight };
    firstRowY = panelTop;
  } else {
    const sectionGap = Math.min(24, Math.max(12, available * 0.05));
    rowGap = Math.min(12, Math.max(6, available * 0.025));
    let summaryHeight = Math.min(112, Math.max(72, available * 0.27));
    rowHeight = Math.min(52,
      (available - summaryHeight - sectionGap - rowGap * (rowCount - 1)) / rowCount);
    if (rowHeight < 24) {
      rowHeight = Math.max(1,
        (available - sectionGap - rowGap * (rowCount - 1)) / (rowCount + 1));
      summaryHeight = rowHeight;
    }
    rowX = x + inset;
    rowWidth = panelWidth - inset * 2;
    summary = { x: rowX, y: panelTop, w: rowWidth, h: summaryHeight };
    firstRowY = panelTop + summaryHeight + sectionGap;
  }

  const row = index => ({
    x: rowX,
    y: firstRowY + index * (rowHeight + rowGap),
    w: rowWidth,
    h: rowHeight
  });
  const languageRow = row(0);
  const arrowSize = Math.min(44, languageRow.h);
  const languageControlWidth = Math.min(164, languageRow.w * 0.58);
  const languageControlX = languageRow.x + languageRow.w - languageControlWidth;
  const result = {
    backButton: topBarLayout.leading(metrics),
    panel: {
      x,
      y: panelTop,
      w: panelWidth,
      h: Math.max(summary.y + summary.h,
        firstRowY + rowHeight * rowCount + rowGap * (rowCount - 1)) - panelTop
    },
    summary,
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
  let rowIndex = 1;
  result.retryButton = row(rowIndex++);
  if (backupMode) result.restoreButton = row(rowIndex++);
  result.privacyButton = row(rowIndex);
  return result;
}

module.exports = accountLayout;
