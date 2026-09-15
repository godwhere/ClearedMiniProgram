'use strict';

const { spawn } = require('child_process');
const path = require('path');
const {
  RunStoreError,
  isWithinDirectory,
  withTemporaryOutputSchema
} = require('./run-store.js');

const PROVIDER_ID = 'codex-cli';
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const AUTH_TIMEOUT_MS = 10000;
const SAFE_ITEM_TYPES = new Set(['agent_message', 'reasoning']);
const SAFE_EVENT_TYPES = new Set([
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed'
]);
const DISABLED_FEATURES = Object.freeze([
  'apps',
  'artifact',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode',
  'computer_use',
  'context_management',
  'current_time_reminder',
  'deferred_executor',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'in_app_chat',
  'memories',
  'multi_agent',
  'multi_agent_v2',
  'plugins',
  'recommended_plugins',
  'remote_plugin',
  'request_permissions_tool',
  'shell_snapshot',
  'shell_tool',
  'skill_mcp_dependency_install',
  'skill_search',
  'sleep_tool',
  'standalone_web_search',
  'token_budget',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'unified_exec',
  'unified_exec_tty',
  'view_image',
  'workspace_dependencies'
]);
const ISOLATION_CONFIG_OVERRIDES = Object.freeze([
  'project_doc_max_bytes=0',
  'project_doc_fallback_filenames=[]',
  'model_provider="openai"',
  'mcp_servers={}',
  ...DISABLED_FEATURES.map(name => `features.${name}=false`),
  'features.skip_host_skill_discovery=true',
  'suppress_unstable_features_warning=true',
  'orchestrator.skills.enabled=false',
  'skills.include_instructions=false',
  'tools.experimental_request_user_input.enabled=false',
  'tools.update_plan.enabled=false',
  'agents.enabled=false',
  'web_search="disabled"'
]);

class CodexClientError extends Error {
  constructor(code, options) {
    super(code);
    this.name = 'CodexClientError';
    this.code = code;
    this.kind = options && options.kind || 'client';
    this.retryable = !!(options && options.retryable);
    this.providerResponseId = options && typeof options.threadId === 'string'
      ? options.threadId : null;
    this.threadId = this.providerResponseId;
    this.responseStatus = options && typeof options.turnStatus === 'string'
      ? options.turnStatus : null;
    this.turnStatus = this.responseStatus;
    this.usage = options && options.usage && typeof options.usage === 'object'
      ? JSON.parse(JSON.stringify(options.usage)) : null;
    this.details = options && options.details && typeof options.details === 'object'
      ? JSON.parse(JSON.stringify(options.details)) : null;
  }
}

function sanitizedEnvironment(source, temporaryDirectory) {
  const input = source || {};
  const result = {};
  // Keep the real Codex home only for its existing login. HOME points at the isolated
  // directory so user-level skills and other ambient home-directory context are undiscoverable.
  if (typeof input.PATH === 'string' && input.PATH) result.PATH = input.PATH;
  const configuredCodexHome = typeof input.CODEX_HOME === 'string' && input.CODEX_HOME
    ? input.CODEX_HOME : typeof input.HOME === 'string' && input.HOME
      ? path.join(input.HOME, '.codex') : null;
  if (configuredCodexHome) {
    result.CODEX_HOME = path.resolve(configuredCodexHome);
  }
  result.LANG = 'C.UTF-8';
  if (typeof temporaryDirectory === 'string' && temporaryDirectory) {
    const isolatedHome = path.resolve(temporaryDirectory);
    result.HOME = isolatedHome;
    result.TMPDIR = isolatedHome;
  }
  return result;
}

function boundedTimeout(configured, requested) {
  return Number.isInteger(requested) && requested > 0
    ? Math.min(configured, requested) : configured;
}

function safeEventLabel(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    ? value : 'unclassified';
}

