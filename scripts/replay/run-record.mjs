// @ts-check
// Pure functions that build and shape Run_Records, index entries, trend entries and the
// `playtesterResults` owned sub-keys. No I/O, no clock, no imports of other replay modules.

/** @typedef {import('./types.mjs').RunRecord} RunRecord */
/** @typedef {import('./types.mjs').LevelEntry} LevelEntry */
/** @typedef {import('./types.mjs').Coverage} Coverage */
/** @typedef {import('./types.mjs').Failure} Failure */
/** @typedef {import('./types.mjs').IndexEntry} IndexEntry */
/** @typedef {import('./types.mjs').TrendEntry} TrendEntry */
/** @typedef {import('./types.mjs').CompactRun} CompactRun */
/** @typedef {import('./types.mjs').ResultsKey} ResultsKey */

export const SCHEMA_VERSION = 1;
export const BYTE_BUDGET = 65536;
export const MAX_RUNS = 30;

/** @type {Record<string, string>} */
const LEVEL_REASONS = {
  no_solution_file: 'The listed level has no stored solution file.',
  solution_unreadable: 'The stored solution file could not be read or is not valid JSON.',
  not_played: 'The level was not played because the run reached its deadline.',
};

/**
 * Copy the listed keys that the source has, leaving absent keys out.
 * @param {any} source
 * @param {string[]} keys
 * @returns {any}
 */
function pick(source, keys) {
  /** @type {any} */
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  }
  return out;
}

/**
 * Size of the compact JSON text of a value in UTF-8 bytes.
 * @param {unknown} value
 * @returns {number}
 */
export function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * @param {any} verdict a ReplayOk or ReplayError from the verifier
 * @param {string} levelId
 * @param {boolean} timedOut
 * @returns {LevelEntry}
 */
export function levelEntryFromVerdict(verdict, levelId, timedOut) {
  /** @type {any} */
  let entry;
  if (verdict.colour === 'error') {
    entry = {
      levelId: typeof verdict.levelId === 'string' ? verdict.levelId : levelId,
      colour: 'error',
      reasonCode: verdict.reasonCode,
      reason: verdict.reason,
    };
  } else {
    entry = pick(verdict, ['levelId', 'colour', 'won', 'endHp', 'inkSpent', 'minimalInk', 'statusChangeIndex', 'refusedAt']);
  }
  if (timedOut === true) entry.timedOut = true;
  return entry;
}

/**
 * @param {string} levelId
 * @param {'no_solution_file'|'solution_unreadable'|'not_played'} reasonCode
 * @returns {LevelEntry}
 */
export function levelEntryError(levelId, reasonCode) {
  return { levelId, colour: 'error', reasonCode, reason: LEVEL_REASONS[reasonCode] };
}

/**
 * @param {LevelEntry[]} levels
 * @returns {{green: number, amber: number, red: number, error: number}}
 */
export function countColours(levels) {
  const counts = { green: 0, amber: 0, red: 0, error: 0 };
  for (const level of levels) {
    if (level.colour in counts) counts[level.colour] += 1;
  }
  return counts;
}

/**
 * @param {{runId: string, counter: number, startedAt: string, repoUrl: string, branch: string, previousLaunch: RunRecord['previousLaunch']}} params
 * @returns {RunRecord}
 */
export function newRunRecord({ runId, counter, startedAt, repoUrl, branch, previousLaunch }) {
  return {
    schemaVersion: 1,
    runId,
    counter,
    state: 'running',
    startedAt,
    finishedAt: null,
    repoUrl,
    branch,
    commit: null,
    levels: [],
    coverage: { listed: 0, played: 0, noSolution: 0, unreadable: 0, unlisted: 0, duplicateListedLevels: [], unlistedSolutions: [] },
    failure: null,
    previousLaunch,
    resultsKey: null,
    green: 0,
    amber: 0,
    red: 0,
    error: 0,
  };
}

/**
 * @param {RunRecord} record
 * @param {{state: RunRecord['state'], finishedAt: string|null, commit: string|null, levels: LevelEntry[], coverage: Coverage, failure: Failure|null}} fin
 * @returns {RunRecord}
 */
export function finalizeRecord(record, { state, finishedAt, commit, levels, coverage, failure }) {
  return { ...record, state, finishedAt, commit, levels, coverage, failure, ...countColours(levels) };
}

/**
 * @param {any} record a RunRecord
 * @returns {IndexEntry}
 */
export function indexEntryOf(record) {
  return pick(record, ['runId', 'counter', 'state', 'startedAt', 'finishedAt', 'commit', 'green', 'amber', 'red', 'error']);
}

/**
 * @param {any} record a RunRecord
 * @returns {TrendEntry}
 */
export function trendEntryOf(record) {
  /** @type {Record<string, string>} */
  const levels = {};
  for (const level of record.levels ?? []) levels[level.levelId] = level.colour;
  return { ...pick(record, ['runId', 'counter', 'state', 'startedAt', 'commit', 'green', 'amber', 'red', 'error']), levels };
}

/**
 * @param {any} entry an IndexEntry
 * @returns {TrendEntry}
 */
export function trendEntryFromIndexEntry(entry) {
  return { ...pick(entry, ['runId', 'counter', 'state', 'startedAt', 'commit', 'green', 'amber', 'red', 'error']), levels: {} };
}

/**
 * @param {any} record a RunRecord
 * @returns {CompactRun}
 */
export function compactLatest(record) {
  const compact = pick(record, ['runId', 'counter', 'state', 'startedAt', 'finishedAt', 'commit', 'repoUrl', 'branch', 'failure', 'coverage']);
  compact.levels = (record.levels ?? []).map((/** @type {any} */ level) => {
    const out = pick(level, ['levelId', 'colour', 'inkSpent', 'minimalInk', 'reasonCode']);
    if (level.timedOut === true) out.timedOut = true;
    return out;
  });
  return compact;
}

/**
 * Build the owned sub-keys of `playtesterResults`. The trend is sorted Newest first (on a copy) and
 * the oldest entries are dropped while the whole top-level value is above the budget, keeping at
 * least one. Foreign sub-keys of `existingTop` count toward the size.
 * @param {{existingTop: Record<string, unknown>, latest: CompactRun, trend: TrendEntry[], updatedAt: string, budget: number}} params
 * @returns {{ok: true, owned: ResultsKey} | {ok: false}}
 */
export function buildResultsKey({ existingTop, latest, trend, updatedAt, budget }) {
  const kept = [...trend].sort((a, b) => b.counter - a.counter);
  /** @param {TrendEntry[]} t @returns {ResultsKey} */
  const ownedOf = (t) => ({ schemaVersion: 1, updatedAt, latest, trend: t });
  while (kept.length > 1 && byteLength({ ...existingTop, ...ownedOf(kept) }) > budget) kept.pop();
  const owned = ownedOf(kept);
  if (byteLength({ ...existingTop, ...owned }) > budget) return { ok: false };
  return { ok: true, owned };
}
