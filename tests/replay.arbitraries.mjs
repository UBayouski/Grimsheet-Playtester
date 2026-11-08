// @ts-check
// fast-check arbitraries for the replay-runner tests (see .kiro/specs/replay-runner/design.md, "Arbitraries").
// Valid inputs are built by construction, never filtered with `fc.pre`. This file imports no replay module,
// so it works before those modules exist; the small helpers it needs are written out here.
import * as fc from 'fast-check';

export const RUN_STATES = ['running', 'complete', 'failed', 'cut-short'];

/** Valid level ids (they match ^[a-z0-9][a-z0-9-]*$). */
export const VALID_LEVEL_POOL = [
  '01-the-corridor',
  '02-the-chaser',
  '03-the-locked-crypt',
  '04-the-trap-row',
  '05-the-lich',
  '06-the-vault',
  'x1',
  'a-b-c',
];

/** Ids that do not match the pattern, or are not strings. */
export const INVALID_LEVEL_POOL = ['..', 'a/b', 'a\\b', 'has space', 'Upper', '', '-leading', 'a.b', 'caf\u00e9'];

/** Runner reason codes of a Level_Entry. */
export const RUNNER_LEVEL_CODES = ['no_solution_file', 'solution_unreadable', 'not_played'];

/** Verifier reason codes that can appear in a Level_Entry of colour error. */
export const VERIFIER_CODES = ['bad_input', 'play_failed', 'malformed_play_result', 'level_mismatch', 'malformed_solution', 'replay_mismatch', 'internal_error'];

const BASE_MS = Date.UTC(2026, 10, 1, 0, 0, 0);
const FORTY_DAYS_MS = 40 * 24 * 3600 * 1000;

/** @param {number} counter @returns {string} */
function runIdFor(counter) {
  return `run-${String(counter).padStart(6, '0')}`;
}

/** @param {number} offsetMs @returns {string} */
function isoAt(offsetMs) {
  return new Date(BASE_MS + offsetMs).toISOString();
}

/** 40 hex characters (a commit hash). @type {fc.Arbitrary<string>} */
const arbCommit = fc.stringMatching(/^[0-9a-f]{40}$/);

/** @type {fc.Arbitrary<number>} */
const arbCount = fc.nat({ max: 8 });

/**
 * One Index_Entry: counter 1 to 200, runId from the counter, one of the four states.
 * @type {fc.Arbitrary<any>}
 */
export const arbIndexEntry = fc
  .record({
    counter: fc.integer({ min: 1, max: 200 }),
    state: fc.constantFrom(...RUN_STATES),
    startOffset: fc.integer({ min: 0, max: FORTY_DAYS_MS }),
    durationMs: fc.integer({ min: 0, max: 900000 }),
    commit: fc.option(arbCommit, { nil: null }),
    green: arbCount,
    amber: arbCount,
    red: arbCount,
    error: arbCount,
  })
  .map((g) => ({
    runId: runIdFor(g.counter),
    counter: g.counter,
    state: g.state,
    startedAt: isoAt(g.startOffset),
    finishedAt: g.state === 'complete' || g.state === 'failed' ? isoAt(g.startOffset + g.durationMs) : null,
    commit: g.commit,
    green: g.green,
    amber: g.amber,
    red: g.red,
    error: g.error,
  }));

/**
 * One Level_Entry: a ReplayOk shape, or an error entry with a runner or verifier code (`timedOut` sometimes).
 * @type {fc.Arbitrary<any>}
 */
export const arbLevelEntry = fc.oneof(
  fc
    .record({
      levelId: fc.constantFrom(...VALID_LEVEL_POOL),
      colour: fc.constantFrom('green', 'amber', 'red'),
      endHp: fc.nat({ max: 5 }),
      inkSpent: fc.nat({ max: 5 }),
      minimalInk: fc.nat({ max: 5 }),
      statusChangeIndex: fc.option(fc.nat({ max: 20 }), { nil: null }),
      refusedAt: fc.option(fc.nat({ max: 20 }), { nil: null }),
    })
    .map((g) => ({
      levelId: g.levelId,
      colour: g.colour,
      won: g.colour !== 'red',
      endHp: g.endHp,
      inkSpent: g.inkSpent,
      minimalInk: g.minimalInk,
      statusChangeIndex: g.statusChangeIndex,
      refusedAt: g.refusedAt,
    })),
  fc
    .record({
      levelId: fc.constantFrom(...VALID_LEVEL_POOL),
      reasonCode: fc.constantFrom(...RUNNER_LEVEL_CODES, ...VERIFIER_CODES),
      reason: fc.string({ maxLength: 60 }),
      timedOut: fc.boolean(),
    })
    .map((g) => {
      /** @type {any} */
      const entry = { levelId: g.levelId, colour: 'error', reasonCode: g.reasonCode, reason: g.reason };
      if (g.timedOut) entry.timedOut = true;
      return entry;
    }),
);

