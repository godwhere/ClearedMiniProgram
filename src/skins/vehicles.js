// Transportation theme manifest.
//
// The sheet is a declarative 5 x 2 sprite sheet. Frames stay in the logical
// palette-slot order used by the game: city bus, high-speed train, fire truck,
// taxi, school bus, bicycle, ferry, airplane, helicopter, and hot-air balloon.
// Rendering owns slicing, tile geometry, and interaction behavior.
module.exports = {
  id: 'vehicles',
  name: '交通工具',
  category: '交通',
  assets: {
    tileSheet: 'assets/skins/vehicles/vehicle-sprite-sheet.png'
  },
  tileVisuals: {
    type: 'spriteSheet',
    asset: 'tileSheet',
    columns: 5,
    rows: 2,
    count: 10,
    // Keep the translucent board tile visible beneath transparent vehicle art.
    backgroundColor: 'emptyCell',
    backgroundAlpha: 1,
    // Vehicle silhouettes (wings, rotors, wheels, and balloon) stay inside
    // their logical board cells while remaining easy to recognize at a glance.
    scale: 0.88,
    // These colors preserve the transportation identity if the sprite sheet
    // is unavailable or fails to load on a device.
    fallbackColors: [
      '#4f8fe8',
      '#e9eef5',
      '#ef4b4b',
      '#f39a3e',
      '#f3c84b',
      '#59b96b',
      '#35cbd3',
      '#3e86d8',
      '#9564d4',
      '#f18bb1'
    ]
  }
};
