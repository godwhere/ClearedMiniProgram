const catalog = require('../data/catalog-v2.js');
const GameRunner = require('../core/game-runner.js');
const ProgressStore = require('./services/progress-store.js');
const SkinService = require('./services/skin-service.js');
const AdsService = require('./services/ads-service.js');
const EngagementService = require('./services/engagement-service.js');
const ProgressionService = require('./services/progression-service.js');
const AudioService = require('./services/audio-service.js');
const HintService = require('./services/hint-service.js');
const HintAccessService = require('./services/hint-access-service.js');
const adConfig = require('./config/ads.js');
const progressionConfig = require('./config/progression.js');
const audioConfig = require('./config/audio.js');
const CanvasRenderer = require('./ui/canvas-renderer.js');
const portalInstructions = require('./ui/portal-instructions.js');
const accountLayout = require('./ui/account-layout.js');
const defaultSkins = require('./skins/index.js');
const defaultMechanics = require('./mechanics/index.js');
const defaultPortalMechanic = defaultMechanics.get('portal');
const { createCatalogRunContext } = require('./gameplay/run-context.js');
const completionPolicies = require('./gameplay/completion-policies.js');
const BoardInputController = require('./gameplay/board-input-controller.js');

// Daily challenge files are introduced independently from the ordinary
// level/catalog pipeline.  Keep direct app construction (including older
// hosts and focused renderer tests) safe while those optional modules are
// absent or while a host injects its own implementation.
function optionalRequire(path, fallback) {
  try {
    return require(path);
  } catch (error) {
    return fallback;
  }
}

// The effect service is intentionally optional at this boundary.  This keeps
// lightweight hosts (and older focused tests) bootable while the built-in
// registry is being introduced; production bootstrap injects the real
// service/manifest.
const ClearEffectService = optionalRequire('./services/clear-effect-service.js', null);

const DailyChallengeService = optionalRequire('./services/daily-challenge-service.js', null);
const DailyProgressStore = optionalRequire('./services/daily-progress-store.js', null);
const defaultDailyManifest = optionalRequire('../data/daily-challenges.js', {
  SchemaVersion: 1,
  TimeZone: 'Asia/Shanghai',
  Challenges: []
});
const defaultDailySolutions = optionalRequire('../data/daily-solutions.js', null);
const defaultPortalSolutions = optionalRequire('../data/portal-solutions.js', null);

// Daily mode deliberately has its own entry budget.  Keep the default here
// as an orchestration fallback; published manifests/services may override it
// with a positive integer (the current manifest allows three entries per day).
const DEFAULT_DAILY_ENTRY_LIMIT = 3;

function dailyObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function dailyInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Gallery paging is deliberately kept in the app orchestration layer. The
// renderer owns each grid layout, while the app exposes stable page sizes and
// clamps navigation state. Ordinary levels use the flattened catalog order;
// their stored set/level coordinates remain unchanged.
const LEVEL_PAGE_SIZE = 25;
const THEME_PAGE_SIZE = 6;
const CORRIDOR_PAGE_SIZE = 6;
const EFFECT_PAGE_SIZE = 6;
const EFFECT_MIN_DURATION_MS = 80;
const EFFECT_MAX_DURATION_MS = 500;
const FAILURE_DIALOG_ENTER_MS = 180;
const HINT_PREVIEW_DURATION_MS = 10000;
const OUTCOME = GameRunner.OUTCOME || {
  PLAYING: 'playing',
  WON: 'won',
  FAILED: 'failed'
};
function portalExpectedExits(pending) {
  if (!pending || typeof pending !== 'object') return [];
  const raw = Array.isArray(pending.eligibleExits)
    ? pending.eligibleExits
    : (Array.isArray(pending.expectedExits)
      ? pending.expectedExits
      : (Array.isArray(pending.exits)
        ? pending.exits
        : (Number.isInteger(pending.exit) ? [pending.exit] : [])));
  const seen = new Set();
  return raw.filter(index => {
    if (!Number.isInteger(index) || seen.has(index)) return false;
    seen.add(index);
    return true;
  });
}

const DEFAULT_FADE_EFFECT = {
  id: 'fade',
  name: '逐渐消失',
  type: 'fade',
  preview: 'assets/effects/fade/preview.png',
  durationMs: 300,
  params: {
    alphaFrom: 1,
    alphaTo: 0,
    scaleFrom: 1,
    scaleTo: 1.14,
    staggerRatio: 0.018
  }
};

const DEFAULT_NONE_EFFECT = {
  id: 'none',
  name: '无特效',
  type: 'none',
  preview: 'assets/effects/none/preview.png',
  durationMs: 0,
  params: {}
};

function plainObject(value) {
  try {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (error) {
    return false;
  }
}

function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (plainObject(value)) {
    const result = {};
    Object.keys(value).forEach(key => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      result[key] = cloneData(value[key]);
    });
    return result;
  }
  return value;
}

function fallbackClearEffects(progress) {
  let currentId = 'fade';
  try {
    const saved = progress && typeof progress.getSetting === 'function'
      ? progress.getSetting('clearEffectId', 'fade')
      : 'fade';
    if (saved === 'none' || saved === 'fade') currentId = saved;
  } catch (error) {
    currentId = 'fade';
  }
  const manifests = {
    none: DEFAULT_NONE_EFFECT,
    fade: DEFAULT_FADE_EFFECT
  };
  const manifest = id => cloneData(manifests[id] || DEFAULT_FADE_EFFECT);
  return {
    current() { return manifest(currentId); },
    get(id) { return manifests[id] ? manifest(id) : null; },
    list() {
      return ['none', 'fade'].map(id => {
        const effect = manifests[id];
        return { id: effect.id, name: effect.name, type: effect.type, preview: effect.preview };
      });
    },
    resolve(id) { return manifest(manifests[id] ? id : 'fade'); },
    currentIdValue() { return currentId; },
    select(id) {
      if (!manifests[id]) return false;
      currentId = id;
      if (progress && typeof progress.setSetting === 'function') progress.setSetting('clearEffectId', currentId);
      return true;
    }
  };
}

class ClearedApp {
  constructor(platform, options) {
    const opts = options || {};
    this.platform = platform;
    this.subpackages = opts.subpackages || null;
    this.pendingSkinId = null;
    this.skinLoadRequestId = 0;
    this.portalMechanic = opts.portalMechanic === undefined
      ? defaultPortalMechanic
      : opts.portalMechanic;
    this.portalSolutions = opts.portalSolutions !== undefined
      ? opts.portalSolutions
      : defaultPortalSolutions;
    // The home migration is deliberately opt-in. Production/default builds
    // keep the existing visible `home:themes` hit; tests or a later release
    // can explicitly enable the replacement with `homeMigration: true` (or
    // HOME_MIGRATION=true in a host environment).
    const explicitHomeMigration = opts.homeMigration !== undefined
      ? opts.homeMigration : opts.HOME_MIGRATION;
    this.homeMigration = explicitHomeMigration !== undefined
      ? (explicitHomeMigration === true || explicitHomeMigration === 'true')
      : (typeof process !== 'undefined' && process.env && process.env.HOME_MIGRATION === 'true');
    this.progress = opts.progress || new ProgressStore(platform);
    this.auth = opts.auth || null;
    this.progressSync = opts.progressSync || null;
    this.behavior = opts.behavior || null;
    this.profile = opts.profile || null;
    this.share = opts.share || null;
    this.rewards = opts.rewards || null;
    this.dailyExtraRequest = null;
    this.dailyRewardMessage = null;
    this.pendingShare = null;
    this.accountGeneration = 0;
    this.accountMessage = '';
    this.accountProfilePending = false;
    this.accountSyncPending = null;
    this.hidden = false;
    this.disposed = false;
    this.progression = new ProgressionService(
      this.progress,
      catalog.sets,
      opts.progressionConfig || progressionConfig
    );
    // Bootstrap passes the registry explicitly, but direct app construction
    // (tests and lightweight hosts) should expose the same built-in themes.
    // An explicit `skins` option remains an intentional override.
    this.skins = new SkinService(
      this.progress,
      opts.skins === undefined ? defaultSkins : opts.skins
    );
    // Clear effects are a visual-only registry. Keep the service at the app
    // boundary so selection/persistence remains an orchestration concern,
    // while the renderer receives only read-only query methods.
    this.clearEffects = opts.clearEffects || opts.clearEffectService || null;
    if (!this.clearEffects && ClearEffectService) {
      try {
        this.clearEffects = new ClearEffectService(this.progress, opts.effects || []);
      } catch (error) {
        this.clearEffects = null;
      }
    }
    if (!this.clearEffects || typeof this.clearEffects.current !== 'function') {
      this.clearEffects = fallbackClearEffects(this.progress);
    }
    this.ads = opts.ads || new AdsService(platform, opts.adConfig || adConfig);
    this.hintRequest = null;
    this.hintFeedback = null;
    this.runSequence = 0;
    this.audio = new AudioService(platform, this.progress, opts.audioConfig || audioConfig);
    // Daily mode owns a separate service/store pair.  They are deliberately
    // injectable so tests and future remote manifests can control the clock
    // and persistence without leaking daily state into ProgressStore.
    this.dailyClock = typeof opts.clock === 'function' ? opts.clock : () => new Date();
    const usingBuiltInDailyManifest = opts.dailyManifest === undefined;
    this.dailyManifest = usingBuiltInDailyManifest
      ? defaultDailyManifest
      : opts.dailyManifest;
    // A custom manifest should be able to rely on the runner's BFS fallback
    // without being rejected merely because its level IDs are absent from the
    // built-in solution table. Hosts can still opt into the built-in table by
    // passing dailySolutions explicitly.
    this.dailySolutions = opts.dailySolutions === undefined
      ? (usingBuiltInDailyManifest ? defaultDailySolutions : null)
      : opts.dailySolutions;
    // Debug builds may explicitly bypass the daily entry budget so the two
    // levels can be exercised repeatedly. Production/direct construction keeps
    // the configured finite limit unless this opt-in is present.
    this.dailyDebugUnlimited = opts.dailyDebugUnlimited === true ||
      opts.debugDailyUnlimited === true;
    this.debugDailyUnlimited = this.dailyDebugUnlimited;
    this.dailyService = opts.dailyService || opts.dailyChallengeService || null;
    if (!this.dailyService && DailyChallengeService) {
      try {
        this.dailyService = new DailyChallengeService(this.dailyManifest, {
          clock: this.dailyClock,
          timeZone: opts.dailyTimeZone || opts.timeZone || this.dailyManifest.TimeZone || 'Asia/Shanghai',
          entryLimit: opts.dailyEntryLimit,
          solutions: this.dailySolutions
        });
      } catch (error) {
        // A malformed optional manifest must not make ordinary levels or the
        // theme gallery unavailable.  The home entry will render disabled.
        this.dailyService = null;
      }
    }
    this.dailyProgress = opts.dailyStore || opts.dailyProgressStore || null;
    if (!this.dailyProgress && DailyProgressStore) {
      try {
        this.dailyProgress = new DailyProgressStore(platform, {
          clock: this.dailyClock,
          debugUnlimited: this.dailyDebugUnlimited
        });
      } catch (error) {
        this.dailyProgress = null;
      }
    }
    // Keep both descriptive aliases available to hosts and tests while the
    // internal short names remain compact in the orchestration code.
    this.dailyChallengeService = this.dailyService;
    this.dailyProgressStore = this.dailyProgress;
    this.hintAccess = opts.hintAccess || new HintAccessService(platform, {
      clock: this.dailyClock,
      timeZone: opts.dailyTimeZone || opts.timeZone || (this.dailyService && this.dailyService.timeZone) || 'Asia/Shanghai'
    });
    this.engagement = opts.engagement || new EngagementService({ ads: this.ads, share: this.share,
      hintAccess: this.hintAccess, behavior: this.behavior, config: (opts.adConfig || adConfig).rules });
    this.hints = new HintService(
      opts.solutionCatalog || null,
      this.dailySolutions,
      this.portalSolutions
    );
    this.onDailyCompleted = typeof opts.onDailyCompleted === 'function'
      ? opts.onDailyCompleted
      : function () {};
    // Reserved extension point for a future ad/share revive flow.  The app
    // only emits the event today; it never grants entries or mutates a
    // runner in response to it.
    this.onDailyRevive = typeof opts.onDailyRevive === 'function'
      ? opts.onDailyRevive
      : (typeof opts.onDailyReviveRequested === 'function'
        ? opts.onDailyReviveRequested
        : function () {});

    this.renderer = new CanvasRenderer(platform, this.skins, this.clearEffects, this.subpackages);
    this.renderer.setInvalidate(() => this.invalidate());
    this.boardInput = new BoardInputController(null, this.renderer);

    this.scene = 'home';
    this.setIndex = 0;
    this.levelIndex = 0;
    this.runContext = null;
    // Selection pagination is display-only. setIndex/levelIndex remain the
    // canonical catalog coordinates used by progress, hints and settlement.
    this.levelPageIndex = 0;
    // Keep theme pagination independent from ordinary level selection. A
    // theme selection never changes this value, so returning to the gallery
    // keeps the user on the page they were browsing.
    this.themePageIndex = 0;
    // Each gallery owns an independent cursor. Do not reuse setIndex or the
    // theme page index when adding future corridor/effect entries.
    this.corridorPageIndex = 0;
    this.effectPageIndex = 0;
    this.galleryOrigin = 'home';
    this.corridorEntries = Array.isArray(opts.corridorEntries)
      ? opts.corridorEntries.map(item => cloneData(item))
      : [
        { id: 'themes', name: '主题', action: 'corridor:themes' },
        { id: 'effects', name: '特效', action: 'corridor:effects' }
      ];
    this.runner = null;
    this.pointer = null;
    this.pressedId = null;
    this.clearAnimation = null;
    this.result = null;
    this.resultVisibleAt = 0;
    this.levelEnteredAt = 0;
    this.daily = this.emptyDailyState();
    this.dailyEntryNonce = 0;
    this.hint = null;
    this.hintUntil = 0;
    this.hintPreview = null;
    this.dirty = true;
    this.wasAnimating = false;
    this.lastClockSecond = -1;
  }

