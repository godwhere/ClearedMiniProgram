const InteractionMap = require('./board/interaction-map.js');
const BoardRenderer = require('./board/board-renderer.js');
const PortalOverlay = require('./board/portal-overlay.js');
const portalInstructions = require('./portal-instructions.js');
const accountLayout = require('./account-layout.js');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatStaminaCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function resultRewardFeedback(model, result, claimedText) {
  const reward = result && result.currencyReward;
  if (!reward) return null;
  if (reward.status === 'local-save-failed' || (reward.status === 'pending' &&
      (model.settlementMode !== 'cloud-authoritative' || result.persisted === false))) {
    return { text: '本地保存未成功，点击重试', retry: true };
  }
  if (reward.status === 'granted') return { text: `获得 ${reward.amount} 货币`, retry: false };
  if (reward.status === 'pending') {
    // Display the configured reward, not an unconfirmed wallet credit.
    const amount = model.firstClearRewardAmount;
    return { text: Number.isSafeInteger(amount) && amount > 0 ? `首通奖励 ${amount} 货币` : '首通奖励', retry: false };
  }
  if (reward.status === 'failed') return { text: '奖励未到账', retry: false };
  return { text: claimedText, retry: false };
}

const PLAY_PROMPT_BAND_HEIGHT = 32;
const PLAY_PROMPT_CYCLE_MS = 1800;
const CANVAS_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

class CanvasRenderer {
  constructor(platform, skinService, clearEffects, subpackages) {
    this.platform = platform;
    this.ctx = platform.context;
    this.skinService = skinService;
    this.subpackages = subpackages || null;
    // Read-only effect queries are injected by the app. The renderer never
    // selects effects or writes settings; a missing service simply renders the
    // classic fade fallback for older hosts/tests.
    this.clearEffects = clearEffects || null;
    this.interactionMap = new InteractionMap();
    Object.defineProperties(this, {
      // Temporary compatibility accessors. App and legacy tests still inspect
      // these fields while input ownership moves to BoardInputController.
      hits: {
        configurable: true,
        enumerable: true,
        get: () => this.interactionMap.hits,
        set: value => {
          this.interactionMap.hits = Array.isArray(value) ? value : [];
        }
      },
      boardLayout: {
        configurable: true,
        enumerable: true,
        get: () => this.interactionMap.getBoardLayout(),
        set: value => {
          this.interactionMap.setBoardLayout(value);
        }
      }
    });
    this.images = {};
    // Main-package 128px previews are independent of downloaded board art.
    // Only visible theme cards start requests; results stay cached by source.
    this.previewImages = {};
    this.previewSources = {};
    this.previewLoads = {};
    // Ready tile sheets remain a fallback for missing/invalid small previews.
    this.themeTileImages = {};
    this.themeTileSources = {};
    this.themeTileLoads = {};
    this.effectPreviewImages = {};
    this.effectPreviewSources = {};
    this.effectPreviewLoads = {};
    this.effectSceneGeneration = 0;
    this.lastScene = null;
    this.accountAvatar = null;
    this.assetGeneration = 0;
    this.invalidate = function () {};
    this.portalOverlay = new PortalOverlay({
      platform: this.platform,
      getContext: () => this.ctx,
      getSkin: () => this.skinService.current(),
      drawTile: (...args) => this.drawTile(...args),
      drawImageContain: (...args) => this.drawImageContain(...args),
      roundedRect: (...args) => this.roundedRect(...args),
      invalidate: () => this.invalidate()
    });
    this.boardRenderer = new BoardRenderer({
      getSkin: () => this.skinService.current(),
      getContext: () => this.ctx,
      clearEffects: this.clearEffects,
      drawTile: (...args) => this.drawTile(...args),
      drawBlockedCell: (...args) => this.drawBlockedCell(...args),
      text: (...args) => this.text(...args),
      renderClearAnimation: (animation, palette, now, gap, layout, portalCells) => (
        this.drawClearAnimation(animation, palette, now, gap, portalCells)
      ),
      portalOverlay: this.portalOverlay
    });
    this.loadSkinAssets();
  }

  setInvalidate(callback) {
    this.invalidate = callback || function () {};
  }

  invalidateEffectPreviews() {
    // A scene transition can happen between two animation frames. Bump the
    // generation immediately so a callback that arrives before the next
    // render cannot commit an image for a page that is no longer visible.
    this.effectSceneGeneration += 1;
  }

  loadSkinAssets() {
    const generation = ++this.assetGeneration;
    const skinId = this.skinService.current().id;
    this.images = {};
    const assets = this.skinService.current().assets || {};
    Object.keys(assets).forEach(name => {
      // Gallery previews load only when their cards are visible, never as
      // part of preparing a selected theme's board assets.
      if (name === 'preview' || name === 'previewImage' || name === 'themePreview') return;
      if (typeof assets[name] !== 'string' || !assets[name]) return;
      if (!this.isAssetReady(assets[name])) return;
      try {
        this.platform.createImage(assets[name], (error, image) => {
          if (generation !== this.assetGeneration || this.skinService.current().id !== skinId) return;
          if (!error && image) this.images[name] = image;
          this.invalidate();
        });
      } catch (error) {
        // Image creation/decoding failure leaves the existing color fallback.
      }
    });
  }

  isAssetReady(source) {
    return !this.subpackages || this.subpackages.isAssetReady(source);
  }

  invalidateThemeAssets(themeId) {
    const id = String(themeId);
    delete this.themeTileImages[id];
    delete this.themeTileSources[id];
    delete this.themeTileLoads[id];
    // Download/selection changes board art only. Preview path changes are
    // handled by ensurePreviewImage; keep loaded small images on screen.
    if (id === this.skinService.current().id) {
      ++this.assetGeneration;
      this.images = {};
    }
  }

  render(model, now) {
    const feedback = model && model.clearFeedback;
    const gameplay = model && ['play', 'result', 'daily', 'dailyResult'].includes(model.scene);
    const elapsed = feedback ? now - feedback.startedAt : -1;
    const duration = feedback && Number(feedback.durationMs);
    const active = gameplay && elapsed >= 0 && duration > 0 && elapsed < duration;
    const progress = active ? elapsed / duration : 1;
    // Logical pixels, independent of DPR. Horizontal-only feedback preserves
    // the vertical safe area; layout and touch coordinates remain stable.
    const amplitude = Math.min(3, this.platform.metrics.width * 0.008);
    this.clearFeedbackOffset = active
      ? Math.cos(progress * Math.PI * 6) * amplitude * (1 - progress) : 0;
    this.ctx.save();
    try {
      if (this.clearFeedbackOffset) this.ctx.translate(this.clearFeedbackOffset, 0);
      this.renderScene(model, now);
    } finally {
      this.ctx.restore();
      this.clearFeedbackOffset = 0;
    }
  }

  renderScene(model, now) {
    const scene = model && model.scene;
    if (scene !== this.lastScene) {
      this.lastScene = scene;
      // Invalidate outstanding effect preview callbacks whenever the page is
      // left/re-entered. A late image may still be cached for that source, but
      // it must not invalidate or overwrite a newer page generation.
      this.effectSceneGeneration += 1;
    }
    switch (model.scene) {
      case 'account':
        this.drawAccount(model);
        break;
      case 'levels':
        this.drawLevels(model, now);
        break;
      case 'play':
      case 'result':
        this.drawPlay(model, now);
        break;
      case 'daily':
      case 'dailyResult':
        this.drawDaily(model, now);
        break;
      case 'themes':
        this.drawThemes(model, now);
        break;
      case 'corridor':
        this.drawCorridor(model, now);
        break;
      case 'effects':
        this.drawEffects(model, now);
        break;
      default:
        this.drawHome(model, now);
        break;
    }
    this.drawStaminaFeedback(model, now);
    if (model.rewardDialog) this.drawRewardDialog(model);
  }

