// @ts-check
// Feature: packaging. The measurement of the config route size (scripts/packaging/measure.mjs).
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SIZES, CAP, BISECT_GAP, runMeasurement, renderReport, displayPath, redactHome } from '../scripts/packaging/measure.mjs';
import { PROBE_KEY } from '../scripts/packaging/config-probe.mjs';
import { readRoute } from '../scripts/packaging/route-reader.mjs';
import { RESULTS_LOCK_FILE } from '../scripts/results-store.mjs';
import { CONFIG_ROUTE, CRONS_ROUTE, FAILURE_MODES, makeMeasureWorld } from './helpers/packaging-world.mjs';
import { makeFakeTimer } from './helpers/packaging-fakes.mjs';

/**
 * @param {ReturnType<typeof makeMeasureWorld>} w
 * @param {Record<string, unknown>} [over]
 */
const ctxOf = (w, over = {}) => ({ deps: w.deps, read: w.read, dryRun: false, homeDir: w.home, ...over });

/**
 * Every string inside a value, keys included.
 * @param {any} v
 * @param {string[]} [out]
 * @returns {string[]}
 */
function allStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) allStrings(x, out);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.push(k), allStrings(x, out));
  return out;
}

describe('constants', () => {
  it('uses the six sizes of R6.4, then doubling to 1 MiB, and bisects to 1024 bytes', () => {
    expect([...SIZES]).toEqual([16384, 32768, 49152, 65536, 98304, 131072, 262144, 524288, 1048576]);
    expect(CAP).toBe(1048576);
    expect(BISECT_GAP).toBe(1024);
  });
});

describe('runMeasurement: a normal run', () => {
  it('writes each size, reads the route after each, and finds no failure up to 1 MiB for a route without a limit', async () => {
    const w = makeMeasureWorld();
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('ok');
    expect(report.steps.map((s) => s.probeBytes)).toEqual([...SIZES]);
    expect(report.steps.every((s) => s.phase === 'ladder' && s.good && s.status === 200)).toBe(true);
    expect(report).toMatchObject({ largestGood: CAP, firstBad: null, reachedCap: true });
    expect(report.removal).toEqual({ done: true, configRestored: true, routeRestored: true });
    expect(w.memFs.paths(w.data)).toEqual([w.configPath]);
    expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(w.original);
  });

  it('records, for each step, the probe size, the status, the body size and whether the body parses and equals what was written', async () => {
    const w = makeMeasureWorld({ limit: 40000 });
    const report = await runMeasurement(ctxOf(w));
    const first = report.steps[0];
    expect(first).toMatchObject({ phase: 'ladder', probeBytes: 16384, status: 200, good: true, parsed: true, equal: true });
    expect(typeof first?.bodyBytes).toBe('number');
    expect(first?.bodyBytes).toBeGreaterThan(16384);
    const bad = report.steps.find((s) => !s.good);
    expect(bad).toMatchObject({ probeBytes: 49152, status: 413, parsed: true, equal: false });
  });

  it('with a first step that fails, bisects from 0 down to a gap of 1024', async () => {
    const w = makeMeasureWorld({ limit: 0 });
    const report = await runMeasurement(ctxOf(w));
    expect(report.steps.map((s) => [s.phase, s.probeBytes])).toEqual([
      ['ladder', 16384],
      ['bisect', 8192],
      ['bisect', 4096],
      ['bisect', 2048],
      ['bisect', 1024],
    ]);
    expect(report).toMatchObject({ largestGood: 0, firstBad: 1024, reachedCap: false });
    expect(report.removal.done).toBe(true);
  });

  it('shows the data folder and every path as ~, never the home folder', async () => {
    const w = makeMeasureWorld({ home: '/home/tester' });
    const report = await runMeasurement(ctxOf(w));
    expect(report.dataFolder).toBe('~/.kiro/crew/apps/grimsheet-playtester/data');
    expect(renderReport(report)).not.toContain('/home/tester');
  });

  it('renders the report as JSON text that parses back to the report', async () => {
    const w = makeMeasureWorld({ limit: 70000 });
    const report = await runMeasurement(ctxOf(w));
    expect(JSON.parse(renderReport(report))).toEqual(JSON.parse(JSON.stringify(report)));
  });

  it('takes the results lock for each write and leaves none behind', async () => {
    const w = makeMeasureWorld({ limit: 20000 });
    await runMeasurement(ctxOf(w));
    expect(w.memFs.has(`${w.data}/${RESULTS_LOCK_FILE}`)).toBe(false);
  });
});

