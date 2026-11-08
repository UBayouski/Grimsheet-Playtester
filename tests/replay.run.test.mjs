// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { arbLevelList, VALID_LEVEL_POOL } from './replay.arbitraries.mjs';
import { makeScheduler } from './helpers/fake-fs.mjs';
import * as path from 'node:path';
import { runReplay } from '../scripts/replay/run.mjs';
import { makeFakeGrimsheet, procCannotStart, procFail, procHang, procOk } from './helpers/fake-spawn.mjs';
import { makeFakeClock, makeMemFs, makeSleep, makeTokenSource } from './helpers/fake-fs.mjs';

const APP = 'grimsheet-playtester';
const LAD = 'C:\\Users\\dev\\AppData\\Local';
const APP_FOLDER = 'C:\\Apps\\grimsheet-playtester';
const DATA = 'C:\\Apps\\grimsheet-playtester\\data';
const CHECKOUT = path.join(LAD, APP, 'grimsheet');
const URL = 'https://github.com/UBayouski/Grimsheet';
const T0 = Date.UTC(2026, 11, 1, 3, 0, 0);
const RUN1 = `${DATA}/runs/run-000001.json`;
const CONFIG = `${DATA}/config.json`;
const RUN_LOCK = `${DATA}/.run.lock`;
const RESULTS_LOCK = `${DATA}/.results.lock`;
const SOLVED = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt'];

/** @param {string} id @param {Record<string, any>} [over] @returns {any} */
const okVerdict = (id, over = {}) => ({ levelId: id, colour: 'green', won: true, endHp: 3, inkSpent: 1, minimalInk: 1, statusChangeIndex: 5, refusedAt: null, ...over });

/**
 * A table-driven verifier stub. `table` maps a level id to a verdict, or to a function of
 * (exitCode, play). It records every call, with the number of arguments it was given.
 * @param {Record<string, any>} [table]
 */
function makeVerifier(table = {}) {
  /** @type {Array<{n: number, levelId: unknown, stored: unknown, exitCode: unknown, play: unknown}>} */
  const calls = [];
  const fn = (/** @type {any[]} */ ...a) => {
    calls.push({ n: a.length, levelId: a[0], stored: a[1], exitCode: a[2], play: a[3] });
    const entry = table[a[0]];
    if (typeof entry === 'function') return entry(a[2], a[3]);
    return entry ?? okVerdict(a[0]);
  };
  return Object.assign(/** @type {any} */ (fn), { calls });
}

/**
 * @param {{
 *   grim?: Parameters<typeof makeFakeGrimsheet>[0],
 *   verifier?: any,
 *   solved?: string[],
 *   viaClone?: boolean,
 *   onSpawn?: (spec: import('../scripts/replay/types.mjs').ProcSpec) => void,
 *   platform?: 'win32'|'other',
 * }} [o]
 */
function setup(o = {}) {
  const clock = makeFakeClock(T0);
  const fs = makeMemFs({ clock });
  fs.seedDir(DATA);
  /** @param {string} id */
  const seedSolution = (id) => fs.seedFile(`${CHECKOUT}\\tests\\solutions\\${id}.json`, JSON.stringify({ levelId: id, minimalInk: 1, actions: [{ kind: 'wait' }] }));
  const solved = o.solved ?? SOLVED;
  /** @type {import('./helpers/fake-spawn.mjs').FakeRule[]} */
  const rules = [...(o.grim?.rules ?? [])];
  if (o.viaClone) {
    rules.push({ command: 'git', args: ['clone'], result: () => { solved.forEach(seedSolution); return procOk('', 'Cloning...'); } });
  } else {
    solved.forEach(seedSolution);
  }
  fs.seedDir(CHECKOUT);
  const fake = makeFakeGrimsheet({ ...o.grim, rules });
  const verifier = o.verifier ?? makeVerifier();
  const spawn = Object.assign(
    async (/** @type {import('../scripts/replay/types.mjs').ProcSpec} */ spec) => {
      o.onSpawn?.(spec);
      return fake.spawn(spec);
    },
    { calls: fake.spawn.calls },
  );
  const deps = {
    clock,
    sleep: makeSleep(clock),
    fs: /** @type {import('../scripts/replay/types.mjs').Fs} */ (fs),
    paths: { appFolder: APP_FOLDER, dataFolder: DATA, localAppData: LAD },
    spawn,
    verifier,
    token: makeTokenSource(),
    pid: 4242,
    appName: APP,
    platform: o.platform ?? /** @type {'win32'} */ ('win32'),
  };
  return { clock, fs, deps, fake, verifier, spawn, seedSolution };
}

const ARGS = { repoUrl: URL, branch: 'main', cronTimeoutSec: 900 };
/** @param {ReturnType<typeof makeMemFs>} fs @param {string} p @returns {any} */
const readJson = (fs, p) => JSON.parse(/** @type {string} */ (fs.peek(p)));
/** @param {{calls: Array<{command: string, args: string[]}>}} spawn @returns {string[]} the level ids that were played */
const played = (spawn) => spawn.calls.filter((c) => c.command === 'node' && c.args[1] !== '--list').map((c) => c.args[1]);

