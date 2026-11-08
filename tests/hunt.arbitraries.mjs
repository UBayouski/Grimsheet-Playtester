// @ts-check
// fast-check arbitraries for the exploit-hunt tests (see .kiro/specs/exploit-hunt/design.md, "Testing Strategy").
// Valid inputs are built by construction, never filtered with `fc.pre`. This file imports no hunt module, so it
// works before those modules exist: the small helpers it needs (the canonical token printer, time stamps) are
// written out here as plain functions. Values are plain data.
import * as fc from 'fast-check';

export const HUNT_STATES = ['running', 'complete', 'failed', 'cut-short'];
export const CLASS_NAMES = ['cheaper_win', 'free_win', 'unexpected_route'];
export const OUTCOMES = ['confirmed', 'rejected', 'error'];

/** Verifier reason codes by outcome (.kiro/specs/verifier/design.md, "Reason codes"). */
export const CONFIRMED_CODES = ['class_reproduced'];
export const REJECTED_CODES = ['not_won', 'no_ink_below_zero', 'minimal_ink_zero', 'not_cheaper', 'has_edits', 'no_new_cell'];
export const ERROR_CODES = [
  'bad_input',
  'play_failed',
  'malformed_play_result',
  'level_mismatch',
  'malformed_solution',
  'unknown_class',
  'malformed_candidate',
  'replay_mismatch',
  'internal_error',
];

/** Valid level ids (they match ^[a-z0-9][a-z0-9-]*$). */
export const LEVEL_POOL = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt', '04-the-trap-row', '05-the-lich', '06-the-vault', 'x1', 'a-b-c'];

const BASE_MS = Date.UTC(2026, 10, 1, 0, 0, 0);
const FORTY_DAYS_SEC = 40 * 24 * 3600;
const SAFE = /^[A-Za-z0-9._-]$/;

// ---------------------------------------------------------------------------------------------------------
// Local helpers (plain functions, no hunt imports)
// ---------------------------------------------------------------------------------------------------------

/**
 * Canonical percent form of a well-formed string: UTF-8 bytes, safe ASCII kept, others as % and upper-case hex.
 * @param {string} raw
 * @returns {string}
 */
