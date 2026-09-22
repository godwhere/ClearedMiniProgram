const catalog = require('../data/catalog-v2.js');
const GameRunner = require('../core/game-runner.js');
const ProgressStore = require('./services/progress-store.js');
const StaminaService = require('./services/stamina-service.js');
const staminaConfig = require('./config/stamina.js');
const SkinService = require('./services/skin-service.js');
const AdsService = require('./services/ads-service.js');
const EngagementService = require('./services/engagement-service.js');
const ProgressionService = require('./services/progression-service.js');
const AudioService = require('./services/audio-service.js');
const HintService = require('./services/hint-service.js');
const HintAccessService = require('./services/hint-access-service.js');
const RewardUnlockService = require('./services/reward-unlock-service.js');
const rewardConfig = require('./config/rewards.js');
const adConfig = require('./config/ads.js');
const progressionConfig = require('./config/progression.js');
const audioConfig = require('./config/audio.js');
const CanvasRenderer = require('./ui/canvas-renderer.js');
const portalInstructions = require('./ui/portal-instructions.js');
const accountLayout = require('./ui/account-layout.js');
const defaultSkins = require('./skins/index.js');
const defaultMechanics = require('./mechanics/index.js');
const defaultPortalMechanic = defaultMechanics.get('portal');
const { createCatalogRunContext, createTrialRunContext } = require('./gameplay/run-context.js');
const iceTrial = require('../data/ice-trial.js');
const completionPolicies = require('./gameplay/completion-policies.js');
const BoardInputController = require('./gameplay/board-input-controller.js');
const dailyProgressAdapter = require('./services/daily-progress-adapter.js');
const buildDailyViewModel = require('./ui/view-models/daily-view-model.js');
const i18n = require('./i18n/index.js');
const ProductPolicy = require('./runtime/product-policy.js');

function compatibilityLocale() {
  let locale = 'zh-CN';
  const shift = offset => {
    const index = i18n.SUPPORTED_LOCALES.indexOf(locale);
    const length = i18n.SUPPORTED_LOCALES.length;
    locale = i18n.SUPPORTED_LOCALES[((index + offset) % length + length) % length];
    return { ok: true, persisted: false, locale };
  };
  return {
    current() { return locale; },
    t(key, params) { return i18n.translate(locale, key, params); },
    displayName(value) { return i18n.localeDisplayName(value === undefined ? locale : value); },
    previous() { return shift(-1); },
    next() { return shift(1); }
  };
}

// Daily challenge files are introduced independently from the ordinary
// level/catalog pipeline.  Keep direct app construction (including older
// hosts and focused renderer tests) safe while those optional modules are
// absent or while a host injects its own implementation.
const OPTIONAL_MODULE_LOADERS = Object.freeze({
  './services/clear-effect-service.js': () => require('./services/clear-effect-service.js'),
  './services/daily-challenge-service.js': () => require('./services/daily-challenge-service.js'),
  './services/daily-progress-store.js': () => require('./services/daily-progress-store.js'),
  '../data/daily-challenges.js': () => require('../data/daily-challenges.js'),
  '../data/daily-solutions.js': () => require('../data/daily-solutions.js'),
  '../data/portal-solutions.js': () => require('../data/portal-solutions.js')
});