describe('runReplay: a full complete Run', () => {
  it('writes the Result_File, the Index_Entry and the config.json key, prints the line and exits 0', async () => {
    const { fs, deps, fake } = setup();
    const r = await runReplay(deps, ARGS);
    expect(r).toEqual({ exitCode: 0, line: { runId: 'run-000001', state: 'complete', commit: fake.commit } });

    const rec = readJson(fs, RUN1);
    expect(rec).toMatchObject({
      schemaVersion: 1,
      runId: 'run-000001',
      counter: 1,
      state: 'complete',
      startedAt: new Date(T0).toISOString(),
      repoUrl: URL,
      branch: 'main',
      commit: fake.commit,
      failure: null,
      previousLaunch: null,
      resultsKey: 'ok',
      green: 3,
      amber: 0,
      red: 0,
      error: 2,
    });
    expect(rec.finishedAt).toEqual(expect.any(String));
    expect(rec.levels.map((/** @type {any} */ l) => [l.levelId, l.colour])).toEqual([
      ['01-the-corridor', 'green'],
      ['02-the-chaser', 'green'],
      ['03-the-locked-crypt', 'green'],
      ['04-the-trap-row', 'error'],
      ['05-the-lich', 'error'],
    ]);
    expect(rec.coverage).toEqual({ listed: 5, played: 3, noSolution: 2, unreadable: 0, unlisted: 0, duplicateListedLevels: [], unlistedSolutions: [] });

    const index = readJson(fs, `${DATA}/_index.json`);
    expect(index.lastCounter).toBe(1);
    expect(index.runs).toEqual([
      { runId: 'run-000001', counter: 1, state: 'complete', startedAt: rec.startedAt, finishedAt: rec.finishedAt, commit: fake.commit, green: 3, amber: 0, red: 0, error: 2 },
    ]);

    const results = readJson(fs, CONFIG).playtesterResults;
    expect(results.schemaVersion).toBe(1);
    expect(results.latest).toMatchObject({ runId: 'run-000001', state: 'complete', commit: fake.commit });
    expect(results.latest.levels).toHaveLength(5);
    expect(results.trend).toHaveLength(1);
    expect(results.trend[0]).toMatchObject({ runId: 'run-000001', green: 3, error: 2 });
    expect('findings' in results).toBe(false);
    expect(fs.has(RUN_LOCK)).toBe(false);
    expect(fs.has(RESULTS_LOCK)).toBe(false);
  });

  it('starts the stages in order with the right arguments, directories, shell flags and limits', async () => {
    const { deps, fake } = setup();
    await runReplay(deps, ARGS);
    const calls = fake.spawn.calls;
    expect(calls.map((c) => `${c.command} ${c.args.slice(0, 2).join(' ')}`)).toEqual([
      'git remote get-url',
      'git fetch --depth',
      'git reset --hard',
      'git rev-parse HEAD',
      'npm ci',
      'npm run build:play',
      'node scripts/play.mjs --list',
      'node scripts/play.mjs 01-the-corridor',
      'node scripts/play.mjs 02-the-chaser',
      'node scripts/play.mjs 03-the-locked-crypt',
    ]);
    for (const c of calls.filter((x) => x.command !== 'npm')) expect(c.shell).toBe(false);
    for (const c of calls.filter((x) => x.command === 'npm')) expect(c.cwd).toBe(CHECKOUT);
    expect(calls.find((c) => c.command === 'npm' && c.args[0] === 'ci')?.timeoutMs).toBe(180000);
    expect(calls.find((c) => c.command === 'npm' && c.args[0] === 'run')?.timeoutMs).toBe(120000);
    for (const c of calls.filter((x) => x.command === 'node')) {
      expect(c.cwd).toBe(CHECKOUT);
      expect(c.timeoutMs).toBe(30000);
    }
  });

  it('clones when there is no checkout yet', async () => {
    const { clock, fs, deps, fake } = setup({ viaClone: true });
    fs.seedDir(CHECKOUT);
    await fs.rm(CHECKOUT, { recursive: true, force: true });
    const r = await runReplay(deps, ARGS);
    expect(r.line.state).toBe('complete');
    expect(fake.spawn.calls[0].args[0]).toBe('clone');
    expect(clock.nowMs()).toBe(T0);
  });
});