  start() {
    this.unbindPointer = this.platform.bindPointer({
      start: point => this.onPointerStart(point),
      move: point => this.onPointerMove(point),
      end: point => this.onPointerEnd(point),
      cancel: point => this.onPointerCancel(point)
    });
    this.platform.bindLifecycle({
      hide: () => this.onHide(),
      show: options => this.onShow(options),
      resize: () => {
        this.renderer.ctx = this.platform.context;
        if (this.scene === 'account' && this.profile) {
          this.profile.handleResize(accountLayout(this.platform.metrics).profileButton);
        }
        this.invalidate();
      },
      audioInterruptBegin: () => this.audio.pauseAll(),
      audioInterruptEnd: () => this.audio.resumeAll()
    });
    this.startLoop();
    this.prepareCurrentSkinAssets();
  }

  startLoop() {
    this.platform.startLoop(now => this.tick(now));
  }

  clockNow() {
    try {
      const value = this.dailyClock();
      return value instanceof Date ? value : new Date(value);
    } catch (error) {
      return new Date();
    }
  }

  emptyDailyState() {
    return {
      progressionScope: 'daily',
      dayId: null,
      dateKey: null,
      levels: [],
      levelIndex: 0,
      challenge: null,
      challengeId: null,
      runner: null,
      enteredAt: 0,
      runStartedAt: 0,
      elapsedBeforeLevel: 0,
      result: null,
      resultVisibleAt: 0,
      clearAnimation: null,
      resolution: null,
      entryLimit: DEFAULT_DAILY_ENTRY_LIMIT,
      entriesUsed: 0,
      entriesRemaining: DEFAULT_DAILY_ENTRY_LIMIT,
      debugUnlimited: false,
      levelResults: [],
      firstClear: false,
      dayFirstClear: false,
      completionRecorded: false,
      entryIdempotencyKey: null,
      entryState: null
    };
  }

  /**
   * Return the immutable level list carried by a resolved daily package.
   * `levels` is the v2 shape; the single `challenge` alias keeps older
   * injected manifests and focused tests working while they migrate.
   */
  dailyLevels(resolution) {
    if (!resolution) return [];
    if (Array.isArray(resolution.levels) && resolution.levels.length) {
      return resolution.levels.slice();
    }
    if (Array.isArray(resolution.Levels) && resolution.Levels.length) {
      return resolution.Levels.slice();
    }
    const challenge = resolution.challenge || resolution.Challenge || null;
    if (challenge && Array.isArray(challenge.Levels) && challenge.Levels.length) {
      return challenge.Levels.slice();
    }
    return challenge ? [challenge] : [];
  }

  dailyLevelId(level, levelIndex, resolution) {
    const source = level || {};
    const candidate = source.Id === undefined
      ? (source.id === undefined
        ? (source.LevelId === undefined ? source.levelId : source.LevelId)
        : source.id)
      : source.Id;
    if (candidate !== undefined && candidate !== null && String(candidate)) return String(candidate);
    const dayId = resolution && (resolution.dayId || resolution.DayId || resolution.challengeId);
    const dateKey = resolution && resolution.dateKey;
    return `${dayId || dateKey || 'daily'}-level-${Number(levelIndex) + 1}`;
  }

  /**
   * Normalize the data-only level aliases before handing them to GameRunner.
   * The service normally returns canonical upper-case fields, but this small
   * adapter keeps custom test/remote manifests from leaking strings or lower
   * case line endpoints into the rule layer.
   */
  prepareDailyLevel(level, levelIndex, resolution) {
    if (!dailyObject(level)) return null;
    const result = Object.assign({}, level);
    const width = result.Width === undefined ? result.width : result.Width;
    const height = result.Height === undefined ? result.height : result.Height;
    result.Width = dailyInteger(width, width);
    result.Height = dailyInteger(height, height);
    const blocked = result.Blocked === undefined ? result.blocked : result.Blocked;
    if (blocked !== undefined) result.Blocked = Array.isArray(blocked) ? blocked.slice() : blocked;
    const palette = result.Palette === undefined ? result.palette : result.Palette;
    if (palette !== undefined) result.Palette = Array.isArray(palette) ? palette.slice() : palette;
    const lines = result.Lines === undefined ? result.lines : result.Lines;
    if (Array.isArray(lines)) {
      result.Lines = lines.map(line => {
        if (!dailyObject(line)) return line;
        const normalized = Object.assign({}, line);
        if (normalized.Start === undefined) normalized.Start = normalized.start;
        if (normalized.End === undefined) normalized.End = normalized.end;
        return normalized;
      });
    }
    if (result.Id === undefined && result.id === undefined) {
      result.Id = this.dailyLevelId(result, levelIndex, resolution);
    }
    if (result.LevelIndex === undefined && result.levelIndex === undefined) {
      result.LevelIndex = Number(levelIndex);
    }
    return result;
  }

  dailyEntryLimit(resolution) {
    const raw = resolution && (resolution.entryLimit === undefined
      ? (resolution.EntryLimit === undefined ? null : resolution.EntryLimit)
      : resolution.entryLimit);
    const number = dailyInteger(raw, DEFAULT_DAILY_ENTRY_LIMIT);
    return Math.max(1, number);
  }

  dailyStoreDay(dateKey) {
    if (!this.dailyProgress || !dateKey) return null;
    try {
      if (typeof this.dailyProgress.getDay === 'function') {
        return this.dailyProgress.getDay(dateKey);
      }
      if (typeof this.dailyProgress.get === 'function') return this.dailyProgress.get(dateKey);
    } catch (error) {
      return null;
    }
    return null;
  }

  dailyStateNumbers(resolution, day) {
    const entryLimit = this.dailyEntryLimit(resolution);
    const source = dailyObject(day) ? day : {};
    const usedValue = source.entriesUsed === undefined
      ? (source.attempts === undefined ? source.used : source.attempts)
      : source.entriesUsed;
    const entriesUsed = Math.max(0, dailyInteger(usedValue, 0));
    const configuredLimit = Math.max(1, dailyInteger(
      source.entryLimit === undefined ? source.EntryLimit : source.entryLimit,
      entryLimit
    ));
    const limit = Math.max(entryLimit, configuredLimit);
    return {
      entryLimit: limit,
      entriesUsed,
      entriesRemaining: Math.max(0, limit - entriesUsed)
    };
  }

  dailyResultAllowed(result) {
    if (result === false || result === null) return false;
    if (result === undefined) return false;
    if (result === true) return true;
    if (!dailyObject(result)) return !!result;
    if (result.ok === false || result.allowed === false || result.canEnter === false || result.available === false) {
      return false;
    }
    if (result.error || result.reason === 'entry-limit-reached' || result.reason === 'limit-reached') return false;
    return true;
  }

  dailyAllowedValue(result, fallback) {
    if (typeof result === 'boolean') return result;
    if (dailyObject(result)) {
      if (result.allowed !== undefined) return !!result.allowed;
      if (result.canEnter !== undefined) return !!result.canEnter;
      if (result.available !== undefined) return !!result.available;
      if (result.ok !== undefined) return result.ok !== false;
    }
    return fallback;
  }

  dailyCallCanEnter(resolution, numbers) {
    if (!this.dailyProgress || typeof this.dailyProgress.canEnter !== 'function') {
      return { allowed: numbers.entriesRemaining > 0, source: 'fallback' };
    }
    const dateKey = resolution && resolution.dateKey;
    let result;
    try {
      // The public store contract is positional: canEnter(dateKey, limit).
      result = this.dailyProgress.canEnter(dateKey, numbers.entryLimit);
    } catch (error) {
      result = null;
    }
    // A few host integrations shipped the object form first.  Retry only
    // when the positional call clearly failed to produce a usable answer.
    if ((result === undefined || result === null ||
         (result === false && this.dailyProgress.canEnter.length <= 1)) && this.dailyProgress.canEnter) {
      try {
        result = this.dailyProgress.canEnter({
          dateKey,
          dayId: resolution && (resolution.dayId || resolution.challengeId),
          entryLimit: numbers.entryLimit
        });
      } catch (error) {
        result = null;
      }
    }
    const allowed = this.dailyAllowedValue(result, numbers.entriesRemaining > 0);
    return { allowed, source: 'store', raw: result };
  }

  dailyEntryState(resolution) {
    if (!resolution || resolution.status !== 'available') {
      return {
        entryLimit: this.dailyEntryLimit(resolution),
        entriesUsed: 0,
        entriesRemaining: 0,
        allowed: false,
        source: 'unavailable',
        day: null
      };
    }
    const day = this.dailyStoreDay(resolution.dateKey);
    const numbers = this.dailyStateNumbers(resolution, day);
    const resolvedDayId = resolution.dayId || resolution.DayId || resolution.challengeId;
    if (dailyObject(day) && day.dayId && resolvedDayId && day.dayId !== resolvedDayId) {
      return Object.assign(numbers, {
        allowed: false,
        source: 'store',
        reason: 'challenge-mismatch',
        day
      });
    }
    if (this.dailyDebugUnlimited) {
      return Object.assign(numbers, {
        allowed: true,
        debugUnlimited: true,
        entriesRemaining: null,
        day
      });
    }
    const gate = this.dailyCallCanEnter(resolution, numbers);
    // A persisted count is authoritative even if a legacy store's canEnter
    // implementation accidentally reports true after the limit is reached.
    const allowed = numbers.entriesRemaining > 0 && gate.allowed;
    return Object.assign(numbers, gate, { allowed, day });
  }

  dailyRecordEntry(resolution, numbers) {
    if (!this.dailyProgress || typeof this.dailyProgress.recordEntry !== 'function') {
      return {
        ok: this.dailyDebugUnlimited || numbers.entriesRemaining > 0,
        entriesUsed: numbers.entriesUsed + 1,
        entriesRemaining: this.dailyDebugUnlimited
          ? null : Math.max(0, numbers.entriesRemaining - 1),
        unlimited: this.dailyDebugUnlimited,
        persisted: false,
        reason: this.dailyDebugUnlimited || numbers.entriesRemaining > 0
          ? null : 'entry-limit-reached'
      };
    }
    const levels = this.dailyLevels(resolution);
    const levelIds = levels.map((level, index) => this.dailyLevelId(level, index, resolution));
    const dayId = resolution && (resolution.dayId || resolution.DayId || resolution.challengeId || null);
    const idempotencyKey = `${resolution.dateKey || 'daily'}:${dayId || 'day'}:entry:${Date.now()}:${++this.dailyEntryNonce}`;
    const payload = {
      dateKey: resolution.dateKey,
      dayId,
      entryLimit: numbers.entryLimit,
      levelIds,
      idempotencyKey,
      unlimited: this.dailyDebugUnlimited
    };
    let result;
    try {
      result = this.dailyProgress.recordEntry(payload);
    } catch (error) {
      result = null;
    }
    // Positional compatibility for early host doubles, and for adapters that
    // return undefined from an unsupported object-form call. Do not treat an
    // undefined result as a successful consumption because that would make
    // the UI and persisted entry budget diverge.
    if (result === undefined || result === null) {
      try {
        result = this.dailyProgress.recordEntry(
          resolution.dateKey, numbers.entryLimit, dayId, levelIds,
          { unlimited: this.dailyDebugUnlimited }
        );
      } catch (ignored) {
        result = { ok: false, reason: 'entry-record-error' };
      }
    }
    if (!this.dailyResultAllowed(result)) {
      return Object.assign({ ok: false, reason: 'entry-limit-reached' }, dailyObject(result) ? result : {});
    }
    const used = dailyObject(result) && result.entriesUsed !== undefined
      ? Math.max(0, dailyInteger(result.entriesUsed, numbers.entriesUsed + 1))
      : numbers.entriesUsed + 1;
    const reportedRemaining = dailyObject(result)
      ? (result.entriesRemaining === undefined ? result.remainingEntries : result.entriesRemaining)
      : undefined;
    const unlimited = this.dailyDebugUnlimited ||
      (dailyObject(result) && (result.unlimited === true || result.debugUnlimited === true));
    const remaining = unlimited ? null : (reportedRemaining !== undefined
      ? Math.max(0, dailyInteger(reportedRemaining, Math.max(0, numbers.entryLimit - used)))
      : Math.max(0, numbers.entryLimit - used));
    return Object.assign({ ok: true, persisted: true, entriesUsed: used, entriesRemaining: remaining },
      dailyObject(result) ? result : {}, { unlimited });
  }

  unavailableDaily(dateKey, reason) {
    return {
      status: 'unavailable',
      dateKey: dateKey || null,
      reason: reason || 'service-unavailable'
    };
  }

  resolveDaily(now) {
    if (!this.dailyService || typeof this.dailyService.resolve !== 'function') {
      return this.unavailableDaily(null);
    }
    let resolved;
    try {
      resolved = this.dailyService.resolve(now === undefined ? this.clockNow() : now);
    } catch (error) {
      return this.unavailableDaily(null, 'resolve-error');
    }
    if (!resolved || resolved.status !== 'available' ||
        (!resolved.challenge && !Array.isArray(resolved.levels) &&
         !Array.isArray(resolved.Levels))) {
      return resolved && resolved.status
        ? resolved
        : this.unavailableDaily(null, 'invalid-resolution');
    }
    // Normalize the v2 level list at the app boundary while preserving the
    // service's immutable resolution object for diagnostics and date locking.
    // Always return an app-owned envelope so frozen/injected service results
    // are never mutated by later scene code.
    const levels = this.dailyLevels(resolved);
    return Object.assign({}, resolved, {
      levels: Array.isArray(resolved.levels) && resolved.levels.length
        ? resolved.levels.slice() : levels,
      challenge: resolved.challenge || levels[0] || null,
      levelCount: resolved.levelCount || levels.length,
      entryLimit: resolved.entryLimit === undefined
        ? DEFAULT_DAILY_ENTRY_LIMIT : resolved.entryLimit
    });
  }