describe('runMeasurement: the dry run', () => {
  it('writes nothing, reads /api/crons and the Config_Route once each, and lists the planned sizes', async () => {
    const w = makeMeasureWorld();
    const before = w.memFs.snapshot();
    const report = await runMeasurement(ctxOf(w, { dryRun: true }));
    expect(report.status).toBe('dry-run');
    expect(report.plannedSizes).toEqual([...SIZES]);
    expect(report.steps).toEqual([]);
    expect(w.memFs.snapshot()).toEqual(before);
    expect(w.requested).toEqual([CRONS_ROUTE, CONFIG_ROUTE]);
  });

  it('shows a blocker in a dry run too', async () => {
    const w = makeMeasureWorld({ jobs: [{ name: 'replay', is_running: true }] });
    const report = await runMeasurement(ctxOf(w, { dryRun: true }));
    expect(report.status).toBe('blocked');
  });
});

describe('runMeasurement: the pre-checks refuse before any write', () => {
  /**
   * @param {WorldLike} w
   * @param {RegExp} reason
   */
  async function expectBlocked(w, reason) {
    const before = w.memFs.snapshot();
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('blocked');
    expect(report.message).toMatch(reason);
    expect(report.steps).toEqual([]);
    expect(w.memFs.snapshot()).toEqual(before);
    expect(w.requested.filter((p) => p === CONFIG_ROUTE)).toEqual([]);
  }
  /** @typedef {ReturnType<typeof makeMeasureWorld>} WorldLike */

  it('when the replay job is running', async () => {
    await expectBlocked(makeMeasureWorld({ jobs: [{ name: 'replay', is_running: true }] }), /running/i);
  });

  it('when the replay job is not in /api/crons, or the route fails', async () => {
    await expectBlocked(makeMeasureWorld({ jobs: [{ name: 'other', is_running: false }] }), /replay job/i);
    await expectBlocked(makeMeasureWorld({ cronsStatus: 500 }), /api\/crons/);
  });

  it('when a fresh run lock or hunt lock exists, and goes on when it is stale', async () => {
    const fresh = makeMeasureWorld();
    fresh.memFs.seedFile(`${fresh.data}/.run.lock`, JSON.stringify({ pid: 1, token: 't', createdAt: new Date(fresh.clock.nowMs() - 60000).toISOString() }));
    await expectBlocked(fresh, /run lock/i);
    const hunt = makeMeasureWorld();
    hunt.memFs.seedFile(`${hunt.data}/.hunt.lock`, JSON.stringify({ pid: 1, token: 't', createdAt: new Date(hunt.clock.nowMs() - 60000).toISOString() }));
    await expectBlocked(hunt, /hunt lock/i);
    const stale = makeMeasureWorld({ limit: 20000 });
    stale.memFs.seedFile(`${stale.data}/.run.lock`, JSON.stringify({ pid: 1, token: 't', createdAt: new Date(stale.clock.nowMs() - 901000).toISOString() }));
    stale.memFs.seedFile(`${stale.data}/.hunt.lock`, JSON.stringify({ pid: 1, token: 't', createdAt: new Date(stale.clock.nowMs() - 2401000).toISOString() }));
    expect((await runMeasurement(ctxOf(stale))).status).toBe('ok');
  });

  it('when config.json is missing, is not valid JSON, or is not an object; and when the data folder is missing', async () => {
    await expectBlocked(makeMeasureWorld({ config: null }), /config\.json/);
    for (const text of ['{ nope', '[1]', '"x"']) {
      const w = makeMeasureWorld();
      w.memFs.seedFile(w.configPath, text);
      await expectBlocked(w, /config\.json/);
    }
    await expectBlocked(makeMeasureWorld({ seedFolder: false }), /data folder/i);
  });
});

