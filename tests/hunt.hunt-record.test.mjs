// @ts-check
// Task 8.1: unit tests for scripts/hunt/hunt-record.mjs (pure Hunt_Record builders).
// The module does not exist yet; these tests fail until task 8.2.
// Spec: .kiro/specs/exploit-hunt/design.md ("hunt-record.mjs") and requirements.md, Requirement 11.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbHuntRecord } from './hunt.arbitraries.mjs';
import {
  HUNT_RECORD_PATTERN,
  chargeAttempt,
  chargeRefusal,
  countsOf,
  failRecord,
  finishRecord,
  huntIdOf,
  markCutShort,
  newHuntRecord,
  noteReason,
  readyRecord,
  recordOutcome,
  summaryOf,
} from '../scripts/hunt/hunt-record.mjs';

/** @typedef {import('../scripts/hunt/types.mjs').HuntRecord} HuntRecord */
/** @typedef {import('../scripts/hunt/types.mjs').HuntState} HuntState */
/** @typedef {import('../scripts/hunt/hunt-record.mjs').Outcome} Outcome */
/** @typedef {NonNullable<HuntRecord['failure']>} Failure */

const START_MS = Date.UTC(2026, 10, 8, 11, 3, 12, 481);
const START_ISO = '2026-11-08T11:03:12.481Z';
const READY_ISO = '2026-11-08T11:03:19.870Z';
const END_ISO = '2026-11-08T11:20:00.000Z';
const COMMIT = 'e1c61a35b3da027aada5d9ef4460efa4470488a4';
const LEVELS = ['01-the-corridor', '02-the-chaser'];
const ZERO = { attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 };
/** @type {Outcome[]} */
const OUTCOMES = ['confirmed', 'rejected', 'error', 'duplicate', 'notRecorded'];
/** @type {Failure} */
const FAILURE = { stage: 'build', reasonCode: 'build_failed', message: 'The Grimsheet build failed with exit code 1.', exitCode: 1 };

/**
 * Freeze a value and everything inside it, so a function that mutates its input throws.
 * @param {any} value
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const fresh = () =>
  newHuntRecord({ huntId: huntIdOf(START_MS), startedAt: START_ISO, repoUrl: 'https://example.invalid/g.git', branch: 'main' });
const ready = () => readyRecord(fresh(), { readyAt: READY_ISO, commit: COMMIT, levels: LEVELS, levelsSkipped: 3 });
/** @param {HuntRecord} r @param {HuntState} state */
const inState = (r, state) => ({ ...r, state });

describe('huntIdOf and HUNT_RECORD_PATTERN', () => {
  it('builds the id from a UTC time in ms', () => {
    expect(huntIdOf(Date.UTC(2026, 10, 8, 11, 3, 12, 481))).toBe('hunt-20261108T110312Z');
  });

  it('matches record file names only', () => {
    expect(HUNT_RECORD_PATTERN.test('hunt-20261108T110312Z.json')).toBe(true);
    expect(HUNT_RECORD_PATTERN.test('active.json')).toBe(false);
    expect(HUNT_RECORD_PATTERN.test('.hunt-20261108T110312Z.json.9f3c0a51d2b84e67.tmp')).toBe(false);
    expect(HUNT_RECORD_PATTERN.test('hunt-20261108T110312Z.json.bak')).toBe(false);
  });
});

describe('newHuntRecord', () => {
  it('starts running with empty counters', () => {
    const r = fresh();
    expect(r).toMatchObject({
      schemaVersion: 1,
      huntId: 'hunt-20261108T110312Z',
      state: 'running',
      startedAt: START_ISO,
      readyAt: null,
      finishedAt: null,
      repoUrl: 'https://example.invalid/g.git',
      branch: 'main',
      commit: null,
      budget: { perLevel: 4, total: 20, seconds: 1800, refusals: 10 },
      levelsSkipped: 0,
      attempts: 0,
      refusals: 0,
      levels: {},
      reasonCodes: {},
      findingsKey: null,
      pendingFindings: [],
      failure: null,
    });
  });
});

describe('readyRecord', () => {
  it('sets readyAt, commit, levelsSkipped and a zero-counter entry per level', () => {
    const r = ready();
    expect(r.readyAt).toBe(READY_ISO);
    expect(r.commit).toBe(COMMIT);
    expect(r.levelsSkipped).toBe(3);
    expect(r.state).toBe('running');
    expect(r.levels).toEqual({ '01-the-corridor': ZERO, '02-the-chaser': ZERO });
  });
});