  dailyCompletionState(resolution) {
    if (!resolution || resolution.status !== 'available') return false;
    const levels = this.dailyLevels(resolution);
    // Prefer the explicit day-level API introduced with the two-level store.
    if (this.dailyProgress && typeof this.dailyProgress.isCompleted === 'function') {
      const dayId = resolution.dayId || resolution.DayId || resolution.challengeId;
      try {
        if (dayId && this.dailyProgress.isCompleted(resolution.dateKey, dayId)) return true;
        // Legacy one-level stores key completion by challengeId.  Only use
        // that fallback for a genuinely single-level package; otherwise a
        // completed intro must not make the whole day look finished.
        if (levels.length <= 1 && resolution.challengeId &&
            resolution.challengeId !== dayId) {
          return !!this.dailyProgress.isCompleted(resolution.dateKey, resolution.challengeId);
        }
      } catch (error) {
        // Fall through to a local/day snapshot check.
      }
    }
    const day = this.dailyStoreDay(resolution.dateKey);
    if (dailyObject(day)) {
      if (day.completed === true || day.dayCompleted === true) return true;
      const map = day.levels;
      if (levels.length && dailyObject(map)) {
        return levels.every((level, index) => {
          const id = this.dailyLevelId(level, index, resolution);
          const state = map[id] || map[String(index)];
          return !!(state && (state.completed === true || state.done === true));
        });
      }
    }
    return false;
  }