function optionalRequire(path, fallback) {
  const load = OPTIONAL_MODULE_LOADERS[path];
  if (!load) return fallback;
  try {
    return load();
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

function shanghaiNoon(dateKey) {
  const match = typeof dateKey === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const midnight = new Date(Date.UTC(year, month - 1, day));
  if (midnight.getUTCFullYear() !== year || midnight.getUTCMonth() !== month - 1 ||
      midnight.getUTCDate() !== day) return null;
  // 04:00 UTC is 12:00 in Asia/Shanghai and stays clear of either midnight.
  return new Date(Date.UTC(year, month - 1, day, 4));
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

function fallbackClearEffects(progress, canUse) {
  const allowed = typeof canUse === 'function' ? canUse : (kind, id) => kind === 'effect' && id === 'none';
  let currentId = 'none';
  try {
    const saved = progress && typeof progress.getSetting === 'function'
      ? progress.getSetting('clearEffectId', 'none')
      : 'none';
    if ((saved === 'none' || saved === 'fade') && allowed('effect', saved)) currentId = saved;
  } catch (error) {
    currentId = 'none';
  }
  const manifests = {
    none: DEFAULT_NONE_EFFECT,
    fade: DEFAULT_FADE_EFFECT
  };
  const manifest = id => cloneData(manifests[id] || DEFAULT_NONE_EFFECT);
  return {
    current() { return manifest(currentId); },
    get(id) { return manifests[id] ? manifest(id) : null; },
    list() {
      return ['none', 'fade'].map(id => {
        const effect = manifests[id];
        return { id: effect.id, name: effect.name, type: effect.type, preview: effect.preview };
      });
    },
    resolve(id) { return manifest(manifests[id] ? id : 'none'); },
    currentIdValue() { return currentId; },
    select(id) {
      if (!manifests[id] || !allowed('effect', id)) return false;
      try {
        if (!progress || typeof progress.setSetting !== 'function' || progress.setSetting('clearEffectId', id) !== true) return false;
      } catch (error) { return false; }
      currentId = id;
      return true;
    }
  };
}

class ClearedApp {
  constructor(platform, options) {
    const opts = options || {};
    const configuredAdConfig = opts.adConfig || adConfig;
    this.productPolicy = ProductPolicy.create(opts.productPolicy, {
      hintMode: configuredAdConfig.rules && configuredAdConfig.rules.hintMode
        ? configuredAdConfig.rules.hintMode : 'tiered'
    });
    this.productCapabilities = this.productPolicy.capabilities;
    this.platform = platform;
    this.locale = opts.locale || compatibilityLocale();
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
    this.preferences = opts.preferences || null;
    this.syncStore = opts.syncStore || (this.progressSync && this.progressSync.store) || null;
    this.behavior = opts.behavior || null;
    this.profile = opts.profile || null;
    this.share = (this.productCapabilities.rewardedShareEnabled ||
      this.productCapabilities.resultShareEnabled) && opts.share
      ? opts.share : null;
    this.rewards = this.productCapabilities.dailyEnabled &&
      this.productCapabilities.adsEnabled && opts.rewards
      ? opts.rewards : null;
    this.dailyExtraRequest = null;
    this.dailyRewardMessage = null;
    this.pendingShare = null;
    this.accountGeneration = 0;
    this.accountSceneGeneration = 0;
    this.accountMessage = '';
    this.accountFeedback = null;
    this.accountProfilePending = false;
    this.accountSyncPending = null;
    this.hidden = false;
    this.disposed = false;
    this.progression = new ProgressionService(
      this.progress,
      catalog.sets,
      opts.progressionConfig || progressionConfig,
      {
        levels: catalog.levels,
        isPermanentlyUnlocked: (setIndex, levelIndex) => !!(this.stamina &&
          this.stamina.isPermanentlyUnlocked && this.stamina.isPermanentlyUnlocked(`${setIndex}:${levelIndex}`))
      }
    );
    this.ads = this.productCapabilities.adsEnabled
      ? (Object.prototype.hasOwnProperty.call(opts, 'ads')
        ? (opts.ads || null)
        : new AdsService(platform, configuredAdConfig))
      : null;
    this.hintRequest = null;
    this.hintFeedback = null;
    this.runSequence = 0;
    this.audio = new AudioService(platform, this.progress, opts.audioConfig || audioConfig, {
      subpackages: this.subpackages
    });
    // Daily mode owns a separate service/store pair.  They are deliberately
    // injectable so tests and future remote manifests can control the clock
    // and persistence without leaking daily state into ProgressStore.
    this.dailyClock = typeof opts.clock === 'function' ? opts.clock : () => new Date();
    // This is a develop/trial acceptance aid supplied only by the ignored
    // local config. It changes daily content resolution, never the app clock,
    // completion timestamps, stamina recovery, or the device/system time.
    this.dailyTestDate = shanghaiNoon(opts.dailyTestDateKey);
    this.stamina = opts.stamina || new StaminaService(platform, staminaConfig);
    if (this.syncStore && this.stamina.setAuthorityMode) this.stamina.setAuthorityMode(this.syncStore.authorityMode('stamina'));
    const lastPlayed = this.progress.state.lastPlayed;
    this.stamina.restoreUnlockedLevels(catalog.levels.filter(entry =>
      this.progress.isCompleted(entry.setIndex, entry.levelIndex) ||
      (lastPlayed && lastPlayed.setIndex === entry.setIndex && lastPlayed.levelIndex === entry.levelIndex)
    ).map(entry => `${entry.setIndex}:${entry.levelIndex}`), this.clockNow().getTime());
    this.recoverStaminaRefunds(this.clockNow().getTime());
    this.staminaSnapshot = this.stamina.snapshot(this.clockNow().getTime());
    this.lastStaminaSecond = this.staminaSnapshot.recovering
      ? Math.ceil(this.staminaSnapshot.remainingMs / 1000) : -1;
    this.staminaFeedback = null;
    this.homeStaminaExpanded = false;
    const usingBuiltInDailyManifest = this.productCapabilities.dailyEnabled &&
      opts.dailyManifest === undefined;
    this.dailyManifest = this.productCapabilities.dailyEnabled
      ? (usingBuiltInDailyManifest ? defaultDailyManifest : opts.dailyManifest)
      : null;
    // A custom manifest should be able to rely on the runner's BFS fallback
    // without being rejected merely because its level IDs are absent from the
    // built-in solution table. Hosts can still opt into the built-in table by
    // passing dailySolutions explicitly.
    this.dailySolutions = this.productCapabilities.dailyEnabled
      ? (opts.dailySolutions === undefined
        ? (usingBuiltInDailyManifest ? defaultDailySolutions : null)
        : opts.dailySolutions)
      : null;
    // Debug builds may explicitly bypass the daily entry budget so the two
    // levels can be exercised repeatedly. Production/direct construction keeps
    // the configured finite limit unless this opt-in is present.
    this.dailyDebugUnlimited = opts.dailyDebugUnlimited === true ||
      opts.debugDailyUnlimited === true;
    this.debugDailyUnlimited = this.dailyDebugUnlimited;
    const suppliedDailyService = Object.prototype.hasOwnProperty.call(opts, 'dailyService')
      ? opts.dailyService
      : (Object.prototype.hasOwnProperty.call(opts, 'dailyChallengeService')
        ? opts.dailyChallengeService : undefined);
    this.dailyService = this.productCapabilities.dailyEnabled && suppliedDailyService !== undefined
      ? (suppliedDailyService || null) : null;
    if (this.productCapabilities.dailyEnabled && suppliedDailyService === undefined &&
        DailyChallengeService) {
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
    const suppliedDailyProgress = Object.prototype.hasOwnProperty.call(opts, 'dailyStore')
      ? opts.dailyStore
      : (Object.prototype.hasOwnProperty.call(opts, 'dailyProgressStore')
        ? opts.dailyProgressStore : undefined);
    this.dailyProgress = this.productCapabilities.dailyEnabled && suppliedDailyProgress !== undefined
      ? (suppliedDailyProgress || null) : null;
    if (this.productCapabilities.dailyEnabled && suppliedDailyProgress === undefined &&
        DailyProgressStore) {
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
    this.rewardUnlocks = opts.rewardUnlocks || new RewardUnlockService(platform, rewardConfig);
    if (this.syncStore && this.rewardUnlocks.setAuthorityMode) this.rewardUnlocks.setAuthorityMode(this.syncStore.authorityMode('economy'));
    this.economy = opts.economy || null;
    this.authoritativeApplier = opts.authoritativeApplier || null;
    this.cloudBackup = opts.cloudBackup || null;
    // Reconcile saved facts before restoring a selected appearance. No UI is
    // accessed until the renderer, pointer and scene state have been created.
    this.recoverRewardUnlocks();
    const canUse = (kind, itemId) => this.rewardUnlocks.canUse(kind, itemId);
    this.skins = new SkinService(this.progress,
      opts.skins === undefined ? defaultSkins : opts.skins, canUse);
    this.clearEffects = opts.clearEffects || opts.clearEffectService || null;
    if (!this.clearEffects && ClearEffectService) {
      try { this.clearEffects = new ClearEffectService(this.progress, opts.effects || [], canUse); }
      catch (error) { this.clearEffects = null; }
    }
    if (!this.clearEffects || typeof this.clearEffects.current !== 'function') {
      this.clearEffects = fallbackClearEffects(this.progress, canUse);
    }
    const hintNeedsDailyAccess = ['share', 'tiered'].includes(this.productPolicy.hintMode());
    const suppliedHintAccess = Object.prototype.hasOwnProperty.call(opts, 'hintAccess')
      ? opts.hintAccess : undefined;
    this.hintAccess = hintNeedsDailyAccess
      ? (suppliedHintAccess !== undefined
        ? (suppliedHintAccess || null)
        : new HintAccessService(platform, {
          clock: this.dailyClock,
          timeZone: opts.dailyTimeZone || opts.timeZone ||
            (this.dailyService && this.dailyService.timeZone) || 'Asia/Shanghai'
        }))
      : null;
    const configuredRules = Object.assign({}, configuredAdConfig.rules || {}, {
      hintMode: this.productPolicy.hintMode()
    });
    if (!this.productCapabilities.adsEnabled) {
      configuredRules.hintRewardedEnabled = false;
      configuredRules.rewardUnlockRewardedEnabled = false;
    }
    if (!this.productCapabilities.dailyEnabled || !this.productCapabilities.adsEnabled) {
      configuredRules.dailyExtraEntryEnabled = false;
    }
    const unrestrictedCapabilities = this.productCapabilities.dailyEnabled &&
      this.productCapabilities.adsEnabled &&
      this.productCapabilities.rewardedShareEnabled &&
      this.productCapabilities.resultShareEnabled &&
      this.productPolicy.hintMode() === ((configuredAdConfig.rules &&
        configuredAdConfig.rules.hintMode) || 'tiered');
    this.engagement = unrestrictedCapabilities && opts.engagement
      ? opts.engagement
      : new EngagementService({
        ads: this.ads,
        share: this.share,
        rewards: this.rewards,
        hintAccess: this.hintAccess,
        rewardUnlocks: this.rewardUnlocks,
        auth: this.auth,
        behavior: this.behavior,
        config: configuredRules
      });
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

    this.renderer = new CanvasRenderer(platform, this.skins, this.clearEffects, this.subpackages, this.locale);
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
    this.clearFeedback = null;
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
    this.rewardDialog = null;
    this.rewardDialogSequence = 0;
    this.rewardRequestGeneration = 0;
    this.dismissedRewardNotices = new Set();
    this.accountGuard = { capture: () => this.captureAccountContext(), matches: token => this.isCurrentAccount(token) &&
      (!this.syncStore || ((this.syncStore.allowsLocalGameplay() || this.syncStore.isReadOnlyIdentityScope()) &&
        (this.syncStore.isReadOnlyIdentityScope() || !this.syncStore.state.boundUserId || !token.identityAtStart ||
          this.syncStore.state.boundUserId === token.identityAtStart))) };
    this.captureAccountContext();
    this.engagement.accountGuard = this.accountGuard;
    if (this.progressSync) this.progressSync.accountGuard = this.accountGuard;
    if (this.auth && this.auth.api) this.auth.api.accountGuard = this.accountGuard;
    if (this.auth) this.auth.accountGuard = { capture: () => this.captureAccountContext(), matches: token => this.isCurrentAccount(token) };
    if (this.auth && this.auth.onSessionChanged) this.unbindAccount = this.auth.onSessionChanged(() => this.captureAccountContext());
    if (this.syncStore && this.syncStore.onScopeChanged) this.unbindScope = this.syncStore.onScopeChanged(() => this.captureAccountContext());
  }

  captureAccountContext() {
    const scope = this.syncStore && this.syncStore.context ? this.syncStore.context()
      : { ownerId: null, bindingEpoch: 0, activationSequence: 0 };
    const metadata = this.auth && this.auth.sessions && this.auth.sessions.metadata ? this.auth.sessions.metadata() : null;
    const legacy = metadata && (metadata.schemaVersion === 1 ? metadata : metadata.legacySession);
    const session = this.auth && typeof this.auth.current === 'function' ? this.auth.current() : null;
    // Token expiry/refresh for the same HTTP user is not an account switch.
    // Clearing an expired HTTP credential during a 401 retry does not move
    // the local cache to guest. A different identified user or scope does.
    const identity = metadata && metadata.mode === 'cloud'
      ? `cloud:${metadata.environmentId}:${metadata.ownerId}:${metadata.bindingEpoch}`
      : (legacy && legacy.userId) || (session && session.userId) || this.accountIdentity || null;
    this.accountIdentity = identity;
    const signature = JSON.stringify([scope.ownerId, scope.bindingEpoch, scope.activationSequence, scope.environmentId || null, identity,
      this.auth && this.auth.mode === 'cloud' ? this.auth.generation : null]);
    if (this.accountSignature !== undefined && signature !== this.accountSignature) {
      this.accountGeneration++;
      if (this.engagement && this.engagement.cancelRewardUnlocks) this.engagement.cancelRewardUnlocks();
      if (this.profile && this.profile.unmount) this.profile.unmount();
      this.hintRequest = null; this.dailyExtraRequest = null; this.accountSyncPending = null;
      this.pendingShare = null; this.pendingSkinId = null;
      ++this.skinLoadRequestId; ++this.rewardRequestGeneration;
    }
    this.accountSignature = signature;
    return { ownerIdAtStart: scope.ownerId, bindingEpochAtStart: scope.bindingEpoch,
      environmentIdAtStart: scope.environmentId || null,
      activationSequenceAtStart: scope.activationSequence, accountGenerationAtStart: this.accountGeneration,
      identityAtStart: identity };
  }

  isCurrentAccount(token) {
    if (!token || this.disposed) return false;
    const current = this.captureAccountContext();
    return Object.keys(current).every(key => current[key] === token[key]);
  }

  acceptsLegacyTransition(token, userId, binding) {
    const current = this.captureAccountContext();
    return !this.disposed && !!userId && current.identityAtStart === userId &&
      current.accountGenerationAtStart === token.accountGenerationAtStart + 1 &&
      current.bindingEpochAtStart === token.bindingEpochAtStart &&
      current.activationSequenceAtStart === token.activationSequenceAtStart + (binding ? 1 : 0) &&
      (binding ? token.ownerIdAtStart === null && token.identityAtStart === userId &&
        current.ownerIdAtStart === `legacy-http:${userId}` : token.identityAtStart === null && current.ownerIdAtStart === token.ownerIdAtStart);
  }

  authorityMode(service, domain) {
    if (this.syncStore && typeof this.syncStore.authorityMode === 'function') return this.syncStore.authorityMode(domain || 'economy');
    return service && service.authorityMode ? service.authorityMode() : 'legacy-local';
  }

  blockCoreWriteDuringMigration(domain) {
    const restorePending = this.syncStore && this.syncStore.currentScope && this.syncStore.currentScope().pendingBackupRestore;
    if (this.authorityMode(null, domain) !== 'migration-freeze' && !restorePending) return false;
    if (this.scene !== 'account') this.openAccount();
    this.accountMessage = this.t(restorePending ? 'account.guard.restorePending' : 'account.guard.migrating');
    this.invalidate();
    return true;
  }

  validateMigrationEligibility() {
    if (!['home', 'account'].includes(this.scene) || this.pendingShare || this.dailyExtraRequest || this.hintRequest ||
        (this.engagement && this.engagement.rewardUnlockPending) ||
        (this.economy && this.economy.hasPendingPurchase && this.economy.hasPendingPurchase()) ||
        (this.rewardUnlocks && this.rewardUnlocks.hasPendingExternal && this.rewardUnlocks.hasPendingExternal())) {
      return { ok: false, reason: 'migration-not-ready' };
    }
    return { ok: true };
  }

  prepareLegacyMigration() {
    if (!this.syncStore || (!this.syncStore.ownsLocalState() && !this.syncStore.isReadOnlyIdentityScope())) {
      return { ok: false, reason: 'account-mismatch' };
    }
    const eligible = this.validateMigrationEligibility();
    if (!eligible.ok) return eligible;
    const existing = this.syncStore.currentScope().migration;
    const economyMode = this.authorityMode(this.rewardUnlocks, 'economy');
    if ((!existing && economyMode !== 'legacy-local') || (existing && economyMode !== 'migration-freeze') ||
        this.rewardUnlocks.hasPendingExternal()) {
      return { ok: false, reason: 'migration-not-ready' };
    }
    if (!existing) {
      try {
        if (this.progress.save() !== true || this.dailyProgress.save() !== true || !this.stamina.flush(this.clockNow().getTime())) {
          return { ok: false, reason: 'persist-failed' };
        }
      } catch (error) { return { ok: false, reason: 'persist-failed' }; }
      const recovered = this.recoverRewardUnlocks();
      if (!recovered.ok) return recovered;
    }
    const LegacyMigrationBuilder = require('./services/legacy-migration-builder.js');
    const built = new LegacyMigrationBuilder({ progress: this.progress, daily: this.dailyProgress,
      rewards: this.rewardUnlocks, stamina: this.stamina, syncStore: this.syncStore }).buildSnapshot();
    if (existing && built.ok && existing.snapshotHash !== built.snapshotHash) return { ok: false, reason: 'snapshot-changed' };
    return built;
  }

  applyAuthoritativeState(response, token) {
    if (!this.syncStore) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (!this.authoritativeApplier) {
      const AuthoritativeStateApplier = require('./services/authoritative-state-applier.js');
      this.authoritativeApplier = new AuthoritativeStateApplier({ progress: this.progress, daily: this.dailyProgress,
        rewards: this.rewardUnlocks, stamina: this.stamina, syncStore: this.syncStore,
        sessions: this.auth && this.auth.sessions }, this.accountGuard);
    }
    return this.authoritativeApplier.apply(response, token);
  }

  start() {
    if (this.disposed || this.started) return;
    this.started = true;
    this.unbindPointer = this.platform.bindPointer({
      start: point => this.onPointerStart(point),
      move: point => this.onPointerMove(point),
      end: point => this.onPointerEnd(point),
      cancel: point => this.onPointerCancel(point)
    });
    const unbindLifecycle = this.platform.bindLifecycle({
      hide: () => this.onHide(),
      show: options => this.onShow(options),
      resize: () => {
        this.renderer.ctx = this.platform.context;
        if (this.scene === 'account' && this.profile) {
          const profileSupported = typeof this.profile.isSupported === 'function' && this.profile.isSupported();
          this.profile.handleResize(accountLayout(this.platform.metrics, {
            backupMode: !!(this.cloudBackup && this.cloudBackup.enabled()),
            profileSupported
          }).profileButton);
        }
        this.invalidate();
      },
      audioInterruptBegin: () => this.audio.pauseAll('interruption'),
      audioInterruptEnd: () => this.audio.resumeAll('interruption')
    });
    this.unbindLifecycle = typeof unbindLifecycle === 'function' ? unbindLifecycle : null;
    this.startLoop();
    this.prepareCurrentSkinAssets();
    this.showNextRewardNotice();
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
    return dailyProgressAdapter.readDay(this.dailyProgress, dateKey);
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

  dailyCallCanEnter(resolution, numbers) {
    return dailyProgressAdapter.canEnter(this.dailyProgress, {
      dateKey: resolution && resolution.dateKey,
      dayId: resolution && (resolution.dayId || resolution.challengeId),
      entryLimit: numbers.entryLimit,
      entriesRemaining: numbers.entriesRemaining
    });
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
    const adapted = dailyProgressAdapter.recordEntry(this.dailyProgress, payload, numbers);
    const normalized = adapted.result;
    // Preserve the legacy branch decision independently from host fields.
    // In particular, a successful final entry may report canEnter=false and
    // historically returns without creating a cloud operation.
    if (!adapted.accepted) return normalized;
    if (this.progressSync && ['cloud-authoritative', 'local-backup'].includes(this.authorityMode(null, 'daily'))) {
      normalized.cloudQueued = this.progressSync.enqueueDailyEntry({ dateKey: resolution.dateKey, dayId,
        entryKey: idempotencyKey, entryLimit: numbers.entryLimit, levelIds });
    }
    return normalized;
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
      const resolutionNow = this.dailyTestDate
        ? new Date(this.dailyTestDate.getTime())
        : (now === undefined ? this.clockNow() : now);
      resolved = this.dailyService.resolve(resolutionNow);
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
    this.showNextRewardNotice(timestamp);
    this.refreshStamina(timestamp);
    if (this.accountFeedback && timestamp >= this.accountFeedback.until) this.clearAccountFeedback();
    if (this.hintPreview && this.hintPreview.manual !== true && timestamp >= this.hintPreview.until) {
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
    const feedback = this.clearFeedback;
    if ((this.scene === 'play' || this.scene === 'result' || dailyScene) &&
        feedback && feedback.runner === this.activeRunner() &&
        timestamp < feedback.startedAt + feedback.durationMs) return true;
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
    if (this.isHintPreviewActive(timestamp)) return true;
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
    const iceState = mechanicState.id === 'ice' ? mechanicState : mechanicState.ice;
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
      if (iceState) {
        cells[index].frozen = Array.isArray(boardState.remainingLayers) && boardState.remainingLayers[index] === 2;
      }
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
      instruction: portalInstructions.forState(mechanicState, this.locale),
      lockedEntry: locked && Number.isInteger(locked.entry) ? locked.entry : null
    } : null;
    if (portal && iceState) portal.hasIce = true;
    return {
      iceInstruction: iceState ? this.t('play.iceInstruction') : null,
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

  rewardDisplayView() {
    const authoritative = this.rewardUnlocks.view();
    if (!this.rewardUnlocks.displayView || !this.syncStore || !this.syncStore.rewardDisplayContext) return authoritative;
    try { return this.rewardUnlocks.displayView(this.syncStore.rewardDisplayContext()); }
    catch (error) { return authoritative; }
  }

  buildModel() {
    const dailyEnabled = this.productCapabilities.dailyEnabled;
    const homeDaily = dailyEnabled && this.scene === 'home' ? this.resolveDaily() : null;
    const homeDailyEntry = homeDaily && homeDaily.status === 'available'
      ? this.dailyEntryState(homeDaily)
      : {
        entryLimit: this.dailyEntryLimit(homeDaily),
        entriesUsed: 0,
        entriesRemaining: 0,
        allowed: false
      };
    const activeDaily = dailyEnabled && (this.scene === 'daily' || this.scene === 'dailyResult')
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
    const hintContext = this.productPolicy.hintMode() === 'free'
      ? null : this.hintContext();
    const hintState = this.engagement.hintState ? this.engagement.hintState(hintContext) : { mode: 'free', action: 'view' };
    const hintEnabled = this.isHintPreviewActive() || (!this.hintRequest && !['busy', 'unavailable'].includes(hintState.action));
    const base = {
      scene: this.scene,
      productCapabilities: this.productCapabilities,
      clearFeedback: this.clearFeedback && this.clearFeedback.runner === this.activeRunner()
        ? { startedAt: this.clearFeedback.startedAt, durationMs: this.clearFeedback.durationMs } : null,
      currency: this.rewardDisplayView(),
      rewardDialog: this.rewardDialog ? cloneData(this.rewardDialog) : null,
      stamina: Object.assign({}, this.staminaSnapshot),
      staminaFeedback: this.staminaFeedback ? Object.assign({}, this.staminaFeedback) : null,
      accountFeedback: this.accountFeedback ? Object.assign({}, this.accountFeedback) : null,
      homeStaminaExpanded: this.scene === 'home' && this.homeStaminaExpanded,
      pressedId: this.pressedId,
      accountProfile: (this.scene === 'home' || this.scene === 'account') && this.profile ? this.profile.current() : null,
      shareAvailable: !!(this.productCapabilities.resultShareEnabled && this.share &&
        this.share.isResultEnabled() && this.shareContext().completed),
      sharePending: !!this.pendingShare,
      dailyExtraEntryAvailable: !!(dailyEnabled && this.productCapabilities.adsEnabled &&
        this.engagement.canRequestDailyExtraEntry && this.engagement.canRequestDailyExtraEntry() &&
        dailyResolution && dailyResolution.status === 'available' &&
        (this.scene === 'home' ? !homeDailyEntry.allowed : this.scene === 'dailyResult' &&
          activeDaily && activeDaily.result && activeDaily.result.outcome !== OUTCOME.FAILED && activeDaily.entriesRemaining <= 0)),
      dailyExtraEntryPending: !!this.dailyExtraRequest,
      dailyRewardMessage: this.dailyRewardMessage && dailyResolution &&
        this.dailyRewardMessage.dateKey === dailyResolution.dateKey
        ? (this.dailyRewardMessage.key
          ? this.t(this.dailyRewardMessage.key)
          : this.dailyRewardMessage.text)
        : '',
      // Count only published ordinary levels. Retired catalog coordinates may
      // remain in an upgraded player's save and must not inflate this total.
      completedCount: this.ordinaryCompletedCount(),
      totalLevels: catalog.levels.length,
      soundEnabled: this.audio.isEnabled(),
      hint: this.hint,
      hintUntil: this.hintUntil,
      hintPreview: this.hintPreview,
      hintLabel: this.hintButtonLabel(hintState, hintContext),
      dailyAvailable: !!(dailyEnabled && homeDaily && homeDaily.status === 'available'),
      dailyEntryAvailable: !!(dailyEnabled && homeDailyEntry.allowed),
      dailyCanEnter: !!(dailyEnabled && homeDailyEntry.allowed),
      dailyDateKey: homeDaily && homeDaily.dateKey ? homeDaily.dateKey : null,
      dailyCompleted: dailyEnabled && this.dailyCompletionState(homeDaily),
      dailyEntriesUsed: homeDailyEntry.entriesUsed,
      dailyEntryLimit: homeDailyEntry.entryLimit,
      dailyEntriesRemaining: this.dailyDebugUnlimited ? null : homeDailyEntry.entriesRemaining,
      dailyDebugUnlimited: this.dailyDebugUnlimited,
      homeMigration: this.homeMigration,
      settlementMode: this.authorityMode(null, 'economy'),
      // Expose the active visual selection as data only. The renderer never
      // mutates this value; `performAction('effect:<id>')` owns persistence.
      currentEffectId: this.currentEffectId()
    };

    if (this.scene === 'account') {
      const sync = this.progressSync ? this.progressSync.state() : { status: 'idle' };
      const backup = this.cloudBackup ? this.cloudBackup.state() : null;
      const auth = this.auth ? this.auth.state() : 'anonymous';
      const status = sync.status === 'account-mismatch' ? 'account-mismatch'
        : this.accountSyncPending || auth === 'authenticating' ||
          ['syncing', 'cloud-reading', 'migration-preparing', 'migration-uploading', 'migration-applying'].includes(sync.status)
          ? 'syncing'
          : ['synced', 'cloud-synced', 'backed-up'].includes(sync.status) ? 'synced'
            : ['cloud-pending', 'cloud-paused', 'backup-pending', 'backup-conflict', 'restore-confirmation'].includes(sync.status) ? 'pending'
              : ['error', 'storage-blocked', 'migration-snapshot-missing', 'restore-pending'].includes(sync.status) ? 'error' : 'local';
      const syncNeeded = Number(sync.pending) > 0 ||
        ['cloud-pending', 'cloud-paused', 'backup-pending', 'backup-conflict', 'restore-confirmation'].includes(sync.status);
      return Object.assign(base, {
        accountStatus: this.auth && this.auth.readOnlyPhase && !(this.cloudBackup && this.cloudBackup.enabled()) ? 'local' : status,
        accountMessage: this.accountMessage || (this.auth && this.auth.readOnlyPhase && !(this.cloudBackup && this.cloudBackup.enabled())
          ? this.t(sync.status === 'cloud-readonly' ? 'sync.readOnly' : 'sync.identityOffline') : ''),
        profileSupported: !!(this.profile && typeof this.profile.isSupported === 'function' && this.profile.isSupported()),
        profilePending: this.accountProfilePending,
        syncPending: !!this.accountSyncPending,
        syncNeeded,
        backupMode: !!(this.cloudBackup && this.cloudBackup.enabled()),
        backupDirty: !!(backup && backup.dirty),
        backupConfirmRestore: !!(backup && backup.confirmRestore),
        backupConfirmCommit: !!(backup && backup.confirmBackup)
      });
    }

    if (activeDaily) {
      const completed = this.dailyCompletionState(dailyResolution);
      const boardView = this.buildBoardViewModel(activeDaily.runner, activeDaily.clearAnimation);
      return Object.assign(base, buildDailyViewModel({
        challenge: activeDaily.challenge,
        levels: activeDaily.levels,
        levelIndex: activeDaily.levelIndex,
        levelResults: activeDaily.levelResults,
        dateKey: activeDaily.dateKey,
        dayId: activeDaily.dayId,
        challengeId: activeDaily.challengeId,
        entriesUsed: activeDaily.entriesUsed,
        entryLimit: activeDaily.entryLimit,
        entriesRemaining: activeDaily.entriesRemaining,
        debugUnlimited: this.dailyDebugUnlimited,
        completed,
        boardView,
        hintEnabled,
        result: activeDaily.result,
        firstClearRewardAmount: rewardConfig.currency.dailyFirstComplete,
        enteredAt: activeDaily.enteredAt,
        clearAnimation: activeDaily.clearAnimation,
        resultVisibleAt: activeDaily.resultVisibleAt,
        runStartedAt: activeDaily.runStartedAt,
        elapsedBeforeLevel: activeDaily.elapsedBeforeLevel
      }));
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
            difficulty: Number.isInteger(game.Difficulty) && game.Difficulty >= 1 && game.Difficulty <= 5
              ? game.Difficulty : null,
            setIndex: entry.setIndex,
            levelIndex: entry.levelIndex,
            completed: this.progress.isCompleted(entry.setIndex, entry.levelIndex),
            bestMs: this.progress.bestTime(entry.setIndex, entry.levelIndex),
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
      const themes = this.themeDescriptors().map(theme => {
        const reward = theme && theme.reward;
        const externalDisabled = reward && (
          (reward.conditionType === 'rewarded_ad' && !this.productCapabilities.adsEnabled) ||
          (reward.conditionType === 'share' && !this.productCapabilities.rewardedShareEnabled)
        );
        return externalDisabled
          ? Object.assign({}, theme, { reward: Object.assign({}, reward, {
            actionEnabled: false,
            externalDisabled: true
          }) })
          : theme;
      });
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
      const effects = this.effectDescriptors().map(effect => {
        const reward = effect && effect.reward;
        const externalDisabled = reward && (
          (reward.conditionType === 'rewarded_ad' && !this.productCapabilities.adsEnabled) ||
          (reward.conditionType === 'share' && !this.productCapabilities.rewardedShareEnabled)
        );
        return externalDisabled
          ? Object.assign({}, effect, { reward: Object.assign({}, reward, {
            actionEnabled: false,
            externalDisabled: true
          }) })
          : effect;
      });
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
      const trial = !!(context && context.progressionScope === 'trial');
      const set = context && context.set;
      const level = context && context.level;
      const activeLevelIndex = context ? context.levelIndex : this.levelIndex;
      const ordinaryPosition = context
        ? this.catalogLevelPosition(context.setIndex, activeLevelIndex)
        : -1;
      const boardView = this.buildBoardViewModel(this.runner, this.clearAnimation);
      const portalStatus = boardView && boardView.mechanic.portal;
      return Object.assign(base, {
        trial,
        set,
        level,
        levelIndex: activeLevelIndex,
        ordinaryLevelNumber: ordinaryPosition >= 0 ? ordinaryPosition + 1 : null,
        ordinaryLevelCount: catalog.levels.length,
        beginnerInstruction: context && context.mechanic.id === 'ice' ? this.t('play.iceInstruction') : ordinaryPosition >= 0 && ordinaryPosition < 5
          ? this.t(ordinaryPosition === 0 ? 'play.firstInstruction' : 'play.clearEveryTileInstruction') : null,
        board: boardView && boardView.board,
        mechanic: boardView ? boardView.mechanic : { portal: null },
        elapsedText: boardView ? boardView.elapsedText : '0:00',
        canUndo: !!(boardView && boardView.canUndo),
        levelEnteredAt: this.levelEnteredAt,
        clearAnimation: this.clearAnimation,
        hintAvailable: !!boardView && !boardView.terminal && (trial || hintEnabled),
        hintLabel: trial ? this.t('play.hint') : base.hintLabel,
        result: this.result,
        firstClearRewardAmount: rewardConfig.currency.ordinaryFirstClear,
        staminaRefund: context && !trial ? this.stamina.quickClearRefundState(`${context.setIndex}:${activeLevelIndex}`) : null,
        resultVisibleAt: this.resultVisibleAt,
        hasNext: !!(context && !trial && this.progression.nextLevel(context.setIndex, activeLevelIndex)),
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

  t(key, params) {
    try {
      if (this.locale && typeof this.locale.t === 'function') return this.locale.t(key, params);
    } catch (error) {}
    return i18n.translate('zh-CN', key, params);
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
    if (this.rewardDialog) {
      this.pointer = { mode: 'reward', id: point.id, start: point, last: point,
        hit: hit && hit.indexOf('reward:') === 0 ? hit : null, dialogId: this.rewardDialog.dialogId };
      this.pressedId = this.pointer.hit;
      this.invalidate();
      return;
    }
    if (hit) {
      this.pointer = { mode: 'ui', id: point.id, start: point, last: point, hit };
      this.pressedId = hit;
      this.invalidate();
      return;
    }

    if (this.isHintPreviewActive()) {
      if (this.hintPreview.manual) {
        this.pointer = { mode: 'hint-preview', id: point.id, start: point, last: point, hit: null };
      }
      return;
    }

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
    if (this.rewardDialog) {
      if (point && this.pointer && point.id === this.pointer.id) this.pointer.last = point;
      return;
    }
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
    if (this.rewardDialog) {
      const active = this.pointer;
      if (!active || (point && point.id !== active.id)) return;
      this.pointer = null;
      this.pressedId = null;
      const end = point || active.last;
      if (active.mode === 'reward' && active.dialogId === this.rewardDialog.dialogId && active.hit &&
          Math.abs(end.x - active.start.x) < 20 && Math.abs(end.y - active.start.y) < 20 &&
          active.hit === this.renderer.hitTest(end.x, end.y)) this.performAction(active.hit);
      this.invalidate();
      return;
    }
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
    if (active.mode === 'hint-preview') {
      if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        this.changeHintPreviewStep(dx < 0 ? 1 : -1);
      }
      return;
    }
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
    // Screen feedback is independent of the selected path-disappearance effect.
    // Keep a single 180ms pulse; rapid clears restart it instead of stacking.
    this.clearFeedback = { runner, startedAt: now, durationMs: 180 };
    const state = runner.getViewState();
    const iceBrokenCells = state.mechanic.id === 'ice' || state.mechanic.ice
      ? (cells || []).filter(index => state.board.remainingLayers[index] === 1) : [];
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
      iceBrokenCells,
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
    // Trial settlement ends here: no best-time save, stamina refund, reward,
    // share preparation, engagement, or cloud write can follow this boundary.
    if (this.runContext.progressionScope === 'trial') {
      this.invalidate();
      return;
    }
    const cloudStaminaRefund = runner === this.runner && this.runContext.progressionScope === 'ordinary' &&
      this.authorityMode(this.stamina, 'stamina') === 'cloud-authoritative';
    if (runner === this.runner && this.runContext.progressionScope === 'ordinary' && !cloudStaminaRefund) {
      const refundAt = this.clockNow().getTime();
      const refund = this.stamina.refundQuickClear(
        `${this.runContext.setIndex}:${this.runContext.levelIndex}`, completion.elapsedMs, refundAt
      );
      this.result.staminaRefunded = refund.refunded;
      this.refreshStamina(refundAt);
      if (refund.refunded > 0) this.showStaminaFeedback('quick-clear-refund', refundAt, refund.refunded);
      else if (!refund.ok) this.showStaminaFeedback(refund.reason, refundAt);
    }
    // Optional engagement starts only after the result and local completion.
    if (this.share) this.share.prepareContext(this.shareContext());
    // The legacy local store retains in-memory progress on a write failure.
    // Confirm persistence before enqueueing anything for cloud delivery.
    try { completion.persisted = this.progress.save() === true; } catch (error) { completion.persisted = false; }
    const rewardResult = completion.persisted ? this.recoverRewardUnlocks() : { ok: false };
    const source = `ordinary:${this.runContext.setIndex}:${this.runContext.levelIndex}`;
    const settlementMode = this.authorityMode(null, 'economy');
    completion.currencyReward = {
      status: !rewardResult.ok && settlementMode === 'local-backup' ? 'local-save-failed'
        : !rewardResult.ok ? 'pending' : (rewardResult.sources || []).includes(source) ? 'granted' : 'already-claimed',
      amount: rewardResult.ok && (rewardResult.sources || []).includes(source) ? rewardConfig.currency.ordinaryFirstClear : 0
    };
    if (settlementMode === 'local-backup' && !rewardResult.ok) {
      completion.currencyReward.failureSource = completion.persisted ? 'reward-reconcile' : 'local-save';
    }
    let completionQueued = false;
    if (completion.persisted && this.progressSync) {
      const account = this.captureAccountContext();
      try { completionQueued = this.progressSync.enqueueCompletion({ setIndex: this.setIndex, levelIndex: this.levelIndex,
        elapsedMs: completion.elapsedMs, completedAtClient: now,
        firstClear: completion.firstClear, newBest: completion.newBest },
      settled => this.applyCloudCurrencyResult(completion, account, settled)); } catch (error) {}
    }
    if (cloudStaminaRefund && completionQueued && this.progressSync && this.progressSync.refundQuickClear) {
      const refundAt = this.clockNow().getTime();
      let refund = { ok: false, refunded: 0, reason: 'sync-pending' };
      try {
        refund = this.progressSync.refundQuickClear(
          `${this.runContext.setIndex}:${this.runContext.levelIndex}`, completion.elapsedMs, refundAt
        );
      } catch (error) {}
      this.result.staminaRefunded = refund.refunded;
      this.refreshStamina(refundAt);
      if (refund.refunded > 0) this.showStaminaFeedback('quick-clear-refund', refundAt, refund.refunded);
      else if (!refund.ok) this.showStaminaFeedback(refund.reason, refundAt);
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

  dailyCompletionCall(level, levelIndex, elapsedMs, observer) {
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
    const normalized = dailyProgressAdapter.recordCompletion(this.dailyProgress, payload);
    if (!normalized) return null;
    if (normalized.persisted === true && this.progressSync &&
        ['cloud-authoritative', 'local-backup'].includes(this.authorityMode(null, 'daily'))) {
      normalized.cloudQueued = this.progressSync.enqueueDailyCompletion({ dateKey: daily.dateKey, dayId: daily.dayId,
        levelId, levelIndex, levelCount: daily.levels.length, levelIds: payload.levelIds,
        elapsedMs: Math.max(1, Math.round(elapsedMs)), completedAtClient: completedAt }, observer);
    }
    return normalized;
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
    const account = this.captureAccountContext();
    let dailyResultTarget = null;
    let deferredCloudSettlement = null;
    const cloudObserver = levelIndex >= daily.levels.length - 1 ? settled => {
      if (!dailyResultTarget) { deferredCloudSettlement = settled; return; }
      this.applyCloudCurrencyResult(dailyResultTarget, account, settled);
    } : null;
    const completion = this.dailyCompletionCall(daily.levels[levelIndex], levelIndex, elapsedMs, cloudObserver);
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
    const rewardResult = completion.persisted === true ? this.recoverRewardUnlocks() : { ok: false };
    const source = `daily:${daily.dateKey}`;
    const settlementMode = this.authorityMode(null, 'economy');
    daily.result.currencyReward = {
      status: !rewardResult.ok && settlementMode === 'local-backup' ? 'local-save-failed'
        : !rewardResult.ok ? 'pending' : (rewardResult.sources || []).includes(source) ? 'granted' : 'already-claimed',
      amount: rewardResult.ok && (rewardResult.sources || []).includes(source) ? rewardConfig.currency.dailyFirstComplete : 0
    };
    if (settlementMode === 'local-backup' && !rewardResult.ok) {
      daily.result.currencyReward.failureSource = completion.persisted === true ? 'reward-reconcile' : 'local-save';
    }
    dailyResultTarget = daily.result;
    if (deferredCloudSettlement) this.applyCloudCurrencyResult(dailyResultTarget, account, deferredCloudSettlement);
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
    this.clearFeedback = null;
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
    this.clearFeedback = null;
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
    if (this.disposed) return false;
    const dailyAction = action === 'home:daily' || action === 'home:dailyChallenge' ||
      action.indexOf('daily:') === 0 || action.indexOf('dailyResult:') === 0 ||
      action.indexOf('dailyFailure:') === 0;
    if (dailyAction && !this.productCapabilities.dailyEnabled) return false;
    if ((action === 'result:share' || action === 'dailyResult:share') &&
        !this.productCapabilities.resultShareEnabled) return false;
    if (this.rewardDialog) {
      const conditionType = this.rewardDialog.conditionType;
      const externalDisabled =
        (conditionType === 'rewarded_ad' && !this.productCapabilities.adsEnabled) ||
        (conditionType === 'share' && !this.productCapabilities.rewardedShareEnabled);
      if ((action === 'reward:unlock' || action === 'reward:retry') && externalDisabled) return false;
      if (action === 'reward:unlock' || action === 'reward:retry') return this.requestRewardUnlock(action === 'reward:retry');
      if (action === 'reward:apply') return this.applyReward();
      if (action === 'reward:later' || action === 'reward:close') return this.dismissRewardDialog();
      return false;
    }
    if (action === 'reward:retry') {
      const pendingResult = this.scene === 'result' ? this.result
        : this.scene === 'dailyResult' && this.daily ? this.daily.result : null;
      if (pendingResult && pendingResult.currencyReward && pendingResult.currencyReward.status === 'pending' &&
          this.authorityMode(null, 'economy') === 'cloud-authoritative') {
        try { this.progressSync.flush().catch(function () {}); } catch (error) {}
        this.invalidate();
        return true;
      }
      if (this.scene === 'result' && this.result && this.result.currencyReward &&
          ['pending', 'local-save-failed'].includes(this.result.currencyReward.status)) {
        let persisted = false;
        try { persisted = this.progress.save() === true; } catch (error) {}
        this.result.persisted = persisted;
        if (!persisted) {
          this.invalidate();
          return false;
        }
        const localSettlement = this.authorityMode(null, 'economy') === 'local-backup';
        this.result.currencyReward.status = localSettlement ? 'local-save-failed' : 'pending';
        if (localSettlement) {
          this.result.currencyReward.failureSource = 'reward-reconcile';
        } else delete this.result.currencyReward.failureSource;
      }
      const result = this.recoverRewardUnlocks();
      this.invalidate();
      const activeResult = this.scene === 'result' ? this.result
        : this.scene === 'dailyResult' && this.daily ? this.daily.result : null;
      return result.ok && !(activeResult && activeResult.currencyReward &&
        activeResult.currencyReward.status === 'pending');
    }
    if (action.indexOf('reward:') === 0) return false;
    if (action === 'account:language:prev' || action === 'account:language:next') {
      if (this.scene !== 'account') return false;
      const method = action === 'account:language:next'
        ? 'next' : 'previous';
      if (!this.locale || typeof this.locale[method] !== 'function') return false;
      this.locale[method]();
      // Transient account feedback is already rendered state, not business
      // state. Clear it so the newly selected locale is visible immediately.
      this.accountMessage = '';
      this.clearAccountFeedback();
      if (this.profile) this.mountAccountProfile();
      this.invalidate();
      return true;
    }
    if (action === 'home:stamina') {
      if (this.scene !== 'home') return false;
      this.homeStaminaExpanded = !this.homeStaminaExpanded;
      this.refreshStamina(this.clockNow().getTime());
      this.invalidate();
      return this.homeStaminaExpanded;
    }
    if (action === 'daily:revive' || action === 'dailyResult:revive') action = 'daily:extraEntry';
    const previewActive = this.isHintPreviewActive();
    if (action === 'hint:prev' || action === 'hint:next') {
      return this.changeHintPreviewStep(action === 'hint:next' ? 1 : -1);
    }
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
      if (this.blockCoreWriteDuringMigration('preferences')) return false;
      const enabled = this.audio.toggle();
      if (this.progressSync && this.preferences) {
        try { this.progressSync.enqueuePreference('soundEnabled', enabled); } catch (error) {}
      }
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
      const backup = this.cloudBackup && this.cloudBackup.state();
      if (backup && (backup.confirmRestore || backup.confirmBackup)) {
        this.cloudBackup.cancelConfirmation(); this.accountMessage = ''; this.invalidate(); return true;
      }
      this.scene = 'home';
    } else if (action === 'account:authorizeProfile' && this.scene === 'account') {
      // The visible native button handles the actual user gesture. A Canvas
      // hit may only mount that button, never synthesize consent.
      this.mountAccountProfile();
    } else if (action === 'account:retrySync' && this.scene === 'account') {
      this.retryAccountSync();
    } else if (action === 'account:restoreBackup' && this.scene === 'account') {
      this.runAccountBackupAction('restore');
    } else if (action === 'account:confirmRestore' && this.scene === 'account') {
      this.runAccountBackupAction('confirmRestore');
    } else if (action === 'account:confirmBackup' && this.scene === 'account') {
      this.runAccountBackupAction('confirmBackup');
    } else if (action === 'account:privacy' && this.scene === 'account') {
      const generation = this.accountSceneGeneration;
      const account = this.captureAccountContext();
      const task = this.platform.openPrivacyContract ? this.platform.openPrivacyContract() : Promise.resolve({ ok: false });
      Promise.resolve(task).then(result => {
        if (!this.isCurrentAccount(account) || this.scene !== 'account' || generation !== this.accountSceneGeneration) return;
        if (!result.ok) this.showAccountFeedback('privacy-open-failed', this.clockNow().getTime());
        this.invalidate();
      }).catch(() => {
        if (!this.isCurrentAccount(account) || this.scene !== 'account' || generation !== this.accountSceneGeneration) return;
        this.showAccountFeedback('privacy-open-failed', this.clockNow().getTime());
      });
    } else if (action === 'home:dailyChallenge' || action === 'home:daily') {
      this.enterDaily();
    } else if (action === 'home:iceTrial' && this.scene === 'home') {
      this.openIceTrial();
    } else if (action === 'home:start') {
      const target = this.progression.resumeTarget(this.progress.state.lastPlayed);
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
      const id = action.slice('theme:'.length);
      if (this.rewardUnlocks.canUse('theme', id)) {
        if (!this.setSkin(id) && this.openRewardDialog(`theme:${id}`, 'unlocked')) {
          this.rewardDialog.state = 'error'; this.rewardDialog.message = this.t('reward.applySaveFailed');
        }
      }
      else this.openRewardDialog(`theme:${id}`);
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
      const id = action.slice('effect:'.length);
      if (this.rewardUnlocks.canUse('effect', id)) {
        if (!this.setClearEffect(id) && this.openRewardDialog(`effect:${id}`, 'unlocked')) {
          this.rewardDialog.state = 'error'; this.rewardDialog.message = this.t('reward.applySaveFailed');
        }
      }
      else this.openRewardDialog(`effect:${id}`);
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
        if (this.daily.runner.undo()) {
          this.daily.clearAnimation = null;
          this.clearFeedback = null;
        }
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
      this.scene = this.runContext && this.runContext.progressionScope === 'trial' ? 'home' : 'levels';
      this.runner = null;
      this.runContext = null;
      this.boardInput.setRunner(null);
    } else if (action === 'play:reset') {
      if (!this.runner) return;
      this.resetCurrentLevel();
    } else if (action === 'play:undo') {
      if (this.runner && this.runner.undo()) {
        this.clearAnimation = null;
        this.clearFeedback = null;
      }
      this.hint = null;
      this.hintUntil = 0;
      this.hintPreview = null;
    } else if (action === 'play:hint') {
      this.requestHint();
    } else if (action === 'result:replay') {
      if (this.runContext && this.runContext.progressionScope === 'trial') {
        this.resetCurrentLevel();
      } else if (this.runContext) {
        this.openLevel(this.runContext.setIndex, this.runContext.levelIndex);
      }
    } else if (action === 'failure:retry') {
      if (this.scene === 'result' && this.result && this.result.outcome === OUTCOME.FAILED) {
        this.resetCurrentLevel();
      }
    } else if (action === 'result:next') {
      if (this.runContext && this.runContext.progressionScope !== 'trial') {
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
      ++this.skinLoadRequestId;
      this.pendingSkinId = null;
      if (this.scene === 'home') {
        this.recoverRewardUnlocks();
        if (this.auth && this.auth.mode === 'cloud') this.resumeOnline('home');
      }
      this.homeStaminaExpanded = false;
      this.clearHintRequest();
      if (this.share) this.share.prepareContext(this.shareContext());
    }
    if ((ordinaryFailure || dailyFailure) && this.renderer) this.renderer.clearInteractionHits();
    this.invalidate();
  }

  openAccount() {
    this.clearHintPreview(false);
    this.scene = 'account';
    this.accountSceneGeneration++;
    this.accountMessage = '';
    this.accountFeedback = null;
    this.pointer = null;
    this.pressedId = null;
    this.boardInput.setRunner(null);
    this.mountAccountProfile();
    if (this.auth && this.auth.mode === 'cloud') this.resumeOnline('account');
    if (this.profile) {
      const generation = this.accountSceneGeneration;
      const account = this.captureAccountContext();
      this.profile.refresh().then(() => {
        if (this.isCurrentAccount(account) && this.scene === 'account' && generation === this.accountSceneGeneration) this.invalidate();
      });
    }
    this.invalidate();
  }

  shareContext() {
    if (this.runContext && this.runContext.progressionScope === 'trial' &&
        (this.scene === 'play' || this.scene === 'result')) return { scene: 'home', completed: false };
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
    if (!this.hintAccess || typeof this.hintAccess.dateKey !== 'function') return null;
    let levelKey = null;
    if (this.scene === 'play' && this.runContext && this.runContext.progressionScope === 'ordinary') {
      levelKey = HintAccessService.levelKey({ source: 'catalog',
        setIndex: this.runContext.setIndex, levelIndex: this.runContext.levelIndex });
    } else if (this.scene === 'daily' && this.daily.runner && this.daily.challenge) {
      levelKey = HintAccessService.levelKey({ source: 'daily',
        dayId: this.daily.dayId, challengeId: this.daily.challengeId });
    }
    return levelKey ? { scene: this.scene, levelKey, dateKey: this.hintAccess.dateKey() } : null;
  }

  hintButtonLabel(state, context) {
    if (this.hintRequest) return this.t('common.processing');
    if (!state) {
      context = this.hintContext();
      state = this.engagement.hintState ? this.engagement.hintState(context) : { mode: 'free' };
    }
    if (state.action === 'unavailable') return this.t('hint.unavailable');
    if (state.mode !== 'share' && state.mode !== 'tiered') return this.t('play.hint');
    if (state.action === 'busy') return this.t('common.processing');
    if (state.action === 'retry-save') return this.t('common.retrySave');
    if (context && this.hintFeedback && context.dateKey === this.hintFeedback.dateKey &&
        context.levelKey === this.hintFeedback.levelKey && state.action === this.hintFeedback.action) return this.hintFeedback.label;
    const key = { view: 'hint.view', free: 'hint.free', share: 'hint.shareUnlock', rewarded: 'hint.adUnlock' }[state.action];
    return this.t(key || 'hint.unavailable');
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
    if (this.blockCoreWriteDuringMigration('daily')) return { ok: false, reason: 'migration-freeze' };
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
    if (this.blockCoreWriteDuringMigration('daily')) return false;
    if (!this.engagement.canRequestDailyExtraEntry || !this.engagement.canRequestDailyExtraEntry()) return false;
    const context = this.dailyRewardContext();
    if (!context || this.dailyExtraRequest || !this.rewards) return false;
    const token = { scene: this.scene, runKey: this.runSequence, context, account: this.captureAccountContext() };
    this.dailyExtraRequest = token;
    this.invalidate();
    this.engagement.requestDailyExtraEntry(context).then(grant => {
      if (!this.isCurrentAccount(token.account)) return;
      const applied = grant.ok ? this.applyDailyGrant(grant) : grant;
      if (this.dailyExtraRequest !== token || this.scene !== token.scene || this.runSequence !== token.runKey) return;
      const messageKey = applied.ok ? 'daily.extraAttemptGranted'
        : applied.reason === 'closed' ? 'daily.extraAttemptVideoIncomplete'
          : applied.reason === 'DAILY_REWARD_LIMIT_REACHED' ? 'daily.extraAttemptLimitReached'
            : 'daily.extraAttemptFailed';
      this.dailyRewardMessage = {
        dateKey: context.dateKey,
        key: messageKey,
        text: this.t(messageKey)
      };
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
    const account = this.captureAccountContext();
    return this.rewards.recover({ dateKey: resolved.dateKey, dayId: resolved.dayId }).then(result => {
      if (!this.isCurrentAccount(account)) return;
      (result.grants || []).forEach(grant => this.applyDailyGrant(grant));
      this.invalidate();
    }).catch(function () {});
  }

  requestHint() {
    if (this.scene === 'play' && this.runContext && this.runContext.progressionScope === 'trial') return this.showHint();
    const runner = this.activeRunner();
    if (!runner || this.runnerTerminal(runner) || !['play', 'daily'].includes(this.scene)) return false;
    if (this.isHintPreviewActive()) return this.scene === 'daily' ? this.showDailyHint() : this.showHint();
    if (this.scene === 'play' && this.productPolicy.hintMode() === 'free') return this.showHint();
    if (this.hintRequest) return false;
    const context = this.hintContext();
    const state = this.engagement.hintState ? this.engagement.hintState(context) : { mode: 'free', action: 'view' };
    if (state.action === 'busy' || state.action === 'unavailable') { this.invalidate(); return false; }
    // Retrying an earned permission may concern a previous level. Repair it
    // before validating the current level, without touching the current board.
    if (state.action !== 'retry-save') {
      if (this.boardInput.isActive()) return false;
      const hint = this.resolveCompleteHint(runner);
      if (!hint || !this.createHintPreview(runner, hint, 0)) {
        this.hintFeedback = Object.assign({}, context, { action: state.action, label: this.t('hint.none') });
        this.audio.playSfx('error');
        this.invalidate();
        return false;
      }
    }
    const token = { scene: this.scene, runKey: this.runSequence, runner, context, account: this.captureAccountContext() };
    this.hintRequest = token;
    this.hintFeedback = null;
    const apply = result => {
      if (!this.isCurrentAccount(token.account)) return false;
      // A completed global request may re-enable the button in another run.
      if (!this.disposed) this.invalidate();
      if (this.hintRequest !== token) return false;
      this.hintRequest = null;
      if (this.disposed || this.scene !== token.scene || this.runSequence !== token.runKey || this.activeRunner() !== runner || this.runnerTerminal(runner)) return false;
      if (result && (result.mode === 'share' || result.mode === 'tiered')) {
        if (!context || context.dateKey !== this.hintAccess.dateKey()) return false;
        if (result.dateKey !== context.dateKey || result.levelKey !== context.levelKey) return false;
        if (!result.granted && !result.unlocked) {
          const key = result.reason === 'persist-failed' ? 'common.retrySave'
            : result.action === 'rewarded' ? (result.reason === 'closed' ? 'hint.adUnlock' : 'hint.retryAd')
              : ['not-supported', 'not-configured'].includes(result.reason) ? 'hint.shareUnavailable' : 'hint.retryShare';
          const label = this.t(key);
          this.hintFeedback = Object.assign({}, context, { action: result.action, label });
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
    const token = { scene: this.scene, result: this.scene === 'result' ? this.result : this.daily.result, account: this.captureAccountContext() };
    this.pendingShare = token;
    this.invalidate();
    this.engagement.shareResult(context).catch(() => ({ initiated: false })).finally(() => {
      if (!this.isCurrentAccount(token.account) || this.pendingShare !== token) return;
      this.pendingShare = null;
      if (this.scene === token.scene && token.result === (this.scene === 'result' ? this.result : this.daily.result)) this.invalidate();
    });
    return true;
  }

  mountAccountProfile() {
    if (this.scene !== 'account' || this.hidden || this.disposed || !this.profile) return false;
    const generation = this.accountSceneGeneration;
    const account = this.captureAccountContext();
    const current = () => this.isCurrentAccount(account) && this.scene === 'account' && !this.hidden && generation === this.accountSceneGeneration;
    const skin = this.skins.current();
    const profileSupported = typeof this.profile.isSupported === 'function' && this.profile.isSupported();
    const result = this.profile.mount({
      rect: accountLayout(this.platform.metrics, {
        backupMode: !!(this.cloudBackup && this.cloudBackup.enabled()),
        profileSupported
      }).profileButton,
      style: { color: skin.colors.text, backgroundColor: skin.colors.levelCell },
      onPending: pending => { if (current()) { this.accountProfilePending = pending; this.invalidate(); } },
      onSuccess: () => { if (current()) { this.accountMessage = this.t('account.profileSaved'); this.invalidate(); } },
      onDenied: result => {
        if (!current()) return;
        this.accountMessage = this.t(result.reason === 'denied' ? 'account.profileDenied' : 'account.profileSaveFailed');
        this.invalidate();
      }
    });
    this.accountProfilePending = !!this.profile.pending;
    return result.ok;
  }

  leaveAccount() {
    this.accountSceneGeneration++;
    this.accountSyncPending = null;
    this.accountProfilePending = false;
    this.accountFeedback = null;
    if (this.profile) this.profile.unmount();
  }

  showAccountFeedback(reason, now) {
    this.accountFeedback = { reason, until: now + 2200 };
    this.invalidate();
  }

  clearAccountFeedback() {
    if (!this.accountFeedback) return;
    this.accountFeedback = null;
    this.invalidate();
  }

  cloudAccountMessage(result) {
    if (this.cloudBackup && this.cloudBackup.enabled()) {
      const state = this.cloudBackup.state();
      if (state.confirmBackup) return this.t('sync.backupConflict');
      if (state.confirmRestore) return this.t('sync.backupFound');
      if (state.status === 'backed-up') return this.t('sync.backupCurrent');
      if (state.status === 'backup-pending') return this.t('sync.backupPending');
      if (state.status === 'restore-pending') return this.t('sync.restorePending');
      if (result && result.ok !== true) return this.t('sync.backupIncomplete');
      return this.t('sync.backupLocalPrimary');
    }
    if (result && result.status === 'local-only') return this.t('sync.localOnly');
    if (result && result.status === 'cloud-paused') return this.t('sync.cloudPaused');
    if (!result || result.ok !== true) {
      if (result && result.reason === 'account-mismatch') return this.t('sync.accountMismatch');
      if (result && result.reason === 'migration-required') return this.t('sync.migrationRequired');
      if (result && result.reason === 'migration-snapshot-missing') return this.t('sync.migrationSnapshotMissing');
      return this.t('sync.connectionIncomplete');
    }
    if (result.readOnlyPhase) return this.t('sync.readOnly');
    if (result.status === 'migration-required') return this.t('sync.migrationRequired');
    if (result.purchaseRecovery && !result.purchaseRecovery.ok) return this.t('sync.purchasePending');
    if (result.status === 'cloud-pending') return this.t('sync.cloudPending');
    if (result.role === 'SUPPLEMENTAL') {
      return Array.isArray(result.conflicts) && result.conflicts.length
        ? this.t('sync.supplementMergedWithConflicts', { count: result.conflicts.length })
        : this.t('sync.supplementMerged');
    }
    return this.authorityMode(null, 'stamina') === 'cloud-authoritative' &&
      this.authorityMode(null, 'preferences') === 'cloud-authoritative'
      ? this.t('sync.completed') : this.t('sync.completedLocalPreferences');
  }

  retryAccountSync() {
    if (this.accountSyncPending || this.scene !== 'account') return false;
    const token = { generation: this.accountSceneGeneration, account: this.captureAccountContext() };
    this.accountSyncPending = token;
    this.invalidate();
    this.resumeOnline().then(result => {
      if (!this.isCurrentAccount(token.account) || this.accountSyncPending !== token || this.scene !== 'account' || this.hidden) return;
      this.accountSyncPending = null;
      this.accountMessage = this.auth && this.auth.mode === 'cloud' ? this.cloudAccountMessage(result)
        : result.ok ? this.t('sync.done') : result.reason === 'account-mismatch'
          ? this.t('sync.accountMismatch') : this.t('sync.localRetryLater');
      this.invalidate();
    });
    return true;
  }

  runAccountBackupAction(action) {
    if (!this.cloudBackup || this.accountSyncPending || this.scene !== 'account') return false;
    const token = { generation: this.accountSceneGeneration, account: this.captureAccountContext() };
    this.accountSyncPending = token; this.invalidate();
    const task = action === 'restore' ? this.cloudBackup.requestRestore()
      : action === 'confirmRestore' ? this.cloudBackup.confirmRestore() : this.cloudBackup.confirmBackup();
    Promise.resolve(task).then(result => {
      if (!this.isCurrentAccount(token.account) || this.accountSyncPending !== token || this.scene !== 'account' || this.hidden) return;
      this.accountSyncPending = null;
      if (result.ok && result.found) this.accountMessage = this.t('sync.backupFoundDetailed');
      else if (result.ok && result.restored) this.accountMessage = this.t('sync.backupRestored');
      else if (result.ok && result.found === false) this.accountMessage = this.t('sync.noBackup');
      else if (result.reason === 'restore-confirmation-stale') this.accountMessage = this.t('sync.restoreStale');
      else if (result.reason === 'backup-version-conflict') this.accountMessage = this.t('sync.backupVersionConflict');
      else this.accountMessage = this.t('sync.operationFailed');
      this.invalidate();
    }).catch(() => {
      if (this.isCurrentAccount(token.account) && this.accountSyncPending === token) {
        this.accountSyncPending = null; this.accountMessage = this.t('sync.networkUnavailable'); this.invalidate();
      }
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
      const rewardId = `theme:${theme.id}`;
      let reward = this.rewardUnlocks.status(rewardId);
      if (['rewarded_ad', 'share'].includes(reward.conditionType) && this.engagement.rewardUnlockState) {
        reward = this.engagement.rewardUnlockState(rewardId);
      }
      reward.id = rewardId;
      reward.actionEnabled = reward.owned === true || reward.action === 'purchase' || reward.actionEnabled === true;
      if (reward.levelKey) {
        const parts = reward.levelKey.split(':').map(Number);
        reward.displayLevel = this.catalogLevelPosition(parts[0], parts[1]) + 1;
      }
      return Object.assign({}, theme, {
        assetState: state.status,
        assetProgress: state.progress,
        pending: theme.id === this.pendingSkinId,
        reward
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
      const rewardId = `effect:${id}`;
      let reward = this.rewardUnlocks.status(rewardId);
      if (['rewarded_ad', 'share'].includes(reward.conditionType) && this.engagement.rewardUnlockState) {
        reward = this.engagement.rewardUnlockState(rewardId);
      }
      reward.id = rewardId;
      reward.actionEnabled = reward.owned === true || reward.action === 'purchase' || reward.actionEnabled === true;
      if (reward.levelKey) {
        const parts = reward.levelKey.split(':').map(Number);
        reward.displayLevel = this.catalogLevelPosition(parts[0], parts[1]) + 1;
      }
      descriptor.reward = reward;
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
        if (typeof id === 'string' && id) return this.rewardUnlocks.canUse('effect', id) ? id : 'none';
      }
      const current = this.clearEffects && typeof this.clearEffects.current === 'function'
        ? this.clearEffects.current()
        : null;
      const id = current && current.id ? String(current.id) : 'none';
      return this.rewardUnlocks.canUse('effect', id) ? id : 'none';
    } catch (error) {
      return 'none';
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
    if (!plainObject(effect) || !this.rewardUnlocks.canUse('effect', effectId)) effect = DEFAULT_NONE_EFFECT;
    const result = cloneData(effect);
    if (!result.id) result.id = 'none';
    if (!result.type) result.type = 'none';
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
    if (this.blockCoreWriteDuringMigration('preferences')) return false;
    if (!this.clearEffects || typeof this.clearEffects.select !== 'function' ||
        !this.rewardUnlocks.canUse('effect', effectId)) return false;
    let selected = false;
    try {
      selected = this.clearEffects.select(effectId) === true;
    } catch (error) {
      selected = false;
    }
    if (selected) {
      if (this.progressSync && this.preferences) {
        try { this.progressSync.enqueuePreference('clearEffectId', effectId); } catch (error) {}
      }
      this.invalidate();
    }
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

  recoverRewardUnlocks() {
    if (this.syncStore && this.syncStore.currentScope && this.syncStore.currentScope().pendingBackupRestore) {
      return { ok: false, reason: 'restore-pending', amountDelta: 0, newRewards: [], sources: [] };
    }
    const mode = this.authorityMode(this.rewardUnlocks, 'economy');
    if (!['legacy-local', 'local-backup'].includes(mode)) return { ok: false, reason: mode, amountDelta: 0, newRewards: [], sources: [] };
    if (!this.rewardUnlocks) return { ok: false, reason: 'not-configured', amountDelta: 0, newRewards: [] };
    if (!this.rewardUnlocks.view().available) {
      const loaded = this.rewardUnlocks.retryLoad();
      if (!loaded.ok) return Object.assign({ amountDelta: 0, newRewards: [] }, loaded);
    }
    const ordinary = this.progress && typeof this.progress.exportRewardCompletions === 'function'
      ? this.progress.exportRewardCompletions() : { ok: false, reason: 'storage-read-failed' };
    const disabledDailySource = this.productPolicy.dailyCompletionSource();
    const daily = disabledDailySource ||
      (this.dailyProgress && typeof this.dailyProgress.exportRewardCompletions === 'function'
        ? this.dailyProgress.exportRewardCompletions()
        : { ok: false, reason: 'storage-read-failed' });
    if (!ordinary.ok || !daily.ok) return { ok: false, reason: 'source-read-failed', amountDelta: 0, newRewards: [] };
    const result = this.rewardUnlocks.reconcile({ ordinary, daily });
    if (result.ok) {
      if (mode === 'local-backup' && (result.amountDelta > 0 || result.newRewards.length) && this.progressSync) {
        this.progressSync.localChanged();
      }
      // No new grant means "already claimed" only when the persisted
      // snapshot actually contains this result's completed source.
      if (this.result && this.result.currencyReward &&
          ['pending', 'local-save-failed'].includes(this.result.currencyReward.status) && this.runContext) {
        const source = `ordinary:${this.runContext.setIndex}:${this.runContext.levelIndex}`;
        const levelKey = `${this.runContext.setIndex}:${this.runContext.levelIndex}`;
        if (ordinary.levelKeys.includes(levelKey)) {
          const granted = (result.sources || []).includes(source);
          this.result.currencyReward = { status: granted ? 'granted' : 'already-claimed',
            amount: granted ? rewardConfig.currency.ordinaryFirstClear : 0 };
        }
      }
      if (this.daily && this.daily.result && this.daily.result.currencyReward &&
          ['pending', 'local-save-failed'].includes(this.daily.result.currencyReward.status)) {
        const savedDay = daily.days.some(day => day.dateKey === this.daily.dateKey);
        if (savedDay) {
          const granted = (result.sources || []).includes(`daily:${this.daily.dateKey}`);
          this.daily.result.currencyReward = { status: granted ? 'granted' : 'already-claimed',
            amount: granted ? rewardConfig.currency.dailyFirstComplete : 0 };
        }
      }
      this.invalidate();
    }
    return result;
  }

  applyCloudCurrencyResult(target, account, settled) {
    if (!target || !target.currencyReward || target.currencyReward.status !== 'pending' ||
        !this.isCurrentAccount(account) || !settled || settled.status === 'RETRYABLE') return false;
    if (settled.status !== 'ACKED' || !settled.details ||
        typeof settled.details.rewardGranted !== 'boolean' ||
        !Number.isSafeInteger(settled.details.rewardAmount) || settled.details.rewardAmount < 0 ||
        (settled.details.rewardGranted !== (settled.details.rewardAmount > 0))) {
      target.currencyReward = { status: 'failed', amount: 0 };
    } else {
      target.currencyReward = {
        status: settled.details.rewardGranted ? 'granted' : 'already-claimed',
        amount: settled.details.rewardGranted ? settled.details.rewardAmount : 0
      };
    }
    this.invalidate();
    return true;
  }

  openRewardDialog(rewardId, mode) {
    if (typeof rewardId !== 'string') return false;
    const parts = rewardId.split(':');
    const list = parts[0] === 'theme' ? this.themeDescriptors() : this.effectDescriptors();
    const preview = list.find(item => item.id === parts[1]);
    if (!preview) return false;
    const status = preview.reward;
    const unlocked = status.owned === true;
    const externalEnabled = status.conditionType === 'rewarded_ad'
      ? this.productCapabilities.adsEnabled
      : status.conditionType === 'share'
        ? this.productCapabilities.rewardedShareEnabled
        : true;
    const currency = this.rewardDisplayView();
    const balance = Number.isSafeInteger(currency.displayBalance) ? currency.displayBalance : currency.balance;
    const hasPending = Number.isSafeInteger(currency.pendingRewardAmount) && currency.pendingRewardAmount > 0;
    let message = status.conditionType === 'ordinary_level'
      ? this.t('gallery.unlockAtLevel', { level: status.displayLevel || '?' })
      : status.conditionType === 'currency'
        ? this.t(hasPending ? 'reward.currencyUnlockWithPendingBalance' : 'reward.currencyUnlockWithBalance', {
          cost: status.cost,
          balance: balance === null ? '--' : balance,
          pendingAmount: currency.pendingRewardAmount
        })
        : status.conditionType === 'rewarded_ad'
          ? this.t('gallery.unlockWithAds', { count: status.requiredCount || 1 })
          : status.conditionType === 'share' ? this.t('reward.shareUnlockUncertain') : this.t('gallery.unavailable');
    if (status.reason === 'ads-not-enabled') message = this.t('reward.adsDisabled');
    if (status.reason === 'ads-not-configured' || status.reason === 'ads-not-supported') message = this.t('reward.adsUnavailable');
    if (!currency.available) message = this.t('reward.dataUnavailable');
    if (status.action === 'retry-save') message = this.t('reward.pendingSave');
    const titleKey = `${parts[0] === 'theme' ? 'skin' : 'effect'}.${parts[1]}.name`;
    const localizedTitle = this.t(titleKey);
    this.rewardDialog = {
      dialogId: ++this.rewardDialogSequence,
      rewardId,
      mode: unlocked ? 'unlocked' : 'condition',
      conditionType: status.conditionType || null,
      state: 'idle',
      title: localizedTitle === titleKey ? (preview && preview.name ? preview.name : rewardId) : localizedTitle,
      message: unlocked ? this.t('reward.permanentlyUnlocked') : message,
      primaryAction: unlocked ? 'reward:apply' :
        (externalEnabled && ['currency', 'rewarded_ad', 'share'].includes(status.conditionType)
          ? 'reward:unlock' : null),
      primaryLabel: unlocked ? this.t('reward.applyNow') : status.conditionType === 'currency' ? this.t('reward.confirmPurchase')
        : status.conditionType === 'rewarded_ad' ? this.t('reward.watchAd') : status.conditionType === 'share' ? this.t('reward.startShare') : null,
      primaryEnabled: unlocked || (externalEnabled && status.actionEnabled),
      secondaryAction: unlocked ? 'reward:later' : 'reward:close',
      secondaryLabel: unlocked ? this.t('reward.maybeLater') : this.t('common.close'),
      preview
    };
    if (this.rewardDialog.primaryAction && (!currency.available || status.action === 'retry-save')) {
      this.rewardDialog.primaryAction = 'reward:retry';
      this.rewardDialog.primaryLabel = this.t(!currency.available ? 'common.retryRead' : 'common.retrySave');
      this.rewardDialog.primaryEnabled = true;
    }
    if (this.pendingSkinId && this.skins.current().id !== this.pendingSkinId) {
      ++this.skinLoadRequestId;
      this.pendingSkinId = null;
    }
    this.pointer = null;
    this.pressedId = null;
    if (this.boardInput && this.boardInput.isActive()) this.boardInput.cancel(null, 'reward-dialog');
    if (this.renderer) this.renderer.clearInteractionHits();
    this.invalidate();
    return true;
  }

  requestRewardUnlock(retry) {
    if (this.accountGuard && !this.accountGuard.matches(this.captureAccountContext())) return false;
    if (this.blockCoreWriteDuringMigration('economy')) return false;
    const dialog = this.rewardDialog;
    if (!dialog || dialog.state === 'working' || dialog.state === 'loading') return false;
    const rewardId = dialog.rewardId;
    if (retry && !this.rewardUnlocks.view().available) {
      const restored = this.recoverRewardUnlocks();
      this.openRewardDialog(rewardId);
      if (!restored.ok) this.rewardDialog.state = 'error';
      return restored;
    }
    const status = this.rewardUnlocks.status(rewardId);
    if ((status.conditionType === 'rewarded_ad' && !this.productCapabilities.adsEnabled) ||
        (status.conditionType === 'share' && !this.productCapabilities.rewardedShareEnabled)) {
      return false;
    }
    dialog.state = 'working';
    dialog.message = this.t(retry ? 'reward.retryingSave' : 'common.processingEllipsis');
    const generation = ++this.rewardRequestGeneration;
    const account = this.captureAccountContext();
    this.pointer = null;
    this.pressedId = null;
    this.invalidate();
    let task;
    if (status.conditionType === 'currency') {
      const mode = this.authorityMode(this.rewardUnlocks, 'economy');
      if (mode === 'cloud-authoritative' && this.economy) {
        const pendingRewards = () => this.syncStore && this.syncStore.currentScope().pendingOperations.some(item =>
          ['MAIN_LEVEL_COMPLETED', 'DAILY_LEVEL_COMPLETED'].includes(item.type));
        // A purchase is an explicit checkpoint: settle deferred earnings before
        // asking the existing wallet to spend them. Empty queues add no read.
        task = pendingRewards() && this.progressSync ? this.progressSync.flush().then(result => {
          if (!this.isCurrentAccount(account)) return { ok: false, reason: 'account-mismatch', newRewards: [] };
          return result.ok && !pendingRewards() ? this.economy.purchase(rewardId)
            : { ok: false, reason: 'network-required', newRewards: [] };
        }) : this.economy.purchase(rewardId);
      } else task = ['legacy-local', 'local-backup'].includes(mode) ? this.rewardUnlocks.purchase(rewardId)
        : { ok: false, reason: mode, newRewards: [] };
    }
    else if (this.engagement && this.engagement.requestRewardUnlock) {
      task = this.engagement.requestRewardUnlock({ rewardId, scene: this.scene });
    } else task = { ok: false, reason: 'not-configured', newRewards: [] };
    const finish = result => {
      if (!this.isCurrentAccount(account)) return { ok: false, reason: 'stale-account-context', amountDelta: 0, newRewards: [] };
      if (this.disposed || generation !== this.rewardRequestGeneration || !this.rewardDialog ||
          this.rewardDialog.rewardId !== rewardId) return result;
      if (result && result.ok && result.alreadyApplied !== true &&
          this.authorityMode(this.rewardUnlocks, 'economy') === 'local-backup' && this.progressSync) this.progressSync.localChanged();
      if (result && result.ok && result.newRewards && result.newRewards.length) {
        this.openRewardDialog(result.newRewards[0], 'unlocked');
      } else if (result && result.ok && this.rewardUnlocks.canUse(status.kind, status.itemId)) {
        this.openRewardDialog(rewardId, 'unlocked');
      } else if (result && result.ok && status.conditionType === 'rewarded_ad') {
        this.openRewardDialog(rewardId, 'condition');
      } else {
        this.rewardDialog.state = result && result.reason === 'persist-failed' ? 'retry-save' : 'error';
        const messageKey = result && result.reason === 'insufficient-balance' ? 'reward.insufficientBalance'
          : result && result.reason === 'network-required' ? 'reward.purchaseNeedsNetwork'
            : result && result.reason === 'migration-freeze' ? 'reward.purchaseFrozenForMigration'
              : result && result.reason === 'ads-not-enabled' ? 'reward.adsDisabled'
                : result && result.reason === 'closed' ? 'reward.videoIncomplete'
                  : result && result.reason === 'busy' ? 'reward.operationBusy'
                    : result && result.reason === 'persist-failed' ? 'reward.saveFailed' : 'reward.unlockFailed';
        this.rewardDialog.message = this.t(messageKey);
        this.rewardDialog.primaryAction = result && result.reason === 'persist-failed' ? 'reward:retry' : 'reward:unlock';
        this.rewardDialog.primaryLabel = this.t(result && result.reason === 'persist-failed' ? 'common.retrySave' : 'common.retry');
        this.rewardDialog.primaryEnabled = true;
        this.invalidate();
      }
      return result;
    };
    if (task && typeof task.then === 'function') return Promise.resolve(task).then(finish).catch(() => finish({ ok: false, reason: 'unavailable' }));
    return finish(task);
  }

  applyReward() {
    const dialog = this.rewardDialog;
    if (!dialog || !this.rewardUnlocks.owned(dialog.rewardId)) return false;
    const item = this.rewardUnlocks.item(dialog.rewardId);
    if (!item) return false;
    const dialogId = dialog.dialogId;
    if (item.kind === 'effect') {
      const applied = this.setClearEffect(item.itemId);
      if (applied) this.dismissRewardDialog();
      else {
        dialog.state = 'error'; dialog.message = this.t('reward.applySaveFailed'); this.invalidate();
      }
      return applied;
    }
    dialog.state = 'loading';
    dialog.message = this.t('reward.loadingAndApplying');
    const accepted = this.setSkin(item.itemId);
    if (!accepted) {
      dialog.state = 'error'; dialog.message = this.t('reward.applyFailed'); this.invalidate(); return false;
    }
    if (this.pendingSkinId !== item.itemId && this.rewardDialog && this.rewardDialog.dialogId === dialogId) {
      if (this.skins.current().id === item.itemId) this.dismissRewardDialog();
      else { dialog.state = 'error'; dialog.message = this.t('reward.applyFailed'); this.invalidate(); }
    }
    return true;
  }

  dismissRewardDialog() {
    if (!this.rewardDialog) return false;
    if (this.rewardDialog.mode === 'unlocked') {
      this.rewardUnlocks.acknowledgeNotice(this.rewardDialog.rewardId);
      this.dismissedRewardNotices.add(this.rewardDialog.rewardId);
    }
    ++this.rewardRequestGeneration;
    ++this.skinLoadRequestId;
    this.pendingSkinId = null;
    this.rewardDialog = null;
    this.pointer = null;
    this.pressedId = null;
    if (this.renderer) this.renderer.clearInteractionHits();
    this.invalidate();
    return true;
  }

  showNextRewardNotice(now) {
    if (this.disposed || this.hidden || this.rewardDialog || !this.rewardUnlocks ||
        !['home', 'result', 'dailyResult'].includes(this.scene)) return false;
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    if (this.scene === 'result' && this.result && this.result.outcome === OUTCOME.FAILED) return false;
    if (this.scene === 'dailyResult' && this.daily.result && this.daily.result.outcome === OUTCOME.FAILED) return false;
    if (this.scene === 'result' && timestamp < this.resultVisibleAt) return false;
    if (this.scene === 'dailyResult' && timestamp < this.daily.resultVisibleAt) return false;
    const animation = this.scene === 'dailyResult' ? this.daily.clearAnimation : this.clearAnimation;
    if (animation && timestamp < Number(animation.startedAt || 0) + Number(animation.durationMs || 0) + 80) return false;
    const rewardId = this.rewardUnlocks.pendingNotices().find(id =>
      !this.dismissedRewardNotices.has(id) && this.rewardUnlocks.item(id));
    return rewardId ? this.openRewardDialog(rewardId, 'unlocked') : false;
  }

  setSkin(skinId) {
    if (this.blockCoreWriteDuringMigration('preferences')) return false;
    if (typeof skinId !== 'string' || !this.skins.get(skinId) || !this.rewardUnlocks.canUse('theme', skinId)) return false;
    const requestId = ++this.skinLoadRequestId;
    const name = this.subpackages && this.subpackages.packageForTheme(skinId);
    if (name && !this.subpackages.isPackageReady(name)) {
      this.loadSkinPackage(skinId, requestId, true);
      return true;
    }
    this.pendingSkinId = null;
    if (!this.skins.select(skinId)) return false;
    if (this.progressSync && this.preferences) {
      try { this.progressSync.enqueuePreference('skinId', skinId); } catch (error) {}
    }
    this.renderer.invalidateThemeAssets(skinId);
    this.renderer.loadSkinAssets();
    this.invalidate();
    return true;
  }

  prepareCurrentSkinAssets() {
    if (!this.subpackages || this.pendingSkinId) return;
    const skinId = this.skins.current().id;
    if (!this.rewardUnlocks.canUse('theme', skinId)) return;
    const name = this.subpackages.packageForTheme(skinId);
    if (name && !this.subpackages.isPackageReady(name)) {
      // Keep the saved theme's palette for the first frame, without rewriting
      // its setting or waiting for a download before starting gameplay.
      this.loadSkinPackage(skinId, ++this.skinLoadRequestId, false);
    }
  }

  loadSkinPackage(skinId, requestId, selectOnSuccess) {
    const account = this.captureAccountContext();
    const originScene = this.scene;
    const dialogId = this.rewardDialog && this.rewardDialog.dialogId;
    this.pendingSkinId = skinId;
    this.invalidate();
    this.subpackages.ensureTheme(skinId, () => {
      if (this.isCurrentAccount(account) && requestId === this.skinLoadRequestId) this.invalidate();
    }).then(() => {
      if (!this.isCurrentAccount(account) || requestId !== this.skinLoadRequestId) return;
      if (!this.rewardUnlocks.canUse('theme', skinId) ||
          (selectOnSuccess && (originScene !== this.scene || (dialogId && (!this.rewardDialog || this.rewardDialog.dialogId !== dialogId))))) {
        this.pendingSkinId = null;
        this.invalidate();
        return;
      }
      this.pendingSkinId = null;
      const selected = !selectOnSuccess || this.skins.select(skinId);
      if (selectOnSuccess && selected && this.progressSync && this.preferences) {
        try { this.progressSync.enqueuePreference('skinId', skinId); } catch (error) {}
      }
      this.renderer.invalidateThemeAssets(skinId);
      this.renderer.loadSkinAssets();
      if (selectOnSuccess && this.rewardDialog && this.rewardDialog.rewardId === `theme:${skinId}`) {
        if (selected) this.dismissRewardDialog();
        else { this.rewardDialog.state = 'error'; this.rewardDialog.message = this.t('reward.applySaveFailed'); }
      } else if (selectOnSuccess && !selected && this.openRewardDialog(`theme:${skinId}`, 'unlocked')) {
        this.rewardDialog.state = 'error';
        this.rewardDialog.message = this.t('reward.applySaveFailed');
      }
      this.invalidate();
    }).catch(() => {
      if (!this.isCurrentAccount(account)) return;
      // The service exposes a stable failed state. No saved setting changes
      // on failure, and an older download cannot clear the newest pending ID.
      if (requestId === this.skinLoadRequestId) this.pendingSkinId = null;
      if (requestId === this.skinLoadRequestId && this.rewardDialog &&
          this.rewardDialog.rewardId === `theme:${skinId}`) {
        this.rewardDialog.state = 'error';
        this.rewardDialog.message = this.t('reward.assetLoadFailedOwnershipKept');
      }
      this.invalidate();
    });
  }

  enterDaily(now) {
    if (this.blockCoreWriteDuringMigration('daily')) return false;
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
    if (this.blockCoreWriteDuringMigration('daily')) return false;
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

  openIceTrial() {
    const context = createTrialRunContext(iceTrial);
    const runner = context && this.createOrdinaryRunner(context);
    if (!runner || runner.getMechanicState().id !== 'ice') return false;
    this.clearHintRequest();
    this.runContext = context;
    this.runner = runner;
    this.homeStaminaExpanded = false;
    return this.resetCurrentLevel();
  }

  openLevel(setIndex, levelIndex) {
    if (this.blockCoreWriteDuringMigration('progress')) return false;
    const context = createCatalogRunContext(catalog, setIndex, levelIndex);
    if (!context) return false;
    if (!this.progression.isUnlocked(setIndex, levelIndex)) return false;
    const runner = this.createOrdinaryRunner(context);
    if (!runner) return false;
    const now = this.clockNow().getTime();
    // Completed progress can also arrive from cloud sync after construction.
    const levelKey = `${setIndex}:${levelIndex}`;
    const unlocked = this.progress.isCompleted(setIndex, levelIndex)
      ? { ok: true } : this.progressSync && this.progressSync.unlockOrdinaryLevel
        ? this.progressSync.unlockOrdinaryLevel(levelKey, now)
        : this.stamina.unlockOrdinaryLevel(levelKey, now);
    this.refreshStamina(now);
    if (!unlocked.ok) {
      this.showStaminaFeedback(unlocked.reason, now);
      return false;
    }
    this.clearStaminaFeedback();
    this.homeStaminaExpanded = false;
    this.clearHintRequest();
    if (this.scene === 'account') this.leaveAccount();
    this.runContext = context;
    this.setIndex = context.setIndex;
    this.levelIndex = context.levelIndex;
    this.levelPageIndex = this.levelPageForTarget(context);
    // Progress persistence cannot undo an already paid, permanent unlock.
    let progressPersisted = false;
    try {
      this.progress.markOpened(context.setIndex, context.levelIndex);
      progressPersisted = this.progress.save() === true;
    } catch (error) {}
    if (progressPersisted && this.progressSync) {
      try { this.progressSync.enqueueLastPlayed({ setIndex: context.setIndex, levelIndex: context.levelIndex,
        occurredAtClient: now }); } catch (error) {}
    }
    this.runner = runner;
    this.boardInput.setRunner(this.runner);
    this.scene = 'play';
    this.levelEnteredAt = now;
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

  createOrdinaryRunner(context) {
    try {
      return new GameRunner(context.level, context.set.Palette || [], () => this.invalidate());
    } catch (error) {
      return null;
    }
  }

  refreshStamina(now) {
    const next = this.stamina.snapshot(now);
    const second = next.recovering ? Math.ceil(next.remainingMs / 1000) : -1;
    const previous = this.staminaSnapshot;
    const changed = !previous || next.balance !== previous.balance ||
      next.recovering !== previous.recovering || next.persisted !== previous.persisted ||
      second !== this.lastStaminaSecond;
    this.staminaSnapshot = next;
    this.lastStaminaSecond = second;
    if (changed) this.dirty = true;
    if (this.staminaFeedback && now >= this.staminaFeedback.until) this.clearStaminaFeedback();
    return changed;
  }

  recoverStaminaRefunds(now) {
    if (this.authorityMode(this.stamina, 'stamina') !== 'legacy-local') return;
    // A saved fast completion also proves a refund that was interrupted by a
    // failed stamina write or process exit. Spent entitlements cannot repeat.
    catalog.levels.forEach(entry => {
      if (this.progress.isCompleted(entry.setIndex, entry.levelIndex)) {
        const elapsedMs = this.progress.bestTime(entry.setIndex, entry.levelIndex);
        if (Number.isFinite(elapsedMs) && elapsedMs > 0) {
          this.stamina.refundQuickClear(`${entry.setIndex}:${entry.levelIndex}`, elapsedMs, now);
        }
      }
    });
  }

  showStaminaFeedback(reason, now, amount) {
    this.staminaFeedback = { reason, until: now + 2200 };
    if (amount > 0) this.staminaFeedback.amount = amount;
    this.invalidate();
  }

  clearStaminaFeedback() {
    if (!this.staminaFeedback) return;
    this.staminaFeedback = null;
    this.invalidate();
  }

  isHintPreviewActive(now) {
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return !!(this.hintPreview && (this.hintPreview.manual === true || timestamp < this.hintPreview.until));
  }

  changeHintPreviewStep(delta) {
    const preview = this.hintPreview;
    if ((this.scene !== 'play' && this.scene !== 'daily') || !preview || !preview.manual || !Array.isArray(preview.frames) ||
        (delta !== -1 && delta !== 1)) return false;
    const index = clamp(preview.index + delta, 0, preview.frames.length - 1);
    if (index === preview.index) return false;
    preview.index = index;
    this.invalidate();
    return true;
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
      portal.instruction = portalInstructions.initial(this.locale, portal.hasIce);
    }
    if (Array.isArray(hint.steps) && hint.steps.length === lines.length) {
      const frames = hint.steps.map((step, index) => Object.assign({}, viewModel, {
        hintStepLabel: this.t(step.breaksIce && step.clearsIce ? 'play.hintStep.breakAndClearIce'
          : step.breaksIce ? 'play.hintStep.breakIce'
            : step.clearsIce ? 'play.hintStep.clearIce' : 'play.hintStep.connectEndpoints',
        { current: index + 1, total: hint.steps.length }),
        board: Object.assign({}, viewModel.board, {
          cells: viewModel.board.cells.map(cell => Object.assign({}, cell, {
            owner: step.remainingLayers[cell.index] === 0 ? 0 : -1,
            frozen: step.remainingLayers[cell.index] === 2
          })),
          hintUntil: undefined,
          hint: { paths: [cloneData(step.path)], source: 'solution' }
        })
      }));
      return { manual: true, index: 0, frames, viewModel: frames[0] };
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
    this.hintUntil = preview.manual ? 0 : until;
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
    this.hintUntil = preview.manual ? 0 : until;
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
    this.clearFeedback = null;
    this.homeStaminaExpanded = false;
    if (this.stamina.flush(this.clockNow().getTime()) && this.staminaFeedback &&
        this.staminaFeedback.reason === 'refund-persist-failed') this.clearStaminaFeedback();
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
    this.audio.pauseAll('background');
    this.progress.save();
    if (this.progressSync) {
      const sync = this.progressSync.atCheckpoint ? this.progressSync.atCheckpoint('hide') : this.progressSync.flush();
      sync.catch(function () {});
    }
    if (this.behavior) this.behavior.flush('hide').catch(function () {});
  }

  resumeOnline(reason) {
    if (!this.auth) return Promise.resolve({ ok: false, reason: 'not-configured' });
    if (this.auth.mode === 'cloud') {
      // Identity/read-only diagnostics never enter legacy HTTP synchronization,
      // attribution, profile refresh, reward recovery or authoritative apply.
      let account = this.captureAccountContext();
      const run = () => this.auth.ensureSession({ force: !reason || reason === 'launch' || reason === 'show' }).then(result => {
        if (this.disposed || !result.ok) return result;
        account = this.captureAccountContext();
        if (!this.isCurrentAccount(account)) return { ok: false, reason: 'account-mismatch' };
        if (!this.progressSync) return result;
        return this.progressSync.bootstrapCloud(this.auth.current());
      }).then(async result => {
        if (!result.ok || result.readOnlyPhase || !this.economy ||
            this.authorityMode(null, 'economy') !== 'cloud-authoritative' ||
            !this.economy.hasPendingPurchase(this.auth.current())) return result;
        const recovery = await this.economy.recoverPending(this.auth.current());
        if (!this.isCurrentAccount(account)) return { ok: false, reason: 'account-mismatch' };
        return Object.assign({}, result, { purchaseRecovery: recovery });
      }).then(result => {
        if (result.reason !== 'account-mismatch' && this.isCurrentAccount(account)) {
          this.accountMessage = this.cloudAccountMessage(result);
          this.invalidate();
        }
        return result;
      }).catch(() => {
        const result = { ok: false, reason: 'network' };
        if (this.isCurrentAccount(account)) { this.accountMessage = this.cloudAccountMessage(result); this.invalidate(); }
        return result;
      });
      return this.progressSync && this.progressSync.atCheckpoint
        ? this.progressSync.atCheckpoint(reason || 'manual', run) : run();
    }
    let account = this.captureAccountContext();
    const stale = () => ({ ok: false, reason: 'account-mismatch' });
    return this.auth.ensureSession().then(result => {
      const session = this.auth.current && this.auth.current();
      if (!this.isCurrentAccount(account) && !(result.ok && this.acceptsLegacyTransition(account, session && session.userId, false))) return stale();
      account = this.captureAccountContext();
      if (!result.ok) return result;
      if (this.profile) {
        const profileAccount = account;
        Promise.resolve().then(() => this.profile.refresh()).then(() => {
          if (this.isCurrentAccount(profileAccount)) this.invalidate();
        }).catch(function () {});
      }
      const sync = this.progressSync ? this.progressSync.bootstrap(this.auth.current()) : Promise.resolve(result);
      return sync.then(synced => {
        if (!this.isCurrentAccount(account) && !(synced.ok && this.acceptsLegacyTransition(account, session && session.userId, true))) return stale();
        account = this.captureAccountContext();
        if (!this.share) return synced;
        this.share.prepareContext(this.shareContext());
        return this.share.consumePendingAttribution(this.auth.current()).then(() => synced);
      });
    }).then(result => {
      if (!this.isCurrentAccount(account)) return stale();
      return this.recoverDailyRewards().then(() => {
        if (!this.isCurrentAccount(account)) return stale();
        this.invalidate(); return result;
      });
    }).catch(() => ({ ok: false, reason: 'network' }));
  }

  onShow(options) {
    if (this.disposed) return;
    const staminaNow = this.clockNow().getTime();
    this.recoverStaminaRefunds(staminaNow);
    if (this.stamina.flush(staminaNow) && this.staminaFeedback &&
        this.staminaFeedback.reason === 'refund-persist-failed') this.clearStaminaFeedback();
    this.refreshStamina(this.clockNow().getTime());
    this.hidden = false;
    this.recoverRewardUnlocks();
    if (this.share) this.share.captureEntry(options || (this.platform.getEnterOptions ? this.platform.getEnterOptions() : {}));
    const runner = this.activeRunner();
    if (runner) runner.resume();
    this.audio.resumeAll('background');
    this.renderer.ctx = this.platform.context;
    this.invalidate();
    this.startLoop();
    if (this.scene === 'account') this.mountAccountProfile();
    this.resumeOnline('show');
    if (this.behavior) this.behavior.flush('show').catch(function () {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.accountGeneration++;
    if (this.unbindAccount) this.unbindAccount();
    if (this.unbindScope) this.unbindScope();
    ++this.rewardRequestGeneration;
    ++this.skinLoadRequestId;
    if (this.engagement && this.engagement.cancelRewardUnlocks) this.engagement.cancelRewardUnlocks();
    this.clearHintRequest();
    if (this.ads && typeof this.ads.dispose === 'function') this.ads.dispose();
    this.leaveAccount();
    if (this.profile) this.profile.dispose();
    if (this.share) this.share.uninstall();
    if (typeof this.unbindPointer === 'function') this.unbindPointer();
    if (typeof this.unbindLifecycle === 'function') this.unbindLifecycle();
    this.unbindPointer = null;
    this.unbindLifecycle = null;
    this.platform.stopLoop();
    this.audio.dispose();
    this.started = false;
  }
}

ClearedApp.DEFAULT_DAILY_ENTRY_LIMIT = DEFAULT_DAILY_ENTRY_LIMIT;
ClearedApp.THEME_PAGE_SIZE = THEME_PAGE_SIZE;
ClearedApp.CORRIDOR_PAGE_SIZE = CORRIDOR_PAGE_SIZE;
ClearedApp.EFFECT_PAGE_SIZE = EFFECT_PAGE_SIZE;

module.exports = ClearedApp;
