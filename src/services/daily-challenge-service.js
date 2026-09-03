'use strict';

// Daily content is a pure data concern. This service does not access Canvas,
// platform APIs, or progress storage; callers can therefore use it from the
// game and from deterministic tests alike.

const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const DEFAULT_ENTRY_LIMIT = 3;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function valueOf(object, upper, lower) {
  if (!isRecord(object)) return undefined;
  if (object[upper] !== undefined) return object[upper];
  return lower ? object[lower] : undefined;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) {
    const result = {};
    Object.keys(value).forEach(key => {
      // A manifest is data-only. Excluding prototype keys also keeps a
      // malformed external manifest from changing lookup semantics.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      result[key] = clone(value[key]);
    });
    return result;
  }
  return value;
}

function asDate(value) {
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    return Number.isNaN(copy.getTime()) ? null : copy;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function utcDateKey(date) {
  return `${date.getUTCFullYear().toString().padStart(4, '0')}-` +
    `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-` +
    `${date.getUTCDate().toString().padStart(2, '0')}`;
}

function partsDateKey(date, timeZone) {
  // formatToParts avoids locale-specific ordering (and avoids relying on
  // en-CA being installed in a constrained JS runtime).
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const fields = {};
  parts.forEach(part => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      fields[part.type] = part.value;
    }
  });
  if (!fields.year || !fields.month || !fields.day) return null;
  const key = `${fields.year.padStart(4, '0')}-${fields.month.padStart(2, '0')}-${fields.day.padStart(2, '0')}`;
  return isValidDateKey(key) ? key : null;
}

function fixedOffsetDateKey(date, timeZone) {
  // A small fallback for runtimes that do not expose Intl. Asia/Shanghai is
  // the v1 default; UTC and explicit +/-HH[:MM] zones are useful for tests.
  let offsetMinutes = null;
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC' || timeZone === 'GMT') {
    offsetMinutes = 0;
  } else if (timeZone === 'Asia/Shanghai' || timeZone === 'PRC' || timeZone === 'CTT') {
    offsetMinutes = 8 * 60;
  } else {
    const match = typeof timeZone === 'string' && /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(timeZone);
    if (match) {
      offsetMinutes = (Number(match[2]) * 60) + Number(match[3] || 0);
      if (match[1] === '-') offsetMinutes *= -1;
    }
  }
  if (offsetMinutes === null) return null;
  return utcDateKey(new Date(date.getTime() + offsetMinutes * 60 * 1000));
}

function dateKeyFor(date, timeZone) {
  if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
    try {
      return partsDateKey(date, timeZone);
    } catch (error) {
      // Fall through to the deterministic fixed-offset implementation for
      // runtimes without the requested IANA timezone.
    }
  }
  return fixedOffsetDateKey(date, timeZone);
}

function adjacent(one, two, width) {
  return Math.abs((one % width) - (two % width)) +
    Math.abs(Math.floor(one / width) - Math.floor(two / width)) === 1;
}

function challengeId(challenge) {
  return valueOf(challenge, 'Id', 'id');
}

function challengeDateKey(challenge) {
  return valueOf(challenge, 'DateKey', 'dateKey');
}

function challengeWidth(challenge) {
  return valueOf(challenge, 'Width', 'width');
}

function challengeHeight(challenge) {
  return valueOf(challenge, 'Height', 'height');
}

function challengeBlocked(challenge) {
  return valueOf(challenge, 'Blocked', 'blocked');
}

function challengeLines(challenge) {
  return valueOf(challenge, 'Lines', 'lines');
}

function challengePalette(challenge) {
  return valueOf(challenge, 'Palette', 'palette');
}

function usesUnsupportedPortalMechanic(challenge) {
  if (!isRecord(challenge)) return false;
  const mechanic = valueOf(challenge, 'Mechanic', 'mechanic');
  const declaresPortals = own(challenge, 'Portals') || own(challenge, 'portals');
  return mechanic === 'portal' || declaresPortals;
}

function lineValue(line, upper, lower) {
  return valueOf(line, upper, lower);
}

function dayIdOf(day) {
  return valueOf(day, 'Id', 'id') || valueOf(day, 'DayId', 'dayId');
}

function dayDateOf(day) {
  return valueOf(day, 'DateKey', 'dateKey');
}

function dayLevelsOf(day) {
  return valueOf(day, 'Levels', 'levels');
}

