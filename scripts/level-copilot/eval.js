'use strict';

const fs = require('fs');
const path = require('path');
const contracts = require('./contracts.js');
const prompt = require('./prompt.js');
const { OpenAIClient } = require('./openai-client.js');
const { CodexClient } = require('./codex-client.js');
const { RunStore } = require('./run-store.js');
const { PROVIDERS, Pipeline, LIMITS } = require('./pipeline.js');
const { normalizeProvider } = require('./cli.js');

const DEFAULT_CASES = path.join(__dirname, 'eval-cases-v1.json');
const LARGE_BOARD_CASES = path.join(__dirname, 'eval-cases-large-v1.json');
const PORTAL_CASES = path.join(__dirname, 'eval-cases-portal-v1.json');
const PORTAL_FRONTIER_CASES = path.join(__dirname, 'eval-cases-portal-frontier-v1.json');
const ALLOWED_CASE_VERSIONS = new Set([
  'eval-cases-v1', 'eval-cases-large-v1', 'eval-cases-portal-v1',
  'eval-cases-portal-frontier-v1'
]);
const MAX_CALLS_PER_CASE = LIMITS.maxProviderCalls;
const FULL_CASE_COUNT = 24;
const SMOKE_CASE_COUNT = 6;
const MAX_LIVE_CALLS = FULL_CASE_COUNT * MAX_CALLS_PER_CASE;

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}