  begin(background) {
    this.sceneBackground = background;
    const { width, height } = this.platform.metrics;
    const ctx = this.ctx;
    ctx.save();
    // Clear the complete, unshifted viewport to avoid edge trails while shaking.
    if (this.clearFeedbackOffset) ctx.translate(-this.clearFeedbackOffset, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    this.interactionMap.clear();
  }

  addHit(id, rect, enabled) {
    return this.interactionMap.add(id, rect, enabled);
  }

  hitTest(x, y) {
    return this.interactionMap.hitTest(x, y);
  }

  cellAt(x, y) {
    return this.interactionMap.cellAt(x, y);
  }

  getBoardLayout() {
    return this.interactionMap.getBoardLayout();
  }

  setBoardLayout(layout) {
    return this.interactionMap.setBoardLayout(layout);
  }

  clearInteractionMap() {
    this.interactionMap.clear();
  }

  clearInteractionHits() {
    this.interactionMap.clearHits();
  }

  roundedRect(x, y, width, height, radius) {
    const ctx = this.ctx;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  text(value, x, y, size, options) {
    const ctx = this.ctx;
    const opts = options || {};
    ctx.save();
    ctx.fillStyle = opts.color || this.skinService.current().colors.text;
    ctx.font = `${opts.weight || 300} ${size}px ${CANVAS_FONT_FAMILY}`;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'middle';
    ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    if (opts.maxWidth) ctx.fillText(String(value), x, y, opts.maxWidth);
    else ctx.fillText(String(value), x, y);
    ctx.restore();
  }

  button(id, rect, label, options, pressedId) {
    const skin = this.skinService.current();
    const opts = options || {};
    const enabled = opts.enabled !== false;
    const pressed = id === pressedId;
    const opacity = opts.opacity === undefined ? 1 : clamp(Number(opts.opacity) || 0, 0, 1);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = (enabled ? 1 : 0.32) * opacity;
    this.roundedRect(rect.x, rect.y, rect.w, rect.h, opts.radius || skin.layout.buttonRadius);
    ctx.fillStyle = pressed
      ? skin.colors.levelCellPressed
      : (opts.fill || skin.colors.levelCell);
    ctx.fill();
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    let fontSize = opts.fontSize || 18;
    const weight = opts.weight || 400;
    const labelText = String(label);
    let labelX = rect.x + rect.w / 2;
    let labelMaxWidth;
    if (opts.icon) {
      // Center icon + measured label as one group. The hint button changes
      // from two to four CJK characters while keeping the same touch target.
      let labelWidth = labelText.length * fontSize;
      ctx.save();
      ctx.font = `${weight} ${fontSize}px ${CANVAS_FONT_FAMILY}`;
      try {
        const measured = typeof ctx.measureText === 'function' ? ctx.measureText(labelText) : null;
        if (measured && Number.isFinite(measured.width) && measured.width > 0) {
          labelWidth = measured.width;
        }
      } catch (error) {
        // Older hosts/tests may not measure text; one em per character is a
        // conservative fallback for the current Chinese action labels.
      }
      ctx.restore();
      const iconSize = fontSize * 1.25;
      const gap = labelText ? 8 : 0;
      const contentWidth = iconSize + gap + labelWidth;
      const scale = Math.min(1, Math.max(1, rect.w - 24) / contentWidth);
      const fittedIconSize = iconSize * scale;
      labelMaxWidth = labelWidth * scale;
      fontSize *= scale;
      const contentLeft = rect.x + (rect.w - contentWidth * scale) / 2;
      labelX = contentLeft + fittedIconSize + gap * scale + labelMaxWidth / 2;
      ctx.save();
      ctx.globalAlpha = (enabled ? 1 : 0.5) * opacity;
      this.drawIcon(opts.icon, contentLeft + fittedIconSize / 2,
        rect.y + rect.h / 2, fittedIconSize);
      ctx.restore();
    }
    this.text(labelText, labelX, rect.y + rect.h / 2, fontSize, {
      weight,
      alpha: (enabled ? 1 : 0.5) * opacity,
      maxWidth: labelMaxWidth
    });
    this.addHit(id, rect, enabled);
  }

  /**
   * Return the preview source declared by a theme manifest.  The manifest is
   * intentionally data-only, so this method accepts both the short
   * `preview: '...'` form and the asset-map form used by the skin service.
   */
  previewSource(theme) {
    if (!theme) return null;
    if (theme.preview && typeof theme.preview === 'object') {
      // Accept an already-created image object, while still handling a
      // declarative `{ src: '...' }` descriptor without passing it to canvas
      // as if it were an image.
      if (typeof theme.preview.src === 'string' &&
          !this.imageSize(theme.preview).width) return theme.preview.src;
      return theme.preview;
    }
    if (typeof theme.preview === 'string' && theme.preview) return theme.preview;
    const assets = theme.assets || {};
    return assets.preview || assets.previewImage || assets.themePreview || null;
  }

  /**
   * Lazily load a gallery preview.  Each request gets its own token; a late
   * callback can therefore never replace a newer request for the same theme.
   * Failed requests are memoized as null until the declared source changes,
   * which avoids starting an image request on every render frame.
   */
  ensurePreviewImage(theme) {
    if (!theme || !theme.id) return null;
    const id = String(theme.id);
    const source = this.previewSource(theme);
    if (source && typeof source !== 'string') return source;
    if (source && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source.trim())) return null;

    // A selected theme's preview may already have been loaded as one of its
    // regular assets by loadSkinAssets().
    if (!source && id === this.skinService.current().id && this.images.preview) {
      return this.images.preview;
    }
    if (!source) return null;
    if (!this.isAssetReady(source)) return null;

    // Preserve compatibility with hosts that supply a preview in the selected
    // skin's image map, though gallery previews normally load independently.
    if (id === this.skinService.current().id) {
      const currentAssets = this.skinService.current().assets || {};
      const previewKey = Object.keys(currentAssets).find(name =>
        (name === 'preview' || name === 'previewImage' || name === 'themePreview') &&
        currentAssets[name] === source);
      if (previewKey && this.images[previewKey]) return this.images[previewKey];
    }

    const active = this.previewLoads[id];
    // A manifest can switch back to its cached source while another is in
    // flight. Cancel that request's ownership before returning the cache.
    if (active && active.source !== source) delete this.previewLoads[id];
    if (this.previewSources[id] === source &&
        Object.prototype.hasOwnProperty.call(this.previewImages, id)) {
      return this.previewImages[id];
    }
    if (active && active.source === source) return null;

    const request = { source };
    this.previewLoads[id] = request;
    try {
      this.platform.createImage(source, (error, image) => {
        // The theme may have been re-described (or a newer request may have
        // started) while this image was loading.
        if (this.previewLoads[id] !== request) return;
        this.previewSources[id] = source;
        this.previewImages[id] = error || !image ? null : image;
        delete this.previewLoads[id];
        this.invalidate();
      });
    } catch (error) {
      if (this.previewLoads[id] === request) {
        this.previewSources[id] = source;
        this.previewImages[id] = null;
        delete this.previewLoads[id];
        this.invalidate();
      }
    }
    // Some hosts complete synchronously; they can draw this same frame.
    return this.previewSources[id] === source &&
      Object.prototype.hasOwnProperty.call(this.previewImages, id)
      ? this.previewImages[id] : null;
  }

  imageSize(image) {
    if (!image) return { width: 0, height: 0 };
    return {
      width: Number(image.width || image.naturalWidth || image.videoWidth || 0),
      height: Number(image.height || image.naturalHeight || image.videoHeight || 0)
    };
  }

  drawImageContain(image, rect, options) {
    if (!image || !this.ctx || typeof this.ctx.drawImage !== 'function') return false;
    const opts = options || {};
    const dimensions = this.imageSize(image);
    const iw = dimensions.width;
    const ih = dimensions.height;
    // Some test doubles and a few canvas implementations do not expose the
    // intrinsic dimensions.  A direct draw still works for a normal image;
    // sprite sheets are handled separately where dimensions are required.
    if (!(iw > 0 && ih > 0)) {
      if (opts.allowUnknownSize === false) return false;
      this.ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
      return true;
    }
    const fit = opts.fit || 'contain';
    const ratio = fit === 'cover'
      ? Math.max(rect.w / iw, rect.h / ih)
      : Math.min(rect.w / iw, rect.h / ih);
    const dw = iw * ratio;
    const dh = ih * ratio;
    this.ctx.drawImage(image, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
    return true;
  }

  tileVisualConfig(skin) {
    const raw = (skin && skin.tileVisuals) || {};
    const nested = raw.spriteSheet && typeof raw.spriteSheet === 'object' ? raw.spriteSheet : {};
    return Object.assign({}, raw, nested);
  }

  tileFallbackColor(skin, lineIndex, explicitColor, explicitPalette) {
    if (explicitColor) return explicitColor;
    const visuals = this.tileVisualConfig(skin);
    const colors = visuals.fallbackColors || visuals.colors || visuals.palette;
    if (Array.isArray(colors) && colors.length && lineIndex >= 0) {
      return colors[lineIndex % colors.length] || (skin && skin.colors && skin.colors.emptyCell);
    }
    if (colors && typeof colors === 'object' && lineIndex >= 0) {
      const value = colors[lineIndex] || colors[String(lineIndex)];
      if (value) return value;
    }
    const palette = explicitPalette || (skin && skin.palette);
    if (Array.isArray(palette) && palette.length && lineIndex >= 0) {
      return palette[lineIndex % palette.length] || (skin.colors && skin.colors.emptyCell);
    }
    return (skin && skin.colors && skin.colors.emptyCell) || '#ffffff';
  }

  tileImageForLine(skin, lineIndex, images) {
    const visuals = this.tileVisualConfig(skin);
    const variants = visuals.variants || visuals.images;
    let assetName = visuals.asset || visuals.image || visuals.sheet;
    if (Array.isArray(variants) && variants.length && lineIndex >= 0) {
      assetName = variants[lineIndex % variants.length];
    } else if (variants && typeof variants === 'object' && lineIndex >= 0) {
      assetName = variants[lineIndex] || variants[String(lineIndex)] || assetName;
    }
    if (!assetName) return null;
    if (typeof assetName !== 'string') return assetName;
    const imageMap = images || this.images;
    if (imageMap[assetName]) return imageMap[assetName];
    const assets = (skin && skin.assets) || {};
    const key = Object.keys(assets).find(name => assets[name] === assetName);
    return key ? imageMap[key] : null;
  }

  tileBackgroundStyle(skin, visuals, options) {
    const opts = options || {};
    if (opts.background === false || visuals.background === false ||
        opts.backgroundColor === false || visuals.backgroundColor === false) return null;

    let value = opts.backgroundColor;
    if (value === undefined) value = visuals.backgroundColor;
    if (value === undefined) value = visuals.background;
    if (value === undefined) value = skin && skin.colors && skin.colors.emptyCell;

    let alpha = opts.backgroundAlpha;
    if (alpha === undefined) alpha = visuals.backgroundAlpha;
    if (alpha === undefined) alpha = 1;

    if (value && typeof value === 'object') {
      if (value.color !== undefined) value = value.color;
      if (value.alpha !== undefined && opts.backgroundAlpha === undefined &&
          visuals.backgroundAlpha === undefined) alpha = value.alpha;
    }
    // Allow a manifest to name a semantic token (for example `emptyCell`) or
    // provide a literal CSS color.  Invalid values fall back to the classic
    // translucent tile token rather than leaking a token name to Canvas.
    if (typeof value === 'string' && skin && skin.colors && skin.colors[value]) {
      value = skin.colors[value];
    }
    if (typeof value !== 'string' || !value) {
      value = skin && skin.colors && skin.colors.emptyCell;
    }
    if (typeof value !== 'string' || !value) return null;
    alpha = Number(alpha);
    if (!Number.isFinite(alpha)) alpha = 1;
    alpha = clamp(alpha, 0, 1);
    return { color: value, alpha };
  }

  /**
   * Draw one logical board tile.  All board states (fixed endpoint, selected
   * path, hint and clear animation) use this adapter, so a manifest can swap
   * a color fill for a sprite sheet without changing game geometry or rules.
   */
  drawTile(lineIndex, x, y, size, options) {
    const opts = options || {};
    const skin = opts.skin || this.skinService.current();
    const ctx = this.ctx;
    const alpha = opts.alpha === undefined ? 1 : opts.alpha;
    const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    const drawSize = Math.max(0, size * scale);
    const drawX = x - (drawSize - size) / 2;
    const drawY = y - (drawSize - size) / 2;
    const color = this.tileFallbackColor(skin, lineIndex, opts.color, opts.palette);
    const visuals = this.tileVisualConfig(skin);
    const visualScale = Number(visuals.scale) > 0 ? Number(visuals.scale) : 1;
    const imageSize = drawSize * visualScale;
    const imageX = drawX + (drawSize - imageSize) / 2;
    const imageY = drawY + (drawSize - imageSize) / 2;
    let drawn = false;

    ctx.save();
    ctx.globalAlpha = alpha;

    const image = lineIndex >= 0 ? this.tileImageForLine(skin, lineIndex, opts.images) : null;
    const type = visuals.type || (visuals.columns ? 'spriteSheet' : '');
    // Image-backed themes retain the same translucent square tile that the
    // classic renderer shows beneath a color block. Draw it before the
    // transparent theme art so the board grid remains visible around every
    // endpoint/path tile. Color-only classic tiles keep their old behavior.
    const background = image ? this.tileBackgroundStyle(skin, visuals, opts) : null;
    if (background && typeof ctx.fillRect === 'function') {
      ctx.globalAlpha = alpha * background.alpha;
      ctx.fillStyle = background.color;
      ctx.fillRect(drawX, drawY, drawSize, drawSize);
      ctx.globalAlpha = alpha;
    }
    if (image && typeof ctx.drawImage === 'function' && type === 'spriteSheet') {
      const dimensions = this.imageSize(image);
      const columns = Math.max(1, Number(visuals.columns) || 1);
      const rows = Math.max(1, Number(visuals.rows) || 1);
      const count = Math.max(1, Number(visuals.count) || columns * rows);
      if (dimensions.width > 0 && dimensions.height > 0) {
        const frame = ((lineIndex % count) + count) % count;
        const sourceWidth = dimensions.width / columns;
        const sourceHeight = dimensions.height / rows;
        const sourceX = (frame % columns) * sourceWidth;
        const sourceY = Math.floor(frame / columns) * sourceHeight;
        const padding = Math.max(0, Number(visuals.padding) || 0);
        const target = Math.max(1, imageSize - padding * 2);
        const fit = visuals.fit || 'contain';
        const ratio = fit === 'cover'
          ? Math.max(target / sourceWidth, target / sourceHeight)
          : Math.min(target / sourceWidth, target / sourceHeight);
        const dw = sourceWidth * ratio;
        const dh = sourceHeight * ratio;
        try {
          ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight,
            imageX + padding + (target - dw) / 2,
            imageY + padding + (target - dh) / 2,
            dw, dh);
          drawn = true;
        } catch (error) {
          drawn = false;
        }
      }
    } else if (image && typeof ctx.drawImage === 'function' && type !== 'spriteSheet') {
      try {
        drawn = this.drawImageContain(image, { x: imageX, y: imageY, w: imageSize, h: imageSize }, {
          fit: visuals.fit || 'contain'
        });
      } catch (error) {
        drawn = false;
      }
    }

    if (!drawn && typeof ctx.fillRect === 'function') {
      ctx.fillStyle = color;
      ctx.fillRect(drawX, drawY, drawSize, drawSize);
    }

    const overlay = opts.overlay;
    if (overlay && typeof ctx.fillRect === 'function') {
      const overlayColor = typeof overlay === 'string' ? overlay : overlay.color;
      const overlayAlpha = typeof overlay === 'object' && overlay.alpha !== undefined
        ? overlay.alpha
        : 1;
      if (overlayColor) {
        ctx.globalAlpha = alpha * overlayAlpha;
        ctx.fillStyle = overlayColor;
        ctx.fillRect(drawX, drawY, drawSize, drawSize);
      }
    }
    if (opts.stroke && typeof ctx.strokeRect === 'function') {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.lineWidth || 1;
      ctx.strokeRect(drawX, drawY, drawSize, drawSize);
    }
    ctx.restore();
    return drawn;
  }

  iconButton(id, rect, icon, enabled, pressedId) {
    const ctx = this.ctx;
    const pressed = id === pressedId;
    ctx.save();
    ctx.globalAlpha = enabled === false ? 0.22 : (pressed ? 0.62 : 0.9);
    if (pressed) {
      this.roundedRect(rect.x, rect.y, rect.w, rect.h, 8);
      ctx.fillStyle = this.skinService.current().colors.controlPressed;
      ctx.fill();
    }
    this.drawIcon(icon, rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(rect.w, rect.h) * 0.48);
    ctx.restore();
    this.addHit(id, rect, enabled !== false);
  }

  drawIcon(type, x, y, size) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = this.skinService.current().colors.icon;
    ctx.fillStyle = this.skinService.current().colors.icon;
    ctx.lineWidth = Math.max(2, size * 0.11);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    if (type === 'back' || type === 'next') {
      const direction = type === 'back' ? -1 : 1;
      ctx.moveTo(-direction * size * 0.34, -size * 0.42);
      ctx.lineTo(direction * size * 0.12, 0);
      ctx.lineTo(-direction * size * 0.34, size * 0.42);
      ctx.stroke();
    } else if (type === 'stamina') {
      ctx.moveTo(size * 0.10, -size * 0.50);
      ctx.lineTo(-size * 0.30, size * 0.05);
      ctx.lineTo(-size * 0.02, size * 0.05);
      ctx.lineTo(-size * 0.16, size * 0.50);
      ctx.lineTo(size * 0.34, -size * 0.10);
      ctx.lineTo(size * 0.05, -size * 0.10);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'reset') {
      ctx.arc(0, 0, size * 0.34, -Math.PI * 0.5, Math.PI * 1.32);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.34, -size * 0.24);
      ctx.lineTo(-size * 0.46, size * 0.05);
      ctx.lineTo(-size * 0.16, size * 0.02);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'undo') {
      ctx.moveTo(size * 0.38, size * 0.26);
      ctx.quadraticCurveTo(size * 0.22, -size * 0.28, -size * 0.23, -size * 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.18, -size * 0.4);
      ctx.lineTo(-size * 0.43, -size * 0.1);
      ctx.lineTo(-size * 0.08, -size * 0.04);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'check') {
      ctx.moveTo(-size * 0.42, 0);
      ctx.lineTo(-size * 0.1, size * 0.3);
      ctx.lineTo(size * 0.46, -size * 0.34);
      ctx.stroke();
    } else if (type === 'warning') {
      ctx.arc(0, 0, size * 0.43, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.22);
      ctx.lineTo(0, size * 0.08);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, size * 0.24, Math.max(1.5, size * 0.045), 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'home') {
      ctx.moveTo(-size * 0.42, -size * 0.02);
      ctx.lineTo(0, -size * 0.4);
      ctx.lineTo(size * 0.42, -size * 0.02);
      ctx.moveTo(-size * 0.3, -size * 0.08);
      ctx.lineTo(-size * 0.3, size * 0.38);
      ctx.lineTo(size * 0.3, size * 0.38);
      ctx.lineTo(size * 0.3, -size * 0.08);
      ctx.stroke();
    } else if (type === 'lock') {
      ctx.arc(0, -size * 0.12, size * 0.24, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(-size * 0.34, -size * 0.08, size * 0.68, size * 0.48);
    } else if (type === 'sound' || type === 'mute') {
      ctx.fillRect(-size * 0.43, -size * 0.14, size * 0.18, size * 0.28);
      ctx.beginPath();
      ctx.moveTo(-size * 0.25, -size * 0.14);
      ctx.lineTo(-size * 0.03, -size * 0.36);
      ctx.lineTo(-size * 0.03, size * 0.36);
      ctx.lineTo(-size * 0.25, size * 0.14);
      ctx.closePath();
      ctx.fill();
      if (type === 'sound') {
        ctx.beginPath();
        ctx.arc(-size * 0.01, 0, size * 0.36, -Math.PI * 0.55, Math.PI * 0.55);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(size * 0.08, -size * 0.30);
        ctx.lineTo(size * 0.42, size * 0.30);
        ctx.stroke();
      }
    } else if (type === 'hint') {
      ctx.arc(0, -size * 0.08, size * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.14, size * 0.24);
      ctx.lineTo(size * 0.14, size * 0.24);
      ctx.moveTo(-size * 0.10, size * 0.38);
      ctx.lineTo(size * 0.10, size * 0.38);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.56);
      ctx.lineTo(0, -size * 0.42);
      ctx.moveTo(-size * 0.42, -size * 0.38);
      ctx.lineTo(-size * 0.32, -size * 0.28);
      ctx.moveTo(size * 0.42, -size * 0.38);
      ctx.lineTo(size * 0.32, -size * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawStaminaStatus(stamina, rect, options) {
    if (!stamina || !stamina.enabled) return;
    const compact = options && options.compact;
    const detailsBelow = options && options.detailsBelow;
    const center = rect.x + rect.w / 2;
    const mainY = rect.y + (detailsBelow || (options && options.showDetail === false) ? rect.h / 2 : 12);
    this.drawIcon('stamina', center - 18, mainY, compact ? 22 : 24);
    this.text(String(stamina.balance), center - 4, mainY, compact ? 17 : 20,
      { weight: 500, align: 'left', maxWidth: Math.max(1, rect.w / 2) });
    if (options && options.showDetail === false) return;
    const label = stamina.balance >= stamina.naturalCap ? '体力已满' : formatStaminaCountdown(stamina.remainingMs);
    this.text(label, center, rect.y + (detailsBelow ? rect.h + 10 : 33), compact ? 10 : 11,
      { alpha: 0.78, maxWidth: Math.max(1, rect.w - 4) });
  }

  drawStaminaFeedback(model, now) {
    const feedback = model.staminaFeedback;
    if (!feedback || now >= feedback.until) return;
    const skin = this.skinService.current();
    const { width, safeBottom } = this.platform.metrics;
    const stamina = model.stamina;
    const label = feedback.reason === 'quick-clear-refund' ? `1分钟内通关，体力 +${feedback.amount}`
      : feedback.reason === 'refund-persist-failed' ? '体力返还待保存'
      : feedback.reason === 'persist-failed' ? '体力状态保存失败，请重试'
      : stamina && stamina.recovering && Number.isFinite(stamina.remainingMs)
        ? `体力不足，${formatStaminaCountdown(stamina.remainingMs)} 后恢复 1 点`
        : '体力不足，请稍后再试';
    const boxWidth = Math.min(320, width - 32);
    const y = safeBottom - 106;
    this.ctx.save();
    this.roundedRect((width - boxWidth) / 2, y, boxWidth, 42, 8);
    this.ctx.fillStyle = skin.colors.strongPanel;
    this.ctx.fill();
    this.ctx.restore();
    this.text(label, width / 2, y + 21, 14, { maxWidth: boxWidth - 20 });
  }

  drawHome(model) {
    const skin = this.skinService.current();
    const { width, height, safeTop, safeBottom } = this.platform.metrics;
    const ctx = this.ctx;
    this.begin(skin.colors.homeBackground);
    const topUi = safeTop + (skin.layout.homeTopUiOffset || 0) + 8;
    const staminaRect = { x: width - 78, y: topUi, w: 64, h: 44 };
    const currencyWidth = clamp(width * 0.2, 62, 78);
    const currencyRect = { x: staminaRect.x - currencyWidth - 6, y: topUi, w: currencyWidth, h: 44 };
    this.iconButton('home:sound', { x: currencyRect.x - 50, y: topUi, w: 44, h: 44 },
      model.soundEnabled ? 'sound' : 'mute', true, model.pressedId);
    this.drawHomeAvatar(model.accountProfile,
      { x: 18, y: topUi, w: 44, h: 44 }, model.pressedId);
    if (model.stamina && model.stamina.enabled) {
      if (model.pressedId === 'home:stamina') {
        ctx.save();
        this.roundedRect(staminaRect.x, staminaRect.y, staminaRect.w, staminaRect.h, 8);
        ctx.fillStyle = skin.colors.controlPressed;
        ctx.fill();
        ctx.restore();
      }
      this.drawStaminaStatus(model.stamina, staminaRect,
        { compact: true, detailsBelow: true, showDetail: model.homeStaminaExpanded === true });
      this.addHit('home:stamina', staminaRect, true);
    }
    this.drawCurrency(model.currency, currencyRect);
    if (!model.currency || model.currency.available !== true) {
      this.addHit('reward:retry', currencyRect, true);
      this.text('点击重试', currencyRect.x + currencyRect.w / 2, currencyRect.y + currencyRect.h + 8,
        9, { alpha: 0.56 });
    }

    const buttonHeight = 54;
    const buttonGap = 12;
    // The home actions use a two-row composition: daily challenge and themes
    // share the first row, while the resume/start action spans the second row.
    // Keep the geometry explicit so hit regions and rendering stay in lockstep
    // across screen sizes and safe-area insets.
    const buttonStackHeight = buttonHeight * 2 + buttonGap + (model.dailyExtraEntryAvailable ? 52 : 0);
    const configuredBottomInset = skin.layout && skin.layout.homeButtonBottomInset;
    const buttonBottomInset = Number.isFinite(Number(configuredBottomInset))
      ? Math.max(0, Number(configuredBottomInset))
      : 40;
    const firstY = safeBottom - buttonStackHeight - buttonBottomInset;

    // Keep the available logo area responsive with the three home actions.
    // Preserve the familiar composition on normal devices, but shift
    // the logo upward (and only then scale it down) so its caption
    // never collides with the button stack.
    let logoSize = Math.min(width * 0.58, height * 0.32, 260);
    const logoBottomLimit = firstY - 18;
    const usableTop = safeTop + 12;
    let logoY = safeTop + (safeBottom - safeTop) * 0.38;
    const minLogoY = usableTop + logoSize / 2;
    const maxLogoY = logoBottomLimit - logoSize * 0.79;
    if (logoY > maxLogoY) logoY = maxLogoY;
    if (logoY < minLogoY) {
      const available = Math.max(1, logoBottomLimit - usableTop);
      logoSize = Math.min(logoSize, available / 1.29);
      logoY = usableTop + logoSize / 2;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = skin.colors.homeMotif;
    ctx.lineWidth = Math.max(18, logoSize * 0.13);
    ctx.beginPath();
    ctx.arc(width / 2, logoY, logoSize * 0.67, Math.PI * 0.18, Math.PI * 0.82, true);
    ctx.stroke();
    ctx.fillStyle = skin.colors.homeMotif;
    ctx.fillRect(width / 2 - logoSize * 0.06, logoY + logoSize * 0.57, logoSize * 0.12, logoSize * 0.45);
    ctx.restore();

    if (this.images.logo) {
      ctx.drawImage(this.images.logo, width / 2 - logoSize / 2, logoY - logoSize / 2, logoSize, logoSize);
    } else {
      this.drawFallbackLogo(width / 2, logoY, logoSize * 0.72);
    }

    this.text('清空每一格', width / 2, logoY + logoSize * 0.63, 21, { weight: 300, alpha: 0.78 });

    const buttonWidth = Math.min(width - 56, 360);
    // Keep the bottom inset while stacking both rows. The stack is derived
    // from safeBottom so it remains above gesture areas on devices with a
    // home indicator.
    const buttonX = (width - buttonWidth) / 2;
    const columnWidth = (buttonWidth - buttonGap) / 2;
    const dailyEntryKnown = model && (model.dailyDebugUnlimited === true ||
      (model.dailyEntriesRemaining !== undefined && model.dailyEntryLimit !== undefined));
    const dailyEntryRemaining = dailyEntryKnown ? Number(model.dailyEntriesRemaining) : 0;
    const dailyEntryLimit = dailyEntryKnown ? Number(model.dailyEntryLimit) : 0;
    const dailyButtonLabel = dailyEntryKnown && model.dailyDebugUnlimited !== true
      ? `每日挑战（${Math.max(0, dailyEntryRemaining)}/${Math.max(1, dailyEntryLimit)}）`
      : '每日挑战';
    // Remaining entries live in the label; only unavailable states need a hint.
    if (dailyEntryKnown && model.dailyDebugUnlimited !== true) {
      const dailyStatus = model.dailyAvailable === false
        ? '今日暂无关卡'
        : dailyEntryRemaining > 0
          ? null
          : '今日次数已用完';
      if (dailyStatus) this.text(dailyStatus, width / 2, firstY - 13, 11, { alpha: 0.58 });
    }
    const dailyButtonRect = {
      x: buttonX,
      y: firstY,
      w: columnWidth,
      h: buttonHeight
    };
    this.button('home:dailyChallenge', dailyButtonRect, dailyButtonLabel, {
      fill: skin.colors.primaryButton,
      stroke: skin.colors.primaryButtonStroke,
      fontSize: dailyButtonLabel === '每日挑战' ? 19 : Math.min(19, (columnWidth - 16) / 8),
      enabled: model.dailyAvailable !== false && model.dailyEntryAvailable !== false
    }, model.pressedId);
    if (model.dailyDebugUnlimited === true) {
      this.text('次数不限', dailyButtonRect.x + dailyButtonRect.w - 8,
        dailyButtonRect.y + dailyButtonRect.h - 7, 10, {
          align: 'right',
          baseline: 'bottom',
          alpha: 0.68
        });
    }
    const galleryAction = model && model.homeMigration === true
      ? 'home:corridor' : 'home:themes';
    const galleryLabel = model && model.homeMigration === true ? '回廊' : '主题';
    this.button(galleryAction, {
      x: buttonX + columnWidth + buttonGap,
      y: firstY,
      w: columnWidth,
      h: buttonHeight
    }, galleryLabel, {
      fill: skin.colors.primaryButton,
      stroke: skin.colors.primaryButtonStroke,
      fontSize: 18
    }, model.pressedId);
    const startButtonRect = {
      x: buttonX,
      y: firstY + buttonHeight + buttonGap,
      w: buttonWidth,
      h: buttonHeight
    };
    this.button('home:start', startButtonRect, model.completedCount ? '继续游戏' : '开始游戏', {
      fill: skin.colors.primaryButton,
      stroke: skin.colors.primaryButtonStroke,
      fontSize: 19
    }, model.pressedId);
    this.text(`${model.completedCount}/${model.totalLevels}`,
      startButtonRect.x + startButtonRect.w - 16, startButtonRect.y + startButtonRect.h / 2, 12, {
        align: 'right', alpha: 0.68, maxWidth: Math.max(1, startButtonRect.w / 2 - 56)
      });
    if (model.dailyExtraEntryAvailable) this.button('daily:extraEntry', {
      x: buttonX, y: firstY + buttonHeight * 2 + buttonGap + 10, w: buttonWidth, h: 42
    }, model.dailyExtraEntryPending ? '正在处理' : '看视频，增加一次挑战',
    { fontSize: 15, enabled: !model.dailyExtraEntryPending }, model.pressedId);
    if (model.dailyRewardMessage) this.text(model.dailyRewardMessage, width / 2, firstY - 29, 12, { maxWidth: buttonWidth });
  }

  drawCurrency(currency, rect) {
    const preferred = currency && Number.isSafeInteger(currency.displayBalance) && currency.displayBalance >= 0
      ? currency.displayBalance : currency && currency.balance;
    const available = currency && currency.available === true && Number.isSafeInteger(preferred) && preferred >= 0;
    const balance = available ? preferred : null;
    const label = balance === null ? '--' : balance >= 10000
      ? `${Math.floor(balance / 1000) / 10}万` : String(balance);
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(rect.x + 14, rect.y + rect.h / 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#f1c75b';
    ctx.fill();
    ctx.strokeStyle = '#fff1b0';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    this.text(label, rect.x + rect.w - 7, rect.y + rect.h / 2, 17, {
      align: 'right', weight: 500, alpha: available ? 0.9 : 0.55,
      maxWidth: Math.max(20, rect.w - 29)
    });
  }

  ensureAccountAvatar(profile) {
    const source = profile && profile.avatarUrl;
    if (!source) this.accountAvatar = null;
    else if (!this.accountAvatar || this.accountAvatar.source !== source) {
      const record = { source, image: null };
      this.accountAvatar = record;
      try {
        this.platform.createImage(source, (error, image) => {
          if (this.accountAvatar !== record) return;
          record.image = error ? null : image;
          this.invalidate();
        });
      } catch (error) {}
    }
    return this.accountAvatar && this.accountAvatar.image;
  }

  drawHomeAvatar(profile, rect, pressedId) {
    const ctx = this.ctx;
    const skin = this.skinService.current();
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    this.button('home:account', rect, '', { radius: rect.w / 2 }, pressedId);
    const avatar = this.ensureAccountAvatar(profile);
    let drawn = false;
    ctx.save();
    ctx.globalAlpha = pressedId === 'home:account' ? 0.7 : 1;
    if (avatar) {
      ctx.save();
      try {
        ctx.beginPath();
        ctx.arc(x, y, rect.w / 2 - 2, 0, Math.PI * 2);
        ctx.clip();
        drawn = this.drawImageContain(avatar, { x: rect.x + 2, y: rect.y + 2, w: rect.w - 4, h: rect.h - 4 },
          { fit: 'cover', allowUnknownSize: false });
      } catch (error) {} finally { ctx.restore(); }
    }
    if (!drawn) {
      // A neutral portrait remains usable before authorization or on load failure.
      ctx.fillStyle = skin.colors.icon;
      ctx.beginPath();
      ctx.arc(x, y - rect.h * 0.15, rect.w * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y + rect.h * 0.24, rect.w * 0.24, Math.PI, Math.PI * 2);
      ctx.lineTo(x + rect.w * 0.24, y + rect.h * 0.32);
      ctx.lineTo(x - rect.w * 0.24, y + rect.h * 0.32);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawAccount(model) {
    const skin = this.skinService.current();
    const layout = accountLayout(this.platform.metrics);
    this.begin(skin.colors.homeBackground);
    this.iconButton('account:back', layout.backButton, 'back', true, model.pressedId);
    const panel = layout.panel;
    const center = panel.x + panel.w / 2;
    this.text('账号', center, layout.backButton.y + 22, 22);
    const space = layout.profileButton.y - panel.y;
    const avatarSize = Math.min(64, space * 0.32);
    const avatarRect = { x: center - avatarSize / 2, y: panel.y + 6, w: avatarSize, h: avatarSize };
    const profile = model.accountProfile;
    const avatar = this.ensureAccountAvatar(profile);
    this.roundedRect(avatarRect.x, avatarRect.y, avatarRect.w, avatarRect.h, 12);
    this.ctx.fillStyle = skin.colors.levelCell;
    this.ctx.fill();
    if (avatar) {
      this.drawImageContain(avatar, avatarRect);
    } else {
      this.text('我', center, avatarRect.y + avatarSize / 2, Math.min(24, avatarSize / 2));
    }
    this.text(profile ? profile.nickname : '本地玩家', center, panel.y + space * 0.46, 18, { maxWidth: panel.w - 24 });
    const status = { local: model.backupMode ? '本地存档' : '本地游玩', syncing: model.backupMode ? '正在处理云备份' : '正在同步',
      pending: model.backupMode ? '本地已保存，云备份待更新' : '等待同步',
      synced: model.backupMode ? '本地已保存，云备份最新' : '已同步', error: model.backupMode ? '云备份失败' : '同步失败',
      'account-mismatch': '账号不一致，已暂停同步' }[model.accountStatus] || '本地游玩';
    this.text(status, center, panel.y + space * 0.65, 15, { maxWidth: panel.w - 24 });
    this.text(model.accountMessage || '头像昵称为可选资料', center, panel.y + space * 0.84, 12, { maxWidth: panel.w - 24, alpha: 0.7 });
    this.button('account:authorizeProfile', layout.profileButton,
      model.profilePending ? '正在保存资料' : model.profileSupported ? '授权头像昵称' : '头像昵称暂不可用',
      { enabled: model.profileSupported === true && !model.profilePending, fontSize: 17 }, model.pressedId);
    const backupAction = model.backupConfirmRestore ? 'account:confirmRestore'
      : model.backupConfirmCommit ? 'account:confirmBackup' : 'account:retrySync';
    const backupLabel = model.syncPending ? '正在处理…' : model.backupConfirmRestore ? '确认恢复云备份'
      : model.backupConfirmCommit ? '确认用本机覆盖云备份' : model.backupMode ? '立即备份' : '重试同步';
    this.button(backupAction, layout.retryButton, backupLabel,
      { enabled: !model.syncPending, fontSize: 17 }, model.pressedId);
    this.button('account:restoreBackup', layout.restoreButton, '恢复云备份',
      { enabled: model.backupMode === true && !model.syncPending, fontSize: 17 }, model.pressedId);
    this.button('account:privacy', layout.privacyButton, '隐私协议', { fontSize: 17 }, model.pressedId);
  }

  drawFallbackLogo(x, y, size) {
    const ctx = this.ctx;
    const colors = this.skinService.current().logoPalette;
    const cell = size / 3;
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    colors.forEach((color, index) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect((index % 3) * cell, Math.floor(index / 3) * cell, cell + 0.5, cell + 0.5);
    });
    ctx.restore();
  }

  themeList(model) {
    if (model && Array.isArray(model.themes)) return model.themes;
    if (this.skinService && typeof this.skinService.list === 'function') {
      const list = this.skinService.list();
      if (Array.isArray(list)) return list;
    }
    const current = this.skinService && this.skinService.current
      ? this.skinService.current()
      : null;
    return current ? [current] : [];
  }

  themePalette(theme, fallbackSkin) {
    const candidate = theme && (theme.palette || (theme.colors && theme.colors.palette));
    if (Array.isArray(candidate) && candidate.length) return candidate;
    const visuals = this.tileVisualConfig(theme || {});
    if (Array.isArray(visuals.fallbackColors) && visuals.fallbackColors.length) {
      return visuals.fallbackColors;
    }
    const fallback = fallbackSkin && (fallbackSkin.palette || (fallbackSkin.colors && fallbackSkin.colors.palette));
    if (Array.isArray(fallback) && fallback.length) return fallback;
    return ['#ffeb3b', '#ff9800', '#f44336', '#8bc34a', '#009688', '#03a9f4', '#673ab7', '#f28ab2'];
  }

  themeManifest(theme) {
    if (!theme) return null;
    if (theme.id && this.skinService && typeof this.skinService.get === 'function') {
      return this.skinService.get(theme.id) || theme;
    }
    return theme;
  }

  tileAssetReference(skin) {
    const visuals = this.tileVisualConfig(skin || {});
    let reference = visuals.asset || visuals.image || visuals.sheet;
    if (!reference && Array.isArray(visuals.variants) && visuals.variants.length) {
      reference = visuals.variants[0];
    }
    if (reference && typeof reference === 'object') {
      reference = reference.asset || reference.image || reference.src;
    }
    return typeof reference === 'string' && reference ? reference : null;
  }

  tileAssetInfo(skin, reference) {
    if (!skin || !reference) return { key: null, source: null };
    const assets = skin.assets || {};
    if (assets[reference] && typeof assets[reference] === 'string') {
      return { key: reference, source: assets[reference] };
    }
    if (reference.indexOf('/') >= 0 || reference.indexOf('.') >= 0) {
      return { key: reference, source: reference };
    }
    const key = Object.keys(assets).find(name => assets[name] === reference);
    return key ? { key, source: assets[key] } : { key: null, source: null };
  }

  ensureThemeTileImage(theme) {
    const manifest = this.themeManifest(theme);
    if (!manifest || !manifest.id) return { key: null, image: null };
    const reference = this.tileAssetReference(manifest);
    const info = this.tileAssetInfo(manifest, reference);
    if (!info.source) return { key: info.key, image: null };
    if (!this.isAssetReady(info.source)) return { key: info.key, image: null };

    const current = this.skinService && this.skinService.current
      ? this.skinService.current()
      : null;
    if (current && String(current.id) === String(manifest.id) &&
        info.key && this.images[info.key]) {
      return { key: info.key, image: this.images[info.key] };
    }

    const id = String(manifest.id);
    if (this.themeTileSources[id] === info.source &&
        Object.prototype.hasOwnProperty.call(this.themeTileImages, id)) {
      return { key: info.key, image: this.themeTileImages[id] };
    }
    const active = this.themeTileLoads[id];
    if (active && active.source === info.source) return { key: info.key, image: null };

    const request = { source: info.source };
    this.themeTileLoads[id] = request;
    try {
      this.platform.createImage(info.source, (error, image) => {
        if (this.themeTileLoads[id] !== request) return;
        this.themeTileSources[id] = info.source;
        this.themeTileImages[id] = error || !image ? null : image;
        this.invalidate();
      });
    } catch (error) {
      if (this.themeTileLoads[id] === request) {
        this.themeTileSources[id] = info.source;
        this.themeTileImages[id] = null;
        this.invalidate();
      }
    }
    // Some hosts (and our lightweight test platform) invoke the image
    // callback synchronously. Re-read the cache so those callers can render
    // the first four elements immediately; real async hosts still return a
    // null image and invalidate once loading completes.
    const loaded = this.themeTileSources[id] === info.source &&
      Object.prototype.hasOwnProperty.call(this.themeTileImages, id)
      ? this.themeTileImages[id]
      : null;
    return { key: info.key, image: loaded };
  }

  drawThemeFallbackPreview(theme, rect, fallbackSkin) {
    const ctx = this.ctx;
    const palette = this.themePalette(theme, fallbackSkin);
    const columns = 2;
    const rows = 2;
    const gap = clamp(Math.min(rect.w, rect.h) * 0.045, 2, 6);
    const cell = Math.min(
      (rect.w - gap * (columns - 1)) / columns,
      (rect.h - gap * (rows - 1)) / rows
    );
    if (!(cell > 0)) return;
    const gridW = cell * columns + gap * (columns - 1);
    const gridH = cell * rows + gap * (rows - 1);
    const startX = rect.x + (rect.w - gridW) / 2;
    const startY = rect.y + (rect.h - gridH) / 2;
    for (let index = 0; index < columns * rows; index++) {
      const x = startX + (index % columns) * (cell + gap);
      const y = startY + Math.floor(index / columns) * (cell + gap);
      ctx.save();
      ctx.globalAlpha = 0.92;
      this.roundedRect(x, y, cell, cell, Math.min(7, cell * 0.18));
      ctx.fillStyle = palette[index % palette.length] || '#ffffff';
      ctx.fill();
      ctx.restore();
    }
  }

  drawThemeElementsPreview(theme, rect, fallbackSkin) {
    const manifest = this.themeManifest(theme) || theme || {};
    const palette = this.themePalette(manifest, fallbackSkin);
    const preview = this.ensurePreviewImage(manifest);
    const dimensions = this.imageSize(preview);
    const hasPreview = dimensions.width === 128 && dimensions.height === 128;
    const asset = hasPreview ? { key: 'preview', image: preview }
      : this.ensureThemeTileImage(manifest);
    const visuals = this.tileVisualConfig(manifest);
    // This view-only manifest keeps the board's 5x2 / 10-slot contract intact.
    // The four preview slots retain the same Canvas-drawn translucent bases.
    const previewSkin = hasPreview ? Object.assign({}, manifest, {
      tileVisuals: {
        type: 'spriteSheet', asset: 'preview', columns: 2, rows: 2, count: 4, scale: 1,
        background: visuals.background,
        backgroundColor: visuals.backgroundColor,
        backgroundAlpha: visuals.backgroundAlpha
      }
    }) : manifest;
    const columns = 2;
    const rows = 2;
    const gap = clamp(Math.min(rect.w, rect.h) * 0.06, 3, 8);
    const cell = Math.min(
      (rect.w - gap * (columns - 1)) / columns,
      (rect.h - gap * (rows - 1)) / rows
    );
    if (!(cell > 0)) return;
    const gridW = cell * columns + gap * (columns - 1);
    const gridH = cell * rows + gap * (rows - 1);
    const startX = rect.x + (rect.w - gridW) / 2;
    const startY = rect.y + (rect.h - gridH) / 2;
    const images = asset.image && asset.key ? { [asset.key]: asset.image } : {};

    for (let index = 0; index < 4; index++) {
      const x = startX + (index % columns) * (cell + gap);
      const y = startY + Math.floor(index / columns) * (cell + gap);
      this.drawTile(index, x, y, cell, {
        skin: previewSkin,
        images,
        color: palette[index % palette.length] || '#ffffff',
        alpha: 0.96
      });
    }
  }

  drawThemes(model, now) {
    const skin = this.skinService.current();
    const metrics = this.platform.metrics;
    const width = metrics.width;
    const height = metrics.height;
    const safeTop = metrics.safeTop || 0;
    const safeBottom = metrics.safeBottom || height;
    const themes = this.themeList(model);
    const pageSize = 6;
    const pageCount = Math.max(1,
      Number(model && model.themePageCount) || Math.ceil(themes.length / pageSize));
    const rawPage = Number(model && model.themePageIndex);
    const pageIndex = clamp(Number.isFinite(rawPage) ? rawPage : 0, 0, pageCount - 1);
    const currentThemeId = (model && model.currentThemeId) || skin.id;
    const ctx = this.ctx;

    this.begin(skin.colors.homeBackground);

    const headerTop = safeTop + 4;
    const headerHeight = 68;
    const requestedThemesOffset = Number(skin.layout.themesTopUiOffset);
    // Keep the 44px sound button inside the header. The larger back button
    // shares its center and uses six pixels of padding before the card grid.
    const themesTopUiOffset = clamp(
      Number.isFinite(requestedThemesOffset) ? requestedThemesOffset : 0,
      0,
      Math.max(0, headerHeight - 52)
    );
    const topButtonY = headerTop + 8 + themesTopUiOffset;
    const backAction = model && (model.backAction === 'themes:corridor' || model.backAction === 'themes:home')
      ? model.backAction
      : 'themes:home';
    // Expand around the existing center, retaining a gap before the card grid.
    this.iconButton(backAction, { x: 4, y: topButtonY - 6, w: 56, h: 56 },
      'back', true, model && model.pressedId);
    // Keep the sound affordance available on the gallery just like the home
    // and play scenes.  Apps that do not route this action can simply ignore
    // the optional hit; the required gallery IDs remain unchanged.
    this.iconButton('themes:sound', { x: width - 58, y: topButtonY, w: 44, h: 44 },
      model && model.soundEnabled === false ? 'mute' : 'sound', true,
      model && model.pressedId);
    this.text('主题', width / 2, headerTop + 27, 25, { weight: 300 });
    this.text(`${pageIndex + 1} / ${pageCount}`, width / 2, headerTop + 53, 12, { alpha: 0.58 });

    const sidePadding = clamp(width * 0.055, 16, 24);
    const columnGap = clamp(width * 0.032, 9, 14);
    const rowGap = clamp(width * 0.032, 9, 14);
    const gridTop = headerTop + headerHeight + 8;
    const controlsHeight = 70;
    const availableHeight = Math.max(0, safeBottom - gridTop - controlsHeight - 12);
    const cardWidth = Math.max(1, (width - sidePadding * 2 - columnGap) / 2);
    const cardHeight = Math.min(186, Math.max(64, (availableHeight - rowGap * 2) / 3));
    const gridHeight = cardHeight * 3 + rowGap * 2;
    const gridY = gridTop + Math.max(0, (availableHeight - gridHeight) / 2);
    const previewPadding = clamp(cardWidth * 0.055, 6, 10);
    const labelHeight = clamp(cardHeight * 0.22, 25, 38);
    const previewHeight = Math.max(1, cardHeight - labelHeight - previewPadding * 1.5);

    for (let slot = 0; slot < pageSize; slot++) {
      const row = Math.floor(slot / 2);
      const column = slot % 2;
      const rect = {
        x: sidePadding + column * (cardWidth + columnGap),
        y: gridY + row * (cardHeight + rowGap),
        w: cardWidth,
        h: cardHeight
      };
      const themeIndex = pageIndex * pageSize + slot;
      const rawTheme = themes[themeIndex];
      const theme = typeof rawTheme === 'string' ? { id: rawTheme, name: rawTheme } : rawTheme;
      const valid = !!(theme && theme.id);
      const selected = valid && String(theme.id) === String(currentThemeId);

      ctx.save();
      this.roundedRect(rect.x, rect.y, rect.w, rect.h, skin.layout.buttonRadius || 8);
      if (!valid) {
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = skin.colors.panel;
        ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.fillStyle = selected ? skin.colors.levelCellPressed : skin.colors.levelCell;
      ctx.globalAlpha = selected ? 1 : 0.92;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = skin.colors.levelCompletedStroke || skin.colors.hairline;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();

      const reward = theme.reward || { owned: true };
      const conditionStatus = reward.owned === false
        ? reward.conditionType === 'ordinary_level' ? `通关第 ${reward.displayLevel || '?'} 关解锁`
          : reward.conditionType === 'currency' ? `${reward.cost || 0} 货币解锁`
            : reward.conditionType === 'rewarded_ad' ? `观看 ${reward.requiredCount || 1} 次广告解锁`
              : reward.conditionType === 'share' ? '分享解锁' : '暂未开放'
        : '';
      const assetStatus = conditionStatus || (theme.assetState === 'idle' ? '点击下载'
        : theme.assetState === 'loading' ? `下载 ${Math.round(clamp(Number(theme.assetProgress) || 0, 0, 100))}%`
          : theme.assetState === 'failed' ? '加载失败，点击重试' : '');
      const statusHeight = assetStatus ? 14 : 0;
      const previewRect = {
        x: rect.x + previewPadding,
        y: rect.y + previewPadding,
        w: rect.w - previewPadding * 2,
        h: Math.max(1, previewHeight - statusHeight)
      };
      // The main-package 2x2 preview is visible before the board-art download.
      this.drawThemeElementsPreview(theme, previewRect, skin);

      const name = theme.name || theme.title || theme.id;
      this.text(name, rect.x + rect.w / 2, rect.y + cardHeight - labelHeight * 0.56 - statusHeight,
        clamp(cardWidth * 0.105, 13, 18), { weight: selected ? 500 : 300, maxWidth: rect.w - 18 });
      if (assetStatus) {
        this.text(assetStatus, rect.x + rect.w / 2, rect.y + cardHeight - labelHeight * 0.34,
          10, { alpha: 0.72, maxWidth: rect.w - 12 });
      }
      if (selected) {
        this.text('✓', rect.x + rect.w - 14, rect.y + 14, 13, { weight: 500, alpha: 0.86 });
      }
      this.addHit(`theme:${theme.id}`, rect, true);
    }

    const controlY = safeBottom - controlsHeight + 8;
    this.iconButton('themes:prev', { x: width / 2 - 92, y: controlY, w: 52, h: 44 },
      'back', pageIndex > 0, model && model.pressedId);
    this.iconButton('themes:next', { x: width / 2 + 40, y: controlY, w: 52, h: 44 },
      'next', pageIndex < pageCount - 1, model && model.pressedId);
    this.text('左右滑动切换主题', width / 2, controlY + 50, 11, { alpha: 0.42 });
  }

  // --- Corridor / clear-effect galleries ---------------------------------

  corridorEntries(model) {
    if (model && Array.isArray(model.corridorEntries)) return model.corridorEntries;
    return [
      { id: 'themes', name: '主题', action: 'corridor:themes' },
      { id: 'effects', name: '特效', action: 'corridor:effects' }
    ];
  }

  effectList(model) {
    if (model && Array.isArray(model.effects)) return model.effects;
    if (this.clearEffects && typeof this.clearEffects.list === 'function') {
      try {
        const list = this.clearEffects.list();
        return Array.isArray(list) ? list : [];
      } catch (error) {
        return [];
      }
    }
    return [];
  }

  effectManifest(effect) {
    if (!effect) return null;
    if (this.clearEffects && typeof this.clearEffects.get === 'function' && effect.id) {
      try {
        return this.clearEffects.get(effect.id) || effect;
      } catch (error) {
        return effect;
      }
    }
    return effect;
  }

  effectPreviewSource(effect) {
    const manifest = this.effectManifest(effect) || effect;
    if (!manifest) return null;
    if (manifest.preview && typeof manifest.preview === 'object') {
      // A host may inject an already-created image object for tests. Do not
      // pass arbitrary descriptor objects to Canvas as if they were images.
      const dimensions = this.imageSize(manifest.preview);
      if (dimensions.width > 0 && dimensions.height > 0) return manifest.preview;
      if (typeof manifest.preview.src === 'string' && manifest.preview.src) return manifest.preview.src;
      return null;
    }
    if (typeof manifest.preview !== 'string' || !manifest.preview) return null;
    // Effect previews are bundled assets only. Never turn an injected remote
    // URL/data URI into a platform image request.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(manifest.preview.trim())) return null;
    return manifest.preview;
  }

  ensureEffectPreviewImage(effect) {
    if (!effect || effect.id === undefined || effect.id === null) return null;
    const id = String(effect.id);
    const source = this.effectPreviewSource(effect);
    if (source && typeof source !== 'string') return source;
    if (!source) return null;

    if (this.effectPreviewSources[id] === source &&
        Object.prototype.hasOwnProperty.call(this.effectPreviewImages, id)) {
      return this.effectPreviewImages[id];
    }
    const active = this.effectPreviewLoads[id];
    if (active && active.source === source && active.generation === this.effectSceneGeneration) return null;

    const request = { source, generation: this.effectSceneGeneration };
    this.effectPreviewLoads[id] = request;
    try {
      this.platform.createImage(source, (error, image) => {
        // Requests are valid only for the page generation that started them;
        // this prevents a late callback from a hidden effects page from
        // invalidating or replacing a newly entered page.
        if (this.effectPreviewLoads[id] !== request ||
            request.generation !== this.effectSceneGeneration ||
            this.lastScene !== 'effects') return;
        this.effectPreviewSources[id] = source;
        this.effectPreviewImages[id] = error || !image ? null : image;
        delete this.effectPreviewLoads[id];
        this.invalidate();
      });
    } catch (error) {
      if (this.effectPreviewLoads[id] === request &&
          request.generation === this.effectSceneGeneration &&
          this.lastScene === 'effects') {
        this.effectPreviewSources[id] = source;
        this.effectPreviewImages[id] = null;
        delete this.effectPreviewLoads[id];
        this.invalidate();
      }
    }

    // Synchronous test platforms invoke callbacks before createImage returns.
    return this.effectPreviewSources[id] === source &&
      Object.prototype.hasOwnProperty.call(this.effectPreviewImages, id)
      ? this.effectPreviewImages[id]
      : null;
  }

  drawEffectFallbackPreview(rect, effect) {
    const effectId = effect && effect.id !== undefined ? String(effect.id) : '';
    const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
    if (effectId === 'none' || effectType === 'none') {
      this.drawNoneEffectFallbackPreview(rect);
      return;
    }
    const ctx = this.ctx;
    const skin = this.skinService.current();
    const palette = (skin && skin.palette && skin.palette.length)
      ? skin.palette
      : ['#ffffff', '#b3e5fc', '#81d4fa', '#4fc3f7'];
    const centerX = rect.x + rect.w * 0.45;
    const centerY = rect.y + rect.h * 0.52;
    const span = Math.min(rect.w, rect.h);
    // Three short vector wind strokes communicate "fade away" without
    // requiring an image asset or introducing a second animation system.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, span * 0.025);
    for (let line = 0; line < 3; line++) {
      const y = centerY - span * 0.18 + line * span * 0.15;
      ctx.globalAlpha = 0.72 - line * 0.16;
      ctx.strokeStyle = palette[line % palette.length] || '#ffffff';
      ctx.beginPath();
      ctx.moveTo(rect.x + span * 0.10, y);
      ctx.quadraticCurveTo(centerX, y - span * 0.10, rect.x + rect.w * (0.74 + line * 0.04),
        y - span * 0.04);
      ctx.stroke();
    }
    // A few dissolving squares at the stroke tip remain static and cheap.
    const square = Math.max(3, span * 0.065);
    [
      { x: rect.x + rect.w * 0.74, y: centerY - span * 0.25, a: 0.78 },
      { x: rect.x + rect.w * 0.84, y: centerY - span * 0.08, a: 0.5 },
      { x: rect.x + rect.w * 0.91, y: centerY + span * 0.07, a: 0.28 }
    ].forEach((fragment, index) => {
      ctx.globalAlpha = fragment.a;
      ctx.fillStyle = palette[(index + 1) % palette.length] || '#ffffff';
      ctx.fillRect(fragment.x, fragment.y, square * (1 - index * 0.18), square * (1 - index * 0.18));
    });
    ctx.restore();
  }

  drawNoneEffectFallbackPreview(rect) {
    const ctx = this.ctx;
    const skin = this.skinService.current();
    const palette = (skin && skin.palette && skin.palette.length)
      ? skin.palette
      : ['#ffca28', '#26c6da', '#ff7043', '#29b6f6'];
    const span = Math.min(rect.w, rect.h);
    const size = Math.max(10, span * 0.26);
    const radius = Math.max(3, size * 0.22);
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const tiles = [
      { dx: -0.38, dy: -0.16 },
      { dx: 0, dy: -0.30 },
      { dx: 0.38, dy: -0.12 },
      { dx: -0.20, dy: 0.28 },
      { dx: 0.22, dy: 0.30 }
    ];

    ctx.save();
    tiles.forEach((tile, index) => {
      const x = centerX + tile.dx * span - size / 2;
      const y = centerY + tile.dy * span - size / 2;
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = palette[index % palette.length] || '#ffffff';
      this.roundedRect(x, y, size, size, radius);
      ctx.fill();

      // A quiet inset highlight keeps the fallback legible without implying
      // movement, particles, fading, or any other clear animation.
      const inset = size * 0.16;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ffffff';
      this.roundedRect(x + inset, y + inset, size - inset * 2, size - inset * 2,
        Math.max(2, radius * 0.62));
      ctx.fill();
    });
    ctx.restore();
  }

  drawCorridorEntryPreview(entry, rect) {
    const ctx = this.ctx;
    const id = entry && String(entry.id || '');
    const skin = this.skinService.current();
    const palette = skin && skin.palette && skin.palette.length
      ? skin.palette : ['#ffeb3b', '#03a9f4', '#8bc34a', '#f44336'];
    ctx.save();
    if (id === 'effects' || id === 'clear-effects') {
      this.drawEffectFallbackPreview(rect, entry);
      ctx.restore();
      return;
    }
    // Theme entry preview: four small color tiles, independent from the
    // selected theme's runtime sprites.
    const gap = clamp(Math.min(rect.w, rect.h) * 0.07, 3, 8);
    const tile = Math.min((rect.w - gap) / 2, (rect.h - gap) / 2);
    const startX = rect.x + (rect.w - tile * 2 - gap) / 2;
    const startY = rect.y + (rect.h - tile * 2 - gap) / 2;
    for (let index = 0; index < 4; index++) {
      const x = startX + (index % 2) * (tile + gap);
      const y = startY + Math.floor(index / 2) * (tile + gap);
      this.roundedRect(x, y, tile, tile, Math.min(7, tile * 0.18));
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = palette[index % palette.length] || '#ffffff';
      ctx.fill();
    }
    ctx.restore();
  }

  drawCorridor(model, now) {
    const skin = this.skinService.current();
    const metrics = this.platform.metrics;
    const width = metrics.width;
    const height = metrics.height;
    const safeTop = metrics.safeTop || 0;
    const safeBottom = metrics.safeBottom || height;
    const entries = this.corridorEntries(model);
    const pageSize = Number(model && model.corridorPageSize) || 6;
    const pageCount = Math.max(1,
      Number(model && model.corridorPageCount) || Math.ceil(entries.length / pageSize));
    const rawPage = Number(model && model.corridorPageIndex);
    const pageIndex = clamp(Number.isFinite(rawPage) ? rawPage : 0, 0, pageCount - 1);
    const ctx = this.ctx;
    this.begin(skin.colors.homeBackground);

    const headerTop = safeTop + 4;
    const headerHeight = 68;
    const topOffset = clamp(Number(skin.layout.themesTopUiOffset) || 0, 0, headerHeight - 52);
    const topButtonY = headerTop + 8 + topOffset;
    const backAction = model && model.backAction === 'corridor:home'
      ? model.backAction : 'corridor:home';
    this.iconButton(backAction, { x: 10, y: topButtonY, w: 44, h: 44 },
      'home', true, model && model.pressedId);
    this.iconButton('corridor:sound', { x: width - 58, y: topButtonY, w: 44, h: 44 },
      model && model.soundEnabled === false ? 'mute' : 'sound', true,
      model && model.pressedId);
    this.text('回廊', width / 2, headerTop + 27, 25, { weight: 300 });
    this.text(`${pageIndex + 1} / ${pageCount}`, width / 2, headerTop + 53, 12, { alpha: 0.58 });

    const sidePadding = clamp(width * 0.055, 16, 24);
    const columnGap = clamp(width * 0.032, 9, 14);
    const rowGap = clamp(width * 0.032, 9, 14);
    const gridTop = headerTop + headerHeight + 8;
    const controlsHeight = pageCount > 1 ? 70 : 42;
    const availableHeight = Math.max(0, safeBottom - gridTop - controlsHeight - 12);
    const cardWidth = Math.max(1, (width - sidePadding * 2 - columnGap) / 2);
    const cardHeight = Math.min(186, Math.max(64, (availableHeight - rowGap * 2) / 3));
    const gridHeight = cardHeight * 3 + rowGap * 2;
    const gridY = gridTop + Math.max(0, (availableHeight - gridHeight) / 2);
    const previewPadding = clamp(cardWidth * 0.055, 6, 10);
    const labelHeight = clamp(cardHeight * 0.22, 25, 38);
    const previewHeight = Math.max(1, cardHeight - labelHeight - previewPadding * 1.5);

    for (let slot = 0; slot < pageSize; slot++) {
      const row = Math.floor(slot / 2);
      const column = slot % 2;
      const rect = {
        x: sidePadding + column * (cardWidth + columnGap),
        y: gridY + row * (cardHeight + rowGap),
        w: cardWidth,
        h: cardHeight
      };
      const entry = entries[pageIndex * pageSize + slot];
      const valid = !!(entry && entry.id && entry.action);
      ctx.save();
      this.roundedRect(rect.x, rect.y, rect.w, rect.h, skin.layout.buttonRadius || 8);
      if (!valid) {
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = skin.colors.panel;
        ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = skin.colors.levelCell;
      ctx.fill();
      ctx.restore();
      const previewRect = {
        x: rect.x + previewPadding,
        y: rect.y + previewPadding,
        w: rect.w - previewPadding * 2,
        h: previewHeight
      };
      this.drawCorridorEntryPreview(entry, previewRect);
      const name = entry.name || entry.title || entry.id;
      this.text(name, rect.x + rect.w / 2, rect.y + cardHeight - labelHeight * 0.56,
        clamp(cardWidth * 0.105, 13, 18), { weight: 300, maxWidth: rect.w - 18 });
      this.addHit(String(entry.action), rect, true);
    }

    if (pageCount > 1) {
      const controlY = safeBottom - 70 + 8;
      this.iconButton('corridor:prev', { x: width / 2 - 92, y: controlY, w: 52, h: 44 },
        'back', pageIndex > 0, model && model.pressedId);
      this.iconButton('corridor:next', { x: width / 2 + 40, y: controlY, w: 52, h: 44 },
        'next', pageIndex < pageCount - 1, model && model.pressedId);
      this.text('左右滑动切换功能', width / 2, controlY + 50, 11, { alpha: 0.42 });
    }
  }

  drawEffects(model, now) {
    const skin = this.skinService.current();
    const metrics = this.platform.metrics;
    const width = metrics.width;
    const height = metrics.height;
    const safeTop = metrics.safeTop || 0;
    const safeBottom = metrics.safeBottom || height;
    const effects = this.effectList(model);
    const pageSize = Number(model && model.effectPageSize) || 6;
    const pageCount = Math.max(1,
      Number(model && model.effectPageCount) || Math.ceil(effects.length / pageSize));
    const rawPage = Number(model && model.effectPageIndex);
    const pageIndex = clamp(Number.isFinite(rawPage) ? rawPage : 0, 0, pageCount - 1);
    const currentEffectId = model && model.currentEffectId;
    const ctx = this.ctx;
    this.begin(skin.colors.homeBackground);

    const headerTop = safeTop + 4;
    const headerHeight = 68;
    const topOffset = clamp(Number(skin.layout.themesTopUiOffset) || 0, 0, headerHeight - 52);
    const topButtonY = headerTop + 8 + topOffset;
    const backAction = model && (model.backAction === 'effects:corridor' || model.backAction === 'effects:home')
      ? model.backAction : 'effects:corridor';
    this.iconButton(backAction, { x: 4, y: topButtonY - 6, w: 56, h: 56 },
      'back', true, model && model.pressedId);
    this.iconButton('effects:sound', { x: width - 58, y: topButtonY, w: 44, h: 44 },
      model && model.soundEnabled === false ? 'mute' : 'sound', true,
      model && model.pressedId);
    this.text('消除特效', width / 2, headerTop + 27, 25, { weight: 300 });
    this.text(`${pageIndex + 1} / ${pageCount}`, width / 2, headerTop + 53, 12, { alpha: 0.58 });

    const sidePadding = clamp(width * 0.055, 16, 24);
    const columnGap = clamp(width * 0.032, 9, 14);
    const rowGap = clamp(width * 0.032, 9, 14);
    const gridTop = headerTop + headerHeight + 8;
    const controlsHeight = pageCount > 1 ? 70 : 42;
    const availableHeight = Math.max(0, safeBottom - gridTop - controlsHeight - 12);
    const cardWidth = Math.max(1, (width - sidePadding * 2 - columnGap) / 2);
    const cardHeight = Math.min(186, Math.max(64, (availableHeight - rowGap * 2) / 3));
    const gridHeight = cardHeight * 3 + rowGap * 2;
    const gridY = gridTop + Math.max(0, (availableHeight - gridHeight) / 2);
    const previewPadding = clamp(cardWidth * 0.055, 6, 10);
    const labelHeight = clamp(cardHeight * 0.22, 25, 38);
    const previewHeight = Math.max(1, cardHeight - labelHeight - previewPadding * 1.5);

    for (let slot = 0; slot < pageSize; slot++) {
      const row = Math.floor(slot / 2);
      const column = slot % 2;
      const rect = {
        x: sidePadding + column * (cardWidth + columnGap),
        y: gridY + row * (cardHeight + rowGap),
        w: cardWidth,
        h: cardHeight
      };
      const effect = effects[pageIndex * pageSize + slot];
      const valid = !!(effect && effect.id);
      const reward = effect && effect.reward || { owned: true };
      const selected = valid && reward.owned !== false && currentEffectId !== undefined &&
        String(effect.id) === String(currentEffectId);
      ctx.save();
      this.roundedRect(rect.x, rect.y, rect.w, rect.h, skin.layout.buttonRadius || 8);
      if (!valid) {
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = skin.colors.panel;
        ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.fillStyle = selected ? skin.colors.levelCellPressed : skin.colors.levelCell;
      ctx.globalAlpha = selected ? 1 : 0.92;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = skin.colors.levelCompletedStroke || skin.colors.hairline;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();

      const conditionStatus = reward.owned === false
        ? reward.conditionType === 'ordinary_level' ? `通关第 ${reward.displayLevel || '?'} 关解锁`
          : reward.conditionType === 'currency' ? `${reward.cost || 0} 货币解锁`
            : reward.conditionType === 'rewarded_ad' ? `观看 ${reward.requiredCount || 1} 次广告解锁`
              : reward.conditionType === 'share' ? '分享解锁' : '暂未开放'
        : '';
      const previewRect = {
        x: rect.x + previewPadding,
        y: rect.y + previewPadding,
        w: rect.w - previewPadding * 2,
        h: previewHeight
      };
      const image = this.ensureEffectPreviewImage(effect);
      if (!image || !this.drawImageContain(image, previewRect, { fit: 'contain' })) {
        this.drawEffectFallbackPreview(previewRect, effect);
      }
      const name = effect.name || effect.title || effect.id;
      this.text(name, rect.x + rect.w / 2, rect.y + cardHeight - labelHeight * 0.56 - (conditionStatus ? 14 : 0),
        clamp(cardWidth * 0.105, 13, 18), { weight: selected ? 500 : 300, maxWidth: rect.w - 18 });
      if (conditionStatus) this.text(conditionStatus, rect.x + rect.w / 2,
        rect.y + cardHeight - 7, 10, { baseline: 'bottom', alpha: 0.72, maxWidth: rect.w - 12 });
      if (selected) {
        this.text('✓', rect.x + rect.w - 14, rect.y + 14, 13, { weight: 500, alpha: 0.86 });
      }
      this.addHit(`effect:${effect.id}`, rect, true);
    }

    if (pageCount > 1) {
      const controlY = safeBottom - 70 + 8;
      this.iconButton('effects:prev', { x: width / 2 - 92, y: controlY, w: 52, h: 44 },
        'back', pageIndex > 0, model && model.pressedId);
      this.iconButton('effects:next', { x: width / 2 + 40, y: controlY, w: 52, h: 44 },
        'next', pageIndex < pageCount - 1, model && model.pressedId);
      this.text('左右滑动切换特效', width / 2, controlY + 50, 11, { alpha: 0.42 });
    }
  }

  drawLevels(model, now) {
    const skin = this.skinService.current();
    const { width, safeTop, safeBottom } = this.platform.metrics;
    const legacyGames = model && model.set && Array.isArray(model.set.Games)
      ? model.set.Games : [];
    const items = Array.isArray(model && model.levelItems)
      ? model.levelItems
      : legacyGames.map((game, levelIndex) => ({
        action: `level:${levelIndex}`,
        displayNumber: levelIndex + 1,
        completed: model.isCompleted ? model.isCompleted(levelIndex) : false,
        unlocked: model.isUnlocked ? model.isUnlocked(levelIndex) : true,
        mechanicId: (game && (game.Mechanic || game.mechanic)) || null
      }));
    const pageCount = Math.max(1,
      Number(model && model.levelPageCount) || Number(model && model.setCount) || 1);
    const rawPageIndex = Number(model && (
      model.levelPageIndex === undefined ? model.setIndex : model.levelPageIndex
    ));
    const pageIndex = clamp(Number.isFinite(rawPageIndex) ? rawPageIndex : 0, 0, pageCount - 1);
    const totalLevels = Math.max(items.length, Number(model && model.totalLevels) || items.length);
    const rangeStart = Number(model && model.levelRangeStart) ||
      (items.length ? Number(items[0].displayNumber) || 1 : 0);
    const rangeEnd = Number(model && model.levelRangeEnd) ||
      (items.length ? Number(items[items.length - 1].displayNumber) || rangeStart : 0);
    this.begin(skin.colors.homeBackground);

    const headerTop = safeTop + 4;
    const headerHeight = 72;
    const controlTop = headerTop + 4;
    this.iconButton('levels:home', { x: 10, y: controlTop, w: 44, h: 44 }, 'home', true, model.pressedId);
    this.text('选择关卡', width / 2, headerTop + 26, 26, { weight: 300 });
    this.text(items.length ? `${rangeStart}–${rangeEnd} / ${totalLevels}` : `0 / ${totalLevels}`,
      width / 2, headerTop + 53, 12, { alpha: 0.58 });
    this.drawStaminaStatus(model.stamina,
      { x: width - 78, y: controlTop, w: 64, h: 44 }, { showDetail: false });

    const columns = items.length <= 5 ? Math.max(1, items.length) : 5;
    const rows = Math.ceil(items.length / columns);
    const sidePadding = 22;
    const gridTop = headerTop + headerHeight + 16;
    const controlsHeight = 66;
    const availableHeight = safeBottom - gridTop - controlsHeight - 16;
    const gap = clamp(width * 0.026, 8, 14);
    const cell = Math.min(
      (width - sidePadding * 2 - gap * (columns - 1)) / columns,
      rows ? (availableHeight - gap * (rows - 1)) / rows : 70,
      76
    );
    const gridWidth = cell * columns + gap * (columns - 1);
    const gridHeight = cell * rows + gap * (rows - 1);
    const gridX = (width - gridWidth) / 2;
    const gridY = gridTop + Math.max(0, (availableHeight - gridHeight) / 2);
    const ctx = this.ctx;

    items.forEach((item, slotIndex) => {
      const col = slotIndex % columns;
      const row = Math.floor(slotIndex / columns);
      const rect = {
        x: gridX + col * (cell + gap),
        y: gridY + row * (cell + gap),
        w: cell,
        h: cell
      };
      const action = typeof item.action === 'string' && item.action
        ? item.action : `level:${slotIndex}`;
      const completed = item.completed === true;
      const unlocked = item.unlocked !== false;
      const hasBestTime = completed && unlocked && Number.isFinite(item.bestMs) && item.bestMs > 0;
      const pressed = model.pressedId === action;
      ctx.save();
      this.roundedRect(rect.x, rect.y, rect.w, rect.h, 4);
      if (!unlocked) {
        ctx.fillStyle = skin.colors.levelLocked;
        ctx.fill();
      } else if (completed) {
        ctx.fillStyle = pressed ? skin.colors.levelCellPressed : skin.colors.levelCompleted;
        ctx.fill();
        ctx.strokeStyle = skin.colors.levelCompletedStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = pressed ? skin.colors.levelCellPressed : skin.colors.levelCell;
        ctx.fill();
      }
      ctx.restore();
      const numberY = hasBestTime ? rect.y + rect.h * 0.35
        : rect.y + rect.h / 2 - (!unlocked ? 7 : (completed ? 3 : 0));
      this.text(item.displayNumber, rect.x + rect.w / 2, numberY, clamp(cell * 0.31, 15, 23), {
        weight: 300,
        alpha: unlocked ? 1 : 0.36
      });
      if (Number.isInteger(item.difficulty) && item.difficulty >= 1 && item.difficulty <= 5) {
        ctx.save();
        ctx.fillStyle = skin.colors.text;
        const barWidth = Math.min(2.5, cell * 0.05);
        for (let grade = 1; grade <= 5; grade += 1) {
          ctx.globalAlpha = (grade <= item.difficulty ? 0.85 : 0.18) * (unlocked ? 1 : 0.5);
          ctx.fillRect(rect.x + 5 + (grade - 1) * (barWidth + 1.5), rect.y + 3, barWidth, 2);
        }
        ctx.restore();
      }
      if (hasBestTime) {
        this.text(formatTime(item.bestMs), rect.x + rect.w / 2, rect.y + rect.h * 0.73,
          clamp(cell * 0.2, 10, 14), { alpha: 0.82, maxWidth: Math.max(1, rect.w - 10) });
      }
      if (!unlocked) {
        ctx.save();
        ctx.globalAlpha = 0.42;
        this.drawIcon('lock', rect.x + rect.w / 2, rect.y + rect.h / 2 + 15, clamp(cell * 0.25, 11, 17));
        ctx.restore();
      } else if (completed) {
        this.text('✓', rect.x + rect.w - (hasBestTime ? 7 : 9), rect.y + (hasBestTime ? 7 : 10),
          hasBestTime ? 9 : 11, { alpha: 0.75, weight: 500 });
      }
      this.addHit(action, rect, unlocked);
    });

    const controlY = safeBottom - controlsHeight + 8;
    this.iconButton('levels:prev', { x: width / 2 - 92, y: controlY, w: 52, h: 44 }, 'back', pageIndex > 0, model.pressedId);
    this.iconButton('levels:next', { x: width / 2 + 40, y: controlY, w: 52, h: 44 }, 'next', pageIndex < pageCount - 1, model.pressedId);
    this.text('左右滑动切换关卡 · 难度 1–5 格', width / 2, controlY + 50, 11, { alpha: 0.42 });
  }

  fallbackBoardViewModel(model, level) {
    if (!level || typeof level !== 'object') return null;
    const width = Number(level.Width === undefined ? level.width : level.Width);
    const height = Number(level.Height === undefined ? level.height : level.Height);
    const total = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
        !Number.isInteger(total)) return null;
    const lines = level.Lines || level.lines || [];
    const blocked = level.Blocked || level.blocked || [];
    const blockedSet = new Set(Array.isArray(blocked) ? blocked : []);
    const fixedLine = new Array(total).fill(-1);
    lines.forEach((line, lineIndex) => {
      const start = line && (line.Start === undefined ? line.start : line.Start);
      const end = line && (line.End === undefined ? line.end : line.End);
      if (Number.isInteger(start) && start >= 0 && start < total && !blockedSet.has(start)) {
        fixedLine[start] = lineIndex;
      }
      if (Number.isInteger(end) && end >= 0 && end < total && !blockedSet.has(end)) {
        fixedLine[end] = lineIndex;
      }
    });
    const mechanicId = level.Mechanic === undefined ? level.mechanic : level.Mechanic;
    const rulesVersion = level.PortalRulesVersion === undefined
      ? level.portalRulesVersion : level.PortalRulesVersion;
    const definitions = level.Portals || level.portals || [];
    const normalizedDefinitions = Array.isArray(definitions)
      ? definitions.map(definition => {
        if (!definition || typeof definition !== 'object') return definition;
        const declaredCells = definition.cells === undefined ? definition.Cells : definition.cells;
        return Array.isArray(declaredCells)
          ? Object.assign({}, definition, { cells: declaredCells.slice() })
          : definition;
      })
      : [];
    const portalStatus = model.portalStatus && typeof model.portalStatus === 'object'
      ? model.portalStatus : null;
    const portalPhase = portalStatus && portalStatus.phase || 'READY';
    const expectedExits = Array.isArray(model.expectedExits)
      ? model.expectedExits.filter(Number.isInteger)
      : (portalStatus && Array.isArray(portalStatus.expectedExits)
        ? portalStatus.expectedExits.filter(Number.isInteger)
        : (Number.isInteger(model.expectedExit) ? [model.expectedExit] : []));
    const portal = mechanicId === 'portal' &&
      (rulesVersion === 1 || rulesVersion === 2) && Array.isArray(definitions)
      ? {
        icon: portalStatus && portalStatus.icon,
        rulesVersion,
        portals: normalizedDefinitions,
        phase: portalPhase,
        expectedExits,
        expectedExit: rulesVersion === 1 && expectedExits.length === 1
          ? expectedExits[0] : null,
        instruction: portalInstructions.forState(portalStatus || { phase: portalPhase }),
        lockedEntry: portalStatus && Number.isInteger(portalStatus.lockedEntry)
          ? portalStatus.lockedEntry : null
      }
      : null;
    const portalCells = new Set();
    if (portal) {
      portal.portals.forEach(definition => {
        const declaredCells = definition &&
          (definition.cells === undefined ? definition.Cells : definition.cells);
        const cells = Array.isArray(declaredCells)
          ? declaredCells
          : [definition && (definition.A === undefined ? definition.a : definition.A),
            definition && (definition.B === undefined ? definition.b : definition.B)];
        cells.forEach(index => {
          if (Number.isInteger(index) && index >= 0 && index < total) portalCells.add(index);
        });
      });
    }
    return {
      board: {
        width,
        height,
        lines,
        cells: new Array(total).fill(null).map((unused, index) => ({
          index,
          blocked: blockedSet.has(index),
          owner: -1,
          fixedLine: fixedLine[index],
          selected: false,
          portal: portalCells.has(index)
        })),
        completedPaths: [],
        selection: { lineIndex: -1, cells: [], segments: [], teleports: [] },
        clearAnimation: model.clearAnimation || null,
        hint: model.hint || null,
        hintUntil: model.hintUntil
      },
      mechanic: { portal }
    };
  }

  renderBoardViewModel(model, level, now) {
    const preview = model && model.hintPreview;
    const previewUntil = preview && Number(preview.until);
    if (preview && preview.viewModel && (preview.manual === true || Number(now) < previewUntil)) {
      if (Array.isArray(preview.frames) && preview.frames.length) {
        const index = clamp(Number(preview.index) || 0, 0, preview.frames.length - 1);
        return preview.frames[index];
      }
      return preview.viewModel;
    }
    if (model && model.board) return model;
    const fallback = this.fallbackBoardViewModel(model || {}, level);
    return fallback ? {
      scene: model && model.scene,
      board: fallback.board,
      mechanic: fallback.mechanic
    } : model;
  }

  drawPlayInstruction(instruction, rect, now) {
    if (typeof instruction !== 'string' || !instruction || !rect) return;
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : 0;
    const phase = (timestamp % PLAY_PROMPT_CYCLE_MS) / PLAY_PROMPT_CYCLE_MS;
    const breath = 0.5 + Math.sin(phase * Math.PI * 2) * 0.5;
    const baseSize = clamp(this.platform.metrics.width * 0.041, 14, 16);
    // At most two short lines in the existing 32px band; ordinary/Portal
    // single-line copy keeps its exact original centre and size.
    const lines = instruction.split('\n').slice(0, 2);
    lines.forEach((line, index) => this.text(
      line,
      rect.x + rect.w / 2,
      rect.y + rect.h / 2 + (index - (lines.length - 1) / 2) * 16,
      baseSize * (0.985 + breath * 0.03),
      {
        weight: 400,
        alpha: 0.72 + breath * 0.22,
        maxWidth: rect.w
      }
    ));
  }

  drawPlay(model, now) {
    const skin = this.skinService.current();
    const { width, safeTop, safeBottom } = this.platform.metrics;
    const setStyle = this.skinService.setStyle(model.set);
    const game = model.level;
    const renderModel = this.renderBoardViewModel(model, game, now);
    const board = renderModel && renderModel.board;
    const portal = renderModel && renderModel.mechanic && renderModel.mechanic.portal;
    const instruction = model.scene === 'result'
      ? null : (portal ? portal.instruction : model.beginnerInstruction);
    // Keep the band after copy disappears, including during result transitions.
    const hasPromptBand = !!portal || !!model.beginnerInstruction;
    this.begin(setStyle.background);

    const headerTop = safeTop;
    const headerHeight = 70;
    const topUi = headerTop + (skin.layout.playTopUiOffset || 0);
    const controlSize = 42;
    // Center the single-row controls on the level title; time stays below it.
    const controlTop = topUi + 5;
    // Preserve the pre-theme control positions.  A manifest can opt into the
    // newer margin/gap tokens, but classic continues to use playRightShift so
    // existing layouts and touch targets remain unchanged.
    const hasExplicitMargin = skin.layout.playRightMargin !== undefined;
    const hasExplicitGap = skin.layout.playControlGap !== undefined;
    const rightShift = Number(skin.layout.playRightShift) || 0;
    const resetX = hasExplicitMargin
      ? width - Number(skin.layout.playRightMargin) - controlSize
      : width - 100 + rightShift;
    const soundX = hasExplicitMargin || hasExplicitGap
      ? resetX - (hasExplicitGap ? Number(skin.layout.playControlGap) : 8) - controlSize
      : width - 148 + rightShift;
    const ctx = this.ctx;
    ctx.fillStyle = skin.colors.panel;
    ctx.fillRect(0, 0, width, topUi + headerHeight);
    this.iconButton('play:back', { x: 8, y: controlTop, w: 44, h: 44 }, 'back', true, model.pressedId);
    this.iconButton('play:sound', { x: soundX, y: controlTop, w: controlSize, h: 44 },
      model.soundEnabled ? 'sound' : 'mute', true, model.pressedId);
    const hintPreviewActive = !!(model.hintPreview && (model.hintPreview.manual === true || now < model.hintPreview.until));
    this.iconButton('play:reset', { x: resetX, y: controlTop, w: controlSize, h: 44 }, 'reset', model.scene !== 'result' && !hintPreviewActive, model.pressedId);

    const ordinaryNumber = Number(model.ordinaryLevelNumber);
    const ordinaryCount = Number(model.ordinaryLevelCount);
    const hasOrdinaryNumber = Number.isInteger(ordinaryNumber) && ordinaryNumber > 0 &&
      Number.isInteger(ordinaryCount) && ordinaryCount >= ordinaryNumber;
    const numberedTitle = hasOrdinaryNumber
      ? `${ordinaryNumber} / ${ordinaryCount}`
      : `${model.levelIndex + 1} / ${(model.set.Games || []).length}`;
    this.text(model.trial ? '冰封试玩' : numberedTitle, width / 2, topUi + 27, model.trial ? 18 : 24, {
      weight: 300,
      maxWidth: width - 220
    });
    this.text(model.elapsedText || '0:00', width / 2, topUi + 51, 12, { alpha: 0.62 });

    const failedResult = model.scene === 'result' && model.result && model.result.outcome === 'failed';
    // Keep the failed board in its exact play-layout position so the remaining
    // cells stay visible behind the modal. The actions are drawn disabled and
    // their hits are removed by drawFailureDialog().
    const showActions = model.scene !== 'result' || failedResult;
    const actionHeight = showActions ? 78 : 0;
    const actionTop = safeBottom - actionHeight;
    const defaultBoardTop = headerTop + headerHeight + 16;
    const boardTop = hasPromptBand
      ? Math.max(defaultBoardTop, topUi + headerHeight + 8)
      : defaultBoardTop;
    const boardBottom = actionTop - (showActions ? 14 : 20);
    if (board) {
      const cols = Number(board.width) || game.Width;
      const rows = Number(board.height) || game.Height;
      const promptBandHeight = hasPromptBand ? PLAY_PROMPT_BAND_HEIGHT : 0;
      const availableHeight = Math.max(0, boardBottom - boardTop);
      const cell = Math.min(
        (width - 24) / cols,
        Math.max(0, availableHeight - promptBandHeight) / rows,
        78
      );
      const boardWidth = cell * cols;
      const boardHeight = cell * rows;
      const groupHeight = promptBandHeight + boardHeight;
      const groupY = boardTop + Math.max(0, (availableHeight - groupHeight) / 2);
      const boardX = (width - boardWidth) / 2;
      const boardY = groupY + promptBandHeight;
      this.boardLayout = { x: boardX, y: boardY, cell, cols, rows };
      if (hasPromptBand) {
        this.drawPlayInstruction(instruction, {
          x: 24,
          y: groupY,
          w: Math.max(1, width - 48),
          h: promptBandHeight
        }, now);
      }
      this.boardRenderer.draw(renderModel, this.boardLayout, setStyle.palette, now, {
        levelEnteredAt: model.levelEnteredAt,
        animateBlocked: true
      });
    }
    if (showActions) this.drawPlayActions(Object.assign({}, model, { hintStepLabel: renderModel && renderModel.hintStepLabel }), actionTop, now);

    if (model.scene === 'result') this.drawResult(model, now);
  }

  drawPlayActions(model, actionTop, now) {
    const skin = this.skinService.current();
    const { width } = this.platform.metrics;

    const gap = 12;
    const margin = 22;
    const buttonWidth = (width - margin * 2 - gap) / 2;
    const rectY = actionTop + 12;
    const rectH = 50;
    const hintPreviewActive = !!(model.hintPreview && (model.hintPreview.manual === true || now < model.hintPreview.until));
    const manualPreview = hintPreviewActive && model.hintPreview.manual === true;
    this.button('play:hint', { x: margin, y: rectY, w: buttonWidth, h: rectH },
      hintPreviewActive ? '隐藏提示' : (model.hintLabel || '提示'), {
      fontSize: 17,
      icon: 'hint',
      enabled: model.hintAvailable !== false,
      fill: skin.colors.primaryButton,
      stroke: skin.colors.primaryButtonStroke
    }, model.pressedId);
    if (manualPreview) {
      const preview = model.hintPreview;
      const x = margin + buttonWidth + gap;
      this.iconButton('hint:prev', { x, y: rectY + 3, w: 44, h: 44 },
        'back', preview.index > 0, model.pressedId);
      this.iconButton('hint:next', { x: x + buttonWidth - 44, y: rectY + 3, w: 44, h: 44 },
        'next', preview.index < preview.frames.length - 1, model.pressedId);
      this.text(`${preview.index + 1}/${preview.frames.length}`, x + buttonWidth / 2, rectY + rectH / 2,
        12, { maxWidth: buttonWidth - 88 });
      this.text('左右滑动切换步骤', width / 2, rectY + rectH + 8, 10, { alpha: 0.62 });
    } else this.button('play:undo', {
      x: margin + buttonWidth + gap,
      y: rectY,
      w: buttonWidth,
      h: rectH
    }, '回撤', {
      fontSize: 17,
      icon: 'undo',
      enabled: model.canUndo === true && !hintPreviewActive,
      fill: skin.colors.secondaryButton,
      stroke: skin.colors.primaryButtonStroke
    }, model.pressedId);
    if (hintPreviewActive) {
      this.text(model.hintStepLabel || '完整通关路径', width / 2, actionTop - (model.hintStepLabel ? 7 : 19), 12,
        { alpha: 0.76, maxWidth: width - 24 });
    }
  }

  dailyChallenge(model) {
    if (!model) return null;
    return model.challenge || model.dailyChallenge || null;
  }

  dailyDimension(challenge, upper, lower, fallback) {
    if (!challenge) return fallback;
    const value = challenge[upper] === undefined ? challenge[lower] : challenge[upper];
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  dailyPalette(challenge, skin) {
    const palette = challenge && (challenge.Palette || challenge.palette);
    if (Array.isArray(palette) && palette.length) return palette;
    const fallback = skin && (skin.palette || (skin.colors && skin.colors.palette));
    return Array.isArray(fallback) && fallback.length ? fallback : ['#ffffff'];
  }

  drawBlockedCell(x, y, size, alpha, skin) {
    const ctx = this.ctx;
    const colors = (skin && skin.colors) || {};
    const fill = colors.blockedCell || 'rgba(0,0,0,0.18)';
    const stroke = colors.blockedCellStroke || 'rgba(255,255,255,0.12)';
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    // A blocked cell is deliberately not passed through drawTile: it has no
    // owner, endpoint, hint, or board hit target.  A subtle inset/outline
    // keeps the hole legible on both light and dark theme backgrounds.
    if (typeof ctx.fillRect === 'function') {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, size, size);
    }
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, size - 1), Math.max(0, size - 1));
    }
    ctx.restore();
  }

  drawDaily(model, now) {
    const skin = this.skinService.current();
    const metrics = this.platform.metrics;
    const width = metrics.width;
    const safeTop = metrics.safeTop || 0;
    const safeBottom = metrics.safeBottom || metrics.height;
    const challenge = this.dailyChallenge(model);
    const renderModel = this.renderBoardViewModel(model, challenge, now);
    const board = renderModel && renderModel.board;
    const cols = board && Number(board.width) > 0
      ? Number(board.width) : this.dailyDimension(challenge, 'Width', 'width', 8);
    const rows = board && Number(board.height) > 0
      ? Number(board.height) : this.dailyDimension(challenge, 'Height', 'height', 10);
    const palette = this.dailyPalette(challenge, skin);
    const background = (challenge && (challenge.Color || challenge.color)) || skin.colors.homeBackground;
    this.begin(background);

    const headerTop = safeTop;
    // Daily headers carry the round indicator and board dimensions in
    // addition to the date. Keep a little extra vertical room so the 3×3
    // intro and 8×10 hard board share the same safe-area contract.
    const headerHeight = 82;
    const topUi = headerTop + (skin.layout.playTopUiOffset || 0);
    const controlSize = 42;
    const hasExplicitMargin = skin.layout.playRightMargin !== undefined;
    const hasExplicitGap = skin.layout.playControlGap !== undefined;
    const rightShift = Number(skin.layout.playRightShift) || 0;
    const resetX = hasExplicitMargin
      ? width - Number(skin.layout.playRightMargin) - controlSize
      : width - 100 + rightShift;
    const soundX = hasExplicitMargin || hasExplicitGap
      ? resetX - (hasExplicitGap ? Number(skin.layout.playControlGap) : 8) - controlSize
      : width - 148 + rightShift;
    const isResult = model && model.scene === 'dailyResult';
    const soundAction = isResult ? 'dailyResult:sound' : 'daily:sound';
    // Keep the top-left back affordance distinct from the result-panel home
    // button so one logical action does not create duplicate hit records.
    const backAction = isResult ? 'dailyResult:back' : 'daily:home';
    const ctx = this.ctx;
    ctx.fillStyle = skin.colors.panel;
    ctx.fillRect(0, 0, width, topUi + headerHeight);
    this.iconButton(backAction, { x: 8, y: topUi + 12, w: 44, h: 44 }, 'back', true, model && model.pressedId);
    this.iconButton(soundAction, { x: soundX, y: topUi + 12, w: controlSize, h: 44 },
      model && model.soundEnabled === false ? 'mute' : 'sound', true, model && model.pressedId);
    const hintPreviewActive = !!(model && model.hintPreview && now < model.hintPreview.until);
    this.iconButton('daily:reset', { x: resetX, y: topUi + 12, w: controlSize, h: 44 },
      'reset', !isResult && !!board && !hintPreviewActive, model && model.pressedId);

    const levelIndex = Math.max(0, Number(model && (
      model.dailyLevelIndex === undefined ? model.levelIndex : model.dailyLevelIndex
    )) || 0);
    const levelCount = Math.max(1, Number(model && (
      model.dailyLevelCount === undefined ? model.levelCount : model.dailyLevelCount
    )) || 1);
    const difficulty = challenge && (
      challenge.DifficultyLabel || challenge.difficultyLabel ||
      challenge.Difficulty || challenge.difficulty
    );
    this.text(`每日挑战  ${Math.min(levelIndex + 1, levelCount)} / ${levelCount}`,
      width / 2, topUi + 21, 20, { weight: 300, maxWidth: width - 180 });
    const dateKey = model && model.dailyDateKey;
    const entryKnown = model && (model.dailyDebugUnlimited === true ||
      (model.dailyEntriesRemaining !== undefined && model.dailyEntryLimit !== undefined));
    const entryText = entryKnown
      ? (model.dailyDebugUnlimited === true
        ? '次数不限'
        : `剩余次数 ${Math.max(0, Number(model.dailyEntriesRemaining) || 0)} / ${Math.max(1, Number(model.dailyEntryLimit) || 1)}`)
      : '';
    const specText = `${cols} × ${rows}`;
    this.text(
      [specText, difficulty || '', dateKey || '', entryText].filter(Boolean).join(' · '),
      width / 2,
      topUi + 48,
      11,
      { alpha: 0.62, maxWidth: width - 96 }
    );

    // Keep the same vertical budget as the ordinary board while using the
    // current daily level's declared geometry (3×3 intro or 8×10 extreme).
    const failedResult = isResult && model && model.result && model.result.outcome === 'failed';
    const showActions = !isResult || failedResult;
    const actionHeight = showActions ? 78 : 0;
    const actionTop = safeBottom - actionHeight;
    const boardTop = headerTop + headerHeight + 16;
    const boardBottom = actionTop - (showActions ? 14 : 20);
    const cell = Math.min(
      (width - 24) / cols,
      (boardBottom - boardTop) / rows,
      78
    );
    const boardWidth = cell * cols;
    const boardHeight = cell * rows;
    const boardX = (width - boardWidth) / 2;
    const boardY = boardTop + Math.max(0, (boardBottom - boardTop - boardHeight) / 2);
    if (board) {
      this.boardLayout = { x: boardX, y: boardY, cell, cols, rows };
      this.boardRenderer.draw(renderModel, this.boardLayout, palette, now, {
        levelEnteredAt: model.levelEnteredAt,
        animateBlocked: false
      });
      if (showActions) this.drawDailyActions(model, actionTop, now);
    }

    if (isResult) this.drawDailyResult(model, now);
  }

  drawDailyActions(model, actionTop, now) {
    const skin = this.skinService.current();
    const width = this.platform.metrics.width;
    const gap = 12;
    const margin = 22;
    const buttonWidth = (width - margin * 2 - gap) / 2;
    const rectY = actionTop + 12;
    const rectH = 50;
    const hintPreviewActive = !!(model.hintPreview && now < model.hintPreview.until);
    this.button('daily:hint', { x: margin, y: rectY, w: buttonWidth, h: rectH },
      hintPreviewActive ? '隐藏提示' : (model.hintLabel || '提示'), {
      fontSize: 17,
      icon: 'hint',
      enabled: model.hintAvailable !== false,
      fill: skin.colors.primaryButton,
      stroke: skin.colors.primaryButtonStroke
    }, model.pressedId);
    this.button('daily:undo', {
      x: margin + buttonWidth + gap,
      y: rectY,
      w: buttonWidth,
      h: rectH
    }, '回撤', {
      fontSize: 17,
      icon: 'undo',
      enabled: model.canUndo === true && !hintPreviewActive,
      fill: skin.colors.secondaryButton,
      stroke: skin.colors.primaryButtonStroke
    }, model.pressedId);
    if (hintPreviewActive) {
      this.text('完整通关路径', width / 2, actionTop - 19, 12, { alpha: 0.76 });
    }
  }

  drawResultPanel(desiredHeight, options) {
    const opts = options || {};
    const { width, height } = this.platform.metrics;
    const safeTop = Number(this.platform.metrics.safeTop) || 0;
    const safeBottom = Number(this.platform.metrics.safeBottom) || height;
    const panelHeight = Math.min(desiredHeight, Math.max(0, safeBottom - safeTop - 16));
    const panelY = clamp((height - panelHeight) / 2 + (opts.offsetY || 0),
      safeTop + 8, safeBottom - panelHeight - 8);
    // The existing ordinary success panel is the visual contract: an edge-to-
    // edge band, with no rounded frame or extra full-screen dimming layer.
    this.ctx.save();
    this.ctx.globalAlpha = opts.opacity === undefined ? 1 : opts.opacity;
    if (opts.background) {
      // Cover underlying cards or result labels inside the reward band
      // before applying the same translucent result token.
      this.ctx.fillStyle = opts.background;
      this.ctx.fillRect(0, panelY, width, panelHeight);
    }
    this.ctx.fillStyle = this.skinService.current().colors.strongPanel;
    this.ctx.fillRect(0, panelY, width, panelHeight);
    this.ctx.restore();
    return { x: 0, y: panelY, w: width, h: panelHeight };
  }

  drawFailureDialog(model, now, options) {
    const opts = options || {};
    const result = model.result || {};
    const visibleAt = Number(opts.visibleAt === undefined ? model.resultVisibleAt : opts.visibleAt) || 0;

    // A terminal failure is modal from the commit boundary, not merely from
    // the first visible dialog frame. Remove every underlying hit immediately
    // so the delayed final clear animation cannot leak taps to board controls.
    this.hits = [];
    if (now < visibleAt) return;

    const width = this.platform.metrics.width;
    const daily = opts.daily === true;
    const enter = clamp((now - visibleAt) / 180, 0, 1);
    const eased = 1 - Math.pow(1 - enter, 3);
    const panel = this.drawResultPanel(daily ? 268 : 246,
      { opacity: eased, offsetY: (1 - eased) * 8 });
    const panelY = panel.y;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = eased;
    this.drawIcon('warning', width / 2, panelY + 47, 40);
    ctx.restore();
    this.text('挑战失败', width / 2, panelY + 92, 27, { weight: 300, alpha: eased });
    this.text(`还有 ${Math.max(1, Number(result.remainingCells) || 1)} 个空格未消除`,
      width / 2, panelY + 124, 13, { alpha: 0.72 * eased, maxWidth: width - 32 });
    this.text('连接棋子的同时，需要经过全部格子',
      width / 2, panelY + 146, 12, { alpha: 0.68 * eased, maxWidth: width - 32 });
    if (daily) {
      this.text('重试当前关不会额外消耗次数',
        width / 2, panelY + 168, 11, { alpha: 0.56 * eased, maxWidth: width - 32 });
    }

    const backAction = daily ? 'dailyResult:home' : 'result:levels';
    const retryAction = daily ? 'dailyFailure:retry' : 'failure:retry';
    const backLabel = daily || model.trial ? '返回主页' : '返回选关';
    const retryLabel = daily ? '重试本关' : '重新开始';
    const buttonGap = 10;
    const buttonWidth = Math.min(142, (width - 48 - buttonGap) / 2);
    const buttonX = (width - buttonWidth * 2 - buttonGap) / 2;
    const buttonY = panelY + panel.h - 72;
    this.button(backAction, { x: buttonX, y: buttonY, w: buttonWidth, h: 46 }, backLabel, {
      fontSize: 15,
      opacity: eased
    }, model.pressedId);
    this.button(retryAction, {
      x: buttonX + buttonWidth + buttonGap,
      y: buttonY,
      w: buttonWidth,
      h: 46
    }, retryLabel, {
      fontSize: 15,
      opacity: eased
    }, model.pressedId);
  }

  drawDailyResult(model, now) {
    const { width } = this.platform.metrics;
    const visibleAt = Number(model.dailyResultVisibleAt || model.resultVisibleAt) || 0;
    const result = model.result || {};
    if (result.outcome === 'failed') {
      this.drawFailureDialog(model, now, { daily: true, visibleAt });
      return;
    }
    if (now < visibleAt) return;
    // The daily result has one extra status line (round count and remaining
    // entries). Keep a minimum panel height so that line never overlaps the
    // action buttons on compact phones.
    const sharing = model.shareAvailable === true;
    const extraEntry = model.dailyExtraEntryAvailable === true;
    const extraRows = Number(sharing) + Number(extraEntry);
    const panel = this.drawResultPanel(300 + extraRows * 52);
    const panelY = panel.y;
    this.drawIcon('check', width / 2, panelY + 47, 40);
    const levelCount = Math.max(1, Number(model.dailyLevelCount || (model.levels && model.levels.length) || 1));
    this.text(`每日挑战完成  ${levelCount} / ${levelCount}`, width / 2, panelY + 92, 27,
      { weight: 300, maxWidth: width - 48 });
    this.text(`用时 ${formatTime(result.elapsedMs || 0)}`, width / 2, panelY + 124, 13, { alpha: 0.72 });
    const rewardFeedback = resultRewardFeedback(model, result, '今日奖励已领取');
    if (rewardFeedback) this.text(rewardFeedback.text, width / 2, panelY + 142, 12, { alpha: 0.72 });
    if (rewardFeedback && rewardFeedback.retry) {
      this.addHit('reward:retry', { x: width / 2 - 64, y: panelY + 128, w: 128, h: 28 }, true);
    }
    if (model.dailyDateKey) {
      this.text(model.dailyDateKey, width / 2, panelY + 157, 11, { alpha: 0.56 });
    }
    if (model.dailyDebugUnlimited === true ||
        (model.dailyEntriesRemaining !== undefined && model.dailyEntryLimit !== undefined)) {
      this.text(
        model.dailyDebugUnlimited === true
          ? '次数不限'
          : `剩余次数 ${Math.max(0, Number(model.dailyEntriesRemaining) || 0)} / ${Math.max(1, Number(model.dailyEntryLimit) || 1)}`,
        width / 2,
        panelY + 175,
        11,
        { alpha: 0.56 }
      );
    }

    const gap = 10;
    const buttonWidth = Math.min(142, (width - 48 - gap) / 2);
    const totalWidth = buttonWidth * 2 + gap;
    const x = (width - totalWidth) / 2;
    const y = panelY + panel.h - 72 - extraRows * 52;
    this.button('dailyResult:home', { x, y, w: buttonWidth, h: 46 }, '返回主页', {
      fontSize: 15
    }, model.pressedId);
    this.button('dailyResult:replay', { x: x + buttonWidth + gap, y, w: buttonWidth, h: 46 }, '重玩', {
      fontSize: 15,
      enabled: model.dailyEntryAvailable !== false && model.dailyCanEnter !== false
    }, model.pressedId);
    if (sharing) this.button('dailyResult:share', { x, y: y + 52, w: totalWidth, h: 44 },
      '分享挑战', { fontSize: 16, enabled: !model.sharePending }, model.pressedId);
    if (extraEntry) this.button('daily:extraEntry', { x, y: y + (sharing ? 104 : 52), w: totalWidth, h: 44 },
      model.dailyExtraEntryPending ? '正在处理' : '看视频，增加一次挑战',
      { fontSize: 15, enabled: !model.dailyExtraEntryPending }, model.pressedId);
    if (model.dailyRewardMessage) this.text(model.dailyRewardMessage, width / 2, panelY + 185, 11, { maxWidth: width - 40 });
  }

  drawHintPath(hint, palette, now, portalCells) {
    const excluded = portalCells instanceof Set
      ? portalCells : new Set(Array.isArray(portalCells) ? portalCells : []);
    return this.boardRenderer.drawHintPath(hint, palette, now, this.boardLayout, excluded);
  }

  drawClearAnimation(animation, palette, now, gap, portalCells) {
    const excluded = portalCells instanceof Set
      ? portalCells : new Set(Array.isArray(portalCells) ? portalCells : []);
    return this.boardRenderer.drawClearAnimation(
      animation,
      palette,
      now,
      gap,
      this.boardLayout,
      excluded
    );
  }

  drawResult(model, now) {
    const { width } = this.platform.metrics;
    if (model.result && model.result.outcome === 'failed') {
      this.drawFailureDialog(model, now, { daily: false, visibleAt: model.resultVisibleAt });
      return;
    }
    if (now < model.resultVisibleAt) return;

    const sharing = model.shareAvailable === true;
    const panel = this.drawResultPanel(sharing ? 300 : 246);
    const panelY = panel.y;
    this.drawIcon('check', width / 2, panelY + 47, 40);
    this.text(model.trial ? '试玩完成' : model.result.newBest ? '新纪录' : '完成',
      width / 2, panelY + 92, 27, { weight: 300 });
    const resultText = model.trial ? `用时 ${formatTime(model.result.elapsedMs)} · 不计入主线进度`
      : `本次 ${formatTime(model.result.elapsedMs)} · 最佳 ${formatTime(model.result.bestMs)}`;
    this.text(resultText, width / 2, panelY + 124, 13, { alpha: 0.72 });
    const rewardFeedback = resultRewardFeedback(model, model.result, '本关奖励已领取');
    if (rewardFeedback) this.text(rewardFeedback.text, width / 2, panelY + 146, 12, { alpha: 0.68 });
    if (rewardFeedback && rewardFeedback.retry) {
      this.addHit('reward:retry', { x: width / 2 - 64, y: panelY + 132, w: 128, h: 28 }, true);
    }

    const gap = 10;
    const buttonCount = model.trial ? 2 : 3;
    const buttonWidth = Math.min(model.trial ? 142 : 104, (width - 48 - gap * (buttonCount - 1)) / buttonCount);
    const totalWidth = buttonWidth * buttonCount + gap * (buttonCount - 1);
    const x = (width - totalWidth) / 2;
    const y = panelY + panel.h - (sharing ? 118 : 72);
    this.button('result:levels', { x, y, w: buttonWidth, h: 46 },
      model.trial ? '返回主页' : '选关', { fontSize: 15 }, model.pressedId);
    this.button('result:replay', { x: x + buttonWidth + gap, y, w: buttonWidth, h: 46 }, '重玩', { fontSize: 15 }, model.pressedId);
    if (!model.trial) this.button('result:next', { x: x + (buttonWidth + gap) * 2, y, w: buttonWidth, h: 46 },
      model.hasNext ? '下一关' : '关卡列表', { fontSize: 15 }, model.pressedId);
    if (sharing) this.button('result:share', { x, y: y + 52, w: totalWidth, h: 44 },
      '分享成绩', { fontSize: 16, enabled: !model.sharePending }, model.pressedId);
  }

  drawRewardDialog(model) {
    const dialog = model.rewardDialog;
    if (!dialog) return;
    this.interactionMap.clear();
    const width = this.platform.metrics.width;
    const panel = this.drawResultPanel(246,
      { background: this.sceneBackground || this.skinService.current().colors.homeBackground });
    const unlocked = dialog.mode === 'unlocked';
    const statusIcon = unlocked ? 'check' : 'lock';
    const preview = dialog.preview;
    const previewRect = { x: width / 2 - 20, y: panel.y + 27, w: 40, h: 40 };
    if (preview && dialog.rewardId.indexOf('theme:') === 0) {
      this.drawThemeElementsPreview(preview, previewRect, this.skinService.current());
      this.drawIcon(statusIcon, width / 2 + 24, panel.y + 62, 14);
    } else if (preview && dialog.rewardId.indexOf('effect:') === 0) {
      const image = this.ensureEffectPreviewImage(preview);
      if (!image || !this.drawImageContain(image, previewRect, { fit: 'contain' })) {
        this.drawEffectFallbackPreview(previewRect, preview);
      }
      this.drawIcon(statusIcon, width / 2 + 24, panel.y + 62, 14);
    } else {
      this.drawIcon(statusIcon, width / 2, panel.y + 47, 40);
    }
    this.text(dialog.title || '', width / 2, panel.y + 92, 27, { weight: 300, maxWidth: width - 48 });
    this.text(dialog.message || '', width / 2, panel.y + 124, 13, { alpha: 0.72, maxWidth: width - 32 });
    this.text(unlocked ? '解锁成功' : '解锁条件', width / 2, panel.y + 146, 12, { alpha: 0.68 });
    const gap = 10;
    const buttonCount = Number(!!dialog.secondaryAction) + Number(!!dialog.primaryAction);
    if (!buttonCount) return;
    const buttonWidth = Math.min(142, (width - 48 - gap * (buttonCount - 1)) / buttonCount);
    const x = (width - buttonWidth * buttonCount - gap * (buttonCount - 1)) / 2;
    const y = panel.y + panel.h - 72;
    if (dialog.secondaryAction) this.button(dialog.secondaryAction,
      { x, y, w: buttonWidth, h: 46 }, dialog.secondaryLabel || '关闭', { fontSize: 15 }, model.pressedId);
    if (dialog.primaryAction) this.button(dialog.primaryAction,
      { x: x + (dialog.secondaryAction ? buttonWidth + gap : 0), y, w: buttonWidth, h: 46 }, dialog.primaryLabel || '确定',
      { fontSize: 15, enabled: dialog.primaryEnabled !== false && !['working', 'loading'].includes(dialog.state) }, model.pressedId);
  }

}

module.exports = CanvasRenderer;