export function encodeRawLocal(raw) {
  let out = '';
  for (const b of new TextEncoder().encode(raw)) {
    const c = String.fromCharCode(b);
    out += b < 128 && SAFE.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * The canonical token of an action.
 * @param {any} action
 * @returns {string}
 */
export function canonicalToken(action) {
  switch (action.kind) {
    case 'move':
      return action.dir;
    case 'wait':
      return 'wait';
    case 'undo':
      return 'undo';
    default:
      return `edit:${action.address}=${encodeRawLocal(action.raw)}`;
  }
}

/**
 * @param {any[]} actions
 * @returns {string[]}
 */
export function canonicalTokens(actions) {
  return actions.map(canonicalToken);
}

/** @param {number} ms @returns {string} ISO 8601 UTC with milliseconds and Z */
function isoAtMs(ms) {
  return new Date(ms).toISOString();
}

/** @param {number} ms @returns {string} `hunt-20261108T110312Z` */
export function huntIdOfMs(ms) {
  return `hunt-${new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

/** @param {number} n @returns {string} */
function attemptSuffix(n) {
  return String(n).padStart(3, '0');
}

// ---------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------

/**
 * An address as the token grammar has it: capital letters then digits, 2 to 6 characters in all
 * (LETTER+ DIGIT+ needs at least one of each, so 1 character cannot be a valid address).
 * @type {fc.Arbitrary<string>}
 */
export const arbAddress = fc
  .integer({ min: 2, max: 6 })
  .chain((len) =>
    fc
      .integer({ min: 1, max: len - 1 })
      .chain((letters) =>
        fc
          .tuple(
            fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), { minLength: letters, maxLength: letters }),
            fc.array(fc.constantFrom(...'0123456789'), { minLength: len - letters, maxLength: len - letters }),
          )
          .map(([l, d]) => l.join('') + d.join('')),
      ),
  );

/** A code point that is not a surrogate (well-formed Unicode). @type {fc.Arbitrary<string>} */
const arbCodePoint = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('%', '"', "'", ' ', '=', ':', '(', ')', ',', '<', '+', '\t', '\u00e9', '\u20ac', '\ud83d\ude00', '\u0000', '\u007f') },
  { weight: 4, arbitrary: fc.integer({ min: 0x20, max: 0x7e }).map((n) => String.fromCodePoint(n)) },
  { weight: 2, arbitrary: fc.constantFrom(...'ABCxyz019._-') },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 0x10ffff - 0x800 }).map((n) => String.fromCodePoint(n < 0xd800 ? n : n + 0x800)) },
);

/** UTF-8 byte length of a string. @param {string} s @returns {number} */
const utf8Len = (s) => new TextEncoder().encode(s).length;

/**
 * Keeps the leading code points whose UTF-8 bytes together fit in `maxBytes`. Used to build values within
 * the raw limit by construction (nothing is filtered out).
 * @param {string[]} cps
 * @param {number} maxBytes
 * @returns {string}
 */
function fitBytes(cps, maxBytes) {
  let used = 0;
  let out = '';
  for (const c of cps) {
    const n = utf8Len(c);
    if (used + n > maxBytes) break;
    used += n;
    out += c;
  }
  return out;
}

/** A well-formed code point of 2, 3 or 4 UTF-8 bytes (U+1F600 and friends are common). @type {fc.Arbitrary<string>} */
const arbMultiByteCodePoint = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('\u00e9', '\u20ac', '\ud83d\ude00') },
  { weight: 2, arbitrary: fc.constant('\ud83d\ude00') },
  { weight: 1, arbitrary: fc.integer({ min: 0x80, max: 0x7ff }).map((n) => String.fromCodePoint(n)) },
  { weight: 1, arbitrary: fc.integer({ min: 0x800, max: 0xfffd - 0x800 }).map((n) => String.fromCodePoint(n < 0xd800 ? n : n + 0x800)) },
  { weight: 1, arbitrary: fc.integer({ min: 0x10000, max: 0x10ffff }).map((n) => String.fromCodePoint(n)) },
);

/**
 * Multi-byte text of 30 to 40 UTF-8 bytes (15 to 40 code points are drawn, then cut to fit 40 bytes).
 * @type {fc.Arbitrary<string>}
 */
const arbRawNearLimit = fc.array(arbMultiByteCodePoint, { minLength: 15, maxLength: 40 }).map((cps) => fitBytes(cps, 40));

/** ASCII text of 36 to 40 bytes. @type {fc.Arbitrary<string>} */
const arbRawAsciiNear = fc
  .array(fc.integer({ min: 0x20, max: 0x7e }).map((n) => String.fromCharCode(n)), { minLength: 36, maxLength: 40 })
  .map((cs) => cs.join(''));

/**
 * Well-formed Unicode text of 0 to 40 UTF-8 bytes (may be empty). Always within the raw limit.
 * Weights: 4 general (mixed code points, cut to 40 bytes), 4 multi-byte of 30 to 40 bytes, 1 ASCII of 36 to 40 bytes.
 * @type {fc.Arbitrary<string>}
 */
export const arbRaw = fc.oneof(
  { weight: 4, arbitrary: fc.array(arbCodePoint, { maxLength: 40 }).map((cps) => fitBytes(cps, 40)) },
  { weight: 4, arbitrary: arbRawNearLimit },
  { weight: 1, arbitrary: arbRawAsciiNear },
);

/**
 * Well-formed text of 41 to 48 UTF-8 bytes, over the raw limit: multi-byte text (padded with `a` to the target
 * length) or ASCII text. For inputs that must be refused as `raw_too_long`.
 * @type {fc.Arbitrary<string>}
 */
export const arbRawOverLimit = fc.integer({ min: 41, max: 48 }).chain((target) =>
  fc.oneof(
    {
      weight: 3,
      arbitrary: fc.array(arbMultiByteCodePoint, { minLength: 25, maxLength: 40 }).map((cps) => {
        const base = fitBytes(cps, target);
        return base + 'a'.repeat(target - utf8Len(base));
      }),
    },
    {
      weight: 1,
      arbitrary: fc
        .array(fc.integer({ min: 0x20, max: 0x7e }).map((n) => String.fromCharCode(n)), { minLength: target, maxLength: target })
        .map((cs) => cs.join('')),
    },
  ),
);

/** @type {fc.Arbitrary<any>} */
const arbEdit = fc.record({ kind: fc.constant('edit'), address: arbAddress, raw: arbRaw });

/** @type {fc.Arbitrary<any>} */
const arbNonEdit = fc.oneof(
  fc.constantFrom('N', 'S', 'E', 'W').map((dir) => ({ kind: 'move', dir })),
  fc.constant({ kind: 'wait' }),
  fc.constant({ kind: 'undo' }),
);

/**
 * One action: a move, a wait, an undo or an edit.
 * @type {fc.Arbitrary<any>}
 */
export const arbAction = fc.oneof({ weight: 3, arbitrary: arbNonEdit }, { weight: 1, arbitrary: arbEdit });

/**
 * 1 to 40 actions with at most 4 edits. Built by construction: edits beyond the fourth become waits.
 * @type {fc.Arbitrary<any[]>}
 */
export const arbActionList = fc.array(arbAction, { minLength: 1, maxLength: 40 }).map((list) => {
  let edits = 0;
  return list.map((a) => {
    if (a.kind !== 'edit') return a;
    edits += 1;
    return edits <= 4 ? a : { kind: 'wait' };
  });
});

// ---------------------------------------------------------------------------------------------------------
// Argument vectors
// ---------------------------------------------------------------------------------------------------------

/** @type {fc.Arbitrary<string>} */
const arbTokenLike = fc.oneof(
  arbAction.map(canonicalToken),
  fc.constantFrom('N', 'S', 'E', 'W', 'wait', 'undo', 'n', 'Wait', 'EDIT:', 'edit:', 'edit:B14', 'edit:B14=', 'edit:b14=7', 'edit:B14==7', 'edit:B14=%E9', 'edit:B14=%4', 'edit:B14=%3d', 'edit:B14=%41', 'edit:1234567=7', 'edit:ABCDEFG1=7'),
  fc.tuple(arbAddress, arbRaw).map(([a, r]) => `edit:${a}=${r}`),
  // Properly encoded values: near the limit (30 to 40 bytes, accepted) and over it (41 to 48 bytes, raw_too_long).
  fc.tuple(arbAddress, arbRaw).map(([a, r]) => `edit:${a}=${encodeRawLocal(r)}`),
  fc.tuple(arbAddress, arbRawOverLimit).map(([a, r]) => `edit:${a}=${encodeRawLocal(r)}`),
  fc.tuple(arbAddress, arbRawOverLimit).map(([a, r]) => `edit:${a}=${encodeRawLocal(r)}`),
  fc.tuple(arbAddress, fc.array(fc.constantFrom(...'0123456789abcdefABCDEF%'), { maxLength: 30 })).map(([a, cs]) => `edit:${a}=${cs.join('')}`),
);

/** @type {fc.Arbitrary<unknown>} */
const arbArgvMember = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 20 }) },
  { weight: 5, arbitrary: arbTokenLike },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 2, arbitrary: fc.array(fc.constantFrom('a', ' ', '%', '2', '0', 'b'), { maxLength: 8 }).map((cs) => cs.join('')) },
  { weight: 1, arbitrary: fc.constantFrom(null, undefined, 5, true, {}, [], ['N'], Number.NaN) },
);

/**
 * Arguments as the parsers may receive them: arbitrary strings, token-like strings, empty strings, strings
 * with spaces or %, non-string members, and valid canonical lists with noise.
 * @type {fc.Arbitrary<unknown[]>}
 */
export const arbArgv = fc.oneof(
  { weight: 3, arbitrary: fc.array(arbArgvMember, { maxLength: 45 }) },
  { weight: 2, arbitrary: arbActionList.map(canonicalTokens) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(arbActionList, fc.array(arbArgvMember, { maxLength: 3 }))
      .map(([list, noise]) => [...canonicalTokens(list), ...noise]),
  },
);

// ---------------------------------------------------------------------------------------------------------
// Verifier results
// ---------------------------------------------------------------------------------------------------------

/** @type {fc.Arbitrary<string[]>} */
const arbNewAddresses = fc.array(arbAddress, { maxLength: 4 });

/**
 * A CheckResult: confirmed (reason class_reproduced, up to 4 new edit addresses), rejected or error with any
 * verifier reason code of the matching outcome.
 * @type {fc.Arbitrary<any>}
 */
export const arbCheckResult = fc.oneof(
  fc
    .record({
      levelId: fc.constantFrom(...LEVEL_POOL),
      claimedClass: fc.constantFrom(...CLASS_NAMES),
      won: fc.constant(true),
      inkSpent: fc.nat({ max: 5 }),
      minimalInk: fc.nat({ max: 5 }),
      editCount: fc.nat({ max: 4 }),
      newEditAddresses: arbNewAddresses,
    })
    .map((g) => ({ ...g, outcome: 'confirmed', reasonCode: 'class_reproduced', reason: 'The replay reproduces the claimed class.' })),
  fc
    .record({
      levelId: fc.constantFrom(...LEVEL_POOL),
      claimedClass: fc.constantFrom(...CLASS_NAMES),
      reasonCode: fc.constantFrom(...REJECTED_CODES),
      reason: fc.string({ maxLength: 60 }),
      won: fc.boolean(),
      inkSpent: fc.nat({ max: 5 }),
      minimalInk: fc.nat({ max: 5 }),
      editCount: fc.nat({ max: 4 }),
      newEditAddresses: arbNewAddresses,
    })
    .map((g) => ({ ...g, outcome: 'rejected' })),
  fc
    .record({
      levelId: fc.option(fc.constantFrom(...LEVEL_POOL), { nil: undefined }),
      claimedClass: fc.option(fc.oneof(fc.constantFrom(...CLASS_NAMES), fc.string({ maxLength: 8 })), { nil: undefined }),
      reasonCode: fc.constantFrom(...ERROR_CODES),
      reason: fc.string({ maxLength: 60 }),
    })
    .map((g) => {
      /** @type {any} */
      const e = { outcome: 'error', reasonCode: g.reasonCode, reason: g.reason };
      if (g.levelId !== undefined) e.levelId = g.levelId;
      if (g.claimedClass !== undefined) e.claimedClass = g.claimedClass;
      return e;
    }),
);

// ---------------------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------------------

/** 40 hex characters. @type {fc.Arbitrary<string>} */
const arbCommit = fc.stringMatching(/^[0-9a-f]{40}$/);

/** A hunt start in whole seconds inside a 40-day window. @type {fc.Arbitrary<number>} */
const arbHuntStartSec = fc.integer({ min: 0, max: FORTY_DAYS_SEC });

/** @type {fc.Arbitrary<number>} */
const arbMsInWindow = fc.integer({ min: 0, max: FORTY_DAYS_SEC * 1000 }).map((o) => BASE_MS + o);

/** A level id of 1 to 40 characters matching ^[a-z0-9][a-z0-9-]*$. @type {fc.Arbitrary<string>} */
const arbLevelId = fc.oneof(fc.constantFrom(...LEVEL_POOL), fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,39}$/));

/**
 * Builds a Finding from its parts; the result block is derived from the actions.
 * @param {{levelId:string, claimedClass:string, commit:string, huntMs:number, foundAtMs:number, attempt:number, actions:any[]}} p
 * @returns {any}
 */
function findingFrom(p) {
  const huntId = huntIdOfMs(p.huntMs);
  const edits = p.actions.filter((a) => a.kind === 'edit');
  return {
    id: `${huntId}-${attemptSuffix(p.attempt)}`,
    levelId: p.levelId,
    class: p.claimedClass,
    commit: p.commit,
    huntId,
    foundAt: isoAtMs(p.foundAtMs),
    actions: canonicalTokens(p.actions),
    result: {
      won: true,
      inkSpent: Math.max(0, edits.length - 1),
      minimalInk: edits.length + 1,
      editCount: edits.length,
      newEditAddresses: edits.slice(0, 4).map((e) => e.address),
      reasonCode: 'class_reproduced',
    },
  };
}

/** A small to ordinary Finding. @type {fc.Arbitrary<any>} */
const arbFindingOrdinary = fc
  .record({
    levelId: arbLevelId,
    claimedClass: fc.constantFrom(...CLASS_NAMES),
    commit: arbCommit,
    huntMs: arbHuntStartSec.map((s) => BASE_MS + s * 1000),
    foundAtMs: arbMsInWindow,
    attempt: fc.integer({ min: 1, max: 20 }),
    actions: arbActionList,
  })
  .map(findingFrom);

/** The smallest Finding: one move. @type {fc.Arbitrary<any>} */
const arbFindingTiny = fc
  .record({
    levelId: fc.constantFrom('x1', 'a-b-c'),
    claimedClass: fc.constantFrom(...CLASS_NAMES),
    huntMs: arbHuntStartSec.map((s) => BASE_MS + s * 1000),
    foundAtMs: arbMsInWindow,
    attempt: fc.integer({ min: 1, max: 20 }),
    dir: fc.constantFrom('N', 'S', 'E', 'W'),
  })
  .map((g) => findingFrom({ ...g, commit: '0'.repeat(40), actions: [{ kind: 'move', dir: g.dir }] }));

/** A character that percent-encodes to exactly three characters (ASCII, not safe). @type {fc.Arbitrary<string>} */
const arbThreeCharUnit = fc.constantFrom(' ', '"', '=', ':', '(', ')', ',', '+', '<', '>', '%', "'", '!', '#');

/** A 6-character address. @type {fc.Arbitrary<string>} */
const arbAddress6 = fc.integer({ min: 1, max: 5 }).chain((letters) =>
  fc
    .tuple(
      fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), { minLength: letters, maxLength: letters }),
      fc.array(fc.constantFrom(...'0123456789'), { minLength: 6 - letters, maxLength: 6 - letters }),
    )
    .map(([l, d]) => l.join('') + d.join('')),
);

/**
 * The worst case of the design's "Size calculation": levelId of 40 characters, class unexpected_route, 40 tokens
 * of which 4 are edits of 132 characters (6-character address, 40 bytes of raw at 3 encoded characters each) and
 * 36 are `wait` or `undo`, ink values of four digits, 4 new edit addresses of 6 characters. The tokens are
 * canonical printed tokens (upper-case hex, safe characters kept), so a test can compare them with a printer.
 * @type {fc.Arbitrary<any>}
 */
export const arbFindingWorstCase = fc
  .record({
    levelId: fc.stringMatching(/^[a-z0-9][a-z0-9-]{39}$/),
    commit: arbCommit,
    huntMs: arbHuntStartSec.map((s) => BASE_MS + s * 1000),
    foundAtMs: arbMsInWindow,
    attempt: fc.integer({ min: 1, max: 999 }),
    edits: fc.array(fc.record({ address: arbAddress6, raw: fc.array(arbThreeCharUnit, { minLength: 40, maxLength: 40 }).map((u) => u.join('')) }), { minLength: 4, maxLength: 4 }),
    others: fc.array(fc.constantFrom('wait', 'undo'), { minLength: 36, maxLength: 36 }),
    editSlots: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { minLength: 4, maxLength: 4 }),
    inkSpent: fc.integer({ min: 1000, max: 9999 }),
    minimalInk: fc.integer({ min: 1000, max: 9999 }),
  })
  .map((g) => {
    const actions = [];
    let nextEdit = 0;
    let nextOther = 0;
    for (let i = 0; i < 40; i += 1) {
      if (g.editSlots.includes(i)) {
        const e = g.edits[nextEdit];
        nextEdit += 1;
        actions.push({ kind: 'edit', address: e.address, raw: e.raw });
      } else {
        actions.push({ kind: g.others[nextOther] });
        nextOther += 1;
      }
    }
    const f = findingFrom({ levelId: g.levelId, claimedClass: 'unexpected_route', commit: g.commit, huntMs: g.huntMs, foundAtMs: g.foundAtMs, attempt: g.attempt, actions });
    f.result = {
      won: true,
      inkSpent: g.inkSpent,
      minimalInk: g.minimalInk,
      editCount: 4,
      newEditAddresses: g.edits.map((e) => e.address),
      reasonCode: 'class_reproduced',
    };
    return f;
  });

/**
 * A Finding from tiny to the worst case of the size calculation.
 * @type {fc.Arbitrary<any>}
 */
export const arbFinding = fc.oneof(
  { weight: 1, arbitrary: arbFindingTiny },
  { weight: 4, arbitrary: arbFindingOrdinary },
  { weight: 2, arbitrary: arbFindingWorstCase },
);

/**
 * 1 to 30 Findings that repeat the same `levelId`, class and tokens (drawn from a pool of 1 to 5), with
 * `foundAt` taken from a few shared values so equal `foundAt` is common. Ids are unique (index in the list).
 * @type {fc.Arbitrary<any[]>}
 */
export const arbFindingSequence = fc
  .tuple(
    fc.array(arbFinding, { minLength: 1, maxLength: 5 }),
    fc.array(fc.integer({ min: 0, max: 3 }).map((k) => BASE_MS + k * 60000), { minLength: 4, maxLength: 4 }),
    fc.array(fc.record({ pick: fc.nat({ max: 1000 }), time: fc.nat({ max: 3 }) }), { minLength: 1, maxLength: 30 }),
  )
  .map(([pool, times, picks]) =>
    picks.map((p, i) => {
      const base = pool[p.pick % pool.length];
      return { ...base, id: `${base.huntId}-${attemptSuffix(i + 1)}`, foundAt: isoAtMs(times[p.time % times.length]) };
    }),
  );

// ---------------------------------------------------------------------------------------------------------
// config.json
// ---------------------------------------------------------------------------------------------------------

/** A JSON value that survives a stringify and parse unchanged. @type {fc.Arbitrary<any>} */
const arbJson = fc.jsonValue({ maxDepth: 2 }).map((v) => JSON.parse(JSON.stringify(v)));

/** Short lower-case keys; none can be `playtesterResults`. @type {fc.Arbitrary<string>} */
const arbKey = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

/**
 * A `config.json` object: foreign keys and, sometimes, a `playtesterResults` with `latest`, `trend`, a
 * `findings` value (a well-formed one, a legacy array or garbage) and an unknown sub-key.
 * @type {fc.Arbitrary<Record<string, any>>}
 */
export const arbConfig = fc
  .record({
    foreign: fc.dictionary(arbKey, arbJson, { maxKeys: 5 }),
    mode: fc.constantFrom('none', 'results-only', 'with-findings', 'with-findings', 'legacy-findings', 'garbage-findings'),
    latest: fc.record({ runId: fc.constantFrom('run-000001', 'run-000002'), green: fc.nat({ max: 5 }), levels: fc.array(fc.record({ levelId: fc.constantFrom(...LEVEL_POOL), colour: fc.constantFrom('green', 'amber', 'red') }), { maxLength: 5 }) }),
    trend: fc.array(fc.record({ runId: fc.constantFrom('run-000001', 'run-000002', 'run-000003'), green: fc.nat({ max: 5 }), red: fc.nat({ max: 5 }) }), { maxLength: 6 }),
    items: fc.array(arbFinding, { maxLength: 4 }),
    legacy: fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }),
    garbage: fc.constantFrom(null, 'text', 7, true, {}, { items: 'no' }),
    unknown: arbJson,
    commit: fc.option(arbCommit, { nil: null }),
  })
  .map((g) => {
    /** @type {Record<string, any>} */
    const config = { ...g.foreign };
    if (g.mode === 'none') return config;
    /** @type {Record<string, any>} */
    const results = { schemaVersion: 1, updatedAt: '2026-11-01T00:00:00.000Z', latest: g.latest, trend: g.trend, mystery: g.unknown };
    if (g.mode === 'with-findings') {
      results.findings = {
        schemaVersion: 1,
        updatedAt: '2026-11-01T00:00:00.000Z',
        commit: g.commit,
        huntId: g.items.length > 0 ? g.items[0].huntId : null,
        counts: { attempts: g.items.length, confirmed: g.items.length, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 },
        items: g.items,
      };
    } else if (g.mode === 'legacy-findings') {
      results.findings = g.legacy;
    } else if (g.mode === 'garbage-findings') {
      results.findings = g.garbage;
    }
    config.playtesterResults = results;
    return config;
  });

// ---------------------------------------------------------------------------------------------------------
// Hunt records
// ---------------------------------------------------------------------------------------------------------

/** @type {fc.Arbitrary<any>} */
const arbLevelCounts = fc
  .record({
    confirmed: fc.nat({ max: 3 }),
    rejected: fc.nat({ max: 3 }),
    error: fc.nat({ max: 2 }),
    duplicate: fc.nat({ max: 2 }),
    notRecorded: fc.nat({ max: 1 }),
  })
  .map((c) => ({ attempts: c.confirmed + c.rejected + c.error + c.duplicate + c.notRecorded, ...c }));

/**
 * A Hunt_Record for a hunt that started `startSec` seconds into the window. Counts are consistent: the
 * record's `attempts` equals the sum over `levels`.
 * @param {number} startSec
 * @returns {fc.Arbitrary<any>}
 */
function arbHuntRecordAt(startSec) {
  const startMs = BASE_MS + startSec * 1000;
  return fc
    .record({
      state: fc.constantFrom(...HUNT_STATES),
      startMillis: fc.integer({ min: 0, max: 999 }),
      readyAfterMs: fc.integer({ min: 1000, max: 600000 }),
      durationMs: fc.integer({ min: 0, max: 2400000 }),
      commit: arbCommit,
      repoUrl: fc.constantFrom('https://github.com/UBayouski/Grimsheet', 'https://example.com/other/repo'),
      branch: fc.constantFrom('main', 'dev'),
      levelIds: fc.uniqueArray(fc.constantFrom(...LEVEL_POOL), { maxLength: 6 }),
      counts: fc.array(arbLevelCounts, { minLength: 6, maxLength: 6 }),
      refusals: fc.nat({ max: 12 }),
      reasonCodes: fc.dictionary(fc.constantFrom('class_reproduced', 'not_won', 'not_cheaper', 'bad_arguments', 'unknown_level', 'level_budget_spent', 'duplicate_finding'), fc.integer({ min: 1, max: 9 }), { maxKeys: 5 }),
      findingsKey: fc.option(fc.constantFrom('ok', 'lock_timeout', 'config_unreadable', 'too_large', 'write_failed'), { nil: null }),
      pending: fc.array(arbFindingOrdinary, { maxLength: 2 }),
      failureStage: fc.constantFrom('checkout', 'install', 'build', 'list', 'record'),
      failureCode: fc.constantFrom('git_failed', 'install_failed', 'build_failed', 'list_failed', 'step_timeout', 'internal_error'),
      failureMessage: fc.string({ maxLength: 60 }),
      failureExit: fc.option(fc.integer({ min: 1, max: 255 }), { nil: null }),
      levelsSkipped: fc.nat({ max: 3 }),
    })
    .map((g) => {
      const failed = g.state === 'failed';
      const started = startMs + g.startMillis;
      /** @type {Record<string, any>} */
      const levels = {};
      let attempts = 0;
      if (!failed) {
        g.levelIds.forEach((id, i) => {
          levels[id] = g.counts[i];
          attempts += g.counts[i].attempts;
        });
      }
      return {
        schemaVersion: 1,
        huntId: huntIdOfMs(startMs),
        state: g.state,
        startedAt: isoAtMs(started),
        readyAt: failed ? null : isoAtMs(started + g.readyAfterMs),
        finishedAt: g.state === 'complete' || failed ? isoAtMs(started + g.readyAfterMs + g.durationMs) : null,
        repoUrl: g.repoUrl,
        branch: g.branch,
        commit: failed ? (g.failureExit === null ? null : g.commit) : g.commit,
        budget: { perLevel: 4, total: 20, seconds: 1800, refusals: 10 },
        levelsSkipped: g.levelsSkipped,
        attempts,
        refusals: g.refusals,
        levels,
        reasonCodes: g.reasonCodes,
        findingsKey: failed ? null : g.findingsKey,
        pendingFindings: g.pending,
        failure: failed ? { stage: g.failureStage, reasonCode: g.failureCode, message: g.failureMessage, exitCode: g.failureExit } : null,
      };
    });
}

/**
 * A Hunt_Record in any of the four states.
 * @type {fc.Arbitrary<any>}
 */
export const arbHuntRecord = arbHuntStartSec.chain(arbHuntRecordAt);

/**
 * 0 to 15 Hunt_Records with distinct ids (distinct start seconds) in any order, in all four states.
 * @type {fc.Arbitrary<any[]>}
 */
export const arbHuntHistory = fc
  .uniqueArray(arbHuntStartSec, { minLength: 0, maxLength: 15 })
  .chain((secs) => (secs.length === 0 ? fc.constant(/** @type {any[]} */ ([])) : fc.tuple(.../** @type {fc.Arbitrary<any>[]} */ (secs.map(arbHuntRecordAt)))));

// ---------------------------------------------------------------------------------------------------------
// Submit state (Property 6) and scripts
// ---------------------------------------------------------------------------------------------------------

/** @type {fc.Arbitrary<any>} */
const arbParsed = fc.oneof(
  { weight: 3, arbitrary: fc.record({ ok: fc.constant(true), pickLevel: fc.nat({ max: 1000 }), known: fc.boolean(), claimedClass: fc.constantFrom(...CLASS_NAMES), actions: arbActionList }) },
  { weight: 1, arbitrary: fc.record({ ok: fc.constant(false), detail: fc.constantFrom('missing_level', 'missing_class', 'missing_actions', 'unexpected_argument', 'bad_level_id', 'bad_class', 'empty_actions', 'too_many_tokens', 'unknown_token', 'raw_too_long', 'too_many_edits') }) },
);

/**
 * The state `decideSubmit` receives: refusals 0 to 12, attempts 0 to 22, per-level attempts 0 to 6, any level
 * list (0 to 8 ids, duplicates allowed), any clock (the deadline is crossed, met, or far away).
 * @type {fc.Arbitrary<any>}
 */
export const arbSubmitState = fc
  .record({
    active: fc.boolean(),
    refusals: fc.integer({ min: 0, max: 12 }),
    attempts: fc.integer({ min: 0, max: 22 }),
    levels: fc.array(fc.constantFrom(...LEVEL_POOL), { maxLength: 8 }),
    perLevel: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: LEVEL_POOL.length, maxLength: LEVEL_POOL.length }),
    unknownLevelAttempts: fc.integer({ min: 0, max: 6 }),
    deadlineMs: fc.integer({ min: BASE_MS, max: BASE_MS + FORTY_DAYS_SEC * 1000 }),
    delta: fc.oneof(fc.constantFrom(-1, 0, 1), fc.integer({ min: -3000000, max: 3000000 })),
    parsed: arbParsed,
  })
  .map((g) => {
    /** @type {Record<string, number>} */
    const levelAttempts = {};
    LEVEL_POOL.forEach((id, i) => {
      levelAttempts[id] = g.perLevel[i];
    });
    let parsed = g.parsed;
    if (parsed.ok) {
      const pool = g.levels.length > 0 && g.parsed.known ? g.levels : ['99-not-in-hunt', 'zz-other'];
      parsed = { ok: true, levelId: pool[g.parsed.pickLevel % pool.length], claimedClass: g.parsed.claimedClass, actions: g.parsed.actions };
      if (levelAttempts[parsed.levelId] === undefined) levelAttempts[parsed.levelId] = g.unknownLevelAttempts;
    }
    return {
      active: g.active,
      refusals: g.refusals,
      attempts: g.attempts,
      levelAttempts,
      levels: g.levels,
      nowMs: g.deadlineMs + g.delta,
      deadlineMs: g.deadlineMs,
      parsed,
    };
  });

/** A Hunt_Submit argument list: a well-formed call or arbitrary words. @type {fc.Arbitrary<unknown[]>} */
const arbSubmitArgv = fc.oneof(
  { weight: 3, arbitrary: fc.tuple(fc.oneof(fc.constantFrom(...LEVEL_POOL), fc.constantFrom('99-not-in-hunt', '..', 'Upper', '')), fc.oneof(fc.constantFrom(...CLASS_NAMES), fc.constant('bogus_class')), arbActionList).map(([level, cls, list]) => ['--level', level, '--class', cls, '--actions', ...canonicalTokens(list)]) },
  { weight: 1, arbitrary: arbArgv },
);

/**
 * A script of 0 to 30 steps. Each step moves the clock forward by `jumpMs` (0 to 400000) and then makes one
 * Hunt_Submit call with `argv`. Plain data; the test interprets it.
 * @type {fc.Arbitrary<{jumpMs:number, argv:unknown[]}[]>}
 */
export const arbSubmitScript = fc.array(
  fc.record({ jumpMs: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 400000 })), argv: arbSubmitArgv }),
  { maxLength: 30 },
);