function dayEntryLimitOf(day) {
  return valueOf(day, 'EntryLimit', 'entryLimit');
}

function normalizePositiveInteger(value, fallback) {
  if (Number.isInteger(value) && value > 0) return value;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0 && Math.floor(number) === number) return number;
  return fallback;
}

function isAllowedDimension(width, height) {
  return (width === 3 && height === 3) || (width === 8 && height === 10);
}

/**
 * Resolve and validate the local daily challenge manifest.
 *
 * The canonical manifest is `Days[{ Levels: [level0, level1] }]`. Older
 * manifests containing a flat `Challenges` array are still accepted as a
 * one-level migration format; they do not receive the strict two-level day
 * checks.
 */
class DailyChallengeService {
  constructor(manifest, options, legacyOptions) {
    // The documented form is (manifest, { clock, timeZone, solutions }).
    // Accept (manifest, solutions, options) as well for build scripts that
    // keep the two data manifests as separate constructor arguments.
    let suppliedOptions = options;
    let suppliedSolutions = null;
    const looksLikeSolutions = options &&
      (options.ByChallengeId || options.byChallengeId) &&
      !options.clock && !options.timeZone && !options.solutions && !options.solutionCatalog;
    if (looksLikeSolutions && arguments.length > 2) {
      suppliedSolutions = options;
      suppliedOptions = legacyOptions;
    } else if (looksLikeSolutions && arguments.length === 2) {
      // Convenience form: (manifest, dailySolutions).
      suppliedSolutions = options;
      suppliedOptions = {};
    }
    const opts = suppliedOptions || {};
    this.manifest = isRecord(manifest) ? clone(manifest) : {};
    this.clock = typeof opts.clock === 'function' ? opts.clock : () => new Date();
    this.timeZone = opts.timeZone || this.manifest.TimeZone || this.manifest.timeZone || DEFAULT_TIME_ZONE;
    this.solutions = opts.solutions || opts.solutionCatalog || suppliedSolutions || null;
    this.entryLimit = normalizePositiveInteger(
      opts.entryLimit !== undefined
        ? opts.entryLimit
        : valueOf(this.manifest, 'EntryLimit', 'entryLimit'),
      DEFAULT_ENTRY_LIMIT
    );

    const listed = Array.isArray(manifest)
      ? manifest
      : valueOf(this.manifest, 'Challenges', 'challenges');
    // Own a defensive copy so a caller cannot mutate the active manifest (or
    // a resolved snapshot) by retaining a reference to its input object.
    this.challenges = Array.isArray(listed) ? listed.map(clone) : [];
    this.legacyByDateKey = Object.create(null);
    this.legacyById = Object.create(null);
    this.challenges.forEach(challenge => {
      const date = challengeDateKey(challenge);
      const id = challengeId(challenge);
      if (typeof date === 'string') {
        if (!this.legacyByDateKey[date]) this.legacyByDateKey[date] = [];
        this.legacyByDateKey[date].push(challenge);
      }
      if (typeof id === 'string') {
        if (!this.legacyById[id]) this.legacyById[id] = [];
        this.legacyById[id].push(challenge);
      }
    });

    const listedDays = valueOf(this.manifest, 'Days', 'days');
    this.hasDays = Array.isArray(listedDays);
    this.days = [];
    if (this.hasDays) {
      listedDays.forEach((day, index) => this.days.push(this.normalizeDay(day, index)));
    } else {
      // Migration path: group flat challenges by date, retaining duplicate
      // entries so resolve() can report duplicate-date-key instead of silently
      // selecting one.
      const grouped = Object.create(null);
      this.challenges.forEach(challenge => {
        const date = challengeDateKey(challenge);
        if (typeof date !== 'string') return;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(challenge);
      });
      Object.keys(grouped).forEach(date => {
        const entries = grouped[date];
        const first = entries[0];
        this.days.push({
          source: null,
          dateKey: date,
          dayId: challengeId(first),
          entryLimit: this.entryLimit,
          levels: entries.map(clone),
          legacy: true
        });
      });
    }

    this.daysByDateKey = Object.create(null);
    this.dayIds = Object.create(null);
    this.levelIds = Object.create(null);
    this.days.forEach(day => {
      const date = day.dateKey;
      if (typeof date === 'string') {
        if (!this.daysByDateKey[date]) this.daysByDateKey[date] = [];
        this.daysByDateKey[date].push(day);
      }
      if (typeof day.dayId === 'string') {
        if (!this.dayIds[day.dayId]) this.dayIds[day.dayId] = [];
        this.dayIds[day.dayId].push(day);
      }
      (day.levels || []).forEach(level => {
        const id = challengeId(level);
        if (typeof id !== 'string') return;
        if (!this.levelIds[id]) this.levelIds[id] = [];
        this.levelIds[id].push(level);
      });
    });
  }