describe('charges and reason codes', () => {
  it('chargeAttempt adds one to the total and to the level', () => {
    const r = chargeAttempt(chargeAttempt(ready(), '02-the-chaser'), '02-the-chaser');
    expect(r.attempts).toBe(2);
    expect(r.levels['02-the-chaser'].attempts).toBe(2);
    expect(r.levels['01-the-corridor'].attempts).toBe(0);
    expect(r.refusals).toBe(0);
  });

  it('chargeRefusal adds one refusal and counts the reason code, not an attempt', () => {
    const r = chargeRefusal(chargeRefusal(ready(), 'bad_arguments'), 'unknown_level');
    const again = chargeRefusal(r, 'bad_arguments');
    expect(r.refusals).toBe(2);
    expect(again.refusals).toBe(3);
    expect(again.reasonCodes).toEqual({ bad_arguments: 2, unknown_level: 1 });
    expect(again.attempts).toBe(0);
  });

  it('noteReason counts the reason code with no charge', () => {
    const r = noteReason(noteReason(ready(), 'no_active_hunt'), 'no_active_hunt');
    expect(r.reasonCodes).toEqual({ no_active_hunt: 2 });
    expect(r.refusals).toBe(0);
    expect(r.attempts).toBe(0);
  });
});

describe('recordOutcome', () => {
  it.each(OUTCOMES)('counts a %s on its level and its reason code', (outcome) => {
    const charged = chargeAttempt(ready(), '02-the-chaser');
    const r = recordOutcome(charged, '02-the-chaser', outcome, 'some_code');
    expect(r.levels['02-the-chaser']).toEqual({ ...ZERO, attempts: 1, [outcome]: 1 });
    expect(r.levels['01-the-corridor']).toEqual(ZERO);
    expect(r.reasonCodes).toEqual({ some_code: 1 });
    expect(r.attempts).toBe(1);
  });
});

describe('finishRecord and failRecord', () => {
  it('finishRecord sets state and finishedAt', () => {
    const r = finishRecord(ready(), { state: 'complete', finishedAt: END_ISO, failure: null });
    expect(r.state).toBe('complete');
    expect(r.finishedAt).toBe(END_ISO);
    expect(r.failure).toBeNull();
  });

  it('failRecord sets failed, finishedAt and the failure', () => {
    const r = failRecord(fresh(), { finishedAt: END_ISO, failure: FAILURE });
    expect(r.state).toBe('failed');
    expect(r.finishedAt).toBe(END_ISO);
    expect(r.failure).toEqual(FAILURE);
  });

  it.each(/** @type {HuntState[]} */ (['complete', 'failed', 'cut-short']))('leaves a %s record unchanged', (state) => {
    const r = inState(ready(), state);
    expect(finishRecord(r, { state: 'complete', finishedAt: END_ISO, failure: null })).toEqual(r);
    expect(failRecord(r, { finishedAt: END_ISO, failure: FAILURE })).toEqual(r);
  });
});

describe('markCutShort', () => {
  const young = START_MS + 2399 * 1000;
  const old = START_MS + 2401 * 1000;

  it('leaves a running record younger than 2400 s unchanged', () => {
    const r = ready();
    expect(markCutShort(r, young)).toEqual(r);
  });

  it('turns a running record older than 2400 s into cut-short and leaves finishedAt null', () => {
    const r = markCutShort(ready(), old);
    expect(r.state).toBe('cut-short');
    expect(r.finishedAt).toBeNull();
  });

  it('is idempotent', () => {
    const once = markCutShort(ready(), old);
    expect(markCutShort(once, old)).toEqual(once);
  });

  it.each(/** @type {HuntState[]} */ (['complete', 'failed']))('leaves a %s record unchanged even when old', (state) => {
    const r = inState(ready(), state);
    expect(markCutShort(r, old)).toEqual(r);
  });
});

describe('countsOf and summaryOf', () => {
  /** Two attempts on one level, one on another, each with an outcome. */
  function worked() {
    let r = ready();
    r = recordOutcome(chargeAttempt(r, '01-the-corridor'), '01-the-corridor', 'confirmed', 'class_reproduced');
    r = recordOutcome(chargeAttempt(r, '02-the-chaser'), '02-the-chaser', 'rejected', 'not_won');
    r = recordOutcome(chargeAttempt(r, '02-the-chaser'), '02-the-chaser', 'duplicate', 'duplicate_finding');
    return r;
  }

  it('countsOf totals the levels; attempts equals the sum of the five outcome counts', () => {
    const c = countsOf(worked());
    expect(c).toEqual({ attempts: 3, confirmed: 1, rejected: 1, error: 0, duplicate: 1, notRecorded: 0 });
    expect(c.attempts).toBe(c.confirmed + c.rejected + c.error + c.duplicate + c.notRecorded);
  });

  it('countsOf of a fresh record is all zero', () => {
    expect(countsOf(fresh())).toEqual(ZERO);
  });

  it('summaryOf holds the totals and the seconds used since readyAt', () => {
    const readyMs = Date.parse(READY_ISO);
    const s = summaryOf(worked(), readyMs + 90 * 1000);
    expect(s).toMatchObject({ attempts: 3, confirmed: 1, rejected: 1, error: 0, duplicate: 1, notRecorded: 0 });
    expect(s.seconds).toBe(90);
  });

  it('summaryOf reports zero seconds while the record is not ready', () => {
    expect(summaryOf(fresh(), START_MS + 5000).seconds).toBe(0);
  });
});

