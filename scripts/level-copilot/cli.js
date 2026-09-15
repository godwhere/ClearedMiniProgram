'use strict';

const fs = require('fs');
const path = require('path');
const contracts = require('./contracts.js');
const validator = require('./validator.js');
const { OpenAIClient } = require('./openai-client.js');
const { CodexClient } = require('./codex-client.js');
const { RunStore } = require('./run-store.js');
const { PROVIDERS, LIMITS, Pipeline, replayRun, reviewRun } = require('./pipeline.js');

function normalizeProvider(value) {
  if (value === undefined || value === 'responses') return PROVIDERS.RESPONSES;
  if (value === 'codex') return PROVIDERS.CODEX;
  return null;
}

function parseArguments(argv) {
  const command = argv[0];
  if (!['validate', 'generate', 'replay', 'review'].includes(command)) {
    return { ok: false, code: 'CLI_COMMAND_INVALID' };
  }
  const options = { command, live: false };
  const valued = new Set(['--brief', '--run', '--decision', '--reason', '--provider']);
  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--live') {
      if (options.live) return { ok: false, code: 'CLI_ARGUMENT_INVALID' };
      options.live = true;
      continue;
    }
    if (!valued.has(item) || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      return { ok: false, code: 'CLI_ARGUMENT_INVALID' };
    }
    const key = item.slice(2);
    if (options[key] !== undefined) return { ok: false, code: 'CLI_ARGUMENT_INVALID' };
    options[key] = argv[index + 1];
    index += 1;
  }
  const expected = {
    validate: ['brief'],
    generate: ['brief'],
    replay: ['run'],
    review: ['run', 'decision']
  }[command];
  if (expected.some(key => !options[key])) return { ok: false, code: 'CLI_ARGUMENT_MISSING' };
  const allowed = {
    validate: new Set(['command', 'live', 'brief']),
    generate: new Set(['command', 'live', 'brief', 'provider']),
    replay: new Set(['command', 'live', 'run']),
    review: new Set(['command', 'live', 'run', 'decision', 'reason'])
  }[command];
  if (Object.keys(options).some(key => !allowed.has(key))) return { ok: false, code: 'CLI_ARGUMENT_INVALID' };
  if (command === 'generate' && !normalizeProvider(options.provider)) {
    return { ok: false, code: 'CLI_ARGUMENT_INVALID' };
  }
  if (command === 'generate' && !options.live) return { ok: false, code: 'CLI_LIVE_REQUIRED' };
  if (command !== 'generate' && options.live) return { ok: false, code: 'CLI_ARGUMENT_INVALID' };
  return { ok: true, options };
}

function readJson(filename) {
  const absolute = path.resolve(filename);
  let text;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    const failure = new Error('BRIEF_READ_FAILED'); failure.code = 'BRIEF_READ_FAILED'; throw failure;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const failure = new Error('JSON_INVALID'); failure.code = 'JSON_INVALID'; throw failure;
  }
}

function outputLine(io, value) {
  io.log(JSON.stringify(value));
}

async function main(argv, dependencies) {
  const deps = dependencies || {};
  const io = deps.console || console;
  const env = deps.env || process.env;
  const parsed = parseArguments(argv || process.argv.slice(2));
  if (!parsed.ok) {
    outputLine(io, { status: 'FAILED', errorCodes: [parsed.code] });
    return 2;
  }
  const options = parsed.options;
  const store = deps.store || new RunStore();
  try {
    if (options.command === 'validate') {
      const checked = contracts.validateBrief(readJson(options.brief));
      outputLine(io, checked.ok ? { status: 'VALID' } : { status: 'FAILED', errorCodes: [checked.error.code] });
      return checked.ok ? 0 : 2;
    }
    if (options.command === 'generate') {
      const inputBrief = readJson(options.brief);
      const checked = contracts.validateBrief(inputBrief);
      if (!checked.ok) {
        outputLine(io, { status: 'FAILED', errorCodes: [checked.error.code] });
        return 2;
      }
      const providerId = normalizeProvider(options.provider);
      if (providerId === PROVIDERS.RESPONSES && (!env.OPENAI_API_KEY || !env.OPENAI_MODEL)) {
        outputLine(io, { status: 'FAILED', errorCodes: [
          !env.OPENAI_API_KEY ? 'OPENAI_API_KEY_MISSING' : 'OPENAI_MODEL_MISSING'
        ] });
        return 3;
      }
      const timeoutMs = checked.value.mechanic === 'portal'
        ? LIMITS.maxPortalProviderCallDurationMs : LIMITS.maxProviderCallDurationMs;
      const defaultClient = providerId === PROVIDERS.CODEX
        ? new CodexClient(Object.assign({ timeoutMs }, deps.codexClientOptions, { env }))
        : new OpenAIClient(Object.assign({ timeoutMs }, deps.openAIClientOptions));
      const pipeline = deps.pipeline || new Pipeline({
        client: deps.client || defaultClient,
        store
      });
      const generateOptions = { brief: checked.value, provider: providerId };
      if (providerId === PROVIDERS.RESPONSES) {
        generateOptions.apiKey = env.OPENAI_API_KEY;
        generateOptions.model = env.OPENAI_MODEL;
      }
      const result = await pipeline.generate(generateOptions);
      outputLine(io, {
        runId: result.runId,
        provider: providerId,
        status: result.status,
        candidateAttempts: result.record && result.record.candidateAttempts || 0,
        providerCalls: result.record && result.record.providerCalls || 0,
        httpCalls: result.record && result.record.httpCalls || 0,
        errorCodes: result.errorCodes,
        difficulty: result.candidate && result.candidate.report.difficulty || null,
        usage: result.record && result.record.usage || null,
        costAccounting: result.record && result.record.cost &&
          result.record.cost.costAccounting || null,
        estimatedCostUsd: result.record && result.record.cost &&
          result.record.cost.estimatedCostUsd || null,
        directory: result.runId ? path.join(store.root, result.runId) : null
      });
      return result.exitCode;
    }
    if (options.command === 'replay') {
      const result = await replayRun(store, options.run, deps.validateCandidate || validator.validateCandidate);
      outputLine(io, {
        runId: options.run,
        status: result.status,
        errorCodes: result.report.errorCodes,
        difficulty: result.report.difficulty
      });
      return result.status === 'reviewable' ? 0 : result.status === 'rejected' ? 4 : 5;
    }
    const result = await reviewRun(store, options.run, options.decision, options.reason, deps.clock);
    outputLine(io, result);
    return 0;
  } catch (error) {
    outputLine(io, { status: 'FAILED', errorCodes: [error.code || 'CLI_INTERNAL_ERROR'] });
    return error.code && /(?:ARGUMENT|BRIEF|JSON|REVIEW_DECISION|REVIEW_REASON)/.test(error.code) ? 2 : 5;
  }
}

module.exports = { main, parseArguments, readJson, normalizeProvider };

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}
