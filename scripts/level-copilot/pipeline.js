'use strict';

const crypto = require('crypto');
const contracts = require('./contracts.js');
const validator = require('./validator.js');
const prompt = require('./prompt.js');

const IMPLEMENTATION_VERSION = 16;
const PROVIDERS = Object.freeze({
  RESPONSES: 'responses-api',
  CODEX: 'codex-cli'
});
const LIMITS = Object.freeze({
  maxCandidates: 3,
  maxTransportAttempts: 2,
  maxProviderCalls: 5,
  maxHttpCalls: 5,
  maxProviderCallDurationMs: 60000,
  maxPortalProviderCallDurationMs: 120000,
  maxDurationMs: 180000
});
const RUN_TRANSITIONS = Object.freeze({
  CREATED: ['BRIEF_VALIDATED'],
  BRIEF_VALIDATED: ['GENERATING', 'FAILED'],
  GENERATING: ['AWAITING_REVIEW', 'FAILED'],
  AWAITING_REVIEW: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  FAILED: []
});
const ATTEMPT_TRANSITIONS = Object.freeze({
  REQUESTING: ['RESPONSE_RECEIVED', 'FAILED'],
  RESPONSE_RECEIVED: ['CANDIDATE_VALIDATED', 'REJECTED', 'FAILED'],
  CANDIDATE_VALIDATED: ['COMPILED', 'REJECTED', 'FAILED'],
  COMPILED: ['DUPLICATE_CHECKED', 'REJECTED', 'FAILED'],
  DUPLICATE_CHECKED: ['RUNTIME_VERIFIED', 'REJECTED', 'FAILED'],
  RUNTIME_VERIFIED: ['SOLVER_AUDITED', 'REJECTED', 'FAILED'],
  SOLVER_AUDITED: ['DIFFICULTY_VERIFIED', 'REJECTED', 'FAILED'],
  DIFFICULTY_VERIFIED: ['REVIEWABLE', 'REJECTED', 'FAILED'],
  REVIEWABLE: [],
  REJECTED: [],
  FAILED: []
});

class PipelineError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PipelineError';
    this.code = code;
  }
}

function transition(current, next, transitions) {
  const allowed = transitions[current];
  if (!allowed || allowed.indexOf(next) < 0) throw new PipelineError('STATE_TRANSITION_INVALID');
  return next;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function boundedLimit(value, maximum) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : maximum;
}

function addUsage(total, usage) {
  if (!usage || typeof usage !== 'object') return total;
  const next = Object.assign({}, total);
  for (const field of [
    'input_tokens', 'cached_input_tokens', 'output_tokens',
    'reasoning_output_tokens', 'total_tokens'
  ]) {
    if (Number.isFinite(usage[field])) next[field] = (next[field] || 0) + usage[field];
  }
  return next;
}

function emptyUsage(providerId) {
  const result = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  if (providerId === PROVIDERS.CODEX) {
    result.cached_input_tokens = 0;
    result.reasoning_output_tokens = 0;
  }
  return result;
}

function attemptHistory(report) {
  const result = ['REQUESTING', 'RESPONSE_RECEIVED'];
  if (report.checks.schema === 'passed') result.push('CANDIDATE_VALIDATED');
  if (report.checks.staticRules === 'passed') result.push('COMPILED');
  if (report.checks.duplicate === 'passed') result.push('DUPLICATE_CHECKED');
  if (report.checks.runtime === 'passed') result.push('RUNTIME_VERIFIED');
  if (report.checks.solver === 'solved' || report.checks.solver === 'limit') result.push('SOLVER_AUDITED');
  if (report.checks.difficulty === 'passed') result.push('DIFFICULTY_VERIFIED');
  result.push(report.status === 'reviewable' ? 'REVIEWABLE' : report.status === 'failed' ? 'FAILED' : 'REJECTED');
  return result;
}

function repeatCandidateResult(previous, targetGrade) {
  const previousChecks = previous && previous.report && previous.report.checks || {};
  const schema = previousChecks.schema || 'failed';
  const staticRules = previousChecks.staticRules || (schema === 'passed' ? 'failed' : 'skipped');
  const reachedDuplicateCheck = schema === 'passed' && staticRules === 'passed';
  const report = {
    schemaVersion: 1,
    status: 'rejected',
    retryable: true,
    errorCodes: ['CANDIDATE_REPEAT'],
    warnings: [],
    checks: {
      schema,
      staticRules,
      duplicate: reachedDuplicateCheck ? 'failed' : 'pending',
      runtime: 'pending',
      solver: 'pending',
      difficulty: 'pending'
    },
    difficulty: { targetGrade, actualGrade: null, score: null }
  };
  const layoutKey = reachedDuplicateCheck && previous && previous.layoutKey || null;
  if (layoutKey) report.details = { layoutKey };
  return {
    status: 'rejected',
    level: reachedDuplicateCheck && previous.level || null,
    solution: reachedDuplicateCheck && previous.solution || null,
    layoutKey,
    report
  };
}

