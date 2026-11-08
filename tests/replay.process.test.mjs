// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { EventEmitter } from 'node:events';
import {
  STEP_LIMITS_MS,
  SAFETY_MARGIN_MS,
  OUTPUT_CAP_BYTES,
  effectiveLimit,
  runDeadline,
  makeStartProcess,
} from '../scripts/replay/process.mjs';

describe('constants and arithmetic', () => {
  it('has the Step_Limit values of the design', () => {
    expect(STEP_LIMITS_MS).toEqual({ gitFetch: 120000, npmCi: 180000, build: 120000, list: 30000, play: 30000, git: 30000 });
    expect(SAFETY_MARGIN_MS).toBe(60000);
    expect(OUTPUT_CAP_BYTES).toBe(16 * 1024 * 1024);
  });

  it('runDeadline is the start plus the cron timeout minus the safety margin', () => {
    expect(runDeadline(1000, 900)).toBe(1000 + 840000);
    expect(runDeadline(0, 900)).toBe(840000);
  });

  it('effectiveLimit is the smaller of the fixed limit and the time left, never below 0', () => {
    expect(effectiveLimit(30000, 0, 100000)).toBe(30000); // fixed below the time left
    expect(effectiveLimit(30000, 70000, 100000)).toBe(30000); // equal
    expect(effectiveLimit(30000, 90000, 100000)).toBe(10000); // fixed above the time left
    expect(effectiveLimit(30000, 100000, 100000)).toBe(0);
    expect(effectiveLimit(30000, 150000, 100000)).toBe(0); // deadline already passed
  });
});

/**
 * A fake child process for the spawn spy.
 * @param {{exitCode?: number|null, stdout?: string, stderr?: string, error?: Error}} [o]
 */
function fakeChild(o = {}) {
  const child = /** @type {any} */ (new EventEmitter());
  child.pid = 4242;
  child.stdout = Object.assign(new EventEmitter(), { destroy() {} });
  child.stderr = Object.assign(new EventEmitter(), { destroy() {} });
  setImmediate(() => {
    if (o.error) {
      child.emit('error', o.error);
      return;
    }
    if (o.stdout) child.stdout.emit('data', Buffer.from(o.stdout));
    if (o.stderr) child.stderr.emit('data', Buffer.from(o.stderr));
    child.emit('close', o.exitCode ?? 0);
  });
  return child;
}

/** @param {any} [childOptions] */
function spySpawn(childOptions) {
  /** @type {Array<{command: string, args: string[]|undefined, options: any}>} */
  const calls = [];
  const spawnFn = (/** @type {string} */ command, /** @type {any} */ a, /** @type {any} */ b) => {
    // spawn(command, options) when no argument array is passed, spawn(command, args, options) otherwise.
    const hasArgs = Array.isArray(a);
    calls.push({ command, args: hasArgs ? a : undefined, options: hasArgs ? b : a });
    return fakeChild(childOptions);
  };
  return { calls, spawnFn: /** @type {any} */ (spawnFn) };
}

