'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');
const SRC_DIR = path.join(__dirname, '..', 'src');
const MUTABLE_RUNNER_FIELDS = [
  'portalPending', 'portalLock', 'portalPhase', 'completedPaths',
  'completedSegments', 'completedTeleports', 'selectedCells',
  'selectedSegments', 'selectedLine', 'owner', 'fixedLine', 'blockedMask',
  'portalByCell', 'portals', 'completed', 'outcome', 'failureReason',
  'remainingPlayableCells', 'portalDefinitions', 'portalPolicy',
  'portalRulesVersion', 'iceCells', 'iceEnabled', 'remainingLayers'
];

function dependencies(source) {
  const result = [];
  const patterns = [
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(source))) result.push(match[1]);
  });
  return result;
}

function forbiddenReason(dependency, fromDir) {
  const normalized = dependency.replace(/\\/g, '/').toLowerCase();
  const resolved = dependency.startsWith('.')
    ? path.resolve(fromDir || CORE_DIR, dependency)
    : null;
  if (resolved === SRC_DIR || (resolved && resolved.indexOf(`${SRC_DIR}${path.sep}`) === 0)) {
    return 'src runtime/UI layer';
  }
  if (/(^|\/)(wx|wechat)(\/|$)/.test(normalized)) return 'WeChat API adapter';
  if (/(^|[/_-])canvas([/_-]|$)/.test(normalized)) return 'Canvas dependency';
  if (/(^|\/)(daily-)?progress-store(?:\.js)?$/.test(normalized) ||
      /(^|[/_-])(storage|store)([/_.-]|$)/.test(normalized)) {
    return 'persistence service';
  }
  return null;
}

function javascriptFiles(directory) {
  const result = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      javascriptFiles(absolute).forEach(file => result.push(file));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      result.push(absolute);
    }
  });
  return result;
}

