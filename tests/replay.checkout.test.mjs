// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as path from 'node:path';
import {
  ALLOWED_GIT,
  assertAllowedGit,
  isValidSubPath,
  checkoutPath,
  checkDeletable,
  ensureCheckout,
  forceRemove,
} from '../scripts/replay/checkout.mjs';
import { makeFakeGrimsheet, procCannotStart, procFail, procHang, procOk } from './helpers/fake-spawn.mjs';
import { makeFakeClock, makeMemFs } from './helpers/fake-fs.mjs';

const APP = 'grimsheet-playtester';
const LAD = 'C:\\Users\\dev\\AppData\\Local';
const APP_FOLDER = 'C:\\Apps\\grimsheet-playtester';
const DATA_FOLDER = 'C:\\Apps\\grimsheet-playtester\\data';
const URL = 'https://github.com/UBayouski/Grimsheet';
const DIR = path.join(LAD, APP, 'grimsheet');
const T0 = Date.UTC(2026, 11, 1, 3, 0, 0);

/**
 * @param {Parameters<typeof makeFakeGrimsheet>[0]} [grim]
 * @param {{localAppData?: string, appFolder?: string, dataFolder?: string}} [paths]
 */
function setup(grim, paths = {}) {
  const clock = makeFakeClock(T0);
  const fs = makeMemFs({ clock });
  const fake = makeFakeGrimsheet(grim);
  const deps = {
    fs: /** @type {import('../scripts/replay/types.mjs').Fs} */ (fs),
    spawn: fake.spawn,
    paths: { appFolder: APP_FOLDER, dataFolder: DATA_FOLDER, localAppData: LAD, ...paths },
    appName: APP,
    clock,
    platform: /** @type {'win32'} */ ('win32'),
  };
  return { clock, fs, deps, fake };
}

const args = (/** @type {object} */ extra = {}) => ({ repoUrl: URL, branch: 'main', deadlineMs: T0 + 840000, ...extra });
/** @param {{calls: Array<{args: string[]}>}} spawn @returns {string[][]} */
const gitArgs = (spawn) => spawn.calls.map((c) => c.args);

describe('assertAllowedGit', () => {
  it('lists the five allowed subcommands', () => {
    expect(ALLOWED_GIT).toEqual(['clone', 'fetch', 'reset', 'rev-parse', 'remote get-url']);
  });

  it('accepts clone, fetch, reset, rev-parse and remote get-url', () => {
    for (const a of [['clone', 'x'], ['fetch'], ['reset', '--hard'], ['rev-parse', 'HEAD'], ['remote', 'get-url', 'origin']]) {
      expect(() => assertAllowedGit(a)).not.toThrow();
    }
  });

  it('throws for push, commit, branch, tag, status, remote add, remote set-url and anything else', () => {
    for (const a of [['push'], ['commit', '-m', 'x'], ['branch'], ['tag'], ['status'], ['remote', 'add', 'o', 'u'], ['remote', 'set-url', 'o', 'u'], ['remote'], [], ['-c', 'x=y', 'clone'], ['config', 'a', 'b']]) {
      expect(() => assertAllowedGit(a)).toThrow(/not allowed/);
    }
  });
});

describe('isValidSubPath and checkoutPath', () => {
  it('accepts one or more valid segments joined by a backslash', () => {
    for (const s of ['grimsheet', 'a', 'a-b', 'exploit-hunt\\scratch', 'a\\b\\c', '0x']) expect(isValidSubPath(s)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const s of ['', '..', '.', 'a/b', 'A', 'a\\', '\\a', 'a\\\\b', 'a\\..\\b', 'a b', '-a', 'a\\-b', 'C:\\x', 'caf\u00e9', 'a\n', 5, null, undefined]) {
      expect(isValidSubPath(s)).toBe(false);
    }
  });

  it('builds <localAppData>\\<appName>\\grimsheet by default', () => {
    expect(checkoutPath(LAD, APP)).toBe(path.join(LAD, APP, 'grimsheet'));
    expect(checkoutPath(LAD, APP)).toBe(`${LAD}\\${APP}\\grimsheet`);
  });

  it('builds <localAppData>\\<appName>\\<subPath> for a given sub-path', () => {
    expect(checkoutPath(LAD, APP, 'exploit-hunt')).toBe(`${LAD}\\${APP}\\exploit-hunt`);
    expect(checkoutPath(LAD, APP, 'exploit-hunt\\scratch')).toBe(`${LAD}\\${APP}\\exploit-hunt\\scratch`);
  });

  it('returns null for an empty localAppData and for an invalid sub-path', () => {
    expect(checkoutPath('', APP)).toBeNull();
    expect(checkoutPath('', APP, 'ok')).toBeNull();
    for (const s of ['', '..', 'a/b', 'A', 'a\\..\\b']) expect(checkoutPath(LAD, APP, s)).toBeNull();
  });
});