describe('makeStartProcess: start rules (spawn spy)', () => {
  const base = { cwd: 'C:\\work', shell: false, timeoutMs: 5000, label: 't' };

  it('starts git with shell false and the argument array', async () => {
    const { calls, spawnFn } = spySpawn({ stdout: 'abc\n' });
    const start = makeStartProcess({ platform: 'win32', spawnFn });
    const r = await start({ ...base, command: 'git', args: ['rev-parse', 'HEAD'] });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('git');
    expect(calls[0].args).toEqual(['rev-parse', 'HEAD']);
    expect(calls[0].options.shell).toBe(false);
    expect(calls[0].options.cwd).toBe('C:\\work');
    expect(r).toEqual({ exitCode: 0, stdout: 'abc\n', stderr: '', timedOut: false, startError: null });
  });

  it('starts node with shell false, even if the spec asks for a shell', async () => {
    const { calls, spawnFn } = spySpawn();
    const start = makeStartProcess({ platform: 'win32', spawnFn });
    await start({ ...base, shell: true, command: 'node', args: ['scripts/play.mjs', '01-the-corridor', '--actions-file', 'C:\\x\\a.json'] });
    expect(calls[0].options.shell).toBe(false);
    expect(calls[0].args).toEqual(['scripts/play.mjs', '01-the-corridor', '--actions-file', 'C:\\x\\a.json']);
  });

  it('starts npm on win32 as one fixed command string with shell true and no argument array', async () => {
    for (const [args, line] of /** @type {Array<[string[], string]>} */ ([
      [['ci'], 'npm ci'],
      [['run', 'build:play'], 'npm run build:play'],
    ])) {
      const win = spySpawn();
      await makeStartProcess({ platform: 'win32', spawnFn: win.spawnFn })({ ...base, command: 'npm', args });
      expect(win.calls).toHaveLength(1);
      expect(win.calls[0].command).toBe(line);
      expect(win.calls[0].args).toBeUndefined();
      expect(win.calls[0].options.shell).toBe(true);
    }
  });

  it('starts npm with an argument array and shell false elsewhere', async () => {
    const other = spySpawn();
    await makeStartProcess({ platform: 'other', spawnFn: other.spawnFn })({ ...base, command: 'npm', args: ['run', 'build:play'] });
    expect(other.calls[0].command).toBe('npm');
    expect(other.calls[0].args).toEqual(['run', 'build:play']);
    expect(other.calls[0].options.shell).toBe(false);
  });

  it('refuses any other npm argument set before starting anything', async () => {
    for (const platform of ['win32', 'other']) {
      for (const args of [['install'], ['ci', '--foo'], ['run', 'build'], ['run', 'build:play', '&& calc'], [], ['ci;calc']]) {
        const spy = spySpawn();
        const r = await makeStartProcess({ platform, spawnFn: spy.spawnFn })({ ...base, command: 'npm', args });
        expect(spy.calls).toEqual([]);
        expect(r.exitCode).toBeNull();
        expect(r.startError).toEqual(expect.stringContaining('not allowed'));
        expect(r.timedOut).toBe(false);
      }
    }
  });

  it('reports a non-zero exit code and stderr', async () => {
    const { spawnFn } = spySpawn({ exitCode: 2, stderr: 'bad input' });
    const r = await makeStartProcess({ platform: 'win32', spawnFn })({ ...base, command: 'node', args: [] });
    expect(r).toEqual({ exitCode: 2, stdout: '', stderr: 'bad input', timedOut: false, startError: null });
  });

  it('reports a start error from the error event', async () => {
    const { spawnFn } = spySpawn({ error: new Error('spawn git ENOENT') });
    const r = await makeStartProcess({ platform: 'win32', spawnFn })({ ...base, command: 'git', args: [] });
    expect(r.exitCode).toBeNull();
    expect(r.startError).toContain('ENOENT');
    expect(r.timedOut).toBe(false);
  });

  it('reports a start error when spawn throws', async () => {
    const spawnFn = /** @type {any} */ (() => {
      throw new Error('EINVAL');
    });
    const r = await makeStartProcess({ platform: 'win32', spawnFn })({ ...base, command: 'git', args: [] });
    expect(r.startError).toContain('EINVAL');
    expect(r.exitCode).toBeNull();
  });

  it('with no time left it resolves timedOut without starting anything', async () => {
    const { calls, spawnFn } = spySpawn();
    const r = await makeStartProcess({ platform: 'win32', spawnFn })({ ...base, timeoutMs: 0, command: 'git', args: [] });
    expect(calls).toEqual([]);
    expect(r).toEqual({ exitCode: null, stdout: '', stderr: '', timedOut: true, startError: null });
  });

  it('a child that exits because of the kill is reported as timed out, not with its exit code', async () => {
    const main = /** @type {any} */ (new EventEmitter());
    main.pid = 99;
    main.stdout = Object.assign(new EventEmitter(), { destroy() {} });
    main.stderr = Object.assign(new EventEmitter(), { destroy() {} });
    /** @type {string[]} */
    const started = [];
    const spawnFn = /** @type {any} */ (
      (/** @type {string} */ command) => {
        started.push(command);
        if (command !== 'taskkill') return main;
        const killer = /** @type {any} */ (new EventEmitter());
        setImmediate(() => {
          main.emit('close', 1); // the killed child closes with exit code 1 before taskkill itself is done
          killer.emit('close', 0);
        });
        return killer;
      }
    );
    const r = await makeStartProcess({ platform: 'win32', spawnFn })({ ...base, timeoutMs: 20, command: 'node', args: [] });
    expect(started).toEqual(['node', 'taskkill']);
    expect(r).toEqual({ exitCode: null, stdout: '', stderr: '', timedOut: true, startError: null });
  });

  it('cuts stdout at maxOutputBytes', async () => {
    const { spawnFn } = spySpawn({ stdout: 'x'.repeat(5000) });
    const r = await makeStartProcess({ platform: 'win32', spawnFn, maxOutputBytes: 1000 })({ ...base, command: 'node', args: [] });
    expect(r.stdout).toHaveLength(1000);
  });
});