function eventMetadata(events) {
  let threadId = null;
  let turnStatus = null;
  (events || []).forEach(event => {
    if (!threadId && event.type === 'thread.started' &&
        typeof event.thread_id === 'string' && event.thread_id) {
      threadId = event.thread_id;
    }
    if (event.type === 'turn.completed') turnStatus = 'completed';
    if (event.type === 'turn.failed') turnStatus = 'failed';
  });
  return { threadId, turnStatus, usage: usageFromEvents(events || []) };
}

function inspectJsonEvents(events) {
  for (const event of events) {
    if (SAFE_EVENT_TYPES.has(event.type)) continue;
    if (event.type === 'item.started' || event.type === 'item.updated' ||
        event.type === 'item.completed') {
      const itemType = event.item && event.item.type;
      if (SAFE_ITEM_TYPES.has(itemType)) continue;
      const metadata = eventMetadata(events);
      throw new CodexClientError('CODEX_FORBIDDEN_ACTIVITY', {
        kind: 'response', threadId: metadata.threadId,
        turnStatus: metadata.turnStatus, usage: metadata.usage,
        details: {
          eventType: safeEventLabel(event.type),
          activityType: safeEventLabel(itemType)
        }
      });
    }
    const metadata = eventMetadata(events);
    throw new CodexClientError(event.type === 'error'
      ? 'CODEX_EVENT_ERROR' : 'CODEX_EVENT_UNSUPPORTED', {
      kind: 'response', threadId: metadata.threadId,
      turnStatus: metadata.turnStatus, usage: metadata.usage,
      details: { eventType: safeEventLabel(event.type) }
    });
  }
  return events;
}

function buildExecArguments(files) {
  const args = [
    'exec', '--strict-config', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config',
    '--ignore-rules', '--sandbox', 'read-only', '--json'
  ];
  ISOLATION_CONFIG_OVERRIDES.forEach(value => args.push('-c', value));
  args.push('--output-schema', files.schemaPath,
    '--output-last-message', files.outputPath, '-');
  return args;
}

function createProcessExecutor(spawnImplementation) {
  const launch = spawnImplementation || spawn;
  return request => new Promise(resolve => {
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let terminationReason = null;
    let settled = false;
    let timeout = null;
    let forceKill = null;
    let abortHandler = null;
    let child;

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (abortHandler && request.signal) request.signal.removeEventListener('abort', abortHandler);
      resolve(Object.assign({
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut: terminationReason === 'timeout',
        cancelled: terminationReason === 'cancelled',
        outputTooLarge: terminationReason === 'output-too-large',
        terminated: terminationReason !== null
      }, result));
    }

    function terminate(reason) {
      if (terminationReason) return;
      terminationReason = reason;
      if (child && typeof child.kill === 'function') {
        child.kill('SIGTERM');
        forceKill = setTimeout(() => {
          if (settled) return;
          child.kill('SIGKILL');
          forceKill = setTimeout(() => finish({ signal: 'SIGKILL' }), 1000);
        }, 1000);
      } else {
        finish({});
      }
    }

    function collect(target, chunk) {
      if (terminationReason) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputBytes += value.length;
      if (outputBytes > request.maxOutputBytes) {
        terminate('output-too-large');
        return;
      }
      target.push(value);
    }

    if (request.signal && request.signal.aborted) {
      terminationReason = 'cancelled';
      finish({});
      return;
    }
    try {
      child = launch(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({ spawnErrorCode: error && error.code || 'SPAWN_FAILED' });
      return;
    }
    child.stdout.on('data', chunk => collect(stdout, chunk));
    child.stderr.on('data', chunk => collect(stderr, chunk));
    if (child.stdin) child.stdin.on('error', () => {});
    child.on('error', error => finish({ spawnErrorCode: error && error.code || 'SPAWN_FAILED' }));
    child.on('close', (exitCode, signal) => finish({ exitCode, signal }));
    timeout = setTimeout(() => terminate('timeout'), request.timeoutMs);
    if (request.signal) {
      abortHandler = () => terminate('cancelled');
      request.signal.addEventListener('abort', abortHandler, { once: true });
    }
    if (child.stdin) child.stdin.end(request.input || '');
  });
}

