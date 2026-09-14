'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const evalTools = require('../scripts/level-copilot/eval.js');
const { RunStore } = require('../scripts/level-copilot/run-store.js');

function report(overrides) {
  return Object.assign({
    schemaVersion: 1,
    status: 'reviewable',
    retryable: false,
    errorCodes: [],
    warnings: [],
    checks: {
      schema: 'passed', staticRules: 'passed', duplicate: 'passed',
      runtime: 'passed', solver: 'solved', difficulty: 'passed'
    },
    difficulty: { targetGrade: 2, actualGrade: 2, score: 30 }
  }, overrides);
}

function attempt(validationReport, id) {
  return {
    api: { responseId: id || 'resp' },
    candidateReceived: true,
    candidate: {},
    validationReport
  };
}

function temporaryRoot() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cleared-copilot-eval-'));
}

async function run() {
  assert.strictEqual(evalTools.percentile([1, 2, 3], 0.5), 2);
  assert.strictEqual(evalTools.percentile([10, 20], 0.5), 15);
  assert.strictEqual(evalTools.percentile([100, 200, 300, 400], 0.95), 385);
  assert.strictEqual(evalTools.percentile([], 0.95), null);

  const schemaFailed = report({
    status: 'rejected', retryable: true, errorCodes: ['CANDIDATE_SCHEMA_INVALID'],
    checks: { schema: 'failed', staticRules: 'skipped', duplicate: 'pending',
      runtime: 'pending', solver: 'pending', difficulty: 'pending' }
  });
  const difficultyFailed = report({
    status: 'rejected', retryable: true, errorCodes: ['DIFFICULTY_TOO_LOW'],
    checks: { schema: 'passed', staticRules: 'passed', duplicate: 'passed',
      runtime: 'passed', solver: 'solved', difficulty: 'failed' }
  });
  const duplicate = report({
    status: 'rejected', retryable: true, errorCodes: ['LAYOUT_DUPLICATE'],
    checks: { schema: 'passed', staticRules: 'passed', duplicate: 'failed',
      runtime: 'pending', solver: 'pending', difficulty: 'pending' }
  });
  const results = [
    {
      caseId: 'a', caseVersion: 'eval-cases-v1', status: 'AWAITING_REVIEW',
      attempts: [attempt(difficultyFailed, 'a1'), attempt(report(), 'a2')],
      layoutKey: 'layout-a', latencyMs: 100,
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, review: null
    },
    {
      caseId: 'b', caseVersion: 'eval-cases-v1', status: 'ACCEPTED',
      attempts: [attempt(schemaFailed, 'b1'), attempt(report(), 'b2')],
      layoutKey: 'layout-a', latencyMs: 200,
      usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
      review: { decision: 'accepted' }
    },
    {
      caseId: 'c', caseVersion: 'eval-cases-v1', status: 'FAILED', attempts: [],
      layoutKey: null, latencyMs: 300,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, review: null
    },
    {
      caseId: 'd', caseVersion: 'eval-cases-v1', status: 'REJECTED',
      attempts: [attempt(duplicate, 'd1'), attempt(report(), 'd2')],
      layoutKey: 'layout-b', latencyMs: 400,
      usage: { input_tokens: 300, output_tokens: 150, total_tokens: 450 },
      review: { decision: 'reject_not_fun' }
    }
  ];
  const options = { caseVersion: 'eval-cases-v1', model: 'explicit-model', promptVersion: 'copilot-prompt-v1' };
  const summary = evalTools.aggregateEvaluation(results, options);
  assert.strictEqual(summary.metrics.provider_response_rate, 0.75);
  assert.strictEqual(summary.metrics.api_response_rate, 0.75);
  assert.strictEqual(summary.metrics.candidate_received_rate, 0.75);
  assert.strictEqual(summary.metrics.schema_first_pass_rate, 0.666667);
  assert.strictEqual(summary.metrics.static_first_pass_rate, 0.666667);
  assert.strictEqual(summary.metrics.runtime_first_pass_rate, 0.333333);
  assert.strictEqual(summary.metrics.valid_within_3_rate, 0.75);
  assert.strictEqual(summary.metrics.difficulty_hit_within_3_rate, 0.75);
  assert.strictEqual(summary.metrics.duplicate_rejection_rate, 0.2);
  assert.strictEqual(summary.metrics.reviewable_rate, 0.75);
  assert.strictEqual(summary.metrics.human_acceptance_rate, 0.5);
  assert.strictEqual(summary.metrics.unique_reviewable_rate, 0.666667);
  assert.strictEqual(summary.metrics.latency_p50_ms, 250);
  assert.strictEqual(summary.metrics.latency_p95_ms, 385);
  assert.strictEqual(summary.metrics.tokens_per_reviewable, 300);
  assert.strictEqual(summary.metrics.estimated_cost_per_reviewable, null);
  assert.deepStrictEqual(summary.usage, { input_tokens: 600, output_tokens: 300, total_tokens: 900 });
  assert.deepStrictEqual(summary.cost, {
    status: 'not_calculated',
    costAccounting: 'api_usage_unpriced',
    estimatedCostUsd: null,
    pricingSnapshotId: null,
    currency: null,
    estimatedTotal: null
  });
  const incompleteOnly = evalTools.aggregateEvaluation([{
    caseId: 'incomplete', caseVersion: 'eval-cases-v1', status: 'FAILED',
    attempts: [{
      api: { error: {
        code: 'OPENAI_RESPONSE_INCOMPLETE', responseId: 'resp_incomplete',
        responseStatus: 'incomplete', usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }
      } },
      validationReport: null
    }],
    layoutKey: null, latencyMs: 10,
    usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }, review: null
  }], options);
  assert.strictEqual(incompleteOnly.metrics.api_response_rate, 1);
  assert.strictEqual(incompleteOnly.metrics.candidate_received_rate, 0);
  assert.strictEqual(incompleteOnly.metrics.schema_first_pass_rate, null);
  assert.strictEqual(incompleteOnly.usage.total_tokens, 10);
  const validatorFailure = evalTools.aggregateEvaluation([{
    caseId: 'validator-failure', caseVersion: 'eval-cases-v1', status: 'FAILED',
    attempts: [{
      api: { responseId: 'resp_validator_failure' },
      candidateReceived: true,
      candidate: { schemaVersion: 1 },
      validationReport: null,
      errorCodes: ['VALIDATOR_INTERNAL_ERROR']
    }],
    layoutKey: null, latencyMs: 10,
    usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }, review: null
  }], options);
  assert.strictEqual(validatorFailure.metrics.api_response_rate, 1);
  assert.strictEqual(validatorFailure.metrics.candidate_received_rate, 1);
  assert.strictEqual(validatorFailure.metrics.schema_first_pass_rate, 0);
  const codex = evalTools.aggregateEvaluation([{
    caseId: 'codex', caseVersion: 'eval-cases-v1', provider: 'codex-cli',
    status: 'AWAITING_REVIEW',
    attempts: [{
      provider: {
        id: 'codex-cli', responseId: 'thread_codex', threadId: 'thread_codex',
        status: 'completed'
      },
      candidateReceived: true,
      candidate: {},
      validationReport: report()
    }],
    layoutKey: 'layout-codex', latencyMs: 50,
    usage: {
      input_tokens: 20, cached_input_tokens: 5, output_tokens: 10,
      reasoning_output_tokens: 3, total_tokens: 30
    },
    review: null
  }], {
    caseVersion: 'eval-cases-v1', provider: 'codex-cli', model: null,
    promptVersion: 'copilot-prompt-v1'
  });
  assert.strictEqual(codex.metrics.provider_response_rate, 1);
  assert.strictEqual(codex.metrics.api_response_rate, null,
    'Codex subscription runs must not impersonate Responses API receipts');
  assert.strictEqual(codex.metrics.candidate_received_rate, 1);
  assert.deepStrictEqual(codex.usage, {
    input_tokens: 20,
    cached_input_tokens: 5,
    output_tokens: 10,
    reasoning_output_tokens: 3,
    total_tokens: 30
  });
  assert.strictEqual(codex.cost.status, 'not_applicable_subscription');
  assert.strictEqual(codex.cost.costAccounting, 'not_applicable_subscription');
  assert.strictEqual(codex.cost.estimatedCostUsd, null);
  assert.throws(() => evalTools.aggregateEvaluation([], {
    caseVersion: 'eval-cases-v1', provider: 'codex-cli', model: null,
    pricingSnapshot: {}
  }), /EVAL_PRICING_NOT_APPLICABLE/);
  const repeatedSchemaFailure = report({
    status: 'rejected', retryable: true, errorCodes: ['CANDIDATE_REPEAT'],
    checks: { schema: 'failed', staticRules: 'skipped', duplicate: 'pending',
      runtime: 'pending', solver: 'pending', difficulty: 'pending' }
  });
  const malformedRepeat = evalTools.aggregateEvaluation([{
    caseId: 'malformed-repeat', caseVersion: 'eval-cases-v1', status: 'FAILED',
    attempts: [attempt(schemaFailed, 'bad1'), attempt(repeatedSchemaFailure, 'bad2')],
    layoutKey: null, latencyMs: 10,
    usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }, review: null
  }], options);
  assert.strictEqual(malformedRepeat.metrics.candidate_received_rate, 1);
  assert.strictEqual(malformedRepeat.counts.structurallyValidCandidates, 0);
  assert.strictEqual(JSON.stringify(evalTools.aggregateEvaluation(results.slice().reverse(), options)),
    JSON.stringify(summary), 'metric content must not depend on result order');

  const priced = evalTools.aggregateEvaluation(results, Object.assign({}, options, {
    pricingSnapshot: {
      model: 'explicit-model', inputPerMillion: 10, outputPerMillion: 20,
      currency: 'USD', effectiveDate: '2026-09-13', sourceUrl: 'https://developers.openai.com/',
      pricingSnapshotId: 'pricing-test-v1'
    }
  }));
  assert.strictEqual(priced.cost.estimatedTotal, 0.012);
  assert.strictEqual(priced.cost.estimatedCostUsd, 0.012);
  assert.strictEqual(priced.metrics.estimated_cost_per_reviewable, 0.004);
  assert.throws(() => evalTools.aggregateEvaluation(results.concat(Object.assign({}, results[0], {
    caseVersion: 'eval-cases-v2'
  })), options), /EVAL_CASE_VERSION_MISMATCH/);

  const empty = evalTools.aggregateEvaluation([], options);
  assert.strictEqual(empty.metrics.reviewable_rate, null);
  assert.strictEqual(empty.metrics.tokens_per_reviewable, null);
  assert.strictEqual(empty.metrics.human_acceptance_rate, null);

  const full = evalTools.loadCases(evalTools.DEFAULT_CASES, false);
  const smoke = evalTools.loadCases(evalTools.DEFAULT_CASES, true);
  assert.strictEqual(full.cases.length, 24);
  assert.strictEqual(smoke.cases.length, 6);
  assert.deepStrictEqual([5, 6].map(size => full.cases.filter(item => item.brief.width === size).length), [12, 12]);
  assert.deepStrictEqual([1, 2, 3].map(grade => full.cases.filter(item => item.brief.targetGrade === grade).length), [8, 8, 8]);
  assert.deepStrictEqual([4, 5, 6].map(colors => full.cases.filter(item => item.brief.colorCount === colors).length), [8, 8, 8]);
  assert.throws(() => evalTools.parseArguments(['--cases', evalTools.DEFAULT_CASES, '--max-calls', '120']),
    /EVAL_ARGUMENT_INVALID/);
  assert.throws(() => evalTools.parseArguments(['--live', '--max-calls', '119']),
    /EVAL_ARGUMENT_INVALID/);
  assert.throws(() => evalTools.parseArguments(['--live', '--max-calls', '29', '--smoke']),
    /EVAL_ARGUMENT_INVALID/);
  assert.strictEqual(evalTools.parseArguments(['--live', '--max-calls', '120']).maxCalls, 120);
  assert.strictEqual(evalTools.parseArguments(['--live', '--max-calls', '30', '--smoke']).maxCalls, 30);
  assert.strictEqual(evalTools.parseArguments([
    '--live', '--max-calls', '30', '--smoke', '--provider', 'codex'
  ]).provider, 'codex');
  assert.throws(() => evalTools.parseArguments([
    '--live', '--max-calls', '30', '--smoke', '--provider', 'unknown'
  ]), /EVAL_ARGUMENT_INVALID/);
  assert.strictEqual(evalTools.parseArguments(['--recompute', '00000000-0000-4000-8000-000000000000'])
    .recompute, '00000000-0000-4000-8000-000000000000');

  const root = temporaryRoot();
  try {
    const store = new RunStore({ root: path.join(root, 'runs') });
    const output = [];
    let calls = 0;
    let now = Date.UTC(2026, 8, 13);
    const code = await evalTools.main(['--live', '--max-calls', '120'], {
      env: { OPENAI_API_KEY: 'unit-test-key', OPENAI_MODEL: 'explicit-model' },
      store,
      client: { generate: async () => { calls += 1; return {}; } },
      clock: () => ++now,
      console: { log: value => output.push(value), error: value => output.push(value) },
      pipelineFactory: ({ client, store: runStore }) => ({
        async generate(options) {
          for (let index = 0; index < 5; index += 1) await client.generate({});
          const runId = runStore.newRunId();
          const record = {
            schemaVersion: 1,
            runId,
            status: 'AWAITING_REVIEW',
            candidateAttempts: 0,
            usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
            decision: null
          };
          await runStore.createRun(options.brief, record);
          return {
            runId,
            status: record.status,
            exitCode: 0,
            errorCodes: [],
            record,
            candidate: { layoutKey: `layout-${runId}` }
          };
        }
      })
    });
    assert.strictEqual(code, 0);
    assert.strictEqual(calls, 120, 'five calls per case must still complete all 24 cases');
    const printed = JSON.parse(output.pop());
    assert.strictEqual(printed.completedCaseCount, 24);
    const manifest = await store.readEvaluation(printed.evaluationId);
    assert.strictEqual(manifest.status, 'COMPLETED');
    assert.strictEqual(manifest.calls, 120);
    assert.strictEqual(manifest.cases.length, 24);
    assert.strictEqual(new Set(manifest.cases.map(item => item.caseId)).size, 24);
    assert.strictEqual(new Set(manifest.cases.map(item => item.runId)).size, 24);

    const first = await store.readRun(manifest.cases[0].runId);
    first.status = 'ACCEPTED';
    first.decision = { decision: 'accepted', reason: null, decidedAt: new Date(now).toISOString() };
    await store.writeRun(first.runId, first);
    const recomputeOutput = [];
    assert.strictEqual(await evalTools.main(['--recompute', manifest.evaluationId], {
      env: {}, store, clock: () => ++now,
      console: { log: value => recomputeOutput.push(value), error: value => recomputeOutput.push(value) }
    }), 0);
    const recomputed = await store.readEvaluation(manifest.evaluationId);
    assert.strictEqual(recomputed.cases[0].status, 'ACCEPTED');
    assert.strictEqual(recomputed.metrics.metrics.human_acceptance_rate, 1);
    assert.strictEqual(JSON.parse(recomputeOutput.pop()).evaluationId, manifest.evaluationId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = run;
