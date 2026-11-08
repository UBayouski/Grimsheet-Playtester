// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RESULTS_LOCK_FILE, withResultsLock, mergeTopKey } from '../scripts/results-store.mjs';
import { makeFakeClock, makeMemFs, makeScheduler, makeSleep, makeTokenSource } from './helpers/fake-fs.mjs';
import { arbConfig, arbRunHistory, arbRunHistoryStress, arbRunRecord } from './replay.arbitraries.mjs';
import { BYTE_BUDGET, buildResultsKey, byteLength, compactLatest, trendEntryOf } from '../scripts/replay/run-record.mjs';

const DATA = '/app/data';
const CONFIG = `${DATA}/config.json`;
const LOCK = `${DATA}/.results.lock`;
const TOP = 'playtesterResults';
const T0 = Date.UTC(2026, 11, 1, 3, 0, 0);

function setup() {
  const clock = makeFakeClock(T0);
  const fs = makeMemFs({ clock });
  fs.seedDir(DATA);
  const deps = {
    fs: /** @type {import('../scripts/replay/types.mjs').Fs} */ (fs),
    paths: { appFolder: '/app', dataFolder: DATA, localAppData: '/lad' },
    clock,
    sleep: makeSleep(clock),
    token: makeTokenSource(),
    pid: 77,
  };
  return { clock, fs, deps };
}

/** @param {Record<string, unknown>} owned */
const buildWith = (owned) => () => /** @type {const} */ ({ ok: true, owned });

/** @param {any} value @returns {string} */
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

describe('RESULTS_LOCK_FILE', () => {
  it('is .results.lock', () => {
    expect(RESULTS_LOCK_FILE).toBe('.results.lock');
  });
});

