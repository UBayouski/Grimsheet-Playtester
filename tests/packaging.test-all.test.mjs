// @ts-check
// Feature: packaging. The combined test command (scripts/test-all.mjs): six steps, one at a time, stopping at the first failure.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { STEPS, STALE_MESSAGE, compareBundle, main, runBundleStep, runSteps, startProcess } from '../scripts/test-all.mjs';
import { makeFakeRunner } from './helpers/packaging-fakes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('STEPS', () => {
  it('lists the six steps of the design, in order, with their commands and folders', () => {
    expect(STEPS.map((s) => [s.label, s.folder, s.kind ?? 'process', s.command ?? null, s.args ?? null, s.shell ?? null])).toEqual([
      ['root tests', '.', 'process', 'npm test', null, true],
      ['root typecheck', '.', 'process', 'npm run typecheck', null, true],
      ['launcher tests', '.', 'process', 'python', ['-m', 'unittest', 'tests.test_replay_cron'], false],
      ['ui tests', 'ui', 'process', 'npm test', null, true],
      ['ui typecheck', 'ui', 'process', 'npm run typecheck', null, true],
      ['bundle is fresh', 'ui', 'bundle', null, null, null],
    ]);
  });

  it('is wired to the root package.json as the script test:all', () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
    expect(pkg.scripts['test:all']).toBe('node scripts/test-all.mjs');
  });
});

