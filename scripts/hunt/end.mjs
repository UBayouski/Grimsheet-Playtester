// @ts-check
// Hunt_End: finishes the live Hunt and prints its summary. See .kiro/specs/exploit-hunt/design.md,
// "Hunt_End" printed body, Decisions 5 and 14, and "Finish (finishHunt)". The order of checks is the one of
// Hunt_Submit: call lock, resolveActiveHunt, argument check, finish. `exitStatus` is added by cli.mjs.
import { parseNoArgs } from './args.mjs';
import { finishHunt } from './finish.mjs';
import { resolveActiveHunt, withCallLock } from './hunt-store.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('./types.mjs').HuntResult} HuntResult */

/**
 * @param {string} reasonCode
 * @param {string} reason
 * @returns {HuntResult}
 */
const refusal = (reasonCode, reason) => ({ exit: 3, body: { outcome: 'refused', reasonCode, reason } });

/**
 * The body of the call, under the call lock.
 * @param {HuntDeps} deps
 * @param {string[]} argv
 * @returns {Promise<HuntResult>}
 */
async function endBody(deps, argv) {
  /** @type {Awaited<ReturnType<typeof resolveActiveHunt>>} */
  let resolved;
  try {
    resolved = await resolveActiveHunt(deps);
  } catch {
    // A fault while resolving the Hunt: nothing is finished or written. withCallLock releases the call lock.
    return { exit: 4, body: { outcome: 'error', reasonCode: 'hunt_internal_error', reason: 'Hunt_End failed unexpectedly. Nothing was changed.' } };
  }
  if (!resolved.ok) return refusal('no_active_hunt', 'No hunt is active.');
  if (!parseNoArgs(argv).ok) return refusal('bad_arguments', 'Hunt_End takes no arguments.');

  const hunt = resolved.hunt;
  const done = await finishHunt(deps, { hunt, record: hunt.record, state: 'complete' });
  const record = done.record;
  return {
    exit: 0,
    body: {
      state: record.state,
      huntId: hunt.huntId,
      commit: record.commit,
      summary: done.summary,
      levels: record.levels,
      finished: true,
    },
  };
}

/**
 * @param {HuntDeps} deps
 * @param {string[]} argv
 * @returns {Promise<HuntResult>}
 */
export async function runEnd(deps, argv) {
  const call = await withCallLock(deps, () => endBody(deps, argv));
  if (call.ok) return call.value;
  if (call.reason === 'io_error') {
    return { exit: 4, body: { outcome: 'error', reasonCode: 'hunt_record_unwritable', reason: 'The hunt record could not be written.' } };
  }
  return refusal('call_busy', 'Another hunt call is still running. Try again.');
}
