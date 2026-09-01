module.exports = {
  id: 'classic',
  name: '经典',
  assets: {
    logo: 'assets/logo.png'
  },
  colors: {
    homeBackground: '#ff9800',
    text: '#ffffff',
    icon: '#ffffff',
    mutedText: 'rgba(255,255,255,0.68)',
    homeMotif: 'rgba(255,255,255,0.10)',
    panel: 'rgba(0,0,0,0.22)',
    strongPanel: 'rgba(0,0,0,0.54)',
    emptyCell: 'rgba(255,255,255,0.31)',
    blockedCell: 'rgba(0,0,0,0.18)',
    blockedCellStroke: 'rgba(255,255,255,0.12)',
    selectedCellOverlay: 'rgba(255,255,255,0.22)',
    levelCell: 'rgba(255,255,255,0.24)',
    levelCellPressed: 'rgba(255,255,255,0.42)',
    levelCompleted: 'rgba(0,0,0,0.08)',
    levelCompletedStroke: 'rgba(255,255,255,0.52)',
    levelLocked: 'rgba(0,0,0,0.14)',
    controlPressed: 'rgba(255,255,255,0.16)',
    primaryButton: 'rgba(255,255,255,0.23)',
    primaryButtonStroke: 'rgba(255,255,255,0.30)',
    secondaryButton: 'rgba(0,0,0,0.12)',
    hairline: 'rgba(255,255,255,0.42)'
  },
  logoPalette: ['#ffeb3b', '#ff9800', '#f44336', '#8bc34a', null, null, '#009688', '#03a9f4', '#673ab7'],
  layout: {
    cellGapRatio: 0.085,
    maxCellGap: 5,
    minCellGap: 2,
    activeCellScale: 1.045,
    buttonRadius: 8,
    homeTopUiOffset: 24,
    // Home-only inset: leave extra breathing room above the bottom gesture
    // area after the actions switch to a two-column first row.
    homeButtonBottomInset: 72,
    playTopUiOffset: 24,
    themesTopUiOffset: 16,
    // Keep the original top-right control geometry stable while themes are
    // added.  New manifests may override this token, but the default play
    // screen must not shift as a side effect of the theme gallery.
    playRightShift: 34
  },
  animation: {
    pathClearMs: 300,
    boardEnterMs: 420,
    resultDelayMs: 360
  }
};
