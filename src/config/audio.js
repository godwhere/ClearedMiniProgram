const defaultTrack = {
  id: 'grid-glow',
  name: '格间微光',
  src: 'assets/audio/bgm/cleared-bgm.m4a',
  volume: 0.28
};

module.exports = {
  enabledByDefault: true,
  bgm: defaultTrack,
  tracks: [defaultTrack, {
    id: 'candy-day-stroll',
    name: '漫步',
    src: 'assets/audio/candy-day-stroll/stroll.m4a',
    preview: 'assets/music-previews/candy-day-stroll.png',
    volume: 0.28
  }],
  sfx: {
    click: { src: 'assets/audio/ui-click.m4a', volume: 0.48 },
    step: { src: 'assets/audio/path-step.m4a', volume: 0.34 },
    error: { src: 'assets/audio/path-error.m4a', volume: 0.32 },
    complete: { src: 'assets/audio/path-complete.m4a', volume: 0.52, durationMs: 354 },
    victory: { src: 'assets/audio/victory-shimmer.m4a', volume: 0.56 }
  }
};