describe('runReplay: failures', () => {
  /**
   * @param {Parameters<typeof setup>[0]} o
   * @param {{stage: string, reasonCode: string, exitCode: number|null}} expected
   * @param {string|null} [commit]
   */
  async function expectFailure(o, expected, commit = null) {
    const { fs, deps, fake } = setup(o);
    const r = await runReplay(deps, ARGS);
    expect(r.exitCode).toBe(0);
    expect(r.line).toEqual({ runId: 'run-000001', state: 'failed', commit: commit === 'fixture' ? fake.commit : commit });
    const rec = readJson(fs, RUN1);
    expect(rec.state).toBe('failed');
    expect(rec.failure).toMatchObject(expected);
    expect(rec.failure.message).toEqual(expect.any(String));
    expect(readJson(fs, `${DATA}/_index.json`).runs[0].state).toBe('failed');
    expect(rec.resultsKey).toBe('ok');
    expect(fs.has(RUN_LOCK)).toBe(false);
    return { rec, fs, fake };
  }

  it('checkout: git exits non-zero', async () => {
    const { rec } = await expectFailure({ grim: { git: { 'rev-parse': procFail(128) } } }, { stage: 'checkout', reasonCode: 'git_failed', exitCode: 128 });
    expect(rec.levels).toEqual([]);
  });

  it('checkout: no LOCALAPPDATA', async () => {
    const s = setup();
    s.deps.paths.localAppData = '';
    const r = await runReplay(s.deps, ARGS);
    expect(r.line.state).toBe('failed');
    expect(readJson(s.fs, RUN1).failure).toMatchObject({ stage: 'checkout', reasonCode: 'no_local_app_data' });
    expect(s.fake.spawn.calls).toEqual([]);
  });

  it('install: npm ci exits non-zero (the commit is kept)', async () => {
    await expectFailure({ grim: { npm: { ci: procFail(1) } } }, { stage: 'install', reasonCode: 'install_failed', exitCode: 1 }, 'fixture');
  });

  it('build: npm run build:play exits non-zero', async () => {
    await expectFailure({ grim: { npm: { build: procFail(2) } } }, { stage: 'build', reasonCode: 'build_failed', exitCode: 2 }, 'fixture');
  });

  it('list: non-zero exit, output that is not JSON, a bad shape, an invalid id', async () => {
    for (const [list, exitCode] of /** @type {Array<[import('./helpers/fake-spawn.mjs').FakeRule['result'], number|null]>} */ ([[procFail(2), 2], [procOk('not json'), null], [procOk('{"levels":"x"}'), null], [procOk('{"levels":["../x"]}'), null]])) {
      await expectFailure({ grim: { list: /** @type {any} */ (list) } }, { stage: 'list', reasonCode: 'list_failed', exitCode }, 'fixture');
    }
  });

  it('list: an empty level list', async () => {
    await expectFailure({ grim: { list: procOk('{"levels":[]}') } }, { stage: 'list', reasonCode: 'empty_level_list', exitCode: null }, 'fixture');
  });

  it('record: an unexpected throw gives internal_error and the files are still written', async () => {
    const verifier = makeVerifier({ '02-the-chaser': () => { throw new Error('boom'); } });
    const { rec } = await expectFailure({ verifier }, { stage: 'record', reasonCode: 'internal_error', exitCode: null }, 'fixture');
    expect(rec.levels.map((/** @type {any} */ l) => l.levelId)).toEqual(['01-the-corridor']);
  });

  it('a git or npm that cannot be started fails that stage with no exit code', async () => {
    await expectFailure({ grim: { git: { 'remote get-url': procCannotStart() } } }, { stage: 'checkout', reasonCode: 'git_not_found', exitCode: null });
    await expectFailure({ grim: { npm: { ci: procCannotStart() } } }, { stage: 'install', reasonCode: 'install_failed', exitCode: null }, 'fixture');
  });
});

describe('runReplay: time limits', () => {
  it('step_timeout with the step name when a step goes over its limit', async () => {
    const { fs } = await (async () => {
      const s = setup({ grim: { npm: { ci: procHang() } } });
      const r = await runReplay(s.deps, ARGS);
      expect(r.line.state).toBe('failed');
      return s;
    })();
    expect(readJson(fs, RUN1).failure).toMatchObject({ stage: 'install', reasonCode: 'step_timeout', step: 'npm ci', exitCode: null });
  });

  it('no time left before a non-play step gives step_timeout in that stage (Decision 14)', async () => {
    const s = setup({
      onSpawn: (spec) => {
        if (spec.command === 'npm' && spec.args[0] === 'ci') s.clock.advance(840000); // uses up the whole budget
      },
    });
    await runReplay(s.deps, ARGS);
    expect(readJson(s.fs, RUN1).failure).toMatchObject({ stage: 'build', reasonCode: 'step_timeout', step: 'npm run build:play' });
    expect(s.fake.spawn.calls.some((c) => c.command === 'npm' && c.args[0] === 'run')).toBe(false);
  });

  it('deadline_reached: the unplayed levels get not_played entries and the count equals the distinct listed ids', async () => {
    const s = setup({
      onSpawn: (spec) => {
        if (spec.command === 'node' && spec.args[1] === '02-the-chaser') s.clock.advance(840000);
      },
    });
    const r = await runReplay(s.deps, ARGS);
    expect(r.line.state).toBe('failed');
    const rec = readJson(s.fs, RUN1);
    expect(rec.failure).toMatchObject({ stage: 'replay', reasonCode: 'deadline_reached', exitCode: null });
    expect(rec.levels).toHaveLength(5);
    expect(rec.levels.map((/** @type {any} */ l) => l.reasonCode ?? l.colour)).toEqual(['green', 'green', 'not_played', 'not_played', 'not_played']);
    expect(rec.coverage).toMatchObject({ listed: 5, played: 2 });
    expect(played(s.fake.spawn)).toEqual(['01-the-corridor', '02-the-chaser']);
  });
});

