// @ts-check
// Feature: packaging. The thin entry scripts under scripts/packaging/ with injected input and output.
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { main, appDataFolder } from '../scripts/packaging/measure-config-route.mjs';
import { main as readRouteMain } from '../scripts/packaging/read-route.mjs';
import { PROBE_KEY } from '../scripts/packaging/config-probe.mjs';
import { CRONS_ROUTE, makeMeasureWorld } from './helpers/packaging-world.mjs';

const TOKEN = 'TOKEN-abc123-SECRET';
const ADDRESS = `http://127.0.0.1:5476/?token=${TOKEN}`;

/**
 * @param {Record<string, unknown>} [over]
 */
function harness(over = {}) {
  /** @type {string[]} */
  const out = [];
  /** @type {number[]} */
  const codes = [];
  /** @type {string[]} */
  const asked = [];
  /** @type {any[]} */
  const ctxs = [];
  /** @type {Array<() => void>} */
  const interrupts = [];
  /** @type {string[]} */
  const urls = [];
  const io = {
    homeDir: '/home/tester',
    buildDeps: () => /** @type {any} */ ({ marker: 'deps' }),
    promptSecret: async (/** @type {string} */ q) => {
      asked.push(`secret:${q}`);
      return ADDRESS;
    },
    promptVisible: async (/** @type {string} */ q) => {
      asked.push(`visible:${q}`);
      return 'http://127.0.0.1:5476';
    },
    fetch: async (/** @type {string} */ url) => {
      urls.push(url);
      return { status: 200, ok: true, text: async () => '{"jobs":[]}' };
    },
    runMeasurement: async (/** @type {any} */ ctx) => {
      ctxs.push(ctx);
      await ctx.read(CRONS_ROUTE);
      return { status: ctx.dryRun ? 'dry-run' : 'ok', steps: [], removal: { done: true, configRestored: true, routeRestored: true } };
    },
    write: (/** @type {string} */ t) => void out.push(t),
    setExitCode: (/** @type {number} */ c) => void codes.push(c),
    onInterrupt: (/** @type {() => void} */ h) => void interrupts.push(h),
    ...over,
  };
  return { io, out, codes, asked, ctxs, interrupts, urls };
}

describe('appDataFolder', () => {
  it('is the data folder of the installed app below the home folder', () => {
    expect(appDataFolder('/home/tester')).toBe(path.join('/home/tester', '.kiro', 'crew', 'apps', 'grimsheet-playtester', 'data'));
  });
});

describe('measure-config-route entry: arguments and prompts', () => {
  it('refuses an unknown flag with a usage line, exit code 2, no prompt and no measurement', async () => {
    const h = harness();
    await main(['--nope'], h.io);
    expect(h.codes).toEqual([2]);
    expect(h.out.join('')).toMatch(/--dry-run/);
    expect(h.asked).toEqual([]);
    expect(h.ctxs).toEqual([]);
  });

  it('passes --dry-run on, and runs a real measurement without it', async () => {
    const a = harness();
    await main(['--dry-run'], a.io);
    expect(a.ctxs[0].dryRun).toBe(true);
    const b = harness();
    await main([], b.io);
    expect(b.ctxs[0].dryRun).toBe(false);
    expect(b.ctxs[0].homeDir).toBe('/home/tester');
  });

  it('takes the origin and the token from the whole address, with one masked prompt and no visible prompt', async () => {
    const h = harness();
    await main([], h.io);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toMatch(/^secret:/);
    expect(h.urls).toEqual([`http://127.0.0.1:5476${CRONS_ROUTE}?token=${encodeURIComponent(TOKEN)}`]);
  });

  it('asks for the origin at a visible prompt when only a token was given', async () => {
    const h = harness({ promptSecret: async (/** @type {string} */ q) => (h.asked.push(`secret:${q}`), TOKEN) });
    await main([], h.io);
    expect(h.asked.map((a) => a.split(':')[0])).toEqual(['secret', 'visible']);
    expect(h.urls[0]?.startsWith('http://127.0.0.1:5476/api/crons?token=')).toBe(true);
  });

  it('stops with exit code 2 and does not repeat the answer when it cannot be used', async () => {
    const h = harness({ promptSecret: async () => 'two words SECRETPIECE' });
    await main([], h.io);
    expect(h.codes).toEqual([2]);
    expect(h.out.join('')).not.toContain('SECRETPIECE');
    expect(h.ctxs).toEqual([]);
  });

  it('stops with exit code 2 when the visible prompt refuses its answer', async () => {
    const h = harness({
      promptSecret: async () => TOKEN,
      promptVisible: async () => {
        throw new Error('that answer holds the token; give only the origin');
      },
    });
    await main([], h.io);
    expect(h.codes).toEqual([2]);
    expect(h.ctxs).toEqual([]);
  });
});