  normalizeDay(rawDay, index) {
    const source = isRecord(rawDay) ? clone(rawDay) : {};
    let date = dayDateOf(source);
    let rawLevels = dayLevelsOf(source);
    if (!Array.isArray(rawLevels) && isChallengeLike(source)) rawLevels = [source];
    if (!Array.isArray(rawLevels)) rawLevels = [];
    const levels = rawLevels.map((level, levelIndex) => {
      const copy = clone(level);
      if (!date) date = challengeDateKey(copy);
      // DateKey and ContentVersion are owned by the day in the authoring
      // format. Materialize conservative defaults on each level so a valid
      // manifest need not repeat those fields, while still preserving any
      // explicitly supplied invalid value for validation to reject.
      if (copy.DateKey === undefined && copy.dateKey === undefined && date) {
        copy.DateKey = date;
      }
      if (copy.ContentVersion === undefined && copy.contentVersion === undefined) {
        copy.ContentVersion = 1;
      }
      if (copy.LevelIndex === undefined && copy.levelIndex === undefined) {
        copy.LevelIndex = levelIndex;
      }
      return copy;
    });
    // Canonical Days require an explicit stable Id. Do not synthesize one,
    // otherwise an authoring error would evade validateDay(); the legacy flat
    // migration path supplies its id from the legacy challenge itself.
    const id = dayIdOf(source);
    // Preserve an explicitly supplied invalid limit so validateDay() can
    // reject it; only an omitted limit inherits the manifest default.
    const rawLimit = dayEntryLimitOf(source);
    const limit = rawLimit === undefined
      ? this.entryLimit
      : rawLimit;
    return {
      source,
      index,
      dateKey: date,
      dayId: id,
      entryLimit: limit,
      levels,
      legacy: false
    };
  }

  /** Return whether an object resembles a single level/challenge. */
  // Kept as an instance method to make the normalization branch easy to test.
  isChallengeLike(value) {
    return isChallengeLike(value);
  }

  /** Return a strict YYYY-MM-DD key in the configured timezone. */
  dateKey(now) {
    let value = now;
    if (value === undefined) {
      try {
        value = this.clock();
      } catch (error) {
        return null;
      }
    }
    const date = asDate(value);
    return date ? dateKeyFor(date, this.timeZone) : null;
  }

  /**
   * Validate one level object.  `errors` contains stable machine-readable
   * codes so authoring/build tooling can report them without parsing prose.
   */
  validate(challenge, solutionPaths) {
    const errors = [];
    const add = code => {
      if (errors.indexOf(code) < 0) errors.push(code);
    };

    if (!isRecord(challenge)) {
      return { ok: false, errors: ['challenge-not-object'] };
    }

    // Daily challenge schema v1 has no segmented solution/persistence
    // contract. Reject portal selection as well as a stray explicit Portals
    // field instead of flattening the jump into ordinary path semantics.
    if (usesUnsupportedPortalMechanic(challenge)) add('portal-not-supported');

    const id = challengeId(challenge);
    if (typeof id !== 'string' || id.length === 0) add('id-required');

    const date = challengeDateKey(challenge);
    if (!isValidDateKey(date)) add('date-key-invalid');

    const version = valueOf(challenge, 'ContentVersion', 'contentVersion');
    if (!Number.isInteger(version) || version < 1) add('content-version-invalid');

    const width = challengeWidth(challenge);
    const height = challengeHeight(challenge);
    if (!Number.isInteger(width) || width <= 0) add('width-invalid');
    if (!Number.isInteger(height) || height <= 0) add('height-invalid');
    if (Number.isInteger(width) && Number.isInteger(height) &&
        !isAllowedDimension(width, height)) add('dimensions-not-supported');
    const total = Number.isInteger(width) && width > 0 &&
      Number.isInteger(height) && height > 0 ? width * height : 0;

    const blocked = challengeBlocked(challenge);
    const blockedSet = new Set();
    if (!Array.isArray(blocked)) {
      add('blocked-required');
    } else {
      blocked.forEach(index => {
        if (!Number.isInteger(index)) {
          add('blocked-non-integer');
          return;
        }
        if (index < 0 || index >= total) {
          add('blocked-out-of-range');
          return;
        }
        if (blockedSet.has(index)) {
          add('blocked-duplicate');
          return;
        }
        blockedSet.add(index);
      });
    }

    const lines = challengeLines(challenge);
    const endpointSet = new Set();
    if (!Array.isArray(lines) || lines.length === 0) {
      add('lines-required');
    } else {
      lines.forEach(line => {
        if (!isRecord(line)) {
          add('line-not-object');
          return;
        }
        const start = lineValue(line, 'Start', 'start');
        const end = lineValue(line, 'End', 'end');
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
          add('line-endpoint-integer');
          return;
        }
        if (start < 0 || start >= total || end < 0 || end >= total) {
          add('line-endpoint-out-of-range');
        }
        if (blockedSet.has(start) || blockedSet.has(end)) {
          add('line-endpoint-blocked');
        }
        if (start === end) add('line-endpoints-identical');
        [start, end].forEach(endpoint => {
          if (endpointSet.has(endpoint)) add('line-endpoint-duplicate');
          endpointSet.add(endpoint);
        });
      });
    }

