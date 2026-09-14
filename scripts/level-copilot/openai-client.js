'use strict';

const https = require('https');

const API_HOST = 'api.openai.com';
const API_PATH = '/v1/responses';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const MAX_RETRY_AFTER_MS = 30000;

class OpenAIClientError extends Error {
  constructor(code, options) {
    super(code);
    this.name = 'OpenAIClientError';
    this.code = code;
    this.kind = options && options.kind || 'client';
    this.retryable = !!(options && options.retryable);
    this.httpStatus = options && options.httpStatus || null;
    this.retryAfterMs = options && Number.isFinite(options.retryAfterMs)
      ? options.retryAfterMs : 0;
    this.details = options && options.details || null;
    this.responseId = options && typeof options.responseId === 'string'
      ? options.responseId : null;
    this.responseStatus = options && typeof options.responseStatus === 'string'
      ? options.responseStatus : null;
    this.usage = options && options.usage && typeof options.usage === 'object'
      ? JSON.parse(JSON.stringify(options.usage)) : null;
  }
}

function buildRequestBody(options) {
  if (!options || typeof options.model !== 'string' || !options.model.trim()) {
    throw new OpenAIClientError('OPENAI_MODEL_MISSING', { kind: 'configuration' });
  }
  if (typeof options.instructions !== 'string' || typeof options.inputText !== 'string' ||
      !options.schema || typeof options.schema !== 'object') {
    throw new OpenAIClientError('OPENAI_REQUEST_INVALID', { kind: 'configuration' });
  }
  return {
    model: options.model,
    store: false,
    instructions: options.instructions,
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text: options.inputText }]
    }],
    max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: 'json_schema',
        name: 'cleared_ordinary_path_cover_v1',
        strict: true,
        schema: options.schema
      }
    }
  };
}

function createHttpsTransport(requestImplementation) {
  const issueRequest = requestImplementation || https.request;
  return request => new Promise((resolve, reject) => {
    if (request.signal && request.signal.aborted) {
      const error = new Error('request aborted');
      error.code = 'REQUEST_ABORTED';
      reject(error);
      return;
    }
    let req;
    let responseStream = null;
    let abortHandler = null;
    let settled = false;

    function cleanup() {
      if (abortHandler && request.signal) {
        request.signal.removeEventListener('abort', abortHandler);
      }
      if (req && typeof req.setTimeout === 'function') req.setTimeout(0);
    }

    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }

    req = issueRequest({
      hostname: API_HOST,
      port: 443,
      path: API_PATH,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(request.body)
      }
    }, response => {
      responseStream = response;
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > request.maxResponseBytes) {
          const error = new Error('response too large');
          error.code = 'RESPONSE_TOO_LARGE';
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        statusCode: response.statusCode || 0,
        headers: response.headers || {},
        body: Buffer.concat(chunks).toString('utf8')
      }));
      response.on('error', error => finish(error));
    });
    req.setTimeout(request.timeoutMs, () => {
      const error = new Error('request timeout');
      error.code = 'REQUEST_TIMEOUT';
      req.destroy(error);
    });
    req.on('error', error => finish(error));
    if (request.signal) {
      abortHandler = () => {
        const error = new Error('request aborted');
        error.code = 'REQUEST_ABORTED';
        if (responseStream && typeof responseStream.destroy === 'function') {
          responseStream.destroy(error);
        }
        req.destroy(error);
      };
      request.signal.addEventListener('abort', abortHandler, { once: true });
      if (request.signal.aborted) abortHandler();
    }
    if (!settled) req.end(request.body);
  });
}

const defaultTransport = createHttpsTransport();

