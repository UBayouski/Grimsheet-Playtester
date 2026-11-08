// @ts-check
// Hunt_Submit: one proposed action list in, one verified answer out. See .kiro/specs/exploit-hunt/design.md,
// "Hunt_Submit flow", "Order of checks", the Hunt_Submit printed bodies and "summarizePlay".
// The hunt computes no class and no outcome: the verifier (`deps.checkCandidate`) decides.
import { readSolution } from '../replay/levels.mjs';
import { STEP_LIMITS_MS, effectiveLimit } from '../replay/process.mjs';
import { parseSubmitArgs } from './args.mjs';
import { budgetLeft, decideSubmit, deadlineOf } from './budget.mjs';
import { buildFinding, sizeOf } from './findings.mjs';
import { finishHunt } from './finish.mjs';
import { chargeAttempt, chargeRefusal, noteReason, recordOutcome } from './hunt-record.mjs';
import { huntPaths, resolveActiveHunt, withCallLock, writeCandidateFile, writeHuntRecord } from './hunt-store.mjs';
import { FINDING_MAX_BYTES, HUNT_BUDGET, LEVEL_BUDGET, REFUSAL_BUDGET, TIME_BUDGET_SEC } from './limits.mjs';
import { publishFindings } from './publish.mjs';
import { printActions } from './tokens.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('./types.mjs').HuntResult} HuntResult */
/** @typedef {import('./types.mjs').HuntRecord} HuntRecord */
/** @typedef {import('./types.mjs').PlaySummary} PlaySummary */
/** @typedef {import('./types.mjs').ClaimedClass} ClaimedClass */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A short reading aid for the agent (Decision 21). Pure and defensive: never throws, null for anything
 * that is not a play result. Indexes count from 0.
 * @param {unknown} json
 * @returns {PlaySummary|null}
 */
export function summarizePlay(json) {
  try {
    if (!isObject(json)) return null;
    const steps = json.steps;
    const start = json.start;
    const final = json.final;
    if (!Array.isArray(steps) || !isObject(start) || !isObject(final)) return null;
    if (typeof final.status !== 'string' || typeof final.hp !== 'number') return null;
    let firstRefused = null;
    let firstStatusChange = null;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (firstRefused === null && step?.accepted === false) firstRefused = i;
      if (firstStatusChange === null && step?.status !== start.status) firstStatusChange = { step: i, status: step?.status };
    }
    return { steps: steps.length, finalStatus: final.status, finalHp: final.hp, firstRefused, firstStatusChange };
  } catch {
    return null;
  }
}

