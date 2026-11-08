// @ts-check
// The orchestrator of one Run, in the order of operations of the design (steps 1 to 10). It takes
// everything from `deps` and `args`; it never reads process.env, process.argv, the real clock or the
// real file system, and it never computes a colour (the verifier does).

import * as path from 'node:path';
import { acquireLock } from '../file-lock.mjs';
import { mergeTopKey, withResultsLock } from '../results-store.mjs';
import { ensureCheckout } from './checkout.mjs';
import { finishRunInIndex, loadOrRebuildIndex, readResultFile, startRun, writeResultFile } from './index-store.mjs';
import { buildCoverage, findUnlisted, parseLevelList, readSolution } from './levels.mjs';
import { STEP_LIMITS_MS, effectiveLimit, runDeadline } from './process.mjs';
import {
  BYTE_BUDGET,
  buildResultsKey,
  compactLatest,
  finalizeRecord,
  levelEntryError,
  levelEntryFromVerdict,
  trendEntryFromIndexEntry,
  trendEntryOf,
} from './run-record.mjs';

/** @typedef {import('./types.mjs').Deps} Deps */
/** @typedef {import('./types.mjs').Failure} Failure */
/** @typedef {import('./types.mjs').LevelEntry} LevelEntry */
/** @typedef {import('./types.mjs').Coverage} Coverage */
/** @typedef {import('./types.mjs').RunRecord} RunRecord */
/** @typedef {{exitCode: 0 | 3 | 4, line: {state: string, runId?: string, commit?: string | null}}} RunOutcome */

const RESULTS_TOP_KEY = 'playtesterResults';

const LOG_TAIL_CHARS = 2000;

/**
 * Wraps the process starter so that a failed external step of the checkout, install, build or list
 * stage (non-zero exit, start error or timeout) writes the tail of its output to stderr, every line
 * prefixed with the step label. Nothing is printed for a step that succeeded, for a play process, or
 * for the `git remote get-url` that only decides whether the checkout is repaired. The text goes to
 * stderr only; it is never stored in the Result_File or the results key.
 * @param {Deps} deps
 * @returns {Deps['spawn']}
 */
function withFailureLog(deps) {
  const log = deps.logStderr;
  if (!log) return deps.spawn;
  return async (spec) => {
    const r = await deps.spawn(spec);
    const failed = r.startError !== null || r.timedOut || r.exitCode !== 0;
    const repairProbe = spec.label === 'git remote get-url' && r.startError === null && !r.timedOut;
    if (!failed || repairProbe || spec.label.startsWith('play ')) return r;
    const what = r.startError !== null ? `could not be started: ${r.startError}` : r.timedOut ? 'timed out' : `exit code ${r.exitCode}`;
    const lines = [`failed: ${what}`];
    for (const [name, text] of /** @type {const} */ ([['stdout', r.stdout], ['stderr', r.stderr]])) {
      const tail = text.slice(-LOG_TAIL_CHARS).trimEnd();
      if (tail !== '') lines.push(`${name}:`, ...tail.split(/\r?\n/));
    }
    log(`${lines.map((line) => `[${spec.label}] ${line}`).join('\n')}\n`);
    return r;
  };
}
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
 * Step 3: previousLaunch from data\launcher\last-launch.json (read only).
 * @param {Deps} deps
 * @returns {Promise<RunRecord['previousLaunch']>}
 */