describe('makeStartProcess: real node children', () => {
  const start = makeStartProcess({});
  const spec = (/** @type {string} */ script, timeoutMs = 10000) => ({
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    shell: false,
    timeoutMs,
    label: 'test',
  });

  /** @param {number} pid @returns {Promise<boolean>} true when the process is gone (polls for up to 3 s) */
  async function goneSoon(pid) {
    for (let i = 0; i < 30; i += 1) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  it('captures stdout, stderr and the exit code', async () => {
    const r = await start(spec('process.stdout.write("hello"); process.stderr.write("warn"); process.exit(3)'));
    expect(r).toEqual({ exitCode: 3, stdout: 'hello', stderr: 'warn', timedOut: false, startError: null });
  });

  it('kills a child that runs past the time limit, and the whole tree', async () => {
    const script = [
      'const { spawn } = require("node:child_process");',
      'const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });',
      'process.stdout.write(JSON.stringify({ child: process.pid, grand: g.pid }));',
      'setTimeout(() => {}, 30000);',
    ].join(' ');
    const started = Date.now();
    const r = await start(spec(script, 1500));
    expect(Date.now() - started).toBeLessThan(10000);
    expect(r.timedOut).toBe(true);
    expect(r.startError).toBeNull();
    const pids = JSON.parse(r.stdout);
    expect(await goneSoon(pids.child)).toBe(true);
    expect(await goneSoon(pids.grand)).toBe(true);
  }, 20000);

  it('sets startError for a command that cannot start', async () => {
    const r = await start({ command: 'definitely-not-a-real-command-xyz', args: [], cwd: process.cwd(), shell: false, timeoutMs: 5000, label: 'x' });
    expect(r.startError).toEqual(expect.any(String));
    expect(r.exitCode).toBeNull();
    expect(r.timedOut).toBe(false);
  });

  it('cuts stdout over the cap (small cap for the test)', async () => {
    const capped = makeStartProcess({ maxOutputBytes: 2048 });
    const r = await capped(spec('process.stdout.write("y".repeat(100000))'));
    expect(r.stdout.length).toBeLessThanOrEqual(2048);
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(r.exitCode).toBe(0);
  });
});

describe('process properties', () => {
  // Feature: replay-runner, Property 18: Step limit is the smaller of the fixed limit and the time left
  it('Property 18: effectiveLimit equals max(0, min(fixed, deadline - now))', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 * 60 * 1000 }),
        fc.integer({ min: 0, max: 4 * 3600 * 1000 }),
        fc.integer({ min: -3600 * 1000, max: 4 * 3600 * 1000 }),
        (fixed, now, delta) => {
          const deadline = now + delta;
          const result = effectiveLimit(fixed, now, deadline);
          expect(result).toBe(Math.max(0, Math.min(fixed, deadline - now)));
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(fixed);
        },
      ),
      { numRuns: 200 },
    );
  });
});
