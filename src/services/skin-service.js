const classic = require('../skins/classic.js');

// Skin manifests are data, but they are assembled from several nested
// sections (assets, semantic colors, tile metadata, and so on). Keep the
// merge operation deliberately data-only: plain objects are merged
// recursively, arrays are replaced and cloned, and prototype-related keys are
// ignored. This gives partial manifests the classic fallback without allowing
// a manifest to mutate the defaults or the service's internal data.
const BLOCKED_KEYS = Object.create(null);
BLOCKED_KEYS.__proto__ = true;
BLOCKED_KEYS.constructor = true;
BLOCKED_KEYS.prototype = true;

function isSafeKey(key) {
  return !BLOCKED_KEYS[key];
}

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const result = {};
    Object.keys(value).forEach(key => {
      if (isSafeKey(key)) result[key] = cloneValue(value[key]);
    });
    return result;
  }
  return value;
}

function mergeValue(base, override) {
  if (override === undefined) return cloneValue(base);
  if (!isPlainObject(base) || !isPlainObject(override)) return cloneValue(override);

  const result = cloneValue(base);
  Object.keys(override).forEach(key => {
    if (!isSafeKey(key)) return;
    const value = override[key];
    // An omitted value and an explicitly undefined value have the same
    // fallback semantics. Null remains an intentional override for scalar or
    // optional metadata fields.
    if (value === undefined) return;
    result[key] = isPlainObject(result[key]) && isPlainObject(value)
      ? mergeValue(result[key], value)
      : cloneValue(value);
  });
  return result;
}

function mergeSkin(base, skin) {
  const merged = mergeValue(base || {}, skin || {});

  // These sections are consumed as maps by the renderer. A malformed null,
  // array, or scalar should not make a partially configured skin crash the
  // game; restore the corresponding classic section instead.
  ['assets', 'colors', 'layout', 'animation', 'setStyles'].forEach(section => {
    if (!isPlainObject(merged[section])) {
      merged[section] = cloneValue((base && isPlainObject(base[section])) ? base[section] : {});
    }
  });

  // tileVisuals is optional. If a custom manifest supplies a malformed value,
  // remove it so the renderer can use its classic tile fallback.
  if (merged.tileVisuals !== undefined && merged.tileVisuals !== null &&
      !isPlainObject(merged.tileVisuals)) {
    delete merged.tileVisuals;
  }
  return merged;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

class SkinService {
  constructor(progressStore, extraSkins, canUse) {
    this.progressStore = progressStore;
    this.canUse = typeof canUse === 'function'
      ? canUse
      : (kind, itemId) => kind === 'theme' && itemId === 'classic';
    // A null-prototype map prevents an id such as "__proto__" from changing
    // lookup semantics while retaining normal Object.keys registration order.
    this.skins = Object.create(null);
    [classic].concat(extraSkins || []).forEach(skin => this.register(skin));
    const savedId = progressStore.getSetting('skinId', 'classic');
    this.currentId = hasOwn(this.skins, savedId) && this.canUse('theme', savedId)
      ? savedId : 'classic';
  }

  register(skin) {
    if (!skin || !skin.id) throw new Error('A skin must have an id');
    const id = String(skin.id);
    if (!isSafeKey(id)) throw new Error('A skin id uses a reserved key');
    const manifest = cloneValue(skin);
    manifest.id = id;
    this.skins[id] = mergeSkin(classic, manifest);
  }

  current() {
    const availableId = hasOwn(this.skins, this.currentId) && this.canUse('theme', this.currentId)
      ? this.currentId : 'classic';
    return this.skins[availableId];
  }

  // Renderer-facing lookup for a registered manifest. Gallery descriptors
  // returned by list() intentionally stay small, while tile previews need the
  // declarative asset/tileVisuals sections for the matching theme.
  get(skinId) {
    return hasOwn(this.skins, skinId) ? this.skins[skinId] : null;
  }

  select(skinId) {
    if (!hasOwn(this.skins, skinId) || !this.canUse('theme', skinId)) return false;
    let persisted = false;
    try { persisted = this.progressStore.setSetting('skinId', skinId) === true; } catch (error) {}
    if (!persisted) return false;
    this.currentId = skinId;
    return true;
  }

  // Return only serializable gallery metadata. In particular, do not expose
  // assets or tileVisuals here: those are renderer-facing implementation data
  // available through current(). Every returned value is newly allocated so
  // callers cannot mutate a registered manifest through the gallery list.
  list() {
    return Object.keys(this.skins).map(id => {
      const skin = this.skins[id];
      const item = {
        id: skin.id,
        name: nonEmptyString(skin.name) || id
      };

      if (skin.category !== undefined && skin.category !== null) {
        const category = nonEmptyString(skin.category);
        if (category) item.category = category;
      }
      if (skin.sort !== undefined && skin.sort !== null) {
        // Keep an explicitly supplied finite numeric sort value (including 0)
        // while avoiding functions/objects leaking into the public descriptor.
        const sort = Number(skin.sort);
        if (Number.isFinite(sort)) item.sort = sort;
      }

      const directPreview = nonEmptyString(skin.preview);
      const assetPreview = skin.assets && nonEmptyString(skin.assets.preview);
      const preview = directPreview || assetPreview;
      if (preview) item.preview = preview;
      return item;
    });
  }

  setStyle(gameSet) {
    const skin = this.current();
    const override = (skin.setStyles && skin.setStyles[gameSet.Name]) || {};
    return {
      background: override.background || gameSet.Color,
      palette: (override.palette || skin.palette || gameSet.Palette || []).slice()
    };
  }
}

// Expose the helper for focused consumers/tests without changing the default
// CommonJS export used by the application.
SkinService.mergeSkin = mergeSkin;

module.exports = SkinService;