async function readPreviousLaunch(deps) {
  try {
    const value = JSON.parse(await deps.fs.readFile(path.join(deps.paths.dataFolder, 'launcher', 'last-launch.json'), 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof value.outcome !== 'string') return null;
    return { outcome: value.outcome, finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : null };
  } catch {
    return null;
  }
}

/**
 * @param {Deps} deps
 * @param {RunRecord} started
 * @param {{commit: string|null, levels: LevelEntry[], coverage: Coverage|null, failure: Failure|null}} result
 * @returns {Promise<RunOutcome>}
 */
async function finish(deps, started, result) {
  const failed = result.failure !== null;
  const final = finalizeRecord(started, {
    state: failed ? 'failed' : 'complete',
    finishedAt: new Date(deps.clock.nowMs()).toISOString(),
    commit: result.commit,
    levels: result.levels,
    coverage: result.coverage ?? started.coverage,
    failure: result.failure,
  });

  // 8.1 The first write of the final state. If it fails, nothing else is recorded.
  try {
    await writeResultFile(deps, final);
  } catch {
    return { exitCode: 4, line: { state: 'record_failed' } };
  }

  // 8.2 Index_Entry, Index_File, pruning, in one hold of the results lock.
  try {
    await withResultsLock(deps, () => finishRunInIndex(deps, final));
  } catch {
    // the entry stays `running`; the next Run marks it cut-short
  }

  // 8.3 Results_Key through the Write_Module.
  /** @type {RunRecord['resultsKey']} */
  let outcome;
  try {
    const index = await loadOrRebuildIndex(deps);
    const records = [];
    for (const entry of index.runs) records.push({ entry, record: entry.runId === final.runId ? final : await readResultFile(deps, entry.runId) });
    const trend = records.map(({ entry, record }) => (record ? trendEntryOf(record) : trendEntryFromIndexEntry(entry)));
    const newest = records[0];
    const latest = compactLatest(newest?.record ?? final);
    const updatedAt = new Date(deps.clock.nowMs()).toISOString();
    const merged = await mergeTopKey(deps, {
      topKey: RESULTS_TOP_KEY,
      budgetBytes: BYTE_BUDGET,
      buildOwned: (existingTop) => buildResultsKey({ existingTop, latest, trend, updatedAt, budget: BYTE_BUDGET }),
    });
    outcome = merged.ok ? 'ok' : merged.reason;
  } catch {
    outcome = 'write_failed';
  }

  // 8.4 Rewrite the Result_File with the outcome. If this fails, the first file stays.
  try {
    await writeResultFile(deps, { ...final, resultsKey: outcome });
  } catch {
    // resultsKey stays null in the first file; the exit code stays 0
  }
  return { exitCode: 0, line: { runId: final.runId, state: final.state, commit: final.commit } };
}

/**
 * Steps 5 to 7: checkout, install, build, list, replay. Fills `result` as it goes, so an unexpected
 * throw leaves what was done so far.
 * @param {Deps} realDeps
 * @param {{repoUrl: string, branch: string, cronTimeoutSec: number}} args
 * @param {number} deadlineMs
 * @param {{commit: string|null, levels: LevelEntry[], coverage: Coverage|null, failure: Failure|null}} result
 * @returns {Promise<void>}
 */
async function runStages(realDeps, args, deadlineMs, result) {
  const deps = { ...realDeps, spawn: withFailureLog(realDeps) };
  const checkout = await ensureCheckout(deps, { repoUrl: args.repoUrl, branch: args.branch, deadlineMs });
  if (!checkout.ok) {
    result.failure = checkout.failure;
    return;
  }
  result.commit = checkout.commit;
  const dir = checkout.dir;

  /**
   * Run one non-play step. Returns the process result, or sets result.failure and returns null.
   * @param {{label: string, stage: Failure['stage'], code: string, message: (exitCode: number) => string, command: string, args: string[], fixedMs: number}} step
   */
  async function step(step) {
    const timeoutMs = effectiveLimit(step.fixedMs, deps.clock.nowMs(), deadlineMs);
    const timedOut = () => failureOf(step.stage, 'step_timeout', `The step "${step.label}" did not finish in time.`, null, step.label);
    if (timeoutMs <= 0) {
      result.failure = timedOut();
      return null;
    }
    const r = await deps.spawn({ command: step.command, args: step.args, cwd: dir, shell: false, timeoutMs, label: step.label });
    if (r.timedOut) {
      result.failure = timedOut();
      return null;
    }
    if (r.startError !== null) {
      result.failure = failureOf(step.stage, step.code, `The step "${step.label}" could not be started.`, null);
      return null;
    }
    if (r.exitCode !== 0) {
      result.failure = failureOf(step.stage, step.code, step.message(/** @type {number} */ (r.exitCode)), r.exitCode);
      return null;
    }
    return r;
  }

  if (!(await step({ label: 'npm ci', stage: 'install', code: 'install_failed', message: (c) => `npm ci failed with exit code ${c}.`, command: 'npm', args: ['ci'], fixedMs: STEP_LIMITS_MS.npmCi }))) return;
  if (!(await step({ label: 'npm run build:play', stage: 'build', code: 'build_failed', message: (c) => `The Grimsheet build failed with exit code ${c}.`, command: 'npm', args: ['run', 'build:play'], fixedMs: STEP_LIMITS_MS.build }))) return;

  // The level list. A non-zero exit is list_failed, so it is read here rather than through `step`.
  const listLimit = effectiveLimit(STEP_LIMITS_MS.list, deps.clock.nowMs(), deadlineMs);
  const listLabel = 'node play.mjs --list';
  if (listLimit <= 0) {
    result.failure = failureOf('list', 'step_timeout', `The step "${listLabel}" did not finish in time.`, null, listLabel);
    return;
  }
  const listRun = await deps.spawn({ command: 'node', args: ['scripts/play.mjs', '--list'], cwd: dir, shell: false, timeoutMs: listLimit, label: listLabel });
  if (listRun.timedOut) {
    result.failure = failureOf('list', 'step_timeout', `The step "${listLabel}" did not finish in time.`, null, listLabel);
    return;
  }
  const parsed = parseLevelList(listRun.startError === null ? parseOrUndefined(listRun.stdout) : undefined, listRun.startError === null && typeof listRun.exitCode === 'number' ? listRun.exitCode : 1);
  if (!parsed.ok) {
    result.failure =
      parsed.reasonCode === 'empty_level_list'
        ? failureOf('list', 'empty_level_list', 'Grimsheet lists no levels.')
        : failureOf('list', 'list_failed', 'The level list could not be read or has an invalid level id.', typeof listRun.exitCode === 'number' && listRun.exitCode !== 0 ? listRun.exitCode : null);
    return;
  }

  // Step 6: replay.
  for (const id of parsed.ids) {
    if (deadlineMs - deps.clock.nowMs() <= 0) {
      const rest = parsed.ids.slice(result.levels.length);
      for (const left of rest) result.levels.push(levelEntryError(left, 'not_played'));
      result.failure = failureOf('replay', 'deadline_reached', 'The run reached its deadline before every level was played.');
      break;
    }
    const sol = await readSolution(deps, dir, id);
    if (sol.kind === 'no_file') {
      result.levels.push(levelEntryError(id, 'no_solution_file'));
      continue;
    }
    if (sol.kind === 'unreadable') {
      result.levels.push(levelEntryError(id, 'solution_unreadable'));
      continue;
    }
    const playLimit = effectiveLimit(STEP_LIMITS_MS.play, deps.clock.nowMs(), deadlineMs);
    const play = await deps.spawn({
      command: 'node',
      args: ['scripts/play.mjs', id, '--actions-file', sol.path],
      cwd: dir,
      shell: false,
      timeoutMs: playLimit,
      label: `play ${id}`,
    });
    const exitCode = play.timedOut || play.startError !== null ? null : play.exitCode;
    const verdict = deps.verifier(id, sol.solution, exitCode, play.timedOut ? undefined : parseOrUndefined(play.stdout));
    result.levels.push(levelEntryFromVerdict(verdict, id, play.timedOut));
  }

  const unlisted = await findUnlisted(deps, dir, parsed.ids);
  result.coverage = buildCoverage(result.levels, parsed.duplicates, unlisted);
}

/**
 * Run the replay once.
 * @param {Deps} deps
 * @param {{repoUrl: string, branch: string, cronTimeoutSec: number}} args
 * @returns {Promise<RunOutcome>}
 */
export async function runReplay(deps, args) {
  const startedAtMs = deps.clock.nowMs();
  const deadlineMs = runDeadline(startedAtMs, args.cronTimeoutSec);

  // Step 2: the Run_Lock_File, exclusive create, no waiting.
  await deps.fs.mkdir(deps.paths.dataFolder, { recursive: true }).catch(() => {});
  const lock = await acquireLock(deps, {
    path: path.join(deps.paths.dataFolder, '.run.lock'),
    staleAfterMs: args.cronTimeoutSec * 1000,
    waitMs: 0,
    retryEveryMs: 200,
  });
  if (!lock.ok) {
    return lock.reason === 'io_error' ? { exitCode: 4, line: { state: 'record_failed' } } : { exitCode: 3, line: { state: 'already_running' } };
  }

  try {
    // Step 3 and 4: previousLaunch, then the start of the record in one hold of the results lock.
    const previousLaunch = await readPreviousLaunch(deps);
    /** @type {RunRecord} */
    let started;
    try {
      const held = await withResultsLock(deps, () =>
        startRun(deps, { startedAtMs, cronTimeoutSec: args.cronTimeoutSec, repoUrl: args.repoUrl, branch: args.branch, previousLaunch }),
      );
      if (!held.ok) return { exitCode: 4, line: { state: 'record_failed' } };
      started = held.value.record;
    } catch {
      return { exitCode: 4, line: { state: 'record_failed' } };
    }

    // Steps 5 to 7.
    /** @type {{commit: string|null, levels: LevelEntry[], coverage: Coverage|null, failure: Failure|null}} */
    const result = { commit: null, levels: [], coverage: null, failure: null };
    try {
      await runStages(deps, args, deadlineMs, result);
    } catch {
      result.failure = failureOf('record', 'internal_error', 'The replay hit an internal fault.');
      if (result.coverage === null && result.levels.length > 0) result.coverage = buildCoverage(result.levels, [], []);
    }

    // Step 8.
    try {
      return await finish(deps, started, result);
    } catch {
      return { exitCode: 4, line: { state: 'record_failed' } };
    }
  } finally {
    await lock.release();
  }
}
