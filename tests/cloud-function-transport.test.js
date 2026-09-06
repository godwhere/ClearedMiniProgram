'use strict';

const assert = require('assert');
const WechatPlatform = require('../src/platform/wechat.js');
const Transport = require('../src/services/cloud-function-transport.js');
const ApiClient = require('../src/services/api-client.js');
const config = require('../src/config/cloudbase.js');
const { fakeApi } = require('./account-bootstrap.test.js');

const input = { service: 'identity', action: 'identity.init', requestId: 'req_test',
  protocolVersion: 1, payload: { installId: 'ins_test', clientVersion: '1.0.0',
    localBinding: { claimedPlayerId: null, bindingEpoch: 0, environmentId: 'test-fixture' } } };
const configured = () => Object.assign({}, config, { enabled: true, env: 'test-fixture', identityEnabled: true, readEnabled: true, timeoutMs: 20 });
const envelope = extra => Object.assign({ ok: true, code: 'OK', requestId: input.requestId, data: {} }, extra);

module.exports = async function run() {
  const native = fakeApi(); let calls = []; let inits = []; let reply = envelope();
  native.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } });
  native.cloud = { init: options => { inits.push(options); },
    callFunction: options => { calls.push(options); options.success({ result: reply }); } };
  const platform = new WechatPlatform(native);
  const transport = new Transport(platform, configured());
  assert.strictEqual(transport.isConfigured(), true);
  assert.strictEqual(new Transport(platform, config).isConfigured(), false);
  assert.strictEqual((await new Transport(platform, config).request(input)).error.code, 'not-configured');
  for (const enabled of [false, undefined, 'true', 1]) {
    const disabled = new Transport(platform, Object.assign(configured(), { enabled }));
    assert.strictEqual(disabled.isConfigured(), false, 'a valid environment never substitutes for explicit opt-in');
    assert.strictEqual((await disabled.request(input)).error.code, 'not-configured');
  }
  assert.deepStrictEqual(inits, []); assert.deepStrictEqual(calls, []);
  const [one, two] = await Promise.all([transport.request(input), transport.request(input)]);
  assert.deepStrictEqual(one, { ok: true, statusCode: 0, requestId: 'req_test', data: reply });
  assert.deepStrictEqual(two, one);
  assert.deepStrictEqual(inits, [{ env: 'test-fixture', traceUser: false }]);
  assert.strictEqual(calls[0].name, 'identity-api');
  assert.deepStrictEqual(calls[0].data, { action: input.action, requestId: input.requestId,
    protocolVersion: 1, payload: input.payload });
  assert.deepStrictEqual(calls[0].config, { env: 'test-fixture' });
  ['url', 'method', 'header', 'timeout'].forEach(key => assert.strictEqual(calls[0][key], undefined));
  const api = new ApiClient(platform, { current() { throw Error('cloud must not read HTTP credentials'); } }, {}, { transport });
  assert((await api.request({ service: 'identity', action: 'identity.init',
    requestId: input.requestId, payload: Object.assign({ code: 'secret-code' }, input.payload) })).ok);
  assert.deepStrictEqual(calls[2].data.payload, input.payload);

  let adapted;
  const spyPlatform = { supportsCloud: () => true, initCloud: async () => ({ ok: true }),
    getMiniProgramEnvironmentVersion: () => 'develop',
    callCloudFunction: async options => { adapted = options; return { ok: true, result: envelope() }; } };
  const thin = new Transport(spyPlatform, configured());
  for (const [service, action] of [['economy', 'economy.purchase'], ['playerState', 'sync.push'],
    ['playerState', 'migration.prepare'], ['identity', 'identity.status']]) {
    assert.strictEqual((await thin.request(Object.assign({}, input, { service, action }))).error.code, 'not-configured');
    assert.strictEqual(adapted, undefined);
  }
  await thin.request(Object.assign({}, input, { service: 'playerState', action: 'state.read' }));
  assert.strictEqual(adapted.name, 'player-state-api'); assert.strictEqual(adapted.timeout, 20);
  adapted = undefined;
  const migration = new Transport(spyPlatform, Object.assign(configured(), { migrationEnabled: true }));
  assert((await migration.request(Object.assign({}, input,
    { service: 'playerState', action: 'migration.status', payload: { importId: 'import_test' } }))).ok);
  assert.strictEqual(adapted.name, 'player-state-api');
  assert.strictEqual(adapted.data.action, 'migration.status');

  for (const change of [{ service: '__proto__' }, { service: 'other' },
    { requestId: 'bad id' }, { protocolVersion: 2 }, { payload: [] }, { operationId: '../bad' },
    { idempotencyKey: 'constructor' }, { timeoutMs: 0 }, { timeoutMs: 60001 }]) {
    const count = calls.length;
    assert.strictEqual((await transport.request(Object.assign({}, input, change))).error.code, 'invalid-request');
    assert.strictEqual(calls.length, count);
  }
  assert.strictEqual((await new Transport(platform, Object.assign(configured(), { functions: { identity: '../bad' } })).request(input)).error.code, 'invalid-request');
  for (const invalid of [null, [], 'json', {}, envelope({ ok: 'true' }), envelope({ code: 'BAD' }),
    envelope({ requestId: 'other' }), envelope({ retryable: 'true' }), envelope({ ok: false }),
    { ok: false, code: 'unsafe raw error', requestId: 'req_test' }]) {
    reply = invalid;
    assert.strictEqual((await transport.request(input)).error.code, 'invalid-response');
  }
  reply = envelope({ ok: false, code: 'RATE_LIMITED', retryable: true, retryAfterMs: 1000, message: 'private detail' });
  assert.deepStrictEqual(await transport.request(input), { ok: false, statusCode: 0, requestId: 'req_test',
    error: { code: 'RATE_LIMITED', retryable: true, retryAfterMs: 1000 } });
  reply = envelope({ ok: false, code: 'ACCOUNT_BINDING_MISMATCH', retryable: false });
  assert.strictEqual((await transport.request(input)).error.code, 'ACCOUNT_BINDING_MISMATCH');

  native.cloud.callFunction = options => options.fail({ errMsg: 'private network detail', errCode: -1 });
  assert.deepStrictEqual((await transport.request(input)).error, { code: 'network', retryable: true });
  native.cloud.callFunction = () => { throw Error('private exception'); };
  assert.strictEqual((await transport.request(input)).error.code, 'network');
  native.cloud.callFunction = options => options.fail({ errMsg: 'cloud.callFunction:fail timeout' });
  assert.strictEqual((await transport.request(input)).error.code, 'timeout');
  let late;
  native.cloud.callFunction = options => { late = options; };
  const timed = await transport.request(Object.assign({}, input, { timeoutMs: 1 }));
  assert.strictEqual(timed.error.code, 'timeout');
  late.success({ result: envelope() }); late.fail({});
  assert.strictEqual(timed.error.code, 'timeout');
  native.cloud.callFunction = () => Promise.reject(Error('private rejected'));
  assert.strictEqual((await transport.request(input)).error.code, 'network');
  native.cloud.callFunction = () => Promise.resolve({ result: envelope() });
  assert((await transport.request(input)).ok);

  let attempts = 0;
  native.cloud.init = () => { if (++attempts === 1) throw Error('init failure'); };
  const retried = new Transport(platform, configured());
  assert.strictEqual((await retried.request(input)).error.code, 'cloud-init-failed');
  assert((await retried.request(input)).ok); assert.strictEqual(attempts, 2);
  delete native.cloud;
  assert.strictEqual(platform.supportsCloud(), false);
  assert.strictEqual((await platform.initCloud({ env: 'test-fixture' })).reason, 'not-supported');
  assert.strictEqual((await platform.callCloudFunction({})).reason, 'not-supported');
  assert.strictEqual((await new Transport(platform, configured()).request(input)).error.code, 'not-supported');
  assert.strictEqual((await new Transport({}, configured()).request(input)).error.code, 'not-supported');
  native.cloud = { init() {}, callFunction() {} };
  assert.strictEqual((await platform.initCloud({ env: '' })).reason, 'invalid-request');
  assert.strictEqual((await platform.callCloudFunction({ name: 'f', data: {}, timeout: -1 })).reason, 'invalid-request');
};
