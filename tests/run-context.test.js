'use strict';

const assert = require('assert');
const {
  createCatalogRunContext,
  createMechanicTrialRunContext
} = require('../src/gameplay/run-context.js');
const completionPolicies = require('../src/gameplay/completion-policies.js');

function run() {
  const ordinaryLevel = { Id: 'ordinary-1', Width: 2, Height: 1, Lines: [] };
  const portalLevel = {
    Id: 'portal-catalog-1',
    Mechanic: 'portal',
    PortalRulesVersion: 1,
    Width: 2,
    Height: 1,
    Lines: []
  };
  const catalog = {
    sets: [{ Id: 'set-1', Games: [ordinaryLevel, portalLevel], Palette: [] }]
  };

  const ordinary = createCatalogRunContext(catalog, 0, 0);
  assert.strictEqual(ordinary.source.kind, 'catalog');
  assert.strictEqual(ordinary.progressionScope, 'ordinary');
  assert.strictEqual(ordinary.mechanic.id, null);
  assert.strictEqual(ordinary.setIndex, 0);
  assert.strictEqual(ordinary.level, ordinaryLevel);
  assert.strictEqual(Object.isFrozen(ordinary), true);
  assert.strictEqual(Object.isFrozen(ordinary.source), true);

  const catalogPortal = createCatalogRunContext(catalog, 0, 1);
  assert.strictEqual(catalogPortal.source.kind, 'catalog');
  assert.strictEqual(catalogPortal.progressionScope, 'ordinary',
    'a portal mechanic does not imply trial progression');
  assert.deepStrictEqual(catalogPortal.mechanic, { id: 'portal', rulesVersion: 1 });

  const trialSet = { Id: 'trial-set', Games: [portalLevel], Palette: [] };
  const trial = createMechanicTrialRunContext({
    id: 'portal',
    mechanic: 'portal',
    rulesVersion: 1,
    trial: { set: trialSet }
  }, 0);
  assert.strictEqual(trial.source.kind, 'mechanic-trial');
  assert.strictEqual(trial.source.id, 'portal-trial');
  assert.strictEqual(trial.progressionScope, 'none');
  assert.strictEqual(trial.setIndex, null);
  assert.strictEqual(trial.levelIndex, 0);

  let recorded = null;
  let adClears = null;
  const progress = {
    state: { stats: { totalClears: 7 } },
    recordCompletion(setIndex, levelIndex, elapsedMs) {
      recorded = { setIndex, levelIndex, elapsedMs };
      return { firstClear: true, bestMs: elapsedMs };
    }
  };
  const ordinaryResult = completionPolicies.settle(catalogPortal, {
    progress,
    ads: { onLevelCompleted(value) { adClears = value; } },
    elapsedMs: 25
  });
  assert.deepStrictEqual(recorded, { setIndex: 0, levelIndex: 1, elapsedMs: 25 });
  assert.strictEqual(adClears, 7);
  assert.strictEqual(ordinaryResult.persisted, true);

  const completionAfterAdFailure = completionPolicies.settle(catalogPortal, {
    progress,
    ads: { onLevelCompleted() { throw new Error('ad adapter failed'); } },
    elapsedMs: 26
  });
  assert.strictEqual(completionAfterAdFailure.persisted, true,
    'optional ad failures cannot suppress an already-persisted completion');

  recorded = null;
  const trialResult = completionPolicies.settle(trial, {
    progress,
    elapsedMs: 30
  });
  assert.strictEqual(recorded, null, 'trial completion never writes ordinary progress');
  assert.strictEqual(trialResult.persisted, false);
  assert.strictEqual(trialResult.gameplayExtensionId, 'portal');

  let dailyCalls = 0;
  const dailyResult = completionPolicies.settle({ progressionScope: 'daily' }, {
    complete() {
      dailyCalls += 1;
      return { ok: true };
    }
  });
  assert.deepStrictEqual(dailyResult, { ok: true });
  assert.strictEqual(dailyCalls, 1);
}

module.exports = run;