describe('mergeTopKey', () => {
  it('creates config.json holding only the top key when it is missing', async () => {
    const { fs, deps } = setup();
    const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith({ schemaVersion: 1, latest: { a: 1 } }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: true });
    expect(JSON.parse(/** @type {string} */ (fs.peek(CONFIG)))).toEqual({ [TOP]: { schemaVersion: 1, latest: { a: 1 } } });
  });

  it('keeps the foreign top-level keys of an existing object', async () => {
    const { fs, deps } = setup();
    fs.seedFile(CONFIG, jsonText({ theme: 'dark', n: [1, 2], nested: { a: { b: null } } }));
    const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith({ latest: 1 }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: true });
    expect(JSON.parse(/** @type {string} */ (fs.peek(CONFIG)))).toEqual({ theme: 'dark', n: [1, 2], nested: { a: { b: null } }, [TOP]: { latest: 1 } });
  });

  it('keeps findings and an unknown sub-key, replaces only the owned sub-keys, and does not create findings', async () => {
    const withFindings = setup();
    withFindings.fs.seedFile(CONFIG, jsonText({ [TOP]: { latest: 'old', trend: ['old'], findings: [{ id: 1 }], mystery: 5 } }));
    await mergeTopKey(withFindings.deps, { topKey: TOP, buildOwned: buildWith({ latest: 'new', trend: [] }), budgetBytes: 65536 });
    expect(JSON.parse(/** @type {string} */ (withFindings.fs.peek(CONFIG)))[TOP]).toEqual({ latest: 'new', trend: [], findings: [{ id: 1 }], mystery: 5 });

    const without = setup();
    without.fs.seedFile(CONFIG, jsonText({ [TOP]: { latest: 'old' } }));
    await mergeTopKey(without.deps, { topKey: TOP, buildOwned: buildWith({ latest: 'new' }), budgetBytes: 65536 });
    expect('findings' in JSON.parse(/** @type {string} */ (without.fs.peek(CONFIG)))[TOP]).toBe(false);
  });

  it('passes the existing top-level value to buildOwned, or {} when there is none or it is not an object', async () => {
    /** @type {unknown[]} */
    const seen = [];
    const build = (/** @type {Record<string, unknown>} */ existing) => {
      seen.push(existing);
      return /** @type {const} */ ({ ok: true, owned: { x: 1 } });
    };
    for (const text of [jsonText({}), jsonText({ [TOP]: { findings: [1] } }), jsonText({ [TOP]: 'text' }), jsonText({ [TOP]: [1] }), jsonText({ [TOP]: null })]) {
      const { fs, deps } = setup();
      fs.seedFile(CONFIG, text);
      await mergeTopKey(deps, { topKey: TOP, buildOwned: build, budgetBytes: 65536 });
    }
    expect(seen).toEqual([{}, { findings: [1] }, {}, {}, {}]);
  });

  it.each([
    ['unparsable', '{ not json'],
    ['a JSON array', '[1, 2]'],
    ['a JSON string', '"text"'],
    ['null', 'null'],
    ['BOM-prefixed', `\ufeff${jsonText({ a: 1 })}`],
  ])('gives config_unreadable for %s content and leaves the file untouched', async (_name, text) => {
    const { fs, deps } = setup();
    fs.seedFile(CONFIG, text);
    const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: false, reason: 'config_unreadable' });
    expect(fs.peek(CONFIG)).toBe(text);
    expect(fs.has(LOCK)).toBe(false);
  });

  it('gives config_unreadable when config.json cannot be read for a reason other than missing', async () => {
    const { fs, deps } = setup();
    fs.seedFile(CONFIG, '{}');
    const failing = { ...fs, readFile: async (/** @type {string} */ p) => {
      if (p.replace(/\\/g, '/').endsWith('config.json')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return fs.readFile(p, 'utf8');
    } };
    const r = await mergeTopKey({ ...deps, fs: /** @type {any} */ (failing) }, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: false, reason: 'config_unreadable' });
    expect(fs.has(LOCK)).toBe(false);
  });

  it('gives too_large when buildOwned says not ok, and leaves the file untouched', async () => {
    const { fs, deps } = setup();
    const text = jsonText({ a: 1 });
    fs.seedFile(CONFIG, text);
    const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: () => ({ ok: false }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: false, reason: 'too_large' });
    expect(fs.peek(CONFIG)).toBe(text);
    expect(fs.has(LOCK)).toBe(false);
  });

  it('gives too_large when the merged value is over the budget even though buildOwned says ok', async () => {
    const { fs, deps } = setup();
    const text = jsonText({ a: 1, [TOP]: { findings: ['f'.repeat(100)] } });
    fs.seedFile(CONFIG, text);
    const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith({ latest: 'x'.repeat(100) }), budgetBytes: 150 });
    expect(r).toEqual({ ok: false, reason: 'too_large' });
    expect(fs.peek(CONFIG)).toBe(text);
  });

  it('accepts a merged value exactly at the budget', async () => {
    const { deps } = setup();
    const owned = { k: 'v' };
    const size = Buffer.byteLength(JSON.stringify(owned), 'utf8');
    expect(await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith(owned), budgetBytes: size })).toEqual({ ok: true });
    const { deps: deps2 } = setup();
    expect(await mergeTopKey(deps2, { topKey: TOP, buildOwned: buildWith(owned), budgetBytes: size - 1 })).toEqual({ ok: false, reason: 'too_large' });
  });

  it('gives lock_timeout after 10 s when a fresh foreign lock is held, and writes nothing', async () => {
    const { clock, fs, deps } = setup();
    const foreign = JSON.stringify({ pid: 1, token: 'a'.repeat(32), createdAt: new Date(T0).toISOString() });
    fs.seedFile(LOCK, foreign);
    fs.seedFile(CONFIG, jsonText({ a: 1 }));
    const before = fs.snapshot();
    const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: false, reason: 'lock_timeout' });
    expect(clock.nowMs() - T0).toBe(10000);
    expect(fs.snapshot()).toStrictEqual(before); // the foreign lock is not removed by us
  });

  it('takes over a results lock older than 60 s', async () => {
    const { fs, deps } = setup();
    fs.seedFile(LOCK, JSON.stringify({ pid: 1, token: 'a'.repeat(32), createdAt: new Date(T0 - 61000).toISOString() }));
    expect(await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 })).toEqual({ ok: true });
    expect(fs.has(LOCK)).toBe(false);
  });

  it('gives write_failed when the temp file write fails, and leaves config.json and no lock behind', async () => {
    const { fs, deps } = setup();
    const text = jsonText({ a: 1 });
    fs.seedFile(CONFIG, text);
    const failing = { ...fs, writeFile: async (/** @type {string} */ p, /** @type {string} */ d, /** @type {any} */ o) => {
      if (p.endsWith('.tmp')) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      return fs.writeFile(p, d, o);
    } };
    const r = await mergeTopKey({ ...deps, fs: /** @type {any} */ (failing) }, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: false, reason: 'write_failed' });
    expect(fs.peek(CONFIG)).toBe(text);
    expect(fs.has(LOCK)).toBe(false);
  });

  it('gives write_failed when the rename fails, removes the temp file, and keeps config.json', async () => {
    const { fs, deps } = setup();
    const text = jsonText({ a: 1 });
    fs.seedFile(CONFIG, text);
    const failing = { ...fs, rename: async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } };
    const r = await mergeTopKey({ ...deps, fs: /** @type {any} */ (failing) }, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: false, reason: 'write_failed' });
    expect(fs.peek(CONFIG)).toBe(text);
    expect(fs.paths(DATA)).toEqual([CONFIG]);
  });

  it('gives write_failed when the lock file cannot be created at all', async () => {
    const { fs, deps } = setup();
    const failing = { ...fs, writeFile: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } };
    const r = await mergeTopKey({ ...deps, fs: /** @type {any} */ (failing) }, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 });
    expect(r).toEqual({ ok: false, reason: 'write_failed' });
  });

  it('releases the lock when buildOwned throws, and rethrows', async () => {
    const { fs, deps } = setup();
    fs.seedFile(CONFIG, jsonText({ a: 1 }));
    await expect(
      mergeTopKey(deps, {
        topKey: TOP,
        buildOwned: () => {
          throw new Error('boom');
        },
        budgetBytes: 65536,
      }),
    ).rejects.toThrow('boom');
    expect(fs.has(LOCK)).toBe(false);
  });

  it('releases the lock after success and leaves no temp file', async () => {
    const { fs, deps } = setup();
    await mergeTopKey(deps, { topKey: TOP, buildOwned: buildWith({ x: 1 }), budgetBytes: 65536 });
    expect(fs.paths(DATA)).toEqual([CONFIG]);
  });

  it('writes UTF-8 without a BOM, with two-space indent and a trailing newline, through a temp file named .config.<token>.tmp', async () => {
    const { fs, deps } = setup();
    /** @type {string[]} */
    const log = [];
    const logged = { ...deps, fs: fs.withGate(async (l) => void log.push(l.replace(/\\/g, '/'))) };
    await mergeTopKey(logged, { topKey: TOP, buildOwned: buildWith({ x: 'é' }), budgetBytes: 65536 });
    const text = /** @type {string} */ (fs.peek(CONFIG));
    expect(text).toBe(jsonText({ [TOP]: { x: 'é' } }));
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(log.some((l) => /^writeFile \/app\/data\/\.config\.[0-9a-f]{32}\.tmp$/.test(l))).toBe(true);
    expect(log.some((l) => /^rename \/app\/data\/\.config\.[0-9a-f]{32}\.tmp \/app\/data\/config\.json$/.test(l))).toBe(true);
  });
});