describe('runMeasurement: the probe is always removed', () => {
  it('when a read throws', async () => {
    const w = makeMeasureWorld();
    let reads = 0;
    const read = async (/** @type {string} */ path) => {
      if (path === CONFIG_ROUTE && ++reads === 3) throw new Error(`boom while reading ${w.configPath}`);
      return w.read(path);
    };
    const report = await runMeasurement(ctxOf(w, { read }));
    expect(report.status).toBe('failed');
    expect(report.message).toMatch(/unexpected error/i);
    expect(report.message).not.toContain(w.home);
    expect(report.removal.done).toBe(true);
    expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(w.original);
  });

  it('when the signal aborts after the second step', async () => {
    const w = makeMeasureWorld();
    const controller = new AbortController();
    let reads = 0;
    const read = async (/** @type {string} */ path) => {
      const r = await w.read(path);
      // The first read of the Config_Route is the pre-check (R6.16); reads 2 and 3 are the first two ladder steps.
      if (path === CONFIG_ROUTE && ++reads === 3) controller.abort();
      return r;
    };
    const report = await runMeasurement(ctxOf(w, { read, signal: controller.signal }));
    expect(report.status).toBe('aborted');
    expect(report.steps).toHaveLength(2);
    expect(report.removal.done).toBe(true);
    expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(w.original);
  });

  it('when a write fails, it stops and reports the reason', async () => {
    const w = makeMeasureWorld();
    const failing = w.memFs.withGate(async (label) => {
      if (label.startsWith('writeFile') && label.includes('.config.')) throw new Error('disk full');
    });
    const deps = { ...w.deps, fs: /** @type {any} */ (failing) };
    const report = await runMeasurement(ctxOf(w, { deps }));
    expect(report.status).toBe('failed');
    expect(report.message).toMatch(/write_failed/);
    expect(report.steps).toEqual([]);
    expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(w.original);
  });

  it('names the key to remove by hand when the removal itself fails', async () => {
    const w = makeMeasureWorld({ limit: 20000 });
    let armed = false;
    let configReads = 0;
    const gated = w.memFs.withGate(async (label) => {
      if (armed && label.startsWith('rename') && label.includes('.config.')) throw new Error('locked');
    });
    const deps = { ...w.deps, fs: /** @type {any} */ (gated) };
    const read = async (/** @type {string} */ path) => {
      const r = await w.read(path);
      // The first read of the Config_Route is the pre-check, before any write; arm after the first ladder step.
      if (path === CONFIG_ROUTE && ++configReads === 2) armed = true;
      return r;
    };
    const report = await runMeasurement(ctxOf(w, { deps, read }));
    expect(report.removal.done).toBe(false);
    expect(report.message).toContain(PROBE_KEY);
  });
});

