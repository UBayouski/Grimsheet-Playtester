// @ts-check
// Exclusive-create lock file with stale-lock takeover. Used for the Run_Lock_File and for the
// results Lock_File. All file access goes through `deps.fs`.

/** @typedef {import('./replay/types.mjs').Deps} Deps */

/**
 * @typedef {Object} LockOpts
 * @property {string} path
 * @property {number} staleAfterMs   Run lock: cronTimeoutSec*1000. Results lock: 60000.
 * @property {number} waitMs         Run lock: 0 (no waiting). Results lock: 10000.
 * @property {number} retryEveryMs   200
 */

/**
 * @param {unknown} e
 * @returns {string|undefined} the error code
 */
const codeOf = (e) => /** @type {any} */ (e)?.code;

/**
 * Creation time of a lock: `createdAt` from the JSON content, else the modification time.
 * @param {string|null} content lock text
 * @param {number|null} mtimeMs
 * @returns {number|null}
 */
export function lockCreatedMs(content, mtimeMs) {
  if (content !== null) {
    try {
      const value = JSON.parse(content);
      const createdAt = value && typeof value === 'object' ? value.createdAt : undefined;
      const ms = typeof createdAt === 'number' ? createdAt : typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
      if (Number.isFinite(ms)) return ms;
    } catch {
      // not JSON: use the modification time
    }
  }
  return mtimeMs;
}

/**
 * @param {Pick<Deps, 'fs'>} deps
 * @param {string} path
 * @returns {Promise<{text: string, mtimeMs: number|null}|null>} null when the file is gone
 */
async function readLock(deps, path) {
  let text;
  try {
    text = await deps.fs.readFile(path, 'utf8');
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return null;
    throw e;
  }
  let mtimeMs = null;
  try {
    mtimeMs = (await deps.fs.stat(path)).mtimeMs;
  } catch {
    // the file may have been removed meanwhile; the content alone decides
  }
  return { text, mtimeMs };
}

/**
 * @param {Pick<Deps, 'fs' | 'clock' | 'sleep' | 'token' | 'pid'>} deps
 * @param {LockOpts} opts
 * @returns {Promise<{ok: true, token: string, release: () => Promise<void>} | {ok: false, reason: 'held' | 'timeout' | 'io_error'}>}
 */
export async function acquireLock(deps, opts) {
  const token = deps.token();
  const deadline = deps.clock.nowMs() + opts.waitMs;
  for (;;) {
    try {
      const content = JSON.stringify({ pid: deps.pid, token, createdAt: new Date(deps.clock.nowMs()).toISOString() });
      await deps.fs.writeFile(opts.path, content, { encoding: 'utf8', flag: 'wx' });
      return { ok: true, token, release: async () => void (await releaseLock(deps, opts.path, token)) };
    } catch (e) {
      if (codeOf(e) !== 'EEXIST') return { ok: false, reason: 'io_error' };
    }

    try {
      const seen = await readLock(deps, opts.path);
      if (seen === null) continue; // gone: retry the create at once
      const created = lockCreatedMs(seen.text, seen.mtimeMs);
      if (created === null || deps.clock.nowMs() - created > opts.staleAfterMs) {
        const moved = `${opts.path}.stale-${token}`;
        try {
          await deps.fs.rename(opts.path, moved);
        } catch (e) {
          if (codeOf(e) === 'ENOENT') continue; // someone else moved it
          return { ok: false, reason: 'io_error' };
        }
        let movedText = null;
        try {
          movedText = await deps.fs.readFile(moved, 'utf8');
        } catch {
          // unreadable copy: nothing to compare or put back
        }
        if (movedText !== null && movedText !== seen.text) {
          // We moved a newer lock than the stale one we read: put it back.
          await deps.fs.writeFile(opts.path, movedText, { encoding: 'utf8', flag: 'wx' }).catch(() => {});
          await deps.fs.rm(moved, { force: true });
        } else {
          await deps.fs.rm(moved, { force: true });
          continue; // one create attempt follows
        }
      }
    } catch {
      return { ok: false, reason: 'io_error' };
    }

    if (opts.waitMs === 0) return { ok: false, reason: 'held' };
    if (deps.clock.nowMs() >= deadline) return { ok: false, reason: 'timeout' };
    await deps.sleep(opts.retryEveryMs);
  }
}

/**
 * Remove the lock only if the file holds this token.
 * @param {Pick<Deps, 'fs'>} deps
 * @param {string} path
 * @param {string} token
 * @returns {Promise<boolean>} true when removed
 */
export async function releaseLock(deps, path, token) {
  try {
    const seen = await readLock(deps, path);
    if (seen === null) return false;
    const value = JSON.parse(seen.text);
    if (!value || typeof value !== 'object' || value.token !== token) return false;
    await deps.fs.rm(path, { force: true });
    return true;
  } catch {
    return false;
  }
}
