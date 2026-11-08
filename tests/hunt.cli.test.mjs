// @ts-check
// Task 18.1: unit tests for scripts/hunt/cli.mjs (main, withExitStatus). The module does not exist yet.
// Design: "cli.mjs", "Output of every script", Decision 22.
import { describe, expect, it } from 'vitest';
import { main, withExitStatus } from '../scripts/hunt/cli.mjs';
import { makeHuntWorld } from './helpers/hunt-world.mjs';

/** @typedef {import('../scripts/hunt/types.mjs').HuntResult} HuntResult */

/**
 * A fake io that records what main printed and which exit code it set.
 * @param {Record<string, (deps: any, argv: string[]) => Promise<HuntResult>>} [run]
 * @param {() => any} [buildDeps]
 */
function fakeIo(run, buildDeps = () => ({ marker: 'deps' })) {
  /** @type {string[]} */
  const written = [];
  /** @type {number[]} */
  const codes = [];
  return {
    written,
    codes,
    io: {
      buildDeps,
      ...(run ? { run } : {}),
      write: (/** @type {string} */ text) => void written.push(text),
      setExitCode: (/** @type {number} */ code) => void codes.push(code),
    },
  };
}

describe('withExitStatus', () => {
  it('puts exitStatus last and keeps the other keys in order', () => {
    const out = withExitStatus({ state: 'ready', huntId: 'h', levels: [], finished: false }, 0);
    expect(Object.keys(out)).toEqual(['state', 'huntId', 'levels', 'finished', 'exitStatus']);
    expect(out.exitStatus).toBe(0);
  });

  it('moves an existing exitStatus key to the end with the given value', () => {
    const out = withExitStatus({ exitStatus: 9, a: 1, b: 2 }, 3);
    expect(Object.keys(out)).toEqual(['a', 'b', 'exitStatus']);
    expect(out.exitStatus).toBe(3);
  });

  it('does not change its input', () => {
    const body = { a: 1 };
    withExitStatus(body, 4);
    expect(body).toEqual({ a: 1 });
  });
});

describe('main: output and exit code', () => {
  for (const exit of /** @type {const} */ ([0, 3, 4])) {
    it(`prints one JSON line with exitStatus ${exit} and passes ${exit} to setExitCode`, async () => {
      const body = { state: 'x', n: 1 };
      const { io, written, codes } = fakeIo({ begin: async () => ({ exit, body }) });
      await main('begin', [], io);
      expect(written).toHaveLength(1);
      const text = written[0];
      expect(text.endsWith('\n')).toBe(true);
      expect(text.slice(0, -1)).not.toContain('\n');
      expect(text).toBe(JSON.stringify({ state: 'x', n: 1, exitStatus: exit }) + '\n');
      expect(codes).toEqual([exit]);
      expect(JSON.parse(text).exitStatus).toBe(codes[0]);
    });
  }

  it('returns the HuntResult of the orchestrator', async () => {
    const result = /** @type {HuntResult} */ ({ exit: 3, body: { outcome: 'refused' } });
    const { io } = fakeIo({ info: async () => result });
    expect(await main('info', [], io)).toEqual(result);
  });

  it('passes the built deps and the argv to the orchestrator', async () => {
    /** @type {any[]} */
    const seen = [];
    const { io } = fakeIo({
      submit: async (deps, argv) => {
        seen.push([deps, argv]);
        return { exit: 0, body: {} };
      },
    });
    await main('submit', ['--level', 'a'], io);
    expect(seen).toEqual([[{ marker: 'deps' }, ['--level', 'a']]]);
  });
});

describe('main: an orchestrator that throws', () => {
  it('prints the hunt_internal_error body and sets 4', async () => {
    const { io, written, codes } = fakeIo({
      end: async () => {
        throw new Error('boom');
      },
    });
    await main('end', [], io);
    expect(written).toEqual(['{"outcome":"error","reasonCode":"hunt_internal_error","exitStatus":4}\n']);
    expect(codes).toEqual([4]);
  });
});