describe('runMeasurement: good, bad and blocked steps (R6.14 to R6.17)', () => {
  /**
   * A read that answers like the world, except where `change` returns a different result.
   * @param {ReturnType<typeof makeMeasureWorld>} w
   * @param {(path: string, n: number) => import('../scripts/packaging/route-reader.mjs').RouteResult | undefined} change n counts the reads of the Config_Route from 1
   */
  function readWith(w, change) {
    let n = 0;
    return async (/** @type {string} */ path) => {
      if (path === CONFIG_ROUTE) n += 1;
      return change(path, n) ?? w.read(path);
    };
  }

  it('blocks before any write when every GET answers 403, and records no limit', async () => {
    const w = makeMeasureWorld({ cronsStatus: 403, configStatus: 403 });
    const before = w.memFs.snapshot();
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('blocked');
    expect(report.message.startsWith('access_refused 403')).toBe(true);
    expect(report.steps).toEqual([]);
    expect(report).toMatchObject({ largestGood: 0, firstBad: null, reachedCap: false });
    expect(w.memFs.snapshot()).toEqual(before);
  });

  it('blocks before any write when only the Config_Route answers 403 (the pre-check reads it)', async () => {
    const w = makeMeasureWorld({ configStatus: 403 });
    const before = w.memFs.snapshot();
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('blocked');
    expect(report.message.startsWith('access_refused 403')).toBe(true);
    expect(report.message).toContain(CONFIG_ROUTE);
    expect(report.steps).toEqual([]);
    expect(w.requested).toEqual([CRONS_ROUTE, CONFIG_ROUTE]);
    expect(w.memFs.snapshot()).toEqual(before);
  });

  it('blocks a dry run too, and a dry run reads the Config_Route', async () => {
    const w = makeMeasureWorld({ configStatus: 403 });
    const before = w.memFs.snapshot();
    const report = await runMeasurement(ctxOf(w, { dryRun: true }));
    expect(report.status).toBe('blocked');
    expect(report.message.startsWith('access_refused 403')).toBe(true);
    expect(report.plannedSizes).toBeUndefined();
    expect(w.requested).toEqual([CRONS_ROUTE, CONFIG_ROUTE]);
    expect(w.memFs.snapshot()).toEqual(before);
  });

  it('blocks when the Config_Route answers a body that is not a JSON object before any write', async () => {
    const w = makeMeasureWorld();
    const read = readWith(w, (path) => (path === CONFIG_ROUTE ? { ok: true, kind: 'response', status: 200, bytes: 4, bodyText: 'oops', ms: 1 } : undefined));
    const before = w.memFs.snapshot();
    const report = await runMeasurement(ctxOf(w, { read }));
    expect(report.status).toBe('blocked');
    expect(report.message.startsWith('unexpected_body')).toBe(true);
    expect(w.memFs.snapshot()).toEqual(before);
  });

  it('blocks when the first step answers 403: no bisect, the probe is removed, no limit', async () => {
    const w = makeMeasureWorld({ limit: 0, failStatus: 403 });
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('blocked');
    expect(report.message.startsWith('access_refused 403 at 16384 bytes')).toBe(true);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({ phase: 'ladder', probeBytes: 16384, status: 403, good: false, reason: 'Forbidden' });
    expect(report).toMatchObject({ largestGood: 0, firstBad: null, reachedCap: false });
    expect(report.removal).toEqual({ done: true, configRestored: true, routeRestored: true });
    expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(w.original);
  });

  it('blocks when the first step is good and the second answers 403: never a size failure', async () => {
    const w = makeMeasureWorld({ limit: 20000, failStatus: 403 });
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('blocked');
    expect(report.message.startsWith('access_refused 403 at 32768 bytes')).toBe(true);
    expect(report.steps.map((s) => [s.phase, s.probeBytes, s.good, s.status])).toEqual([
      ['ladder', 16384, true, 200],
      ['ladder', 32768, false, 403],
    ]);
    expect(report).toMatchObject({ largestGood: 16384, firstBad: null, reachedCap: false });
    expect(report.removal).toEqual({ done: true, configRestored: true, routeRestored: true });
    expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(w.original);
  });

  it('starts the bisect when the first step answers 413', async () => {
    const w = makeMeasureWorld({ limit: 0 });
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('ok');
    expect(report.steps[0]).toMatchObject({ phase: 'ladder', probeBytes: 16384, status: 413, good: false, reason: 'too large' });
    expect(report.steps.slice(1).every((s) => s.phase === 'bisect' && s.status === 413)).toBe(true);
    expect(report).toMatchObject({ largestGood: 0, firstBad: 1024 });
  });

  it('continues into the bisect when a later step answers 413', async () => {
    const w = makeMeasureWorld({ limit: 40000 });
    const report = await runMeasurement(ctxOf(w));
    expect(report.status).toBe('ok');
    expect(report.steps.map((s) => s.phase)).toContain('bisect');
    expect(report.steps.filter((s) => !s.good).every((s) => s.status === 413)).toBe(true);
    expect(/** @type {number} */ (report.firstBad) - report.largestGood).toBeLessThanOrEqual(BISECT_GAP);
  });

  it('counts a 200 whose body is cut, does not parse, or differs from the probe as bad, with a reason', async () => {
    const cut = makeMeasureWorld({ limit: 40000, mode: 'truncated' });
    const r1 = await runMeasurement(ctxOf(cut));
    expect(r1.status).toBe('ok');
    expect(r1.steps.find((s) => !s.good)).toMatchObject({ status: 200, parsed: false, equal: false, reason: 'the body does not parse' });
    const notJson = makeMeasureWorld({ limit: 40000, mode: 'not-json' });
    const r2 = await runMeasurement(ctxOf(notJson));
    expect(r2.status).toBe('ok');
    expect(r2.steps.find((s) => !s.good)?.reason).toBe('the body does not parse');
    const differs = makeMeasureWorld({ limit: 40000 });
    const read = readWith(differs, (path, n) => (path === CONFIG_ROUTE && n >= 2 && /** @type {any} */ (differs.memFs.peek(differs.configPath)).length > 30000 ? { ok: true, kind: 'response', status: 200, bytes: 2, bodyText: '{}', json: {}, ms: 1 } : undefined));
    const r3 = await runMeasurement(ctxOf(differs, { read }));
    expect(r3.status).toBe('ok');
    expect(r3.steps.find((s) => !s.good)).toMatchObject({ status: 200, parsed: true, equal: false });
    expect(r3.steps.find((s) => !s.good)?.reason).toMatch(/differs from what was written/);
  });

  it('blocks on a network error, with the reason network', async () => {
    const w = makeMeasureWorld({ limit: 50000 });
    const read = readWith(w, (path, n) => (path === CONFIG_ROUTE && n === 3 ? { ok: false, kind: 'network', message: 'the request failed: TypeError: fetch failed' } : undefined));
    const report = await runMeasurement(ctxOf(w, { read }));
    expect(report.status).toBe('blocked');
    expect(report.message.startsWith('network at 32768 bytes')).toBe(true);
    expect(report.steps.at(-1)).toMatchObject({ kind: 'network', good: false, status: null });
    expect(report.firstBad).toBeNull();
    expect(report.removal.done).toBe(true);
  });

  it('gives a reason of at most 80 characters, preferring the error text of the answer, with whitespace collapsed', async () => {
    const w = makeMeasureWorld({ limit: 20000 });
    const long = `${'word  '.repeat(60)}`;
    const read = readWith(w, (path, n) => (path === CONFIG_ROUTE && n === 3 ? { ok: false, kind: 'response', status: 413, bytes: 300, bodyText: long, ms: 1 } : undefined));
    const report = await runMeasurement(ctxOf(w, { read }));
    const bad = report.steps.find((s) => !s.good);
    expect(bad?.reason?.length).toBeLessThanOrEqual(80);
    expect(bad?.reason?.startsWith('word word')).toBe(true);
    expect(bad?.reason).not.toMatch(/\s{2,}/);
  });

  it('gives a short reason when the route is not restored after the removal', async () => {
    /** @type {Array<[string, import('../scripts/packaging/route-reader.mjs').RouteResult, string]>} */
    const cases = [
      ['status', { ok: false, kind: 'response', status: 403, bytes: 47, bodyText: '{"detail":"Forbidden"}', ms: 1 }, 'status 403'],
      ['timeout', { ok: false, kind: 'timeout', message: 'the request took longer than 15 seconds' }, 'timeout'],
      ['network', { ok: false, kind: 'network', message: 'the request failed' }, 'network'],
      ['differs', { ok: true, kind: 'response', status: 200, bytes: 12, bodyText: '{"theme":"x"}', json: { theme: 'x' }, ms: 1 }, 'differs from the file before the run'],
    ];
    for (const [, answer, reason] of cases) {
      const w = makeMeasureWorld({ limit: 0 });
      // With limit 0 the reads of the Config_Route are: the pre-check (1), the ladder step (2), four bisect steps (3 to 6), the read after the removal (7).
      const read = readWith(w, (path, n) => (path === CONFIG_ROUTE && n === 7 ? answer : undefined));
      const report = await runMeasurement(ctxOf(w, { read }));
      expect(report.removal).toEqual({ done: true, configRestored: true, routeRestored: false, routeReason: reason });
    }
  });
});
describe('measurement properties', () => {
  const arbConfig = fc
    .dictionary(
      fc.string({ maxLength: 10 }).filter((k) => k !== PROBE_KEY),
      fc.jsonValue({ maxDepth: 2 }),
      { maxKeys: 5 },
    )
    .map((o) => /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(o))));

  // Feature: packaging, Property 8: the measurement finds the boundary
  it('Property 8: the boundary is found within 1024 bytes for every limit and every size failure mode, a timeout blocks the run, and the probe is removed', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2 * 1024 * 1024 }), fc.constantFrom(...FAILURE_MODES), arbConfig, async (limit, mode, config) => {
        const w = makeMeasureWorld({ limit, mode, config });
        const report = await runMeasurement(ctxOf(w));
        for (const s of report.steps) expect(s.good).toBe(s.probeBytes <= limit);
        const goods = report.steps.filter((s) => s.good).map((s) => s.probeBytes);
        const bads = report.steps.filter((s) => !s.good).map((s) => s.probeBytes);
        expect(report.largestGood).toBe(goods.length ? Math.max(...goods) : 0);
        if (limit >= CAP) {
          expect(report.status).toBe('ok');
          expect(report).toMatchObject({ reachedCap: true, firstBad: null, largestGood: CAP });
          expect(report.steps).toHaveLength(SIZES.length);
        } else if (mode === 'timeout') {
          // A timeout is not a size failure (R6.14): the run is blocked at the first size above the limit, with no bisect.
          expect(report.status).toBe('blocked');
          expect(report.message).toMatch(/^timeout/);
          expect(report.steps.every((s) => s.phase === 'ladder')).toBe(true);
          expect(bads).toHaveLength(1);
          expect(report.steps.at(-1)?.kind).toBe('timeout');
          expect(report.firstBad).toBeNull();
          expect(report.reachedCap).toBe(false);
        } else {
          expect(report.status).toBe('ok');
          expect(report.reachedCap).toBe(false);
          expect(report.firstBad).toBe(Math.min(...bads));
          expect(/** @type {number} */ (report.firstBad)).toBeGreaterThan(limit);
          expect(report.largestGood).toBeLessThanOrEqual(limit);
          expect(/** @type {number} */ (report.firstBad) - report.largestGood).toBeLessThanOrEqual(BISECT_GAP);
        }
        expect(report.removal).toEqual({ done: true, configRestored: true, routeRestored: true });
        expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(config);
        expect(w.memFs.paths(w.data)).toEqual([w.configPath]);
      }),
      { numRuns: 100 },
    );
    // 30 s: each of the 100 cases runs a full ladder and bisect with probes up to 1 MiB, and a CI runner is about 3x slower than this machine.
  }, 30000);

  // Feature: packaging, Property 8b: a status that is not a size failure blocks the run
  it('Property 8b: a status other than 200 and 413 blocks the run at the first size above the limit, with no bisect and no limit recorded', async () => {
    const arbStatus = fc.constantFrom(401, 403, 404, 500, 502, 503, 204, 301, 429);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2 * 1024 * 1024 }), arbStatus, async (limit, failStatus) => {
        const w = makeMeasureWorld({ limit, mode: 'status', failStatus });
        const report = await runMeasurement(ctxOf(w));
        if (limit >= CAP) {
          expect(report.status).toBe('ok');
        } else {
          const expected = failStatus === 401 || failStatus === 403 ? `access_refused ${failStatus}` : `unexpected_status ${failStatus}`;
          expect(report.status).toBe('blocked');
          expect(report.message.startsWith(expected)).toBe(true);
          expect(report.steps.every((s) => s.phase === 'ladder')).toBe(true);
          expect(report.steps.filter((s) => !s.good)).toHaveLength(1);
          expect(report.steps.at(-1)?.status).toBe(failStatus);
          expect(report.firstBad).toBeNull();
          expect(report.reachedCap).toBe(false);
        }
        expect(report.removal).toEqual({ done: true, configRestored: true, routeRestored: true });
        expect(w.memFs.paths(w.data)).toEqual([w.configPath]);
      }),
      { numRuns: 100 },
    );
  }, 30000);
  // Feature: packaging, Property 9: the token never leaves (end to end)
  it('Property 9: the report and every write of the fake file system hold no token, through the real reader', async () => {
    const arbToken = fc.stringMatching(/^[\x21-\x7e]{8,64}$/);
    const arbBehaviour = fc.constantFrom('ok', 'echo-401', 'throw', 'url-in-body');
    await fc.assert(
      fc.asyncProperty(arbToken, arbBehaviour, fc.constantFrom('query', 'bearer'), fc.integer({ min: 0, max: 200000 }), async (token, behaviour, form, limit) => {
        const w = makeMeasureWorld({ limit });
        let calls = 0;
        /** @param {string} url */
        const fetch = async (url) => {
          calls += 1;
          if (calls > 3 && behaviour === 'echo-401') return { status: 401, ok: false, text: async () => `denied for ${token} and ${encodeURIComponent(token)}` };
          if (calls > 3 && behaviour === 'throw') throw new Error(`failed ${url} with ${token}`);
          if (calls > 3 && behaviour === 'url-in-body') return { status: 500, ok: false, text: async () => `request was ${url}` };
          return w.fetch(url);
        };
        const timer = makeFakeTimer(false);
        const read = (/** @type {string} */ path) =>
          readRoute({ fetch, origin: 'http://127.0.0.1:5476', token, path, form: /** @type {'query'|'bearer'} */ (form), ...timer });
        const report = await runMeasurement(ctxOf(w, { read }));
        const forms = [token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)];
        const texts = [...allStrings(report), renderReport(report), ...Object.values(w.memFs.snapshot())];
        for (const t of texts) for (const f of forms) expect(t.includes(f)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: packaging, Property 11: the home path is hidden
  it('Property 11: the report and its messages hold no home folder, in a normal run and in every failure', async () => {
    const arbHome = fc.oneof(
      fc.stringMatching(/^\/home\/[a-z][a-z0-9]{3,12}$/),
      fc.stringMatching(/^[A-Z]:\/Users\/[A-Za-z][A-Za-z0-9]{3,12}$/),
    );
    const arbScenario = fc.constantFrom('ok', 'config-missing', 'crons-fail', 'job-running', 'read-throws', 'write-fails', 'folder-missing');
    await fc.assert(
      fc.asyncProperty(arbHome, arbScenario, async (home, scenario) => {
        const w = makeMeasureWorld({
          home,
          limit: 30000,
          config: scenario === 'config-missing' ? null : undefined,
          cronsStatus: scenario === 'crons-fail' ? 500 : undefined,
          jobs: scenario === 'job-running' ? [{ name: 'replay', is_running: true }] : undefined,
          seedFolder: scenario === 'folder-missing' ? false : undefined,
        });
        let deps = w.deps;
        if (scenario === 'write-fails') {
          const g = w.memFs.withGate(async (label) => {
            if (label.startsWith('writeFile') && label.includes('.config.')) throw new Error(`cannot write ${w.data}/x`);
          });
          deps = { ...w.deps, fs: /** @type {any} */ (g) };
        }
        let reads = 0;
        const read = async (/** @type {string} */ path) => {
          if (scenario === 'read-throws' && path === CONFIG_ROUTE && ++reads === 2) throw new Error(`boom at ${w.configPath} in ${home}`);
          return w.read(path);
        };
        const report = await runMeasurement(ctxOf(w, { deps, read }));
        for (const t of [...allStrings(report), renderReport(report)]) expect(t.includes(home)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('displayPath and redactHome', () => {
  it('shows a path below the home folder as ~, with either slash style', () => {
    expect(displayPath('/home/u/.kiro/x', '/home/u')).toBe('~/.kiro/x');
    expect(displayPath('C:\\Users\\u\\.kiro\\x', 'C:\\Users\\u')).toBe('~\\.kiro\\x');
    expect(displayPath('C:/Users/u/.kiro/x', 'C:\\Users\\u')).toBe('~/.kiro/x');
    expect(displayPath('/elsewhere/x', '/home/u')).toBe('/elsewhere/x');
  });

  it('replaces every occurrence of the home folder in a text, in both slash styles', () => {
    expect(redactHome('a C:\\Users\\u\\x b C:/Users/u/y', 'C:\\Users\\u')).toBe('a ~\\x b ~/y');
    expect(redactHome('no path', '/home/u')).toBe('no path');
    expect(redactHome('abc', '')).toBe('abc');
  });
});