/** @param {string} text @returns {unknown} the parsed JSON, or undefined when the text is not JSON */
function parseOrUndefined(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * @param {string} reasonCode
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 * @returns {HuntResult}
 */
const refusal = (reasonCode, reason, extra = {}) => ({ exit: 3, body: { outcome: 'refused', reasonCode, reason, ...extra } });

/** @param {string} reasonCode @param {string} reason @returns {HuntResult} */
const unwritable = (reasonCode, reason) => ({ exit: 4, body: { outcome: 'error', reasonCode, reason } });

const REFUSAL_REASONS = {
  no_active_hunt: 'No hunt is active. Run Hunt_Begin first.',
  refusal_budget_spent: `The ${REFUSAL_BUDGET} refusals are used. The hunt is over.`,
  bad_arguments: 'The arguments could not be read.',
  unknown_level: 'The level is not in this hunt.',
  level_budget_spent: `The ${LEVEL_BUDGET} attempts for this level are used.`,
  total_budget_spent: `The ${HUNT_BUDGET} attempts are used. The hunt is over.`,
  time_budget_spent: `The ${TIME_BUDGET_SEC} seconds are used. The hunt is over.`,
};

/**
 * @param {HuntDeps} deps
 * @param {HuntRecord} record
 * @returns {Promise<boolean>} true when the record was written
 */
async function tryWrite(deps, record) {
  try {
    await writeHuntRecord(deps, record);
    return true;
  } catch {
    return false;
  }
}

/**
 * The body of the call, under the call lock.
 * @param {HuntDeps} deps
 * @param {string[]} argv
 * @returns {Promise<HuntResult>}
 */
async function submitBody(deps, argv) {
  const resolved = await resolveActiveHunt(deps);
  const parsed = resolved.ok ? parseSubmitArgs(argv) : /** @type {const} */ ({ ok: false, detail: 'no_active_hunt' });
  if (!resolved.ok) return refusal('no_active_hunt', REFUSAL_REASONS.no_active_hunt);

  const hunt = resolved.hunt;
  let record = hunt.record;
  const deadlineMs = deadlineOf(hunt.readyAtMs);
  /** @type {Record<string, number>} */
  const levelAttempts = {};
  for (const [id, counts] of Object.entries(record.levels)) levelAttempts[id] = counts.attempts;

  const decision = decideSubmit({
    active: true,
    refusals: record.refusals,
    attempts: record.attempts,
    levelAttempts,
    levels: Object.keys(record.levels),
    nowMs: deps.clock.nowMs(),
    deadlineMs,
    parsed,
  });

  if (decision.kind === 'refuse') {
    const code = decision.reasonCode;
    record = decision.charge === 'refusal' ? chargeRefusal(record, code) : noteReason(record, code);
    if (!(await tryWrite(deps, record))) return unwritable('hunt_record_unwritable', 'The hunt record could not be written.');
    const reason = REFUSAL_REASONS[code];
    if (decision.finish) {
      const done = await finishHunt(deps, { hunt, record, state: 'complete' });
      return refusal(code, reason, { finished: true, summary: done.summary });
    }
    const levelId = code === 'level_budget_spent' && parsed.ok ? parsed.levelId : null;
    /** @type {Record<string, unknown>} */
    const extra = {};
    if (decision.detail !== undefined) extra.detail = decision.detail;
    extra.left = budgetLeft(record, levelId, deps.clock.nowMs(), deadlineMs);
    extra.finished = false;
    return refusal(code, reason, extra);
  }

  // An Attempt. The charge is on disk before any process starts.
  const { levelId, claimedClass, actions } = decision;
  const attempt = record.attempts + 1;
  record = chargeAttempt(record, levelId);
  if (!(await tryWrite(deps, record))) return unwritable('hunt_record_unwritable', 'The hunt record could not be written.');
  const charged = record;
  let counted = false;

  try {
    let candidateFile;
    try {
      candidateFile = await writeCandidateFile(deps, hunt.huntId, attempt, levelId, claimedClass, actions);
    } catch {
      return unwritable('candidate_unwritable', 'The candidate file could not be written.');
    }

    const checkoutDir = huntPaths(deps).checkoutDir;
    const sol = await readSolution(deps, checkoutDir, levelId);

    /** @type {string} */
    let outcome;
    /** @type {string} */
    let reasonCode;
    /** @type {Record<string, unknown>} */
    let fields = {};
    /** @type {PlaySummary|null|undefined} */
    let play;

    if (sol.kind !== 'ok') {
      outcome = 'error';
      reasonCode = sol.kind === 'no_file' ? 'no_solution_file' : 'solution_unreadable';
      fields = {
        reason: sol.kind === 'no_file' ? 'The stored solution for this level is missing.' : 'The stored solution for this level could not be read.',
      };
    } else {
      const limit = effectiveLimit(STEP_LIMITS_MS.play, deps.clock.nowMs(), deadlineMs);
      const run = await deps.spawn({
        command: 'node',
        args: ['scripts/play.mjs', levelId, '--actions-file', candidateFile],
        cwd: checkoutDir,
        shell: false,
        timeoutMs: limit,
        label: `play ${levelId}`,
      });
      const exitCode = run.timedOut || run.startError !== null ? null : run.exitCode;
      const json = run.timedOut ? undefined : parseOrUndefined(run.stdout);
      play = summarizePlay(json);
      const res = /** @type {any} */ (deps.checkCandidate(levelId, sol.solution, claimedClass, actions, exitCode, json));

      if (res?.outcome === 'confirmed' || res?.outcome === 'rejected') {
        const measured = {
          won: res.won,
          inkSpent: res.inkSpent,
          minimalInk: res.minimalInk,
          editCount: res.editCount,
          newEditAddresses: res.newEditAddresses,
        };
        outcome = res.outcome;
        reasonCode = res.reasonCode;
        fields = { reason: res.reason, ...measured };
        if (res.outcome === 'confirmed') {
          const finding = buildFinding({
            huntId: hunt.huntId,
            attempt,
            commit: /** @type {string} */ (record.commit),
            foundAt: new Date(deps.clock.nowMs()).toISOString(),
            levelId,
            claimedClass,
            tokens: printActions(actions),
            checkOk: res,
          });
          const bytes = sizeOf(finding);
          if (bytes > FINDING_MAX_BYTES) {
            outcome = 'notRecorded';
            reasonCode = 'finding_too_large';
            fields = { reason: 'The finding is too large to record.', ...measured, bytes, maxBytes: FINDING_MAX_BYTES };
          } else {
            const pub = await publishFindings(deps, { record, finding, nowMs: deps.clock.nowMs() });
            record = pub.record;
            if (pub.duplicate) {
              outcome = 'duplicate';
              reasonCode = 'duplicate_finding';
              fields = { reason: 'An equal finding is already recorded.', ...measured, duplicateOf: pub.duplicateOf };
            } else {
              fields = { ...fields, findingId: finding.id };
              if (pub.findingsKey !== 'ok') fields.findingsKey = pub.findingsKey;
            }
          }
        }
      } else {
        outcome = 'error';
        reasonCode = typeof res?.reasonCode === 'string' ? res.reasonCode : 'malformed_check_result';
        fields = { reason: typeof res?.reason === 'string' ? res.reason : 'The verifier gave no usable answer.' };
        play = undefined;
      }
    }

    record = recordOutcome(record, levelId, /** @type {any} */ (outcome === 'notRecorded' ? 'notRecorded' : outcome), reasonCode);
    if (!(await tryWrite(deps, record))) return unwritable('hunt_record_unwritable', 'The hunt record could not be written.');
    counted = true;

    const { reason, ...rest } = fields;
    /** @type {Record<string, unknown>} */
    const body = { outcome: outcome === 'notRecorded' ? 'not_recorded' : outcome, reasonCode, reason, levelId, class: claimedClass, attempt, ...rest };
    if (play !== undefined) body.play = play;
    body.left = budgetLeft(record, levelId, deps.clock.nowMs(), deadlineMs);
    body.finished = false;
    return { exit: 0, body };
  } catch (e) {
    if (!counted) {
      try {
        await writeHuntRecord(deps, recordOutcome(charged, levelId, 'error', 'hunt_internal_error'));
      } catch {
        // the Attempt stays charged
      }
    }
    throw e;
  }
}

/**
 * @param {HuntDeps} deps
 * @param {string[]} argv
 * @returns {Promise<HuntResult>}
 */
export async function runSubmit(deps, argv) {
  const call = await withCallLock(deps, () => submitBody(deps, argv));
  if (call.ok) return call.value;
  if (call.reason === 'io_error') return unwritable('hunt_record_unwritable', 'The hunt record could not be written.');
  return refusal('call_busy', 'Another hunt call is still running. Try again.');
}