function retryAfterMs(headers, now) {
  const value = headers && (headers['retry-after'] || headers['Retry-After']);
  if (value === undefined) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function transportError(error) {
  if (error instanceof OpenAIClientError) return error;
  const metadata = {
    responseId: error && typeof error.responseId === 'string' ? error.responseId : null,
    responseStatus: error && typeof error.responseStatus === 'string' ? error.responseStatus : null,
    usage: error && error.usage && typeof error.usage === 'object' ? error.usage : null
  };
  if (error && error.code === 'RESPONSE_TOO_LARGE') {
    return new OpenAIClientError('OPENAI_RESPONSE_TOO_LARGE', { kind: 'response', ...metadata });
  }
  if (error && (error.code === 'REQUEST_TIMEOUT' || error.code === 'ETIMEDOUT')) {
    return new OpenAIClientError('OPENAI_REQUEST_TIMEOUT', {
      kind: 'transport', retryable: true, ...metadata
    });
  }
  if (error && (error.code === 'REQUEST_ABORTED' || error.code === 'ABORT_ERR')) {
    return new OpenAIClientError('OPENAI_REQUEST_CANCELLED', { kind: 'transport', ...metadata });
  }
  return new OpenAIClientError('OPENAI_NETWORK_ERROR', {
    kind: 'transport', retryable: true, ...metadata
  });
}

function httpError(status, headers, now) {
  const retryAfter = status === 429 ? retryAfterMs(headers, now) : 0;
  const transient = status === 408 || status === 429 || status >= 500;
  const retryable = transient && !(status === 429 && retryAfter > MAX_RETRY_AFTER_MS);
  let code = 'OPENAI_HTTP_ERROR';
  if (status === 400) code = 'OPENAI_REQUEST_REJECTED';
  else if (status === 401 || status === 403) code = 'OPENAI_AUTH_ERROR';
  else if (status === 408) code = 'OPENAI_HTTP_TIMEOUT';
  else if (status === 429) code = 'OPENAI_RATE_LIMITED';
  else if (status >= 500) code = 'OPENAI_SERVER_ERROR';
  return new OpenAIClientError(code, {
    kind: status === 401 || status === 403 ? 'configuration' : 'http',
    retryable,
    httpStatus: status,
    retryAfterMs: retryAfter
  });
}

function parseResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenAIClientError('OPENAI_RESPONSE_INVALID', { kind: 'response' });
  }
  const metadata = {
    responseId: typeof value.id === 'string' ? value.id : null,
    responseStatus: typeof value.status === 'string' ? value.status : null,
    usage: value.usage && typeof value.usage === 'object'
      ? JSON.parse(JSON.stringify(value.usage)) : null
  };
  if (value.status === 'incomplete' || value.incomplete_details) {
    throw new OpenAIClientError('OPENAI_RESPONSE_INCOMPLETE', {
      kind: 'response',
      details: { reason: value.incomplete_details && value.incomplete_details.reason || 'unknown' },
      ...metadata
    });
  }
  if (value.status !== 'completed' || value.error) {
    throw new OpenAIClientError('OPENAI_RESPONSE_FAILED', {
      kind: 'response',
      details: { status: value.status || 'unknown' },
      ...metadata
    });
  }
  const texts = [];
  let refused = false;
  (Array.isArray(value.output) ? value.output : []).forEach(item => {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) return;
    item.content.forEach(content => {
      if (!content || typeof content !== 'object') return;
      if (content.type === 'refusal') refused = true;
      if (content.type === 'output_text' && typeof content.text === 'string') texts.push(content.text);
    });
  });
  if (refused) {
    throw new OpenAIClientError('OPENAI_RESPONSE_REFUSED', { kind: 'response', ...metadata });
  }
  if (texts.length !== 1) {
    throw new OpenAIClientError('OPENAI_OUTPUT_COUNT_INVALID', {
      kind: 'response', details: { count: texts.length }, ...metadata
    });
  }
  let candidate;
  try {
    candidate = JSON.parse(texts[0]);
  } catch (error) {
    throw new OpenAIClientError('OPENAI_OUTPUT_JSON_INVALID', { kind: 'response', ...metadata });
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new OpenAIClientError('OPENAI_OUTPUT_JSON_INVALID', { kind: 'response', ...metadata });
  }
  return {
    candidate,
    responseId: metadata.responseId,
    status: value.status,
    usage: metadata.usage
  };
}

class OpenAIClient {
  constructor(options) {
    const input = options || {};
    this.transport = input.transport || defaultTransport;
    this.timeoutMs = Math.min(DEFAULT_TIMEOUT_MS,
      Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS);
    this.maxResponseBytes = Math.min(DEFAULT_MAX_RESPONSE_BYTES,
      Number.isInteger(input.maxResponseBytes) && input.maxResponseBytes > 0
        ? input.maxResponseBytes : DEFAULT_MAX_RESPONSE_BYTES);
    this.now = typeof input.now === 'function' ? input.now : Date.now;
  }

  async generate(options) {
    if (!options || typeof options.apiKey !== 'string' || !options.apiKey) {
      throw new OpenAIClientError('OPENAI_API_KEY_MISSING', { kind: 'configuration' });
    }
    const requestBody = buildRequestBody(options);
    const body = JSON.stringify(requestBody);
    let response;
    try {
      response = await this.transport({
        host: API_HOST,
        path: API_PATH,
        method: 'POST',
        apiKey: options.apiKey,
        body,
        timeoutMs: Number.isInteger(options.remainingTimeMs) && options.remainingTimeMs > 0
          ? Math.min(this.timeoutMs, options.remainingTimeMs)
          : Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
            ? Math.min(this.timeoutMs, options.timeoutMs) : this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
        signal: options.signal
      });
    } catch (error) {
      throw transportError(error);
    }
    if (!response || !Number.isInteger(response.statusCode)) {
      throw new OpenAIClientError('OPENAI_RESPONSE_INVALID', { kind: 'response' });
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw httpError(response.statusCode, response.headers, this.now());
    }
    if (typeof response.body !== 'string' || Buffer.byteLength(response.body) > this.maxResponseBytes) {
      throw new OpenAIClientError('OPENAI_RESPONSE_TOO_LARGE', { kind: 'response' });
    }
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch (error) {
      throw new OpenAIClientError('OPENAI_RESPONSE_JSON_INVALID', { kind: 'response' });
    }
    return parseResponse(parsed);
  }
}

module.exports = {
  API_HOST,
  API_PATH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_RETRY_AFTER_MS,
  OpenAIClient,
  OpenAIClientError,
  buildRequestBody,
  parseResponse,
  retryAfterMs,
  createHttpsTransport
};