describe('withResultsLock', () => {
  it('runs fn under the lock and returns its value', async () => {
    const { fs, deps } = setup();
    const r = await withResultsLock(deps, async () => {
      expect(fs.has(LOCK)).toBe(true);
      return 42;
    });
    expect(r).toEqual({ ok: true, value: 42 });
    expect(fs.has(LOCK)).toBe(false);
  });

  it('releases the lock when fn throws, and rethrows', async () => {
    const { fs, deps } = setup();
    await expect(withResultsLock(deps, async () => { throw new Error('inside'); })).rejects.toThrow('inside');
    expect(fs.has(LOCK)).toBe(false);
  });

  it('does not nest: an inner call while the lock is held gives lock_timeout', async () => {
    const { fs, deps } = setup();
    const outer = await withResultsLock(deps, async () => await withResultsLock(deps, async () => 'inner'));
    expect(outer).toEqual({ ok: true, value: { ok: false, reason: 'lock_timeout' } });
    expect(fs.has(LOCK)).toBe(false);
  });

  it('gives lock_timeout when a fresh foreign lock is held', async () => {
    const { fs, deps } = setup();
    fs.seedFile(LOCK, JSON.stringify({ pid: 1, token: 'a'.repeat(32), createdAt: new Date(T0).toISOString() }));
    expect(await withResultsLock(deps, async () => 1)).toEqual({ ok: false, reason: 'lock_timeout' });
  });
});

