'use strict';

const defaultConfig = require('../config/subpackages.js');

function safeKey(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value) &&
    value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

function state(name, status, errorCode) {
  return {
    name, status, progress: status === 'loaded' ? 100 : 0,
    totalBytesWritten: 0, totalBytesExpectedToWrite: 0,
    attempts: 0, errorCode: errorCode || null
  };
}

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function positiveNumber(value, maximum) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(maximum, number)) : 0;
}

class SubpackageService {
  constructor(platform, config) {
    this.platform = platform;
    // Process-local only: WeChat can evict downloaded packages between runs.
    this.records = Object.create(null);
    this.themes = Object.create(null);
    this.prefixes = [];
    (config || defaultConfig).packages.forEach(item => {
      if (!safeKey(item.name) || this.records[item.name]) {
        throw failure('SUBPACKAGE_INVALID_NAME');
      }
      this.records[item.name] = {
        state: state(item.name, 'idle'), promise: null, listeners: []
      };
      item.themeIds.forEach(id => {
        if (!safeKey(id) || id === 'classic' || this.themes[id]) {
          throw failure('SUBPACKAGE_INVALID_THEME');
        }
        this.themes[id] = item.name;
      });
      item.assetPrefixes.forEach(prefix => {
        if (typeof prefix !== 'string' || !prefix.endsWith('/') ||
            prefix.startsWith('/') || prefix.split('/').some(part => part === '..' || part === '.')) {
          throw failure('SUBPACKAGE_INVALID_PREFIX');
        }
        this.prefixes.push({ prefix, name: item.name });
      });
    });
    this.prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  }

  packageForTheme(themeId) {
    return safeKey(themeId) ? this.themes[themeId] || null : null;
  }

  packageForAsset(source) {
    if (typeof source !== 'string') return null;
    const match = this.prefixes.find(item => source.startsWith(item.prefix));
    return match ? match.name : null;
  }

  getPackageState(name) {
    const record = safeKey(name) && this.records[name];
    return record ? Object.assign({}, record.state)
      : state(null, 'failed', 'SUBPACKAGE_INVALID_NAME');
  }

  getThemeState(themeId) {
    if (themeId === 'classic') return state(null, 'loaded');
    const name = this.packageForTheme(themeId);
    return name ? this.getPackageState(name)
      : state(null, 'failed', 'SUBPACKAGE_INVALID_THEME');
  }

  isPackageReady(name) {
    return this.getPackageState(name).status === 'loaded';
  }

  isAssetReady(source) {
    const name = this.packageForAsset(source);
    return !name || this.isPackageReady(name);
  }

  ensureTheme(themeId, onProgress) {
    if (themeId === 'classic') return Promise.resolve(this.getThemeState(themeId));
    const name = this.packageForTheme(themeId);
    return name ? this.ensurePackage(name, onProgress)
      : Promise.reject(failure('SUBPACKAGE_INVALID_THEME'));
  }

  notify(record, listener) {
    // An observer cannot interrupt settlement or another observer's updates.
    try { listener(Object.assign({}, record.state)); } catch (error) {}
  }

  ensurePackage(name, onProgress) {
    const record = safeKey(name) && this.records[name];
    if (!record) return Promise.reject(failure('SUBPACKAGE_INVALID_NAME'));
    if (record.state.status === 'loaded') {
      if (typeof onProgress === 'function') this.notify(record, onProgress);
      return record.promise;
    }
    if (typeof onProgress === 'function' && !record.listeners.includes(onProgress)) {
      record.listeners.push(onProgress);
    }
    if (record.state.status === 'loading') {
      if (typeof onProgress === 'function') this.notify(record, onProgress);
      return record.promise;
    }

    const attempts = record.state.attempts + 1;
    record.state = Object.assign(state(name, 'loading'), { attempts });
    let resolve;
    let reject;
    // Install the promise before calling a host that may settle synchronously.
    record.promise = new Promise((success, fail) => { resolve = success; reject = fail; });
    const promise = record.promise;
    let settled = false;
    const notifyAll = () => record.listeners.slice().forEach(listener => this.notify(record, listener));
    const finish = error => {
      if (settled) return;
      settled = true;
      record.state.status = error ? 'failed' : 'loaded';
      record.state.errorCode = error ? error.code : null;
      if (!error) record.state.progress = 100;
      const snapshot = Object.assign({}, record.state);
      const listeners = record.listeners.slice();
      record.listeners = [];
      if (error) reject(error);
      else resolve(snapshot);
      listeners.forEach(listener => {
        try { listener(Object.assign({}, snapshot)); } catch (ignored) {}
      });
    };
    notifyAll();
    try {
      if (!this.platform || typeof this.platform.loadSubpackage !== 'function') {
        finish(failure('SUBPACKAGE_UNSUPPORTED'));
      } else {
        this.platform.loadSubpackage(name, {
          success: () => finish(null),
          fail: error => finish(failure(error && error.code === 'SUBPACKAGE_UNSUPPORTED'
            ? 'SUBPACKAGE_UNSUPPORTED' : 'SUBPACKAGE_LOAD_FAILED')),
          progress: update => {
            if (settled) return;
            const value = update || {};
            record.state.progress = positiveNumber(value.progress, 100);
            record.state.totalBytesWritten = positiveNumber(value.totalBytesWritten, Number.MAX_SAFE_INTEGER);
            record.state.totalBytesExpectedToWrite = positiveNumber(value.totalBytesExpectedToWrite, Number.MAX_SAFE_INTEGER);
            notifyAll();
          }
        });
      }
    } catch (error) {
      finish(failure('SUBPACKAGE_LOAD_FAILED'));
    }
    return promise;
  }
}

module.exports = SubpackageService;
