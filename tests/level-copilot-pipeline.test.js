'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RunStore, assertNoSecrets } = require('../scripts/level-copilot/run-store.js');
const {
  Pipeline,
  PROVIDERS,
  LIMITS,
  RUN_TRANSITIONS,
  ATTEMPT_TRANSITIONS,
  transition,
  reviewRun,
  replayRun
} = require('../scripts/level-copilot/pipeline.js');
const { main: cliMain, parseArguments } = require('../scripts/level-copilot/cli.js');

const brief = {
  schemaVersion: 1,
  mechanic: 'ordinary',
  width: 5,
  height: 5,
  colorCount: 5,
  targetGrade: 1,
  designIntent: 'Fixture.'
};

function cover(summary) {
  return {
    schemaVersion: 1,
    paths: Array.from({ length: 5 }, (_, row) => ({
      cells: Array.from({ length: 5 }, (_, column) => row * 5 + (row % 2 ? 4 - column : column))
    })),
    designSummary: summary
  };
}

function rowCover(width, height, summary) {
  return {
    schemaVersion: 1,
    paths: Array.from({ length: height }, (_, row) => ({
      cells: Array.from({ length: width }, (_, column) => row * width + column)
    })),
    designSummary: summary
  };
}

function api(candidate, id) {
  return {
    candidate,
    responseId: id || 'resp_test',
    status: 'completed',
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
  };
}

function temporaryRoot(label) {
  const base = fs.realpathSync(os.tmpdir());
  return fs.mkdtempSync(path.join(base, `cleared-copilot-${label}-`));
}

function directoryHash(directory) {
  const hash = crypto.createHash('sha256');
  function visit(current) {
    fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(entry => {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute);
      hash.update(relative);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    });
  }
  visit(directory);
  return hash.digest('hex');
}

async function read(store, runId, filename) {
  return store.readJson(runId, filename);
}

function rejectedReport(code) {
  return {
    schemaVersion: 1,
    status: 'rejected',
    retryable: true,
    errorCodes: [code],
    warnings: [],
    checks: { schema: 'passed', staticRules: 'failed', duplicate: 'pending',
      runtime: 'pending', solver: 'pending', difficulty: 'pending' },
    difficulty: { targetGrade: 1, actualGrade: null, score: null }
  };
}

