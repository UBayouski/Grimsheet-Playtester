// @ts-check
// The Grimsheet checkout: where it lives, how it is cloned or refreshed, and the safety checks before
// anything is deleted. Only the git subcommands in ALLOWED_GIT are ever started, always with an
// argument array and no shell.

import * as path from 'node:path';
import { STEP_LIMITS_MS, effectiveLimit } from './process.mjs';

/** @typedef {import('./types.mjs').Deps} Deps */
/** @typedef {import('./types.mjs').Failure} Failure */
/** @typedef {import('./types.mjs').Fs} Fs */

export const ALLOWED_GIT = ['clone', 'fetch', 'reset', 'rev-parse', 'remote get-url'];

/** The sub-folder of the app's local folder that holds the checkout. */
export const DEFAULT_SUB_PATH = 'grimsheet';

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/;

/**
 * Throws for any git subcommand that is not on the list.
 * @param {string[]} args
 * @returns {void}
 */
export function assertAllowedGit(args) {
  const sub = args[0] === 'remote' ? `remote ${args[1] ?? ''}` : (args[0] ?? '');
  if (!ALLOWED_GIT.includes(sub)) throw new Error(`git subcommand not allowed: ${args.slice(0, 2).join(' ')}`);
}

/**
 * One or more segments matching ^[a-z0-9][a-z0-9-]*$, joined by a backslash.
 * @param {unknown} subPath
 * @returns {subPath is string}
 */
export function isValidSubPath(subPath) {
  return typeof subPath === 'string' && subPath.length > 0 && subPath.split('\\').every((s) => SEGMENT_PATTERN.test(s));
}

/**
 * @param {string} localAppData
 * @param {string} appName
 * @param {string} [subPath]
 * @returns {string|null} `<localAppData>\<appName>\<subPath>`, or null when localAppData is empty or subPath is invalid
 */
export function checkoutPath(localAppData, appName, subPath = DEFAULT_SUB_PATH) {
  if (typeof localAppData !== 'string' || localAppData === '' || !isValidSubPath(subPath)) return null;
  return path.join(localAppData, appName, ...subPath.split('\\'));
}

/**
 * @param {string} outer
 * @param {string} inner
 * @returns {boolean} true when `inner` is `outer` or lies under it
 */
function isSameOrUnder(outer, inner) {
  const rel = path.relative(path.resolve(outer), path.resolve(inner));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The checkout and the app folder must not overlap in either direction (deleting a checkout that
 * contains the app would delete the app).
 * @param {string} dir
 * @param {string} appFolder
 * @param {string} dataFolder
 * @returns {boolean}
 */
function overlapsApp(dir, appFolder, dataFolder) {
  return [appFolder, dataFolder].some((p) => isSameOrUnder(p, dir) || isSameOrUnder(dir, p));
}

/**
 * Pure. Is it safe to delete this folder as the checkout?
 * @param {string} dir
 * @param {string} localAppData
 * @param {string} appName
 * @param {string} appFolder
 * @param {string} dataFolder
 * @param {string} [subPath]
 * @returns {{ok: true} | {ok: false, reasonCode: 'checkout_inside_app' | 'checkout_delete_failed'}}
 */
export function checkDeletable(dir, localAppData, appName, appFolder, dataFolder, subPath = DEFAULT_SUB_PATH) {
  const bad = /** @type {const} */ ({ ok: false, reasonCode: 'checkout_delete_failed' });
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || typeof localAppData !== 'string' || localAppData === '') return bad;
  if (overlapsApp(dir, appFolder, dataFolder)) return { ok: false, reasonCode: 'checkout_inside_app' };
  if (!isSameOrUnder(localAppData, dir) || path.resolve(dir) === path.resolve(localAppData)) return bad;
  if (!isValidSubPath(subPath)) return bad;
  const tail = path.join(path.sep, appName, ...subPath.split('\\'));
  const normalised = path.resolve(dir);
  if (!normalised.endsWith(tail)) return bad;
  return { ok: true };
}

/**
 * Clear the read-only attribute on every file under `dir` (git pack files are read-only), then remove
 * the folder. An entry that resolves outside the folder (a link) is not touched.
 * @param {Fs} fs
 * @param {string} dir
 * @returns {Promise<boolean>} true when the folder is gone
 */
export async function forceRemove(fs, dir) {
  try {
    const root = await fs.realpath(dir);
    /** @param {string} folder @param {number} depth @returns {Promise<void>} */
    const clear = async (folder, depth) => {
      if (depth > 64) return;
      for (const name of await fs.readdir(folder)) {
        const child = path.join(folder, name);
        const real = await fs.realpath(child).catch(() => null);
        if (real === null || !isSameOrUnder(root, real)) continue;
        const info = await fs.stat(child);
        if (info.isDirectory()) await clear(child, depth + 1);
        else await fs.chmod(child, 0o666).catch(() => {});
      }
    };
    await clear(dir, 0);
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    return false;
  }
  return !(await fs.stat(dir).then(
    () => true,
    () => false,
  ));
}

/**
 * @param {string} reasonCode
 * @param {string} message
 * @param {number|null} [exitCode]
 * @param {string} [step]
 * @returns {{ok: false, failure: Failure}}
 */
