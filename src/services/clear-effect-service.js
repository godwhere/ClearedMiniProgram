const builtInEffects = require('../effects/index.js');
const defaultFade = require('../effects/fade.js');

const DEFAULT_ID = 'fade';
const MIN_DURATION_MS = 80;
const MAX_DURATION_MS = 500;
const MIN_STAGGER_RATIO = 0;
const MAX_STAGGER_RATIO = 0.1;

// Assigning any of these keys to a regular object can mutate its prototype.
// Manifests are external extension data, so reject them at every object level.
const BLOCKED_KEYS = Object.create(null);
BLOCKED_KEYS.__proto__ = true;
BLOCKED_KEYS.constructor = true;
BLOCKED_KEYS.prototype = true;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isSafeKey(key) {
  return typeof key === 'string' && !BLOCKED_KEYS[key];
}

function isPlainObject(value) {
  try {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (error) {
    return false;
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLocalResourcePath(value) {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  if (!path) return false;
  // Runtime assets must be bundled local paths.  Reject protocol, data, and
  // protocol-relative URLs even when a caller attempts to disguise them with
  // whitespace or mixed casing.
  return !/(?:https?|ftp|file|ws|wss|blob):\/\//i.test(path) &&
    !/(?:data|javascript):/i.test(path) &&
    !/\/\//.test(path);
}

function isSafeString(value) {
  if (typeof value !== 'string') return false;
  // Control characters are not useful in a manifest and can make action IDs or
  // logs ambiguous.  Newlines are especially easy to mistake for scripts.
  return !/[\u0000-\u001f\u007f]/.test(value);
}

function isNetworkLikeString(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return /^(?:https?|ftp|file|ws|wss|blob):\/\//i.test(text) ||
    /^(?:data|javascript):/i.test(text) || /^\/\//.test(text);
}

// Validate that a value consists only of JSON-like data.  This check is kept
// separate from manifest normalization so unknown metadata can be rejected
// rather than accidentally retaining a function, platform handle, or cyclic
// object in the service registry.
function isSerializable(value, stack) {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string') return isSafeString(value) && !isNetworkLikeString(value);
  if (valueType === 'boolean') return true;
  if (valueType === 'number') return Number.isFinite(value);
  if (valueType !== 'object') return false;

  const seen = stack || [];
  if (seen.indexOf(value) >= 0) return false;
  seen.push(value);
  let result = false;
  if (Array.isArray(value)) {
    result = true;
    let keys;
    let length;
    try {
      if (Object.getOwnPropertySymbols && Object.getOwnPropertySymbols(value).length) {
        result = false;
      }
      const names = Object.getOwnPropertyNames(value);
      if (names.some(name => name !== 'length' &&
          !Object.prototype.propertyIsEnumerable.call(value, name))) {
        result = false;
      }
      keys = Object.keys(value);
      length = value.length;
    } catch (error) {
      result = false;
      keys = [];
      length = 0;
    }
    // Arrays in a manifest are JSON lists, not extension objects. Reject
    // custom properties (including executable-looking names) and holes so a
    // value cannot hide non-serializable state outside the indexed elements.
    if (result && keys.length !== length) result = false;
    for (let index = 0; result && index < length; index++) {
      if (!hasOwn(value, index) || !isSerializable(value[index], seen)) {
        result = false;
        break;
      }
    }
  } else if (isPlainObject(value)) {
    result = true;
    let keys;
    try {
      // Symbols and non-enumerable properties are not JSON data and are not
      // needed by a manifest.  Reject symbols explicitly so they cannot hide
      // executable or platform state from callers auditing the object.
      if (Object.getOwnPropertySymbols && Object.getOwnPropertySymbols(value).length) {
        result = false;
      }
      const names = Object.getOwnPropertyNames(value);
      if (names.some(name => !Object.prototype.propertyIsEnumerable.call(value, name))) {
        result = false;
      }
      keys = Object.keys(value);
    } catch (error) {
      result = false;
      keys = [];
    }
    if (result) {
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        if (!isSafeKey(key)) {
          result = false;
          break;
        }
        let child;
        try {
          child = value[key];
        } catch (error) {
          result = false;
          break;
        }
        if (!isSerializable(child, seen)) {
          result = false;
          break;
        }
      }
    }
  }
  seen.pop();
  return result;
}

function cloneData(value, stack) {
  if (value === null || typeof value !== 'object') return value;
  const seen = stack || [];
  if (seen.indexOf(value) >= 0) return null;
  seen.push(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map(item => cloneData(item, seen));
  } else if (isPlainObject(value)) {
    result = {};
    Object.keys(value).forEach(key => {
      if (!isSafeKey(key)) return;
      result[key] = cloneData(value[key], seen);
    });
  } else {
    result = null;
  }
  seen.pop();
  return result;
}

function finiteOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

function bounded(value, min, max, fallback) {
  const number = finiteOr(value, fallback);
  if (!isFiniteNumber(number) || number < min || number > max) return fallback;
  return number;
}

function normalizeParams(params, fallback) {
  const source = isPlainObject(params) ? params : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const normalized = {
    alphaFrom: bounded(source.alphaFrom, 0, 1, bounded(base.alphaFrom, 0, 1, 1)),
    alphaTo: bounded(source.alphaTo, 0, 1, bounded(base.alphaTo, 0, 1, 0)),
    scaleFrom: bounded(source.scaleFrom, Number.MIN_VALUE, 100, bounded(base.scaleFrom, Number.MIN_VALUE, 100, 1)),
    scaleTo: bounded(source.scaleTo, Number.MIN_VALUE, 100, bounded(base.scaleTo, Number.MIN_VALUE, 100, 1.14)),
    staggerRatio: bounded(source.staggerRatio, MIN_STAGGER_RATIO, MAX_STAGGER_RATIO,
      bounded(base.staggerRatio, MIN_STAGGER_RATIO, MAX_STAGGER_RATIO, 0))
  };
  return normalized;
}

function normalizeManifest(input, fallback) {
  if (!isPlainObject(input) || !isSerializable(input)) return null;
  if (!hasOwn(input, 'id')) return null;

  let id;
  try { id = input.id; } catch (error) { return null; }
  if (!isSafeString(id) || !id.trim() || !isSafeKey(id) || /\s/.test(id)) return null;

  const base = isPlainObject(fallback) ? fallback : {};
  let name;
  let type;
  let preview;
  let durationMs;
  let params;
  try {
    name = input.name;
    type = input.type;
    preview = input.preview;
    durationMs = input.durationMs;
    params = input.params;
  } catch (error) {
    return null;
  }

  if (name === undefined || name === null) name = base.name;
  if (type === undefined || type === null) type = base.type;
  if (!isSafeString(name) || !name.trim() || !isSafeString(type) || !type.trim()) return null;

  const normalized = {
    id,
    name,
    type
  };

  if (type === 'none') {
    normalized.durationMs = 0;
    normalized.params = {};
  } else {
    // A missing duration is allowed for extension manifests and inherits the
    // default. Explicitly malformed/out-of-range values are normalized to the
    // same safe fallback, never passed to the animation clock.
    const fallbackDuration = bounded(base.durationMs, MIN_DURATION_MS, MAX_DURATION_MS, 300);
    durationMs = bounded(durationMs, MIN_DURATION_MS, MAX_DURATION_MS, fallbackDuration);
    normalized.durationMs = Math.round(durationMs);
    normalized.params = normalizeParams(params, base.params);
  }

  if (hasOwn(input, 'preview')) {
    // An explicit null/invalid preview intentionally means "use the card
    // fallback"; do not silently inherit the fade artwork for another effect.
    if (isLocalResourcePath(preview) && isSafeString(preview)) normalized.preview = preview.trim();
  } else if (id === base.id && isLocalResourcePath(base.preview) && isSafeString(base.preview)) {
    // Only the built-in manifest inherits its own preview.  A newly registered
    // effect without artwork must remain preview-less so the renderer can show
    // its vector fallback instead of incorrectly displaying the fade artwork.
    normalized.preview = base.preview.trim();
  }

  // Preserve a small amount of optional, data-only gallery metadata. Unknown
  // fields are intentionally omitted so executable-looking extension data can
  // never leak through list()/current().
  ['category'].forEach(key => {
    let value;
    try { value = input[key]; } catch (error) { value = undefined; }
    if (value !== undefined && isSafeString(value) && value.trim()) normalized[key] = value;
  });
  let sort;
  try { sort = input.sort; } catch (error) { sort = undefined; }
  if (sort !== undefined && isFiniteNumber(sort)) normalized.sort = sort;

  return normalized;
}

class ClearEffectService {
  constructor(progressStore, effects) {
    this.progressStore = progressStore || {
      getSetting() { return DEFAULT_ID; },
      setSetting() {}
    };
    this.effects = Object.create(null);
    this.effectOrder = [];

    // The built-in index is the single source of truth for gallery order.
    // Register it before extensions so reserved built-in IDs cannot be
    // overwritten by caller-provided manifests.
    const builtIns = Array.isArray(builtInEffects) ? builtInEffects : [];
    builtIns.forEach(effect => this.register(effect));
    // Keep the compatibility fallback available even if the local registry is
    // accidentally incomplete. If present in the index this is a no-op.
    this.register(defaultFade);
    const entries = Array.isArray(effects) ? effects : [];
    entries.forEach(effect => this.register(effect));

    let savedId = DEFAULT_ID;
    try {
      savedId = this.progressStore.getSetting('clearEffectId', DEFAULT_ID);
    } catch (error) {
      savedId = DEFAULT_ID;
    }
    this.currentId = typeof savedId === 'string' && hasOwn(this.effects, savedId)
      ? savedId
      : DEFAULT_ID;
  }

  register(effect) {
    let normalized;
    try {
      normalized = normalizeManifest(effect, defaultFade);
    } catch (error) {
      normalized = null;
    }
    if (!normalized || !isSafeKey(normalized.id) || hasOwn(this.effects, normalized.id)) return false;
    this.effects[normalized.id] = normalized;
    this.effectOrder.push(normalized.id);
    return true;
  }

  current() {
    return cloneData(this.effects[this.currentId] || this.effects[DEFAULT_ID]);
  }

  currentIdValue() {
    return this.currentId;
  }

  get(id) {
    if (typeof id !== 'string' || !hasOwn(this.effects, id)) return null;
    return cloneData(this.effects[id]);
  }

  // Return the resolved manifest even when the requested ID is unknown. This
  // gives animation code one safe, deterministic path for corrupted snapshots.
  resolve(id) {
    return this.get(id) || this.currentFallback();
  }

  currentFallback() {
    return cloneData(this.effects[DEFAULT_ID]);
  }

  select(id) {
    if (typeof id !== 'string' || !hasOwn(this.effects, id)) return false;
    const previous = this.currentId;
    this.currentId = id;
    try {
      const persisted = this.progressStore.setSetting('clearEffectId', id);
      if (persisted === false) {
        this.currentId = previous;
        return false;
      }
    } catch (error) {
      this.currentId = previous;
      return false;
    }
    return true;
  }

  list() {
    return this.effectOrder.map(id => {
      const effect = this.effects[id];
      const item = {
        id: effect.id,
        name: effect.name,
        type: effect.type
      };
      if (effect.preview) item.preview = effect.preview;
      if (effect.category) item.category = effect.category;
      if (effect.sort !== undefined) item.sort = effect.sort;
      return item;
    });
  }
}

ClearEffectService.DEFAULT_ID = DEFAULT_ID;
ClearEffectService.MIN_DURATION_MS = MIN_DURATION_MS;
ClearEffectService.MAX_DURATION_MS = MAX_DURATION_MS;
ClearEffectService.clone = cloneData;
ClearEffectService.normalizeManifest = normalizeManifest;
ClearEffectService.isSerializable = isSerializable;

module.exports = ClearEffectService;