describe('runSteps', () => {
  /** @returns {{lines: string[], log: (l: string) => void}} */
  function logger() {
    /** @type {string[]} */
    const lines = [];
    return { lines, log: (l) => void lines.push(l) };
  }

  it('runs every step once, in order, and says so when all pass', async () => {
    const runner = makeFakeRunner([0, 0, 0, 0, 0, 0]);
    const { lines, log } = logger();
    expect(await runSteps(runner, STEPS, log)).toBe(0);
    expect(runner.calls).toEqual(STEPS.map((s) => s.label));
    expect(lines[0]).toBe('[test:all] step 1 of 6: root tests');
    expect(lines.at(-1)).toBe('[test:all] all 6 steps passed');
  });

  it('stops at the first failing step and returns its exit code', async () => {
    const runner = makeFakeRunner([0, 0, 3, 0, 0, 0]);
    const { lines, log } = logger();
    expect(await runSteps(runner, STEPS, log)).toBe(3);
    expect(runner.calls).toEqual(['root tests', 'root typecheck', 'launcher tests']);
    expect(lines.at(-1)).toBe('[test:all] step 3 of 6 failed: launcher tests (exit code 3)');
  });

  it('prints could not start and returns 1 for a step that cannot start', async () => {
    const runner = makeFakeRunner([0, 0, null, 0, 0, 0]);
    const { lines, log } = logger();
    expect(await runSteps(runner, STEPS, log)).toBe(1);
    expect(lines.at(-1)).toBe('[test:all] could not start: launcher tests');
    expect(runner.calls).toHaveLength(3);
  });

  // Feature: packaging, Property 13: test:all runs in order and stops at the first failure
  it('Property 13: the runner is called up to the first non-zero step, in order, one at a time, and the code is that exit code', async () => {
    const arbCode = fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, { weight: 3, arbitrary: fc.integer({ min: 1, max: 255 }) }, { weight: 1, arbitrary: fc.constant(null) });
    await fc.assert(
      fc.asyncProperty(fc.array(arbCode, { minLength: 6, maxLength: 6 }), async (codes) => {
        const runner = makeFakeRunner(codes);
        const code = await runSteps(runner, STEPS, () => {});
        const first = codes.findIndex((c) => c !== 0);
        if (first === -1) {
          expect(code).toBe(0);
          expect(runner.calls).toEqual(STEPS.map((s) => s.label));
        } else {
          const expected = codes[first] === null ? 1 : codes[first];
          expect(code).toBe(expected);
          expect(runner.calls).toEqual(STEPS.slice(0, first + 1).map((s) => s.label));
        }
        expect(runner.maxInFlight()).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });
});

describe('compareBundle', () => {
  it('passes for equal bytes and fails with the one-line message otherwise', () => {
    expect(compareBundle(Buffer.from('abc'), Buffer.from('abc'))).toEqual({ ok: true });
    const r = compareBundle(Buffer.from('abc'), Buffer.from('abd'));
    expect(r).toEqual({ ok: false, message: STALE_MESSAGE });
    expect(compareBundle(Buffer.from('abc'), null)).toEqual({ ok: false, message: STALE_MESSAGE });
    expect(compareBundle(null, Buffer.from('abc'))).toEqual({ ok: false, message: STALE_MESSAGE });
  });

  it('has a message of one line that names the fix', () => {
    expect(STALE_MESSAGE).not.toMatch(/[\r\n]/);
    expect(STALE_MESSAGE).toContain('npm run build');
    expect(STALE_MESSAGE).toContain('ui/dist/index.mjs');
    expect(STALE_MESSAGE).toContain('commit');
  });

  // Feature: packaging, Property 14: the bundle comparison is exact
  it('Property 14: equal bytes pass; any changed, inserted or removed byte, or a missing file, fails with the one-line message', () => {
    const arbBytes = fc.uint8Array({ minLength: 1, maxLength: 200 });
    fc.assert(
      fc.property(arbBytes, fc.nat(), fc.integer({ min: 1, max: 255 }), fc.nat({ max: 255 }), (bytes, pos, xor, extra) => {
        const a = Buffer.from(bytes);
        expect(compareBundle(a, Buffer.from(bytes))).toEqual({ ok: true });
        const i = pos % a.length;
        const changed = Buffer.from(bytes);
        changed[i] = (changed[i] ?? 0) ^ xor;
        const inserted = Buffer.concat([a.subarray(0, i), Buffer.from([extra]), a.subarray(i)]);
        const removed = Buffer.concat([a.subarray(0, i), a.subarray(i + 1)]);
        const appended = Buffer.concat([a, Buffer.from([extra])]);
        for (const other of [changed, inserted, removed, appended]) {
          const r = compareBundle(a, other);
          expect(r.ok).toBe(false);
          expect('message' in r && r.message).toBe(STALE_MESSAGE);
        }
        expect(compareBundle(a, null).ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe('runBundleStep', () => {
  /**
   * @param {{fresh?: Buffer|null, committed?: Buffer|null, buildCode?: number, buildThrows?: boolean}} [o]
   */
  function bundleIo(o = {}) {
    /** @type {string[]} */
    const lines = [];
    /** @type {Array<{args: string[], cwd: string}>} */
    const builds = [];
    /** @type {string[]} */
    const removed = [];
    const temp = path.join('/tmp', 'pkg-bundle-x');
    const io = {
      root: '/repo',
      log: (/** @type {string} */ l) => void lines.push(l),
      mkdtemp: async () => temp,
      rm: async (/** @type {string} */ p) => void removed.push(p),
      readFile: async (/** @type {string} */ p) => {
        const value = p.startsWith(temp) ? (o.fresh === undefined ? Buffer.from('bundle') : o.fresh) : o.committed === undefined ? Buffer.from('bundle') : o.committed;
        if (value === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return value;
      },
      runNode: async (/** @type {string[]} */ args, /** @type {string} */ cwd) => {
        builds.push({ args, cwd });
        if (o.buildThrows) throw new Error('could not start node');
        return o.buildCode ?? 0;
      },
    };
    return { io, lines, builds, removed, temp };
  }

  it('builds with --outDir into the temp folder (never ui/dist), compares, and removes the temp folder', async () => {
    const { io, builds, removed, temp } = bundleIo();
    expect(await runBundleStep(io)).toBe(0);
    expect(builds).toHaveLength(1);
    expect(builds[0]?.args).toEqual([path.join('/repo', 'ui', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', temp, '--emptyOutDir']);
    expect(builds[0]?.cwd).toBe(path.join('/repo', 'ui'));
    expect(builds[0]?.args.some((a) => a.replace(/\\/g, '/').includes('ui/dist'))).toBe(false);
    expect(removed).toEqual([temp]);
  });

  it('prints the one-line message and returns 1 when the bundle is stale or missing', async () => {
    for (const committed of [Buffer.from('other'), null]) {
      const { io, lines, removed, temp } = bundleIo({ committed });
      expect(await runBundleStep(io)).toBe(1);
      expect(lines).toEqual([STALE_MESSAGE]);
      expect(removed).toEqual([temp]);
    }
  });

  it('returns the exit code of a failed build, compares nothing, and still removes the temp folder', async () => {
    const { io, lines, removed, temp } = bundleIo({ buildCode: 7, committed: Buffer.from('other') });
    expect(await runBundleStep(io)).toBe(7);
    expect(lines).toEqual([]);
    expect(removed).toEqual([temp]);
  });

  it('removes the temp folder when the build cannot start or the fresh file cannot be read', async () => {
    const a = bundleIo({ buildThrows: true });
    await expect(runBundleStep(a.io)).rejects.toThrow(/could not start/);
    expect(a.removed).toEqual([a.temp]);
    const b = bundleIo({ fresh: null });
    expect(await runBundleStep(b.io)).toBe(1);
    expect(b.removed).toEqual([b.temp]);
  });
});

describe('startProcess', () => {
  /**
   * @param {{code?: number|null, signal?: string|null, error?: Error}} o
   */
  function fakeSpawn(o) {
    /** @type {Array<{command: string, args: any, options: any}>} */
    const calls = [];
    const spawn = (/** @type {string} */ command, /** @type {any} */ args, /** @type {any} */ options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => {
        if (o.error) child.emit('error', o.error);
        else child.emit('close', 'code' in o ? o.code : 0, o.signal ?? null);
      });
      return child;
    };
    return { spawn, calls };
  }

  it('starts npm as a fixed command string with a shell, in the folder of the step, with inherited output', async () => {
    const { spawn, calls } = fakeSpawn({ code: 0 });
    const step = /** @type {any} */ (STEPS[3]);
    expect(await startProcess(spawn, step, '/repo')).toBe(0);
    expect(calls[0]?.command).toBe('npm test');
    expect(calls[0]?.options).toMatchObject({ shell: true, cwd: path.join('/repo', 'ui'), stdio: 'inherit' });
  });

  it('starts python with an argument array and no shell', async () => {
    const { spawn, calls } = fakeSpawn({ code: 5 });
    const step = /** @type {any} */ (STEPS[2]);
    expect(await startProcess(spawn, step, '/repo')).toBe(5);
    expect(calls[0]?.command).toBe('python');
    expect(calls[0]?.args).toEqual(['-m', 'unittest', 'tests.test_replay_cron']);
    expect(calls[0]?.options).toMatchObject({ shell: false, cwd: path.join('/repo', '.') });
  });

  it('returns 1 when the process ended by a signal, and rejects when it cannot start', async () => {
    const a = fakeSpawn({ code: null, signal: 'SIGKILL' });
    expect(await startProcess(a.spawn, /** @type {any} */ (STEPS[0]), '/repo')).toBe(1);
    const b = fakeSpawn({ error: new Error('spawn python ENOENT') });
    await expect(startProcess(b.spawn, /** @type {any} */ (STEPS[2]), '/repo')).rejects.toThrow(/ENOENT/);
  });
});

describe('main', () => {
  it('runs the steps with the given runner and sets the exit code', async () => {
    const runner = makeFakeRunner([0, 0, 0, 4, 0, 0]);
    /** @type {number[]} */
    const codes = [];
    /** @type {string[]} */
    const lines = [];
    await main({ runner, log: (l) => void lines.push(l), setExitCode: (c) => void codes.push(c) });
    expect(codes).toEqual([4]);
    expect(runner.calls).toHaveLength(4);
  });
});
