// @ts-check
// I/O of the exploit hunt: Hunt_Record, active pointer, lock proof, call lock, Candidate_File, prune.
// All file access goes through `deps.fs`; all paths are built from `deps.paths` and `deps.appName`.
import * as path from 'node:path';
import { acquireLock, lockCreatedMs } from '../file-lock.mjs';
import { checkoutPath } from '../replay/checkout.mjs';
import { HUNT_RECORD_PATTERN, markCutShort } from './hunt-record.mjs';
import { CALL_LOCK_STALE_MS, CALL_LOCK_WAIT_MS, KEEP_CANDIDATE_FOLDERS, KEEP_HUNT_RECORDS, LOCK_AGE_SEC } from './limits.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('./types.mjs').HuntRecord} HuntRecord */
/** @typedef {import('./types.mjs').ActivePointer} ActivePointer */
/** @typedef {import('./types.mjs').Action} Action */

const CANDIDATE_FOLDER_PATTERN = /^hunt-\d{8}T\d{6}Z$/;
const RETRY_EVERY_MS = 200;

/** @param {unknown} e @returns {string|undefined} */
const codeOf = (e) => /** @type {any} */ (e)?.code;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Every path of the hunt, built from `deps.paths` and `deps.appName`.
 * @param {Pick<HuntDeps, 'paths' | 'appName'>} deps
 */
export function huntPaths(deps) {
  const { dataFolder, localAppData } = deps.paths;
  const huntsFolder = path.join(dataFolder, 'hunts');
  const huntLocalFolder = path.join(localAppData, deps.appName, 'hunt');
  return {
    dataFolder,
    huntsFolder,
    lockPath: path.join(dataFolder, '.hunt.lock'),
    callLockPath: path.join(dataFolder, '.hunt-call.lock'),
    activePath: path.join(huntsFolder, 'active.json'),
    huntLocalFolder,
    checkoutDir: checkoutPath(localAppData, deps.appName, 'hunt\\grimsheet') ?? path.join(huntLocalFolder, 'grimsheet'),
    candidatesFolder: path.join(huntLocalFolder, 'candidates'),
  };
}

/**
 * Temp file `.<name>.<token>.tmp` in the same folder, then a rename. UTF-8, no BOM, two spaces, trailing newline.
 * Creates the folder first when it is missing.
 * @param {Pick<HuntDeps, 'fs' | 'token'>} deps
 * @param {string} finalPath
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(deps, finalPath, value) {
  const folder = path.dirname(finalPath);
  const temp = path.join(folder, `.${path.basename(finalPath)}.${deps.token()}.tmp`);
  await deps.fs.mkdir(folder, { recursive: true });
  await deps.fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await deps.fs.rename(temp, finalPath);
  } catch (e) {
    await deps.fs.rm(temp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * @param {Pick<HuntDeps, 'fs'>} deps
 * @param {string} file
 * @param {boolean} [strict] true: only a missing file (ENOENT) is null; any other read error is thrown
 * @returns {Promise<Record<string, any>|null>} null when missing, unparsable or not an object
 */