describe('results-store properties', () => {
  const NUM_RUNS = 200;
  const UPDATED_AT = '2026-12-01T03:00:00.000Z';
  const OWNED_KEYS = ['schemaVersion', 'updatedAt', 'latest', 'trend'];

  const arbAnyHistory = fc.oneof(arbRunHistory, arbRunHistoryStress);

  /**
   * What the replay merges for a history: the newest record is `latest`, every record is in the trend.
   * @param {any[]} history oldest first
   * @param {any} fallbackLatest used when the history is empty
   */
  function replayBuild(history, fallbackLatest) {
    const latestRecord = history.length > 0 ? history[history.length - 1] : fallbackLatest;
    const latest = compactLatest(latestRecord);
    const trend = history.map((r) => trendEntryOf(r));
    return (/** @type {Record<string, unknown>} */ existingTop) => buildResultsKey({ existingTop, latest, trend, updatedAt: UPDATED_AT, budget: BYTE_BUDGET });
  }

  /** @param {Record<string, any>} config */
  function seeded(config) {
    const s = setup();
    s.fs.seedFile(CONFIG, jsonText(config));
    return s;
  }

  // Feature: replay-runner, Property 8: Results_Key fits the Byte_Budget
  it('Property 8: an ok merge fits the budget; when even one trend entry does not fit the file is unchanged and the outcome is too_large', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnyHistory, arbRunRecord, arbConfig, async (history, fallback, config) => {
        const { fs, deps } = seeded(config);
        const before = fs.peek(CONFIG);
        const build = replayBuild(history, fallback);
        const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: build, budgetBytes: BYTE_BUDGET });

        // Oracle: it fits exactly when the newest trend entry alone (or an empty trend) fits.
        const existingTop = config[TOP] && typeof config[TOP] === 'object' && !Array.isArray(config[TOP]) ? config[TOP] : {};
        const newestOnly = history.length > 0 ? [trendEntryOf(history[history.length - 1])] : [];
        const latest = compactLatest(history.length > 0 ? history[history.length - 1] : fallback);
        const smallest = byteLength({ ...existingTop, schemaVersion: 1, updatedAt: UPDATED_AT, latest, trend: newestOnly });
        const fits = smallest <= BYTE_BUDGET;

        if (r.ok) {
          expect(fits).toBe(true);
          const top = JSON.parse(/** @type {string} */ (fs.peek(CONFIG)))[TOP];
          expect(byteLength(top)).toBeLessThanOrEqual(BYTE_BUDGET);
        } else {
          expect(r).toEqual({ ok: false, reason: 'too_large' });
          expect(fits).toBe(false);
          expect(fs.peek(CONFIG)).toBe(before);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 10: Foreign keys survive a merge
  it('Property 10: top-level keys and sub-keys the replay does not own are deeply equal after a merge, and findings is not created', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnyHistory, arbRunRecord, arbConfig, async (history, fallback, config) => {
        const { fs, deps } = seeded(config);
        const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: replayBuild(history, fallback), budgetBytes: BYTE_BUDGET });
        const after = JSON.parse(/** @type {string} */ (fs.peek(CONFIG)));
        for (const key of Object.keys(config)) {
          if (key !== TOP) expect(after[key]).toStrictEqual(config[key]);
        }
        expect(Object.keys(after).filter((k) => k !== TOP).sort()).toEqual(Object.keys(config).filter((k) => k !== TOP).sort());
        const oldTop = config[TOP] ?? {};
        if (r.ok) {
          for (const sub of Object.keys(oldTop)) {
            if (!OWNED_KEYS.includes(sub)) expect(after[TOP][sub]).toStrictEqual(oldTop[sub]);
          }
          expect('findings' in after[TOP]).toBe('findings' in oldTop);
          expect(Object.keys(after[TOP]).filter((k) => !OWNED_KEYS.includes(k)).sort()).toEqual(Object.keys(oldTop).filter((k) => !OWNED_KEYS.includes(k)).sort());
        } else {
          expect(after).toStrictEqual(config);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 11: Merge is idempotent
  it('Property 11: merging the same Run twice gives the same file content as merging once', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnyHistory, arbRunRecord, arbConfig, async (history, fallback, config) => {
        const { fs, deps } = seeded(config);
        const opts = { topKey: TOP, buildOwned: replayBuild(history, fallback), budgetBytes: BYTE_BUDGET };
        const first = await mergeTopKey(deps, opts);
        const once = fs.peek(CONFIG);
        const second = await mergeTopKey(deps, opts);
        expect(second).toEqual(first);
        expect(fs.peek(CONFIG)).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 12: Results_Key round trip
  it('Property 12: the Results_Key read back from the written file equals the value written, and the file has no BOM', async () => {
    await fc.assert(
      fc.asyncProperty(arbAnyHistory, arbRunRecord, arbConfig, async (history, fallback, config) => {
        const { fs, deps } = seeded(config);
        const build = replayBuild(history, fallback);
        const r = await mergeTopKey(deps, { topKey: TOP, buildOwned: build, budgetBytes: BYTE_BUDGET });
        const text = /** @type {string} */ (fs.peek(CONFIG));
        expect(text.charCodeAt(0)).not.toBe(0xfeff);
        if (!r.ok) return;
        const oldTop = config[TOP] && typeof config[TOP] === 'object' ? config[TOP] : {};
        const built = build(oldTop);
        if (!built.ok) throw new Error('merge was ok but the build is not');
        const top = JSON.parse(text)[TOP];
        for (const key of OWNED_KEYS) expect(top[key]).toStrictEqual(/** @type {any} */ (built.owned)[key]);
        expect(top).toStrictEqual({ ...oldTop, ...built.owned });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 13: Two writers with different owned sub-keys
  it('Property 13: after any scripted interleaving each ok writer has its value in the file, the rest is unchanged, and only a holder removes a lock', async () => {
    const ownedA = { schemaVersion: 1, updatedAt: 'writer-a', latest: { runId: 'run-A' }, trend: [] };
    const ownedB = { findings: ['from-b'] };
    await fc.assert(
      fc.asyncProperty(arbConfig, fc.array(fc.constantFrom(/** @type {0} */ (0), /** @type {1} */ (1)), { minLength: 1, maxLength: 400 }), fc.boolean(), async (config, choices, foreign) => {
        const clock = makeFakeClock(T0);
        const fs = makeMemFs({ clock });
        fs.seedDir(DATA);
        fs.seedFile(CONFIG, jsonText(config));
        const foreignLock = JSON.stringify({ pid: 9, token: 'f'.repeat(32), createdAt: new Date(T0).toISOString() });
        if (foreign) fs.seedFile(LOCK, foreignLock);
        const before = fs.snapshot();

        const sched = makeScheduler(choices);
        const sleep = makeSleep(clock);
        /** @param {0|1} w @param {number} tokenStart */
        const depsFor = (w, tokenStart) => ({
          fs: fs.withGate(sched.gate(w)),
          paths: { appFolder: '/app', dataFolder: DATA, localAppData: '/lad' },
          clock,
          sleep,
          token: makeTokenSource(tokenStart),
          pid: 100 + w,
        });
        const run = (/** @type {0|1} */ w, /** @type {Record<string, unknown>} */ owned) =>
          mergeTopKey(depsFor(w, w * 1000), { topKey: TOP, buildOwned: () => ({ ok: true, owned }), budgetBytes: BYTE_BUDGET }).finally(() => sched.done(w));
        const [a, b] = await Promise.all([run(0, ownedA), run(1, ownedB)]);

        for (const r of [a, b]) {
          if (!r.ok) expect(['lock_timeout', 'too_large']).toContain(r.reason);
        }
        if (foreign) {
          // A fresh lock of someone else is never removed by a writer that does not hold it.
          expect(a).toEqual({ ok: false, reason: 'lock_timeout' });
          expect(b).toEqual({ ok: false, reason: 'lock_timeout' });
          expect(fs.snapshot()).toStrictEqual(before);
          return;
        }
        expect(fs.has(LOCK)).toBe(false);
        expect(fs.paths(DATA).filter((p) => p.includes('.stale-') || p.endsWith('.tmp'))).toEqual([]);

        const after = JSON.parse(/** @type {string} */ (fs.peek(CONFIG)));
        for (const key of Object.keys(config)) if (key !== TOP) expect(after[key]).toStrictEqual(config[key]);
        const oldTop = config[TOP] && typeof config[TOP] === 'object' && !Array.isArray(config[TOP]) ? /** @type {Record<string, any>} */ (config[TOP]) : undefined;
        /** @param {Record<string, unknown>} owned @param {boolean} ok */
        const expectKeys = (owned, ok) => {
          for (const key of Object.keys(owned)) {
            if (ok) expect(after[TOP][key]).toStrictEqual(owned[key]);
            else if (oldTop && key in oldTop) expect(after[TOP]?.[key]).toStrictEqual(oldTop[key]);
            else expect(after[TOP] === undefined || !(key in after[TOP])).toBe(true);
          }
        };
        expectKeys(ownedA, a.ok);
        expectKeys(ownedB, b.ok);
        if (oldTop) {
          for (const sub of Object.keys(oldTop)) {
            if (![...Object.keys(ownedA), ...Object.keys(ownedB)].includes(sub)) expect(after[TOP][sub]).toStrictEqual(oldTop[sub]);
          }
        }
        if (!a.ok && !b.ok) expect(fs.snapshot()).toStrictEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