async function run() {
  const formalDataHash = directoryHash(path.join(__dirname, '..', 'data'));
  Object.keys(RUN_TRANSITIONS).forEach(current => RUN_TRANSITIONS[current].forEach(next =>
    assert.strictEqual(transition(current, next, RUN_TRANSITIONS), next)));
  Object.keys(ATTEMPT_TRANSITIONS).forEach(current => ATTEMPT_TRANSITIONS[current].forEach(next =>
    assert.strictEqual(transition(current, next, ATTEMPT_TRANSITIONS), next)));
  assert.throws(() => transition('GENERATING', 'CREATED', RUN_TRANSITIONS), /STATE_TRANSITION_INVALID/);
  assert.throws(() => transition('REVIEWABLE', 'FAILED', ATTEMPT_TRANSITIONS), /STATE_TRANSITION_INVALID/);

  const root = temporaryRoot('success');
  try {
    const store = new RunStore({ root: path.join(root, 'runs') });
    let calls = 0;
    const waits = [];
    const client = { async generate() {
      calls += 1;
      if (calls === 1) {
        const error = new Error('private');
        error.code = 'OPENAI_SERVER_ERROR'; error.kind = 'http'; error.retryable = true;
        error.responseId = 'resp_retry_failed'; error.responseStatus = 'failed';
        error.usage = { input_tokens: 1, output_tokens: 2, total_tokens: 3 };
        throw error;
      }
      return api(cover('valid'), 'resp_success');
    } };
    let now = Date.UTC(2026, 8, 13);
    const pipeline = new Pipeline({
      client,
      store,
      clock: () => now += 10,
      wait: async delay => { waits.push(delay); }
    });
    const result = await pipeline.generate({ brief, apiKey: 'unit-test-key', model: 'explicit-model' });
    assert.strictEqual(result.status, 'AWAITING_REVIEW');
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.record.implementationVersion, 15);
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(waits, [250]);
    assert.strictEqual(result.record.httpCalls, 2);
    assert.deepStrictEqual(result.record.history,
      ['CREATED', 'BRIEF_VALIDATED', 'GENERATING', 'AWAITING_REVIEW']);
    assert.deepStrictEqual(result.record.usage, { input_tokens: 11, output_tokens: 22, total_tokens: 33 });
    const attempt = await read(store, result.runId, 'attempt-01.json');
    assert.strictEqual(attempt.status, 'REVIEWABLE');
    assert.strictEqual(attempt.transportAttempts, 2);
    assert.strictEqual(attempt.api.responseId, 'resp_success');
    assert(!JSON.stringify(attempt).includes('unit-test-key'));
    const artifact = await store.readCandidate(result.runId);
    assert.deepStrictEqual(artifact.brief, brief);
    assert.strictEqual(artifact.validationReport.status, 'reviewable');
    const replayed = await replayRun(store, result.runId);
    assert.strictEqual(replayed.status, 'reviewable');
    const writeRun = store.writeRun.bind(store);
    let interruptReview = true;
    store.writeRun = async (runId, value) => {
      if (interruptReview && value.status === 'ACCEPTED') {
        interruptReview = false;
        throw new Error('simulated interruption after review.json');
      }
      return writeRun(runId, value);
    };
    await assert.rejects(() => reviewRun(store, result.runId, 'accepted', 'Clear opening.', () => now += 10),
      /simulated interruption/);
    assert.strictEqual((await store.readReview(result.runId)).decision, 'accepted');
    assert.strictEqual((await store.readRun(result.runId)).status, 'AWAITING_REVIEW');
    const reviewed = await reviewRun(store, result.runId, 'accepted', 'Clear opening.', () => now += 10);
    assert.strictEqual(reviewed.status, 'ACCEPTED');
    assert.strictEqual((await reviewRun(store, result.runId, 'accepted', 'Clear opening.', () => now += 10)).status,
      'ACCEPTED', 'same review retry must be idempotent after the run record is updated');
    await assert.rejects(() => reviewRun(store, result.runId, 'reject_not_fun', '', () => now),
      error => error.code === 'REVIEW_CONFLICT');
    await assert.rejects(() => store.writeReview(result.runId, {}),
      error => error.code === 'RUN_STORE_ARTIFACT_EXISTS');
    await store.writeReviewRevision(result.runId, {
      schemaVersion: 1, previousDecision: 'accepted', decision: 'reject_other', decidedAt: new Date(now).toISOString()
    });
    assert.strictEqual((await read(store, result.runId, 'review-revision-01.json')).decision, 'reject_other');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const largeRoot = temporaryRoot('large-board');
  try {
    const store = new RunStore({ root: path.join(largeRoot, 'runs') });
    let request = null;
    const largeBrief = {
      schemaVersion: 1,
      mechanic: 'ordinary',
      width: 8,
      height: 10,
      colorCount: 10,
      targetGrade: 1,
      designIntent: 'Rectangular pipeline fixture.'
    };
    const result = await new Pipeline({
      client: { async generate(value) {
        request = value;
        return api(rowCover(8, 10, 'Ten direct rows.'), 'resp_large');
      } },
      store,
      clock: () => Date.UTC(2026, 8, 14),
      wait: async () => {}
    }).generate({ brief: largeBrief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'AWAITING_REVIEW');
    assert.strictEqual(request.schema.properties.paths.minItems, 10);
    assert.strictEqual(request.schema.properties.paths.items.properties.cells.maxItems, 80);
    assert.deepStrictEqual(JSON.parse(request.inputText).brief, largeBrief);
    assert.strictEqual(request.timeoutMs, 60000);
    assert.strictEqual((await store.readCandidate(result.runId)).level.Height, 10);
  } finally {
    fs.rmSync(largeRoot, { recursive: true, force: true });
  }

  const portalTimeoutRoot = temporaryRoot('portal-timeout');
  try {
    const store = new RunStore({ root: path.join(portalTimeoutRoot, 'runs') });
    let request = null;
    const portalBrief = {
      schemaVersion: 1,
      mechanic: 'portal',
      width: 8,
      height: 8,
      colorCount: 6,
      targetGrade: 3,
      designIntent: 'Portal timeout fixture.'
    };
    const validationReport = {
      schemaVersion: 1,
      status: 'reviewable',
      retryable: false,
      errorCodes: [],
      warnings: [],
      checks: { schema: 'passed', staticRules: 'passed', duplicate: 'passed',
        runtime: 'passed', solver: 'solved', difficulty: 'passed' },
      difficulty: { targetGrade: 3, actualGrade: 3, grade: 3, score: 50 }
    };
    const result = await new Pipeline({
      client: { async generate(value) { request = value; return api({}, 'portal_timeout'); } },
      store,
      validateCandidate: () => ({
        status: 'reviewable',
        report: validationReport,
        level: { Mechanic: 'portal', Width: 8, Height: 8, Lines: [] },
        solution: [],
        layoutKey: '8x8:portal-timeout@1,2'
      }),
      clock: () => Date.UTC(2026, 8, 15),
      wait: async () => {}
    }).generate({ brief: portalBrief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'AWAITING_REVIEW');
    assert.strictEqual(request.timeoutMs, LIMITS.maxPortalProviderCallDurationMs);
    assert.strictEqual(request.remainingTimeMs, LIMITS.maxDurationMs);
    assert.strictEqual(request.mechanic, 'portal');
    assert.strictEqual(request.schema.properties.paths.minItems, 5);
    assert.strictEqual(request.schema.properties.portalCells, undefined);
  } finally {
    fs.rmSync(portalTimeoutRoot, { recursive: true, force: true });
  }

  const billedFailureRoot = temporaryRoot('billed-failure');
  try {
    const store = new RunStore({ root: path.join(billedFailureRoot, 'runs') });
    const result = await new Pipeline({
      client: { generate: async () => {
        const error = new Error('refused');
        error.code = 'OPENAI_RESPONSE_REFUSED';
        error.kind = 'response';
        error.responseId = 'resp_refused';
        error.responseStatus = 'completed';
        error.usage = { input_tokens: 4, output_tokens: 5, total_tokens: 9 };
        throw error;
      } },
      store,
      clock: () => Date.UTC(2026, 8, 13),
      wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'FAILED');
    assert.deepStrictEqual(result.record.usage, { input_tokens: 4, output_tokens: 5, total_tokens: 9 });
    const attempt = await read(store, result.runId, 'attempt-01.json');
    assert.strictEqual(attempt.api.error.responseId, 'resp_refused');
    assert.strictEqual(attempt.api.error.responseStatus, 'completed');
    assert.deepStrictEqual(attempt.api.error.usage,
      { input_tokens: 4, output_tokens: 5, total_tokens: 9 });
  } finally {
    fs.rmSync(billedFailureRoot, { recursive: true, force: true });
  }

  for (const providerId of [PROVIDERS.RESPONSES, PROVIDERS.CODEX]) {
    const deadlineRoot = temporaryRoot(providerId === PROVIDERS.CODEX
      ? 'codex-deadline' : 'responses-deadline');
    try {
      const store = new RunStore({ root: path.join(deadlineRoot, 'runs') });
      let cleanupCompleted = false;
      let lateCompletion = false;
      let receivedRequest = null;
      const cancellationUsage = providerId === PROVIDERS.CODEX
        ? {
          input_tokens: 11, cached_input_tokens: 4, output_tokens: 3,
          reasoning_output_tokens: 2, total_tokens: 14
        }
        : { input_tokens: 11, output_tokens: 3, total_tokens: 14 };
      const client = { generate(request) {
        receivedRequest = request;
        return new Promise((resolve, reject) => {
          const slowTimer = setTimeout(() => {
            lateCompletion = true;
            resolve(api(cover('too late'), 'late_response'));
          }, 300);
          const onAbort = () => {
            clearTimeout(slowTimer);
            request.signal.removeEventListener('abort', onAbort);
            cleanupCompleted = true;
            const error = new Error('cancelled at run deadline');
            error.code = providerId === PROVIDERS.CODEX
              ? 'CODEX_EXEC_CANCELLED' : 'OPENAI_REQUEST_CANCELLED';
            error.kind = 'transport';
            error.usage = cancellationUsage;
            if (providerId === PROVIDERS.CODEX) {
              error.providerResponseId = 'thread_cancelled';
              error.threadId = 'thread_cancelled';
              error.turnStatus = 'in_progress';
            } else {
              error.responseId = 'resp_cancelled';
              error.responseStatus = 'in_progress';
            }
            reject(error);
          };
          request.signal.addEventListener('abort', onAbort, { once: true });
        });
      } };
      const startedAt = Date.now();
      const result = await new Pipeline({
        client,
        store,
        limits: { maxDurationMs: 100 }
      }).generate({
        brief,
        provider: providerId,
        apiKey: providerId === PROVIDERS.RESPONSES ? 'key' : undefined,
        model: providerId === PROVIDERS.RESPONSES ? 'm' : undefined
      });
      const elapsedMs = Date.now() - startedAt;
      assert.strictEqual(result.status, 'FAILED');
      assert.deepStrictEqual(result.errorCodes, ['RUN_TIME_BUDGET_EXHAUSTED']);
      assert(elapsedMs >= 70 && elapsedMs < 250,
        `${providerId} must stop near the 100 ms run budget, got ${elapsedMs} ms`);
      assert.strictEqual(receivedRequest.signal.aborted, true);
      assert(receivedRequest.remainingTimeMs > 0 && receivedRequest.remainingTimeMs <= 100);
      assert.strictEqual(receivedRequest.timeoutMs, receivedRequest.remainingTimeMs);
      assert.strictEqual(cleanupCompleted, true);
      assert.strictEqual(result.record.providerCalls, 1);
      assert.strictEqual(result.record.httpCalls,
        providerId === PROVIDERS.RESPONSES ? 1 : 0);
      assert.deepStrictEqual(result.record.usage, cancellationUsage);
      const attempt = await read(store, result.runId, 'attempt-01.json');
      assert.strictEqual(attempt.status, 'FAILED');
      assert.strictEqual(attempt.candidateReceived, undefined);
      assert.strictEqual(attempt.provider.error.code, 'RUN_TIME_BUDGET_EXHAUSTED');
      assert.strictEqual(attempt.provider.error.kind, 'budget');
      assert.deepStrictEqual(attempt.provider.error.usage, cancellationUsage);
      assert.strictEqual((await store.readRun(result.runId)).status, 'FAILED');
      if (providerId === PROVIDERS.RESPONSES) {
        assert.strictEqual(attempt.api.error.responseId, 'resp_cancelled');
      } else {
        assert.strictEqual(attempt.provider.threadId, 'thread_cancelled');
      }
      await new Promise(resolve => setTimeout(resolve, 220));
      assert.strictEqual(lateCompletion, false,
        `${providerId} must not leave a slow provider timer after returning`);
    } finally {
      fs.rmSync(deadlineRoot, { recursive: true, force: true });
    }
  }

  const validatorFailureRoot = temporaryRoot('validator-failure');
  try {
    const store = new RunStore({ root: path.join(validatorFailureRoot, 'runs') });
    const result = await new Pipeline({
      client: { generate: async () => api(cover('validator failure'), 'resp_validator_failure') },
      store,
      validateCandidate: () => { throw new Error('validator failed'); },
      clock: () => Date.UTC(2026, 8, 13),
      wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'FAILED');
    assert.deepStrictEqual(result.errorCodes, ['VALIDATOR_INTERNAL_ERROR']);
    const attempt = await read(store, result.runId, 'attempt-01.json');
    assert.strictEqual(attempt.candidateReceived, true);
    assert.strictEqual(attempt.api.responseId, 'resp_validator_failure');
    assert.strictEqual(attempt.validationReport, null);
  } finally {
    fs.rmSync(validatorFailureRoot, { recursive: true, force: true });
  }

  const concurrentReviewRoot = temporaryRoot('concurrent-review');
  try {
    const store = new RunStore({ root: path.join(concurrentReviewRoot, 'runs') });
    const generated = await new Pipeline({
      client: { generate: async () => api(cover('concurrent'), 'resp_concurrent') },
      store,
      clock: () => Date.UTC(2026, 8, 13),
      wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    const settled = await Promise.allSettled([
      reviewRun(store, generated.runId, 'accepted', 'first decision', () => Date.UTC(2026, 8, 13)),
      reviewRun(store, generated.runId, 'reject_not_fun', 'second decision', () => Date.UTC(2026, 8, 13))
    ]);
    const fulfilled = settled.filter(item => item.status === 'fulfilled');
    const rejected = settled.filter(item => item.status === 'rejected');
    assert.strictEqual(fulfilled.length, 1, 'only one competing review may commit');
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0].reason.code, 'REVIEW_CONFLICT');
    const persistedReview = await store.readReview(generated.runId);
    const persistedRun = await store.readRun(generated.runId);
    assert.strictEqual(persistedReview.decision, fulfilled[0].value.review.decision);
    assert.strictEqual(persistedRun.decision.decision, persistedReview.decision);
    assert.strictEqual(persistedRun.status,
      persistedReview.decision === 'accepted' ? 'ACCEPTED' : 'REJECTED');
  } finally {
    fs.rmSync(concurrentReviewRoot, { recursive: true, force: true });
  }

  const repeatRoot = temporaryRoot('repeat');
  try {
    const store = new RunStore({ root: path.join(repeatRoot, 'runs') });
    const invalid = cover('same');
    invalid.paths[4].cells.pop();
    const values = [api(invalid, 'one'), api(invalid, 'two'), api(cover('valid'), 'three')];
    const result = await new Pipeline({
      client: { generate: async () => values.shift() }, store,
      clock: () => Date.UTC(2026, 8, 13), wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'AWAITING_REVIEW');
    assert.strictEqual(result.record.candidateAttempts, 3);
    assert.deepStrictEqual((await read(store, result.runId, 'attempt-01.json')).validationReport.errorCodes,
      ['CANDIDATE_COVERAGE_MISSING']);
    const repeatAttempt = await read(store, result.runId, 'attempt-02.json');
    assert.deepStrictEqual(repeatAttempt.validationReport.errorCodes, ['CANDIDATE_REPEAT']);
    assert.strictEqual(repeatAttempt.validationReport.checks.schema, 'passed');
    assert.strictEqual(repeatAttempt.validationReport.checks.staticRules, 'failed');
    assert.strictEqual(repeatAttempt.validationReport.checks.duplicate, 'pending');
  } finally {
    fs.rmSync(repeatRoot, { recursive: true, force: true });
  }

  const malformedRepeatRoot = temporaryRoot('malformed-repeat');
  try {
    const store = new RunStore({ root: path.join(malformedRepeatRoot, 'runs') });
    const malformed = cover('malformed');
    delete malformed.designSummary;
    const values = [api(malformed, 'one'), api(malformed, 'two'), api(cover('valid'), 'three')];
    const result = await new Pipeline({
      client: { generate: async () => values.shift() }, store,
      clock: () => Date.UTC(2026, 8, 13), wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'AWAITING_REVIEW');
    const first = await read(store, result.runId, 'attempt-01.json');
    const repeated = await read(store, result.runId, 'attempt-02.json');
    assert.deepStrictEqual(first.validationReport.errorCodes, ['CANDIDATE_SCHEMA_INVALID']);
    assert.deepStrictEqual(repeated.validationReport.errorCodes, ['CANDIDATE_REPEAT']);
    assert.strictEqual(repeated.validationReport.checks.schema, 'failed');
    assert.strictEqual(repeated.validationReport.checks.staticRules, 'skipped');
    assert.strictEqual(repeated.validationReport.checks.duplicate, 'pending');
  } finally {
    fs.rmSync(malformedRepeatRoot, { recursive: true, force: true });
  }

  const exhaustedRoot = temporaryRoot('exhausted');
  try {
    const store = new RunStore({ root: path.join(exhaustedRoot, 'runs') });
    let number = 0;
    const result = await new Pipeline({
      client: { generate: async () => api(Object.assign(cover(`invalid-${++number}`), {
        paths: cover().paths.slice(0, 4)
      }), `resp_${number}`) },
      store,
      validateCandidate: () => ({ status: 'rejected', layoutKey: null, report: rejectedReport('CANDIDATE_SCHEMA_INVALID') }),
      clock: () => Date.UTC(2026, 8, 13), wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.exitCode, 4);
    assert.strictEqual(result.record.candidateAttempts, 3);
    assert.strictEqual(result.record.httpCalls, 3);
    await assert.rejects(() => store.readCandidate(result.runId), error => error.code === 'RUN_STORE_READ_FAILED');
  } finally {
    fs.rmSync(exhaustedRoot, { recursive: true, force: true });
  }

  const cappedRoot = temporaryRoot('capped');
  try {
    const store = new RunStore({ root: path.join(cappedRoot, 'runs') });
    let calls = 0;
    const transient = () => {
      calls += 1;
      const error = new Error('transient'); error.code = 'OPENAI_SERVER_ERROR';
      error.kind = 'http'; error.retryable = true; throw error;
    };
    const result = await new Pipeline({
      client: { generate: async () => transient() }, store,
      clock: () => Date.UTC(2026, 8, 13), wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(calls, 2, 'one candidate gets at most two transport attempts');
    assert(calls <= 5);
  } finally {
    fs.rmSync(cappedRoot, { recursive: true, force: true });
  }

  const fiveCallRoot = temporaryRoot('five-calls');
  try {
    const store = new RunStore({ root: path.join(fiveCallRoot, 'runs') });
    let calls = 0;
    let successes = 0;
    const client = { async generate() {
      calls += 1;
      if (calls === 2 || calls === 4) return api(cover(`invalid-${++successes}`), `resp_${successes}`);
      const error = new Error('transient');
      error.code = 'OPENAI_SERVER_ERROR'; error.kind = 'http'; error.retryable = true;
      throw error;
    } };
    const result = await new Pipeline({
      client,
      store,
      validateCandidate: () => ({
        status: 'rejected', layoutKey: null,
        report: rejectedReport('CANDIDATE_SCHEMA_INVALID')
      }),
      clock: () => Date.UTC(2026, 8, 13), wait: async () => {}
    }).generate({ brief, apiKey: 'key', model: 'm' });
    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(calls, 5, 'combined retries and new candidates must stop at five HTTP calls');
    assert.strictEqual(result.record.httpCalls, 5);
    assert.strictEqual(result.record.candidateAttempts, 3);
  } finally {
    fs.rmSync(fiveCallRoot, { recursive: true, force: true });
  }

  const safetyRoot = temporaryRoot('safety');
  try {
    const storeRoot = path.join(safetyRoot, 'runs');
    fs.mkdirSync(storeRoot, { mode: 0o755 });
    fs.chmodSync(storeRoot, 0o755);
    const store = new RunStore({ root: storeRoot });
    const runId = store.newRunId();
    await store.createRun(brief, { runId, schemaVersion: 1, status: 'CREATED' });
    assert.strictEqual(fs.statSync(store.root).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(path.join(store.root, runId)).mode & 0o777, 0o700);
    fs.chmodSync(path.join(store.root, runId), 0o755);
    await store.readRun(runId);
    assert.strictEqual(fs.statSync(path.join(store.root, runId)).mode & 0o777, 0o700,
      'reading a historical run must harden its directory permissions');
    assert.throws(() => store.assertRunId('../escape'), /RUN_STORE_RUN_ID_INVALID/);
    assert.throws(() => store.assertArtifact('../run.json'), /RUN_STORE_ARTIFACT_INVALID/);
    assert.throws(() => assertNoSecrets({ OPENAI_API_KEY: 'value' }), /RUN_STORE_SECRET_DETECTED/);
    assert.throws(() => assertNoSecrets({ note: 'Bearer abcdefghijklmnop' }), /RUN_STORE_SECRET_DETECTED/);
    await store.writeAttempt(runId, 1, { status: 'FAILED' });
    await assert.rejects(() => store.writeAttempt(runId, 1, { status: 'REVIEWABLE' }),
      error => error.code === 'RUN_STORE_ARTIFACT_EXISTS');

    const failing = new RunStore({ root: path.join(safetyRoot, 'failing') });
    const failId = failing.newRunId();
    await failing.createRun(brief, { runId: failId, schemaVersion: 1, status: 'CREATED' });
    failing.io = Object.assign({}, fs.promises, { link: async () => { const error = new Error('fail'); error.code = 'EIO'; throw error; } });
    await assert.rejects(() => failing.writeAttempt(failId, 1, { status: 'FAILED' }),
      error => error.code === 'RUN_STORE_WRITE_FAILED');
    assert(!fs.existsSync(path.join(failing.root, failId, 'attempt-01.json')));

    const renameFailing = new RunStore({ root: path.join(safetyRoot, 'rename-failing') });
    const renameFailId = renameFailing.newRunId();
    await renameFailing.createRun(brief,
      { runId: renameFailId, schemaVersion: 1, status: 'CREATED' });
    renameFailing.io = Object.assign({}, fs.promises, {
      rename: async () => { const error = new Error('fail'); error.code = 'EIO'; throw error; }
    });
    await assert.rejects(() => renameFailing.writeRun(renameFailId,
      { runId: renameFailId, schemaVersion: 1, status: 'FAILED' }),
    error => error.code === 'RUN_STORE_WRITE_FAILED');
    assert.strictEqual((await renameFailing.readRun(renameFailId)).status, 'CREATED');

    const target = path.join(safetyRoot, 'real-root');
    fs.mkdirSync(target);
    const link = path.join(safetyRoot, 'linked-root');
    fs.symlinkSync(target, link);
    const linked = new RunStore({ root: link });
    await assert.rejects(() => linked.ensureRoot(), error => error.code === 'RUN_STORE_ROOT_UNSAFE');
  } finally {
    fs.rmSync(safetyRoot, { recursive: true, force: true });
  }

  assert.strictEqual(parseArguments(['generate', '--brief', 'x.json']).code, 'CLI_LIVE_REQUIRED');
  assert.strictEqual(parseArguments(['validate', '--brief', 'x.json']).ok, true);
  assert.strictEqual(parseArguments(['validate', '--brief', 'x.json', '--reason', 'extra']).code,
    'CLI_ARGUMENT_INVALID');
  assert.strictEqual(parseArguments(['review', '--run', '../x', '--decision', 'accepted']).ok, true,
    'run ID validation belongs to the store boundary');
  const cliRoot = temporaryRoot('cli');
  try {
    const filename = path.join(cliRoot, 'brief.json');
    fs.writeFileSync(filename, JSON.stringify(brief));
    const output = [];
    const io = { log: value => output.push(value), error: value => output.push(value) };
    assert.strictEqual(await cliMain(['validate', '--brief', filename], { console: io, env: {} }), 0);
    assert.strictEqual(JSON.parse(output.pop()).status, 'VALID');
    fs.writeFileSync(filename, JSON.stringify(Object.assign({}, brief, {
      width: 8, height: 10, colorCount: 10
    })));
    assert.strictEqual(await cliMain(['validate', '--brief', filename], { console: io, env: {} }), 0);
    assert.strictEqual(JSON.parse(output.pop()).status, 'VALID');
    fs.writeFileSync(filename, JSON.stringify(brief));
    assert.strictEqual(await cliMain(['generate', '--brief', filename, '--live'], { console: io, env: {} }), 3);
    assert.deepStrictEqual(JSON.parse(output.pop()).errorCodes, ['OPENAI_API_KEY_MISSING']);
    fs.writeFileSync(filename, JSON.stringify(Object.assign({}, brief, {
      mechanic: 'portal', width: 8, height: 8, colorCount: 6, targetGrade: 3
    })));
    assert.strictEqual(await cliMain(['validate', '--brief', filename], { console: io, env: {} }), 0);
    assert.strictEqual(JSON.parse(output.pop()).status, 'VALID');
    assert.strictEqual(await cliMain(['generate', '--brief', filename, '--live'], { console: io, env: {} }), 3,
      'a valid Portal brief must reach provider configuration without networking');
    assert.deepStrictEqual(JSON.parse(output.pop()).errorCodes, ['OPENAI_API_KEY_MISSING']);
  } finally {
    fs.rmSync(cliRoot, { recursive: true, force: true });
  }
  assert.strictEqual(directoryHash(path.join(__dirname, '..', 'data')), formalDataHash,
    'all offline runs must leave the complete formal data directory byte-identical');
}

module.exports = run;