function parseJsonLines(text, maxOutputBytes) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxOutputBytes) {
    throw new CodexClientError('CODEX_JSONL_TOO_LARGE', { kind: 'response' });
  }
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (!lines.length) throw new CodexClientError('CODEX_JSONL_INVALID', { kind: 'response' });
  const events = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid event');
      events.push(value);
    } catch (error) {
      let threadId = null;
      events.forEach(event => {
        if (!threadId && typeof event.thread_id === 'string' && event.thread_id) {
          threadId = event.thread_id;
        }
      });
      throw new CodexClientError('CODEX_JSONL_INVALID', {
        kind: 'response', threadId, usage: usageFromEvents(events)
      });
    }
  }
  return events;
}

function parseJsonLinePrefix(text, maxOutputBytes) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxOutputBytes) return [];
  const events = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) break;
      events.push(value);
    } catch (error) {
      // A killed process can leave its final JSONL record incomplete. Earlier complete
      // records remain useful for IDs, usage and forbidden-activity auditing.
      break;
    }
  }
  return events;
}

function usageFromEvents(events) {
  let source = null;
  events.forEach(event => {
    if (event && event.usage && typeof event.usage === 'object') source = event.usage;
  });
  if (!source) return null;
  const result = {};
  if (Number.isFinite(source.input_tokens)) result.input_tokens = source.input_tokens;
  if (Number.isFinite(source.cached_input_tokens)) {
    result.cached_input_tokens = source.cached_input_tokens;
  } else if (source.input_tokens_details &&
      Number.isFinite(source.input_tokens_details.cached_tokens)) {
    result.cached_input_tokens = source.input_tokens_details.cached_tokens;
  }
  if (Number.isFinite(source.output_tokens)) result.output_tokens = source.output_tokens;
  if (Number.isFinite(source.reasoning_output_tokens)) {
    result.reasoning_output_tokens = source.reasoning_output_tokens;
  } else if (source.output_tokens_details &&
      Number.isFinite(source.output_tokens_details.reasoning_tokens)) {
    result.reasoning_output_tokens = source.output_tokens_details.reasoning_tokens;
  }
  if (Number.isFinite(source.total_tokens)) result.total_tokens = source.total_tokens;
  else if (Number.isFinite(result.input_tokens) && Number.isFinite(result.output_tokens)) {
    result.total_tokens = result.input_tokens + result.output_tokens;
  }
  return Object.keys(result).length ? result : null;
}

function metadataFromEvents(events) {
  inspectJsonEvents(events);
  const metadata = eventMetadata(events);
  const terminal = [];
  events.forEach(event => {
    if (event.type === 'turn.completed' || event.type === 'turn.failed') terminal.push(event.type);
  });
  if (!metadata.threadId) throw new CodexClientError('CODEX_THREAD_ID_MISSING', {
    kind: 'response', usage: metadata.usage
  });
  if (terminal.length !== 1) {
    throw new CodexClientError('CODEX_TURN_STATUS_INVALID', {
      kind: 'response', threadId: metadata.threadId, usage: metadata.usage
    });
  }
  return {
    threadId: metadata.threadId,
    turnStatus: terminal[0] === 'turn.completed' ? 'completed' : 'failed',
    usage: metadata.usage
  };
}

function promptText(options) {
  return [
    options.instructions,
    'Do not inspect workspace files or run commands. Use only the following JSON task data.',
    'Return only the final JSON value required by the supplied output schema.',
    options.inputText
  ].join('\n\n');
}