/**
 * Counts per colour, written out here so this file needs no replay module.
 * @param {any[]} levels
 */
function coloursOf(levels) {
  const counts = { green: 0, amber: 0, red: 0, error: 0 };
  for (const e of levels) counts[/** @type {'green'|'amber'|'red'|'error'} */ (e.colour)] += 1;
  return counts;
}

/**
 * A Run_Record built from `arbLevelEntry` lists with consistent counts and coverage.
 * @type {fc.Arbitrary<any>}
 */
export const arbRunRecord = fc
  .record({
    counter: fc.integer({ min: 1, max: 200 }),
    state: fc.constantFrom(...RUN_STATES),
    startOffset: fc.integer({ min: 0, max: FORTY_DAYS_MS }),
    durationMs: fc.integer({ min: 0, max: 900000 }),
    commit: fc.option(arbCommit, { nil: null }),
    levels: fc.uniqueArray(arbLevelEntry, { selector: (e) => e.levelId, maxLength: 8 }),
    unlistedSolutions: fc.array(fc.constantFrom('99-old-level', 'zz-extra', 'old-one'), { maxLength: 3 }),
    duplicateListedLevels: fc.array(fc.constantFrom(...VALID_LEVEL_POOL), { maxLength: 2 }),
    failureStage: fc.constantFrom('checkout', 'install', 'build', 'list', 'replay', 'record'),
    failureCode: fc.constantFrom('git_failed', 'install_failed', 'build_failed', 'list_failed', 'step_timeout', 'deadline_reached', 'internal_error'),
    failureMessage: fc.string({ maxLength: 80 }),
    failureExit: fc.option(fc.integer({ min: 1, max: 255 }), { nil: null }),
    previousLaunch: fc.option(
      fc.record({
        outcome: fc.constantFrom('child-exited', 'spawn-failed', 'killed-by-launcher'),
        finishedAt: fc.option(fc.integer({ min: 0, max: FORTY_DAYS_MS }).map(isoAt), { nil: null }),
      }),
      { nil: null },
    ),
    resultsKey: fc.option(fc.constantFrom('ok', 'too_large', 'config_unreadable', 'lock_timeout', 'write_failed'), { nil: null }),
    repoUrl: fc.constantFrom('https://github.com/UBayouski/Grimsheet', 'https://example.com/other/repo'),
    branch: fc.constantFrom('main', 'dev'),
  })
  .map((g) => {
    const colours = coloursOf(g.levels);
    const noSolution = g.levels.filter((/** @type {any} */ e) => e.reasonCode === 'no_solution_file').length;
    const unreadable = g.levels.filter((/** @type {any} */ e) => e.reasonCode === 'solution_unreadable').length;
    const notPlayed = g.levels.filter((/** @type {any} */ e) => e.reasonCode === 'not_played').length;
    /** @type {any} */
    const failure =
      g.state === 'failed'
        ? { stage: g.failureStage, reasonCode: g.failureCode, message: g.failureMessage, exitCode: g.failureExit }
        : null;
    if (failure && failure.reasonCode === 'step_timeout') failure.step = 'npm ci';
    return {
      schemaVersion: 1,
      runId: runIdFor(g.counter),
      counter: g.counter,
      state: g.state,
      startedAt: isoAt(g.startOffset),
      finishedAt: g.state === 'complete' || g.state === 'failed' ? isoAt(g.startOffset + g.durationMs) : null,
      repoUrl: g.repoUrl,
      branch: g.branch,
      commit: g.commit,
      levels: g.levels,
      coverage: {
        listed: g.levels.length,
        played: g.levels.length - noSolution - unreadable - notPlayed,
        noSolution,
        unreadable,
        unlisted: g.unlistedSolutions.length,
        duplicateListedLevels: g.duplicateListedLevels,
        unlistedSolutions: g.unlistedSolutions,
      },
      failure,
      previousLaunch: g.previousLaunch,
      resultsKey: g.state === 'running' ? null : g.resultsKey,
      green: colours.green,
      amber: colours.amber,
      red: colours.red,
      error: colours.error,
    };
  });

/**
 * @param {any} record
 * @param {number} counter
 * @returns {any} a copy with the counter and the run id replaced
 */
function withCounter(record, counter) {
  return { ...record, counter, runId: runIdFor(counter) };
}

/**
 * 0 to 60 records with strictly increasing counters (oldest first), to exercise eviction and the budget.
 * @type {fc.Arbitrary<any[]>}
 */
export const arbRunHistory = fc
  .tuple(fc.array(arbRunRecord, { minLength: 0, maxLength: 60 }), fc.integer({ min: 1, max: 20 }))
  .map(([records, first]) => records.map((r, i) => withCounter(r, first + i)));