function rate(numerator, denominator) {
  return denominator ? round(numerator / denominator) : null;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function check(report, name, values) {
  return report && report.checks && values.indexOf(report.checks[name]) >= 0;
}

function hasApiResponse(attempt) {
  if (!attempt || !attempt.api) return false;
  return (typeof attempt.api.responseId === 'string' && attempt.api.responseId.length > 0) ||
    !!(attempt.api.error && typeof attempt.api.error.responseId === 'string' &&
      attempt.api.error.responseId.length > 0);
}

function hasProviderResponse(attempt) {
  if (!attempt) return false;
  if (hasApiResponse(attempt)) return true;
  const provider = attempt.provider;
  return !!(provider && (
    (typeof provider.responseId === 'string' && provider.responseId.length > 0) ||
    (typeof provider.threadId === 'string' && provider.threadId.length > 0) ||
    (provider.error && typeof provider.error.providerResponseId === 'string' &&
      provider.error.providerResponseId.length > 0)
  ));
}

function hasCandidate(attempt) {
  return !!(attempt && (attempt.candidateReceived === true ||
    Object.prototype.hasOwnProperty.call(attempt, 'candidate')));
}

function validatePricing(snapshot, model) {
  if (!snapshot) return null;
  const requiredStrings = ['model', 'currency', 'effectiveDate', 'sourceUrl', 'pricingSnapshotId'];
  if (requiredStrings.some(field => typeof snapshot[field] !== 'string' || !snapshot[field]) ||
      snapshot.model !== model || !Number.isFinite(snapshot.inputPerMillion) || snapshot.inputPerMillion < 0 ||
      !Number.isFinite(snapshot.outputPerMillion) || snapshot.outputPerMillion < 0) {
    throw new Error('PRICING_SNAPSHOT_INVALID');
  }
  return snapshot;
}

function aggregateEvaluation(results, options) {
  const settings = options || {};
  const providerId = settings.provider || PROVIDERS.RESPONSES;
  if (providerId !== PROVIDERS.RESPONSES && providerId !== PROVIDERS.CODEX) {
    throw new Error('EVAL_PROVIDER_INVALID');
  }
  const versions = new Set((results || []).length
    ? results.map(result => result.caseVersion || settings.caseVersion)
    : [settings.caseVersion]);
  if (versions.size > 1 || versions.has(undefined)) throw new Error('EVAL_CASE_VERSION_MISMATCH');
  if (providerId === PROVIDERS.CODEX && settings.pricingSnapshot) {
    throw new Error('EVAL_PRICING_NOT_APPLICABLE');
  }
  const pricing = providerId === PROVIDERS.RESPONSES
    ? validatePricing(settings.pricingSnapshot, settings.model) : null;
  let providerResponseRuns = 0;
  let apiResponseRuns = 0;
  let candidateReceivedRuns = 0;
  let schemaFirst = 0;
  let staticFirst = 0;
  let runtimeFirst = 0;
  let validWithinThree = 0;
  let difficultyWithinThree = 0;
  let structurallyValid = 0;
  let duplicateRejections = 0;
  let reviewable = 0;
  let reviewed = 0;
  let accepted = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  let totalTokens = 0;
  const reviewableKeys = [];
  const latencies = [];
  (results || []).forEach(result => {
    const attempts = (result.attempts || []).slice(0, 3);
    const receivedCandidates = attempts.filter(hasCandidate);
    const validatedCandidates = receivedCandidates.filter(attempt => attempt.validationReport);
    const first = receivedCandidates[0] && receivedCandidates[0].validationReport;
    if (attempts.some(hasProviderResponse)) providerResponseRuns += 1;
    if (providerId === PROVIDERS.RESPONSES && attempts.some(hasApiResponse)) apiResponseRuns += 1;
    if (receivedCandidates.length) {
      candidateReceivedRuns += 1;
      if (check(first, 'schema', ['passed'])) schemaFirst += 1;
      if (check(first, 'staticRules', ['passed'])) staticFirst += 1;
      if (check(first, 'runtime', ['passed'])) runtimeFirst += 1;
    }
    if (validatedCandidates.some(attempt => {
      const report = attempt.validationReport;
      return check(report, 'staticRules', ['passed']) && check(report, 'duplicate', ['passed']) &&
        check(report, 'runtime', ['passed']) && check(report, 'solver', ['solved', 'limit']);
    })) validWithinThree += 1;
    if (validatedCandidates.some(attempt => check(attempt.validationReport, 'difficulty', ['passed']))) {
      difficultyWithinThree += 1;
    }
    validatedCandidates.forEach(attempt => {
      const report = attempt.validationReport;
      if (check(report, 'schema', ['passed'])) structurallyValid += 1;
      if (report.errorCodes && report.errorCodes.indexOf('LAYOUT_DUPLICATE') >= 0) duplicateRejections += 1;
    });
    if (result.status === 'AWAITING_REVIEW' || result.status === 'ACCEPTED' || result.status === 'REJECTED') {
      reviewable += 1;
      if (typeof result.layoutKey === 'string') reviewableKeys.push(result.layoutKey);
    }
    if (result.review && typeof result.review.decision === 'string') {
      reviewed += 1;
      if (result.review.decision === 'accepted') accepted += 1;
    }
    if (Number.isFinite(result.latencyMs)) latencies.push(result.latencyMs);
    const usage = result.usage || {};
    if (Number.isFinite(usage.input_tokens)) inputTokens += usage.input_tokens;
    if (Number.isFinite(usage.cached_input_tokens)) cachedInputTokens += usage.cached_input_tokens;
    if (Number.isFinite(usage.output_tokens)) outputTokens += usage.output_tokens;
    if (Number.isFinite(usage.reasoning_output_tokens)) reasoningOutputTokens += usage.reasoning_output_tokens;
    if (Number.isFinite(usage.total_tokens)) totalTokens += usage.total_tokens;
  });
  const estimatedTotalCost = pricing
    ? round(inputTokens / 1000000 * pricing.inputPerMillion + outputTokens / 1000000 * pricing.outputPerMillion)
    : null;
  return {
    schemaVersion: 1,
    caseVersion: versions.values().next().value,
    provider: providerId,
    model: settings.model,
    promptVersion: settings.promptVersion || prompt.PROMPT_VERSION,
    runCount: (results || []).length,
    metrics: {
      provider_response_rate: rate(providerResponseRuns, (results || []).length),
      api_response_rate: providerId === PROVIDERS.RESPONSES
        ? rate(apiResponseRuns, (results || []).length) : null,
      candidate_received_rate: rate(candidateReceivedRuns, (results || []).length),
      schema_first_pass_rate: rate(schemaFirst, candidateReceivedRuns),
      static_first_pass_rate: rate(staticFirst, candidateReceivedRuns),
      runtime_first_pass_rate: rate(runtimeFirst, candidateReceivedRuns),
      valid_within_3_rate: rate(validWithinThree, (results || []).length),
      difficulty_hit_within_3_rate: rate(difficultyWithinThree, (results || []).length),
      duplicate_rejection_rate: rate(duplicateRejections, structurallyValid),
      reviewable_rate: rate(reviewable, (results || []).length),
      human_acceptance_rate: rate(accepted, reviewed),
      unique_reviewable_rate: rate(new Set(reviewableKeys).size, reviewableKeys.length),
      latency_p50_ms: percentile(latencies, 0.5),
      latency_p95_ms: percentile(latencies, 0.95),
      tokens_per_reviewable: reviewable ? round(totalTokens / reviewable) : null,
      estimated_cost_per_reviewable: reviewable && estimatedTotalCost !== null
        ? round(estimatedTotalCost / reviewable) : null
    },
    counts: {
      providerResponseRuns,
      apiResponseRuns,
      candidateReceivedRuns,
      structurallyValidCandidates: structurallyValid,
      duplicateRejections,
      reviewable,
      reviewed,
      accepted,
      uniqueReviewable: new Set(reviewableKeys).size
    },
    usage: providerId === PROVIDERS.CODEX
      ? {
        input_tokens: inputTokens,
        cached_input_tokens: cachedInputTokens,
        output_tokens: outputTokens,
        reasoning_output_tokens: reasoningOutputTokens,
        total_tokens: totalTokens
      }
      : { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens },
    cost: {
      status: providerId === PROVIDERS.CODEX
        ? 'not_applicable_subscription' : pricing ? 'calculated' : 'not_calculated',
      costAccounting: providerId === PROVIDERS.CODEX
        ? 'not_applicable_subscription' : pricing ? 'api_usage_priced' : 'api_usage_unpriced',
      estimatedCostUsd: providerId === PROVIDERS.CODEX ? null : estimatedTotalCost,
      pricingSnapshotId: pricing ? pricing.pricingSnapshotId : null,
      currency: pricing ? pricing.currency : null,
      estimatedTotal: estimatedTotalCost
    }
  };
}

function loadCases(filename, smokeOnly) {
  let value;
  try { value = JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8')); }
  catch (error) { throw new Error('EVAL_CASES_INVALID'); }
  if (!value || value.schemaVersion !== 1 || !ALLOWED_CASE_VERSIONS.has(value.caseVersion) ||
      !Array.isArray(value.cases) || value.cases.length !== 24 ||
      new Set(value.cases.map(item => item.id)).size !== 24) throw new Error('EVAL_CASES_INVALID');
  value.cases.forEach(item => {
    if (!item || typeof item.id !== 'string' || !contracts.validateBrief(item.brief).ok) {
      throw new Error('EVAL_CASES_INVALID');
    }
  });
  const selected = smokeOnly ? value.cases.filter(item => item.smoke === true) : value.cases;
  if (smokeOnly && selected.length !== 6) throw new Error('EVAL_CASES_INVALID');
  return { caseVersion: value.caseVersion, cases: selected };
}

function parseArguments(argv) {
  const options = {
    cases: DEFAULT_CASES,
    live: false,
    smoke: false,
    recompute: null,
    provider: 'responses'
  };
  const seen = new Set();
  const values = {
    '--cases': 'cases',
    '--max-calls': 'maxcalls',
    '--pricing': 'pricing',
    '--recompute': 'recompute',
    '--provider': 'provider'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--live' || item === '--smoke') {
      options[item.slice(2)] = true;
      continue;
    }
    if (!values[item] || index + 1 >= argv.length || seen.has(item)) {
      throw new Error('EVAL_ARGUMENT_INVALID');
    }
    seen.add(item);
    options[values[item]] = argv[++index];
  }
  if (options.recompute) {
    if (options.live || options.smoke || seen.has('--cases') || seen.has('--max-calls') ||
        seen.has('--pricing') || seen.has('--provider')) throw new Error('EVAL_ARGUMENT_INVALID');
    return options;
  }
  if (!normalizeProvider(options.provider)) throw new Error('EVAL_ARGUMENT_INVALID');
  const maxCalls = Number(options.maxcalls);
  const requiredCalls = (options.smoke ? SMOKE_CASE_COUNT : FULL_CASE_COUNT) * MAX_CALLS_PER_CASE;
  if (!options.live || !Number.isInteger(maxCalls) || maxCalls < requiredCalls ||
      maxCalls > MAX_LIVE_CALLS) {
    throw new Error('EVAL_ARGUMENT_INVALID');
  }
  options.maxCalls = maxCalls;
  return options;
}

async function readAttempts(store, result) {
  const attempts = [];
  if (!result.runId || !result.record) return attempts;
  for (let number = 1; number <= result.record.candidateAttempts; number += 1) {
    const attempt = await store.readOptionalJson(
      result.runId, `attempt-${String(number).padStart(2, '0')}.json`);
    if (attempt) attempts.push(attempt);
  }
  return attempts;
}

async function resultFromRun(store, item, caseVersion, latencyMs, layoutKey) {
  const record = await store.readRun(item.runId);
  const attempts = await readAttempts(store, { runId: item.runId, record });
  const review = record.decision || await store.readReview(item.runId);
  return {
    caseId: item.caseId,
    caseVersion,
    provider: record.provider || PROVIDERS.RESPONSES,
    status: record.status,
    attempts,
    layoutKey: layoutKey || item.layoutKey || null,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : item.latencyMs,
    usage: record.usage || null,
    review: review || null
  };
}

async function recomputeEvaluation(store, evaluationId, clock) {
  const manifest = await store.readEvaluation(evaluationId);
  const providerId = manifest && manifest.provider || PROVIDERS.RESPONSES;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.evaluationId !== evaluationId ||
      !Array.isArray(manifest.cases) || typeof manifest.caseVersion !== 'string' ||
      (providerId === PROVIDERS.RESPONSES && typeof manifest.model !== 'string') ||
      (providerId === PROVIDERS.CODEX && manifest.model !== null)) {
    throw new Error('EVAL_MANIFEST_INVALID');
  }
  const results = [];
  for (const item of manifest.cases) {
    if (!item || typeof item.caseId !== 'string' ||
        (item.runId !== null && typeof item.runId !== 'string')) throw new Error('EVAL_MANIFEST_INVALID');
    if (item.runId) {
      const result = await resultFromRun(
        store, item, manifest.caseVersion, item.latencyMs, item.layoutKey);
      results.push(result);
      item.status = result.status;
      item.layoutKey = result.layoutKey;
    }
  }
  manifest.completedCaseCount = results.length;
  manifest.metrics = aggregateEvaluation(results, {
    caseVersion: manifest.caseVersion,
    provider: providerId,
    model: manifest.model,
    promptVersion: manifest.promptVersion,
    pricingSnapshot: manifest.pricingSnapshot || null
  });
  manifest.lastRecomputedAt = new Date((clock || Date.now)()).toISOString();
  manifest.updatedAt = manifest.lastRecomputedAt;
  await store.writeEvaluation(evaluationId, manifest);
  return manifest;
}

