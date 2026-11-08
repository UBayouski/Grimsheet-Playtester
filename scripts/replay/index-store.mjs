// @ts-check
// Reads and writes the Index_File (data\_index.json) and the Result_Files (data\runs\run-NNNNNN.json).
// The caller holds the results lock; this module takes no lock itself. Every write is a temp file in
// the same folder followed by a rename, so a reader never sees half a file.

import * as path from 'node:path';
import { MAX_RUNS, SCHEMA_VERSION, indexEntryOf, newRunRecord } from './run-record.mjs';

/** @typedef {import('./types.mjs').Deps} Deps */
/** @typedef {import('./types.mjs').IndexEntry} IndexEntry */
/** @typedef {import('./types.mjs').IndexFile} IndexFile */
/** @typedef {import('./types.mjs').RunRecord} RunRecord */
/** @typedef {Pick<Deps, 'fs' | 'paths' | 'token'>} StoreDeps */

export const RESULT_FILE_PATTERN = /^run-(\d{6,})\.json$/;

const INDEX_NAME = '_index.json';
const RUN_ID_PATTERN = /^run-\d{6,}$/;

/**
 * @param {number} counter
 * @returns {string} for example 'run-000042'
 */
export function runIdOf(counter) {
  return `run-${String(counter).padStart(6, '0')}`;
}

/** @param {StoreDeps} deps @returns {string} */
const runsFolder = (deps) => path.join(deps.paths.dataFolder, 'runs');
/** @param {StoreDeps} deps @returns {string} */
const indexPath = (deps) => path.join(deps.paths.dataFolder, INDEX_NAME);

/**
 * Add an entry, drop an older entry with the same runId, sort by counter descending and keep the
 * 30 highest. Pure.
 * @param {IndexFile} index
 * @param {IndexEntry} entry
 * @returns {{index: IndexFile, evicted: IndexEntry[]}}
 */
export function insertEntry(index, entry) {
  const merged = [entry, ...index.runs.filter((e) => e.runId !== entry.runId)];
  merged.sort((a, b) => b.counter - a.counter);
  return {
    index: {
      schemaVersion: SCHEMA_VERSION,
      lastCounter: Math.max(index.lastCounter, entry.counter),
      runs: merged.slice(0, MAX_RUNS),
    },
    evicted: merged.slice(MAX_RUNS),
  };
}

/**
 * Mark `running` entries older than the cron timeout as `cut-short`. An unparsable startedAt counts
 * as stale. Pure.
 * @param {IndexEntry[]} entries
 * @param {number} nowMs
 * @param {number} cronTimeoutSec
 * @returns {{entries: IndexEntry[], changedRunIds: string[]}}
 */
export function markCutShort(entries, nowMs, cronTimeoutSec) {
  /** @type {string[]} */
  const changedRunIds = [];
  const next = entries.map((e) => {
    if (e.state !== 'running') return e;
    const started = Date.parse(e.startedAt);
    const stale = Number.isNaN(started) || nowMs - started > cronTimeoutSec * 1000;
    if (!stale) return e;
    changedRunIds.push(e.runId);
    return { ...e, state: /** @type {const} */ ('cut-short') };
  });
  return { entries: next, changedRunIds };
}

/**
 * @param {unknown} value
 * @returns {IndexFile|null} a normalised index, or null when the value has the wrong shape
 */
function normaliseIndex(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = /** @type {any} */ (value);
  if (typeof v.lastCounter !== 'number' || !Number.isFinite(v.lastCounter) || !Array.isArray(v.runs)) return null;
  for (const e of v.runs) {
    if (typeof e !== 'object' || e === null || typeof e.runId !== 'string' || typeof e.counter !== 'number' || !Number.isFinite(e.counter)) return null;
  }
  /** @type {IndexFile} */
  let index = { schemaVersion: SCHEMA_VERSION, lastCounter: v.lastCounter, runs: [] };
  for (const e of v.runs) index = insertEntry(index, e).index;
  return index;
}

/**
 * @param {StoreDeps} deps
 * @returns {Promise<string[]>} file names in the runs folder (empty when the folder is missing)
 */
async function listRunsFolder(deps) {
  try {
    return await deps.fs.readdir(runsFolder(deps));
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'ENOENT') return [];
    throw e;
  }
}

/**
 * @param {string[]} names
 * @returns {number} the highest counter among names that match the Result_File pattern (0 for none)
 */
