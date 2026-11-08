// @ts-check
// Pure builders for the Hunt_Record (Requirement 11). No I/O. Every function returns a new object.
import { HUNT_BUDGET, LEVEL_BUDGET, LOCK_AGE_SEC, REFUSAL_BUDGET, TIME_BUDGET_SEC } from './limits.mjs';

/** @typedef {import('./types.mjs').HuntRecord} HuntRecord */
/** @typedef {import('./types.mjs').LevelCounts} LevelCounts */
/** @typedef {import('./types.mjs').HuntState} HuntState */
/** @typedef {'confirmed'|'rejected'|'error'|'duplicate'|'notRecorded'} Outcome */
/** @typedef {{attempts: number, confirmed: number, rejected: number, error: number, duplicate: number, notRecorded: number}} HuntCounts */

export const HUNT_RECORD_PATTERN = /^hunt-\d{8}T\d{6}Z\.json$/;

const FINAL_STATES = ['complete', 'failed', 'cut-short'];

/** @param {number} ms @returns {string} e.g. hunt-20261108T110312Z */
export function huntIdOf(ms) {
  const iso = new Date(ms).toISOString(); // 2026-11-08T11:03:12.481Z
  return `hunt-${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** @returns {LevelCounts} */
function zeroCounts() {
  return { attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 };
}

/** Deep copy of a record (plain JSON data only). @param {HuntRecord} record @returns {HuntRecord} */
function copy(record) {
  return structuredClone(record);
}

/** @param {HuntRecord} record */
function isFinal(record) {
  return FINAL_STATES.includes(record.state);
}

/** @param {Record<string, number>} codes @param {string} code */
function bump(codes, code) {
  codes[code] = (codes[code] ?? 0) + 1;
}

/** @param {{huntId: string, startedAt: string, repoUrl: string, branch: string}} init @returns {HuntRecord} */
export function newHuntRecord({ huntId, startedAt, repoUrl, branch }) {
  return {
    schemaVersion: 1,
    huntId,
    state: 'running',
    startedAt,
    readyAt: null,
    finishedAt: null,
    repoUrl,
    branch,
    commit: null,
    budget: { perLevel: LEVEL_BUDGET, total: HUNT_BUDGET, seconds: TIME_BUDGET_SEC, refusals: REFUSAL_BUDGET },
    levelsSkipped: 0,
    attempts: 0,
    refusals: 0,
    levels: {},
    reasonCodes: {},
    findingsKey: null,
    pendingFindings: [],
    failure: null,
  };
}

/**
 * @param {HuntRecord} record
 * @param {{readyAt: string, commit: string, levels: string[], levelsSkipped: number}} ready
 * @returns {HuntRecord}
 */
export function readyRecord(record, { readyAt, commit, levels, levelsSkipped }) {
  const next = copy(record);
  next.readyAt = readyAt;
  next.commit = commit;
  next.levelsSkipped = levelsSkipped;
  /** @type {Record<string, LevelCounts>} */
  const map = {};
  for (const id of levels) map[id] = zeroCounts();
  next.levels = map;
  return next;
}

/** @param {HuntRecord} record @param {string} levelId @returns {HuntRecord} */
export function chargeAttempt(record, levelId) {
  const next = copy(record);
  next.attempts += 1;
  const level = next.levels[levelId] ?? zeroCounts();
  level.attempts += 1;
  next.levels[levelId] = level;
  return next;
}

/** @param {HuntRecord} record @param {string} reasonCode @returns {HuntRecord} */
export function chargeRefusal(record, reasonCode) {
  const next = copy(record);
  next.refusals += 1;
  bump(next.reasonCodes, reasonCode);
  return next;
}

/** @param {HuntRecord} record @param {string} reasonCode @returns {HuntRecord} */
export function noteReason(record, reasonCode) {
  const next = copy(record);
  bump(next.reasonCodes, reasonCode);
  return next;
}

/**
 * Count the outcome of an Attempt that was charged before. The total `attempts` is not touched.
 * @param {HuntRecord} record @param {string} levelId @param {Outcome} outcome @param {string} reasonCode
 * @returns {HuntRecord}
 */
export function recordOutcome(record, levelId, outcome, reasonCode) {
  const next = copy(record);
  const level = next.levels[levelId] ?? zeroCounts();
  level[outcome] += 1;
  next.levels[levelId] = level;
  bump(next.reasonCodes, reasonCode);
  return next;
}

/**
 * @param {HuntRecord} record
 * @param {{state: HuntState, finishedAt: string|null, failure: HuntRecord['failure']}} end
 * @returns {HuntRecord}
 */
export function finishRecord(record, { state, finishedAt, failure }) {
  const next = copy(record);
  if (isFinal(next)) return next;
  next.state = state;
  next.finishedAt = finishedAt;
  next.failure = failure;
  return next;
}

/** @param {HuntRecord} record @param {{finishedAt: string, failure: NonNullable<HuntRecord['failure']>}} end @returns {HuntRecord} */
export function failRecord(record, { finishedAt, failure }) {
  return finishRecord(record, { state: 'failed', finishedAt, failure });
}

/**
 * A running record whose age (from startedAt) is more than LOCK_AGE_SEC becomes cut-short.
 * finishedAt stays as it is (null for a running record).
 * @param {HuntRecord} record @param {number} nowMs @returns {HuntRecord}
 */
export function markCutShort(record, nowMs) {
  const next = copy(record);
  if (next.state !== 'running') return next;
  const startedMs = Date.parse(next.startedAt);
  if (Number.isNaN(startedMs)) return next;
  if (nowMs - startedMs > LOCK_AGE_SEC * 1000) next.state = 'cut-short';
  return next;
}

/**
 * Totals over the levels. `attempts` is the sum of the five outcome counts.
 * @param {HuntRecord} record @returns {HuntCounts}
 */
export function countsOf(record) {
  const total = { confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 };
  for (const level of Object.values(record.levels)) {
    total.confirmed += level.confirmed;
    total.rejected += level.rejected;
    total.error += level.error;
    total.duplicate += level.duplicate;
    total.notRecorded += level.notRecorded;
  }
  const attempts = total.confirmed + total.rejected + total.error + total.duplicate + total.notRecorded;
  return { attempts, ...total };
}

/**
 * The totals plus the whole seconds used since readyAt (0 while not ready, never negative).
 * @param {HuntRecord} record @param {number} nowMs @returns {HuntCounts & {seconds: number}}
 */
export function summaryOf(record, nowMs) {
  const readyMs = record.readyAt === null ? NaN : Date.parse(record.readyAt);
  const seconds = Number.isNaN(readyMs) ? 0 : Math.max(0, Math.floor((nowMs - readyMs) / 1000));
  return { ...countsOf(record), seconds };
}