describe('runReplay: levels', () => {
  it('a Level_Entry of colour error does not fail the Run', async () => {
    const verifier = makeVerifier({ '01-the-corridor': { levelId: '01-the-corridor', colour: 'error', reasonCode: 'replay_mismatch', reason: 'x' } });
    const { fs, deps } = setup({ verifier });
    const r = await runReplay(deps, ARGS);
    expect(r.line.state).toBe('complete');
    expect(readJson(fs, RUN1).levels[0]).toEqual({ levelId: '01-the-corridor', colour: 'error', reasonCode: 'replay_mismatch', reason: 'x' });
  });

  it('copies the eight verdict fields of a ReplayOk unchanged, whatever the colour', async () => {
    const verifier = makeVerifier({
      '01-the-corridor': okVerdict('01-the-corridor', { colour: 'red', won: false, endHp: 0, inkSpent: 4, minimalInk: 2, statusChangeIndex: null, refusedAt: 7 }),
      '02-the-chaser': okVerdict('02-the-chaser', { colour: 'amber', inkSpent: 2 }),
    });
    const { fs, deps } = setup({ verifier });
    await runReplay(deps, ARGS);
    const rec = readJson(fs, RUN1);
    expect(rec.levels[0]).toEqual(okVerdict('01-the-corridor', { colour: 'red', won: false, endHp: 0, inkSpent: 4, minimalInk: 2, statusChangeIndex: null, refusedAt: 7 }));
    expect(rec.levels[1]).toEqual(okVerdict('02-the-chaser', { colour: 'amber', inkSpent: 2 }));
    expect([rec.green, rec.amber, rec.red, rec.error]).toEqual([1, 1, 1, 2]);
  });

  it('no_solution_file and solution_unreadable start no play process', async () => {
    const s = setup({ solved: ['01-the-corridor', '02-the-chaser'] });
    s.fs.seedFile(`${CHECKOUT}\\tests\\solutions\\03-the-locked-crypt.json`, '{ broken');
    await runReplay(s.deps, ARGS);
    const rec = readJson(s.fs, RUN1);
    expect(rec.levels.slice(2).map((/** @type {any} */ l) => [l.levelId, l.reasonCode])).toEqual([
      ['03-the-locked-crypt', 'solution_unreadable'],
      ['04-the-trap-row', 'no_solution_file'],
      ['05-the-lich', 'no_solution_file'],
    ]);
    expect(played(s.fake.spawn)).toEqual(['01-the-corridor', '02-the-chaser']);
    expect(rec.coverage).toMatchObject({ listed: 5, played: 2, noSolution: 2, unreadable: 1 });
  });

  it('a timed-out play gives timedOut true, the verdict from the stub for a non-number exit code, and the Run is not failed', async () => {
    const verifier = makeVerifier({
      '02-the-chaser': (/** @type {unknown} */ exitCode) =>
        typeof exitCode === 'number' ? okVerdict('02-the-chaser') : { levelId: '02-the-chaser', colour: 'error', reasonCode: 'play_failed', reason: 'The play command failed (unexpected exit code).' },
    });
    const { fs, deps } = setup({ verifier, grim: { rules: [{ command: 'node', args: ['scripts/play.mjs', '02-the-chaser'], result: procHang() }] } });
    const r = await runReplay(deps, ARGS);
    expect(r.line.state).toBe('complete');
    const rec = readJson(fs, RUN1);
    expect(rec.levels[1]).toEqual({ levelId: '02-the-chaser', colour: 'error', reasonCode: 'play_failed', reason: 'The play command failed (unexpected exit code).', timedOut: true });
    expect('timedOut' in rec.levels[0]).toBe(false);
    const call = verifier.calls.find((/** @type {any} */ c) => c.levelId === '02-the-chaser');
    expect(typeof call.exitCode).not.toBe('number');
    expect(call.play).toBeUndefined();
    expect(rec.failure).toBeNull();
  });

  it('plays a repeated listed id once and records it in duplicateListedLevels', async () => {
    const list = procOk(JSON.stringify({ levels: ['01-the-corridor', '02-the-chaser', '01-the-corridor'] }));
    const { fs, deps, fake } = setup({ grim: { list } });
    await runReplay(deps, ARGS);
    expect(played(fake.spawn)).toEqual(['01-the-corridor', '02-the-chaser']);
    const rec = readJson(fs, RUN1);
    expect(rec.levels).toHaveLength(2);
    expect(rec.coverage).toMatchObject({ listed: 2, played: 2, duplicateListedLevels: ['01-the-corridor'] });
  });

  it('records the solution files that are not listed', async () => {
    const s = setup();
    s.fs.seedFile(`${CHECKOUT}\\tests\\solutions\\99-old-level.json`, '{}');
    await runReplay(s.deps, ARGS);
    expect(readJson(s.fs, RUN1).coverage).toMatchObject({ unlisted: 1, unlistedSolutions: ['99-old-level'] });
  });

  it('calls the verifier with exactly four arguments, the parsed solution and the parsed play output', async () => {
    const { deps, verifier, fake } = setup();
    await runReplay(deps, ARGS);
    expect(verifier.calls).toHaveLength(3);
    for (const c of verifier.calls) expect(c.n).toBe(4);
    const first = verifier.calls[0];
    expect(first.levelId).toBe('01-the-corridor');
    expect(first.stored).toEqual({ levelId: '01-the-corridor', minimalInk: 1, actions: [{ kind: 'wait' }] });
    expect(first.exitCode).toBe(0);
    expect(first.play).toEqual(JSON.parse(fake.plays['01-the-corridor'].stdout));
  });

  it('passes undefined as the play output when stdout is not JSON', async () => {
    const { deps, verifier } = setup({ grim: { plays: { '01-the-corridor': procOk('not json'), '02-the-chaser': procOk('{}'), '03-the-locked-crypt': procOk('{}') } } });
    await runReplay(deps, ARGS);
    expect(verifier.calls[0].play).toBeUndefined();
    expect(verifier.calls[1].play).toEqual({});
  });

  it('reads each solution once, and the path given to play.mjs is the path that was read', async () => {
    const s = setup();
    /** @type {string[]} */
    const reads = [];
    const fs = s.fs.withGate(async (l) => void reads.push(l.replace(/\\/g, '/')));
    await runReplay({ ...s.deps, fs }, ARGS);
    for (const id of SOLVED) {
      const file = `${CHECKOUT.replace(/\\/g, '/')}/tests/solutions/${id}.json`;
      expect(reads.filter((l) => l === `readFile ${file}`)).toHaveLength(1);
      const call = s.fake.spawn.calls.find((c) => c.command === 'node' && c.args[1] === id);
      expect(call?.args).toHaveLength(4);
      expect(call?.args[2]).toBe('--actions-file');
      expect(/** @type {string} */ (call?.args[3]).replace(/\\/g, '/')).toBe(file);
      expect(path.isAbsolute(/** @type {string} */ (call?.args[3]))).toBe(true);
    }
  });
});