describe('checkDeletable', () => {
  it('accepts a good path', () => {
    expect(checkDeletable(DIR, LAD, APP, APP_FOLDER, DATA_FOLDER)).toEqual({ ok: true });
  });

  it('rejects a path outside LOCALAPPDATA', () => {
    expect(checkDeletable(`D:\\other\\${APP}\\grimsheet`, LAD, APP, APP_FOLDER, DATA_FOLDER)).toEqual({ ok: false, reasonCode: 'checkout_delete_failed' });
    expect(checkDeletable(`${LAD}\\..\\Elsewhere\\${APP}\\grimsheet`, LAD, APP, APP_FOLDER, DATA_FOLDER)).toEqual({ ok: false, reasonCode: 'checkout_delete_failed' });
  });

  it('rejects a relative path and an empty LOCALAPPDATA', () => {
    expect(checkDeletable(`${APP}\\grimsheet`, LAD, APP, APP_FOLDER, DATA_FOLDER).ok).toBe(false);
    expect(checkDeletable(DIR, '', APP, APP_FOLDER, DATA_FOLDER).ok).toBe(false);
  });

  it('rejects a path that does not end in <appName>\\grimsheet', () => {
    for (const p of [`${LAD}\\${APP}`, `${LAD}\\${APP}\\other`, `${LAD}\\grimsheet`, `${LAD}\\other-app\\grimsheet`, `${LAD}\\${APP}\\grimsheet\\sub`, LAD]) {
      expect(checkDeletable(p, LAD, APP, APP_FOLDER, DATA_FOLDER)).toEqual({ ok: false, reasonCode: 'checkout_delete_failed' });
    }
  });

  it('gives checkout_inside_app for a path inside the App_Folder or the Data_Folder', () => {
    expect(checkDeletable(`${LAD}\\${APP}\\grimsheet`, LAD, APP, `${LAD}\\${APP}\\grimsheet\\app`, `${LAD}\\${APP}\\grimsheet\\app\\data`)).toEqual({ ok: false, reasonCode: 'checkout_inside_app' });
    expect(checkDeletable(`${APP_FOLDER}\\data\\${APP}\\grimsheet`, APP_FOLDER, APP, APP_FOLDER, DATA_FOLDER)).toEqual({ ok: false, reasonCode: 'checkout_inside_app' });
    expect(checkDeletable(`${APP_FOLDER}\\${APP}\\grimsheet`, APP_FOLDER, APP, APP_FOLDER, DATA_FOLDER)).toEqual({ ok: false, reasonCode: 'checkout_inside_app' });
  });

  it('gives checkout_inside_app for a checkout that contains the app folder', () => {
    expect(checkDeletable(DIR, LAD, APP, `${DIR}\\app`, `${DIR}\\app\\data`)).toEqual({ ok: false, reasonCode: 'checkout_inside_app' });
  });

  describe('with a sub-path', () => {
    const p = `${LAD}\\${APP}\\exploit-hunt\\scratch`;

    it('the rule is "ends with <appName>\\<subPath>"', () => {
      expect(checkDeletable(p, LAD, APP, APP_FOLDER, DATA_FOLDER, 'exploit-hunt\\scratch')).toEqual({ ok: true });
      expect(checkDeletable(`${LAD}\\${APP}\\exploit-hunt`, LAD, APP, APP_FOLDER, DATA_FOLDER, 'exploit-hunt')).toEqual({ ok: true });
    });

    it('a path for another sub-path, and the default path with a sub-path given, are rejected', () => {
      expect(checkDeletable(p, LAD, APP, APP_FOLDER, DATA_FOLDER, 'scratch')).toEqual({ ok: false, reasonCode: 'checkout_delete_failed' });
      expect(checkDeletable(p, LAD, APP, APP_FOLDER, DATA_FOLDER)).toEqual({ ok: false, reasonCode: 'checkout_delete_failed' });
      expect(checkDeletable(DIR, LAD, APP, APP_FOLDER, DATA_FOLDER, 'exploit-hunt')).toEqual({ ok: false, reasonCode: 'checkout_delete_failed' });
    });

    it('an invalid sub-path is rejected', () => {
      for (const s of ['', '..', 'a/b', 'A', 'a\\..\\b']) {
        expect(checkDeletable(DIR, LAD, APP, APP_FOLDER, DATA_FOLDER, s)).toEqual({ ok: false, reasonCode: 'checkout_delete_failed' });
      }
    });
  });
});