async function readJsonObject(deps, file, strict = false) {
  let text;
  try {
    text = await deps.fs.readFile(file, 'utf8');
  } catch (e) {
    if (strict && codeOf(e) !== 'ENOENT') throw e;
    return null;
  }
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {HuntDeps} deps
 * @param {string} huntId
 * @param {boolean} [strict] true: a read error other than ENOENT is thrown instead of answering null
 * @returns {Promise<HuntRecord|null>} null when missing or not an object
 */
export async function readHuntRecord(deps, huntId, strict = false) {
  if (typeof huntId !== 'string' || !HUNT_RECORD_PATTERN.test(`${huntId}.json`)) return null;
  const value = await readJsonObject(deps, path.join(huntPaths(deps).huntsFolder, `${huntId}.json`), strict);
  return /** @type {HuntRecord|null} */ (value);
}

/** @param {HuntDeps} deps @param {HuntRecord} record @returns {Promise<void>} */
export async function writeHuntRecord(deps, record) {
  await writeJsonAtomic(deps, path.join(huntPaths(deps).huntsFolder, `${record.huntId}.json`), record);
}

/**
 * @param {HuntDeps} deps
 * @param {string} folder
 * @returns {Promise<string[]>} names, or [] when the folder cannot be read
 */
async function namesIn(deps, folder) {
  try {
    return await deps.fs.readdir(folder);
  } catch {
    return [];
  }
}

/**
 * Every record named by the pattern: a `running` one older than the lock age limit becomes `cut-short`.
 * @param {HuntDeps} deps
 * @param {number} nowMs
 * @returns {Promise<void>}
 */
export async function markStaleRunningCutShort(deps, nowMs) {
  const names = (await namesIn(deps, huntPaths(deps).huntsFolder)).filter((n) => HUNT_RECORD_PATTERN.test(n));
  for (const name of names) {
    const record = await readHuntRecord(deps, name.slice(0, -'.json'.length));
    if (record === null || record.state !== 'running') continue;
    const next = markCutShort(record, nowMs);
    if (next.state !== record.state) await writeHuntRecord(deps, next);
  }
}

/**
 * Keep the highest ids; touch only names that match the record pattern.
 * @param {HuntDeps} deps
 * @returns {Promise<void>}
 */
export async function pruneHuntRecords(deps) {
  const folder = huntPaths(deps).huntsFolder;
  const names = (await namesIn(deps, folder)).filter((n) => HUNT_RECORD_PATTERN.test(n)).sort();
  for (const name of names.slice(0, Math.max(0, names.length - KEEP_HUNT_RECORDS))) {
    await deps.fs.rm(path.join(folder, name), { force: true });
  }
}

/**
 * Keep the highest folder names that match `^hunt-\d{8}T\d{6}Z$`; remove older ones recursively.
 * @param {HuntDeps} deps
 * @returns {Promise<void>}
 */
export async function pruneCandidateFolders(deps) {
  const folder = huntPaths(deps).candidatesFolder;
  const names = (await namesIn(deps, folder)).filter((n) => CANDIDATE_FOLDER_PATTERN.test(n)).sort();
  for (const name of names.slice(0, Math.max(0, names.length - KEEP_CANDIDATE_FOLDERS))) {
    await deps.fs.rm(path.join(folder, name), { recursive: true, force: true });
  }
}

/**
 * @param {HuntDeps} deps
 * @param {boolean} [strict] true: a read error other than ENOENT is thrown instead of answering null
 * @returns {Promise<ActivePointer|null>} null when missing, unparsable or incomplete
 */
export async function readActive(deps, strict = false) {
  const value = await readJsonObject(deps, huntPaths(deps).activePath, strict);
  if (value === null) return null;
  if (typeof value.huntId !== 'string' || typeof value.token !== 'string' || typeof value.readyAt !== 'string') return null;
  return /** @type {ActivePointer} */ (value);
}

/** @param {HuntDeps} deps @param {ActivePointer} active @returns {Promise<void>} */
export async function writeActive(deps, active) {
  await writeJsonAtomic(deps, huntPaths(deps).activePath, active);
}

/** @param {HuntDeps} deps @returns {Promise<void>} */
export async function clearActive(deps) {
  await deps.fs.rm(huntPaths(deps).activePath, { force: true });
}

/**
 * The four checks. Read only. `{ok:false}` is answered only for the states of the design: a missing (ENOENT) or
 * unparseable file, a lock of another token, a stale lock, a record that is not `running`. Any other fault (a read
 * error other than ENOENT, a throw from code) is not caught here: it propagates and the caller reports it.
 * @param {HuntDeps} deps
 * @returns {Promise<{ok:true, hunt:{huntId:string, token:string, readyAtMs:number, record:HuntRecord}} | {ok:false}>}
 */
export async function resolveActiveHunt(deps) {
  const none = /** @type {const} */ ({ ok: false });
  const active = await readActive(deps, true); // check 1
  if (active === null) return none;

  const lockPath = huntPaths(deps).lockPath; // check 2
  let text;
  try {
    text = await deps.fs.readFile(lockPath, 'utf8');
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return none;
    throw e;
  }
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    return none;
  }
  if (!isObject(lock) || lock.token !== active.token) return none;

  let mtimeMs; // check 3: only strictly more than the limit is stale
  try {
    mtimeMs = (await deps.fs.stat(lockPath)).mtimeMs;
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return none; // the lock vanished: a missing lock
    throw e;
  }
  const created = lockCreatedMs(text, mtimeMs);
  if (created === null || deps.clock.nowMs() - created > LOCK_AGE_SEC * 1000) return none;

  const record = await readHuntRecord(deps, active.huntId, true); // check 4
  if (record === null || record.state !== 'running') return none;

  return { ok: true, hunt: { huntId: active.huntId, token: active.token, readyAtMs: Date.parse(active.readyAt), record } };
}

/**
 * Run `fn` under the per-call lock. The lock is released (token checked) after the body, also when it throws.
 * @template T
 * @param {HuntDeps} deps
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ok:true, value:T} | {ok:false, reason:'busy'|'io_error'}>}
 */
export async function withCallLock(deps, fn) {
  const lock = await acquireLock(deps, {
    path: huntPaths(deps).callLockPath,
    staleAfterMs: CALL_LOCK_STALE_MS,
    waitMs: CALL_LOCK_WAIT_MS,
    retryEveryMs: RETRY_EVERY_MS,
  });
  if (!lock.ok) return { ok: false, reason: lock.reason === 'io_error' ? 'io_error' : 'busy' };
  try {
    return { ok: true, value: await fn() };
  } finally {
    await lock.release();
  }
}

/**
 * Write `<candidates>\<Hunt_Id>\NNN-<level>-<class>.json` with `{levelId, claimedClass, actions}`.
 * @param {HuntDeps} deps
 * @param {string} huntId
 * @param {number} attempt
 * @param {string} levelId
 * @param {string} claimedClass
 * @param {Action[]} actions
 * @returns {Promise<string>} the absolute path
 */
export async function writeCandidateFile(deps, huntId, attempt, levelId, claimedClass, actions) {
  const file = path.join(huntPaths(deps).candidatesFolder, huntId, `${String(attempt).padStart(3, '0')}-${levelId}-${claimedClass}.json`);
  await writeJsonAtomic(deps, file, { levelId, claimedClass, actions });
  return file;
}