function safeProviderError(error) {
  const responseId = error && typeof error.providerResponseId === 'string'
    ? error.providerResponseId : error && typeof error.responseId === 'string'
      ? error.responseId : null;
  const responseStatus = error && typeof error.turnStatus === 'string'
    ? error.turnStatus : error && typeof error.responseStatus === 'string'
      ? error.responseStatus : null;
  return {
    code: error && typeof error.code === 'string' ? error.code : 'PROVIDER_CLIENT_FAILED',
    kind: error && typeof error.kind === 'string' ? error.kind : 'client',
    retryable: !!(error && error.retryable),
    httpStatus: error && Number.isInteger(error.httpStatus) ? error.httpStatus : null,
    retryAfterMs: error && Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0,
    responseId,
    responseStatus,
    providerResponseId: responseId,
    threadId: error && typeof error.threadId === 'string' ? error.threadId : null,
    turnStatus: error && typeof error.turnStatus === 'string' ? error.turnStatus : null,
    usage: error && error.usage && typeof error.usage === 'object'
      ? JSON.parse(JSON.stringify(error.usage)) : null,
    details: error && error.details && typeof error.details === 'object'
      ? JSON.parse(JSON.stringify(error.details)) : null
  };
}

function runBudgetProviderError(error) {
  const result = safeProviderError(error);
  result.code = 'RUN_TIME_BUDGET_EXHAUSTED';
  result.kind = 'budget';
  result.retryable = false;
  return result;
}

function successfulProviderMetadata(providerId, generated, latencyMs) {
  const responseId = typeof generated.providerResponseId === 'string'
    ? generated.providerResponseId : typeof generated.responseId === 'string'
      ? generated.responseId : null;
  return {
    id: providerId,
    responseId,
    threadId: providerId === PROVIDERS.CODEX && typeof generated.threadId === 'string'
      ? generated.threadId : null,
    status: generated.status || null,
    latencyMs,
    usage: generated.usage || null
  };
}

function failedProviderMetadata(providerId, error, latencyMs) {
  return {
    id: providerId,
    responseId: error && error.providerResponseId || null,
    threadId: providerId === PROVIDERS.CODEX && error && error.threadId || null,
    status: error && (error.turnStatus || error.responseStatus) || null,
    latencyMs,
    usage: error && error.usage || null,
    error
  };
}

class Pipeline {
  constructor(options) {
    const input = options || {};
    if (!input.client || !input.store) throw new PipelineError('PIPELINE_DEPENDENCY_MISSING');
    this.client = input.client;
    this.store = input.store;
    this.validateCandidate = input.validateCandidate || validator.validateCandidate;
    this.clock = typeof input.clock === 'function' ? input.clock : Date.now;
    this.wait = typeof input.wait === 'function' ? input.wait : ms => new Promise(resolve => setTimeout(resolve, ms));
    const limits = input.limits || {};
    this.limits = {
      maxCandidates: boundedLimit(limits.maxCandidates, LIMITS.maxCandidates),
      maxTransportAttempts: boundedLimit(limits.maxTransportAttempts, LIMITS.maxTransportAttempts),
      maxProviderCalls: boundedLimit(
        limits.maxProviderCalls === undefined ? limits.maxHttpCalls : limits.maxProviderCalls,
        LIMITS.maxProviderCalls),
      maxProviderCallDurationMs: boundedLimit(
        limits.maxProviderCallDurationMs, LIMITS.maxProviderCallDurationMs),
      maxPortalProviderCallDurationMs: boundedLimit(
        limits.maxPortalProviderCallDurationMs, LIMITS.maxPortalProviderCallDurationMs),
      maxDurationMs: boundedLimit(limits.maxDurationMs, LIMITS.maxDurationMs)
    };
  }

  async persistRun(record) {
    record.updatedAt = new Date(this.clock()).toISOString();
    await this.store.writeRun(record.runId, record);
  }

  async finishFailed(record, errorCodes, exitCode) {
    record.status = transition(record.status, 'FAILED', RUN_TRANSITIONS);
    record.history.push(record.status);
    record.finalErrorCodes = errorCodes.slice();
    record.finishedAt = new Date(this.clock()).toISOString();
    await this.persistRun(record);
    return { runId: record.runId, status: record.status, exitCode, errorCodes, record };
  }