describe('runReplay: the writes of step 8', () => {
  /** @param {ReturnType<typeof setup>} s @returns {{renames: string[], runFileStates: Array<string|null>}} */
  function trace(s) {
    /** @type {string[]} */
    const renames = [];
    /** @type {Array<string|null>} */
    const runFileStates = [];
    const fs = s.fs.withGate(async (label) => {
      const m = /^rename (\S+) (\S+)$/.exec(label.replace(/\\/g, '/'));
      if (!m) return;
      renames.push(path.posix.basename(m[2]));
      if (m[2].endsWith('run-000001.json')) runFileStates.push(JSON.parse(/** @type {string} */ (s.fs.peek(m[1]))).resultsKey);
    });
    s.deps.fs = fs;
    return { renames, runFileStates };
  }

  it('writes the final Result_File, then the Index_Entry, then config.json, then the Result_File with the outcome', async () => {
    const s = setup();
    const t = trace(s);
    await runReplay(s.deps, ARGS);
    expect(t.renames).toEqual(['_index.json', 'run-000001.json', 'run-000001.json', '_index.json', 'config.json', 'run-000001.json']);
    // running (null), final with resultsKey null, then the outcome
    expect(t.runFileStates).toEqual([null, null, 'ok']);
  });

  it('resultsKey too_large', async () => {
    const s = setup();
    s.fs.seedFile(CONFIG, JSON.stringify({ playtesterResults: { findings: ['f'.repeat(70000)] } }));
    await runReplay(s.deps, ARGS);
    expect(readJson(s.fs, RUN1).resultsKey).toBe('too_large');
    expect(readJson(s.fs, CONFIG).playtesterResults.findings[0]).toHaveLength(70000);
  });

  it('resultsKey config_unreadable, with config.json untouched', async () => {
    const s = setup();
    s.fs.seedFile(CONFIG, '{ not json');
    const r = await runReplay(s.deps, ARGS);
    expect(r.exitCode).toBe(0);
    expect(readJson(s.fs, RUN1).resultsKey).toBe('config_unreadable');
    expect(s.fs.peek(CONFIG)).toBe('{ not json');
  });

  it('resultsKey lock_timeout when someone else holds the results lock at the end', async () => {
    const s = setup({
      onSpawn: (spec) => {
        if (spec.command === 'node' && spec.args[1] === '03-the-locked-crypt') {
          s.fs.seedFile(RESULTS_LOCK, JSON.stringify({ pid: 1, token: 'f'.repeat(32), createdAt: new Date(s.clock.nowMs()).toISOString() }));
        }
      },
    });
    const r = await runReplay(s.deps, ARGS);
    expect(r.exitCode).toBe(0);
    expect(readJson(s.fs, RUN1).resultsKey).toBe('lock_timeout');
    expect(s.fs.has(CONFIG)).toBe(false);
    expect(JSON.parse(/** @type {string} */ (s.fs.peek(RESULTS_LOCK))).token).toBe('f'.repeat(32));
  });

  it('resultsKey write_failed when the config rename fails', async () => {
    const s = setup();
    const base = s.deps.fs;
    s.deps.fs = { ...base, rename: async (from, to) => {
      if (to.replace(/\\/g, '/').endsWith('/config.json')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      return base.rename(from, to);
    } };
    const r = await runReplay(s.deps, ARGS);
    expect(r.exitCode).toBe(0);
    expect(readJson(s.fs, RUN1).resultsKey).toBe('write_failed');
  });

  it('a rewrite of the Result_File that fails leaves the first file with resultsKey null and exit 0', async () => {
    const s = setup();
    const base = s.deps.fs;
    let runWrites = 0;
    s.deps.fs = { ...base, writeFile: async (p, d, o) => {
      if (/run-000001\.json\.[0-9a-f]+\.tmp$/.test(p.replace(/\\/g, '/')) && (runWrites += 1) === 3) throw new Error('disk full');
      return base.writeFile(p, d, o);
    } };
    const r = await runReplay(s.deps, ARGS);
    expect(r.exitCode).toBe(0);
    expect(r.line.state).toBe('complete');
    expect(readJson(s.fs, RUN1).resultsKey).toBeNull();
    expect(readJson(s.fs, RUN1).state).toBe('complete');
  });

  it('a Result_File write failure gives {"state":"record_failed"} and exit 4', async () => {
    const s = setup();
    const base = s.deps.fs;
    let runWrites = 0;
    s.deps.fs = { ...base, writeFile: async (p, d, o) => {
      if (/run-000001\.json\.[0-9a-f]+\.tmp$/.test(p.replace(/\\/g, '/')) && (runWrites += 1) === 2) throw new Error('disk full');
      return base.writeFile(p, d, o);
    } };
    const r = await runReplay(s.deps, ARGS);
    expect(r).toEqual({ exitCode: 4, line: { state: 'record_failed' } });
    expect(readJson(s.fs, RUN1).state).toBe('running');
    expect(s.fs.has(RUN_LOCK)).toBe(false);
    expect(s.fs.has(CONFIG)).toBe(false);
  });
});

describe('runReplay: the Run_Lock_File', () => {
  it('a fresh lock gives {"state":"already_running"} and exit 3, with data\\ byte-for-byte unchanged and the checkout untouched', async () => {
    const s = setup();
    s.fs.seedFile(RUN_LOCK, JSON.stringify({ pid: 1, token: 'a'.repeat(32), createdAt: new Date(T0 - 60000).toISOString() }));
    s.fs.seedFile(`${DATA}/_index.json`, '{"schemaVersion":1,"lastCounter":7,"runs":[]}\n');
    s.fs.seedFile(CONFIG, '{"theme":"dark"}\n');
    const before = s.fs.snapshot();
    const r = await runReplay(s.deps, ARGS);
    expect(r).toEqual({ exitCode: 3, line: { state: 'already_running' } });
    expect(s.fs.snapshot()).toStrictEqual(before);
    expect(s.fake.spawn.calls).toEqual([]);
  });

  it('a stale lock is taken over', async () => {
    const s = setup();
    s.fs.seedFile(RUN_LOCK, JSON.stringify({ pid: 1, token: 'a'.repeat(32), createdAt: new Date(T0 - 901000).toISOString() }));
    const r = await runReplay(s.deps, ARGS);
    expect(r.line.state).toBe('complete');
    expect(s.fs.has(RUN_LOCK)).toBe(false);
  });

  it('holds the lock during the Run and removes it afterwards', async () => {
    const s = setup({
      onSpawn: (spec) => {
        if (spec.command === 'npm' && spec.args[0] === 'ci') {
          const lock = JSON.parse(/** @type {string} */ (s.fs.peek(RUN_LOCK)));
          expect(lock).toMatchObject({ pid: 4242 });
          expect(lock.token).toMatch(/^[0-9a-f]{32}$/);
        }
      },
    });
    await runReplay(s.deps, ARGS);
    expect(s.fs.has(RUN_LOCK)).toBe(false);
  });

  it('releases the lock also after an internal error', async () => {
    const verifier = makeVerifier({ '01-the-corridor': () => { throw new Error('boom'); } });
    const s = setup({ verifier });
    await runReplay(s.deps, ARGS);
    expect(s.fs.has(RUN_LOCK)).toBe(false);
  });

  it('removes the lock only when it holds this Run\'s token', async () => {
    const foreign = JSON.stringify({ pid: 9, token: 'e'.repeat(32), createdAt: new Date(T0).toISOString() });
    const s = setup({
      onSpawn: (spec) => {
        if (spec.command === 'node' && spec.args[1] === '02-the-chaser') s.fs.seedFile(RUN_LOCK, foreign); // taken over by someone else
      },
    });
    await runReplay(s.deps, ARGS);
    expect(s.fs.peek(RUN_LOCK)).toBe(foreign);
  });

  it('a file-system error on the lock gives exit 4 and nothing is recorded', async () => {
    const s = setup();
    const base = s.deps.fs;
    s.deps.fs = { ...base, writeFile: async (p, d, o) => {
      if (p.replace(/\\/g, '/').endsWith('.run.lock')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return base.writeFile(p, d, o);
    } };
    const r = await runReplay(s.deps, ARGS);
    expect(r).toEqual({ exitCode: 4, line: { state: 'record_failed' } });
    expect(s.fake.spawn.calls).toEqual([]);
    expect(s.fs.has(`${DATA}/_index.json`)).toBe(false);
  });
});

describe('runReplay: previousLaunch', () => {
  const launch = (/** @type {any} */ v) => JSON.stringify(v);

  it('copies outcome and finishedAt from last-launch.json and nothing else', async () => {
    const s = setup();
    s.fs.seedFile(`${DATA}/launcher/last-launch.json`, launch({ outcome: 'killed-by-launcher', finishedAt: '2026-11-30T03:15:00.000Z', exitCode: null, repoUrl: 'x', childLog: 'ok' }));
    await runReplay(s.deps, ARGS);
    expect(readJson(s.fs, RUN1).previousLaunch).toEqual({ outcome: 'killed-by-launcher', finishedAt: '2026-11-30T03:15:00.000Z' });
  });

  it('is null when the file is missing, unparsable, BOM-prefixed or not an object', async () => {
    for (const text of [undefined, '{ no', `\ufeff${launch({ outcome: 'child-exited', finishedAt: null })}`, '[1]', 'null', launch({ finishedAt: 'x' })]) {
      const s = setup();
      if (text !== undefined) s.fs.seedFile(`${DATA}/launcher/last-launch.json`, text);
      await runReplay(s.deps, ARGS);
      expect(readJson(s.fs, RUN1).previousLaunch).toBeNull();
    }
  });

  it('never writes under data\\launcher', async () => {
    const s = setup();
    const text = launch({ outcome: 'child-exited', finishedAt: null });
    s.fs.seedFile(`${DATA}/launcher/last-launch.json`, text);
    await runReplay(s.deps, ARGS);
    expect(s.fs.paths(`${DATA}/launcher`)).toEqual([`${DATA}/launcher/last-launch.json`.replace(/\\/g, '/')]);
    expect(s.fs.peek(`${DATA}/launcher/last-launch.json`)).toBe(text);
  });
});

describe('runReplay: later Runs', () => {
  it('a second Run takes the next counter and the trend holds both Runs', async () => {
    const s = setup();
    await runReplay(s.deps, ARGS);
    s.clock.advance(3600000);
    const r = await runReplay(s.deps, ARGS);
    expect(r.line.runId).toBe('run-000002');
    const results = readJson(s.fs, CONFIG).playtesterResults;
    expect(results.trend.map((/** @type {any} */ t) => t.counter)).toEqual([2, 1]);
    expect(results.latest.runId).toBe('run-000002');
  });

  it('a failed Run is the latest (Decision 16) and the trend still shows the earlier Run', async () => {
    const s = setup();
    await runReplay(s.deps, ARGS);
    s.clock.advance(3600000);
    const failing = setup({ grim: { npm: { ci: procFail(1) } } });
    // Same file system and clock: run the failing toolchain against the first Run's data.
    const deps = { ...s.deps, spawn: failing.deps.spawn };
    const r = await runReplay(deps, ARGS);
    expect(r.line.state).toBe('failed');
    const results = readJson(s.fs, CONFIG).playtesterResults;
    expect(results.latest).toMatchObject({ runId: 'run-000002', state: 'failed' });
    expect(results.trend.map((/** @type {any} */ t) => [t.counter, t.state])).toEqual([[2, 'failed'], [1, 'complete']]);
  });
});

describe('runReplay properties', () => {
  const NUM_RUNS = 200;

  // Feature: replay-runner, Property 14: Same play output gives the same Level_Entries
  it('Property 14: two Runs over the same list, solution files, play outputs and verdicts give deeply equal Level_Entries copied from the verdicts', async () => {
    const arbVerdict = (/** @type {string} */ id) =>
      fc.oneof(
        fc
          .record({
            colour: fc.constantFrom('green', 'amber', 'red'),
            won: fc.boolean(),
            endHp: fc.nat({ max: 5 }),
            inkSpent: fc.nat({ max: 5 }),
            minimalInk: fc.nat({ max: 5 }),
            statusChangeIndex: fc.option(fc.nat({ max: 20 }), { nil: null }),
            refusedAt: fc.option(fc.nat({ max: 20 }), { nil: null }),
          })
          .map((v) => ({ levelId: id, ...v })),
        fc
          .record({ reasonCode: fc.constantFrom('play_failed', 'malformed_play_result', 'replay_mismatch', 'level_mismatch'), reason: fc.string({ maxLength: 30 }) })
          .map((v) => ({ levelId: id, colour: 'error', ...v })),
      );
    const arbPlay = fc.oneof(
      fc.record({ kind: fc.constant('json'), exit: fc.constantFrom(0, 0, 1) }),
      fc.record({ kind: fc.constant('garbage'), exit: fc.constantFrom(0, 2) }),
      fc.record({ kind: fc.constant('hang'), exit: fc.constant(0) }),
    );
    const arbWorld = fc.record({
      list: arbLevelList,
      files: fc.array(fc.constantFrom('valid', 'missing', 'unreadable'), { minLength: VALID_LEVEL_POOL.length, maxLength: VALID_LEVEL_POOL.length }),
      plays: fc.array(arbPlay, { minLength: VALID_LEVEL_POOL.length, maxLength: VALID_LEVEL_POOL.length }),
      verdicts: fc.tuple(...VALID_LEVEL_POOL.map(arbVerdict)),
    });

    await fc.assert(
      fc.asyncProperty(arbWorld, async (world) => {
        /** @param {typeof world} w */
        async function once(w) {
          /** @type {Record<string, any>} */
          const plays = {};
          VALID_LEVEL_POOL.forEach((id, i) => {
            const p = w.plays[i];
            plays[id] = p.kind === 'hang' ? procHang() : p.kind === 'json' ? { ...procOk(`{"canned":"${id}"}`), exitCode: p.exit } : { ...procOk('garbage'), exitCode: p.exit };
          });
          /** @type {Record<string, any>} */
          const table = {};
          VALID_LEVEL_POOL.forEach((id, i) => (table[id] = w.verdicts[i]));
          const s = setup({ solved: [], verifier: makeVerifier(table), grim: { list: procOk(JSON.stringify({ levels: w.list })), plays } });
          VALID_LEVEL_POOL.forEach((id, i) => {
            if (w.files[i] === 'valid') s.seedSolution(id);
            else if (w.files[i] === 'unreadable') s.fs.seedFile(`${CHECKOUT}\\tests\\solutions\\${id}.json`, '{ broken');
          });
          const r = await runReplay(s.deps, ARGS);
          return { r, rec: readJson(s.fs, RUN1), verifierCalls: s.verifier.calls };
        }

        const a = await once(world);
        const b = await once(world);
        expect(b.rec.levels).toStrictEqual(a.rec.levels);
        expect(b.r).toStrictEqual(a.r);

        const listOk = world.list.length > 0 && world.list.every((id) => typeof id === 'string' && VALID_LEVEL_POOL.includes(id));
        if (!listOk) {
          expect(a.rec.state).toBe('failed');
          expect(a.rec.levels).toEqual([]);
          return;
        }
        const distinct = [...new Set(/** @type {string[]} */ (world.list))];
        expect(a.rec.state).toBe('complete');
        expect(a.rec.levels.map((/** @type {any} */ l) => l.levelId)).toEqual(distinct);
        a.rec.levels.forEach((/** @type {any} */ entry, /** @type {number} */ i) => {
          const idx = VALID_LEVEL_POOL.indexOf(distinct[i]);
          const file = world.files[idx];
          if (file === 'missing') return expect(entry).toStrictEqual(levelEntryErrorOf(distinct[i], 'no_solution_file'));
          if (file === 'unreadable') return expect(entry).toStrictEqual(levelEntryErrorOf(distinct[i], 'solution_unreadable'));
          const hung = world.plays[idx].kind === 'hang';
          const v = /** @type {any} */ (world.verdicts[idx]);
          const expected = v.colour === 'error' ? { levelId: v.levelId, colour: 'error', reasonCode: v.reasonCode, reason: v.reason } : { ...v };
          expect(entry).toStrictEqual(hung ? { ...expected, timedOut: true } : expected);
        });
        // The verifier is the only source of colours: never more than one call per playable level.
        expect(a.verifierCalls.length).toBe(distinct.filter((id) => world.files[VALID_LEVEL_POOL.indexOf(id)] === 'valid').length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /** @param {string} levelId @param {'no_solution_file'|'solution_unreadable'} code */
  function levelEntryErrorOf(levelId, code) {
    const reason = code === 'no_solution_file' ? 'The listed level has no stored solution file.' : 'The stored solution file could not be read or is not valid JSON.';
    return { levelId, colour: 'error', reasonCode: code, reason };
  }

  // Feature: replay-runner, Property 7: Overlap records nothing
  it('Property 7a: a fresh Run_Lock_File gives already_running, leaves data\\ and the checkout byte-for-byte equal and takes no counter', async () => {
    const arbFiles = fc.record({
      index: fc.boolean(),
      config: fc.boolean(),
      runs: fc.array(fc.integer({ min: 1, max: 9 }), { maxLength: 3 }),
      launch: fc.boolean(),
      junk: fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
    });
    await fc.assert(
      fc.asyncProperty(arbFiles, fc.integer({ min: 0, max: 900000 }), fc.boolean(), async (files, ageMs, jsonLock) => {
        const s = setup();
        if (files.index) s.fs.seedFile(`${DATA}/_index.json`, '{"schemaVersion":1,"lastCounter":9,"runs":[]}\n');
        if (files.config) s.fs.seedFile(CONFIG, '{"theme":"dark"}\n');
        for (const n of files.runs) s.fs.seedFile(`${DATA}/runs/run-${String(n).padStart(6, '0')}.json`, '{}');
        if (files.launch) s.fs.seedFile(`${DATA}/launcher/last-launch.json`, '{"outcome":"child-exited","finishedAt":null}');
        files.junk.forEach((j, i) => s.fs.seedFile(`${DATA}/other${i}.txt`, j));
        s.fs.seedFile(`${CHECKOUT}\\marker.txt`, 'keep');
        const created = T0 - ageMs;
        if (jsonLock) s.fs.seedFile(RUN_LOCK, JSON.stringify({ pid: 5, token: 'c'.repeat(32), createdAt: new Date(created).toISOString() }));
        else s.fs.seedFile(RUN_LOCK, 'not json', { mtimeMs: created });
        const before = s.fs.snapshot();
        const r = await runReplay(s.deps, ARGS);
        expect(r).toEqual({ exitCode: 3, line: { state: 'already_running' } });
        expect(s.fs.snapshot()).toStrictEqual(before);
        expect(s.fake.spawn.calls).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 7: Overlap records nothing
  it('Property 7b: for two Runs with a scripted interleaving, no two Runs are inside the checkout-to-end span at the same time, and a Run that overlapped records nothing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(/** @type {0} */ (0), /** @type {1} */ (1)), { minLength: 1, maxLength: 300 }), async (choices) => {
        const s = setup();
        const sched = makeScheduler(choices);
        let seq = 0;
        /** @type {Array<{first: number|null, end: number|null, spawns: number}>} */
        const marks = [
          { first: null, end: null, spawns: 0 },
          { first: null, end: null, spawns: 0 },
        ];
        /** @param {0|1} w */
        const depsFor = (w) => ({
          ...s.deps,
          fs: s.fs.withGate(sched.gate(w)),
          token: makeTokenSource(w * 1000),
          pid: 100 + w,
          spawn: Object.assign(
            async (/** @type {import('../scripts/replay/types.mjs').ProcSpec} */ spec) => {
              seq += 1;
              marks[w].first ??= seq;
              marks[w].spawns += 1;
              return s.spawn(spec);
            },
            { calls: s.spawn.calls },
          ),
        });
        /** @param {0|1} w */
        const run = (w) =>
          runReplay(depsFor(w), ARGS).finally(() => {
            seq += 1;
            marks[w].end = seq;
            sched.done(w);
          });
        const [a, b] = await Promise.all([run(0), run(1)]);

        for (const [w, r] of /** @type {const} */ ([[0, a], [1, b]])) {
          if (r.line.state === 'already_running') {
            expect(r.exitCode).toBe(3);
            expect(marks[w].spawns).toBe(0);
          }
        }
        const ran = [0, 1].filter((w) => marks[w].spawns > 0);
        if (ran.length === 2) {
          const [x, y] = /** @type {number} */ (marks[0].first) < /** @type {number} */ (marks[1].first) ? [0, 1] : [1, 0];
          expect(/** @type {number} */ (marks[x].end)).toBeLessThan(/** @type {number} */ (marks[y].first));
        }
        expect(ran.length).toBeGreaterThanOrEqual(1);
        // One counter per Run that ran, and no more.
        const index = readJson(s.fs, `${DATA}/_index.json`);
        expect(index.runs.length).toBe(ran.length);
        expect(s.fs.has(RUN_LOCK)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
