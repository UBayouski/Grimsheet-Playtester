// @ts-check
// Hunt_Begin: takes the Hunt lock, prepares the Hunt_Checkout, builds Grimsheet, lists the levels and
// leaves a ready Hunt (the lock stays held) or a failed record. See .kiro/specs/exploit-hunt/design.md,
// "Hunt_Begin flow". It reads process state only through `deps`; it never writes data\launcher\control.json.

import * as path from 'node:path';
import { acquireLock, releaseLock } from '../file-lock.mjs';
import { checkoutPath, ensureCheckout } from '../replay/checkout.mjs';
import { parseLevelList } from '../replay/levels.mjs';
import { STEP_LIMITS_MS, effectiveLimit } from '../replay/process.mjs';
import { parseNoArgs } from './args.mjs';
import { failRecord, huntIdOf, newHuntRecord, readyRecord } from './hunt-record.mjs';
import { clearActive, huntPaths, markStaleRunningCutShort, pruneCandidateFolders, pruneHuntRecords, writeActive, writeHuntRecord } from './hunt-store.mjs';
import { BEGIN_ALLOWANCE_SEC, DEFAULT_BRANCH, DEFAULT_REPO_URL, LEVEL_ID_MAX, LOCK_AGE_SEC, MAX_LEVELS } from './limits.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('./types.mjs').HuntRecord} HuntRecord */
/** @typedef {import('./types.mjs').HuntResult} HuntResult */
/** @typedef {NonNullable<HuntRecord['failure']>} Failure */

const MAX_ID_TRIES = 5;

/**
 * @param {Failure['stage']} stage
 * @param {string} reasonCode
 * @param {string} message
 * @param {number|null} [exitCode]
 * @param {string} [step]
 * @returns {Failure}
 */
function failureOf(stage, reasonCode, message, exitCode = null, step) {
  /** @type {Failure} */
  const f = { stage, reasonCode, message, exitCode };
  if (step !== undefined) f.step = step;
  return f;
}

/**
 * @param {unknown} text
 * @returns {unknown} the parsed JSON, or undefined when the text is not JSON
 */
function parseOrUndefined(text) {
  try {
    return JSON.parse(/** @type {string} */ (text));
  } catch {
    return undefined;
  }
}

/**
 * data\launcher\control.json, read only. A missing file, a BOM, bad JSON or a value of the wrong type gives the
 * default of that field.
 * @param {HuntDeps} deps
 * @returns {Promise<{repoUrl: string, branch: string}>}
 */