  async generate(options) {
    const checked = contracts.validateBrief(options && options.brief);
    if (!checked.ok) {
      return { runId: null, status: 'FAILED', exitCode: 2, errorCodes: [checked.error.code] };
    }
    const providerId = options && options.provider || PROVIDERS.RESPONSES;
    if (providerId !== PROVIDERS.RESPONSES && providerId !== PROVIDERS.CODEX) {
      throw new PipelineError('PROVIDER_INVALID');
    }
    const started = this.clock();
    const runId = this.store.newRunId();
    const record = {
      schemaVersion: 1,
      runId,
      implementationVersion: IMPLEMENTATION_VERSION,
      promptVersion: prompt.PROMPT_VERSION,
      provider: providerId,
      briefHash: sha256(checked.value),
      model: providerId === PROVIDERS.RESPONSES ? options.model || null : null,
      startedAt: new Date(started).toISOString(),
      updatedAt: new Date(started).toISOString(),
      finishedAt: null,
      status: 'CREATED',
      candidateAttempts: 0,
      providerCalls: 0,
      httpCalls: 0,
      usage: emptyUsage(providerId),
      cost: {
        status: providerId === PROVIDERS.CODEX
          ? 'not_applicable_subscription' : 'not_calculated',
        costAccounting: providerId === PROVIDERS.CODEX
          ? 'not_applicable_subscription' : 'api_usage_unpriced',
        estimatedCostUsd: null,
        pricingSnapshotId: null,
        currency: null,
        estimated: null
      },
      finalErrorCodes: [],
      decision: null,
      history: ['CREATED']
    };
    await this.store.createRun(checked.value, record);
    record.status = transition(record.status, 'BRIEF_VALIDATED', RUN_TRANSITIONS);
    record.history.push(record.status);
    await this.persistRun(record);
    record.status = transition(record.status, 'GENERATING', RUN_TRANSITIONS);
    record.history.push(record.status);
    await this.persistRun(record);

    const previousReports = [];
    const previousHashes = new Set();
    const previousCandidates = new Map();
    const previousLayoutKeys = [];
    for (let attemptNumber = 1; attemptNumber <= this.limits.maxCandidates; attemptNumber += 1) {
      if (this.clock() - started >= this.limits.maxDurationMs) {
        return this.finishFailed(record, ['RUN_TIME_BUDGET_EXHAUSTED'], 4);
      }
      record.candidateAttempts = attemptNumber;
      let generated = null;
      let providerError = null;
      let latencyMs = 0;
      let transportAttempts = 0;
      let runBudgetExhausted = false;
      for (let transportAttempt = 1; transportAttempt <= this.limits.maxTransportAttempts; transportAttempt += 1) {
        if (record.providerCalls >= this.limits.maxProviderCalls ||
            this.clock() - started >= this.limits.maxDurationMs) break;
        const requestStarted = this.clock();
        const remainingTimeMs = Math.max(0,
          this.limits.maxDurationMs - (requestStarted - started));
        if (remainingTimeMs <= 0) {
          runBudgetExhausted = true;
          providerError = runBudgetProviderError(providerError);
          break;
        }
        record.providerCalls += 1;
        if (providerId === PROVIDERS.RESPONSES) record.httpCalls += 1;
        transportAttempts += 1;
        const deadlineController = new AbortController();
        let deadlineExpired = false;
        const deadlineTimer = setTimeout(() => {
          deadlineExpired = true;
          deadlineController.abort();
        }, remainingTimeMs);
        try {
          const providerCallDurationMs = checked.value.mechanic === 'portal'
            ? this.limits.maxPortalProviderCallDurationMs
            : this.limits.maxProviderCallDurationMs;
          const request = {
            instructions: prompt.INSTRUCTIONS,
            inputText: prompt.buildInput(checked.value, previousReports),
            schema: contracts.generationSchema(checked.value),
            mechanic: checked.value.mechanic,
            signal: deadlineController.signal,
            remainingTimeMs,
            timeoutMs: Math.min(providerCallDurationMs, remainingTimeMs)
          };
          if (providerId === PROVIDERS.RESPONSES) {
            request.apiKey = options.apiKey;
            request.model = options.model;
          }
          generated = await this.client.generate(request);
          latencyMs += Math.max(0, this.clock() - requestStarted);
          providerError = null;
          if (deadlineExpired || this.clock() - started >= this.limits.maxDurationMs) {
            runBudgetExhausted = true;
          }
          break;
        } catch (error) {
          latencyMs += Math.max(0, this.clock() - requestStarted);
          runBudgetExhausted = deadlineExpired ||
            this.clock() - started >= this.limits.maxDurationMs;
          providerError = runBudgetExhausted
            ? runBudgetProviderError(error) : safeProviderError(error);
          record.usage = addUsage(record.usage, providerError.usage);
          if (runBudgetExhausted || !providerError.retryable ||
              transportAttempt >= this.limits.maxTransportAttempts ||
              record.providerCalls >= this.limits.maxProviderCalls) break;
          const delay = Math.min(30000, providerError.retryAfterMs || 250);
          if (this.clock() - started + delay >= this.limits.maxDurationMs) break;
          await this.wait(delay);
        } finally {
          clearTimeout(deadlineTimer);
        }
      }
      if (!generated && (runBudgetExhausted ||
          this.clock() - started >= this.limits.maxDurationMs)) {
        runBudgetExhausted = true;
        providerError = runBudgetProviderError(providerError);
      }
      if (!generated) {
        const code = runBudgetExhausted ? 'RUN_TIME_BUDGET_EXHAUSTED' :
          providerError ? providerError.code : providerId === PROVIDERS.RESPONSES
          ? 'HTTP_CALL_BUDGET_EXHAUSTED' : 'PROVIDER_CALL_BUDGET_EXHAUSTED';
        const failedAttempt = {
          schemaVersion: 1,
          attemptNumber,
          status: 'FAILED',
          history: ['REQUESTING', 'FAILED'],
          transportAttempts,
          provider: failedProviderMetadata(providerId, providerError, latencyMs)
        };
        if (providerId === PROVIDERS.RESPONSES) {
          failedAttempt.api = { error: providerError, latencyMs };
        }
        await this.store.writeAttempt(runId, attemptNumber, failedAttempt);
        const exitCode = providerError && providerError.kind === 'configuration' ? 3 : 4;
        return this.finishFailed(record, [code], exitCode);
      }

      record.usage = addUsage(record.usage, generated.usage);
      if (runBudgetExhausted || this.clock() - started >= this.limits.maxDurationMs) {
        const timedOutAttempt = {
          schemaVersion: 1,
          attemptNumber,
          status: 'FAILED',
          history: ['REQUESTING', 'RESPONSE_RECEIVED', 'FAILED'],
          transportAttempts,
          candidateReceived: true,
          provider: successfulProviderMetadata(providerId, generated, latencyMs),
          candidate: generated.candidate,
          errorCodes: ['RUN_TIME_BUDGET_EXHAUSTED']
        };
        if (providerId === PROVIDERS.RESPONSES) {
          timedOutAttempt.api = {
            responseId: generated.responseId || null,
            status: generated.status || null,
            latencyMs,
            usage: generated.usage || null
          };
        }
        await this.store.writeAttempt(runId, attemptNumber, timedOutAttempt);
        return this.finishFailed(record, ['RUN_TIME_BUDGET_EXHAUSTED'], 4);
      }
      const candidateHash = sha256(generated.candidate);
      let validated;
      if (previousHashes.has(candidateHash)) {
        validated = repeatCandidateResult(
          previousCandidates.get(candidateHash), checked.value.targetGrade);
      } else {
        try {
          validated = this.validateCandidate(checked.value, generated.candidate, {
            previousLayoutKeys,
            maxOptimizationDurationMs: Math.max(0,
              this.limits.maxDurationMs - (this.clock() - started))
          });
        } catch (error) {
          const validatorFailedAttempt = {
            schemaVersion: 1,
            attemptNumber,
            status: 'FAILED',
            history: ['REQUESTING', 'RESPONSE_RECEIVED', 'FAILED'],
            transportAttempts,
            candidateReceived: true,
            provider: successfulProviderMetadata(providerId, generated, latencyMs),
            candidateHash,
            layoutKey: null,
            candidate: generated.candidate,
            validationReport: null,
            errorCodes: ['VALIDATOR_INTERNAL_ERROR']
          };
          if (providerId === PROVIDERS.RESPONSES) {
            validatorFailedAttempt.api = {
              responseId: generated.responseId || null,
              status: generated.status || null,
              latencyMs,
              usage: generated.usage || null
            };
          }
          await this.store.writeAttempt(runId, attemptNumber, validatorFailedAttempt);
          return this.finishFailed(record, ['VALIDATOR_INTERNAL_ERROR'], 5);
        }
      }
      previousHashes.add(candidateHash);
      if (!previousCandidates.has(candidateHash)) previousCandidates.set(candidateHash, validated);
      if (validated.layoutKey && previousLayoutKeys.indexOf(validated.layoutKey) < 0) {
        previousLayoutKeys.push(validated.layoutKey);
      }
      const attempt = {
        schemaVersion: 1,
        attemptNumber,
        status: validated.status === 'reviewable' ? 'REVIEWABLE' :
          validated.status === 'failed' ? 'FAILED' : 'REJECTED',
        history: attemptHistory(validated.report),
        transportAttempts,
        candidateReceived: true,
        provider: successfulProviderMetadata(providerId, generated, latencyMs),
        candidateHash,
        layoutKey: validated.layoutKey || null,
        candidate: generated.candidate,
        validationReport: validated.report
      };
      if (providerId === PROVIDERS.RESPONSES) {
        attempt.api = {
          responseId: generated.responseId || null,
          status: generated.status || null,
          latencyMs,
          usage: generated.usage || null
        };
      }
      await this.store.writeAttempt(runId, attemptNumber, attempt);
      if (validated.status === 'reviewable') {
        await this.store.writeCandidate(runId, {
          schemaVersion: 1,
          runId,
          brief: checked.value,
          candidate: generated.candidate,
          level: validated.level,
          solution: validated.solution,
          layoutKey: validated.layoutKey,
          validationReport: validated.report
        });
        record.status = transition(record.status, 'AWAITING_REVIEW', RUN_TRANSITIONS);
        record.history.push(record.status);
        record.finishedAt = new Date(this.clock()).toISOString();
        record.reviewableAttempt = attemptNumber;
        await this.persistRun(record);
        return { runId, status: record.status, exitCode: 0, errorCodes: [], record, candidate: validated };
      }
      if (validated.status === 'failed' || !validated.report.retryable) {
        return this.finishFailed(record, validated.report.errorCodes, 5);
      }
      previousReports.push(validated.report);
    }
    return this.finishFailed(record, ['CANDIDATE_BUDGET_EXHAUSTED'], 4);
  }
}

