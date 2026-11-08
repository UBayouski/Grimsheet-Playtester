// @ts-check
// Pure budget logic of the exploit hunt: the order of checks for a submit and the "what is left" helper.
import { HUNT_BUDGET, LEVEL_BUDGET, REFUSAL_BUDGET, TIME_BUDGET_SEC } from './limits.mjs';

/** @typedef {import('./types.mjs').SubmitDecision} SubmitDecision */
/** @typedef {import('./types.mjs').Left} Left */
/** @typedef {import('./types.mjs').HuntRecord} HuntRecord */

/**
 * The seven checks of Requirement 9, criterion 10, in order. The first failing check decides;
 * there is one reason code per call.
 * @param {{active: boolean, refusals: number, attempts: number, levelAttempts: Record<string, number>,
 *          levels: string[], nowMs: number, deadlineMs: number,
 *          parsed: ReturnType<typeof import('./args.mjs').parseSubmitArgs>}} state
 * @returns {SubmitDecision}
 */
export function decideSubmit(state) {
  if (!state.active) {
    return { kind: 'refuse', reasonCode: 'no_active_hunt', charge: 'none', finish: false };
  }
  if (state.refusals >= REFUSAL_BUDGET) {
    return { kind: 'refuse', reasonCode: 'refusal_budget_spent', charge: 'none', finish: true };
  }
  const parsed = state.parsed;
  if (!parsed.ok) {
    return { kind: 'refuse', reasonCode: 'bad_arguments', charge: 'refusal', finish: false, detail: parsed.detail };
  }
  if (!state.levels.includes(parsed.levelId)) {
    return { kind: 'refuse', reasonCode: 'unknown_level', charge: 'refusal', finish: false };
  }
  const used = Object.hasOwn(state.levelAttempts, parsed.levelId) ? state.levelAttempts[parsed.levelId] : 0;
  if (used >= LEVEL_BUDGET) {
    return { kind: 'refuse', reasonCode: 'level_budget_spent', charge: 'refusal', finish: false };
  }
  if (state.attempts >= HUNT_BUDGET) {
    return { kind: 'refuse', reasonCode: 'total_budget_spent', charge: 'none', finish: true };
  }
  if (state.nowMs >= state.deadlineMs) {
    return { kind: 'refuse', reasonCode: 'time_budget_spent', charge: 'none', finish: true };
  }
  // parseSubmitArgs types claimedClass as string but only accepts members of CLASSES.
  const claimedClass = /** @type {import('./types.mjs').ClaimedClass} */ (parsed.claimedClass);
  return { kind: 'attempt', levelId: parsed.levelId, claimedClass, actions: parsed.actions };
}

/**
 * What is left of each budget. `level` is null when no level applies (null id, or a level not in the record).
 * Limits come from limits.mjs; seconds are rounded up and never negative.
 * @param {Pick<HuntRecord, 'attempts' | 'refusals' | 'levels'>} record
 * @param {string|null} levelId
 * @param {number} nowMs
 * @param {number} deadlineMs
 * @returns {Left}
 */
export function budgetLeft(record, levelId, nowMs, deadlineMs) {
  let level = null;
  if (levelId !== null && Object.hasOwn(record.levels, levelId)) {
    level = Math.max(0, LEVEL_BUDGET - record.levels[levelId].attempts);
  }
  return {
    level,
    total: Math.max(0, HUNT_BUDGET - record.attempts),
    refusals: Math.max(0, REFUSAL_BUDGET - record.refusals),
    seconds: Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)),
  };
}

/**
 * @param {number} readyAtMs
 * @returns {number} readyAtMs + TIME_BUDGET_SEC * 1000
 */
export function deadlineOf(readyAtMs) {
  return readyAtMs + TIME_BUDGET_SEC * 1000;
}
