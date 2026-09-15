'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const contracts = require('../scripts/level-copilot/contracts.js');
const prompt = require('../scripts/level-copilot/prompt.js');
const {
  CodexClient,
  createProcessExecutor,
  sanitizedEnvironment,
  usageFromEvents,
  DISABLED_FEATURES,
  ISOLATION_CONFIG_OVERRIDES
} = require('../scripts/level-copilot/codex-client.js');
const { RunStore } = require('../scripts/level-copilot/run-store.js');
const { Pipeline, PROVIDERS } = require('../scripts/level-copilot/pipeline.js');
const { main: cliMain, parseArguments } = require('../scripts/level-copilot/cli.js');

const brief = {
  schemaVersion: 1,
  mechanic: 'ordinary',
  width: 5,
  height: 5,
  colorCount: 5,
  targetGrade: 1,
  designIntent: 'A simple introductory board with readable paths.'
};
const candidate = {
  schemaVersion: 1,
  designSummary: 'Simple horizontal lanes.',
  paths: Array.from({ length: 5 }, (_, row) => ({
    cells: Array.from({ length: 5 }, (_, column) => row * 5 + (row % 2 ? 4 - column : column))
  }))
};
const usage = {
  input_tokens: 100,
  cached_input_tokens: 25,
  output_tokens: 40,
  reasoning_output_tokens: 10
};

function events(terminal, itemType) {
  const values = [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread_test' }),
    JSON.stringify({ type: 'turn.started' })
  ];
  if (itemType) values.push(JSON.stringify({
    type: 'item.completed',
    item: { type: itemType, text: 'event body must never be persisted' }
  }));
  values.push(JSON.stringify({ type: terminal || 'turn.completed', usage }));
  return values.join('\n') + '\n';
}

function outputPath(request) {
  const index = request.args.indexOf('--output-last-message');
  return index >= 0 ? request.args[index + 1] : null;
}

function schemaPath(request) {
  const index = request.args.indexOf('--output-schema');
  return index >= 0 ? request.args[index + 1] : null;
}

function processResult(overrides) {
  return Object.assign({
    exitCode: 0,
    signal: null,
    stdout: events(),
    stderr: '',
    timedOut: false,
    cancelled: false,
    outputTooLarge: false,
    terminated: false
  }, overrides);
}

async function failure(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error('Expected rejection');
}

function temporaryRoot(label) {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `cleared-codex-${label}-`));
}

function guardedEnvironment(home) {
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: home || '/tmp/codex-test-home',
    CODEX_HOME: path.join(home || '/tmp/codex-test-home', '.codex'),
    SAFE_VALUE: 'must-not-pass',
    HTTP_PROXY: 'http://untrusted-proxy.invalid',
    OPENAI_BASE_URL: 'https://untrusted-provider.invalid'
  };
  for (const key of [
    'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_MODEL',
    'CUSTOM_PROVIDER_API_KEY', 'MCP_BEARER_TOKEN'
  ]) {
    Object.defineProperty(env, key, {
      enumerable: true,
      get() { throw new Error(`${key} must not be read`); }
    });
  }
  return env;
}