describe('purity', () => {
  it('returns a new object and leaves a frozen input unchanged', () => {
    const base = ready();
    const frozen = deepFreeze(structuredClone(base));
    const snapshot = structuredClone(base);
    const results = [
      readyRecord(deepFreeze(fresh()), { readyAt: READY_ISO, commit: COMMIT, levels: LEVELS, levelsSkipped: 0 }),
      chargeAttempt(frozen, '01-the-corridor'),
      chargeRefusal(frozen, 'bad_arguments'),
      noteReason(frozen, 'no_active_hunt'),
      recordOutcome(frozen, '01-the-corridor', 'rejected', 'not_won'),
      finishRecord(frozen, { state: 'complete', finishedAt: END_ISO, failure: null }),
      failRecord(frozen, { finishedAt: END_ISO, failure: FAILURE }),
      markCutShort(frozen, START_MS + 2401 * 1000),
    ];
    for (const r of results) expect(r).not.toBe(frozen);
    expect(frozen).toEqual(snapshot);
  });

  it('also returns a new object when the call changes nothing', () => {
    const done = deepFreeze(inState(ready(), 'complete'));
    expect(markCutShort(done, START_MS + 9999 * 1000)).not.toBe(done);
    expect(finishRecord(done, { state: 'complete', finishedAt: END_ISO, failure: null })).not.toBe(done);
  });
});

describe('what the record holds', () => {
  const ALLOWED_KEYS = [
    'schemaVersion', 'huntId', 'state', 'startedAt', 'readyAt', 'finishedAt', 'repoUrl', 'branch', 'commit',
    'budget', 'levelsSkipped', 'attempts', 'refusals', 'levels', 'reasonCodes', 'findingsKey', 'pendingFindings', 'failure',
  ];

  it('has exactly the keys of Requirement 11, criterion 2, after every kind of change', () => {
    let r = ready();
    r = recordOutcome(chargeAttempt(r, '01-the-corridor'), '01-the-corridor', 'rejected', 'not_won');
    r = chargeRefusal(noteReason(r, 'no_active_hunt'), 'bad_arguments');
    r = finishRecord(r, { state: 'complete', finishedAt: END_ISO, failure: null });
    for (const rec of [fresh(), ready(), r, failRecord(fresh(), { finishedAt: END_ISO, failure: FAILURE })]) {
      expect(Object.keys(rec).sort()).toEqual([...ALLOWED_KEYS].sort());
    }
  });

  it('keeps no candidate text, action list or reason text', () => {
    const r = recordOutcome(chargeAttempt(ready(), '01-the-corridor'), '01-the-corridor', 'rejected', 'not_won');
    const text = JSON.stringify(r);
    for (const key of ['candidate', 'actions', 'reason"', 'text']) expect(text.includes(`"${key.replace('"', '')}"`)).toBe(false);
    for (const level of Object.values(r.levels)) {
      expect(Object.keys(level).sort()).toEqual(['attempts', 'confirmed', 'duplicate', 'error', 'notRecorded', 'rejected']);
    }
  });
});

// Feature: exploit-hunt, Property 13: Cut-short is idempotent and final states are final
// Clock = the record's startedAt plus a generated offset in ms. The offset is either near the 2400 s boundary
// (but never exactly on it, because the design does not say which side exactly 2400 s falls on) or anywhere
// from before the start to far past it, so running records are covered both young and old.
describe('Property 13: Cut-short is idempotent and final states are final', () => {
  const LIMIT_MS = 2400 * 1000;
  const arbOffsetMs = fc
    .oneof(
      fc.integer({ min: -LIMIT_MS, max: 3 * LIMIT_MS }),
      fc.integer({ min: LIMIT_MS - 5000, max: LIMIT_MS + 5000 }),
    )
    .filter((ms) => ms !== LIMIT_MS);
  const arbCase = fc.tuple(arbHuntRecord, arbOffsetMs);

  it('holds for any record and any clock', () => {
    fc.assert(
      fc.property(arbCase, ([record, offsetMs]) => {
        /** @type {HuntRecord} */
        const r = record;
        const nowMs = Date.parse(r.startedAt) + offsetMs;
        const once = markCutShort(r, nowMs);

        // Idempotent.
        expect(markCutShort(once, nowMs)).toEqual(once);

        if (r.state === 'complete' || r.state === 'failed' || r.state === 'cut-short') {
          // Final states are final.
          expect(once).toEqual(r);
          expect(finishRecord(r, { state: 'complete', finishedAt: END_ISO, failure: null })).toEqual(r);
          expect(failRecord(r, { finishedAt: END_ISO, failure: FAILURE })).toEqual(r);
        } else {
          expect(r.state).toBe('running');
          if (offsetMs < LIMIT_MS) {
            expect(once).toEqual(r);
          } else {
            expect(once).toEqual({ ...r, state: 'cut-short' });
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});