function fail(reasonCode, message, exitCode = null, step) {
  /** @type {Failure} */
  const failure = { stage: 'checkout', reasonCode, message, exitCode };
  if (step !== undefined) failure.step = step;
  return { ok: false, failure };
}

/**
 * Clone or refresh the checkout and read its commit hash.
 * @param {Pick<Deps, 'fs' | 'spawn' | 'paths' | 'appName' | 'clock' | 'platform'>} deps
 * @param {{repoUrl: string, branch: string, deadlineMs: number, subPath?: string}} args
 * @returns {Promise<{ok: true, dir: string, commit: string} | {ok: false, failure: Failure}>}
 */
export async function ensureCheckout(deps, { repoUrl, branch, deadlineMs, subPath = DEFAULT_SUB_PATH }) {
  const { appFolder, dataFolder, localAppData } = deps.paths;
  if (typeof localAppData !== 'string' || localAppData === '') {
    return fail('no_local_app_data', 'The LOCALAPPDATA setting is missing, so there is no place for the Grimsheet checkout.');
  }
  const dir = checkoutPath(localAppData, deps.appName, subPath);
  if (dir === null) return fail('invalid_sub_path', 'The checkout sub-folder name is not allowed.');
  if (overlapsApp(dir, appFolder, dataFolder)) {
    return fail('checkout_inside_app', 'The checkout folder would be inside the app folder, which is not allowed.');
  }

  /**
   * Run one git step. Returns a failure for a start error or a timeout; otherwise the process result.
   * @param {string[]} gitArgs
   * @param {string} cwd
   * @param {number} fixedMs
   * @returns {Promise<{ok: true, exitCode: number|null, stdout: string} | {ok: false, failure: Failure}>}
   */
  async function git(gitArgs, cwd, fixedMs) {
    assertAllowedGit(gitArgs);
    const label = `git ${gitArgs[0] === 'remote' ? 'remote get-url' : gitArgs[0]}`;
    const timeoutMs = effectiveLimit(fixedMs, deps.clock.nowMs(), deadlineMs);
    if (timeoutMs <= 0) return fail('step_timeout', `The step "${label}" did not finish in time.`, null, label);
    const r = await deps.spawn({ command: 'git', args: gitArgs, cwd, shell: false, timeoutMs, label });
    if (r.startError !== null) return fail('git_not_found', 'git could not be started. Install git and make sure it is on the PATH.');
    if (r.timedOut) return fail('step_timeout', `The step "${label}" did not finish in time.`, null, label);
    return { ok: true, exitCode: r.exitCode, stdout: r.stdout };
  }

  /** @param {{ok: true, exitCode: number|null, stdout: string}} r @returns {{ok: false, failure: Failure}|null} */
  const nonZero = (r) => (r.exitCode === 0 ? null : fail('git_failed', `A git step failed with exit code ${r.exitCode}.`, r.exitCode));

  let exists = await deps.fs.stat(dir).then(
    () => true,
    (e) => /** @type {any} */ (e)?.code !== 'ENOENT',
  );

  if (exists) {
    const origin = await git(['remote', 'get-url', 'origin'], dir, STEP_LIMITS_MS.git);
    if (!origin.ok) return origin;
    const valid = origin.exitCode === 0 && origin.stdout.trim() === repoUrl;
    if (!valid) {
      const check = checkDeletable(dir, localAppData, deps.appName, appFolder, dataFolder, subPath);
      if (!check.ok) {
        return check.reasonCode === 'checkout_inside_app'
          ? fail('checkout_inside_app', 'The checkout folder would be inside the app folder, which is not allowed.')
          : fail('checkout_delete_failed', 'The old checkout could not be removed safely.');
      }
      if (!(await forceRemove(deps.fs, dir))) return fail('checkout_delete_failed', 'The old checkout could not be removed safely.');
      exists = false;
    }
  }

  if (!exists) {
    const parent = path.dirname(dir);
    try {
      await deps.fs.mkdir(parent, { recursive: true });
    } catch {
      return fail('git_failed', 'The folder for the checkout could not be created.');
    }
    // `--` keeps a URL or branch that starts with a dash from being read as an option.
    const cloned = await git(['clone', '--depth', '1', '--branch', branch, '--', repoUrl, dir], parent, STEP_LIMITS_MS.gitFetch);
    if (!cloned.ok) return cloned;
    const bad = nonZero(cloned);
    if (bad) return bad;
  } else {
    const fetched = await git(['fetch', '--depth', '1', '--', 'origin', branch], dir, STEP_LIMITS_MS.gitFetch);
    if (!fetched.ok) return fetched;
    const badFetch = nonZero(fetched);
    if (badFetch) return badFetch;
    const reset = await git(['reset', '--hard', 'FETCH_HEAD'], dir, STEP_LIMITS_MS.git);
    if (!reset.ok) return reset;
    const badReset = nonZero(reset);
    if (badReset) return badReset;
  }

  const head = await git(['rev-parse', 'HEAD'], dir, STEP_LIMITS_MS.git);
  if (!head.ok) return head;
  const badHead = nonZero(head);
  if (badHead) return badHead;
  const commit = head.stdout.trim();
  if (!COMMIT_PATTERN.test(commit)) return fail('git_failed', 'git rev-parse HEAD returned no commit hash.', head.exitCode);
  return { ok: true, dir, commit };
}