describe('measure-config-route entry: output and exit code', () => {
  it('writes the report as JSON and exits 0 for ok and dry-run, 1 for the others', async () => {
    for (const [status, code] of /** @type {Array<[string, number]>} */ ([
      ['ok', 0],
      ['dry-run', 0],
      ['blocked', 1],
      ['failed', 1],
      ['aborted', 1],
    ])) {
      const h = harness({
        runMeasurement: async () => ({ status, steps: [], removal: { done: true, configRestored: true, routeRestored: true } }),
      });
      await main([], h.io);
      expect(h.codes).toEqual([code]);
      expect(JSON.parse(h.out.join('')).status).toBe(status);
    }
  });

  it('puts a warning that names the probe key in the first line when the removal failed', async () => {
    const h = harness({
      runMeasurement: async () => ({ status: 'failed', steps: [], removal: { done: false, configRestored: false, routeRestored: null } }),
    });
    await main([], h.io);
    const text = h.out.join('');
    const first = text.split('\n')[0] ?? '';
    expect(first).toMatch(/^WARNING/);
    expect(first).toContain(PROBE_KEY);
    expect(h.codes).toEqual([1]);
  });

  it('prints a short message, scrubbed of the token and the home folder, when the measurement throws', async () => {
    const h = harness({
      runMeasurement: async () => {
        throw new Error(`failed for ${TOKEN} in /home/tester/.kiro`);
      },
    });
    await main([], h.io);
    const text = h.out.join('');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('/home/tester');
    expect(h.codes).toEqual([1]);
  });

  it('registers an interrupt handler that aborts the signal of the measurement', async () => {
    const h = harness({
      runMeasurement: async (/** @type {any} */ ctx) => {
        h.ctxs.push(ctx);
        h.interrupts[0]?.();
        return { status: 'aborted', steps: [], removal: { done: true, configRestored: true, routeRestored: true } };
      },
    });
    await main([], h.io);
    expect(h.interrupts).toHaveLength(1);
    expect(h.ctxs[0].signal.aborted).toBe(true);
  });

  it('runs the real measurement through the real reader, and the output holds no token and no home folder', async () => {
    const w = makeMeasureWorld({ limit: 20000 });
    const h = harness({
      homeDir: w.home,
      buildDeps: () => w.deps,
      promptSecret: async () => `http://127.0.0.1:5476/?token=${TOKEN}`,
      fetch: w.fetch,
      runMeasurement: undefined,
    });
    delete (/** @type {any} */ (h.io)).runMeasurement;
    await main([], h.io);
    const text = h.out.join('');
    expect(JSON.parse(text)).toMatchObject({ status: 'ok', removal: { done: true } });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(w.home);
    expect(h.codes).toEqual([0]);
    expect(JSON.parse(/** @type {string} */ (w.memFs.peek(w.configPath)))).toEqual(w.original);
  });
});

