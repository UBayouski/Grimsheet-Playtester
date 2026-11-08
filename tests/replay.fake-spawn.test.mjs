// @ts-check
import { describe, it, expect } from 'vitest';
import { makeFakeSpawn, makeFakeGrimsheet, procOk, procFail, procHang, procCannotStart, fixtureCommit } from './helpers/fake-spawn.mjs';

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {import('../scripts/replay/types.mjs').ProcSpec}
 */
function spec(command, args) {
  return { command, args, cwd: 'C:/x', shell: false, timeoutMs: 1000, label: 'test' };
}

describe('fake spawn: table lookup', () => {
  it('matches on command and leading args; the most specific rule wins', async () => {
    const spawn = makeFakeSpawn([
      { command: 'git', result: procOk('any git') },
      { command: 'git', args: ['fetch'], result: procOk('git fetch') },
      { command: 'git', args: ['fetch', '--depth'], result: procOk('git fetch --depth') },
    ]);
    expect((await spawn(spec('git', ['clone']))).stdout).toBe('any git');
    expect((await spawn(spec('git', ['fetch', 'origin']))).stdout).toBe('git fetch');
    expect((await spawn(spec('git', ['fetch', '--depth', '1']))).stdout).toBe('git fetch --depth');
  });

  it('uses the fallback (exit 127 by default) when no rule matches', async () => {
    const spawn = makeFakeSpawn([{ command: 'git', args: ['fetch'], result: procOk() }]);
    const r = await spawn(spec('npm', ['ci']));
    expect(r.exitCode).toBe(127);
    const custom = makeFakeSpawn([], { fallback: procOk('fallback') });
    expect((await custom(spec('anything', []))).stdout).toBe('fallback');
  });

  it('a rule result can be a function of the spec', async () => {
    const spawn = makeFakeSpawn([{ command: 'node', result: (s) => procOk(`id=${s.args[0]}`) }]);
    expect((await spawn(spec('node', ['01-the-corridor']))).stdout).toBe('id=01-the-corridor');
  });
});

describe('fake spawn: call record and result kinds', () => {
  it('records every call with command, args, cwd, shell, timeout and label', async () => {
    const spawn = makeFakeSpawn([{ command: 'npm', result: procOk() }]);
    await spawn({ command: 'npm', args: ['ci'], cwd: 'C:/repo', shell: true, timeoutMs: 180000, label: 'npm ci' });
    await spawn(spec('git', ['status']));
    expect(spawn.calls).toEqual([
      { command: 'npm', args: ['ci'], cwd: 'C:/repo', shell: true, timeoutMs: 180000, label: 'npm ci' },
      { command: 'git', args: ['status'], cwd: 'C:/x', shell: false, timeoutMs: 1000, label: 'test' },
    ]);
  });

  it('can exit non-zero, hang and be unable to start', async () => {
    const spawn = makeFakeSpawn([
      { command: 'a', result: procFail(3, 'bad') },
      { command: 'b', result: procHang() },
      { command: 'c', result: procCannotStart('spawn git ENOENT') },
    ]);
    expect(await spawn(spec('a', []))).toMatchObject({ exitCode: 3, stderr: 'bad', timedOut: false, startError: null });
    expect(await spawn(spec('b', []))).toMatchObject({ exitCode: null, timedOut: true, startError: null });
    expect(await spawn(spec('c', []))).toMatchObject({ exitCode: null, timedOut: false, startError: 'spawn git ENOENT' });
  });

  it('returns a copy, so a caller cannot change the canned result', async () => {
    const canned = procOk('x');
    const spawn = makeFakeSpawn([{ command: 'a', result: canned }]);
    const r = await spawn(spec('a', []));
    r.stdout = 'changed';
    expect(canned.stdout).toBe('x');
  });
});

describe('fake Grimsheet', () => {
  it('git rev-parse HEAD answers the fixture commit; remote get-url answers the origin', async () => {
    const { spawn, commit } = makeFakeGrimsheet();
    expect(commit).toBe(fixtureCommit());
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect((await spawn(spec('git', ['rev-parse', 'HEAD']))).stdout).toBe(`${commit}\n`);
    expect((await spawn(spec('git', ['remote', 'get-url', 'origin']))).stdout).toBe('https://github.com/UBayouski/Grimsheet\n');
    expect((await spawn(spec('git', ['clone', '--depth', '1']))).exitCode).toBe(0);
  });

  it('npm ci and run build:play exit 0', async () => {
    const { spawn } = makeFakeGrimsheet();
    expect((await spawn(spec('npm', ['ci']))).exitCode).toBe(0);
    expect((await spawn(spec('npm', ['run', 'build:play']))).exitCode).toBe(0);
  });

  it('--list answers the captured level list', async () => {
    const { spawn } = makeFakeGrimsheet();
    const r = await spawn(spec('node', ['C:/g/scripts/play.mjs', '--list']));
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).levels).toContain('01-the-corridor');
  });

  it('a level id answers its canned play (green fixtures 01, 02, 03); an unknown level exits 2', async () => {
    const { spawn } = makeFakeGrimsheet();
    for (const id of ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt']) {
      const r = await spawn(spec('node', ['C:/g/scripts/play.mjs', id, '--actions-file', 'C:/x.json']));
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout).levelId).toBe(id);
    }
    expect((await spawn(spec('node', ['C:/g/scripts/play.mjs', '99-nope']))).exitCode).toBe(2);
  });

  it('options can make a step fail, hang or be unable to start, and extra rules come first', async () => {
    const { spawn } = makeFakeGrimsheet({
      git: { clone: procCannotStart('git missing'), fetch: procHang() },
      npm: { ci: procFail(1, 'npm ERR!') },
      plays: { '05-the-lich': procHang() },
      rules: [{ command: 'git', args: ['reset'], result: procFail(128, 'fatal') }],
    });
    expect((await spawn(spec('git', ['clone']))).startError).toBe('git missing');
    expect((await spawn(spec('git', ['fetch']))).timedOut).toBe(true);
    expect((await spawn(spec('git', ['reset', '--hard']))).exitCode).toBe(128);
    expect((await spawn(spec('npm', ['ci']))).exitCode).toBe(1);
    expect((await spawn(spec('node', ['p.mjs', '05-the-lich']))).timedOut).toBe(true);
  });
});
