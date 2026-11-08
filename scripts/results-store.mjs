// @ts-check
// Write_Module: merges the sub-keys one writer owns into one top-level key of data\config.json, under
// the results Lock_File. It never sends an HTTP request. The lock is never held across an external
// process, and a holder of this lock never takes the Run_Lock_File.

import * as path from 'node:path';
import { acquireLock } from './file-lock.mjs';

/** @typedef {import('./replay/types.mjs').Deps} Deps */
/** @typedef {Pick<Deps, 'fs' | 'paths' | 'clock' | 'sleep' | 'token' | 'pid'>} ResultsDeps */

export const RESULTS_LOCK_FILE = '.results.lock';

const LOCK_STALE_MS = 60000;
const LOCK_WAIT_MS = 10000;
const LOCK_RETRY_MS = 200;

/**
 * Run `fn` while holding the results Lock_File. Does not nest.
 * `lock_timeout` is a lock held by someone else for the whole wait; `io_error` is a file-system error
 * while taking the lock.
 * @template T
 * @param {ResultsDeps} deps
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ok: true, value: T} | {ok: false, reason: 'lock_timeout' | 'io_error'}>}
 */
export async function withResultsLock(deps, fn) {
  await deps.fs.mkdir(deps.paths.dataFolder, { recursive: true }).catch(() => {});
  const lock = await acquireLock(deps, {
    path: path.join(deps.paths.dataFolder, RESULTS_LOCK_FILE),
    staleAfterMs: LOCK_STALE_MS,
    waitMs: LOCK_WAIT_MS,
    retryEveryMs: LOCK_RETRY_MS,
  });
  if (!lock.ok) return { ok: false, reason: lock.reason === 'io_error' ? 'io_error' : 'lock_timeout' };
  try {
    return { ok: true, value: await fn() };
  } finally {
    await lock.release();
  }
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Merge owned sub-keys into one top-level key of data\config.json under the results Lock_File.
 * @param {ResultsDeps} deps
 * @param {{
 *   topKey: string,
 *   buildOwned: (existingTop: Record<string, unknown>) => {ok: true, owned: Record<string, unknown>} | {ok: false},
 *   budgetBytes: number,
 * }} opts
 * @returns {Promise<{ok: true} | {ok: false, reason: 'lock_timeout' | 'config_unreadable' | 'too_large' | 'write_failed'}>}
 */
export async function mergeTopKey(deps, { topKey, buildOwned, budgetBytes }) {
  const configPath = path.join(deps.paths.dataFolder, 'config.json');
  const locked = await withResultsLock(deps, async () => {
    /** @type {Record<string, unknown>} */
    let config = {};
    try {
      const parsed = JSON.parse(await deps.fs.readFile(configPath, 'utf8')); // a leading BOM makes this throw
      if (!isPlainObject(parsed)) return /** @type {const} */ ({ ok: false, reason: 'config_unreadable' });
      config = parsed;
    } catch (e) {
      if (/** @type {any} */ (e)?.code !== 'ENOENT') return /** @type {const} */ ({ ok: false, reason: 'config_unreadable' });
    }

    const existing = config[topKey];
    const existingTop = isPlainObject(existing) ? existing : {};
    const built = buildOwned(existingTop);
    if (!built.ok) return /** @type {const} */ ({ ok: false, reason: 'too_large' });
    const merged = { ...existingTop, ...built.owned };
    if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > budgetBytes) return /** @type {const} */ ({ ok: false, reason: 'too_large' });

    const next = { ...config, [topKey]: merged };
    const temp = path.join(deps.paths.dataFolder, `.config.${deps.token()}.tmp`);
    try {
      await deps.fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await deps.fs.rename(temp, configPath);
    } catch {
      await deps.fs.rm(temp, { force: true }).catch(() => {});
      return /** @type {const} */ ({ ok: false, reason: 'write_failed' });
    }
    return /** @type {const} */ ({ ok: true });
  });
  if (!locked.ok) return { ok: false, reason: locked.reason === 'io_error' ? 'write_failed' : 'lock_timeout' };
  return locked.value;
}
