'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_ROOT = path.join(__dirname, 'runs');
const PRIVATE_DIRECTORY_MODE = 0o700;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT = /^(?:brief|run|candidate|review|eval)\.json$|^attempt-(?:0[1-9]|[1-9][0-9])\.json$|^review-revision-(?:0[1-9]|[1-9][0-9])\.json$/;

class RunStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RunStoreError';
    this.code = code;
  }
}

function assertNoSecrets(value, seen) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (/\bBearer\s+[A-Za-z0-9._-]{8,}/i.test(value) || /\bsk-[A-Za-z0-9_-]{8,}/.test(value)) {
      throw new RunStoreError('RUN_STORE_SECRET_DETECTED');
    }
    return;
  }
  if (typeof value !== 'object') return;
  const visited = seen || new Set();
  if (visited.has(value)) throw new RunStoreError('RUN_STORE_VALUE_NOT_SERIALIZABLE');
  visited.add(value);
  Object.keys(value).forEach(key => {
    if (/(?:authorization|api[_-]?key|secret|password)/i.test(key)) {
      throw new RunStoreError('RUN_STORE_SECRET_DETECTED');
    }
    assertNoSecrets(value[key], visited);
  });
  visited.delete(value);
}

function isWithinDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`));
}

async function withTemporaryOutputSchema(schema, options, action) {
  const settings = options || {};
  const io = settings.io || fs.promises;
  const cryptoImpl = settings.crypto || crypto;
  const maxOutputBytes = Number.isInteger(settings.maxOutputBytes) && settings.maxOutputBytes > 0
    ? settings.maxOutputBytes : 256 * 1024;
  if (!schema || typeof schema !== 'object' || typeof action !== 'function') {
    throw new RunStoreError('RUN_STORE_TEMP_INVALID');
  }
  const temporaryRoot = await io.realpath(settings.root || os.tmpdir());
  const forbiddenRoot = settings.forbiddenRoot
    ? await io.realpath(path.resolve(settings.forbiddenRoot)) : null;
  if (forbiddenRoot && isWithinDirectory(forbiddenRoot, temporaryRoot)) {
    throw new RunStoreError('RUN_STORE_TEMP_INSIDE_REPOSITORY');
  }
  let directory = null;
  try {
    directory = await io.mkdtemp(path.join(temporaryRoot, 'cleared-copilot-codex-'));
    await io.chmod(directory, 0o700);
    const directoryStat = await io.lstat(directory);
    const directoryReal = await io.realpath(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || directoryReal !== directory) {
      throw new RunStoreError('RUN_STORE_TEMP_UNSAFE');
    }
    if ((directoryStat.mode & 0o777) !== 0o700) {
      throw new RunStoreError('RUN_STORE_TEMP_UNSAFE');
    }
    if (forbiddenRoot && isWithinDirectory(forbiddenRoot, directoryReal)) {
      throw new RunStoreError('RUN_STORE_TEMP_INSIDE_REPOSITORY');
    }
    const nonce = cryptoImpl.randomUUID();
    const schemaPath = path.join(directory, `candidate-schema-${nonce}.json`);
    const outputPath = path.join(directory, `candidate-output-${nonce}.json`);
    const serialized = `${JSON.stringify(schema, null, 2)}\n`;
    await io.writeFile(schemaPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const processResult = await action({ directory: directoryReal, schemaPath, outputPath });
    let outputText = null;
    let outputError = null;
    try {
      const stat = await io.lstat(outputPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new RunStoreError('RUN_STORE_TEMP_OUTPUT_UNSAFE');
      }
      if (stat.size > maxOutputBytes) {
        outputError = 'too_large';
      } else {
        outputText = await io.readFile(outputPath, 'utf8');
        if (Buffer.byteLength(outputText) > maxOutputBytes) {
          outputText = null;
          outputError = 'too_large';
        }
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    return { processResult, outputText, outputError };
  } finally {
    if (directory) await io.rm(directory, { recursive: true, force: true });
  }
}

class RunStore {
  constructor(options) {
    this.root = path.resolve(options && options.root || DEFAULT_ROOT);
    this.io = options && options.io || fs.promises;
    this.crypto = options && options.crypto || crypto;
    this.readyRoot = null;
  }

  newRunId() {
    return this.crypto.randomUUID();
  }

  assertRunId(runId) {
    if (typeof runId !== 'string' || !RUN_ID.test(runId) || path.basename(runId) !== runId) {
      throw new RunStoreError('RUN_STORE_RUN_ID_INVALID');
    }
  }

  assertArtifact(filename) {
    if (typeof filename !== 'string' || !ARTIFACT.test(filename) || path.basename(filename) !== filename) {
      throw new RunStoreError('RUN_STORE_ARTIFACT_INVALID');
    }
  }

  async ensureRoot() {
    if (this.readyRoot) return this.readyRoot;
    await this.io.mkdir(this.root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const stat = await this.io.lstat(this.root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RunStoreError('RUN_STORE_ROOT_UNSAFE');
    const real = await this.io.realpath(this.root);
    if (path.resolve(real) !== this.root) throw new RunStoreError('RUN_STORE_ROOT_UNSAFE');
    await this.io.chmod(real, PRIVATE_DIRECTORY_MODE);
    const hardenedStat = await this.io.lstat(real);
    if ((hardenedStat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
      throw new RunStoreError('RUN_STORE_ROOT_UNSAFE');
    }
    this.readyRoot = real;
    return real;
  }

  async runDirectory(runId, create) {
    this.assertRunId(runId);
    const root = await this.ensureRoot();
    const directory = path.join(root, runId);
    if (path.dirname(directory) !== root) throw new RunStoreError('RUN_STORE_PATH_ESCAPE');
    if (create) await this.io.mkdir(directory, { recursive: false, mode: PRIVATE_DIRECTORY_MODE });
    const stat = await this.io.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RunStoreError('RUN_STORE_PATH_UNSAFE');
    const real = await this.io.realpath(directory);
    if (path.dirname(real) !== root || real !== directory) throw new RunStoreError('RUN_STORE_PATH_ESCAPE');
    await this.io.chmod(real, PRIVATE_DIRECTORY_MODE);
    const hardenedStat = await this.io.lstat(real);
    if ((hardenedStat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
      throw new RunStoreError('RUN_STORE_PATH_UNSAFE');
    }
    return real;
  }

  async artifactPath(runId, filename) {
    this.assertArtifact(filename);
    const directory = await this.runDirectory(runId, false);
    const target = path.join(directory, filename);
    if (path.dirname(target) !== directory) throw new RunStoreError('RUN_STORE_PATH_ESCAPE');
    try {
      const stat = await this.io.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new RunStoreError('RUN_STORE_PATH_UNSAFE');
    } catch (error) {
      if (error instanceof RunStoreError || error.code !== 'ENOENT') throw error;
    }
    return target;
  }

  async writeJson(runId, filename, value, overwrite) {
    assertNoSecrets(value);
    const target = await this.artifactPath(runId, filename);
    const temporary = path.join(path.dirname(target), `.${filename}.${process.pid}.${this.crypto.randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    try {
      await this.io.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      if (overwrite) {
        await this.io.rename(temporary, target);
      } else {
        try {
          await this.io.link(temporary, target);
        } catch (error) {
          if (error && error.code === 'EEXIST') {
            throw new RunStoreError('RUN_STORE_ARTIFACT_EXISTS');
          }
          throw error;
        }
        try { await this.io.unlink(temporary); } catch (cleanupError) { /* target is already durable */ }
      }
    } catch (error) {
      try { await this.io.unlink(temporary); } catch (cleanupError) { /* best effort */ }
      if (error instanceof RunStoreError) throw error;
      throw new RunStoreError('RUN_STORE_WRITE_FAILED');
    }
    return target;
  }

  async createRun(brief, runRecord) {
    const runId = runRecord && runRecord.runId || this.newRunId();
    this.assertRunId(runId);
    await this.runDirectory(runId, true);
    await this.writeJson(runId, 'brief.json', brief, false);
    await this.writeJson(runId, 'run.json', Object.assign({}, runRecord, { runId }), false);
    return runId;
  }

  async createEvaluation(evaluationRecord) {
    const evaluationId = evaluationRecord && evaluationRecord.evaluationId || this.newRunId();
    this.assertRunId(evaluationId);
    await this.runDirectory(evaluationId, true);
    await this.writeJson(evaluationId, 'eval.json',
      Object.assign({}, evaluationRecord, { evaluationId }), false);
    return evaluationId;
  }

  writeRun(runId, value) {
    return this.writeJson(runId, 'run.json', value, true);
  }

  writeEvaluation(evaluationId, value) {
    return this.writeJson(evaluationId, 'eval.json', value, true);
  }

  writeAttempt(runId, number, value) {
    if (!Number.isInteger(number) || number < 1 || number > 99) {
      throw new RunStoreError('RUN_STORE_ATTEMPT_INVALID');
    }
    return this.writeJson(runId, `attempt-${String(number).padStart(2, '0')}.json`, value, false);
  }

  writeCandidate(runId, value) {
    return this.writeJson(runId, 'candidate.json', value, false);
  }

  writeReview(runId, value) {
    return this.writeJson(runId, 'review.json', value, false);
  }

  async writeReviewRevision(runId, value) {
    const directory = await this.runDirectory(runId, false);
    const entries = await this.io.readdir(directory);
    const revisions = entries.filter(name => /^review-revision-[0-9]{2}\.json$/.test(name));
    return this.writeJson(runId,
      `review-revision-${String(revisions.length + 1).padStart(2, '0')}.json`, value, false);
  }

  async readJson(runId, filename) {
    const target = await this.artifactPath(runId, filename);
    let text;
    try {
      text = await this.io.readFile(target, 'utf8');
    } catch (error) {
      throw new RunStoreError('RUN_STORE_READ_FAILED');
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new RunStoreError('RUN_STORE_JSON_INVALID');
    }
  }

  async readOptionalJson(runId, filename) {
    const target = await this.artifactPath(runId, filename);
    let text;
    try {
      text = await this.io.readFile(target, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw new RunStoreError('RUN_STORE_READ_FAILED');
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new RunStoreError('RUN_STORE_JSON_INVALID');
    }
  }

  readRun(runId) { return this.readJson(runId, 'run.json'); }
  readCandidate(runId) { return this.readJson(runId, 'candidate.json'); }
  readReview(runId) { return this.readOptionalJson(runId, 'review.json'); }
  readEvaluation(evaluationId) { return this.readJson(evaluationId, 'eval.json'); }
}

module.exports = {
  DEFAULT_ROOT,
  RunStore,
  RunStoreError,
  assertNoSecrets,
  isWithinDirectory,
  withTemporaryOutputSchema
};
