class ProgressionService {
  constructor(progressStore, sets, config) {
    this.progressStore = progressStore;
    this.sets = sets || [];
    this.config = Object.assign({ unlockAcrossSets: true }, config || {});
    this.levels = [];
    this.sets.forEach((set, setIndex) => {
      (set.Games || []).forEach((game, levelIndex) => {
        this.levels.push({ setIndex, levelIndex });
      });
    });
  }

  isUnlocked(setIndex, levelIndex) {
    const set = this.sets[setIndex];
    if (!set || !(set.Games || [])[levelIndex]) return false;
    if (this.progressStore.isCompleted(setIndex, levelIndex)) return true;

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
}

module.exports = ProgressionService;