describe('main: selects the orchestrator by name', () => {
  it('calls only the entry of io.run that matches the name', async () => {
    for (const name of /** @type {const} */ (['begin', 'info', 'submit', 'end'])) {
      /** @type {string[]} */
      const called = [];
      const run = /** @type {Record<string, (deps: any, argv: string[]) => Promise<HuntResult>>} */ (Object.fromEntries(
        ['begin', 'info', 'submit', 'end'].map((n) => [
          n,
          async () => {
            called.push(n);
            return { exit: 0, body: { which: n } };
          },
        ]),
      ));
      const { io, written } = fakeIo(run);
      await main(name, [], io);
      expect(called).toEqual([name]);
      expect(JSON.parse(written[0]).which).toBe(name);
    }
  });

  it('without io.run uses the real orchestrators: begin with an argument is refused, exit 3', async () => {
    const world = makeHuntWorld();
    const { io, written, codes } = fakeIo(undefined, () => world.deps);
    await main('begin', ['extra'], io);
    expect(codes).toEqual([3]);
    const printed = JSON.parse(written[0]);
    expect(printed.reasonCode).toBe('bad_arguments');
    expect(printed.exitStatus).toBe(3);
  });

  it('without io.run, end with no active hunt prints the no_active_hunt refusal, exit 3', async () => {
    const world = makeHuntWorld();
    const { io, written, codes } = fakeIo(undefined, () => world.deps);
    await main('end', [], io);
    expect(written).toEqual(['{"outcome":"refused","reasonCode":"no_active_hunt","reason":"No hunt is active.","exitStatus":3}\n']);
    expect(codes).toEqual([3]);
  });
});

describe('main: default argv', () => {
  it('uses process.argv.slice(2) when argv is not given', async () => {
    const saved = process.argv;
    /** @type {string[][]} */
    const seen = [];
    try {
      process.argv = ['node', 'entry.mjs', '--level', 'x'];
      const { io } = fakeIo({
        info: async (_deps, argv) => {
          seen.push(argv);
          return { exit: 0, body: {} };
        },
      });
      await main('info', undefined, io);
    } finally {
      process.argv = saved;
    }
    expect(seen).toEqual([['--level', 'x']]);
  });
});