describe('ensureCheckout: no checkout yet', () => {
  it('makes a shallow clone of the URL and branch, then reads the commit', async () => {
    const { deps, fake } = setup();
    const r = await ensureCheckout(deps, args());
    expect(r).toEqual({ ok: true, dir: DIR, commit: fake.commit });
    expect(gitArgs(fake.spawn)).toEqual([['clone', '--depth', '1', '--branch', 'main', '--', URL, DIR], ['rev-parse', 'HEAD']]);
    expect(fake.spawn.calls[0].cwd).toBe(path.dirname(DIR));
    expect(fake.spawn.calls[1].cwd).toBe(DIR);
  });

  it('starts git directly: command git, an argument array, shell false, a positive time limit', async () => {
    const { deps, fake } = setup();
    await ensureCheckout(deps, args());
    for (const c of fake.spawn.calls) {
      expect(c.command).toBe('git');
      expect(Array.isArray(c.args)).toBe(true);
      expect(c.shell).toBe(false);
      expect(c.timeoutMs).toBeGreaterThan(0);
    }
    expect(fake.spawn.calls[0].timeoutMs).toBe(120000);
    expect(fake.spawn.calls[1].timeoutMs).toBe(30000);
  });

  it('creates the folder above the checkout', async () => {
    const { fs, deps } = setup();
    await ensureCheckout(deps, args());
    expect((await fs.stat(path.dirname(DIR))).isDirectory()).toBe(true);
  });

  it('clones into the sub-path folder when one is given', async () => {
    const { deps, fake } = setup();
    const r = await ensureCheckout(deps, args({ subPath: 'exploit-hunt\\scratch' }));
    const dir = `${LAD}\\${APP}\\exploit-hunt\\scratch`;
    expect(r).toEqual({ ok: true, dir, commit: fake.commit });
    expect(fake.spawn.calls[0].args.slice(-2)).toEqual([URL, dir]);
  });

  it('fails with invalid_sub_path for an invalid sub-path, and starts nothing', async () => {
    for (const subPath of ['', '..', 'a/b', 'A', 'a\\..\\b']) {
      const { deps, fake } = setup();
      const r = await ensureCheckout(deps, args({ subPath }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure).toMatchObject({ stage: 'checkout', reasonCode: 'invalid_sub_path', exitCode: null });
      expect(fake.spawn.calls).toEqual([]);
    }
  });

  it('text on stderr with exit code 0 is not a failure', async () => {
    const { deps } = setup({ git: { clone: procOk('', 'warning: something noisy\nfatal-looking text') } });
    expect((await ensureCheckout(deps, args())).ok).toBe(true);
  });
});

describe('ensureCheckout: existing valid checkout', () => {
  it('reads the origin, fetches the branch shallowly, resets hard, and reads the commit', async () => {
    const { fs, deps, fake } = setup();
    fs.seedFile(`${DIR}\\.git\\config`, '[core]');
    const r = await ensureCheckout(deps, args());
    expect(r).toEqual({ ok: true, dir: DIR, commit: fake.commit });
    expect(gitArgs(fake.spawn)).toEqual([
      ['remote', 'get-url', 'origin'],
      ['fetch', '--depth', '1', '--', 'origin', 'main'],
      ['reset', '--hard', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
    expect(fake.spawn.calls.every((c) => c.cwd === DIR && c.shell === false)).toBe(true);
    expect(fs.has(`${DIR}\\.git\\config`)).toBe(true);
  });

  it('reads the commit into commit, trimmed', async () => {
    const { fs, deps } = setup({ commit: 'a'.repeat(40) });
    fs.seedDir(DIR);
    const r = await ensureCheckout(deps, args());
    expect(r.ok && r.commit).toBe('a'.repeat(40));
  });

  it('refreshes the sub-path checkout in its own folder', async () => {
    const { fs, deps, fake } = setup();
    const dir = `${LAD}\\${APP}\\exploit-hunt`;
    fs.seedDir(dir);
    const r = await ensureCheckout(deps, args({ subPath: 'exploit-hunt' }));
    expect(r.ok && r.dir).toBe(dir);
    expect(fake.spawn.calls.every((c) => c.cwd === dir)).toBe(true);
  });
});

describe('ensureCheckout: repair', () => {
  for (const [name, getUrl] of /** @type {Array<[string, import('../scripts/replay/types.mjs').ProcResult]>} */ ([
    ['a wrong origin', procOk('https://github.com/someone/else\n')],
    ['not a repository', procFail(128, 'fatal: not a git repository')],
  ])) {
    it(`${name}: clears read-only files, removes the folder, and clones again`, async () => {
      const { fs, deps, fake } = setup({ git: { 'remote get-url': getUrl } });
      fs.seedFile(`${DIR}\\.git\\objects\\pack\\p.pack`, 'x', { readOnly: true });
      fs.seedFile(`${DIR}\\src\\a.txt`, 'a');
      const r = await ensureCheckout(deps, args());
      expect(r).toEqual({ ok: true, dir: DIR, commit: fake.commit });
      expect(fs.paths(DIR)).toEqual([]);
      expect(gitArgs(fake.spawn).map((a) => a[0])).toEqual(['remote', 'clone', 'rev-parse']);
    });
  }

  it('a delete that still fails gives checkout_delete_failed, and nothing is cloned', async () => {
    const { fs, deps, fake } = setup({ git: { 'remote get-url': procFail(128) } });
    fs.seedFile(`${DIR}\\.git\\objects\\pack\\p.pack`, 'x', { readOnly: true });
    const stuck = { ...fs, chmod: async () => {} }; // the read-only attribute cannot be cleared
    const r = await ensureCheckout({ ...deps, fs: /** @type {any} */ (stuck) }, args());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toMatchObject({ stage: 'checkout', reasonCode: 'checkout_delete_failed', exitCode: null });
    expect(gitArgs(fake.spawn).map((a) => a[0])).toEqual(['remote']);
    expect(fs.has(`${DIR}\\.git\\objects\\pack\\p.pack`)).toBe(true);
  });
});

describe('ensureCheckout: failures', () => {
  it('no_local_app_data when LOCALAPPDATA is empty', async () => {
    const { deps, fake } = setup(undefined, { localAppData: '' });
    const r = await ensureCheckout(deps, args());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toEqual({ stage: 'checkout', reasonCode: 'no_local_app_data', message: 'The LOCALAPPDATA setting is missing, so there is no place for the Grimsheet checkout.', exitCode: null });
    expect(fake.spawn.calls).toEqual([]);
  });

  it('checkout_inside_app when the checkout would be inside the app folder or the data folder, with no process started', async () => {
    for (const paths of [
      { appFolder: `${LAD}\\${APP}\\grimsheet\\app`, dataFolder: `${LAD}\\${APP}\\grimsheet\\app\\data` },
      { appFolder: LAD, dataFolder: `${LAD}\\data` },
    ]) {
      const { deps, fake } = setup(undefined, paths);
      const r = await ensureCheckout(deps, args());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure).toMatchObject({ stage: 'checkout', reasonCode: 'checkout_inside_app' });
      expect(fake.spawn.calls).toEqual([]);
    }
  });

  it('git_not_found when git cannot be started', async () => {
    const { deps } = setup({ git: { clone: procCannotStart('spawn git ENOENT') } });
    const r = await ensureCheckout(deps, args());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toMatchObject({ stage: 'checkout', reasonCode: 'git_not_found', exitCode: null });
  });

  it.each([
    ['clone', {}, { clone: procFail(128, 'fatal: repository not found') }, 128],
    ['fetch', { seed: true }, { fetch: procFail(1) }, 1],
    ['reset', { seed: true }, { reset: procFail(2) }, 2],
    ['rev-parse', {}, { 'rev-parse': procFail(129) }, 129],
  ])('git_failed with the exit code when %s exits non-zero', async (_name, o, git, code) => {
    const { fs, deps } = setup({ git: /** @type {any} */ (git) });
    if (/** @type {any} */ (o).seed) fs.seedDir(DIR);
    const r = await ensureCheckout(deps, args());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toMatchObject({ stage: 'checkout', reasonCode: 'git_failed', exitCode: code });
  });

  it('git_failed when rev-parse prints something that is not a commit hash', async () => {
    const { deps } = setup({ git: { 'rev-parse': procOk('not a hash\n') } });
    const r = await ensureCheckout(deps, args());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.reasonCode).toBe('git_failed');
  });

  it('step_timeout with the step name when a git step goes over its limit', async () => {
    const { fs, deps } = setup({ git: { fetch: procHang() } });
    fs.seedDir(DIR);
    const r = await ensureCheckout(deps, args());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure).toEqual({ stage: 'checkout', reasonCode: 'step_timeout', message: 'The step "git fetch" did not finish in time.', exitCode: null, step: 'git fetch' });
    }
  });

  it('step_timeout without starting git when no time is left', async () => {
    const { deps, fake } = setup();
    const r = await ensureCheckout(deps, args({ deadlineMs: T0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toMatchObject({ reasonCode: 'step_timeout', step: 'git clone' });
    expect(fake.spawn.calls).toEqual([]);
  });

  it('the time limit of a step is the smaller of its fixed limit and the time left', async () => {
    const { deps, fake } = setup();
    await ensureCheckout(deps, args({ deadlineMs: T0 + 5000 }));
    expect(fake.spawn.calls[0].timeoutMs).toBe(5000);
  });
});

describe('forceRemove', () => {
  it('clears read-only files in nested folders and removes the folder', async () => {
    const fs = makeMemFs();
    fs.seedFile('/c/work/a/b/c.pack', 'x', { readOnly: true });
    fs.seedFile('/c/work/top.txt', 't', { readOnly: true });
    expect(await forceRemove(fs, '/c/work')).toBe(true);
    expect(fs.paths('/c/work')).toEqual([]);
  });

  it('returns false when the folder cannot be removed', async () => {
    const fs = makeMemFs();
    fs.seedFile('/c/work/a.pack', 'x', { readOnly: true });
    expect(await forceRemove({ ...fs, chmod: async () => {} }, '/c/work')).toBe(false);
  });

  it('returns false for a folder that does not exist', async () => {
    expect(await forceRemove(makeMemFs(), '/c/missing')).toBe(false);
  });
});

describe('checkout properties', () => {
  // Feature: replay-runner, Property 17: Only allowed git subcommands
  it('Property 17: every git invocation has an allowed subcommand and none is push, commit, branch, tag, status, remote add or remote set-url', async () => {
    const allowed = ['clone', 'fetch', 'reset', 'rev-parse', 'remote get-url'];
    const forbidden = ['push', 'commit', 'branch', 'tag', 'status', 'remote add', 'remote set-url'];
    const arbOutcome = fc.oneof(
      { weight: 5, arbitrary: fc.constant(procOk('', 'noise on stderr')) },
      { weight: 2, arbitrary: fc.integer({ min: 1, max: 255 }).map((c) => procFail(c, 'fatal: x')) },
      { weight: 1, arbitrary: fc.constant(procHang()) },
      { weight: 1, arbitrary: fc.constant(procCannotStart()) },
    );
    const arbState = fc.constantFrom('missing', 'valid', 'wrong-origin', 'not-a-repository');
    await fc.assert(
      fc.asyncProperty(
        arbState,
        fc.record({ clone: arbOutcome, fetch: arbOutcome, reset: arbOutcome, revParse: arbOutcome }),
        fc.constantFrom('grimsheet', 'exploit-hunt', 'a\\b', '..', 'A', ''),
        fc.constantFrom(LAD, ''),
        fc.integer({ min: -1000, max: 840000 }),
        async (state, o, subPath, localAppData, deadlineOffset) => {
          /** @type {import('../scripts/replay/types.mjs').ProcResult} */
          const getUrl = state === 'valid' ? procOk(`${URL}\n`) : state === 'wrong-origin' ? procOk('https://example.com/other\n') : procFail(128, 'fatal: not a git repository');
          const { fs, deps, fake } = setup(
            { git: { clone: o.clone, fetch: o.fetch, reset: o.reset, 'rev-parse': o.revParse, 'remote get-url': getUrl } },
            { localAppData },
          );
          const dir = checkoutPath(LAD, APP, subPath === '' ? 'grimsheet' : subPath) ?? DIR;
          if (state !== 'missing') fs.seedFile(`${dir}\\.git\\objects\\pack\\p.pack`, 'x', { readOnly: true });
          await ensureCheckout(deps, args({ subPath, deadlineMs: T0 + deadlineOffset }));
          for (const call of fake.spawn.calls) {
            const sub = call.args[0] === 'remote' ? `remote ${call.args[1]}` : call.args[0];
            expect(call.command).toBe('git');
            expect(call.shell).toBe(false);
            expect(allowed).toContain(sub);
            expect(forbidden).not.toContain(sub);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
