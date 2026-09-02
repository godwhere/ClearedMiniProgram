// Music theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames stay in logical
// palette-slot order: dark vinyl record/turntable, white piano key, red
// microphone, orange drum, yellow bell, green guitar, cyan headphones, blue
// musical note, purple trumpet, and pink accordion. Rendering owns slicing,
// tile geometry, and interaction behavior.
module.exports = {
  id: 'music',
  preview: 'assets/theme-previews/music.png',
  name: '音乐',
  category: '音乐',
  assets: {
    tileSheet: 'assets/skins/music/music-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible beneath transparent music art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Source cells carry a 24px transparent safety edge around every instrument.
    scale: 1,
    // The vinyl/turntable slot is intentionally dark. A bright fallback keeps
    // it visible when the sheet is unavailable and can serve as an accent
    // outline in hosts that render strokes.
    fallbackColors: [
      '#6e83ff',
      '#f5f7ff',
      '#ef4b5f',
      '#f38a3d',
      '#f3c64b',
      '#62bf72',
      '#4edbd7',
      '#4d8fe8',
      '#9864d4',
      '#ef8eb5'
    ]
  }
};