    const palette = challengePalette(challenge);
    if (!Array.isArray(palette)) add('palette-required');
    else if (Array.isArray(lines) && palette.length < lines.length) add('palette-too-short');

    if (solutionPaths !== undefined && solutionPaths !== null) {
      const solutionResult = this.validateSolution(challenge, solutionPaths);
      solutionResult.errors.forEach(add);
    }

    return { ok: errors.length === 0, errors };
  }

  /** Validate a canonical two-level day package. */
  validateDay(day, solutionCatalog) {
    const errors = [];
    const add = code => {
      if (errors.indexOf(code) < 0) errors.push(code);
    };
    if (!isRecord(day)) return { ok: false, errors: ['day-not-object'] };

    const date = day.dateKey !== undefined ? day.dateKey : dayDateOf(day);
    if (!isValidDateKey(date)) add('date-key-invalid');
    const id = day.dayId !== undefined ? day.dayId : dayIdOf(day);
    if (typeof id !== 'string' || id.length === 0) add('day-id-required');

    const rawLimit = day.entryLimit !== undefined ? day.entryLimit : dayEntryLimitOf(day);
    if (rawLimit !== undefined && normalizePositiveInteger(rawLimit, null) === null) {
      add('entry-limit-invalid');
    }

    const rawLevels = day.levels !== undefined ? day.levels : dayLevelsOf(day);
    if (!Array.isArray(rawLevels)) {
      add('levels-required');
      return { ok: false, errors };
    }
    if (rawLevels.length !== 2) add('level-count-must-be-2');

    const seenIndexes = new Set();
    const seenIds = new Set();
    rawLevels.forEach((rawLevel, position) => {
      if (!isRecord(rawLevel)) {
        add('level-not-object');
        return;
      }
      const level = clone(rawLevel);
      // When validateDay() is called directly with an authoring object (rather
      // than the service's normalized internal day), inherit fields owned by
      // the day so the public validator matches resolve() semantics.
      if (level.DateKey === undefined && level.dateKey === undefined && isValidDateKey(date)) {
        level.DateKey = date;
      }
      if (level.ContentVersion === undefined && level.contentVersion === undefined) {
        level.ContentVersion = 1;
      }
      const levelDate = challengeDateKey(level);
      if (!isValidDateKey(levelDate)) add('level-date-key-invalid');
      else if (isValidDateKey(date) && levelDate !== date) add('level-date-mismatch');

      const levelId = challengeId(level);
      if (typeof levelId !== 'string' || levelId.length === 0) add('level-id-required');
      else if (seenIds.has(levelId)) add('duplicate-level-id');
      else seenIds.add(levelId);

      const index = valueOf(level, 'LevelIndex', 'levelIndex');
      if (!Number.isInteger(index) || index < 0 || index > 1) add('level-index-invalid');
      else {
        if (seenIndexes.has(index)) add('duplicate-level-index');
        seenIndexes.add(index);
        if (index !== position) add('level-index-order');
      }

      const difficulty = valueOf(level, 'Difficulty', 'difficulty');
      const expectedDifficulty = position === 0 ? 'intro' : 'extreme';
      if (difficulty !== expectedDifficulty) add(`level-${position}-difficulty-invalid`);

      const width = challengeWidth(level);
      const height = challengeHeight(level);
      const expectedWidth = position === 0 ? 3 : 8;
      const expectedHeight = position === 0 ? 3 : 10;
      if (width !== expectedWidth || height !== expectedHeight) {
        add(`level-${position}-dimensions-invalid`);
      }
      const lines = challengeLines(level);
      if (position === 0 && (!Array.isArray(lines) || lines.length !== 2)) {
        add('intro-line-count-must-be-2');
      }

      const validation = this.validate(level);
      validation.errors.forEach(add);
      const paths = solutionCatalog
        ? this.solutionForFrom(levelId, solutionCatalog)
        : this.solutionFor(levelId);
      const hasSolutionCatalog = solutionCatalog !== undefined
        ? !!solutionCatalog : !!this.solutions;
      if (hasSolutionCatalog && !paths) add('missing-solution');
      if (paths) {
        const solutionValidation = this.validateSolution(level, paths);
        solutionValidation.errors.forEach(add);
      }
    });

    return { ok: errors.length === 0, errors };
  }

  /** Validate a level's complete hint/path table. */
  validateSolution(challenge, paths) {
    const errors = [];
    const add = code => {
      if (errors.indexOf(code) < 0) errors.push(code);
    };
    if (!isRecord(challenge)) return { ok: false, errors: ['challenge-not-object'] };
    if (usesUnsupportedPortalMechanic(challenge)) add('portal-not-supported');
    if (!Array.isArray(paths)) {
      add('solution-required');
      return { ok: false, errors };
    }

    const width = challengeWidth(challenge);
    const height = challengeHeight(challenge);
    const total = Number.isInteger(width) && Number.isInteger(height) ? width * height : 0;
    const blocked = challengeBlocked(challenge);
    const blockedSet = new Set(Array.isArray(blocked) ? blocked : []);
    const lines = challengeLines(challenge);
    if (!Array.isArray(lines)) return { ok: false, errors: ['lines-required'] };
    if (paths.length !== lines.length) add('solution-line-count');

    const covered = new Set();
    lines.forEach((line, lineIndex) => {
      const path = paths[lineIndex];
      if (!Array.isArray(path) || path.length < 2) {
        add('solution-path-required');
        return;
      }
      const start = lineValue(line, 'Start', 'start');
      const end = lineValue(line, 'End', 'end');
      if (path[0] !== start) add('solution-start-mismatch');
      if (path[path.length - 1] !== end) add('solution-end-mismatch');
      const local = new Set();
      path.forEach((cell, order) => {
        if (!Number.isInteger(cell)) {
          add('solution-cell-non-integer');
          return;
        }
        if (cell < 0 || cell >= total) {
          add('solution-cell-out-of-range');
          return;
        }
        if (blockedSet.has(cell)) add('solution-through-blocked');
        if (local.has(cell)) add('solution-path-duplicate');
        local.add(cell);
        if (covered.has(cell)) add('solution-overlap');
        covered.add(cell);
        if (order > 0) {
          const previous = path[order - 1];
          if (Number.isInteger(previous) && Number.isInteger(width) &&
              width > 0 && !adjacent(previous, cell, width)) {
            add('solution-non-adjacent');
          }
        }
      });
    });

    const expected = total - blockedSet.size;
    if (expected > 0 && covered.size !== expected) add('solution-incomplete');
    if (blockedSet.size > total) add('solution-blocked-invalid');
    return { ok: errors.length === 0, errors };
  }

  solutionFor(challengeOrId) {
    if (!this.solutions) return null;
    const id = typeof challengeOrId === 'string' ? challengeOrId : challengeId(challengeOrId);
    if (!id) return null;
    const map = valueOf(this.solutions, 'ByChallengeId', 'byChallengeId') || this.solutions;
    if (!isRecord(map)) return null;
    if (Array.isArray(map[id])) return clone(map[id]);
    // Optional day-grouped input is normalized by looking up a level id in
    // each group's Levels/levels map. This keeps the public lookup level-ID
    // based while permitting a transitional authoring format.
    const days = valueOf(map, 'Days', 'days');
    if (Array.isArray(days)) {
      for (let i = 0; i < days.length; i += 1) {
        const group = days[i];
        const grouped = valueOf(group, 'ByChallengeId', 'byChallengeId') ||
          valueOf(group, 'Levels', 'levels');
        if (isRecord(grouped) && Array.isArray(grouped[id])) return clone(grouped[id]);
      }
    }
    return null;
  }

  solutionForFrom(challengeOrId, source) {
    const id = typeof challengeOrId === 'string' ? challengeOrId : challengeId(challengeOrId);
    if (!id || !source) return null;
    const map = valueOf(source, 'ByChallengeId', 'byChallengeId') || source;
    if (!isRecord(map)) return null;
    return Array.isArray(map[id]) ? clone(map[id]) : null;
  }

  /** Resolve the challenge package for a date, or an explicit unavailable result. */
  resolve(now) {
    const date = this.dateKey(now);
    if (!date) return { status: 'unavailable', dateKey: null, reason: 'invalid-date' };

    const matches = this.daysByDateKey[date] || [];
    if (matches.length === 0) {
      return { status: 'unavailable', dateKey: date, reason: 'no-challenge' };
    }
    if (matches.length > 1) {
      return { status: 'unavailable', dateKey: date, reason: 'duplicate-date-key' };
    }

    const day = matches[0];
    const dayId = day.dayId;
    if (typeof dayId !== 'string' || dayId.length === 0 ||
        (this.dayIds[dayId] && this.dayIds[dayId].length > 1)) {
      return { status: 'unavailable', dateKey: date, reason: 'duplicate-day-id' };
    }

    let levels;
    if (this.hasDays) {
      const dayValidation = this.validateDay(day);
      if (!dayValidation.ok) {
        return {
          status: 'unavailable',
          dateKey: date,
          dayId,
          reason: 'invalid-day',
          errors: dayValidation.errors
        };
      }
      levels = day.levels;
    } else {
      // Legacy flat Challenges are intentionally one-level packages. Keep the
      // old validator and reasons for callers that have not migrated yet.
      if (!Array.isArray(day.levels) || day.levels.length !== 1) {
        return { status: 'unavailable', dateKey: date, dayId, reason: 'duplicate-date-key' };
      }
      const validation = this.validate(day.levels[0]);
      if (!validation.ok) {
        return {
          status: 'unavailable', dateKey: date, dayId, reason: 'invalid-challenge',
          errors: validation.errors
        };
      }
      levels = day.levels;
    }

    const duplicateLevel = levels.some(level => {
      const id = challengeId(level);
      return !id || !this.levelIds[id] || this.levelIds[id].length > 1;
    });
    if (duplicateLevel) {
      return { status: 'unavailable', dateKey: date, dayId, reason: 'duplicate-challenge-id' };
    }

    for (let index = 0; index < levels.length; index += 1) {
      const level = levels[index];
      const id = challengeId(level);
      const paths = this.solutionFor(id);
      if (this.solutions && !paths) {
        return { status: 'unavailable', dateKey: date, dayId, reason: 'missing-solution' };
      }
      if (paths) {
        const solutionValidation = this.validateSolution(level, paths);
        if (!solutionValidation.ok) {
          return {
            status: 'unavailable', dateKey: date, dayId,
            reason: 'invalid-solution', errors: solutionValidation.errors
          };
        }
      }
    }

    const snapshot = levels.map(clone);
    return {
      status: 'available',
      dateKey: date,
      dayId,
      // challengeId is a deliberate compatibility alias for old callers that
      // treated a daily package as one challenge. It equals dayId; level IDs
      // are available in levels[].Id / levelIds.
      challengeId: dayId,
      entryLimit: normalizePositiveInteger(day.entryLimit, this.entryLimit),
      levels: snapshot,
      levelIds: snapshot.map(challengeId),
      levelCount: snapshot.length,
      challenge: clone(snapshot[0])
    };
  }
}

function isChallengeLike(value) {
  if (!isRecord(value)) return false;
  return challengeWidth(value) !== undefined || challengeHeight(value) !== undefined ||
    challengeLines(value) !== undefined || challengeBlocked(value) !== undefined;
}

DailyChallengeService.DEFAULT_TIME_ZONE = DEFAULT_TIME_ZONE;
DailyChallengeService.DEFAULT_ENTRY_LIMIT = DEFAULT_ENTRY_LIMIT;
DailyChallengeService.DATE_KEY_RE = DATE_KEY_RE;
DailyChallengeService.isValidDateKey = isValidDateKey;
DailyChallengeService.dateKeyFor = dateKeyFor;
DailyChallengeService.clone = clone;

module.exports = DailyChallengeService;