async function run() {
  const cleaned = sanitizedEnvironment(guardedEnvironment('/tmp/home'), '/tmp/isolated');
  assert.deepStrictEqual(cleaned, {
    PATH: '/usr/bin:/bin',
    CODEX_HOME: '/tmp/home/.codex',
    LANG: 'C.UTF-8',
    HOME: '/tmp/isolated',
    TMPDIR: '/tmp/isolated'
  });
  assert.deepStrictEqual(sanitizedEnvironment({
    PATH: '/usr/bin:/bin', HOME: '/tmp/fallback-home'
  }, '/tmp/fallback-isolated'), {
    PATH: '/usr/bin:/bin',
    CODEX_HOME: '/tmp/fallback-home/.codex',
    LANG: 'C.UTF-8',
    HOME: '/tmp/fallback-isolated',
    TMPDIR: '/tmp/fallback-isolated'
  });
  assert.deepStrictEqual(usageFromEvents([{ usage: {
    input_tokens: 20,
    input_tokens_details: { cached_tokens: 8 },
    output_tokens: 10,
    output_tokens_details: { reasoning_tokens: 3 },
    total_tokens: 30
  } }]), {
    input_tokens: 20,
    cached_input_tokens: 8,
    output_tokens: 10,
    reasoning_output_tokens: 3,
    total_tokens: 30
  });

  const requests = [];
  let temporaryDirectory = null;
  const generationDirectories = [];
  const isolationRoot = temporaryRoot('isolation');
  const repositoryRoot = path.join(isolationRoot, 'repository');
  const homeRoot = path.join(isolationRoot, 'home');
  fs.mkdirSync(path.join(repositoryRoot, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(homeRoot, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, 'AGENTS.md'), 'PROJECT_AGENT_MARKER');
  fs.writeFileSync(path.join(homeRoot, '.codex', 'AGENTS.md'), 'GLOBAL_AGENT_MARKER');
  fs.writeFileSync(path.join(homeRoot, '.codex', 'config.toml'),
    'model_provider = "untrusted"\n[mcp_servers.bad]\ncommand = "bad"\n');
  fs.writeFileSync(path.join(homeRoot, '.codex', 'hooks.json'),
    '{"SessionStart":[{"hooks":[{"type":"command","command":"bad"}]}]}');
  fs.mkdirSync(path.join(homeRoot, '.agents', 'skills', 'poison'), { recursive: true });
  fs.writeFileSync(path.join(homeRoot, '.agents', 'skills', 'poison', 'SKILL.md'),
    'USER_SKILL_MARKER');
  fs.mkdirSync(path.join(homeRoot, '.codex', 'skills', 'poison'), { recursive: true });
  fs.writeFileSync(path.join(homeRoot, '.codex', 'skills', 'poison', 'SKILL.md'),
    'CODEX_HOME_SKILL_MARKER');
  const client = new CodexClient({
    cwd: repositoryRoot,
    env: guardedEnvironment(homeRoot),
    executor: async request => {
      requests.push(request);
      assert.strictEqual(path.relative(repositoryRoot, request.cwd).startsWith('..'), true,
        'Codex processes must not start in the repository');
      assert.strictEqual((fs.statSync(request.cwd).mode & 0o777), 0o700);
      assert.strictEqual(request.env.TMPDIR, request.cwd);
      assert.strictEqual(request.env.HOME, request.cwd);
      assert.strictEqual(request.env.CODEX_HOME, path.join(homeRoot, '.codex'));
      assert.notStrictEqual(request.env.HOME, homeRoot);
      assert.deepStrictEqual(Object.keys(request.env).sort(),
        ['CODEX_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']);
      if (request.args[0] === 'login') {
        return processResult({ stdout: 'Logged in using ChatGPT\n' });
      }
      assert.strictEqual(request.shell, false);
      assert.strictEqual(request.command, 'codex');
      assert(request.args.includes('--strict-config'));
      assert(request.args.includes('--ephemeral'));
      assert(request.args.includes('--skip-git-repo-check'));
      assert(request.args.includes('--ignore-user-config'));
      assert(request.args.includes('--ignore-rules'));
      assert(request.args.includes('--json'));
      assert.deepStrictEqual(request.args.slice(
        request.args.indexOf('--sandbox'), request.args.indexOf('--sandbox') + 2),
      ['--sandbox', 'read-only']);
      assert(!request.args.includes('--model'));
      assert(!request.args.includes('-m'));
      const overrides = request.args.reduce((values, value, index) => {
        if (value === '-c') values.push(request.args[index + 1]);
        return values;
      }, []);
      assert.deepStrictEqual(overrides, ISOLATION_CONFIG_OVERRIDES);
      assert(overrides.includes('project_doc_max_bytes=0'));
      assert(overrides.includes('model_provider="openai"'));
      assert(overrides.includes('mcp_servers={}'));
      for (const feature of [
        'apps', 'browser_use', 'computer_use', 'goals', 'hooks', 'image_generation',
        'memories', 'multi_agent', 'plugins', 'shell_tool', 'skill_search',
        'unified_exec', 'unified_exec_tty', 'view_image', 'workspace_dependencies'
      ]) {
        assert(DISABLED_FEATURES.includes(feature), feature);
        assert(overrides.includes(`features.${feature}=false`), feature);
      }
      assert(overrides.includes('features.skip_host_skill_discovery=true'));
      assert(overrides.includes('suppress_unstable_features_warning=true'));
      assert(!overrides.includes('features.code_mode_host=false'),
        'the disabled code_mode master gate makes its host sub-feature unreachable');
      assert(overrides.includes('orchestrator.skills.enabled=false'));
      assert(overrides.includes('skills.include_instructions=false'));
      assert(overrides.includes('tools.experimental_request_user_input.enabled=false'));
      assert(overrides.includes('tools.update_plan.enabled=false'));
      assert(overrides.includes('agents.enabled=false'));
      assert(overrides.includes('web_search="disabled"'));
      assert.strictEqual(request.args[request.args.length - 1], '-');
      assert.strictEqual(request.env.OPENAI_API_KEY, undefined);
      assert.strictEqual(request.env.CODEX_API_KEY, undefined);
      assert.strictEqual(request.env.OPENAI_MODEL, undefined);
      assert.strictEqual(request.env.SAFE_VALUE, undefined);
      assert.strictEqual(request.env.HTTP_PROXY, undefined);
      assert.strictEqual(request.env.OPENAI_BASE_URL, undefined);
      assert.strictEqual(request.env.CUSTOM_PROVIDER_API_KEY, undefined);
      assert.strictEqual(request.env.MCP_BEARER_TOKEN, undefined);
      assert(request.input.includes(brief.designIntent));
      assert(request.input.includes('Do not inspect workspace files'));
      assert(!request.input.includes('PROJECT_AGENT_MARKER'));
      assert(!request.input.includes('GLOBAL_AGENT_MARKER'));
      assert(!request.input.includes('USER_SKILL_MARKER'));
      assert(!request.input.includes('CODEX_HOME_SKILL_MARKER'));
      const expectedSchema = contracts.candidateSchema(brief);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(schemaPath(request), 'utf8')), expectedSchema);
      temporaryDirectory = path.dirname(outputPath(request));
      generationDirectories.push(temporaryDirectory);
      fs.writeFileSync(outputPath(request), JSON.stringify(candidate), { mode: 0o600 });
      return processResult({ stdout: events(null, 'agent_message') });
    }
  });
  const generated = await client.generate({
    instructions: prompt.INSTRUCTIONS,
    inputText: prompt.buildInput(brief, []),
    schema: contracts.candidateSchema(brief)
  });
  assert.strictEqual(requests.length, 2);
  assert.deepStrictEqual(generated.candidate, candidate);
  assert.strictEqual(generated.threadId, 'thread_test');
  assert.strictEqual(generated.providerResponseId, 'thread_test');
  assert.strictEqual(generated.status, 'completed');
  assert.deepStrictEqual(generated.usage, Object.assign({ total_tokens: 140 }, usage));
  assert.strictEqual(fs.existsSync(temporaryDirectory), false, 'temporary Codex files must be removed');
  await client.generate({
    instructions: prompt.INSTRUCTIONS,
    inputText: prompt.buildInput(brief, []),
    schema: contracts.candidateSchema(brief)
  });
  assert.strictEqual(requests.length, 3, 'successful ChatGPT login status may be reused');
  assert.strictEqual(generationDirectories.length, 2);
  assert.notStrictEqual(generationDirectories[0], generationDirectories[1],
    'every generation must receive an independent temporary cwd');
  assert.strictEqual(fs.existsSync(generationDirectories[1]), false);
  fs.rmSync(isolationRoot, { recursive: true, force: true });

  let extendedTimeout = null;
  await new CodexClient({
    timeoutMs: 120000,
    executor: async request => {
      if (request.args[0] === 'login') {
        return processResult({ stdout: 'Logged in using ChatGPT\n' });
      }
      extendedTimeout = request.timeoutMs;
      fs.writeFileSync(outputPath(request), JSON.stringify(candidate), { mode: 0o600 });
      return processResult({ stdout: events(null, 'agent_message') });
    }
  }).generate({
    instructions: prompt.INSTRUCTIONS,
    inputText: prompt.buildInput(brief, []),
    schema: contracts.candidateSchema(brief),
    timeoutMs: 120000,
    remainingTimeMs: 180000
  });
  assert.strictEqual(extendedTimeout, 120000);

  const failedTurn = await failure(new CodexClient({
    executor: async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult({ exitCode: 1, stdout: events('turn.failed') })
  }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
  assert.strictEqual(failedTurn.code, 'CODEX_TURN_FAILED');
  assert.strictEqual(failedTurn.threadId, 'thread_test');
  assert.strictEqual(failedTurn.turnStatus, 'failed');
  assert.strictEqual(failedTurn.usage.total_tokens, 140);

  for (const activityType of [
    'command_execution', 'file_change', 'mcp_tool_call', 'web_search',
    'subagent', 'unknown_tool'
  ]) {
    const forbidden = await failure(new CodexClient({
      executor: async request => request.args[0] === 'login'
        ? processResult({ stdout: 'Logged in using ChatGPT\n' })
        : processResult({ stdout: events(null, activityType) })
    }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
    assert.strictEqual(forbidden.code, 'CODEX_FORBIDDEN_ACTIVITY', activityType);
    assert.deepStrictEqual(forbidden.details, {
      eventType: 'item.completed', activityType
    });
    assert.strictEqual(forbidden.threadId, 'thread_test');
    assert.strictEqual(forbidden.usage.total_tokens, 140);
    assert(!JSON.stringify(forbidden).includes('event body must never be persisted'));
  }

  const unsupportedEvent = await failure(new CodexClient({
    executor: async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult({ stdout: events().replace(
        JSON.stringify({ type: 'turn.started' }), JSON.stringify({ type: 'future.event' })) })
  }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
  assert.strictEqual(unsupportedEvent.code, 'CODEX_EVENT_UNSUPPORTED');
  assert.deepStrictEqual(unsupportedEvent.details, { eventType: 'future.event' });

  for (const [label, executor, expected] of [
    ['malformed JSONL', async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult({ stdout: `${events()}{broken\n` }), 'CODEX_JSONL_INVALID'],
    ['missing output', async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult(), 'CODEX_OUTPUT_MISSING'],
    ['invalid candidate JSON', async request => {
      if (request.args[0] === 'login') return processResult({ stdout: 'Logged in using ChatGPT\n' });
      fs.writeFileSync(outputPath(request), 'not-json', { mode: 0o600 });
      return processResult();
    }, 'CODEX_OUTPUT_JSON_INVALID'],
    ['timeout with partial JSONL', async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult({
        exitCode: null, signal: 'SIGTERM', timedOut: true, terminated: true,
        stdout: `${events()}{"type":"item.updated"`
      }),
    'CODEX_EXEC_TIMEOUT'],
    ['cancelled with partial JSONL', async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult({
        exitCode: null, signal: 'SIGTERM', cancelled: true, terminated: true,
        stdout: `${events()}{"type":"item.updated"`
      }),
    'CODEX_EXEC_CANCELLED']
  ]) {
    const error = await failure(new CodexClient({ executor }).generate({
      instructions: 'i', inputText: '{}', schema: {}
    }));
    assert.strictEqual(error.code, expected, label);
    if (label === 'malformed JSONL') assert.strictEqual(error.threadId, 'thread_test');
    if (label.includes('partial JSONL')) {
      assert.strictEqual(error.threadId, 'thread_test');
      assert.strictEqual(error.turnStatus, 'completed');
      assert.strictEqual(error.usage.total_tokens, 140);
    }
  }

  const outputCapWithPartial = await failure(new CodexClient({
    executor: async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult({
        exitCode: null, signal: 'SIGTERM', outputTooLarge: true, terminated: true,
        stdout: `${events()}{"type":"item.updated"`
      })
  }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
  assert.strictEqual(outputCapWithPartial.code, 'CODEX_JSONL_TOO_LARGE');
  assert.strictEqual(outputCapWithPartial.threadId, 'thread_test');
  assert.strictEqual(outputCapWithPartial.usage.total_tokens, 140);

  const forbiddenAtTermination = await failure(new CodexClient({
    executor: async request => request.args[0] === 'login'
      ? processResult({ stdout: 'Logged in using ChatGPT\n' })
      : processResult({
        exitCode: null, signal: 'SIGTERM', timedOut: true, terminated: true,
        stdout: `${events(null, 'command_execution')}{"type":"item.updated"`
      })
  }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
  assert.strictEqual(forbiddenAtTermination.code, 'CODEX_FORBIDDEN_ACTIVITY');
  assert.strictEqual(forbiddenAtTermination.details.activityType, 'command_execution');
  assert(!JSON.stringify(forbiddenAtTermination).includes('event body must never be persisted'));

  const unsafeRoot = temporaryRoot('unsafe-workdir');
  try {
    fs.mkdirSync(path.join(unsafeRoot, 'temporary'));
    let unsafeCalls = 0;
    const unsafe = await failure(new CodexClient({
      cwd: unsafeRoot,
      temporaryRoot: path.join(unsafeRoot, 'temporary'),
      executor: async () => { unsafeCalls += 1; return processResult(); }
    }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
    assert.strictEqual(unsafe.code, 'CODEX_WORKDIR_NOT_ISOLATED');
    assert.strictEqual(unsafeCalls, 0);
  } finally {
    fs.rmSync(unsafeRoot, { recursive: true, force: true });
  }

  const oversized = await failure(new CodexClient({
    maxOutputBytes: 1024,
    executor: async request => {
      if (request.args[0] === 'login') return processResult({ stdout: 'Logged in using ChatGPT\n' });
      fs.writeFileSync(outputPath(request), 'x'.repeat(1025), { mode: 0o600 });
      return processResult();
    }
  }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
  assert.strictEqual(oversized.code, 'CODEX_OUTPUT_TOO_LARGE');
  assert.strictEqual(oversized.threadId, 'thread_test');
  assert.strictEqual(oversized.usage.total_tokens, 140);

  let unsupportedCalls = 0;
  const unsupported = await failure(new CodexClient({ executor: async () => {
    unsupportedCalls += 1;
    return processResult({ stdout: 'Logged in using API key\n' });
  } }).generate({ instructions: 'i', inputText: '{}', schema: {} }));
  assert.strictEqual(unsupported.code, 'CODEX_AUTH_MODE_UNSUPPORTED');
  assert.strictEqual(unsupportedCalls, 1, 'unsupported auth must stop before codex exec');

  const fakeChild = new EventEmitter();
  fakeChild.stdout = new EventEmitter();
  fakeChild.stderr = new EventEmitter();
  fakeChild.stdin = new EventEmitter();
  fakeChild.stdin.end = () => {};
  const killSignals = [];
  fakeChild.kill = signal => {
    killSignals.push(signal);
    setImmediate(() => fakeChild.emit('close', null, signal));
    return true;
  };
  const timedProcess = await createProcessExecutor(() => fakeChild)({
    command: 'codex', args: ['exec'], cwd: process.cwd(), env: {}, input: '',
    timeoutMs: 5, maxOutputBytes: 1024
  });
  assert.strictEqual(timedProcess.timedOut, true);
  assert.deepStrictEqual(killSignals, ['SIGTERM']);

  const abortChild = new EventEmitter();
  abortChild.stdout = new EventEmitter();
  abortChild.stderr = new EventEmitter();
  abortChild.stdin = new EventEmitter();
  abortChild.stdin.end = () => {};
  const abortSignals = [];
  abortChild.kill = signal => {
    abortSignals.push(signal);
    setImmediate(() => abortChild.emit('close', null, signal));
    return true;
  };
  const controller = new AbortController();
  const abortedProcess = createProcessExecutor(() => {
    setImmediate(() => abortChild.stdout.emit('data', events()));
    return abortChild;
  })({
    command: 'codex', args: ['exec'], cwd: process.cwd(), env: {}, input: '',
    timeoutMs: 1000, maxOutputBytes: 4096, signal: controller.signal
  });
  setTimeout(() => controller.abort(), 5);
  const aborted = await abortedProcess;
  assert.strictEqual(aborted.cancelled, true);
  assert.deepStrictEqual(abortSignals, ['SIGTERM']);

  const largeChild = new EventEmitter();
  largeChild.stdout = new EventEmitter();
  largeChild.stderr = new EventEmitter();
  largeChild.stdin = new EventEmitter();
  largeChild.stdin.end = () => {};
  const largeKillSignals = [];
  largeChild.kill = signal => {
    largeKillSignals.push(signal);
    setImmediate(() => largeChild.emit('close', null, signal));
    return true;
  };
  const largeProcessPromise = createProcessExecutor(() => {
    setImmediate(() => largeChild.stdout.emit('data', Buffer.alloc(1025)));
    return largeChild;
  })({
    command: 'codex', args: ['exec'], cwd: process.cwd(), env: {}, input: '',
    timeoutMs: 1000, maxOutputBytes: 1024
  });
  const largeProcess = await largeProcessPromise;
  assert.strictEqual(largeProcess.outputTooLarge, true);
  assert.deepStrictEqual(largeKillSignals, ['SIGTERM']);

  const capRoot = temporaryRoot('cap');
  try {
    const store = new RunStore({ root: path.join(capRoot, 'runs') });
    let calls = 0;
    const pipeline = new Pipeline({
      store,
      client: { async generate() {
        calls += 1;
        if (calls === 2 || calls === 4) {
          return {
            providerResponseId: `thread_${calls}`,
            threadId: `thread_${calls}`,
            status: 'completed',
            usage: null,
            candidate
          };
        }
        const error = new Error('transient');
        error.code = 'CODEX_PROCESS_ERROR';
        error.kind = 'transport';
        error.retryable = true;
        throw error;
      } },
      validateCandidate: () => ({
        status: 'rejected',
        layoutKey: null,
        report: {
          schemaVersion: 1,
          status: 'rejected',
          retryable: true,
          errorCodes: ['CANDIDATE_SCHEMA_INVALID'],
          warnings: [],
          checks: {
            schema: 'failed', staticRules: 'skipped', duplicate: 'pending',
            runtime: 'pending', solver: 'pending', difficulty: 'pending'
          },
          difficulty: { targetGrade: 1, actualGrade: null, score: null }
        }
      }),
      clock: () => Date.UTC(2026, 8, 13),
      wait: async () => {}
    });
    const result = await pipeline.generate({ brief, provider: PROVIDERS.CODEX });
    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(calls, 5);
    assert.strictEqual(result.record.providerCalls, 5);
    assert.strictEqual(result.record.httpCalls, 0);
    assert.strictEqual(result.record.cost.costAccounting, 'not_applicable_subscription');
    assert.strictEqual(result.record.cost.estimatedCostUsd, null);
    const receivedAttempt = await store.readJson(result.runId, 'attempt-02.json');
    assert.strictEqual(receivedAttempt.candidateReceived, true);
    assert.strictEqual(receivedAttempt.provider.id, PROVIDERS.CODEX);
    assert.strictEqual(receivedAttempt.provider.threadId, 'thread_4');
    assert.strictEqual(receivedAttempt.api, undefined);
  } finally {
    fs.rmSync(capRoot, { recursive: true, force: true });
  }

  assert.strictEqual(parseArguments([
    'generate', '--brief', 'x.json', '--live', '--provider', 'codex'
  ]).options.provider, 'codex');
  assert.strictEqual(parseArguments([
    'generate', '--brief', 'x.json', '--live', '--provider', 'unknown'
  ]).code, 'CLI_ARGUMENT_INVALID');
  assert.strictEqual(parseArguments(['generate', '--brief', 'x.json', '--live']).ok, true,
    'the existing Responses provider remains the default');

  const cliRoot = temporaryRoot('cli');
  try {
    const briefPath = path.join(cliRoot, 'brief.json');
    fs.writeFileSync(briefPath, JSON.stringify(brief));
    const output = [];
    let receivedOptions = null;
    const exitCode = await cliMain([
      'generate', '--brief', briefPath, '--live', '--provider', 'codex'
    ], {
      env: guardedEnvironment(),
      console: { log: value => output.push(value), error: value => output.push(value) },
      pipeline: { async generate(options) {
        receivedOptions = options;
        return {
          runId: '00000000-0000-4000-8000-000000000000',
          status: 'FAILED',
          exitCode: 4,
          errorCodes: ['CANDIDATE_BUDGET_EXHAUSTED'],
          record: {
            candidateAttempts: 3,
            providerCalls: 5,
            httpCalls: 0,
            usage: {},
            cost: {
              costAccounting: 'not_applicable_subscription',
              estimatedCostUsd: null
            }
          }
        };
      } }
    });
    assert.strictEqual(exitCode, 4);
    assert.deepStrictEqual(receivedOptions, { brief, provider: PROVIDERS.CODEX });
    const printed = JSON.parse(output.pop());
    assert.strictEqual(printed.provider, PROVIDERS.CODEX);
    assert.strictEqual(printed.httpCalls, 0);
    assert.strictEqual(printed.costAccounting, 'not_applicable_subscription');
    assert.strictEqual(printed.estimatedCostUsd, null);
  } finally {
    fs.rmSync(cliRoot, { recursive: true, force: true });
  }
}

module.exports = run;