class CodexClient {
  constructor(options) {
    const input = options || {};
    this.providerId = PROVIDER_ID;
    this.command = input.command || 'codex';
    this.repositoryRoot = path.resolve(input.cwd || path.join(__dirname, '..', '..'));
    this.env = input.env || process.env;
    this.executor = input.executor || createProcessExecutor();
    this.temporaryFiles = input.temporaryFiles || withTemporaryOutputSchema;
    this.temporaryRoot = input.temporaryRoot;
    this.timeoutMs = Number.isInteger(input.timeoutMs) && input.timeoutMs > 0
      ? Math.min(input.timeoutMs, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = Number.isInteger(input.maxOutputBytes) && input.maxOutputBytes > 0
      ? Math.min(input.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES) : DEFAULT_MAX_OUTPUT_BYTES;
    this.authPromise = null;
  }

  processRequest(args, input, timeoutMs, signal, workingDirectory) {
    return {
      command: this.command,
      args,
      cwd: workingDirectory,
      env: sanitizedEnvironment(this.env, workingDirectory),
      shell: false,
      input: input || '',
      timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      signal
    };
  }

  async checkChatGptLogin(workingDirectory, signal, timeoutMs) {
    if (!this.authPromise) {
      const pending = (async () => {
        let result;
        try {
          result = await this.executor(this.processRequest(
            ['login', 'status'], '', boundedTimeout(AUTH_TIMEOUT_MS, timeoutMs),
            signal, workingDirectory));
        } catch (error) {
          throw new CodexClientError('CODEX_LOGIN_STATUS_FAILED', { kind: 'configuration' });
        }
        if (result && result.spawnErrorCode === 'ENOENT') {
          throw new CodexClientError('CODEX_CLI_NOT_FOUND', { kind: 'configuration' });
        }
        if (!result || result.exitCode !== 0 || result.timedOut || result.cancelled || result.outputTooLarge ||
            result.spawnErrorCode) {
          throw new CodexClientError('CODEX_NOT_LOGGED_IN', { kind: 'configuration' });
        }
        const status = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
        if (!/^Logged in using ChatGPT\b/.test(status)) {
          throw new CodexClientError('CODEX_AUTH_MODE_UNSUPPORTED', { kind: 'configuration' });
        }
        return true;
      })();
      this.authPromise = pending;
      try {
        await pending;
      } catch (error) {
        if (this.authPromise === pending) this.authPromise = null;
        throw error;
      }
    }
    return this.authPromise;
  }

  async generate(options) {
    if (!options || typeof options.instructions !== 'string' || typeof options.inputText !== 'string' ||
        !options.schema || typeof options.schema !== 'object') {
      throw new CodexClientError('CODEX_REQUEST_INVALID', { kind: 'configuration' });
    }
    if (options.signal && options.signal.aborted) {
      throw new CodexClientError('CODEX_EXEC_CANCELLED', { kind: 'transport' });
    }
    const requestTimeoutMs = boundedTimeout(this.timeoutMs,
      Math.min(
        Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
          ? options.timeoutMs : this.timeoutMs,
        Number.isInteger(options.remainingTimeMs) && options.remainingTimeMs > 0
          ? options.remainingTimeMs : this.timeoutMs));
    let bundle;
    try {
      bundle = await this.temporaryFiles(options.schema, {
        maxOutputBytes: this.maxOutputBytes,
        root: this.temporaryRoot,
        forbiddenRoot: this.repositoryRoot
      }, async files => {
        const workingDirectory = path.resolve(files.directory);
        if (isWithinDirectory(this.repositoryRoot, workingDirectory)) {
          throw new CodexClientError('CODEX_WORKDIR_NOT_ISOLATED', { kind: 'configuration' });
        }
        await this.checkChatGptLogin(
          workingDirectory, options.signal, requestTimeoutMs);
        const args = buildExecArguments(files);
        return this.executor(this.processRequest(
          args, promptText(options), requestTimeoutMs, options.signal, workingDirectory));
      });
    } catch (error) {
      if (error instanceof CodexClientError) throw error;
      if (error instanceof RunStoreError && error.code === 'RUN_STORE_TEMP_OUTPUT_TOO_LARGE') {
        throw new CodexClientError('CODEX_OUTPUT_TOO_LARGE', { kind: 'response' });
      }
      if (error instanceof RunStoreError &&
          (error.code === 'RUN_STORE_TEMP_INSIDE_REPOSITORY' ||
           error.code === 'RUN_STORE_TEMP_UNSAFE')) {
        throw new CodexClientError('CODEX_WORKDIR_NOT_ISOLATED', { kind: 'configuration' });
      }
      throw new CodexClientError('CODEX_PROCESS_ERROR', { kind: 'transport', retryable: true });
    }
    const result = bundle.processResult;
    if (!result) throw new CodexClientError('CODEX_PROCESS_ERROR', { kind: 'transport', retryable: true });
    if (result.spawnErrorCode === 'ENOENT') {
      throw new CodexClientError('CODEX_CLI_NOT_FOUND', { kind: 'configuration' });
    }
    if (result.spawnErrorCode) {
      throw new CodexClientError('CODEX_PROCESS_ERROR', { kind: 'transport', retryable: true });
    }
    if (result.timedOut || result.cancelled || result.outputTooLarge) {
      const partialEvents = parseJsonLinePrefix(result.stdout, this.maxOutputBytes);
      inspectJsonEvents(partialEvents);
      const partial = eventMetadata(partialEvents);
      if (result.timedOut) {
        throw new CodexClientError('CODEX_EXEC_TIMEOUT', {
          kind: 'transport', retryable: true, ...partial
        });
      }
      if (result.cancelled) {
        throw new CodexClientError('CODEX_EXEC_CANCELLED', { kind: 'transport', ...partial });
      }
      throw new CodexClientError('CODEX_JSONL_TOO_LARGE', { kind: 'response', ...partial });
    }
    const parsedEvents = parseJsonLines(result.stdout, this.maxOutputBytes);
    inspectJsonEvents(parsedEvents);
    const metadata = metadataFromEvents(parsedEvents);
    if (metadata.turnStatus === 'failed') {
      throw new CodexClientError('CODEX_TURN_FAILED', {
        kind: 'response', threadId: metadata.threadId,
        turnStatus: metadata.turnStatus, usage: metadata.usage
      });
    }
    if (result.exitCode !== 0) {
      throw new CodexClientError('CODEX_EXEC_FAILED', {
        kind: 'process', threadId: metadata.threadId,
        turnStatus: metadata.turnStatus, usage: metadata.usage
      });
    }
    if (bundle.outputError === 'too_large') {
      throw new CodexClientError('CODEX_OUTPUT_TOO_LARGE', {
        kind: 'response', threadId: metadata.threadId,
        turnStatus: metadata.turnStatus, usage: metadata.usage
      });
    }
    if (typeof bundle.outputText !== 'string' || !bundle.outputText.trim()) {
      throw new CodexClientError('CODEX_OUTPUT_MISSING', {
        kind: 'response', threadId: metadata.threadId,
        turnStatus: metadata.turnStatus, usage: metadata.usage
      });
    }
    let candidate;
    try {
      candidate = JSON.parse(bundle.outputText);
    } catch (error) {
      throw new CodexClientError('CODEX_OUTPUT_JSON_INVALID', {
        kind: 'response', threadId: metadata.threadId,
        turnStatus: metadata.turnStatus, usage: metadata.usage
      });
    }
    return {
      providerId: PROVIDER_ID,
      providerResponseId: metadata.threadId,
      threadId: metadata.threadId,
      status: metadata.turnStatus,
      usage: metadata.usage,
      candidate
    };
  }
}

module.exports = {
  PROVIDER_ID,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  AUTH_TIMEOUT_MS,
  DISABLED_FEATURES,
  ISOLATION_CONFIG_OVERRIDES,
  CodexClient,
  CodexClientError,
  sanitizedEnvironment,
  buildExecArguments,
  createProcessExecutor,
  parseJsonLines,
  parseJsonLinePrefix,
  inspectJsonEvents,
  usageFromEvents,
  metadataFromEvents
};