function highestCounterInNames(names) {
  let highest = 0;
  for (const name of names) {
    const m = RESULT_FILE_PATTERN.exec(name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return highest;
}

/**
 * Read the Index_File, or rebuild it in memory from the Result_Files when it is missing, unparsable
 * or has the wrong shape. Writes nothing.
 * @param {StoreDeps} deps
 * @returns {Promise<IndexFile>}
 */
export async function loadOrRebuildIndex(deps) {
  try {
    const text = await deps.fs.readFile(indexPath(deps), 'utf8');
    const index = normaliseIndex(JSON.parse(text));
    if (index) return index;
  } catch (e) {
    if (!(e instanceof SyntaxError) && /** @type {any} */ (e)?.code !== 'ENOENT') throw e;
  }
  const names = await listRunsFolder(deps);
  /** @type {IndexFile} */
  let index = { schemaVersion: SCHEMA_VERSION, lastCounter: highestCounterInNames(names), runs: [] };
  for (const name of names) {
    const m = RESULT_FILE_PATTERN.exec(name);
    if (!m) continue;
    const rec = await readResultFile(deps, name.slice(0, -'.json'.length));
    if (!rec || typeof rec.runId !== 'string' || typeof rec.counter !== 'number' || !Number.isFinite(rec.counter)) continue;
    index = insertEntry(index, indexEntryOf(rec)).index;
  }
  return index;
}

/**
 * Write JSON atomically: a temp file named `.<name>.<token>.tmp` in the same folder, then a rename.
 * @param {StoreDeps} deps
 * @param {string} finalPath
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(deps, finalPath, value) {
  const temp = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${deps.token()}.tmp`);
  await deps.fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await deps.fs.rename(temp, finalPath);
  } catch (e) {
    await deps.fs.rm(temp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * @param {StoreDeps} deps
 * @param {RunRecord} record
 * @returns {Promise<void>}
 */
export async function writeResultFile(deps, record) {
  await deps.fs.mkdir(runsFolder(deps), { recursive: true });
  await writeJsonAtomic(deps, path.join(runsFolder(deps), `${record.runId}.json`), record);
}

/**
 * @param {StoreDeps} deps
 * @param {string} runId
 * @returns {Promise<RunRecord|null>} null when the file is missing or does not parse to an object
 */
export async function readResultFile(deps, runId) {
  if (!RUN_ID_PATTERN.test(runId)) return null;
  try {
    const value = JSON.parse(await deps.fs.readFile(path.join(runsFolder(deps), `${runId}.json`), 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value;
  } catch (e) {
    if (e instanceof SyntaxError || /** @type {any} */ (e)?.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * @param {StoreDeps} deps
 * @param {IndexFile} index
 * @returns {Promise<void>}
 */
export async function writeIndex(deps, index) {
  await deps.fs.mkdir(deps.paths.dataFolder, { recursive: true });
  await writeJsonAtomic(deps, indexPath(deps), index);
}

/**
 * Delete the files in the runs folder that match the Result_File pattern and have no Index_Entry.
 * @param {StoreDeps} deps
 * @param {IndexFile} index
 * @returns {Promise<string[]>} the deleted file names
 */
export async function pruneResultFiles(deps, index) {
  const keep = new Set(index.runs.map((e) => `${e.runId}.json`));
  const deleted = [];
  for (const name of await listRunsFolder(deps)) {
    if (!RESULT_FILE_PATTERN.test(name) || keep.has(name)) continue;
    await deps.fs.rm(path.join(runsFolder(deps), name), { force: true });
    deleted.push(name);
  }
  return deleted.sort();
}

/**
 * Step 4 of the design: start the record.
 * @param {StoreDeps} deps
 * @param {{startedAtMs: number, cronTimeoutSec: number, repoUrl: string, branch: string, previousLaunch: RunRecord['previousLaunch']}} params
 * @returns {Promise<{record: RunRecord, index: IndexFile}>}
 */
export async function startRun(deps, { startedAtMs, cronTimeoutSec, repoUrl, branch, previousLaunch }) {
  const loaded = await loadOrRebuildIndex(deps);
  const marked = markCutShort(loaded.runs, startedAtMs, cronTimeoutSec);
  for (const runId of marked.changedRunIds) {
    const old = await readResultFile(deps, runId);
    if (old) await writeResultFile(deps, { ...old, state: 'cut-short' });
  }
  const highestName = highestCounterInNames(await listRunsFolder(deps));
  const counter = Math.max(loaded.lastCounter, highestName) + 1;
  const record = newRunRecord({ runId: runIdOf(counter), counter, startedAt: new Date(startedAtMs).toISOString(), repoUrl, branch, previousLaunch });
  const index = insertEntry({ ...loaded, runs: marked.entries }, indexEntryOf(record)).index;
  await writeIndex(deps, index); // the counter is stored before the Result_File exists
  await writeResultFile(deps, record);
  await pruneResultFiles(deps, index);
  return { record, index };
}

/**
 * Step 8.2 of the design: update the Index_Entry of a finished run.
 * @param {StoreDeps} deps
 * @param {RunRecord} record
 * @returns {Promise<IndexFile>}
 */
export async function finishRunInIndex(deps, record) {
  const loaded = await loadOrRebuildIndex(deps);
  const index = insertEntry(loaded, indexEntryOf(record)).index;
  await writeIndex(deps, index);
  await pruneResultFiles(deps, index);
  return index;
}