describe('main: Hunt_End printed output', () => {
  it('carries the End body of the design example with exitStatus 0 last', async () => {
    const world = makeHuntWorld();
    const began = await world.begin([]);
    expect(began.exit).toBe(0);
    const { io, written, codes } = fakeIo(undefined, () => world.deps);
    await main('end', [], io);
    expect(codes).toEqual([0]);
    expect(written).toHaveLength(1);
    expect(written[0].endsWith('\n')).toBe(true);
    const printed = JSON.parse(written[0]);
    expect(Object.keys(printed)).toEqual(['state', 'huntId', 'commit', 'summary', 'levels', 'finished', 'exitStatus']);
    expect(printed.state).toBe('complete');
    expect(printed.huntId).toBe(/** @type {any} */ (began.body).huntId);
    expect(printed.finished).toBe(true);
    expect(printed.exitStatus).toBe(0);
    expect(Object.keys(printed.summary)).toEqual([
      'attempts',
      'refusals',
      'confirmed',
      'rejected',
      'error',
      'duplicate',
      'notRecorded',
      'seconds',
      'findingsKey',
    ]);
  });

  it('runEnd itself returns the body without exitStatus', async () => {
    const world = makeHuntWorld();
    await world.begin([]);
    const result = await world.end([]);
    expect(result.exit).toBe(0);
    expect('exitStatus' in result.body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 18.3: property test for exitStatus (design Property 14).
// ---------------------------------------------------------------------------
import fc from 'fast-check';
import { CLASSES, FINDING_MAX_BYTES } from '../scripts/hunt/limits.mjs';
import { ERROR_CODES, REJECTED_CODES } from './hunt.arbitraries.mjs';

const FINDINGS_KEY_VALUES = ['ok', 'lock_timeout', 'config_unreadable', 'too_large', 'write_failed'];
/** Failure stage and reason code pairs written by begin.mjs and the replay checkout. */
const FAILURE_PAIRS = [['checkout', 'checkout_delete_failed'], ['install', 'install_failed'], ['build', 'build_failed'], ['list', 'list_failed'], ['list', 'empty_level_list'], ['build', 'step_timeout']];

const idArb = fc.stringMatching(/^[a-z0-9-]{1,24}$/);
const smallInt = fc.integer({ min: 0, max: 9999 });
const leftArb = fc.record({ level: smallInt, total: smallInt, refusals: smallInt, seconds: smallInt });
const playArb = fc.record({
  steps: smallInt,
  finalStatus: fc.constantFrom('won', 'lost', 'playing'),
  finalHp: smallInt,
  firstRefused: fc.constantFrom(null, 3),
  firstStatusChange: fc.constantFrom(null, { step: 12, status: 'won' }),
});
const summaryArb = fc.record({
  attempts: smallInt,
  refusals: smallInt,
  confirmed: smallInt,
  rejected: smallInt,
  error: smallInt,
  duplicate: smallInt,
  notRecorded: smallInt,
  seconds: smallInt,
  findingsKey: fc.constantFrom(...FINDINGS_KEY_VALUES),
});
const submitBase = fc.record({
  levelId: idArb,
  class: fc.constantFrom(...CLASSES),
  attempt: smallInt,
  minimalInk: smallInt,
  editCount: smallInt,
  newEditAddresses: fc.array(fc.stringMatching(/^[A-H][0-9]{1,2}$/), { maxLength: 3 }),
  play: playArb,
  left: leftArb,
  finished: fc.boolean(),
});

/** Generated by construction from the printed body shapes in design.md ("Output of every script"). */
const bodyArb = /** @type {fc.Arbitrary<{exit: 0|3|4, body: Record<string, unknown>}>} */ (
  fc.oneof(
    // Begin: ready, failed, refused, already_running, record_failed
    fc.record({ state: fc.constant('ready'), huntId: idArb, commit: fc.stringMatching(/^[0-9a-f]{40}$/), levels: fc.array(idArb, { maxLength: 5 }), levelsSkipped: smallInt, budget: fc.record({ perLevel: smallInt, total: smallInt, seconds: smallInt, refusals: smallInt }) }).map((body) => ({ exit: /** @type {0} */ (0), body })),
    fc.record({ state: fc.constant('failed'), huntId: idArb, failure: fc.record({ stage: fc.constant('x'), reasonCode: fc.constant('x'), message: idArb, exitCode: smallInt }).chain((f) => fc.constantFrom(...FAILURE_PAIRS).map(([stage, reasonCode]) => ({ ...f, stage, reasonCode }))) }).map((body) => ({ exit: /** @type {0} */ (0), body })),
    fc.constantFrom({ state: 'refused', reasonCode: 'bad_arguments' }, { state: 'already_running' }).map((body) => ({ exit: /** @type {3} */ (3), body })),
    fc.constant({ state: 'record_failed', reasonCode: 'hunt_record_unwritable' }).map((body) => ({ exit: /** @type {4} */ (4), body })),
    // Info: level (with and without info null), refused
    fc.record({ state: fc.constant('level'), levelId: idArb, info: fc.oneof(fc.constant(null), fc.record({ id: idArb, map: fc.array(idArb, { maxLength: 4 }) })), stored: fc.record({ minimalInk: smallInt, actionCount: smallInt, actions: idArb }), left: leftArb }).map((body) => ({ exit: /** @type {0} */ (0), body })),
    fc.record({ outcome: fc.constant('refused'), reasonCode: fc.constantFrom('no_active_hunt', 'level_info_too_large', 'unknown_level', 'time_budget_spent', 'call_busy'), reason: idArb }).map((body) => ({ exit: /** @type {3} */ (3), body })),
    // Submit: confirmed, rejected, error, duplicate, not_recorded
    fc.tuple(submitBase, idArb).map(([b, findingId]) => ({ exit: /** @type {0} */ (0), body: { outcome: 'confirmed', ...b, findingId } })),
    fc.tuple(submitBase, idArb, fc.constantFrom(...REJECTED_CODES)).map(([b, reason, rejectedCode]) => ({ exit: /** @type {0} */ (0), body: { outcome: 'rejected', reasonCode: rejectedCode, reason, ...b } })),
    fc.tuple(submitBase, idArb, fc.constantFrom(...ERROR_CODES)).map(([b, reason, errorCode]) => ({ exit: /** @type {0} */ (0), body: { outcome: 'error', reasonCode: errorCode, reason, levelId: b.levelId, class: b.class, attempt: b.attempt, left: b.left, finished: b.finished } })),
    fc.tuple(submitBase, idArb).map(([b, duplicateOf]) => ({ exit: /** @type {0} */ (0), body: { outcome: 'duplicate', reasonCode: 'duplicate_finding', duplicateOf, ...b } })),
    fc.tuple(submitBase, smallInt).map(([b, bytes]) => ({ exit: /** @type {0} */ (0), body: { outcome: 'not_recorded', reasonCode: 'finding_too_large', bytes, maxBytes: FINDING_MAX_BYTES, ...b } })),
    // Submit refused, with and without finished + summary
    fc.record({ outcome: fc.constant('refused'), reasonCode: fc.constantFrom('no_active_hunt', 'bad_arguments', 'unknown_level', 'level_budget_spent', 'refusal_budget_spent', 'total_budget_spent', 'time_budget_spent', 'call_busy'), reason: idArb }).map((body) => ({ exit: /** @type {3} */ (3), body })),
    fc.tuple(idArb, summaryArb).map(([reason, summary]) => ({ exit: /** @type {3} */ (3), body: { outcome: 'refused', reasonCode: 'refusal_budget_spent', reason, finished: true, summary } })),
    // End: complete, refused
    fc.tuple(idArb, summaryArb, fc.array(idArb, { maxLength: 5 })).map(([huntId, summary, levels]) => ({ exit: /** @type {0} */ (0), body: { state: 'complete', huntId, commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4', summary, levels, finished: true } })),
    fc.constant({ outcome: 'refused', reasonCode: 'no_active_hunt', reason: 'No hunt is active.' }).map((body) => ({ exit: /** @type {3} */ (3), body })),
    // exit-4 error bodies
    fc.constantFrom('hunt_internal_error', 'hunt_record_unwritable').map((reasonCode) => ({ exit: /** @type {4} */ (4), body: { outcome: 'error', reasonCode } })),
  )
);

/** Optionally plants a stale exitStatus key at a generated position among the keys. */
const withStaleArb = fc
  .tuple(bodyArb, fc.option(fc.record({ value: fc.oneof(fc.integer(), fc.string(), fc.constant(null)), at: fc.nat({ max: 40 }) }), { nil: undefined }))
  .map(([r, stale]) => {
    if (!stale) return r;
    const entries = Object.entries(r.body);
    entries.splice(Math.min(stale.at, entries.length), 0, ['exitStatus', stale.value]);
    return { exit: r.exit, body: Object.fromEntries(entries) };
  });

describe('Property 14: exitStatus equals the exit code', () => {
  // Feature: exploit-hunt, Property 14: exitStatus equals the exit code
  // **Validates: Requirements 4.10, 16.11, 3.9**
  it('prints one JSON line whose last key exitStatus equals the code given to setExitCode', async () => {
    await fc.assert(
      fc.asyncProperty(withStaleArb, fc.constantFrom('begin', 'info', 'submit', 'end'), async ({ exit, body }, name) => {
        const { io, written, codes } = fakeIo({ [name]: async () => ({ exit, body }) });
        await main(/** @type {'begin'|'info'|'submit'|'end'} */ (name), [], io);

        expect(written).toHaveLength(1);
        const text = written[0];
        expect(text.endsWith('\n')).toBe(true);
        expect(text.slice(0, -1)).not.toContain('\n');

        const printed = JSON.parse(text);
        expect(printed !== null && typeof printed === 'object' && !Array.isArray(printed)).toBe(true);
        expect(codes).toEqual([exit]);
        expect(Number.isInteger(printed.exitStatus)).toBe(true);
        expect(printed.exitStatus).toBe(codes[0]);

        const keys = Object.keys(printed);
        expect(keys[keys.length - 1]).toBe('exitStatus');
        // Every other key of the body is kept, in order.
        const expectedKeys = Object.keys(body).filter((k) => k !== 'exitStatus');
        expect(keys.slice(0, -1)).toEqual(expectedKeys);
        for (const k of expectedKeys) expect(printed[k]).toEqual(JSON.parse(JSON.stringify(body[k])));
      }),
      { numRuns: 200 },
    );
  });

  // Feature: exploit-hunt, Property 14: exitStatus equals the exit code
  // **Validates: Requirements 4.10, 16.11, 3.9**
  it('when run throws, prints the hunt_internal_error line with exitStatus 4 and sets 4', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('begin', 'info', 'submit', 'end'), fc.string(), async (name, message) => {
        const { io, written, codes } = fakeIo({
          [name]: async () => {
            throw new Error(message);
          },
        });
        await main(/** @type {'begin'|'info'|'submit'|'end'} */ (name), [], io);
        expect(written).toHaveLength(1);
        expect(written[0].endsWith('\n')).toBe(true);
        const printed = JSON.parse(written[0]);
        expect(Object.keys(printed)).toEqual(['outcome', 'reasonCode', 'exitStatus']);
        expect(printed.exitStatus).toBe(4);
        expect(codes).toEqual([4]);
      }),
      { numRuns: 100 },
    );
  });
});
