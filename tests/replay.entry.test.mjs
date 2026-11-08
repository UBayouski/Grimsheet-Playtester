// @ts-check
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildRealDeps, main } from '../scripts/replay.mjs';
import { replayVerdict } from '../scripts/verifier.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = ['--repo-url', 'https://github.com/UBayouski/Grimsheet', '--branch', 'main', '--cron-timeout', '900'];

describe('importing replay.mjs', () => {
  it('does not start a Run (main runs only when the file is the entry)', () => {
    // The import at the top of this file already happened; nothing was printed or recorded by it.
    expect(typeof main).toBe('function');
    expect(typeof parseArgs).toBe('function');
  });
});

describe('parseArgs', () => {
  it('accepts a good flag set', () => {
    expect(parseArgs(GOOD)).toEqual({ repoUrl: 'https://github.com/UBayouski/Grimsheet', branch: 'main', cronTimeoutSec: 900 });
  });

  it('accepts the flags in any order', () => {
    expect(parseArgs(['--cron-timeout', '60', '--branch', 'dev', '--repo-url', 'u'])).toEqual({ repoUrl: 'u', branch: 'dev', cronTimeoutSec: 60 });
  });

  it('returns null for a missing flag', () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(GOOD.slice(0, 4))).toBeNull();
    expect(parseArgs(['--repo-url', 'u', '--branch', 'b'])).toBeNull();
    expect(parseArgs(['--branch', 'b', '--cron-timeout', '9'])).toBeNull();
  });

  it('returns null for a flag without a value', () => {
    expect(parseArgs(['--repo-url', 'u', '--branch', 'b', '--cron-timeout'])).toBeNull();
    expect(parseArgs(['--repo-url', '--branch', 'b', '--cron-timeout', '9'])).toBeNull();
    expect(parseArgs(['--repo-url', '', '--branch', 'b', '--cron-timeout', '9'])).toBeNull();
  });

  it('returns null for a repeated flag', () => {
    expect(parseArgs([...GOOD, '--branch', 'other'])).toBeNull();
    expect(parseArgs([...GOOD, '--cron-timeout', '900'])).toBeNull();
  });

  it('returns null for an unknown flag or a stray argument', () => {
    expect(parseArgs([...GOOD, '--force', 'x'])).toBeNull();
    expect(parseArgs([...GOOD, 'extra'])).toBeNull();
    expect(parseArgs(['--repo-url=u', '--branch', 'b', '--cron-timeout', '9'])).toBeNull();
  });

  it.each(['abc', '0', '-5', '1.5', '', ' 900', '9e2', '0x10', 'NaN', '99999999999999999999'])('returns null for the timeout %j', (value) => {
    expect(parseArgs(['--repo-url', 'u', '--branch', 'b', '--cron-timeout', value])).toBeNull();
  });

  it('returns null for something that is not an array of strings', () => {
    expect(parseArgs(/** @type {any} */ (undefined))).toBeNull();
    expect(parseArgs(/** @type {any} */ ([1, 2]))).toBeNull();
  });
});

describe('buildRealDeps', () => {
  it('returns the keys of Deps', () => {
    const deps = buildRealDeps();
    expect(Object.keys(deps).sort()).toEqual(['appName', 'clock', 'fs', 'logStderr', 'paths', 'pid', 'platform', 'sleep', 'spawn', 'token', 'verifier']);
  });

  it('platform is win32 or other', () => {
    expect(['win32', 'other']).toContain(buildRealDeps().platform);
    expect(buildRealDeps().platform).toBe(process.platform === 'win32' ? 'win32' : 'other');
  });

  it('token() gives 32 hex characters, a new one each time', () => {
    const { token } = buildRealDeps();
    const a = token();
    const b = token();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('verifier is replayVerdict of the verifier module', () => {
    expect(buildRealDeps().verifier).toBe(replayVerdict);
  });

  it('appFolder comes from the script location and dataFolder is <appFolder>\\data', () => {
    const { paths } = buildRealDeps();
    expect(paths.appFolder).toBe(REPO_ROOT);
    expect(paths.dataFolder).toBe(path.join(REPO_ROOT, 'data'));
  });

  it('localAppData comes from LOCALAPPDATA, or is an empty string', () => {
    const saved = process.env.LOCALAPPDATA;
    try {
      process.env.LOCALAPPDATA = 'C:\\Some\\Local';
      expect(buildRealDeps().paths.localAppData).toBe('C:\\Some\\Local');
      delete process.env.LOCALAPPDATA;
      expect(buildRealDeps().paths.localAppData).toBe('');
    } finally {
      if (saved === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = saved;
    }
  });

  it('pid, appName, clock and sleep are real', async () => {
    const deps = buildRealDeps();
    expect(deps.pid).toBe(process.pid);
    expect(deps.appName).toBe('grimsheet-playtester');
    expect(Math.abs(deps.clock.nowMs() - Date.now())).toBeLessThan(1000);
    await deps.sleep(1);
    expect(typeof deps.spawn).toBe('function');
  });
});

describe('main', () => {
  /** @param {string[]} argv @param {any} [result] @param {{throws?: boolean}} [o] */
  async function runMain(argv, result = { exitCode: 0, line: { runId: 'run-000001', state: 'complete', commit: 'abc' } }, o = {}) {
    /** @type {string[]} */
    const out = [];
    /** @type {Array<number>} */
    const codes = [];
    /** @type {any[]} */
    const calls = [];
    await main(argv, {
      runReplay: async (/** @type {any} */ deps, /** @type {any} */ args) => {
        calls.push({ deps, args });
        if (o.throws) throw new Error('boom');
        return result;
      },
      buildRealDeps: () => /** @type {any} */ ({ marker: 'deps' }),
      write: (/** @type {string} */ s) => void out.push(s),
      setExitCode: (/** @type {number} */ c) => void codes.push(c),
    });
    return { out, codes, calls };
  }

  it('a bad flag set prints {"state":"record_failed"} and sets exit code 4, without running', async () => {
    const r = await runMain(['--nope']);
    expect(r.out).toEqual(['{"state":"record_failed"}\n']);
    expect(r.codes).toEqual([4]);
    expect(r.calls).toEqual([]);
  });

  it('prints the line of runReplay as one JSON line and nothing else', async () => {
    const r = await runMain(GOOD);
    expect(r.out).toEqual(['{"runId":"run-000001","state":"complete","commit":"abc"}\n']);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].args).toEqual({ repoUrl: 'https://github.com/UBayouski/Grimsheet', branch: 'main', cronTimeoutSec: 900 });
    expect(r.calls[0].deps).toEqual({ marker: 'deps' });
  });

  it.each([
    [0, { runId: 'run-000002', state: 'failed', commit: null }, '{"runId":"run-000002","state":"failed","commit":null}\n'],
    [3, { state: 'already_running' }, '{"state":"already_running"}\n'],
    [4, { state: 'record_failed' }, '{"state":"record_failed"}\n'],
  ])('exit code %i from runReplay is the process exit code', async (exitCode, line, text) => {
    const r = await runMain(GOOD, { exitCode, line });
    expect(r.out).toEqual([text]);
    expect(r.codes).toEqual([exitCode]);
    expect(r.out.join('').trim().split('\n')).toHaveLength(1);
  });

  it('an unexpected throw prints {"state":"record_failed"} and exit code 4', async () => {
    const r = await runMain(GOOD, undefined, { throws: true });
    expect(r.out).toEqual(['{"state":"record_failed"}\n']);
    expect(r.codes).toEqual([4]);
  });
});
