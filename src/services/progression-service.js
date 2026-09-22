class ProgressionService {
  constructor(progressStore, sets, config, navigation) {
    this.progressStore = progressStore;
    this.sets = sets || [];
    this.config = Object.assign({ unlockAcrossSets: true }, config || {});
    this.levels = [];
    this.sets.forEach((set, setIndex) => {
      (set.Games || []).forEach((game, levelIndex) => {
        this.levels.push({ setIndex, levelIndex });
      });
    });
    const options = navigation || {};
    const order = options.levels;
    const known = new Set(this.levels.map(level => `${level.setIndex}:${level.levelIndex}`));
    if (Array.isArray(order) && order.length === known.size &&
        new Set(order.map(level => level && `${level.setIndex}:${level.levelIndex}`)).size === known.size &&
        order.every(level => level && Number.isInteger(level.setIndex) && Number.isInteger(level.levelIndex) &&
          known.has(`${level.setIndex}:${level.levelIndex}`))) {
      this.levels = order.map(level => ({ setIndex: level.setIndex, levelIndex: level.levelIndex }));
    }
    this.isPermanentlyUnlocked = typeof options.isPermanentlyUnlocked === 'function'
      ? options.isPermanentlyUnlocked : () => false;
    this.contentAccess = typeof options.contentAccess === 'function'
      ? options.contentAccess : () => ({ allowed: true, reason: 'not_gated' });
  }

  accessStatus(setIndex, levelIndex) {
    const set = this.sets[setIndex];
    if (!set || !(set.Games || [])[levelIndex]) {
      return { allowed: false, commercialAllowed: false, progressionUnlocked: false,
        reason: 'unknown_level' };
    }
    let commercial;
    try {
      commercial = this.contentAccess({ type: 'level', setIndex, levelIndex });
    } catch (error) {
      commercial = null;
    }
    if (!commercial || commercial.allowed !== true) {
      return Object.assign({}, commercial && typeof commercial === 'object' ? commercial : {}, {
        allowed: false,
        commercialAllowed: false,
        progressionUnlocked: false,
        reason: commercial && typeof commercial.reason === 'string'
          ? commercial.reason : 'content_access_unavailable'
      });
    }
    const progressionUnlocked = this.isUnlocked(setIndex, levelIndex);
    return Object.assign({}, commercial, {
      allowed: progressionUnlocked,
      commercialAllowed: true,
      progressionUnlocked,
      reason: progressionUnlocked ? commercial.reason : 'progress_locked'
    });
  }

  isUnlocked(setIndex, levelIndex) {
    const set = this.sets[setIndex];
    if (!set || !(set.Games || [])[levelIndex]) return false;
    if (this.progressStore.isCompleted(setIndex, levelIndex)) return true;
    // A reordered prerequisite must never revoke an already paid entrance.
    if (this.isPermanentlyUnlocked(setIndex, levelIndex)) return true;

    // Bootstrap supplies this transient flag only for the WeChat Developer
    // Tools simulator. It is never persisted and therefore cannot change
    // progression in a release or real-device build.
    if (this.config.unlockAllLevelsInDevTools === true) return true;

    if (!this.config.unlockAcrossSets) {
      return levelIndex === 0 || this.progressStore.isCompleted(setIndex, levelIndex - 1);
    }

    const position = this.levels.findIndex(level =>
      level.setIndex === setIndex && level.levelIndex === levelIndex
    );
    if (position === 0) return true;
    if (position < 0) return false;
    const previous = this.levels[position - 1];
    return this.progressStore.isCompleted(previous.setIndex, previous.levelIndex);
  }

  isSetUnlocked(setIndex) {
    const set = this.sets[setIndex];
    return !!(set && (set.Games || []).some((game, levelIndex) =>
      this.isUnlocked(setIndex, levelIndex)
    ));
  }

  nextLevel(setIndex, levelIndex) {
    const position = this.levels.findIndex(level =>
      level.setIndex === setIndex && level.levelIndex === levelIndex
    );
    return position >= 0 && position + 1 < this.levels.length
      ? Object.assign({}, this.levels[position + 1])
      : null;
  }

  resumeTarget(lastPlayed) {
    const lastIndex = lastPlayed ? this.levels.findIndex(level =>
      level.setIndex === lastPlayed.setIndex && level.levelIndex === lastPlayed.levelIndex) : -1;
    if (lastIndex >= 0 && !this.progressStore.isCompleted(lastPlayed.setIndex, lastPlayed.levelIndex) &&
        this.isUnlocked(lastPlayed.setIndex, lastPlayed.levelIndex)) return Object.assign({}, this.levels[lastIndex]);
    for (let offset = 1; offset <= this.levels.length; offset += 1) {
      const index = lastIndex >= 0 ? (lastIndex + offset) % this.levels.length : offset - 1;
      const level = this.levels[index];
      if (!this.progressStore.isCompleted(level.setIndex, level.levelIndex) &&
          this.isUnlocked(level.setIndex, level.levelIndex)) return Object.assign({}, level);
    }
    return Object.assign({}, this.levels[lastIndex >= 0 ? lastIndex : 0] || { setIndex: 0, levelIndex: 0 });
  }
}

module.exports = ProgressionService;