async function main(argv, dependencies) {
  const deps = dependencies || {};
  const env = deps.env || process.env;
  const io = deps.console || console;
  const clock = typeof deps.clock === 'function' ? deps.clock : Date.now;
  let store = deps.store || null;
  let manifest = null;
  try {
    const options = parseArguments(argv || process.argv.slice(2));
    store = store || new RunStore();
    if (options.recompute) {
      const recalculated = await recomputeEvaluation(store, options.recompute, clock);
      io.log(JSON.stringify({
        evaluationId: recalculated.evaluationId,
        status: recalculated.status,
        selectedCaseCount: recalculated.selectedCaseCount,
        completedCaseCount: recalculated.completedCaseCount,
        metrics: recalculated.metrics,
        resultDirectory: path.join(store.root, recalculated.evaluationId)
      }, null, 2));
      return 0;
    }
    const providerId = normalizeProvider(options.provider);
    let model = null;
    if (providerId === PROVIDERS.RESPONSES) {
      if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) throw new Error('EVAL_API_CONFIGURATION_MISSING');
      model = env.OPENAI_MODEL;
    }
    const fixture = loadCases(options.cases, options.smoke);
    if (providerId === PROVIDERS.CODEX && options.pricing) {
      throw new Error('EVAL_PRICING_NOT_APPLICABLE');
    }
    const pricing = options.pricing
      ? JSON.parse(fs.readFileSync(path.resolve(options.pricing), 'utf8')) : null;
    if (providerId === PROVIDERS.RESPONSES) validatePricing(pricing, model);
    const timeoutMs = fixture.cases.some(item => item.brief.mechanic === 'portal')
      ? LIMITS.maxPortalProviderCallDurationMs : LIMITS.maxProviderCallDurationMs;
    const baseClient = deps.client || (providerId === PROVIDERS.CODEX
      ? new CodexClient(Object.assign({ timeoutMs }, deps.codexClientOptions, { env }))
      : new OpenAIClient(Object.assign({ timeoutMs }, deps.openAIClientOptions)));
    let calls = 0;
    const client = { async generate(input) {
      if (calls >= options.maxCalls) {
        const error = new Error('EVAL_CALL_BUDGET_EXHAUSTED');
        error.code = 'EVAL_CALL_BUDGET_EXHAUSTED';
        error.kind = 'configuration';
        throw error;
      }
      calls += 1;
      return baseClient.generate(input);
    } };
    const startedAt = new Date(clock()).toISOString();
    manifest = {
      schemaVersion: 1,
      evaluationId: store.newRunId(),
      caseVersion: fixture.caseVersion,
      casesFile: path.basename(path.resolve(options.cases)),
      mode: options.smoke ? 'smoke' : 'full',
      provider: providerId,
      model,
      promptVersion: prompt.PROMPT_VERSION,
      pricingSnapshot: pricing,
      costAccounting: providerId === PROVIDERS.CODEX
        ? 'not_applicable_subscription' : pricing ? 'api_usage_priced' : 'api_usage_unpriced',
      status: 'RUNNING',
      maxCalls: options.maxCalls,
      calls: 0,
      selectedCaseCount: fixture.cases.length,
      completedCaseCount: 0,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      lastRecomputedAt: null,
      failureCode: null,
      cases: fixture.cases.map(item => ({
        caseId: item.id,
        runId: null,
        status: 'PENDING',
        layoutKey: null,
        latencyMs: null,
        errorCodes: []
      })),
      metrics: null
    };
    await store.createEvaluation(manifest);
    const results = [];
    const pipelineFactory = deps.pipelineFactory || (settings => new Pipeline(settings));
    for (let index = 0; index < fixture.cases.length; index += 1) {
      const item = fixture.cases[index];
      const started = clock();
      const generateOptions = { brief: item.brief, provider: providerId };
      if (providerId === PROVIDERS.RESPONSES) {
        generateOptions.apiKey = env.OPENAI_API_KEY;
        generateOptions.model = model;
      }
      const run = await pipelineFactory({ client, store }).generate(generateOptions);
      const attempts = await readAttempts(store, run);
      const result = {
        caseId: item.id,
        caseVersion: fixture.caseVersion,
        provider: providerId,
        status: run.status,
        attempts,
        layoutKey: run.candidate && run.candidate.layoutKey || null,
        latencyMs: Math.max(0, clock() - started),
        usage: run.record && run.record.usage || null,
        review: run.record && run.record.decision || null
      };
      results.push(result);
      manifest.cases[index] = {
        caseId: item.id,
        runId: run.runId || null,
        status: run.status,
        layoutKey: result.layoutKey,
        latencyMs: result.latencyMs,
        errorCodes: Array.isArray(run.errorCodes) ? run.errorCodes.slice() : []
      };
      manifest.calls = calls;
      manifest.completedCaseCount = results.length;
      manifest.updatedAt = new Date(clock()).toISOString();
      manifest.metrics = aggregateEvaluation(results, {
        caseVersion: fixture.caseVersion,
        provider: providerId,
        model,
        promptVersion: prompt.PROMPT_VERSION,
        pricingSnapshot: pricing
      });
      await store.writeEvaluation(manifest.evaluationId, manifest);
    }
    const metrics = aggregateEvaluation(results, {
      caseVersion: fixture.caseVersion,
      provider: providerId,
      model,
      promptVersion: prompt.PROMPT_VERSION,
      pricingSnapshot: pricing
    });
    manifest.status = 'COMPLETED';
    manifest.calls = calls;
    manifest.completedCaseCount = results.length;
    manifest.metrics = metrics;
    manifest.completedAt = new Date(clock()).toISOString();
    manifest.updatedAt = manifest.completedAt;
    await store.writeEvaluation(manifest.evaluationId, manifest);
    io.log(JSON.stringify({
      evaluationId: manifest.evaluationId,
      generatedAt: manifest.completedAt,
      calls,
      selectedCaseCount: fixture.cases.length,
      completedCaseCount: results.length,
      metrics,
      resultDirectory: path.join(store.root, manifest.evaluationId)
    }, null, 2));
    return results.length === fixture.cases.length ? 0 : 4;
  } catch (error) {
    if (store && manifest && manifest.evaluationId) {
      manifest.status = 'FAILED';
      manifest.failureCode = error.code || error.message || 'EVAL_FAILED';
      manifest.updatedAt = new Date(clock()).toISOString();
      try { await store.writeEvaluation(manifest.evaluationId, manifest); } catch (writeError) { /* best effort */ }
    }
    io.error(JSON.stringify({ status: 'FAILED', errorCodes: [error.code || error.message || 'EVAL_FAILED'] }));
    return 2;
  }
}

module.exports = {
  DEFAULT_CASES,
  LARGE_BOARD_CASES,
  PORTAL_CASES,
  PORTAL_FRONTIER_CASES,
  MAX_CALLS_PER_CASE,
  MAX_LIVE_CALLS,
  percentile,
  aggregateEvaluation,
  loadCases,
  parseArguments,
  recomputeEvaluation,
  main
};

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}