/**
 * The size-stress variant: long unlisted-solution lists, long messages and long level ids in some of the
 * records, so that the Results_Key can exceed the Byte_Budget and the trend must be trimmed.
 * @type {fc.Arbitrary<any[]>}
 */
export const arbRunHistoryStress = fc
  .tuple(
    fc.array(
      fc.tuple(arbRunRecord, fc.record({ count: fc.integer({ min: 0, max: 1800 }), idLength: fc.integer({ min: 10, max: 60 }), messageLength: fc.integer({ min: 0, max: 600 }) })),
      { minLength: 1, maxLength: 45 },
    ),
    fc.integer({ min: 1, max: 20 }),
  )
  .map(([pairs, first]) =>
    pairs.map(([record, stress], i) => {
      const unlistedSolutions = Array.from({ length: stress.count }, (_, k) => `old-level-${k}-`.padEnd(stress.idLength, 'x'));
      const failure = record.failure ? { ...record.failure, message: 'm'.repeat(stress.messageLength) } : null;
      const longLevels = record.levels.map((/** @type {any} */ e) => ({ ...e, levelId: `${e.levelId}-`.padEnd(Math.max(stress.idLength, e.levelId.length), 'x') }));
      return withCounter(
        { ...record, levels: longLevels, failure, coverage: { ...record.coverage, unlisted: unlistedSolutions.length, unlistedSolutions } },
        first + i,
      );
    }),
  );

/** A JSON value that survives a stringify and parse unchanged (no -0). @type {fc.Arbitrary<any>} */
const arbJson = fc.jsonValue({ maxDepth: 2 }).map((v) => JSON.parse(JSON.stringify(v)));

/** Short lower-case keys; none can be `playtesterResults`. @type {fc.Arbitrary<string>} */
const arbKey = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

/**
 * A `config.json` object: random foreign keys and, sometimes, an existing `playtesterResults` holding
 * `findings` and an unknown sub-key (and, rarely, a `findings` so large that nothing fits).
 * @type {fc.Arbitrary<Record<string, any>>}
 */
export const arbConfig = fc
  .record({
    foreign: fc.dictionary(arbKey, arbJson, { maxKeys: 5 }),
    mode: fc.constantFrom('none', 'none', 'with-findings', 'with-findings', 'old-results-only', 'big-findings'),
    findings: fc.array(fc.string({ maxLength: 40 }), { maxLength: 5 }),
    unknown: arbJson,
    bigLength: fc.integer({ min: 40000, max: 70000 }),
  })
  .map((g) => {
    /** @type {Record<string, any>} */
    const config = { ...g.foreign };
    if (g.mode === 'with-findings') {
      config.playtesterResults = { schemaVersion: 0, updatedAt: 'old', latest: { stale: true }, trend: [], findings: g.findings, mystery: g.unknown };
    } else if (g.mode === 'old-results-only') {
      config.playtesterResults = { schemaVersion: 0, updatedAt: 'old', latest: null, trend: [] };
    } else if (g.mode === 'big-findings') {
      config.playtesterResults = { findings: ['f'.repeat(g.bigLength)] };
    }
    return config;
  });

/**
 * A level list (output of --list): 0 to 8 ids from a valid and an invalid pool, with duplicates.
 * @type {fc.Arbitrary<unknown[]>}
 */
export const arbLevelList = fc.array(
  fc.oneof({ weight: 5, arbitrary: fc.constantFrom(...VALID_LEVEL_POOL) }, { weight: 1, arbitrary: fc.constantFrom(...INVALID_LEVEL_POOL) }),
  { maxLength: 8 },
);

/**
 * A level list with valid ids only (duplicates allowed), for properties about coverage.
 * @type {fc.Arbitrary<string[]>}
 */
export const arbValidLevelList = fc.array(fc.constantFrom(...VALID_LEVEL_POOL), { maxLength: 8 });

/**
 * An id that must be refused: `..`, a path separator, a space, an upper-case letter, an empty string, a
 * leading dash, a string with any other bad character, or a value that is not a string.
 * Built by construction: a bad character is placed in an otherwise arbitrary string.
 * @type {fc.Arbitrary<unknown>}
 */
export const arbInvalidLevelId = fc.oneof(
  fc.constantFrom('..', '/', '\\', ' ', 'a/b', 'a\\b', 'a b', 'Upper', 'A', '', '.', '_x'),
  fc
    .tuple(fc.constantFrom('..', '/', '\\', ' ', 'A', 'Z', '.', '_', '\u00e9', '\t', ':'), fc.string({ maxLength: 6 }), fc.string({ maxLength: 6 }))
    .map(([bad, before, after]) => before + bad + after),
  fc.string({ maxLength: 6 }).map((s) => `-${s}`),
  fc.constantFrom(null, undefined, 5, true, {}, [], ['a']),
);
