// @ts-check
// Hunt_Info: prints the reduced description of one level and its stored solution. See
// .kiro/specs/exploit-hunt/design.md, "Hunt_Info flow". It takes no call lock, writes nothing and charges nothing.
import { readSolution } from '../replay/levels.mjs';
import { STEP_LIMITS_MS } from '../replay/process.mjs';
import { parseInfoArgs } from './args.mjs';
import { budgetLeft, deadlineOf } from './budget.mjs';
import { huntPaths, resolveActiveHunt } from './hunt-store.mjs';
import { reduceLevelInfo } from './level-info.mjs';
import { INFO_MAX_BYTES, TIME_BUDGET_SEC } from './limits.mjs';
import { tryPrintActions } from './tokens.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('./types.mjs').HuntResult} HuntResult */
/** @typedef {import('./types.mjs').Left} Left */

/**
 * A refusal: nothing is charged, nothing is written and the Hunt is not finished.
 * @param {string} reasonCode
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 * @returns {HuntResult}
 */
function refused(reasonCode, reason, extra = {}) {
  return { exit: 3, body: { outcome: 'refused', reasonCode, reason, ...extra } };
}

/**
 * What `play.mjs --level-info` printed.
 * @param {HuntDeps} deps
 * @param {string} checkoutDir
 * @param {string} levelId
 * @returns {Promise<unknown>} the parsed value, or null when the command failed or printed text that is not JSON
 */
async function runLevelInfo(deps, checkoutDir, levelId) {
  // A throw from deps.spawn is an internal fault and propagates; only text that is not JSON is "failed".
  const r = await deps.spawn({
    command: 'node',
    args: ['scripts/play.mjs', levelId, '--level-info'],
    cwd: checkoutDir,
    shell: false,
    timeoutMs: STEP_LIMITS_MS.list,
    label: 'node play.mjs --level-info',
  });
  if (r.timedOut || r.startError !== null || r.exitCode !== 0) return null;
  try {
    const value = JSON.parse(r.stdout);
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/**
 * The stored solution as the Hunt_Info `stored` value, or the reason it cannot be given.
 * @param {HuntDeps} deps
 * @param {string} checkoutDir
 * @param {string} levelId
 * @returns {Promise<{stored: Record<string, unknown>} | {storedReasonCode: 'no_solution_file'|'solution_unreadable'}>}
 */
async function storedOf(deps, checkoutDir, levelId) {
  const read = await readSolution(deps, checkoutDir, levelId);
  if (read.kind === 'no_file') return { storedReasonCode: 'no_solution_file' };
  if (read.kind === 'unreadable') return { storedReasonCode: 'solution_unreadable' };
  const sol = /** @type {any} */ (read.solution);
  const tokens = sol !== null && typeof sol === 'object' ? tryPrintActions(sol.actions) : null;
  if (tokens === null || typeof sol.minimalInk !== 'number') return { storedReasonCode: 'solution_unreadable' };
  return { stored: { minimalInk: sol.minimalInk, actionCount: tokens.length, actions: tokens.join(' ') } };
}

/**
 * @param {HuntDeps} deps
 * @param {string[]} argv
 * @returns {Promise<HuntResult>}
 */
export async function runInfo(deps, argv) {
  // resolveActiveHunt catches its own faults and answers "no active hunt"; it is called outside the try.
  const active = await resolveActiveHunt(deps);
  if (!active.ok) return refused('no_active_hunt', 'No hunt is active. Run Hunt_Begin first.');
  try {
    const { record, readyAtMs } = active.hunt;
    const deadlineMs = deadlineOf(readyAtMs);
    const left = (/** @type {string|null} */ levelId) => budgetLeft(record, levelId, deps.clock.nowMs(), deadlineMs);

    const parsed = parseInfoArgs(argv);
    if (!parsed.ok) {
      return refused('bad_arguments', 'The arguments could not be read.', { detail: parsed.detail, left: left(null), finished: false });
    }
    const levelId = parsed.levelId;
    if (!Object.hasOwn(record.levels, levelId)) {
      return refused('unknown_level', 'The level is not in this hunt.', { left: left(null), finished: false });
    }
    if (deps.clock.nowMs() >= deadlineMs) {
      return refused('time_budget_spent', `The ${TIME_BUDGET_SEC} seconds are used.`, { left: left(levelId), finished: false });
    }

    const checkoutDir = huntPaths(deps).checkoutDir;
    const raw = await runLevelInfo(deps, checkoutDir, levelId);
    const reduced = raw === null ? null : reduceLevelInfo(raw);
    if (reduced !== null) {
      const bytes = Buffer.byteLength(JSON.stringify(reduced), 'utf8');
      if (bytes > INFO_MAX_BYTES) {
        return refused('level_info_too_large', 'The level description is too large to print.', { bytes, maxBytes: INFO_MAX_BYTES });
      }
    }

    const stored = await storedOf(deps, checkoutDir, levelId);
    /** @type {Record<string, unknown>} */
    const body = { state: 'level', levelId, info: reduced };
    if (reduced === null) body.reasonCode = 'level_info_failed';
    if ('stored' in stored) body.stored = stored.stored;
    else {
      body.stored = null;
      body.storedReasonCode = stored.storedReasonCode;
    }
    body.left = left(levelId);
    return { exit: 0, body };
  } catch {
    // An unexpected fault after the Hunt is resolved: nothing was written, so report it as an internal fault (exit 4).
    return { exit: 4, body: { outcome: 'error', reasonCode: 'hunt_internal_error', reason: 'Hunt_Info failed unexpectedly. Nothing was changed.' } };
  }
}