async function readControl(deps) {
  const settings = { repoUrl: DEFAULT_REPO_URL, branch: DEFAULT_BRANCH };
  try {
    const value = JSON.parse(await deps.fs.readFile(path.join(deps.paths.dataFolder, 'launcher', 'control.json'), 'utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (typeof value.repoUrl === 'string' && value.repoUrl !== '') settings.repoUrl = value.repoUrl;
      if (typeof value.branch === 'string' && value.branch !== '') settings.branch = value.branch;
    }
  } catch {
    // defaults
  }
  return settings;
}

/**
 * The first Hunt_Id whose record file does not exist: the start second, then +1 s, at most 5 tries.
 * @param {HuntDeps} deps
 * @param {number} startMs
 * @returns {Promise<string|null>}
 */
async function uniqueHuntId(deps, startMs) {
  const folder = huntPaths(deps).huntsFolder;
  for (let i = 0; i < MAX_ID_TRIES; i += 1) {
    const id = huntIdOf(startMs + i * 1000);
    const taken = await deps.fs.stat(path.join(folder, `${id}.json`)).then(
      () => true,
      (e) => /** @type {any} */ (e)?.code !== 'ENOENT',
    );
    if (!taken) return id;
  }
  return null;
}

/**
 * Checkout, install, build, level list. Returns the failure, or the data of a ready Hunt.
 * @param {HuntDeps} deps
 * @param {{repoUrl: string, branch: string}} settings
 * @param {number} deadlineMs
 * @returns {Promise<{failure: Failure} | {commit: string, levels: string[], levelsSkipped: number}>}
 */
async function prepare(deps, settings, deadlineMs) {
  const { localAppData } = deps.paths;
  const own = checkoutPath(localAppData, deps.appName, 'hunt\\grimsheet');
  if (own !== null && own === checkoutPath(localAppData, deps.appName)) {
    return { failure: failureOf('checkout', 'checkout_delete_failed', 'The old checkout could not be removed safely.') };
  }

  const checkout = await ensureCheckout(deps, { repoUrl: settings.repoUrl, branch: settings.branch, deadlineMs, subPath: 'hunt\\grimsheet' });
  if (!checkout.ok) return { failure: /** @type {Failure} */ (checkout.failure) };
  const dir = checkout.dir;

  /**
   * One non-play step. Returns a failure, or null when the step succeeded.
   * @param {{label: string, stage: Failure['stage'], code: string, message: (exitCode: number) => string, command: string, args: string[], fixedMs: number}} s
   * @returns {Promise<Failure|null>}
   */
  async function step(s) {
    const timedOut = () => failureOf(s.stage, 'step_timeout', `The step "${s.label}" did not finish in time.`, null, s.label);
    const timeoutMs = effectiveLimit(s.fixedMs, deps.clock.nowMs(), deadlineMs);
    if (timeoutMs <= 0) return timedOut();
    const r = await deps.spawn({ command: s.command, args: s.args, cwd: dir, shell: false, timeoutMs, label: s.label });
    if (r.timedOut) return timedOut();
    if (r.startError !== null) return failureOf(s.stage, s.code, `The step "${s.label}" could not be started.`, null);
    if (r.exitCode !== 0) return failureOf(s.stage, s.code, s.message(/** @type {number} */ (r.exitCode)), r.exitCode);
    return null;
  }

  const install = await step({ label: 'npm ci', stage: 'install', code: 'install_failed', message: (c) => `npm ci failed with exit code ${c}.`, command: 'npm', args: ['ci'], fixedMs: STEP_LIMITS_MS.npmCi });
  if (install) return { failure: install };
  const build = await step({
    label: 'npm run build:play',
    stage: 'build',
    code: 'build_failed',
    message: (c) => `The Grimsheet build failed with exit code ${c}.`,
    command: 'npm',
    args: ['run', 'build:play'],
    fixedMs: STEP_LIMITS_MS.build,
  });
  if (build) return { failure: build };

  // The level list: a non-zero exit is list_failed, so it is read here rather than through `step`.
  const listLabel = 'node play.mjs --list';
  const listTimedOut = () => failureOf('list', 'step_timeout', `The step "${listLabel}" did not finish in time.`, null, listLabel);
  const listLimit = effectiveLimit(STEP_LIMITS_MS.list, deps.clock.nowMs(), deadlineMs);
  if (listLimit <= 0) return { failure: listTimedOut() };
  const listRun = await deps.spawn({ command: 'node', args: ['scripts/play.mjs', '--list'], cwd: dir, shell: false, timeoutMs: listLimit, label: listLabel });
  if (listRun.timedOut) return { failure: listTimedOut() };
  const parsed = parseLevelList(
    listRun.startError === null ? parseOrUndefined(listRun.stdout) : undefined,
    listRun.startError === null && typeof listRun.exitCode === 'number' ? listRun.exitCode : 1,
  );
  if (!parsed.ok) {
    return {
      failure:
        parsed.reasonCode === 'empty_level_list'
          ? failureOf('list', 'empty_level_list', 'Grimsheet lists no levels.')
          : failureOf('list', 'list_failed', 'The level list could not be read or has an invalid level id.', typeof listRun.exitCode === 'number' && listRun.exitCode !== 0 ? listRun.exitCode : null),
    };
  }

  // The length rule first, then the cap; everything dropped is counted as skipped.
  const levels = parsed.ids.filter((id) => id.length <= LEVEL_ID_MAX).slice(0, MAX_LEVELS);
  return { commit: checkout.commit, levels, levelsSkipped: parsed.ids.length - levels.length };
}

/**
 * @param {HuntDeps} deps
 * @param {string[]} argv
 * @returns {Promise<HuntResult>}
 */
export async function runBegin(deps, argv) {
  if (!parseNoArgs(argv).ok) return { exit: 3, body: { state: 'refused', reasonCode: 'bad_arguments' } };

  const startMs = deps.clock.nowMs();
  const paths = huntPaths(deps);
  const lock = await acquireLock(deps, { path: paths.lockPath, staleAfterMs: LOCK_AGE_SEC * 1000, waitMs: 0, retryEveryMs: 200 });
  if (!lock.ok) {
    return lock.reason === 'io_error' ? { exit: 4, body: { state: 'record_failed', reasonCode: 'hunt_record_unwritable' } } : { exit: 3, body: { state: 'already_running' } };
  }

  /** @type {HuntRecord|null} */
  let record = null;
  let keepLock = false;
  try {
    await clearActive(deps); // a pointer found now is stale: we hold the lock
    await markStaleRunningCutShort(deps, startMs);

    const huntId = await uniqueHuntId(deps, startMs);
    const unwritable = { exit: /** @type {const} */ (4), body: { state: 'record_failed', reasonCode: 'hunt_record_unwritable' } };
    if (huntId === null) return unwritable;

    const control = await readControl(deps);
    record = newHuntRecord({ huntId, startedAt: new Date(startMs).toISOString(), repoUrl: control.repoUrl, branch: control.branch });
    try {
      await writeHuntRecord(deps, record); // before the first process
    } catch {
      record = null;
      return unwritable;
    }
    await pruneHuntRecords(deps).catch(() => {});
    await pruneCandidateFolders(deps).catch(() => {});

    const deadlineMs = startMs + BEGIN_ALLOWANCE_SEC * 1000;
    const prepared = await prepare(deps, control, deadlineMs);

    if ('failure' in prepared) {
      record = failRecord(record, { finishedAt: new Date(deps.clock.nowMs()).toISOString(), failure: prepared.failure });
      await writeHuntRecord(deps, record);
      return { exit: 0, body: { state: 'failed', huntId, failure: prepared.failure } };
    }

    const ready = readyRecord(record, { readyAt: new Date(deps.clock.nowMs()).toISOString(), commit: prepared.commit, levels: prepared.levels, levelsSkipped: prepared.levelsSkipped });
    await writeHuntRecord(deps, ready);
    record = ready;
    await writeActive(deps, { schemaVersion: 1, huntId, token: lock.token, readyAt: /** @type {string} */ (ready.readyAt) });
    keepLock = true; // the Hunt owns the lock until Hunt_End or a stale takeover
    return {
      exit: 0,
      body: { state: 'ready', huntId, commit: prepared.commit, levels: prepared.levels, levelsSkipped: prepared.levelsSkipped, budget: ready.budget },
    };
  } catch {
    // An unexpected fault: mark the record failed when there is one, drop any pointer, release the lock.
    let huntId = null;
    /** @type {Failure} */
    const failure = failureOf('record', 'internal_error', 'The hunt hit an internal fault.');
    if (record !== null) {
      huntId = record.huntId;
      try {
        await writeHuntRecord(deps, failRecord(record, { finishedAt: new Date(deps.clock.nowMs()).toISOString(), failure }));
      } catch {
        // the record stays as it was; the next Begin marks it cut-short
      }
    }
    await clearActive(deps).catch(() => {});
    return { exit: 4, body: huntId === null ? { state: 'record_failed', reasonCode: 'hunt_record_unwritable' } : { state: 'failed', huntId, failure } };
  } finally {
    if (!keepLock) await releaseLock(deps, paths.lockPath, lock.token);
  }
}