describe('read-route entry', () => {
  const CRONS_BODY = JSON.stringify({ jobs: [{ name: 'grimsheet-playtester/replay', is_running: false, last_run_ts: 1731121200, script: 'D:\\secret\\replay_cron.py:run' }] });
  const CONFIG_BODY = JSON.stringify({ playtesterResults: { schemaVersion: 1, latest: { levels: [{ levelId: 'a' }] }, trend: [] } });

  /**
   * @param {Record<string, unknown>} [over]
   */
  function rh(over = {}) {
    /** @type {string[]} */
    const out = [];
    /** @type {number[]} */
    const codes = [];
    /** @type {string[]} */
    const asked = [];
    /** @type {string[]} */
    const urls = [];
    const io = {
      promptSecret: async (/** @type {string} */ q) => (asked.push(`secret:${q}`), ADDRESS),
      promptVisible: async (/** @type {string} */ q) => (asked.push(`visible:${q}`), 'http://127.0.0.1:5476'),
      fetch: async (/** @type {string} */ url) => {
        urls.push(url);
        const body = url.includes('/api/crons') ? CRONS_BODY : CONFIG_BODY;
        return { status: 200, ok: true, text: async () => body };
      },
      write: (/** @type {string} */ t) => void out.push(t),
      setExitCode: (/** @type {number} */ c) => void codes.push(c),
      ...over,
    };
    return { io, out, codes, asked, urls };
  }

  it('refuses a missing or unknown subcommand and extra arguments: usage, exit code 2, no prompt, no request', async () => {
    for (const argv of [[], ['nope'], ['crons', 'extra'], ['--crons']]) {
      const h = rh();
      await readRouteMain(argv, h.io);
      expect(h.codes).toEqual([2]);
      expect(h.out.join('')).toMatch(/crons/);
      expect(h.asked).toEqual([]);
      expect(h.urls).toEqual([]);
    }
  });

  it('crons: reads /api/crons once and prints the summary without the script value or the token', async () => {
    const h = rh();
    await readRouteMain(['crons'], h.io);
    expect(h.urls).toHaveLength(1);
    expect(h.urls[0]).toContain('/api/crons?token=');
    const text = h.out.join('');
    const printed = JSON.parse(text);
    expect(printed).toMatchObject({ route: '/api/crons', status: 200 });
    expect(printed.summary.replayJobFound).toBe(true);
    expect(printed.summary.jobs[0].last_run_ts).toMatchObject({ format: 'epoch-seconds' });
    expect(text).not.toContain('secret');
    expect(text).not.toContain(TOKEN);
    expect(h.codes).toEqual([0]);
  });

  it('config: reads the Config_Route once and prints sizes only', async () => {
    const h = rh();
    await readRouteMain(['config'], h.io);
    expect(h.urls).toHaveLength(1);
    expect(h.urls[0]).toContain('/api/apps/grimsheet-playtester/config?token=');
    const printed = JSON.parse(h.out.join(''));
    expect(printed).toMatchObject({ route: '/api/apps/grimsheet-playtester/config', status: 200 });
    expect(printed.summary).toMatchObject({ bodyBytes: Buffer.byteLength(CONFIG_BODY), levelCount: 1, trendCount: 0, findingsBytes: null });
    expect(h.out.join('')).not.toContain('levelId');
    expect(h.codes).toEqual([0]);
  });

  it('asks for the origin only when a bare token was given', async () => {
    const h = rh({ promptSecret: async () => TOKEN });
    await readRouteMain(['crons'], h.io);
    expect(h.asked.map((a) => a.split(':')[0])).toEqual(['visible']);
    expect(h.urls[0]?.startsWith('http://127.0.0.1:5476/api/crons')).toBe(true);
  });

  it('prints only the status for an answer that is not 2xx, and exits 1', async () => {
    const h = rh({ fetch: async () => ({ status: 401, ok: false, text: async () => `denied for ${TOKEN}` }) });
    await readRouteMain(['crons'], h.io);
    const text = h.out.join('');
    expect(JSON.parse(text)).toMatchObject({ status: 401 });
    expect(text).not.toContain('denied');
    expect(text).not.toContain(TOKEN);
    expect(h.codes).toEqual([1]);
  });

  it('prints a short message and exits 1 for a network error, without the token', async () => {
    const h = rh({
      fetch: async () => {
        throw new Error(`down: ${TOKEN}`);
      },
    });
    await readRouteMain(['config'], h.io);
    const text = h.out.join('');
    expect(text).not.toContain(TOKEN);
    expect(h.codes).toEqual([1]);
  });

  it('stops with exit code 2 and does not repeat an answer that cannot be used', async () => {
    const h = rh({ promptSecret: async () => 'two words SECRETPIECE' });
    await readRouteMain(['crons'], h.io);
    expect(h.codes).toEqual([2]);
    expect(h.out.join('')).not.toContain('SECRETPIECE');
    expect(h.urls).toEqual([]);
  });
});