function run() {
  const files = javascriptFiles(CORE_DIR).sort();
  const runtime = files.concat(javascriptFiles(SRC_DIR),
    javascriptFiles(path.join(SRC_DIR, '..', 'data')),
    javascriptFiles(path.join(SRC_DIR, '..', 'assets')), path.join(SRC_DIR, '..', 'game.js'));
  const root = path.join(SRC_DIR, '..');
  const copilotDir = path.join(root, 'scripts', 'level-copilot');
  const copilotFiles = javascriptFiles(copilotDir).sort();
  for (const name of ['cloudfunctions', 'functions', 'server']) {
    assert(!fs.existsSync(path.join(SRC_DIR, '..', name)), 'client repository must not contain server implementations');
  }
  assert(!fs.existsSync(path.join(SRC_DIR, '..', 'node_modules')), 'native client must not gain npm runtime dependencies');
  runtime.forEach(file => {
    assert(!/wx-server-sdk|@cloudbase\/node-sdk|OPENID|session_key|IDENTITY_HASH_KEY/.test(fs.readFileSync(file, 'utf8')),
      `${file} cannot contain server identity details or dependencies`);
    if (file === path.join(SRC_DIR, 'platform', 'wechat.js')) return;
    const source = fs.readFileSync(file, 'utf8');
    assert(!/\b(?:wx|api)\s*(?:\.\s*cloud\b|\[\s*['"]cloud['"]\s*\])/.test(source),
      `${file} must not access native cloud APIs, including through an injected api alias`);
    assert(!/\bwx\s*(?:\.|\[)|\b(?:globalThis|GameGlobal)\s*(?:\.\s*wx|\[\s*['"]wx['"]\s*\])/.test(source),
      `${file} must use WechatPlatform`);
    if (file !== path.join(SRC_DIR, 'services', 'api-client.js')) {
      assert(!/['"]\/v1\/|\bAuthorization\b/.test(source), `${file} must consume named API contracts`);
    }
    dependencies(source).forEach(dependency => {
      if (!dependency.startsWith('.')) return;
      const resolved = path.resolve(path.dirname(file), dependency);
      assert(resolved !== copilotDir && resolved.indexOf(`${copilotDir}${path.sep}`) !== 0,
        `${file} cannot depend on the authoring-only level Copilot`);
    });
  });
  assert.strictEqual(copilotFiles.length, 10, 'the level Copilot file boundary must remain explicit');
  const builtins = new Set(['child_process', 'crypto', 'fs', 'https', 'os', 'path']);
  copilotFiles.forEach(file => {
    const name = path.basename(file);
    const source = fs.readFileSync(file, 'utf8');
    assert(!/\bwx\s*(?:\.|\[)|\bCanvas(?:RenderingContext2D)?\s*[.(]|\bCloudBase\b/.test(source),
      `${name} cannot depend on game runtime surfaces`);
    assert(!/src\/services|src\/platform|src\/ui/.test(source), `${name} cannot depend on runtime services or UI`);
    assert(!/\b(?:eval\s*\(|Function\s*\(|vm\b)/.test(source),
      `${name} cannot execute generated content`);
    if (name === 'codex-client.js') {
      assert(dependencies(source).includes('child_process'),
        'only the Codex provider may launch the authenticated local Codex CLI');
    } else {
      assert(!/\bchild_process\b/.test(source), `${name} cannot launch child processes`);
    }
    assert(!/\brequire\s*\(\s*[^'"\s]/.test(source), `${name} cannot use dynamic require`);
    dependencies(source).forEach(dependency => {
      assert(dependency.startsWith('.') || builtins.has(dependency),
        `${name} cannot add third-party dependency ${dependency}`);
    });
    if (name !== 'openai-client.js') {
      assert(!/api\.openai\.com|\bAuthorization\b/.test(source),
        `${name} cannot own the OpenAI network boundary`);
      assert(!dependencies(source).includes('https'), `${name} cannot use Node HTTPS`);
    }
    if (name !== 'run-store.js') {
      assert(!/\.(?:writeFile|mkdir|link|rename|unlink)\s*\(/.test(source),
        `${name} cannot write authoring artifacts`);
    }
  });
  const validatorDependencies = dependencies(fs.readFileSync(path.join(copilotDir, 'validator.js'), 'utf8'));
  assert.deepStrictEqual(validatorDependencies, [
    './candidate.js',
    '../../data/catalog-v2.js',
    '../../core/game-runner.js',
    '../../core/portal-validation.js',
    '../solve-no-portal.js',
    '../evaluate-level-difficulty.js'
  ], 'validator may only read the candidate helpers and existing deterministic authorities');
  assert(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)
    .includes('/scripts/level-copilot/runs/'), 'local Copilot runs must be ignored by Git');
  const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert(projectConfig.packOptions.ignore.some(entry => entry.type === 'folder' && entry.value === 'scripts'),
    'the complete authoring tool directory must stay outside the WeChat package');
  const cloudTransport = path.join(SRC_DIR, 'services', 'cloud-function-transport.js');
  runtime.filter(file => file !== cloudTransport && file !== path.join(SRC_DIR, 'platform', 'wechat.js')).forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/\.(?:initCloud|callCloudFunction)\s*\(/.test(source), `${file} must use the cloud transport seam`);
  });
  ['gameplay', 'mechanics', 'ui'].forEach(dir => javascriptFiles(path.join(SRC_DIR, dir)).forEach(file => {
    assert(!dependencies(fs.readFileSync(file, 'utf8')).some(dep => /cloud|api-client|auth-service|session-store|sync-store/.test(dep)),
      `${file} cannot depend on cloud/identity services`);
  }));
  const transportSource = fs.readFileSync(cloudTransport, 'utf8');
  assert(!/SessionStore|SyncStore|RewardUnlockService|StaminaService|mergeCloudSnapshot|setStorage/.test(transportSource),
    'cloud transport cannot bind identity, save storage or apply business state');
  const builderSource = fs.readFileSync(path.join(SRC_DIR, 'services', 'legacy-migration-builder.js'), 'utf8');
  assert(!/Date\.now|Math\.random|\.save\s*\(|setStorage|ApiClient|WechatPlatform|\.activateScope\s*\(/.test(builderSource),
    'migration builder must stay deterministic and read-only');
  assert.deepStrictEqual(dependencies(builderSource), ['./sync-payload.js']);
  const applierSource = fs.readFileSync(path.join(SRC_DIR, 'services', 'authoritative-state-applier.js'), 'utf8');
  assert(!/this\.(?:balance|ownedRewards|progress|stamina|pendingOperations)\s*=/.test(applierSource),
    'applier owns only injected references, never a second business state');
  ['gameplay', 'mechanics', 'ui/board'].forEach(dir => javascriptFiles(path.join(SRC_DIR, dir)).forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/(?:auth|api-client|ads|engagement|behavior|reward|share|progress-sync)-service|\bdeps\.ads\b/.test(source),
      `${file} must remain isolated from online engagement`);
  }));

  const rewardConfig = require('../src/config/rewards.js');
  assert.strictEqual(JSON.stringify(rewardConfig).includes('function'), false);
  assert(rewardConfig.items.every(item => item && typeof item === 'object' &&
    item.unlock && typeof item.unlock === 'object' &&
    !Object.values(item.unlock).some(value => typeof value === 'function')),
  'reward configuration stays data-only');
  const rewardRendererSource = fs.readFileSync(path.join(SRC_DIR, 'ui', 'canvas-renderer.js'), 'utf8');
  assert(!/RewardUnlockService|readStorageResult|setStorage\s*\(/.test(rewardRendererSource),
    'renderer cannot access the reward service or persistence');

  assert(files.length > 0, 'core boundary test must inspect at least one JavaScript module');

  files.forEach(file => {
    const relative = path.relative(CORE_DIR, file);
    const source = fs.readFileSync(file, 'utf8');
    assert(!/\bwx\s*(?:\.|\[)/.test(source), `core/${relative} must not access the wx global`);
    assert(!/\bCanvas(?:RenderingContext2D)?\s*[.(]/.test(source),
      `core/${relative} must not access Canvas globals`);
    assert(!/\b(?:localStorage|sessionStorage)\s*(?:\.|\[)/.test(source),
      `core/${relative} must not access browser storage globals`);
    dependencies(source).forEach(dependency => {
      assert(!/stamina/.test(dependency), `core/${relative} must not depend on stamina`);
      const reason = forbiddenReason(dependency, path.dirname(file));
      assert.strictEqual(reason, null,
        `core/${relative} must not depend on ${reason}: ${dependency}`);
    });
  });

  const mutableAccess = new RegExp(
    `\\brunner\\s*\\.\\s*(?:${MUTABLE_RUNNER_FIELDS.join('|')})\\b`
  );
  const appSource = fs.readFileSync(path.join(SRC_DIR, 'app.js'), 'utf8');
  const bootstrapSource = fs.readFileSync(path.join(SRC_DIR, 'bootstrap.js'), 'utf8');
  const gameRuntimeSource = fs.readFileSync(path.join(SRC_DIR, 'runtime', 'game-runtime.js'), 'utf8');
  assert.deepStrictEqual(dependencies(gameRuntimeSource), [
    '../app.js',
    '../services/subpackage-service.js',
    '../services/progress-store.js',
    '../services/stamina-service.js',
    '../services/daily-progress-store.js',
    '../services/preferences-service.js',
    '../services/reward-unlock-service.js',
    '../services/hint-access-service.js',
    '../services/locale-service.js',
    '../config/rewards.js',
    './product-policy.js',
    './app-local-persistence.js',
    '../../data/catalog-v2.js'
  ], 'the shared composition root may depend only on reusable local runtime modules');
  assert(!/platform\/wechat|cloudbase|backend|api-client|auth-service|session-store|sync-store|cloud-function/.test(gameRuntimeSource),
    'the shared composition root cannot select a concrete host, cloud environment or online service');
  assert.deepStrictEqual(dependencies(appSource), [
    '../data/catalog-v2.js',
    '../core/game-runner.js',
    './services/progress-store.js',
    './services/stamina-service.js',
    './config/stamina.js',
    './services/skin-service.js',
    './services/ads-service.js',
    './services/engagement-service.js',
    './services/progression-service.js',
    './services/audio-service.js',
    './services/hint-service.js',
    './services/hint-access-service.js',
    './services/reward-unlock-service.js',
    './config/rewards.js',
    './config/ads.js',
    './config/progression.js',
    './config/audio.js',
    './ui/canvas-renderer.js',
    './ui/top-bar-layout.js',
    './ui/portal-instructions.js',
    './skins/index.js',
    './mechanics/index.js',
    './gameplay/run-context.js',
    '../data/ice-trial.js',
    './gameplay/completion-policies.js',
    './gameplay/board-input-controller.js',
    './services/daily-progress-adapter.js',
    './ui/view-models/daily-view-model.js',
    './i18n/index.js',
    './runtime/product-policy.js',
    './services/clear-effect-service.js',
    './services/daily-challenge-service.js',
    './services/daily-progress-store.js',
    '../data/daily-challenges.js',
    '../data/daily-solutions.js',
    '../data/portal-solutions.js',
    './services/legacy-migration-builder.js',
    './services/authoritative-state-applier.js'
  ], 'the App dependency surface uses only bundler-enumerable literal requires');
  assert(!/\brequire\s*\(\s*path\s*\)/.test(appSource),
    'optional App dependencies cannot fall back to a variable require path');
  const optionalAppDependencies = [];
  const optionalPattern = /optionalRequire\s*\(\s*['"]([^'"]+)['"]/g;
  let optionalMatch;
  while ((optionalMatch = optionalPattern.exec(appSource))) optionalAppDependencies.push(optionalMatch[1]);
  assert.deepStrictEqual(optionalAppDependencies, [
    './services/clear-effect-service.js',
    './services/daily-challenge-service.js',
    './services/daily-progress-store.js',
    '../data/daily-challenges.js',
    '../data/daily-solutions.js',
    '../data/portal-solutions.js'
  ], 'every retained optional App dependency has an explicit literal loader entry');
  const productPolicySource = fs.readFileSync(path.join(SRC_DIR, 'runtime', 'product-policy.js'), 'utf8');
  assert.deepStrictEqual(dependencies(productPolicySource), [],
    'product access policy remains a pure contract without services or persistence');
  assert(!/full_game_v1|\b0:0\b|\b1:3\b|10000/.test(productPolicySource),
    'the shared product-policy contract cannot hard-code App production values');
  assert(!/(?:get|set)Storage|purchase\s*\(|restore\s*\(|subscribe\s*\(/.test(productPolicySource),
    'product policy cannot own store operations, subscriptions or persistence');
  assert(!/fullGameStore\s*\.\s*dispose\s*\(/.test(appSource),
    'the shared App may unbind from but never dispose the host-owned store provider');
  assert(!/fullGameStore|fullGameEntitlementId|freeLevelKeys/.test(bootstrapSource),
    'the WeChat composition root cannot install an App store provider or commercial gate');
  runtime.forEach(file => {
    assert(!/tests[\\/]fixtures[\\/]app-product-policy/.test(fs.readFileSync(file, 'utf8')),
      `${file} cannot import the App test product fixture`);
  });
  const staminaSource = fs.readFileSync(path.join(SRC_DIR, 'services', 'stamina-service.js'), 'utf8');
  assert.deepStrictEqual(dependencies(staminaSource), ['../config/stamina.js'],
    'stamina may depend only on its stable configuration');
  assert(!/\b(?:wx|GameRunner|Canvas|setInterval|setTimeout|requestAnimationFrame)\b/.test(staminaSource),
    'stamina uses platform storage and timestamps without core, UI or timer dependencies');
  const openLevel = appSource.slice(appSource.indexOf('  openLevel('), appSource.indexOf('  createOrdinaryRunner('));
  const runnerCreation = openLevel.indexOf('createOrdinaryRunner');
  const firstStaminaUnlock = openLevel.search(/\.unlockOrdinaryLevel\s*\(/);
  assert(openLevel.indexOf('progression.accessStatus') < runnerCreation &&
    runnerCreation < firstStaminaUnlock,
  'commercial access must be checked before Runner creation and stamina unlock');
  assert.strictEqual((openLevel.match(/\.unlockOrdinaryLevel\s*\(/g) || []).length, 3,
    'openLevel may route one unlock through App-local stamina, cloud sync or the legacy fallback');
  assert(!/\.unlockOrdinaryLevel\s*\(/.test(appSource.replace(openLevel, '')), 'only openLevel may unlock with stamina');
  assert(!/consumeOrdinaryAttempt/.test(appSource), 'replaying a level must not use per-attempt debits');
  ['gameplay', 'mechanics', 'ui'].forEach(dir => javascriptFiles(path.join(SRC_DIR, dir)).forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    assert(!dependencies(source).some(dependency => /stamina/.test(dependency)),
      `${file} must not depend on stamina service/config`);
    assert(!/consumeOrdinaryAttempt|unlockOrdinaryLevel|refundQuickClear/.test(source), `${file} cannot debit or refund stamina`);
  }));
  ['progress-store.js', 'daily-progress-store.js', 'sync-store.js'].forEach(file => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'services', file), 'utf8');
    assert(!/nextRecoveryAt|StaminaService|\.stamina\b/.test(source),
      `${file} must not own stamina fields`);
    if (file === 'sync-store.js') assert(!/\bbalance\b|\bownedRewards\b/.test(source), 'scope metadata is not a wallet or asset store');
    if (file !== 'sync-store.js') assert(!/stamina/.test(source), `${file} must not handle stamina`);
  });
  const rendererSource = fs.readFileSync(path.join(SRC_DIR, 'ui', 'canvas-renderer.js'), 'utf8');
  assert(!/StaminaService|this\.stamina|stamina:|(?:get|set)Storage/.test(rendererSource),
    'renderer consumes pure stamina ViewModel without a service, storage or stamina actions');
  const dailyAdapterSource = fs.readFileSync(
    path.join(SRC_DIR, 'services', 'daily-progress-adapter.js'),
    'utf8'
  );
  assert.deepStrictEqual(dependencies(dailyAdapterSource), [],
    'daily progress adapter must not gain runtime dependencies');
  assert(!/\b(?:Date|setTimeout|setInterval|requestAnimationFrame|GameRunner|ClearedApp|WechatPlatform)\b/.test(dailyAdapterSource),
    'daily progress adapter cannot own time, timers, rules, App or platform access');
  const dailyViewModelSource = fs.readFileSync(
    path.join(SRC_DIR, 'ui', 'view-models', 'daily-view-model.js'),
    'utf8'
  );
  assert.deepStrictEqual(dependencies(dailyViewModelSource), [],
    'daily ViewModel mapping must not gain runtime dependencies');
  assert(!/\b(?:runner|store|service|platform|Date|setTimeout|setInterval|requestAnimationFrame|GameRunner|ClearedApp)\b/i.test(dailyViewModelSource),
    'daily ViewModel mapping cannot query rules, persistence, services, time or App');
  assert(!/\bsetInterval\s*\(/.test(appSource));
  assert(!mutableAccess.test(appSource),
    'App must consume Runner commands and read-only queries, not mutable fields');

  const hintFacade = fs.readFileSync(
    path.join(SRC_DIR, 'services', 'hint-service.js'),
    'utf8'
  );
  assert(!mutableAccess.test(hintFacade),
    'HintService must consume getViewState() instead of mutable Runner fields');
  const hintProviderDir = path.join(SRC_DIR, 'services', 'hints');
  fs.readdirSync(hintProviderDir).filter(file => file.endsWith('.js')).forEach(file => {
    const source = fs.readFileSync(path.join(hintProviderDir, file), 'utf8');
    assert(!/\b(?:GameRunner|runner)\b/.test(source),
      `hint provider ${file} must consume only a pure HintContext`);
  });

  const uiFiles = [
    path.join(SRC_DIR, 'ui', 'canvas-renderer.js'),
    path.join(SRC_DIR, 'ui', 'board', 'board-renderer.js'),
    path.join(SRC_DIR, 'ui', 'board', 'portal-overlay.js'),
    path.join(SRC_DIR, 'ui', 'view-models', 'daily-view-model.js')
  ];
  uiFiles.forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/\b(?:GameRunner|runner)\b/.test(source),
      `${path.relative(SRC_DIR, file)} must render only a pure ViewModel`);
  });
}

module.exports = run;