  dailyLevelCompleted(index, resolution) {
    const daily = this.daily;
    if (daily && Array.isArray(daily.levelResults) && daily.levelResults[index] &&
        daily.levelResults[index].completed === true) return true;
    const levels = this.dailyLevels(resolution || (daily && daily.resolution));
    const id = this.dailyLevelId(levels[index], index, resolution || (daily && daily.resolution));
    const day = this.dailyStoreDay((resolution || (daily && daily.resolution) || {}).dateKey);
    if (dailyObject(day) && dailyObject(day.levels)) {
      const state = day.levels[id] || day.levels[String(index)];
      if (state && (state.completed === true || state.done === true)) return true;
    }
    if (this.dailyProgress && typeof this.dailyProgress.isLevelCompleted === 'function') {
      try {
        return !!this.dailyProgress.isLevelCompleted(
          (resolution || (daily && daily.resolution) || {}).dateKey, id, index
        );
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  activeRunner() {
    if (this.scene === 'daily' || this.scene === 'dailyResult') return this.daily.runner;
    return this.runner;
  }

  runnerOutcome(runner) {
    if (!runner) return OUTCOME.PLAYING;
    const state = typeof runner.getViewState === 'function' ? runner.getViewState() : null;
    return state && (state.outcome === OUTCOME.WON || state.outcome === OUTCOME.FAILED)
      ? state.outcome
      : OUTCOME.PLAYING;
  }

  runnerTerminal(runner) {
    const state = runner && typeof runner.getViewState === 'function'
      ? runner.getViewState()
      : null;
    return !!(state && state.terminal);
  }

  activeEnteredAt() {
    if (this.scene === 'daily' || this.scene === 'dailyResult') return this.daily.enteredAt;
    return this.levelEnteredAt;
  }

  tick(now) {
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    if (this.hintPreview && timestamp >= this.hintPreview.until) {
      this.clearHintPreview(false);
      this.dirty = true;
    }
    const runner = this.activeRunner();
    if (runner && (this.scene === 'play' || this.scene === 'result' ||
                   this.scene === 'daily' || this.scene === 'dailyResult')) {
      const second = Math.floor(runner.elapsedMs() / 1000);
      if (second !== this.lastClockSecond) {
        this.lastClockSecond = second;
        this.dirty = true;
      }
    }

    const animating = this.isAnimating(timestamp);
    // Render one final frame when an animation expires so transient hint and
    // path-clear overlays are actually removed from the canvas.
    if (animating || this.wasAnimating) this.dirty = true;
    this.wasAnimating = animating;
    if (!this.dirty) return;
    this.renderer.render(this.buildModel(), timestamp);
    this.dirty = false;
  }

  isAnimating(now) {
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const skin = this.skins.current();
    const dailyScene = this.scene === 'daily' || this.scene === 'dailyResult';
    const enteredAt = this.activeEnteredAt();
    if ((this.scene === 'play' || this.scene === 'result' || dailyScene) &&
        timestamp < enteredAt + skin.animation.boardEnterMs + 140) return true;
    const clearAnimation = dailyScene ? this.daily.clearAnimation : this.clearAnimation;
    if (clearAnimation && clearAnimation.type !== 'none') {
      // A started animation is immutable. Resolve its duration from the
      // snapshot first so changing the selected effect mid-flight cannot
      // shorten or extend the animation already on screen.
      const snapshotDuration = Number(clearAnimation.durationMs);
      let duration;
      if (Number.isFinite(snapshotDuration) && snapshotDuration > 0) {
        duration = this.effectDuration(snapshotDuration, 300);
      } else {
        const effect = this.resolveClearEffect(clearAnimation.effectId);
        duration = this.effectDuration(effect, skin.animation.pathClearMs || 300);
      }
      const startedAt = Number(clearAnimation.startedAt);
      const start = Number.isFinite(startedAt) ? startedAt : timestamp;
      if (timestamp < start + duration + 80) return true;
    }
    if (this.hintPreview && timestamp < this.hintPreview.until) return true;
    if (this.scene === 'play' && this.runner &&
        this.runner.getSelectionState().lineIndex >= 0) return true;
    if (this.scene === 'daily' && this.daily.runner &&
        this.daily.runner.getSelectionState().lineIndex >= 0) return true;
    if (this.scene === 'result') {
      const enterMs = this.result && this.result.outcome === OUTCOME.FAILED
        ? FAILURE_DIALOG_ENTER_MS : 80;
      if (timestamp < this.resultVisibleAt + enterMs) return true;
    }
    if (this.scene === 'dailyResult') {
      const enterMs = this.daily.result && this.daily.result.outcome === OUTCOME.FAILED
        ? FAILURE_DIALOG_ENTER_MS : 80;
      if (timestamp < this.daily.resultVisibleAt + enterMs) return true;
    }
    return false;
  }

  buildBoardViewModel(runner, clearAnimation) {
    if (!runner || typeof runner.getViewState !== 'function') return null;
    let viewState;
    try {
      viewState = cloneData(runner.getViewState());
    } catch (error) {
      return null;
    }
    const boardState = viewState && viewState.board;
    if (!boardState || typeof boardState !== 'object') return null;
    const width = Number(boardState.width);
    const height = Number(boardState.height);
    const total = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
        !Number.isInteger(total)) return null;

    const selection = viewState.selection && typeof viewState.selection === 'object'
      ? viewState.selection : { lineIndex: -1, cells: [], segments: [], teleports: [] };
    const selectedCells = new Set();
    if (Array.isArray(selection.segments) && selection.segments.length) {
      selection.segments.forEach(segment => {
        if (Array.isArray(segment)) segment.forEach(index => selectedCells.add(index));
      });
    } else if (Array.isArray(selection.cells)) {
      selection.cells.forEach(index => selectedCells.add(index));
    }

    const mechanicState = viewState.mechanic && typeof viewState.mechanic === 'object'
      ? viewState.mechanic : { id: null, portals: [] };
    const portals = Array.isArray(mechanicState.portals) ? mechanicState.portals : [];
    const portalCells = new Set();
    portals.forEach(portal => {
      if (!portal || typeof portal !== 'object') return;
      const declaredCells = portal.cells === undefined ? portal.Cells : portal.cells;
      const cells = Array.isArray(declaredCells)
        ? declaredCells
        : [portal.A === undefined ? portal.a : portal.A,
          portal.B === undefined ? portal.b : portal.B];
      cells.forEach(index => {
        if (Number.isInteger(index) && index >= 0 && index < total) portalCells.add(index);
      });
    });

    const blocked = Array.isArray(boardState.blocked) ? boardState.blocked : [];
    const blockedSet = new Set(blocked);
    const blockedMask = Array.isArray(boardState.blockedMask) ? boardState.blockedMask : [];
    const owner = Array.isArray(boardState.owner) ? boardState.owner : [];
    const fixedLine = Array.isArray(boardState.fixedLine) ? boardState.fixedLine : [];
    const cells = new Array(total);
    for (let index = 0; index < total; index++) {
      cells[index] = {
        index,
        blocked: blockedMask[index] === true || blockedSet.has(index),
        owner: Number.isInteger(owner[index]) ? owner[index] : -1,
        fixedLine: Number.isInteger(fixedLine[index]) ? fixedLine[index] : -1,
        selected: selectedCells.has(index),
        portal: portalCells.has(index)
      };
    }

    const pending = mechanicState.pending;
    const locked = mechanicState.locked;
    const expectedExits = portalExpectedExits(pending);
    const portal = mechanicState.id === 'portal' ? {
      icon: this.portalMechanic && this.portalMechanic.icon,
      rulesVersion: mechanicState.rulesVersion,
      portals: cloneData(portals),
      phase: mechanicState.phase,
      expectedExits,
      expectedExit: mechanicState.rulesVersion === 1 && expectedExits.length === 1
        ? expectedExits[0] : null,
      instruction: portalInstructions.forState(mechanicState),
      lockedEntry: locked && Number.isInteger(locked.entry) ? locked.entry : null
    } : null;
    return {
      board: {
        width,
        height,
        lines: cloneData(boardState.lines || []),
        cells,
        completedPaths: cloneData(viewState.completedPaths || []),
        selection: cloneData(selection),
        clearAnimation: cloneData(clearAnimation),
        hint: null,
        hintUntil: 0
      },
      mechanic: { portal },
      elapsedText: typeof viewState.timeText === 'string' ? viewState.timeText : '0:00',
      canUndo: viewState.canUndo === true,
      terminal: viewState.terminal === true
    };
  }

  catalogLevelPosition(setIndex, levelIndex) {
    return catalog.levels.findIndex(entry =>
      entry.setIndex === Number(setIndex) && entry.levelIndex === Number(levelIndex)
    );
  }

  levelPageForTarget(target) {
    if (!target || typeof target !== 'object') return 0;
    const position = this.catalogLevelPosition(target.setIndex, target.levelIndex);
    return position < 0 ? 0 : Math.floor(position / LEVEL_PAGE_SIZE);
  }

  ordinaryCompletedCount() {
    return catalog.levels.reduce((count, entry) => (
      count + (this.progress.isCompleted(entry.setIndex, entry.levelIndex) ? 1 : 0)
    ), 0);
  }

  buildModel() {
    const homeDaily = this.scene === 'home' ? this.resolveDaily() : null;
    const homeDailyEntry = homeDaily && homeDaily.status === 'available'
      ? this.dailyEntryState(homeDaily)
      : {
        entryLimit: this.dailyEntryLimit(homeDaily),
        entriesUsed: 0,
        entriesRemaining: 0,
        allowed: false
      };
    const activeDaily = (this.scene === 'daily' || this.scene === 'dailyResult')
      ? this.daily
      : null;
    const dailyResolution = activeDaily
      ? (activeDaily.resolution || {
        status: activeDaily.challenge ? 'available' : 'unavailable',
        dateKey: activeDaily.dateKey,
        challengeId: activeDaily.challengeId,
        challenge: activeDaily.challenge
      })
      : homeDaily;
    const base = {
      scene: this.scene,
      pressedId: this.pressedId,
      shareAvailable: !!(this.share && this.share.isResultEnabled() && this.shareContext().completed),
      sharePending: !!this.pendingShare,
      dailyExtraEntryAvailable: !!(this.engagement.canRequestDailyExtraEntry && this.engagement.canRequestDailyExtraEntry() &&
        dailyResolution && dailyResolution.status === 'available' &&
        (this.scene === 'home' ? !homeDailyEntry.allowed : this.scene === 'dailyResult' &&
          activeDaily && activeDaily.result && activeDaily.result.outcome !== OUTCOME.FAILED && activeDaily.entriesRemaining <= 0)),
      dailyExtraEntryPending: !!this.dailyExtraRequest,
      dailyRewardMessage: this.dailyRewardMessage && dailyResolution && this.dailyRewardMessage.dateKey === dailyResolution.dateKey ? this.dailyRewardMessage.text : '',
      // Count only published ordinary levels. Retired catalog coordinates may
      // remain in an upgraded player's save and must not inflate this total.
      completedCount: this.ordinaryCompletedCount(),
      totalLevels: catalog.levels.length,
      soundEnabled: this.audio.isEnabled(),
      hint: this.hint,
      hintUntil: this.hintUntil,
      hintPreview: this.hintPreview,
      hintLabel: this.hintButtonLabel(),
      dailyAvailable: !!(homeDaily && homeDaily.status === 'available'),
      dailyEntryAvailable: !!homeDailyEntry.allowed,
      dailyCanEnter: !!homeDailyEntry.allowed,
      dailyDateKey: homeDaily && homeDaily.dateKey ? homeDaily.dateKey : null,
      dailyCompleted: this.dailyCompletionState(homeDaily),
      dailyEntriesUsed: homeDailyEntry.entriesUsed,
      dailyEntryLimit: homeDailyEntry.entryLimit,
      dailyEntriesRemaining: this.dailyDebugUnlimited ? null : homeDailyEntry.entriesRemaining,
      dailyDebugUnlimited: this.dailyDebugUnlimited,
      homeMigration: this.homeMigration,
      // Expose the active visual selection as data only. The renderer never
      // mutates this value; `performAction('effect:<id>')` owns persistence.
      currentEffectId: this.currentEffectId()
    };

    if (this.scene === 'account') {
      const sync = this.progressSync ? this.progressSync.state() : { status: 'idle' };
      const auth = this.auth ? this.auth.state() : 'anonymous';
      const status = sync.status === 'account-mismatch' ? 'account-mismatch'
        : this.accountSyncPending || auth === 'authenticating' || sync.status === 'syncing' ? 'syncing'
          : sync.status === 'synced' ? 'synced' : sync.status === 'error' ? 'error' : 'local';
      return Object.assign(base, {
        accountStatus: status, accountMessage: this.accountMessage,
        accountProfile: this.profile ? this.profile.current() : null,
        profileSupported: !!(this.profile && this.profile.isSupported()),
        profilePending: this.accountProfilePending,
        syncPending: !!this.accountSyncPending
      });
    }

    if (activeDaily) {
      const completed = this.dailyCompletionState(dailyResolution);
      const boardView = this.buildBoardViewModel(activeDaily.runner, activeDaily.clearAnimation);
      const portalStatus = boardView && boardView.mechanic.portal;
      return Object.assign(base, {
        dailyAvailable: !!activeDaily.challenge,
        dailyEntryAvailable: this.dailyDebugUnlimited || activeDaily.entriesRemaining > 0,
        dailyCanEnter: this.dailyDebugUnlimited || activeDaily.entriesRemaining > 0,
        dailyDateKey: activeDaily.dateKey,
        dailyDayId: activeDaily.dayId,
        dailyChallengeId: activeDaily.challengeId,
        dailyCompleted: completed,
        challenge: activeDaily.challenge,
        levels: activeDaily.levels,
        dailyLevels: activeDaily.levels,
        levelIndex: activeDaily.levelIndex,
        dailyLevelIndex: activeDaily.levelIndex,
        levelCount: activeDaily.levels.length,
        dailyLevelCount: activeDaily.levels.length,
        dailyLevelResults: activeDaily.levelResults,
        dailyDifficulty: activeDaily.challenge &&
          (activeDaily.challenge.Difficulty || activeDaily.challenge.difficulty || null),
        dailyEntriesUsed: activeDaily.entriesUsed,
        dailyEntryLimit: activeDaily.entryLimit,
        dailyEntriesRemaining: this.dailyDebugUnlimited ? null : activeDaily.entriesRemaining,
        dailyDebugUnlimited: this.dailyDebugUnlimited,
        board: boardView && boardView.board,
        mechanic: boardView ? boardView.mechanic : { portal: null },
        elapsedText: boardView ? boardView.elapsedText : '0:00',
        canUndo: !!(boardView && boardView.canUndo),
        levelEnteredAt: activeDaily.enteredAt,
        clearAnimation: activeDaily.clearAnimation,
        hintAvailable: !!boardView && !boardView.terminal && !this.hintRequest,
        result: activeDaily.result,
        resultVisibleAt: activeDaily.resultVisibleAt,
        runStartedAt: activeDaily.runStartedAt,
        elapsedBeforeLevel: activeDaily.elapsedBeforeLevel,
        dailyTotalElapsedMs: activeDaily.result && activeDaily.result.elapsedMs,
        // These fields are intentionally namespaced by scene/action in the
        // renderer; no ordinary setIndex/levelIndex is supplied here.
        dailyResultVisibleAt: activeDaily.resultVisibleAt,
        portals: portalStatus ? portalStatus.portals : [],
        portalStatus,
        expectedExit: portalStatus ? portalStatus.expectedExit : null,
        expectedExits: portalStatus ? portalStatus.expectedExits : [],
        portalInstruction: portalStatus ? portalStatus.instruction : null
      });
    }

    if (this.scene === 'levels') {
      const levelPageCount = Math.max(1, Math.ceil(catalog.levels.length / LEVEL_PAGE_SIZE));
      const rawPageIndex = Number(this.levelPageIndex);
      this.levelPageIndex = clamp(
        Number.isFinite(rawPageIndex) ? rawPageIndex : 0,
        0,
        levelPageCount - 1
      );
      const pageStart = this.levelPageIndex * LEVEL_PAGE_SIZE;
      const levelItems = catalog.levels
        .slice(pageStart, pageStart + LEVEL_PAGE_SIZE)
        .map((entry, offset) => {
          const game = entry.game || {};
          const mechanicId = game.Mechanic === undefined
            ? (game.mechanic === undefined ? null : game.mechanic)
            : game.Mechanic;
          return {
            action: `level:${entry.setIndex}:${entry.levelIndex}`,
            displayNumber: pageStart + offset + 1,
            setIndex: entry.setIndex,
            levelIndex: entry.levelIndex,
            completed: this.progress.isCompleted(entry.setIndex, entry.levelIndex),
            unlocked: this.progression.isUnlocked(entry.setIndex, entry.levelIndex),
            mechanicId: typeof mechanicId === 'string' && mechanicId ? mechanicId : null
          };
        });
      return Object.assign(base, {
        levelItems,
        levelPageIndex: this.levelPageIndex,
        levelPageCount,
        levelPageSize: LEVEL_PAGE_SIZE,
        levelRangeStart: levelItems.length ? levelItems[0].displayNumber : 0,
        levelRangeEnd: levelItems.length
          ? levelItems[levelItems.length - 1].displayNumber : 0
      });
    }

    if (this.scene === 'themes') {
      const themes = this.themeDescriptors();
      const themePageCount = this.themePageCount(themes);
      const rawPageIndex = Number(this.themePageIndex);
      this.themePageIndex = clamp(
        Number.isFinite(rawPageIndex) ? rawPageIndex : 0,
        0,
        themePageCount - 1
      );
      return Object.assign(base, {
        // Expose the full descriptor list; CanvasRenderer slices it into the
        // fixed six-card page so it can render empty slots and page metadata.
        themes,
        themePageIndex: this.themePageIndex,
        themePageCount,
        themePageSize: THEME_PAGE_SIZE,
        currentThemeId: this.skins.current().id,
        backAction: this.galleryOrigin === 'corridor' ? 'themes:corridor' : 'themes:home',
        galleryOrigin: this.galleryOrigin
      });
    }

    if (this.scene === 'corridor') {
      const entries = this.corridorDescriptors();
      const pageCount = this.corridorPageCount(entries);
      const rawPageIndex = Number(this.corridorPageIndex);
      this.corridorPageIndex = clamp(
        Number.isFinite(rawPageIndex) ? rawPageIndex : 0,
        0,
        pageCount - 1
      );
      return Object.assign(base, {
        corridorEntries: entries,
        corridorPageIndex: this.corridorPageIndex,
        corridorPageCount: pageCount,
        corridorPageSize: CORRIDOR_PAGE_SIZE,
        backAction: 'corridor:home'
      });
    }

    if (this.scene === 'effects') {
      const effects = this.effectDescriptors();
      const pageCount = this.effectPageCount(effects);
      const rawPageIndex = Number(this.effectPageIndex);
      this.effectPageIndex = clamp(
        Number.isFinite(rawPageIndex) ? rawPageIndex : 0,
        0,
        pageCount - 1
      );
      return Object.assign(base, {
        effects,
        effectPageIndex: this.effectPageIndex,
        effectPageCount: pageCount,
        effectPageSize: EFFECT_PAGE_SIZE,
        currentEffectId: this.currentEffectId(),
        backAction: 'effects:corridor'
      });
    }

    if (this.scene === 'play' || this.scene === 'result') {
      const context = this.runContext;
      const set = context && context.set;
      const level = context && context.level;
      const activeLevelIndex = context ? context.levelIndex : this.levelIndex;
      const ordinaryPosition = context
        ? this.catalogLevelPosition(context.setIndex, activeLevelIndex)
        : -1;
      const boardView = this.buildBoardViewModel(this.runner, this.clearAnimation);
      const portalStatus = boardView && boardView.mechanic.portal;
      return Object.assign(base, {
        set,
        level,
        levelIndex: activeLevelIndex,
        ordinaryLevelNumber: ordinaryPosition >= 0 ? ordinaryPosition + 1 : null,
        ordinaryLevelCount: catalog.levels.length,
        board: boardView && boardView.board,
        mechanic: boardView ? boardView.mechanic : { portal: null },
        elapsedText: boardView ? boardView.elapsedText : '0:00',
        canUndo: !!(boardView && boardView.canUndo),
        levelEnteredAt: this.levelEnteredAt,
        clearAnimation: this.clearAnimation,
        hintAvailable: !!boardView && !boardView.terminal && !this.hintRequest,
        result: this.result,
        resultVisibleAt: this.resultVisibleAt,
        hasNext: !!(context && this.progression.nextLevel(context.setIndex, activeLevelIndex)),
        portals: portalStatus ? portalStatus.portals : [],
        portalStatus,
        expectedExit: portalStatus ? portalStatus.expectedExit : null,
        expectedExits: portalStatus ? portalStatus.expectedExits : [],
        portalInstruction: portalStatus ? portalStatus.instruction : null
      });
    }
    return base;
  }

  invalidate() {
    this.dirty = true;
  }

  handleBoardInputEvents(events) {
    (Array.isArray(events) ? events : []).forEach(event => {
      if (!event || !event.type) return;
      if (event.type === 'step') {
        this.audio.playSfx('step');
      } else if (event.type === 'invalid-selection' && event.action === 'end') {
        this.audio.playSfx('error');
      } else if (event.type === 'path-completed' && event.commit) {
        this.onPathCompleted(
          event.commit.lineIndex,
          event.commit.cells,
          event.commit.segments
        );
      }
    });
    this.invalidate();
  }

  onPointerStart(point) {
    if (!point || this.pointer || this.boardInput.isActive()) return;
    this.audio.unlock();
    const hit = this.renderer.hitTest(point.x, point.y);
    if (hit) {
      this.pointer = { mode: 'ui', id: point.id, start: point, last: point, hit };
      this.pressedId = hit;
      this.invalidate();
      return;
    }

    if (this.isHintPreviewActive()) return;

    if ((this.scene === 'play' && this.runner) ||
        (this.scene === 'daily' && this.daily.runner)) {
      this.hint = null;
      this.hintUntil = 0;
      this.hintPreview = null;
      const runner = this.activeRunner();
      if (this.boardInput.runner !== runner) this.boardInput.setRunner(runner);
      this.handleBoardInputEvents(this.boardInput.start(point));
      return;
    }

    if (this.scene === 'levels') {
      this.pointer = { mode: 'ui', id: point.id, start: point, last: point, hit: null };
    } else if (this.scene === 'themes' || this.scene === 'corridor' || this.scene === 'effects') {
      // A swipe may start in an empty card slot or any other non-button area,
      // so retain the pointer even when hitTest has no candidate.
      this.pointer = { mode: 'ui', id: point.id, start: point, last: point, hit: null };
    }
  }

  onPointerMove(point) {
    if (point && this.boardInput.isActive()) {
      this.handleBoardInputEvents(this.boardInput.move(point));
      return;
    }
    if (!point || !this.pointer || point.id !== this.pointer.id) return;
    this.pointer.last = point;
  }

  traceBoard(from, to) {
    if (!to || !this.boardInput.isActive()) return;
    this.handleBoardInputEvents(this.boardInput.move(to));
  }

  onPointerEnd(point) {
    if (this.boardInput.isActive()) {
      this.pressedId = null;
      this.handleBoardInputEvents(this.boardInput.end(point));
      return;
    }
    if (!this.pointer || (point && point.id !== this.pointer.id)) return;
    const active = this.pointer;
    this.pointer = null;
    this.pressedId = null;

    const end = point || active.last;
    const dx = end.x - active.start.x;
    const dy = end.y - active.start.y;
    if (this.scene === 'levels' && Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      this.changeLevelPage(dx < 0 ? 1 : -1);
      return;
    }

    if (this.scene === 'themes' && Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      this.changeThemePage(dx < 0 ? 1 : -1);
      return;
    }

    if (this.scene === 'corridor' && Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      this.changeCorridorPage(dx < 0 ? 1 : -1);
      return;
    }

    if (this.scene === 'effects' && Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      this.changeEffectPage(dx < 0 ? 1 : -1);
      return;
    }

    const releasedHit = this.renderer.hitTest(end.x, end.y);
    if (active.hit && active.hit === releasedHit) this.performAction(active.hit);
    this.invalidate();
  }

  onPointerCancel(point) {
    if (this.boardInput.isActive()) {
      this.handleBoardInputEvents(this.boardInput.cancel(point, 'pointer-cancel'));
      this.pressedId = null;
      return;
    }
    if (!this.pointer || (point && point.id !== this.pointer.id)) return;
    this.pointer = null;
    this.pressedId = null;
    this.invalidate();
  }

  onPathCompleted(lineIndex, cells, segments) {
    const now = Date.now();
    const runner = this.activeRunner();
    if (!runner) return;
    this.hint = null;
    this.hintUntil = 0;
    this.hintPreview = null;
    const skin = this.skins.current();
    const effect = this.resolveClearEffect(this.currentEffectId());
    const effectType = effect.type === 'none' ? 'none' : 'fade';
    const effectDurationMs = effectType === 'none'
      ? 0
      : this.effectDuration(effect, skin && skin.animation && skin.animation.pathClearMs);
    // "none" means there is no transient visual state to snapshot or tick.
    // Every other (including unknown) type keeps the safe fade fallback.
    const animation = effectType === 'none' ? null : {
      lineIndex,
      // Snapshot the path and effect data at the completion boundary. This
      // prevents a later undo/new selection or effect change from mutating an
      // animation already being drawn.
      cells: Array.isArray(cells) ? cells.slice() : [],
      segments: Array.isArray(segments)
        ? segments.map(segment => Array.isArray(segment) ? segment.slice() : [])
        : null,
      startedAt: now,
      effectId: effect.id || 'fade',
      type: effectType,
      durationMs: effectDurationMs,
      params: cloneData(effect.params || {})
    };
    if (this.scene === 'daily') this.daily.clearAnimation = animation;
    else this.clearAnimation = animation;
    const outcome = this.runnerOutcome(runner);
    if (outcome === OUTCOME.FAILED) {
      const runnerState = runner.getViewState();
      const remainingCells = Math.max(1, Number(runnerState.remainingPlayableCells) || 1);
      const failure = {
        outcome: OUTCOME.FAILED,
        reason: runnerState.failureReason || 'unfilled-cells',
        remainingCells,
        elapsedMs: runnerState.elapsedMs
      };
      const resultDelayMs = Number(skin && skin.animation && skin.animation.resultDelayMs) || 0;
      const visibleAt = now + Math.max(effectDurationMs, resultDelayMs);
      this.audio.playSfx('error');
      this.platform.triggerHaptic('medium');
      this.pointer = null;
      this.pressedId = null;
      if (this.renderer) this.renderer.clearInteractionHits();
      if (this.scene === 'daily') {
        this.daily.result = failure;
        this.daily.resultVisibleAt = visibleAt;
        this.scene = 'dailyResult';
      } else {
        this.result = failure;
        this.resultVisibleAt = visibleAt;
        this.scene = 'result';
      }
      this.invalidate();
      return;
    }

    this.audio.playSfx('complete');
    const dailyFinalLevel = this.scene !== 'daily' ||
      this.daily.levelIndex >= this.daily.levels.length - 1;
    if (outcome === OUTCOME.WON && dailyFinalLevel) {
      this.audio.playSfx('victory');
    }
    this.platform.triggerHaptic(outcome === OUTCOME.WON && dailyFinalLevel ? 'medium' : 'light');

    if (outcome !== OUTCOME.WON) return;
    if (this.scene === 'daily') {
      completionPolicies.settle(this.daily, { complete: () => this.completeDailyLevel() });
      return;
    }
    const completion = completionPolicies.settle(this.runContext, {
      progress: this.progress,
      elapsedMs: runner.elapsedMs()
    });
    if (!completion) return;
    this.result = completion;
    this.resultVisibleAt = now + this.skins.current().animation.resultDelayMs;
    this.scene = 'result';
    // Optional engagement starts only after the result and local completion.
    if (this.share) this.share.prepareContext(this.shareContext());
    // The legacy local store retains in-memory progress on a write failure.
    // Confirm persistence before enqueueing anything for cloud delivery.
    try { completion.persisted = this.progress.save() === true; } catch (error) { completion.persisted = false; }
    if (completion.persisted && this.progressSync) {
      try { this.progressSync.enqueueCompletion({ setIndex: this.setIndex, levelIndex: this.levelIndex,
        elapsedMs: completion.elapsedMs, completedAtClient: now,
        firstClear: completion.firstClear, newBest: completion.newBest }); } catch (error) {}
    }
    if (!completion.persisted) return;
    try {
      const task = this.engagement.onOrdinaryCompleted({
        levelKey: `${this.setIndex}:${this.levelIndex}`,
        totalClears: this.progress.state.stats.totalClears,
        firstClear: completion.firstClear, newBest: completion.newBest,
        resultVisibleAt: this.resultVisibleAt
      });
      if (task && task.catch) task.catch(function () {});
    } catch (error) {}
  }

  dailyCompletionCall(level, levelIndex, elapsedMs) {
    const daily = this.daily;
    const completedAt = this.clockNow().getTime();
    const levelId = this.dailyLevelId(level, levelIndex, daily.resolution);
    const payload = {
      dateKey: daily.dateKey,
      dayId: daily.dayId,
      levelId,
      challengeId: levelId,
      levelIndex,
      levelCount: daily.levels.length,
      levelIds: daily.levels.map((item, index) =>
        this.dailyLevelId(item, index, daily.resolution)
      ),
      elapsedMs,
      completedAt
    };
    let completion;
    if (this.dailyProgress && typeof this.dailyProgress.recordLevelCompletion === 'function') {
      try {
        completion = this.dailyProgress.recordLevelCompletion(payload);
      } catch (error) {
        completion = null;
      }
      if (completion === undefined || completion === null) {
        try {
          completion = this.dailyProgress.recordLevelCompletion(
            daily.dateKey, levelId, elapsedMs, completedAt
          );
        } catch (error) {
          completion = null;
        }
      }
    } else if (this.dailyProgress && typeof this.dailyProgress.recordCompletion === 'function') {
      // Compatibility path for early stores that expose only
      // recordCompletion. The built-in two-level store uses
      // recordLevelCompletion above, so per-level state remains canonical.
      try {
        completion = this.dailyProgress.recordCompletion(payload);
      } catch (error) {
        try {
          completion = this.dailyProgress.recordCompletion(
            daily.dateKey, levelId, elapsedMs, completedAt
          );
        } catch (ignored) {
          completion = null;
        }
      }
    } else {
      // A missing store is useful for lightweight renderer hosts.  It is a
      // non-persisted completion and never writes to ordinary progress.
      completion = {
        ok: true,
        firstClear: false,
        newBest: false,
        bestMs: elapsedMs,
        persisted: false
      };
    }
    if (!this.dailyResultAllowed(completion)) return null;
    return Object.assign({ ok: true, elapsedMs, levelId, levelIndex }, dailyObject(completion) ? completion : {});
  }

  createDailyRunner(level, levelIndex, resolution) {
    const prepared = this.prepareDailyLevel(level, levelIndex, resolution);
    if (!prepared) return null;
    const width = Number(prepared.Width);
    const height = Number(prepared.Height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return null;
    if (!Array.isArray(prepared.Lines) || prepared.Lines.length === 0) return null;
    try {
      return new GameRunner(
        prepared,
        Array.isArray(prepared.Palette) ? prepared.Palette : [],
        () => this.invalidate(),
        { blocked: prepared.Blocked || [] }
      );
    } catch (error) {
      return null;
    }
  }

  completeDailyLevel() {
    const daily = this.daily;
    const runner = daily && daily.runner;
    const levelIndex = daily && Number(daily.levelIndex);
    if (daily && (!Array.isArray(daily.levels) || !daily.levels.length) && daily.challenge) {
      daily.levels = [daily.challenge];
    }
    if (daily && !daily.dayId) {
      daily.dayId = daily.challengeId || daily.dateKey || null;
    }
    if (!daily || !runner || !Array.isArray(daily.levels) ||
        !daily.levels[levelIndex] || !daily.dateKey || !daily.dayId) return false;
    if (this.runnerOutcome(runner) !== OUTCOME.WON || daily.completionRecorded) return false;

    // Keep result payloads strictly positive even when a deterministic test
    // or a very fast player completes a level in the same millisecond it
    // started. Persistence already applies the same normalization.
    const elapsedMs = Math.max(1, runner.elapsedMs());
    const completion = this.dailyCompletionCall(daily.levels[levelIndex], levelIndex, elapsedMs);
    if (!completion) return false;

    const levelResult = Object.assign({}, completion, {
      completed: true,
      elapsedMs,
      levelId: this.dailyLevelId(daily.levels[levelIndex], levelIndex, daily.resolution),
      levelIndex
    });
    daily.levelResults[levelIndex] = levelResult;
    daily.firstClear = daily.firstClear || !!completion.firstClear;
    if (completion.dayFirstClear !== undefined || completion.rewardEligible !== undefined) {
      daily.dayFirstClear = daily.dayFirstClear ||
        !!(completion.dayFirstClear || completion.rewardEligible);
    } else if (levelIndex >= daily.levels.length - 1) {
      // Early injected stores only reported the per-level firstClear flag;
      // for a one-level/legacy package that is also the day qualification.
      daily.dayFirstClear = daily.dayFirstClear || !!completion.firstClear;
    }
    daily.elapsedBeforeLevel += elapsedMs;

    if (levelIndex < daily.levels.length - 1) {
      const nextIndex = levelIndex + 1;
      const nextLevel = daily.levels[nextIndex];
      const nextRunner = this.createDailyRunner(nextLevel, nextIndex, daily.resolution);
      if (!nextRunner) return false;
      this.clearHintRequest();
      daily.levelIndex = nextIndex;
      daily.challenge = nextLevel;
      daily.challengeId = this.dailyLevelId(nextLevel, nextIndex, daily.resolution);
      daily.runner = nextRunner;
      this.boardInput.setRunner(nextRunner);
      daily.enteredAt = Date.now();
      daily.clearAnimation = null;
      this.hint = null;
      this.hintUntil = 0;
      this.hintPreview = null;
      this.lastClockSecond = -1;
      this.invalidate();
      return true;
    }

    daily.completionRecorded = true;
    const totalElapsedMs = daily.elapsedBeforeLevel;
    daily.result = Object.assign({}, completion, {
      dateKey: daily.dateKey,
      dayId: daily.dayId,
      elapsedMs: totalElapsedMs,
      totalElapsedMs,
      levelResults: daily.levelResults.slice(),
      levelIds: daily.levels.map((level, index) => this.dailyLevelId(level, index, daily.resolution)),
      entriesUsed: daily.entriesUsed,
      entryLimit: daily.entryLimit,
      entriesRemaining: daily.entriesRemaining
    });
    daily.result.dayFirstClear = daily.dayFirstClear;
    daily.result.firstClear = daily.dayFirstClear;
    daily.resultVisibleAt = Date.now() + this.skins.current().animation.resultDelayMs;
    this.scene = 'dailyResult';
    if (this.share) this.share.prepareContext(this.shareContext());

    // This is an event boundary only.  A future currency ledger owns reward
    // idempotency; this callback never creates a balance itself.
    try {
      this.onDailyCompleted({
        dateKey: daily.dateKey,
        dayId: daily.dayId,
        levelIds: daily.levels.map((level, index) => this.dailyLevelId(level, index, daily.resolution)),
        elapsedMs: totalElapsedMs,
        firstClear: !!daily.dayFirstClear
      });
    } catch (error) {
      // Consumer failures must not undo persisted completion or strand the UI.
    }
    this.invalidate();
    return true;
  }

  // Compatibility alias retained for focused callers from the single-level
  // implementation.  The method now follows the two-level state machine.
  completeDailyChallenge() {
    return this.completeDailyLevel();
  }

  requestDailyRevive(source, idempotencyKey) {
    if (this.engagement.canRequestDailyExtraEntry && this.engagement.canRequestDailyExtraEntry()) return this.requestDailyExtraEntry();
    const payload = {
      dateKey: this.daily.dateKey,
      dayId: this.daily.dayId,
      levelIndex: this.daily.levelIndex,
      entriesUsed: this.daily.entriesUsed,
      entriesRemaining: this.daily.entriesRemaining,
      source: source || null,
      idempotencyKey: idempotencyKey || null,
      implemented: false
    };
    let result = { ok: false, implemented: false, reason: 'entry-increase-not-implemented' };
    if (this.dailyProgress && typeof this.dailyProgress.requestEntryIncrease === 'function') {
      try {
        result = this.dailyProgress.requestEntryIncrease(payload) || result;
      } catch (error) {
        result = { ok: false, implemented: false, reason: 'entry-increase-error' };
      }
    }
    try {
      this.onDailyRevive(Object.assign({}, payload, { result }));
    } catch (error) {
      // Extension callbacks are observational in this release.
    }
    this.invalidate();
    return result;
  }

  resetCurrentLevel() {
    if (!this.runner) return false;
    this.clearHintRequest();
    this.runner.reset();
    this.boardInput.setRunner(this.runner);
    this.scene = 'play';
    this.levelEnteredAt = Date.now();
    this.lastClockSecond = -1;
    this.clearAnimation = null;
    this.result = null;
    this.resultVisibleAt = 0;
    this.hint = null;
    this.hintUntil = 0;
    this.hintPreview = null;
    this.pointer = null;
    this.pressedId = null;
    if (this.renderer) this.renderer.clearInteractionHits();
    this.invalidate();
    return true;
  }

  resetCurrentDailyLevel() {
    const daily = this.daily;
    if (!daily || !daily.runner) return false;
    this.clearHintRequest();
    daily.runner.reset();
    this.boardInput.setRunner(daily.runner);
    daily.enteredAt = Date.now();
    daily.result = null;
    daily.resultVisibleAt = 0;
    daily.clearAnimation = null;
    this.scene = 'daily';
    this.lastClockSecond = -1;
    this.hint = null;
    this.hintUntil = 0;
    this.hintPreview = null;
    this.pointer = null;
    this.pressedId = null;
    if (this.renderer) this.renderer.clearInteractionHits();
    this.invalidate();
    return true;
  }

  performAction(action) {
    if (typeof action !== 'string' || !action) return false;
    if (action === 'daily:revive' || action === 'dailyResult:revive') action = 'daily:extraEntry';
    const previewActive = this.isHintPreviewActive();
    if (previewActive && (action === 'play:reset' || action === 'play:undo' ||
        action === 'daily:reset' || action === 'daily:undo')) return false;
    if (previewActive && action !== 'play:hint' && action !== 'daily:hint' &&
        action !== 'play:sound' && action !== 'daily:sound') {
      this.clearHintPreview(false);
    }
    const ordinaryFailure = this.scene === 'result' && this.result &&
      this.result.outcome === OUTCOME.FAILED;
    if (ordinaryFailure && action !== 'failure:retry' && action !== 'result:levels') {
      return false;
    }
    const dailyFailure = this.scene === 'dailyResult' && this.daily.result &&
      this.daily.result.outcome === OUTCOME.FAILED;
    if (dailyFailure && action !== 'dailyFailure:retry' &&
        action !== 'dailyResult:home' && action !== 'dailyResult:back') {
      return false;
    }
    const previousScene = this.scene;
    if (action === 'home:sound' || action === 'play:sound' || action === 'themes:sound' ||
        action === 'daily:sound' || action === 'dailyResult:sound' ||
        action === 'corridor:sound' || action === 'effects:sound') {
      const enabled = this.audio.toggle();
      if (enabled) this.audio.playSfx('click');
      this.invalidate();
      return enabled;
    }
    this.audio.unlock();
    this.audio.playSfx('click');
    if ((action === 'result:share' && this.scene === 'result') ||
        (action === 'dailyResult:share' && this.scene === 'dailyResult')) {
      return this.shareResult();
    } else if (action === 'home:account' && this.scene === 'home') {
      this.openAccount();
    } else if (action === 'account:back' && this.scene === 'account') {
      this.scene = 'home';
    } else if (action === 'account:authorizeProfile' && this.scene === 'account') {
      // The visible native button handles the actual user gesture. A Canvas
      // hit may only mount that button, never synthesize consent.
      this.mountAccountProfile();
    } else if (action === 'account:retrySync' && this.scene === 'account') {
      this.retryAccountSync();
    } else if (action === 'account:privacy' && this.scene === 'account') {
      const generation = this.accountGeneration;
      const task = this.platform.openPrivacyContract ? this.platform.openPrivacyContract() : Promise.resolve({ ok: false });
      Promise.resolve(task).then(result => {
        if (this.scene !== 'account' || generation !== this.accountGeneration) return;
        if (!result.ok) this.accountMessage = '暂时无法打开隐私协议';
        this.invalidate();
      }).catch(function () {});
    } else if (action === 'home:dailyChallenge' || action === 'home:daily') {
      this.enterDaily();
    } else if (action === 'home:start') {
      const target = this.progress.resumeTarget(catalog.sets);
      this.openLevel(target.setIndex, target.levelIndex);
    } else if (action === 'home:levels') {
      const last = this.progress.state.lastPlayed;
      this.levelPageIndex = this.levelPageForTarget(last);
      this.scene = 'levels';
    } else if (action === 'home:themes') {
      this.themePageIndex = 0;
      this.galleryOrigin = 'home';
      this.scene = 'themes';
    } else if (action === 'home:corridor') {
      this.corridorPageIndex = 0;
      this.scene = 'corridor';
      this.galleryOrigin = 'home';
      this.pointer = null;
      this.pressedId = null;
    } else if (action === 'levels:home') {
      this.scene = 'home';
    } else if (action === 'levels:prev') {
      this.changeLevelPage(-1);
    } else if (action === 'levels:next') {
      this.changeLevelPage(1);
    } else if (action === 'themes:home') {
      this.scene = 'home';
      this.galleryOrigin = 'home';
      this.pressedId = null;
    } else if (action === 'themes:corridor') {
      // Only the corridor-origin gallery emits this action. Keep a defensive
      // fallback for stale callers that still send it from a home-origin page.
      if (this.galleryOrigin === 'corridor') {
        this.scene = 'corridor';
      } else {
        this.scene = 'home';
      }
      this.pointer = null;
      this.pressedId = null;
    } else if (action === 'themes:prev') {
      this.changeThemePage(-1);
    } else if (action === 'themes:next') {
      this.changeThemePage(1);
    } else if (action.indexOf('theme:') === 0) {
      // Theme selection intentionally leaves the gallery open.  setSkin is
      // the single persistence/loading entry point; failed IDs are ignored.
      this.setSkin(action.slice('theme:'.length));
    } else if (action === 'corridor:home') {
      this.scene = 'home';
      this.galleryOrigin = 'home';
      this.pointer = null;
      this.pressedId = null;
    } else if (action === 'corridor:themes') {
      this.galleryOrigin = 'corridor';
      this.scene = 'themes';
      this.pointer = null;
      this.pressedId = null;
    } else if (action === 'corridor:effects') {
      this.galleryOrigin = 'corridor';
      this.scene = 'effects';
      this.pointer = null;
      this.pressedId = null;
    } else if (action === 'corridor:prev') {
      this.changeCorridorPage(-1);
    } else if (action === 'corridor:next') {
      this.changeCorridorPage(1);
    } else if (action === 'effects:corridor') {
      this.galleryOrigin = 'corridor';
      this.scene = 'corridor';
      this.pointer = null;
      this.pressedId = null;
    } else if (action === 'effects:home') {
      this.scene = 'home';
      this.galleryOrigin = 'home';
      this.pointer = null;
      this.pressedId = null;
    } else if (action === 'effects:prev') {
      this.changeEffectPage(-1);
    } else if (action === 'effects:next') {
      this.changeEffectPage(1);
    } else if (action.indexOf('effect:') === 0) {
      // Effect selection intentionally keeps the gallery open and leaves all
      // board/daily state untouched.
      this.setClearEffect(action.slice('effect:'.length));
    } else if (action.indexOf('level:') === 0) {
      const parts = action.split(':');
      if (parts.length === 3) {
        const actionSetIndex = Number(parts[1]);
        const actionLevelIndex = Number(parts[2]);
        if (parts[1] && parts[2] && Number.isInteger(actionSetIndex) &&
            Number.isInteger(actionLevelIndex)) {
          this.openLevel(actionSetIndex, actionLevelIndex);
        }
      } else if (parts.length === 2) {
        // Compatibility for callers that still emit the old current-set
        // action shape. New flattened cards always carry both coordinates.
        const actionLevelIndex = Number(parts[1]);
        if (parts[1] && Number.isInteger(actionLevelIndex)) {
          this.openLevel(this.setIndex, actionLevelIndex);
        }
      }
    } else if (action === 'daily:home' || action === 'daily:back') {
      this.scene = 'home';
      this.boardInput.setRunner(null);
      this.hint = null;
      this.hintUntil = 0;
      this.hintPreview = null;
      this.pointer = null;
    } else if (action === 'daily:reset') {
      if (this.daily.runner && this.scene === 'daily') {
        this.resetCurrentDailyLevel();
      }
    } else if (action === 'daily:undo') {
      if (this.daily.runner && this.scene === 'daily') {
        if (this.daily.runner.undo()) this.daily.clearAnimation = null;
        this.hint = null;
        this.hintUntil = 0;
        this.hintPreview = null;
      }
    } else if (action === 'daily:hint') {
      this.requestHint();
    } else if (action === 'daily:extraEntry') {
      return this.requestDailyExtraEntry();
    } else if (action === 'dailyResult:home' || action === 'dailyResult:back') {
      this.scene = 'home';
      this.boardInput.setRunner(null);
      this.pointer = null;
      this.hint = null;
      this.hintUntil = 0;
      this.hintPreview = null;
    } else if (action === 'dailyResult:replay') {
      this.replayDaily();
    } else if (action === 'dailyFailure:retry') {
      if (this.scene === 'dailyResult' && this.daily.result &&
          this.daily.result.outcome === OUTCOME.FAILED) {
        this.resetCurrentDailyLevel();
      }
    } else if (action === 'play:back' || action === 'result:levels') {
      this.scene = 'levels';
      this.runner = null;
      this.runContext = null;
      this.boardInput.setRunner(null);
    } else if (action === 'play:reset') {
      if (!this.runner) return;
      this.resetCurrentLevel();
    } else if (action === 'play:undo') {
      if (this.runner && this.runner.undo()) this.clearAnimation = null;
      this.hint = null;
      this.hintUntil = 0;
      this.hintPreview = null;
    } else if (action === 'play:hint') {
      this.requestHint();
    } else if (action === 'result:replay') {
      if (this.runContext) {
        this.openLevel(this.runContext.setIndex, this.runContext.levelIndex);
      }
    } else if (action === 'failure:retry') {
      if (this.scene === 'result' && this.result && this.result.outcome === OUTCOME.FAILED) {
        this.resetCurrentLevel();
      }
    } else if (action === 'result:next') {
      if (this.runContext) {
        const target = this.progression.nextLevel(
          this.runContext.setIndex,
          this.runContext.levelIndex
        );
        if (target && this.progression.isUnlocked(target.setIndex, target.levelIndex)) {
          this.openLevel(target.setIndex, target.levelIndex);
        } else {
          this.scene = 'levels';
          this.runner = null;
          this.runContext = null;
          this.boardInput.setRunner(null);
        }
      }
    }
    if (previousScene === 'effects' && this.scene !== 'effects' &&
        this.renderer && typeof this.renderer.invalidateEffectPreviews === 'function') {
      this.renderer.invalidateEffectPreviews();
    }
    if (previousScene === 'account' && this.scene !== 'account') this.leaveAccount();
    if (previousScene !== this.scene) {
      this.clearHintRequest();
      if (this.share) this.share.prepareContext(this.shareContext());
    }
    if ((ordinaryFailure || dailyFailure) && this.renderer) this.renderer.clearInteractionHits();
    this.invalidate();
  }

  openAccount() {
    this.clearHintPreview(false);
    this.scene = 'account';
    this.accountGeneration++;
    this.accountMessage = '';
    this.pointer = null;
    this.pressedId = null;
    this.boardInput.setRunner(null);
    this.mountAccountProfile();
    if (this.profile) {
      const generation = this.accountGeneration;
      this.profile.refresh().then(() => {
        if (this.scene === 'account' && generation === this.accountGeneration) this.invalidate();
      });
    }
    this.invalidate();
  }

  shareContext() {
    if (this.scene === 'result' && this.result && this.result.outcome !== OUTCOME.FAILED) {
      return { scene: 'ordinary_result', levelKey: `${this.setIndex}:${this.levelIndex}`,
        elapsedMs: this.result.elapsedMs, completed: true };
    }
    if (this.scene === 'dailyResult' && this.daily.result && this.daily.result.outcome !== OUTCOME.FAILED) {
      return { scene: 'daily_result', dailyDateKey: this.daily.dateKey,
        elapsedMs: this.daily.result.elapsedMs, completed: true };
    }
    return { scene: 'home', completed: false };
  }

  clearHintRequest() {
    this.runSequence++;
    this.hintRequest = null;
    this.hintFeedback = null;
  }

  hintContext() {
    let levelKey = null;
    if (this.scene === 'play' && this.runContext) {
      levelKey = HintAccessService.levelKey({ source: 'catalog',
        setIndex: this.runContext.setIndex, levelIndex: this.runContext.levelIndex });
    } else if (this.scene === 'daily' && this.daily.runner && this.daily.challenge) {
      levelKey = HintAccessService.levelKey({ source: 'daily',
        dayId: this.daily.dayId, challengeId: this.daily.challengeId });
    }
    return levelKey ? { scene: this.scene, levelKey, dateKey: this.hintAccess.dateKey() } : null;
  }

  hintButtonLabel() {
    if (this.hintRequest) return '处理中';
    const context = this.hintContext();
    const state = this.engagement.hintState ? this.engagement.hintState(context) : { mode: 'free' };
    if (state.mode !== 'share') return '提示';
    if (state.unlocked) return '查看提示';
    if (state.pendingSave) return '重试保存';
    if (context && this.hintFeedback && context.dateKey === this.hintFeedback.dateKey &&
        context.levelKey === this.hintFeedback.levelKey) return this.hintFeedback.label;
    return '分享解锁';
  }

  dailyRewardContext() {
    if (this.scene === 'dailyResult' && this.daily.result && this.daily.result.outcome !== OUTCOME.FAILED) {
      return { dateKey: this.daily.dateKey, dayId: this.daily.dayId };
    }
    if (this.scene !== 'home') return null;
    const day = this.resolveDaily();
    return day && day.status === 'available' ? { dateKey: day.dateKey, dayId: day.dayId } : null;
  }

  applyDailyGrant(grant) {
    const session = this.auth && this.auth.current();
    if (!session || !grant || !grant.ok || !grant.granted || grant.userId !== session.userId ||
        !this.dailyProgress || !this.dailyProgress.applyAuthorizedEntryGrant) return { ok: false, reason: 'account-mismatch' };
    const applied = this.dailyProgress.applyAuthorizedEntryGrant({ dateKey: grant.context.dateKey, dayId: grant.context.dayId,
      grantId: grant.grantId, entryLimit: grant.entitlement.entryLimit, grantedAt: Date.now() });
    if (applied.ok && this.daily.dateKey === grant.context.dateKey && this.daily.dayId === grant.context.dayId) {
      const day = this.dailyProgress.getDay(grant.context.dateKey);
      this.daily.entryLimit = day.entryLimit;
      this.daily.entriesUsed = day.entriesUsed;
      this.daily.entriesRemaining = this.dailyDebugUnlimited ? null : day.entriesRemaining;
    }
    return applied;
  }

  requestDailyExtraEntry() {
    if (!this.engagement.canRequestDailyExtraEntry || !this.engagement.canRequestDailyExtraEntry()) return false;
    const context = this.dailyRewardContext();
    if (!context || this.dailyExtraRequest || !this.rewards) return false;
    const token = { scene: this.scene, runKey: this.runSequence, context };
    this.dailyExtraRequest = token;
    this.invalidate();
    this.engagement.requestDailyExtraEntry(context).then(grant => {
      const applied = grant.ok ? this.applyDailyGrant(grant) : grant;
      if (this.dailyExtraRequest !== token || this.scene !== token.scene || this.runSequence !== token.runKey) return;
      this.dailyRewardMessage = { dateKey: context.dateKey, text: applied.ok ? '已获得一次额外进入机会'
        : applied.reason === 'closed' ? '未完整观看，未增加次数'
          : applied.reason === 'DAILY_REWARD_LIMIT_REACHED' ? '今日额外次数已领取'
            : '暂未增加次数，请稍后重试' };
    }).catch(function () {}).finally(() => {
      if (this.dailyExtraRequest === token) this.dailyExtraRequest = null;
      if (!this.disposed) this.invalidate();
    });
    return true;
  }

  recoverDailyRewards() {
    if (!this.rewards) return Promise.resolve();
    const resolved = this.resolveDaily();
    if (!resolved || resolved.status !== 'available') return Promise.resolve();
    return this.rewards.recover({ dateKey: resolved.dateKey, dayId: resolved.dayId }).then(result => {
      if (this.disposed) return;
      (result.grants || []).forEach(grant => this.applyDailyGrant(grant));
      this.invalidate();
    }).catch(function () {});
  }

  requestHint() {
    const runner = this.activeRunner();
    if (!runner || this.runnerTerminal(runner) || !['play', 'daily'].includes(this.scene)) return false;
    if (this.isHintPreviewActive()) return this.scene === 'daily' ? this.showDailyHint() : this.showHint();
    if (this.hintRequest || this.boardInput.isActive()) return false;
    const context = this.hintContext();
    // Validate the existing complete solution before asking for any unlock
    // action. The temporary view is never installed or used to mutate play.
    const hint = this.resolveCompleteHint(runner);
    if (!hint || !this.createHintPreview(runner, hint, 0)) {
      this.hintFeedback = Object.assign({}, context, { label: '暂无提示' });
      this.audio.playSfx('error');
      this.invalidate();
      return false;
    }
    const token = { scene: this.scene, runKey: this.runSequence, runner, context };
    this.hintRequest = token;
    this.hintFeedback = null;
    const apply = result => {
      if (this.hintRequest !== token) return false;
      this.hintRequest = null;
      this.invalidate();
      if (this.disposed || this.scene !== token.scene || this.runSequence !== token.runKey || this.activeRunner() !== runner || this.runnerTerminal(runner)) return false;
      if (result && result.mode === 'share') {
        if (!context || context.dateKey !== this.hintAccess.dateKey()) return false;
        if (!result.granted && !result.unlocked) {
          const label = result.reason === 'persist-failed' ? '重试保存'
            : ['not-supported', 'not-configured'].includes(result.reason) ? '分享不可用' : '重试分享';
          this.hintFeedback = Object.assign({}, context, { label });
        }
      }
      return result && result.granted === true && (this.scene === 'daily' ? this.showDailyHint() : this.showHint());
    };
    let result;
    try { result = this.engagement.requestHint(Object.assign({ scene: this.scene }, context)); } catch (error) { return apply({ granted: false }); }
    if (!result || typeof result.then !== 'function') return apply(result);
    result.then(apply).catch(() => apply({ granted: false }));
    this.invalidate();
    return true;
  }

  shareResult() {
    const context = this.shareContext();
    if (this.pendingShare || !context.completed || !this.share || !this.share.isResultEnabled()) return false;
    const token = { scene: this.scene, result: this.scene === 'result' ? this.result : this.daily.result };
    this.pendingShare = token;
    this.invalidate();
    this.engagement.shareResult(context).catch(() => ({ initiated: false })).finally(() => {
      if (this.pendingShare !== token) return;
      this.pendingShare = null;
      if (this.scene === token.scene && token.result === (this.scene === 'result' ? this.result : this.daily.result)) this.invalidate();
    });
    return true;
  }

  mountAccountProfile() {
    if (this.scene !== 'account' || this.hidden || this.disposed || !this.profile) return false;
    const generation = this.accountGeneration;
    const current = () => this.scene === 'account' && !this.hidden && !this.disposed && generation === this.accountGeneration;
    const skin = this.skins.current();
    const result = this.profile.mount({
      rect: accountLayout(this.platform.metrics).profileButton,
      style: { color: skin.colors.text, backgroundColor: skin.colors.levelCell },
      onPending: pending => { if (current()) { this.accountProfilePending = pending; this.invalidate(); } },
      onSuccess: () => { if (current()) { this.accountMessage = '头像昵称已保存'; this.invalidate(); } },
      onDenied: result => {
        if (!current()) return;
        this.accountMessage = result.reason === 'denied' ? '未授权，仍可继续游玩' : '资料暂未保存，请稍后重试';
        this.invalidate();
      }
    });
    this.accountProfilePending = !!this.profile.pending;
    return result.ok;
  }

  leaveAccount() {
    this.accountGeneration++;
    this.accountSyncPending = null;
    this.accountProfilePending = false;
    if (this.profile) this.profile.unmount();
  }

  retryAccountSync() {
    if (this.accountSyncPending || this.scene !== 'account') return false;
    const token = { generation: this.accountGeneration };
    this.accountSyncPending = token;
    this.invalidate();
    this.resumeOnline().then(result => {
      if (this.accountSyncPending !== token || this.scene !== 'account' || this.hidden) return;
      this.accountSyncPending = null;
      this.accountMessage = result.ok ? '同步完成' : result.reason === 'account-mismatch'
        ? '当前账号与本地存档绑定的账号不同' : '当前使用本地存档，可稍后重试';
      this.invalidate();
    });
    return true;
  }

  changeLevelPage(delta) {
    const pageCount = Math.max(1, Math.ceil(catalog.levels.length / LEVEL_PAGE_SIZE));
    const currentPage = Number(this.levelPageIndex);
    const normalizedPage = Number.isFinite(currentPage) ? currentPage : 0;
    const step = Number(delta);
    this.levelPageIndex = clamp(
      normalizedPage + (Number.isFinite(step) ? step : 0),
      0,
      pageCount - 1
    );
    this.invalidate();
  }

  themeDescriptors() {
    if (!this.skins || typeof this.skins.list !== 'function') return [];
    const themes = this.skins.list();
    return Array.isArray(themes) ? themes.map(theme => {
      const name = this.subpackages && this.subpackages.packageForTheme(theme.id);
      const state = name ? this.subpackages.getPackageState(name) : { status: 'loaded', progress: 100 };
      return Object.assign({}, theme, {
        assetState: state.status,
        assetProgress: state.progress,
        pending: theme.id === this.pendingSkinId
      });
    }) : [];
  }

  themePageCount(themes) {
    const list = themes || this.themeDescriptors();
    return Math.max(1, Math.ceil(list.length / THEME_PAGE_SIZE));
  }

  corridorDescriptors() {
    // Keep this list data-only and deterministic. Future entries can be
    // appended without changing the existing IDs/slot mapping.
    const configured = Array.isArray(this.corridorEntries) ? this.corridorEntries : null;
    const defaults = [
      { id: 'themes', name: '主题', action: 'corridor:themes' },
      { id: 'effects', name: '特效', action: 'corridor:effects' }
    ];
    const source = configured || defaults;
    return source.reduce((result, item) => {
      if (!item || typeof item.id !== 'string' || !item.id ||
          typeof item.action !== 'string' || !item.action) return result;
      const id = item.id;
      const action = item.action;
      try {
        if (/[\u0000-\u001f\u007f]/.test(id) || /[\u0000-\u001f\u007f]/.test(action)) return result;
      } catch (error) {
        return result;
      }
      if (!id || !action || id === '__proto__' || id === 'constructor' || id === 'prototype') return result;
      result.push({
        id,
        name: typeof item.name === 'string' && item.name ? item.name : id,
        action
      });
      return result;
    }, []);
  }

  corridorPageCount(entries) {
    const list = Array.isArray(entries) ? entries : this.corridorDescriptors();
    return Math.max(1, Math.ceil(list.length / CORRIDOR_PAGE_SIZE));
  }

  changeCorridorPage(delta) {
    const pageCount = this.corridorPageCount();
    const currentPage = Number(this.corridorPageIndex);
    const normalizedPage = Number.isFinite(currentPage) ? currentPage : 0;
    const step = Number(delta);
    this.corridorPageIndex = clamp(
      normalizedPage + (Number.isFinite(step) ? step : 0),
      0,
      pageCount - 1
    );
    this.invalidate();
  }

  effectDescriptors() {
    if (!this.clearEffects || typeof this.clearEffects.list !== 'function') return [];
    let list;
    try {
      list = this.clearEffects.list();
    } catch (error) {
      list = [];
    }
    if (!Array.isArray(list)) return [];
    // The service already returns sanitized descriptors. Re-project here as
    // an additional app boundary so arbitrary injected services cannot leak
    // functions, platform handles, or mutable nested params into the model.
    return list.reduce((result, item) => {
      if (!item || typeof item.id !== 'string' || !item.id) return result;
      const id = item.id;
      if (!id || id === '__proto__' || id === 'constructor' || id === 'prototype') return result;
      const descriptor = { id, name: typeof item.name === 'string' && item.name ? item.name : id };
      if (typeof item.type === 'string' && item.type) descriptor.type = item.type;
      if (typeof item.preview === 'string' && item.preview) descriptor.preview = item.preview;
      if (typeof item.category === 'string' && item.category) descriptor.category = item.category;
      result.push(descriptor);
      return result;
    }, []);
  }

  effectPageCount(effects) {
    const list = Array.isArray(effects) ? effects : this.effectDescriptors();
    return Math.max(1, Math.ceil(list.length / EFFECT_PAGE_SIZE));
  }

  changeEffectPage(delta) {
    const pageCount = this.effectPageCount();
    const currentPage = Number(this.effectPageIndex);
    const normalizedPage = Number.isFinite(currentPage) ? currentPage : 0;
    const step = Number(delta);
    this.effectPageIndex = clamp(
      normalizedPage + (Number.isFinite(step) ? step : 0),
      0,
      pageCount - 1
    );
    this.invalidate();
  }

  currentEffectId() {
    try {
      if (this.clearEffects && typeof this.clearEffects.currentIdValue === 'function') {
        const id = this.clearEffects.currentIdValue();
        if (typeof id === 'string' && id) return id;
      }
      const current = this.clearEffects && typeof this.clearEffects.current === 'function'
        ? this.clearEffects.current()
        : null;
      return current && current.id ? String(current.id) : 'fade';
    } catch (error) {
      return 'fade';
    }
  }

  resolveClearEffect(effectId) {
    let effect = null;
    try {
      if (this.clearEffects && typeof this.clearEffects.resolve === 'function') {
        effect = this.clearEffects.resolve(effectId);
      } else if (this.clearEffects && typeof this.clearEffects.current === 'function') {
        effect = this.clearEffects.current();
      }
    } catch (error) {
      effect = null;
    }
    if (!plainObject(effect)) effect = DEFAULT_FADE_EFFECT;
    const result = cloneData(effect);
    if (!result.id) result.id = 'fade';
    if (!result.type) result.type = 'fade';
    return result;
  }

  effectDuration(effect, fallback) {
    const raw = (typeof effect === 'number' || typeof effect === 'string')
      ? Number(effect)
      : effect && Number(effect.durationMs);
    if (Number.isFinite(raw) && raw > 0) {
      return clamp(raw, EFFECT_MIN_DURATION_MS, EFFECT_MAX_DURATION_MS);
    }
    const backup = Number(fallback);
    return Number.isFinite(backup) && backup > 0
      ? clamp(backup, EFFECT_MIN_DURATION_MS, EFFECT_MAX_DURATION_MS)
      : 300;
  }

  setClearEffect(effectId) {
    if (!this.clearEffects || typeof this.clearEffects.select !== 'function') return false;
    let selected = false;
    try {
      selected = this.clearEffects.select(effectId) === true;
    } catch (error) {
      selected = false;
    }
    if (selected) this.invalidate();
    return selected;
  }

  changeThemePage(delta) {
    const pageCount = this.themePageCount();
    const currentPage = Number(this.themePageIndex);
    const normalizedPage = Number.isFinite(currentPage) ? currentPage : 0;
    const step = Number(delta);
    this.themePageIndex = clamp(
      normalizedPage + (Number.isFinite(step) ? step : 0),
      0,
      pageCount - 1
    );
    this.invalidate();
  }

  setSkin(skinId) {
    if (typeof skinId !== 'string' || !this.skins.get(skinId)) return false;
    const requestId = ++this.skinLoadRequestId;
    const name = this.subpackages && this.subpackages.packageForTheme(skinId);
    if (name && !this.subpackages.isPackageReady(name)) {
      this.loadSkinPackage(skinId, requestId, true);
      return true;
    }
    this.pendingSkinId = null;
    this.skins.select(skinId);
    this.renderer.invalidateThemeAssets(skinId);
    this.renderer.loadSkinAssets();
    this.invalidate();
    return true;
  }

  prepareCurrentSkinAssets() {
    if (!this.subpackages || this.pendingSkinId) return;
    const skinId = this.skins.current().id;
    const name = this.subpackages.packageForTheme(skinId);
    if (name && !this.subpackages.isPackageReady(name)) {
      // Keep the saved theme's palette for the first frame, without rewriting
      // its setting or waiting for a download before starting gameplay.
      this.loadSkinPackage(skinId, ++this.skinLoadRequestId, false);
    }
  }

  loadSkinPackage(skinId, requestId, selectOnSuccess) {
    this.pendingSkinId = skinId;
    this.invalidate();
    this.subpackages.ensureTheme(skinId, () => this.invalidate()).then(() => {
      if (requestId !== this.skinLoadRequestId) {
        this.invalidate();
        return;
      }
      this.pendingSkinId = null;
      if (selectOnSuccess) this.skins.select(skinId);
      this.renderer.invalidateThemeAssets(skinId);
      this.renderer.loadSkinAssets();
      this.invalidate();
    }).catch(() => {
      // The service exposes a stable failed state. No saved setting changes
      // on failure, and an older download cannot clear the newest pending ID.
      if (requestId === this.skinLoadRequestId) this.pendingSkinId = null;
      this.invalidate();
    });
  }

  enterDaily(now) {
    const resolution = this.resolveDaily(now === undefined ? this.clockNow() : now);
    if (!resolution || resolution.status !== 'available') return false;
    const sourceLevels = this.dailyLevels(resolution);
    // v1.1 is exactly two levels.  Keep a one-level fallback for older
    // injected manifests, but never silently accept an empty or oversized
    // package.
    if (!sourceLevels.length || sourceLevels.length > 2) return false;
    const levels = sourceLevels.map((level, index) =>
      this.prepareDailyLevel(level, index, resolution)
    );
    if (levels.some(level => !level)) return false;
    // The canonical daily package is two levels with fixed geometry. Keep a
    // one-level compatibility escape hatch for older injected hosts, but do
    // not let a malformed two-level response silently become a different
    // mode at runtime.
    if (levels.length === 2) {
      const introLines = Array.isArray(levels[0].Lines) ? levels[0].Lines.length : 0;
      if (Number(levels[0].Width) !== 3 || Number(levels[0].Height) !== 3 ||
          introLines !== 2 || Number(levels[1].Width) !== 8 || Number(levels[1].Height) !== 10) {
        return false;
      }
    }
    const entryState = this.dailyEntryState(resolution);
    if (!entryState.allowed) return false;

    // Build the first runner before consuming the entry.  A malformed level
    // must not burn the day's only attempt.
    const runner = this.createDailyRunner(levels[0], 0, resolution);
    if (!runner) return false;
    const entry = this.dailyRecordEntry(resolution, entryState);
    if (!entry || entry.ok === false) return false;

    const enteredAt = Date.now();
    const dayId = resolution.dayId || resolution.DayId || resolution.challengeId ||
      resolution.dateKey || null;
    const entryUnlimited = this.dailyDebugUnlimited ||
      entry.unlimited === true || entry.debugUnlimited === true;
    const entryUsed = Math.max(0,
      dailyInteger(entry.entriesUsed, entryState.entriesUsed + 1));
    const entryRemainingValue = entry.entriesRemaining === undefined
      ? entry.remainingEntries : entry.entriesRemaining;
    const entryNumbers = {
      entryLimit: Math.max(1, dailyInteger(entry.entryLimit, entryState.entryLimit)),
      entriesUsed: entryUsed,
      entriesRemaining: entryUnlimited ? null : Math.max(0, dailyInteger(
        entryRemainingValue,
        Math.max(0, entryState.entryLimit - entryUsed)
      ))
    };
    this.clearHintRequest();
    this.daily = Object.assign(this.emptyDailyState(), {
      dayId,
      dateKey: resolution.dateKey,
      levels,
      levelIndex: 0,
      challenge: levels[0],
      challengeId: this.dailyLevelId(levels[0], 0, resolution),
      runner,
      enteredAt,
      runStartedAt: enteredAt,
      elapsedBeforeLevel: 0,
      result: null,
      resultVisibleAt: 0,
      clearAnimation: null,
      resolution,
      entryLimit: entryNumbers.entryLimit,
      entriesUsed: entryNumbers.entriesUsed,
      entriesRemaining: entryNumbers.entriesRemaining,
      debugUnlimited: entryUnlimited,
      entryState: entry,
      entryIdempotencyKey: entry.idempotencyKey || null,
      levelResults: [],
      firstClear: false,
      dayFirstClear: false,
      completionRecorded: false
    });
    this.boardInput.setRunner(runner);
    if (this.scene === 'account') this.leaveAccount();
    this.scene = 'daily';
    this.pointer = null;
    this.pressedId = null;
    this.hint = null;
    this.hintUntil = 0;
    this.hintPreview = null;
    this.lastClockSecond = -1;
    this.invalidate();
    return true;
  }

  replayDaily() {
    const daily = this.daily;
    if (!daily || !daily.dateKey || !Array.isArray(daily.levels) || !daily.levels.length) {
      // Older callers may have retained only the single challenge alias.
      if (!daily || !daily.challenge) return false;
      daily.levels = [daily.challenge];
    }
    const resolution = daily.resolution || {
      status: 'available',
      dateKey: daily.dateKey,
      dayId: daily.dayId,
      challengeId: daily.dayId,
      levels: daily.levels,
      challenge: daily.levels[0],
      entryLimit: daily.entryLimit
    };
    // Replays are new runs and therefore consume a new entry.  Re-resolve
    // only to verify the current date/package; the active snapshot itself
    // remains date-locked until this action succeeds.
    const current = this.resolveDaily(this.clockNow());
    if (!current || current.status !== 'available' || current.dateKey !== daily.dateKey) return false;
    const entryState = this.dailyEntryState(current);
    if (!entryState.allowed) return false;
    const freshLevels = this.dailyLevels(current).map((level, index) =>
      this.prepareDailyLevel(level, index, current)
    );
    if (!freshLevels.length || freshLevels.some(level => !level)) return false;
    if (freshLevels.length === 2) {
      const introLines = Array.isArray(freshLevels[0].Lines) ? freshLevels[0].Lines.length : 0;
      if (Number(freshLevels[0].Width) !== 3 || Number(freshLevels[0].Height) !== 3 ||
          introLines !== 2 || Number(freshLevels[1].Width) !== 8 || Number(freshLevels[1].Height) !== 10) {
        return false;
      }
    }
    const runner = this.createDailyRunner(freshLevels[0], 0, current);
    if (!runner) return false;
    const entry = this.dailyRecordEntry(current, entryState);
    if (!entry || entry.ok === false) return false;
    this.clearHintRequest();
    daily.levels = freshLevels;
    daily.resolution = current;
    daily.dayId = current.dayId || current.DayId || current.challengeId || daily.dayId;
    daily.levelIndex = 0;
    daily.challenge = daily.levels[0];
    daily.challengeId = this.dailyLevelId(daily.challenge, 0, current);
    daily.runner = runner;
    this.boardInput.setRunner(runner);
    daily.enteredAt = Date.now();
    daily.runStartedAt = daily.enteredAt;
    daily.elapsedBeforeLevel = 0;
    daily.result = null;
    daily.resultVisibleAt = 0;
    daily.clearAnimation = null;
    daily.levelResults = [];
    daily.firstClear = false;
    daily.dayFirstClear = false;
    daily.completionRecorded = false;
    daily.entryLimit = Math.max(1, dailyInteger(entry.entryLimit, entryState.entryLimit));
    daily.entriesUsed = Math.max(0, dailyInteger(entry.entriesUsed, entryState.entriesUsed + 1));
    const replayUnlimited = this.dailyDebugUnlimited ||
      entry.unlimited === true || entry.debugUnlimited === true;
    daily.entriesRemaining = replayUnlimited ? null : Math.max(0, dailyInteger(
      entry.entriesRemaining === undefined ? entry.remainingEntries : entry.entriesRemaining,
      Math.max(0, daily.entryLimit - daily.entriesUsed)
    ));
    daily.debugUnlimited = replayUnlimited;
    daily.entryState = entry;
    this.scene = 'daily';
    this.pointer = null;
    this.pressedId = null;
    this.hint = null;
    this.hintUntil = 0;
    this.hintPreview = null;
    this.lastClockSecond = -1;
    this.invalidate();
    return true;
  }

  openLevel(setIndex, levelIndex) {
    const context = createCatalogRunContext(catalog, setIndex, levelIndex);
    if (!context) return false;
    if (!this.progression.isUnlocked(setIndex, levelIndex)) return false;
    this.clearHintRequest();
    if (this.scene === 'account') this.leaveAccount();
    this.runContext = context;
    this.setIndex = context.setIndex;
    this.levelIndex = context.levelIndex;
    this.levelPageIndex = this.levelPageForTarget(context);
    this.progress.markOpened(context.setIndex, context.levelIndex);
    this.progress.save();
    this.runner = new GameRunner(
      context.level,
      context.set.Palette || [],
      () => this.invalidate()
    );
    this.boardInput.setRunner(this.runner);
    this.scene = 'play';
    this.levelEnteredAt = Date.now();
    this.lastClockSecond = -1;
    this.clearAnimation = null;
    this.hint = null;
    this.hintUntil = 0;
    this.hintPreview = null;
    this.result = null;
    this.resultVisibleAt = 0;
    this.invalidate();
    return true;
  }

  isHintPreviewActive(now) {
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return !!(this.hintPreview && timestamp < this.hintPreview.until);
  }

  clearHintPreview(shouldInvalidate) {
    const existed = !!this.hintPreview || !!this.hint || this.hintUntil > 0;
    this.hintPreview = null;
    this.hint = null;
    this.hintUntil = 0;
    if (existed && shouldInvalidate !== false) this.invalidate();
    return existed;
  }

  createHintPreview(runner, hint, until) {
    if (!hint || !Array.isArray(hint.paths) || !hint.paths.length) return null;
    const viewModel = this.buildBoardViewModel(runner, null);
    if (!viewModel || !viewModel.board) return null;
    const lines = Array.isArray(viewModel.board.lines) ? viewModel.board.lines : [];
    if (hint.paths.length !== lines.length) return null;

    viewModel.board.cells = viewModel.board.cells.map(cell => Object.assign({}, cell, {
      owner: -1,
      selected: false
    }));
    viewModel.board.completedPaths = new Array(lines.length).fill(null);
    viewModel.board.selection = {
      lineIndex: -1,
      cells: [],
      segments: [],
      teleports: []
    };
    viewModel.board.clearAnimation = null;
    viewModel.board.hint = cloneData(hint);
    viewModel.board.hintUntil = until;
    viewModel.canUndo = false;
    viewModel.terminal = false;

    const portal = viewModel.mechanic && viewModel.mechanic.portal;
    if (portal) {
      portal.phase = 'READY';
      portal.expectedExits = [];
      portal.expectedExit = null;
      portal.lockedEntry = null;
      portal.instruction = portalInstructions.INITIAL;
    }
    return { until, viewModel };
  }

  resolveCompleteHint(runner) {
    if (!runner || !this.hints) return null;
    try {
      if (this.scene === 'daily') {
        return typeof this.hints.findDailyComplete === 'function'
          ? this.hints.findDailyComplete(runner, this.daily.challengeId, this.dailySolutions) : null;
      }
      const context = this.runContext;
      return typeof this.hints.findComplete === 'function'
        ? this.hints.findComplete(runner, context ? context.setIndex : null, context ? context.levelIndex : this.levelIndex) : null;
    } catch (error) { return null; }
  }

  showHint() {
    if (this.scene !== 'play' || !this.runner || this.runnerTerminal(this.runner) ||
        this.boardInput.isActive()) return false;
    if (this.isHintPreviewActive()) {
      this.clearHintPreview();
      return true;
    }
    const hint = this.resolveCompleteHint(this.runner);
    if (!hint) {
      this.clearHintPreview(false);
      this.audio.playSfx('error');
      this.invalidate();
      return false;
    }
    const until = Date.now() + HINT_PREVIEW_DURATION_MS;
    const preview = this.createHintPreview(
      this.runner,
      hint,
      until
    );
    if (!preview) {
      this.clearHintPreview(false);
      this.audio.playSfx('error');
      this.invalidate();
      return false;
    }
    this.hint = hint;
    this.hintUntil = until;
    this.hintPreview = preview;
    this.audio.playSfx('complete');
    this.invalidate();
    return true;
  }

  showDailyHint() {
    if (this.scene !== 'daily' || !this.daily.runner || this.runnerTerminal(this.daily.runner) ||
        this.boardInput.isActive()) return false;
    if (this.isHintPreviewActive()) {
      this.clearHintPreview();
      return true;
    }
    const runner = this.daily.runner;
    const hint = this.resolveCompleteHint(runner);
    if (!hint) {
      this.clearHintPreview(false);
      this.audio.playSfx('error');
      this.invalidate();
      return false;
    }
    const until = Date.now() + HINT_PREVIEW_DURATION_MS;
    const preview = this.createHintPreview(
      runner,
      hint,
      until
    );
    if (!preview) {
      this.clearHintPreview(false);
      this.audio.playSfx('error');
      this.invalidate();
      return false;
    }
    this.hint = hint;
    this.hintUntil = until;
    this.hintPreview = preview;
    this.audio.playSfx('complete');
    this.invalidate();
    return true;
  }

  dailyStoredHint(challengeId) {
    const catalog = this.dailySolutions;
    if (!catalog || !challengeId) return null;
    const byId = catalog.ByChallengeId || catalog.byChallengeId || catalog;
    const paths = byId && byId[challengeId];
    if (!Array.isArray(paths) || !this.daily.runner) return null;
    return typeof this.hints.pickStoredPath === 'function'
      ? this.hints.pickStoredPath(paths, this.daily.runner)
      : null;
  }

  onHide() {
    if (this.disposed) return;
    this.hidden = true;
    if (this.scene === 'account') this.leaveAccount();
    this.pointer = null;
    this.pressedId = null;
    const runner = this.activeRunner();
    if (runner) {
      if (this.boardInput.isActive() && this.boardInput.runner === runner) {
        this.boardInput.cancel(null, 'navigation');
      } else {
        runner.cancelGesture('navigation');
      }
      runner.pause();
    }
    if (this.renderer && typeof this.renderer.invalidateEffectPreviews === 'function') {
      this.renderer.invalidateEffectPreviews();
    }
    this.audio.pauseAll();
    this.progress.save();
    if (this.progressSync) this.progressSync.flush().catch(function () {});
    if (this.behavior) this.behavior.flush('hide').catch(function () {});
  }

  resumeOnline() {
    if (!this.auth) return Promise.resolve({ ok: false, reason: 'not-configured' });
    return this.auth.ensureSession().then(result => {
      if (!result.ok) return result;
      const sync = this.progressSync ? this.progressSync.bootstrap(this.auth.current()) : Promise.resolve(result);
      return sync.then(synced => {
        if (!this.share) return synced;
        this.share.prepareContext(this.shareContext());
        return this.share.consumePendingAttribution(this.auth.current()).then(() => synced);
      });
    }).then(result => this.recoverDailyRewards().then(() => { this.invalidate(); return result; })).catch(() => ({ ok: false, reason: 'network' }));
  }

  onShow(options) {
    if (this.disposed) return;
    this.hidden = false;
    if (this.share) this.share.captureEntry(options || (this.platform.getEnterOptions ? this.platform.getEnterOptions() : {}));
    const runner = this.activeRunner();
    if (runner) runner.resume();
    this.audio.resumeAll();
    this.renderer.ctx = this.platform.context;
    this.invalidate();
    this.startLoop();
    if (this.scene === 'account') this.mountAccountProfile();
    this.resumeOnline();
    if (this.behavior) this.behavior.flush('show').catch(function () {});
  }

  dispose() {
    this.disposed = true;
    this.clearHintRequest();
    this.ads.dispose();
    this.leaveAccount();
    if (this.profile) this.profile.dispose();
    if (this.share) this.share.uninstall();
    if (this.unbindPointer) this.unbindPointer();
    this.platform.stopLoop();
    this.audio.pauseAll();
  }
}

ClearedApp.DEFAULT_DAILY_ENTRY_LIMIT = DEFAULT_DAILY_ENTRY_LIMIT;
ClearedApp.THEME_PAGE_SIZE = THEME_PAGE_SIZE;
ClearedApp.CORRIDOR_PAGE_SIZE = CORRIDOR_PAGE_SIZE;
ClearedApp.EFFECT_PAGE_SIZE = EFFECT_PAGE_SIZE;

module.exports = ClearedApp;