const REVIEW_DECISIONS = new Set([
  'accepted', 'reject_too_easy', 'reject_too_hard', 'reject_confusing',
  'reject_too_similar', 'reject_intent_mismatch', 'reject_not_fun', 'reject_other'
]);

async function replayRun(store, runId, validateCandidate) {
  const artifact = await store.readCandidate(runId);
  return (validateCandidate || validator.validateCandidate)(artifact.brief, artifact.candidate);
}

async function reviewRun(store, runId, decision, reason, clock) {
  if (!REVIEW_DECISIONS.has(decision)) throw new PipelineError('REVIEW_DECISION_INVALID');
  if (reason !== undefined && (typeof reason !== 'string' || Array.from(reason).length > 500 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(reason))) {
    throw new PipelineError('REVIEW_REASON_INVALID');
  }
  const record = await store.readRun(runId);
  const now = typeof clock === 'function' ? clock : Date.now;
  const normalizedReason = reason || null;
  const existing = await store.readReview(runId);
  if (existing && (existing.decision !== decision || existing.reason !== normalizedReason)) {
    throw new PipelineError('REVIEW_CONFLICT');
  }
  const targetStatus = decision === 'accepted' ? 'ACCEPTED' : 'REJECTED';
  if (existing && record.status === targetStatus) {
    return { runId, status: record.status, review: existing };
  }
  if (record.status !== 'AWAITING_REVIEW') throw new PipelineError('REVIEW_STATE_INVALID');
  await store.readCandidate(runId);
  let review = existing || {
    schemaVersion: 1,
    decision,
    reason: normalizedReason,
    decidedAt: new Date(now()).toISOString()
  };
  if (!existing) {
    try {
      await store.writeReview(runId, review);
    } catch (error) {
      if (!error || error.code !== 'RUN_STORE_ARTIFACT_EXISTS') throw error;
      const winner = await store.readReview(runId);
      if (!winner || winner.decision !== decision || winner.reason !== normalizedReason) {
        throw new PipelineError('REVIEW_CONFLICT');
      }
      review = winner;
    }
  }
  record.status = transition(record.status, targetStatus, RUN_TRANSITIONS);
  record.history.push(record.status);
  record.decision = review;
  record.updatedAt = review.decidedAt;
  await store.writeRun(runId, record);
  return { runId, status: record.status, review };
}

module.exports = {
  IMPLEMENTATION_VERSION,
  PROVIDERS,
  LIMITS,
  RUN_TRANSITIONS,
  ATTEMPT_TRANSITIONS,
  REVIEW_DECISIONS,
  Pipeline,
  PipelineError,
  transition,
  stableStringify,
  sha256,
  addUsage,
  emptyUsage,
  safeProviderError,
  replayRun,
  reviewRun
};
