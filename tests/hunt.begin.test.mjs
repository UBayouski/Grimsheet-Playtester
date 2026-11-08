// @ts-check
// Unit tests of scripts/hunt/begin.mjs (design: "Hunt_Begin flow", "State across the four processes", "What a kill
// leaves behind"; Requirements 4.1, 4.6, 4.7, 4.9, 5.1 to 5.9, 6.1 to 6.3, 11.2, 11.3, 11.5, 11.6, 15.2, 15.3).
// The module does not exist yet: these tests fail until task 14.2.
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { runBegin } from '../scripts/hunt/begin.mjs';
import { ALLOWED_GIT, checkoutPath } from '../scripts/replay/checkout.mjs';
import { STEP_LIMITS_MS } from '../scripts/replay/process.mjs';
import { HUNT_RECORD_PATTERN, huntIdOf } from '../scripts/hunt/hunt-record.mjs';
import { DEFAULT_BRANCH, DEFAULT_REPO_URL, HUNT_BUDGET, LEVEL_BUDGET, REFUSAL_BUDGET, TIME_BUDGET_SEC } from '../scripts/hunt/limits.mjs';
import { makeFakeClock, makeScheduler, makeTokenSource } from './helpers/fake-fs.mjs';
import { procCannotStart, procFail, procHang, procOk } from './helpers/fake-spawn.mjs';
import { APP_NAME, DATA_FOLDER, HUNT_CHECKOUT, HUNT_LOCAL_FOLDER, LOCAL_APP_DATA, makeHuntWorld } from './helpers/hunt-world.mjs';

const HUNTS = `${DATA_FOLDER}\\hunts`;
const LOCK = `${DATA_FOLDER}\\.hunt.lock`;
const ACTIVE = `${HUNTS}\\active.json`;
const CONTROL = `${DATA_FOLDER}\\launcher\\control.json`;
const REPLAY_CHECKOUT = /** @type {string} */ (checkoutPath(LOCAL_APP_DATA, APP_NAME));
const LOCK_AGE_MS = 2400 * 1000;
const FIVE_LEVELS = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt', '04-the-trap-row', '05-the-lich'];
const OWN_URL = 'https://example.invalid/own.git';

/** @param {number} ms @returns {string} */
const isoOf = (ms) => new Date(ms).toISOString();

/**
 * A Hunt world whose process starter also notes, for each call, whether the Hunt lock file existed and what the
 * Hunt_Record files looked like at the first call.
 * @param {Parameters<typeof makeHuntWorld>[0] & {clock?: ReturnType<typeof makeFakeClock>}} [options]
 */
function makeWorld(options = {}) {
  const clock = options.clock ?? makeFakeClock();
  const w = makeHuntWorld({ ...options, clock });
  const inner = w.deps.spawn;
  /** @type {{noLock: string[], first: null | {lockHeld: boolean, records: Record<string, any>}}} */
  const seen = { noLock: [], first: null };
  w.deps.spawn = /** @type {any} */ (
    Object.assign(
      /** @param {any} spec */
      async (spec) => {
        const lockHeld = w.fs.has(LOCK);
        if (!lockHeld) seen.noLock.push(`${spec.command} ${spec.args.join(' ')}`);
        if (seen.first === null) seen.first = { lockHeld, records: recordsOf(w) };
        return inner(spec);
      },
      { calls: /** @type {any} */ (inner).calls },
    )
  );
  return { ...w, seen };
}

/** @param {{fs: ReturnType<typeof makeHuntWorld>['fs']}} w @returns {Record<string, any>} Hunt_Record files by id */
function recordsOf(w) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const p of w.fs.paths(HUNTS.replace(/\\/g, '/'))) {
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (HUNT_RECORD_PATTERN.test(name)) out[name.slice(0, -'.json'.length)] = JSON.parse(/** @type {string} */ (w.fs.peek(p)));
  }
  return out;
}

/** @param {{fs: ReturnType<typeof makeHuntWorld>['fs']}} w @param {string} file @returns {any} */
const readJson = (w, file) => JSON.parse(/** @type {string} */ (w.fs.peek(file)));

/** A Hunt lock of the given age. @param {ReturnType<typeof makeWorld>} w @param {number} ageMs @param {string} [token] */
function seedLock(w, ageMs, token = '11112222333344445555666677778888') {
  w.fs.seedFile(LOCK, JSON.stringify({ pid: 1, token, createdAt: isoOf(w.clock.nowMs() - ageMs) }));
}

/** A record file that is not running. @param {ReturnType<typeof makeWorld>} w @param {string} id @param {any} [extra] */
function seedRecord(w, id, extra = {}) {
  w.fs.seedFile(`${HUNTS}\\${id}.json`, JSON.stringify({ schemaVersion: 1, huntId: id, state: 'complete', ...extra }));
}

/** @param {number} n @returns {string[]} valid level ids */
const levelIds = (n) => Array.from({ length: n }, (_, i) => `lvl-${String(i + 1).padStart(2, '0')}`);

/** @param {string[]} ids */
const listOf = (ids) => procOk(JSON.stringify({ levels: ids }));

/** @param {ReturnType<typeof makeWorld>} w @returns {string[]} one line per process call */
const callLines = (w) => w.calls.spawn.map((c) => [c.command, ...c.args].join(' '));

describe('Hunt_Begin: ready Hunt', () => {
  it('prints the ready body, keeps the lock, writes active.json and the running record', async () => {
    const w = makeWorld();
    const startMs = w.clock.nowMs();
    const huntId = huntIdOf(startMs);
    const r = await w.begin();

    expect(r.exit).toBe(0);
    expect(r.body).toEqual({
      state: 'ready',
      huntId,
      commit: w.commit,
      levels: FIVE_LEVELS,
      levelsSkipped: 0,
      budget: { perLevel: LEVEL_BUDGET, total: HUNT_BUDGET, seconds: TIME_BUDGET_SEC, refusals: REFUSAL_BUDGET },
    });

    // The lock is NOT released: it holds the Hunt token and the creation time of the start.
    const lock = readJson(w, LOCK);
    expect(lock.createdAt).toBe(isoOf(startMs));
    const active = readJson(w, ACTIVE);
    expect(active).toEqual({ schemaVersion: 1, huntId, token: lock.token, readyAt: active.readyAt });
    expect(Date.parse(active.readyAt)).toBeGreaterThanOrEqual(startMs);

    // The record is running with readyAt, the commit and one zero counter set per level.
    const record = readJson(w, `${HUNTS}\\${huntId}.json`);
    expect(record).toMatchObject({
      schemaVersion: 1,
      huntId,
      state: 'running',
      startedAt: isoOf(startMs),
      readyAt: active.readyAt,
      finishedAt: null,
      repoUrl: DEFAULT_REPO_URL,
      branch: DEFAULT_BRANCH,
      commit: w.commit,
      budget: { perLevel: LEVEL_BUDGET, total: HUNT_BUDGET, seconds: TIME_BUDGET_SEC, refusals: REFUSAL_BUDGET },
      levelsSkipped: 0,
      attempts: 0,
      refusals: 0,
      reasonCodes: {},
      pendingFindings: [],
      failure: null,
    });
    expect(Object.keys(record.levels)).toEqual(FIVE_LEVELS);
    for (const id of FIVE_LEVELS) {
      expect(record.levels[id]).toEqual({ attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 });
    }
  });

  it('writes the running record and holds the lock before the first process starts', async () => {
    const w = makeWorld();
    const huntId = huntIdOf(w.clock.nowMs());
    await w.begin();
    expect(w.seen.first).not.toBeNull();
    expect(w.seen.first?.lockHeld).toBe(true);
    const early = w.seen.first?.records[huntId];
    expect(early).toMatchObject({ huntId, state: 'running', readyAt: null, commit: null });
    expect(w.seen.noLock).toEqual([]);
  });

  it('runs git, npm and the level list in the Hunt_Checkout with the replay step limits', async () => {
    const w = makeWorld();
    await w.begin();
    expect(callLines(w)).toEqual([
      'git remote get-url origin',
      `git fetch --depth 1 -- origin ${DEFAULT_BRANCH}`,
      'git reset --hard FETCH_HEAD',
      'git rev-parse HEAD',
      'npm ci',
      'npm run build:play',
      'node scripts/play.mjs --list',
    ]);
    for (const c of w.calls.spawn) expect(c.cwd).toBe(HUNT_CHECKOUT);
    for (const c of w.calls.spawn.filter((x) => x.command !== 'npm')) expect(c.shell).toBe(false);
    const limits = w.calls.spawn.map((c) => c.timeoutMs);
    expect(limits).toEqual([
      STEP_LIMITS_MS.git,
      STEP_LIMITS_MS.gitFetch,
      STEP_LIMITS_MS.git,
      STEP_LIMITS_MS.git,
      STEP_LIMITS_MS.npmCi,
      STEP_LIMITS_MS.build,
      STEP_LIMITS_MS.list,
    ]);
  });
});

describe('Hunt_Begin: bad arguments', () => {
  it('refuses any argument with exit 3 and touches nothing', async () => {
    const w = makeWorld();
    w.seedConfig({ foreign: 1 });
    const before = w.fs.snapshot();
    const r = await w.begin(['--now']);
    expect(r).toEqual({ exit: 3, body: { state: 'refused', reasonCode: 'bad_arguments' } });
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.fs.has(LOCK)).toBe(false);
    expect(w.calls.spawn).toHaveLength(0);
  });

  it('checks the arguments before the lock: a fresh lock does not turn it into already_running', async () => {
    const w = makeWorld();
    seedLock(w, 1000);
    const before = w.fs.snapshot();
    const r = await w.begin(['x']);
    expect(r).toEqual({ exit: 3, body: { state: 'refused', reasonCode: 'bad_arguments' } });
    expect(w.fs.snapshot()).toEqual(before);
  });
});

describe('Hunt_Begin: Hunt lock', () => {
  /** A world with a lock plus files that a Begin would change (prune, pointer, candidates, settings). @param {number} ageMs */
  function busyWorld(ageMs) {
    const w = makeWorld();
    for (let d = 1; d <= 11; d += 1) seedRecord(w, `hunt-202611${String(d).padStart(2, '0')}T000000Z`);
    w.fs.seedFile(ACTIVE, JSON.stringify({ schemaVersion: 1, huntId: 'hunt-20261101T000000Z', token: 'zzz', readyAt: isoOf(0) }));
    for (let d = 1; d <= 12; d += 1) w.fs.seedFile(`${HUNT_LOCAL_FOLDER}\\candidates\\hunt-202611${String(d).padStart(2, '0')}T000000Z\\001-x.json`, '{}');
    w.fs.seedFile(CONTROL, JSON.stringify({ repoUrl: OWN_URL, branch: 'dev' }));
    w.seedConfig({ foreign: 1 });
    w.fs.seedFile(`${HUNT_CHECKOUT}\\marker.txt`, 'm');
    seedLock(w, ageMs);
    return w;
  }

  it('a fresh lock gives already_running, exit 3, and changes no file', async () => {
    const w = busyWorld(100 * 1000);
    const before = w.fs.snapshot();
    const r = await w.begin();
    expect(r).toEqual({ exit: 3, body: { state: 'already_running' } });
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.calls.spawn).toHaveLength(0);
  });

  it('a fresh lock before any hunt file exists creates no folder or file', async () => {
    const w = makeWorld();
    seedLock(w, 5000);
    const r = await w.begin();
    expect(r.exit).toBe(3);
    await expect(w.fs.readdir(HUNTS)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(w.calls.spawn).toHaveLength(0);
  });

  it('a lock exactly 2400 s old is still live', async () => {
    const w = busyWorld(LOCK_AGE_MS);
    const before = w.fs.snapshot();
    const r = await w.begin();
    expect(r).toEqual({ exit: 3, body: { state: 'already_running' } });
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.calls.spawn).toHaveLength(0);
  });

  it('a lock 2400 s + 1 ms old is stale and taken over', async () => {
    const w = makeWorld();
    seedLock(w, LOCK_AGE_MS + 1, 'oldtoken');
    const r = await w.begin();
    expect(r.exit).toBe(0);
    expect(r.body.state).toBe('ready');
    const lock = readJson(w, LOCK);
    expect(lock.token).not.toBe('oldtoken');
    expect(readJson(w, ACTIVE).token).toBe(lock.token);
    expect(w.seen.noLock).toEqual([]);
  });

  it('a stale takeover marks old running records cut-short and leaves the others', async () => {
    const w = makeWorld();
    const now = w.clock.nowMs();
    seedLock(w, LOCK_AGE_MS + 5000);
    seedRecord(w, 'hunt-20261108T080000Z', { state: 'running', startedAt: isoOf(now - 3 * 3600 * 1000), finishedAt: null });
    seedRecord(w, 'hunt-20261108T103000Z', { state: 'running', startedAt: isoOf(now - LOCK_AGE_MS - 1), finishedAt: null });
    seedRecord(w, 'hunt-20261108T102000Z', { state: 'running', startedAt: isoOf(now - LOCK_AGE_MS), finishedAt: null });
    seedRecord(w, 'hunt-20261108T104000Z', { state: 'running', startedAt: isoOf(now - 600 * 1000), finishedAt: null });
    seedRecord(w, 'hunt-20261108T070000Z', { state: 'failed', startedAt: isoOf(now - 5 * 3600 * 1000), finishedAt: isoOf(now - 4 * 3600 * 1000) });
    const r = await w.begin();
    expect(r.exit).toBe(0);
    const records = recordsOf(w);
    expect(records['hunt-20261108T080000Z'].state).toBe('cut-short');
    expect(records['hunt-20261108T103000Z'].state).toBe('cut-short');
    expect(records['hunt-20261108T102000Z'].state).toBe('running'); // exactly 2400 s: still live
    expect(records['hunt-20261108T104000Z'].state).toBe('running');
    expect(records['hunt-20261108T070000Z'].state).toBe('failed');
    expect(records[/** @type {string} */ (r.body.huntId)].state).toBe('running');
  });

  it('removes a stale active.json (the Hunt fails, so no pointer is written)', async () => {
    const w = makeWorld({ grim: { npm: { ci: procFail(1) } } });
    w.fs.seedFile(ACTIVE, JSON.stringify({ schemaVersion: 1, huntId: 'hunt-20261101T000000Z', token: 'zzz', readyAt: isoOf(0) }));
    const r = await w.begin();
    expect(r.body.state).toBe('failed');
    expect(w.fs.has(ACTIVE)).toBe(false);
  });
});

describe('Hunt_Begin: Hunt_Id', () => {
  it('uses the next free second when the record file exists', async () => {
    const w = makeWorld();
    const base = w.clock.nowMs();
    seedRecord(w, huntIdOf(base));
    const taken = w.fs.peek(`${HUNTS}\\${huntIdOf(base)}.json`);
    const r = await w.begin();
    expect(r.body.huntId).toBe(huntIdOf(base + 1000));
    expect(w.fs.peek(`${HUNTS}\\${huntIdOf(base)}.json`)).toBe(taken);
    expect(readJson(w, `${HUNTS}\\${huntIdOf(base + 1000)}.json`).state).toBe('running');
    expect(readJson(w, ACTIVE).huntId).toBe(huntIdOf(base + 1000));
  });

  it('moves on again when several seconds are taken', async () => {
    const w = makeWorld();
    const base = w.clock.nowMs();
    for (const s of [0, 1, 2]) seedRecord(w, huntIdOf(base + s * 1000));
    const r = await w.begin();
    expect(r.body.huntId).toBe(huntIdOf(base + 3000));
  });
});

describe('Hunt_Begin: failed stages', () => {
  const CHECKOUT_PARENT_GIT = 'git remote';
  /**
   * @type {Array<{
   *   name: string,
   *   build: (clock: ReturnType<typeof makeFakeClock>) => ReturnType<typeof makeWorld>,
   *   failure: Record<string, unknown>,
   *   last: string | null,
   * }>}
   */
  const CASES = [
    {
      name: 'no_local_app_data',
      build: (clock) => {
        const w = makeWorld({ clock });
        w.deps.paths = { ...w.deps.paths, localAppData: '' };
        return w;
      },
      failure: {
        stage: 'checkout',
        reasonCode: 'no_local_app_data',
        message: 'The LOCALAPPDATA setting is missing, so there is no place for the Grimsheet checkout.',
        exitCode: null,
      },
      last: null,
    },
    {
      name: 'checkout_inside_app',
      build: (clock) => {
        const w = makeWorld({ clock });
        w.deps.paths = { ...w.deps.paths, appFolder: `${LOCAL_APP_DATA}\\${APP_NAME}` };
        return w;
      },
      failure: {
        stage: 'checkout',
        reasonCode: 'checkout_inside_app',
        message: 'The checkout folder would be inside the app folder, which is not allowed.',
        exitCode: null,
      },
      last: null,
    },
    {
      name: 'checkout_delete_failed',
      build: (clock) => {
        const w = makeWorld({ clock, grim: { originUrl: 'https://example.invalid/other.git' } });
        const real = w.fs;
        w.deps.fs = /** @type {any} */ ({
          ...real,
          /** @param {string} p @param {any} o */
          rm: async (p, o) => {
            if (String(p).replace(/\\/g, '/').startsWith(HUNT_CHECKOUT.replace(/\\/g, '/'))) throw Object.assign(new Error('EPERM: busy'), { code: 'EPERM' });
            return real.rm(p, o);
          },
        });
        return w;
      },
      failure: { stage: 'checkout', reasonCode: 'checkout_delete_failed', message: 'The old checkout could not be removed safely.', exitCode: null },
      last: CHECKOUT_PARENT_GIT,
    },
    {
      name: 'git_not_found',
      build: (clock) => makeWorld({ clock, grim: { git: { 'remote get-url': procCannotStart() } } }),
      failure: {
        stage: 'checkout',
        reasonCode: 'git_not_found',
        message: 'git could not be started. Install git and make sure it is on the PATH.',
        exitCode: null,
      },
      last: CHECKOUT_PARENT_GIT,
    },
    {
      name: 'git_failed',
      build: (clock) => makeWorld({ clock, grim: { git: { fetch: procFail(128) } } }),
      failure: { stage: 'checkout', reasonCode: 'git_failed', message: 'A git step failed with exit code 128.', exitCode: 128 },
      last: 'git fetch',
    },
    {
      name: 'step_timeout (a step that hangs)',
      build: (clock) => makeWorld({ clock, grim: { npm: { ci: procHang() } } }),
      failure: {
        stage: 'install',
        reasonCode: 'step_timeout',
        message: 'The step "npm ci" did not finish in time.',
        exitCode: null,
        step: 'npm ci',
      },
      last: 'npm ci',
    },
    {
      name: 'step_timeout (the Begin allowance is spent)',
      build: (clock) =>
        makeWorld({
          clock,
          grim: {
            rules: [
              {
                command: 'npm',
                args: ['run', 'build:play'],
                result: () => {
                  clock.advance(600 * 1000);
                  return procOk('built');
                },
              },
            ],
          },
        }),
      failure: {
        stage: 'list',
        reasonCode: 'step_timeout',
        message: 'The step "node play.mjs --list" did not finish in time.',
        exitCode: null,
        step: 'node play.mjs --list',
      },
      last: 'npm run',
    },
    {
      name: 'install_failed',
      build: (clock) => makeWorld({ clock, grim: { npm: { ci: procFail(1) } } }),
      failure: { stage: 'install', reasonCode: 'install_failed', message: 'npm ci failed with exit code 1.', exitCode: 1 },
      last: 'npm ci',
    },
    {
      name: 'build_failed',
      build: (clock) => makeWorld({ clock, grim: { npm: { build: procFail(2) } } }),
      failure: { stage: 'build', reasonCode: 'build_failed', message: 'The Grimsheet build failed with exit code 2.', exitCode: 2 },
      last: 'npm run',
    },
    {
      name: 'list_failed',
      build: (clock) => makeWorld({ clock, grim: { list: procFail(1, 'boom') } }),
      failure: {
        stage: 'list',
        reasonCode: 'list_failed',
        message: 'The level list could not be read or has an invalid level id.',
        exitCode: 1,
      },
      last: 'node scripts/play.mjs',
    },
    {
      name: 'empty_level_list',
      build: (clock) => makeWorld({ clock, grim: { list: listOf([]) } }),
      failure: { stage: 'list', reasonCode: 'empty_level_list', message: 'Grimsheet lists no levels.', exitCode: null },
      last: 'node scripts/play.mjs',
    },
  ];

  it.each(CASES)('$name: failed record, lock released, no pointer, exit 0', async ({ build, failure, last }) => {
    const clock = makeFakeClock();
    const w = build(clock);
    const huntId = huntIdOf(clock.nowMs());
    w.fs.seedFile(ACTIVE, JSON.stringify({ schemaVersion: 1, huntId: 'hunt-20261101T000000Z', token: 'zzz', readyAt: isoOf(0) }));
    const r = await w.begin();

    expect(r.exit).toBe(0);
    expect(r.body).toEqual({ state: 'failed', huntId, failure });
    const record = readJson(w, `${HUNTS}\\${huntId}.json`);
    expect(record.state).toBe('failed');
    expect(record.failure).toEqual(failure);
    expect(record.readyAt).toBeNull();
    expect(typeof record.finishedAt).toBe('string');
    expect(record.levels).toEqual({});
    expect(w.fs.has(LOCK)).toBe(false);
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.seen.noLock).toEqual([]);
    const lastCall = w.calls.spawn.at(-1);
    expect(lastCall ? `${lastCall.command} ${lastCall.args[0]}` : null).toBe(last);
  });
});

describe('Hunt_Begin: level list', () => {
  it('skips an id over 40 characters, keeps one of exactly 40, and counts the skipped', async () => {
    const forty = 'a'.repeat(40);
    const long = 'b'.repeat(41);
    const w = makeWorld({ grim: { list: listOf(['lvl-01', long, forty, 'lvl-02']) } });
    const huntId = huntIdOf(w.clock.nowMs());
    const r = await w.begin();
    expect(r.exit).toBe(0);
    expect(r.body.levels).toEqual(['lvl-01', forty, 'lvl-02']);
    expect(r.body.levelsSkipped).toBe(1);
    const record = readJson(w, `${HUNTS}\\${huntId}.json`);
    expect(Object.keys(record.levels)).toEqual(['lvl-01', forty, 'lvl-02']);
    expect(record.levelsSkipped).toBe(1);
  });

  it('hunts only the first 20 levels and counts the rest as skipped', async () => {
    const ids = levelIds(25);
    const w = makeWorld({ grim: { list: listOf(ids) } });
    const huntId = huntIdOf(w.clock.nowMs());
    const r = await w.begin();
    expect(r.body.levels).toEqual(ids.slice(0, 20));
    expect(r.body.levelsSkipped).toBe(5);
    const record = readJson(w, `${HUNTS}\\${huntId}.json`);
    expect(Object.keys(record.levels)).toEqual(ids.slice(0, 20));
    expect(record.levelsSkipped).toBe(5);
  });

  it('applies the length rule first, then the cap of 20 (literal reading of the flow)', async () => {
    const ids = [ 'c'.repeat(41), ...levelIds(24) ];
    const w = makeWorld({ grim: { list: listOf(ids) } });
    const r = await w.begin();
    expect(r.body.levels).toEqual(levelIds(20));
    expect(r.body.levelsSkipped).toBe(5);
  });
});

describe('Hunt_Begin: control.json', () => {
  const DEFAULTS = [DEFAULT_REPO_URL, DEFAULT_BRANCH];
  /** @type {Array<[string, string | null, string, string]>} */
  const CASES = [
    ['both fields valid', JSON.stringify({ repoUrl: OWN_URL, branch: 'dev' }), OWN_URL, 'dev'],
    ['missing file', null, DEFAULTS[0], DEFAULTS[1]],
    ['BOM-prefixed', `\uFEFF${JSON.stringify({ repoUrl: OWN_URL, branch: 'dev' })}`, DEFAULTS[0], DEFAULTS[1]],
    ['invalid JSON', '{not json', DEFAULTS[0], DEFAULTS[1]],
    ['an array', '[1,2]', DEFAULTS[0], DEFAULTS[1]],
    ['a string', '"x"', DEFAULTS[0], DEFAULTS[1]],
    ['no known key', JSON.stringify({ other: 1 }), DEFAULTS[0], DEFAULTS[1]],
    ['repoUrl of the wrong type', JSON.stringify({ repoUrl: 42, branch: 'dev' }), DEFAULTS[0], 'dev'],
    ['branch of the wrong type', JSON.stringify({ repoUrl: OWN_URL, branch: ['x'] }), OWN_URL, DEFAULTS[1]],
    ['empty strings', JSON.stringify({ repoUrl: '', branch: '' }), DEFAULTS[0], DEFAULTS[1]],
  ];

  it.each(CASES)('%s', async (_name, content, repoUrl, branch) => {
    const w = makeWorld();
    await w.fs.rm(HUNT_CHECKOUT, { recursive: true, force: true }); // no checkout: git clone shows the settings
    if (content !== null) w.fs.seedFile(CONTROL, content);
    const huntId = huntIdOf(w.clock.nowMs());
    const r = await w.begin();
    expect(r.body.state).toBe('ready');
    const clone = w.calls.spawn.find((c) => c.args[0] === 'clone');
    expect(clone?.args).toEqual(['clone', '--depth', '1', '--branch', branch, '--', repoUrl, HUNT_CHECKOUT]);
    const record = readJson(w, `${HUNTS}\\${huntId}.json`);
    expect(record.repoUrl).toBe(repoUrl);
    expect(record.branch).toBe(branch);
    expect(w.fs.peek(CONTROL)).toBe(content ?? undefined); // never created, never changed
  });
});

describe('Hunt_Begin: Hunt_Checkout and git', () => {
  it('uses a path that ends with \\hunt\\grimsheet and differs from the replay checkout', () => {
    expect(HUNT_CHECKOUT.endsWith('\\hunt\\grimsheet')).toBe(true);
    expect(HUNT_CHECKOUT).not.toBe(REPLAY_CHECKOUT);
  });

  /** @type {Array<[string, (w: ReturnType<typeof makeWorld>) => Promise<void> | void, Parameters<typeof makeWorld>[0]]>} */
  const SCENARIOS = [
    ['existing checkout with the right origin', () => {}, {}],
    ['missing checkout', async (w) => void (await w.fs.rm(HUNT_CHECKOUT, { recursive: true, force: true })), {}],
    ['checkout with another origin', () => {}, { grim: { originUrl: 'https://example.invalid/other.git' } }],
  ];

  it.each(SCENARIOS)('%s: only allowed commands run, only in the Hunt_Checkout, the replay checkout is untouched', async (_name, setup, options) => {
    const w = makeWorld(options);
    await setup(w);
    w.fs.seedFile(`${REPLAY_CHECKOUT}\\marker.txt`, 'replay');
    const before = w.fs.snapshot();
    const r = await w.begin();
    expect(r.body.state).toBe('ready');

    for (const c of w.calls.spawn) {
      expect(['git', 'npm', 'node']).toContain(c.command);
      if (c.command === 'git') {
        const sub = c.args[0] === 'remote' ? `remote ${c.args[1]}` : c.args[0];
        expect(ALLOWED_GIT).toContain(sub);
      }
      if (c.command === 'npm') expect([['ci'], ['run', 'build:play']]).toContainEqual(c.args);
      const where = c.args[0] === 'clone' ? c.args.at(-1) : c.cwd;
      expect(where).toBe(HUNT_CHECKOUT);
      expect(c.cwd === REPLAY_CHECKOUT || c.cwd.startsWith(`${REPLAY_CHECKOUT}\\`)).toBe(false);
      if (c.args[0] === 'clone') expect(c.cwd).toBe(HUNT_LOCAL_FOLDER);
    }
    // Nothing under the replay checkout changed.
    const replayPrefix = REPLAY_CHECKOUT.replace(/\\/g, '/');
    const underReplay = (/** @type {Record<string,string>} */ s) =>
      Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith(`${replayPrefix}/`)));
    expect(underReplay(w.fs.snapshot())).toEqual(underReplay(before));
    expect(w.seen.noLock).toEqual([]);
  });
});

describe('Hunt_Begin: errors', () => {
  it('a record that cannot be written gives record_failed, exit 4, no process, lock released', async () => {
    const w = makeWorld();
    const real = w.fs;
    w.deps.fs = /** @type {any} */ ({
      ...real,
      /** @param {string} p @param {string} d @param {any} o */
      writeFile: async (p, d, o) => {
        if (String(p).replace(/\\/g, '/').includes('/data/hunts/')) throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' });
        return real.writeFile(p, d, o);
      },
    });
    const r = await w.begin();
    expect(r).toEqual({ exit: 4, body: { state: 'record_failed', reasonCode: 'hunt_record_unwritable' } });
    expect(w.calls.spawn).toHaveLength(0);
    expect(w.fs.has(LOCK)).toBe(false);
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(recordsOf(w)).toEqual({});
  });

  it('an unexpected throw marks the record failed (record, internal_error), releases the lock, exit 4', async () => {
    const w = makeWorld();
    const huntId = huntIdOf(w.clock.nowMs());
    w.deps.spawn = /** @type {any} */ (
      async () => {
        throw new Error('boom');
      }
    );
    const r = await w.begin();
    expect(r.exit).toBe(4);
    const record = readJson(w, `${HUNTS}\\${huntId}.json`);
    expect(record.state).toBe('failed');
    expect(record.failure).toMatchObject({ stage: 'record', reasonCode: 'internal_error' });
    expect(typeof record.finishedAt).toBe('string');
    expect(w.fs.has(LOCK)).toBe(false);
    expect(w.fs.has(ACTIVE)).toBe(false);
  });
});

describe('Hunt_Begin: overlapping Hunts', () => {
  // Feature: exploit-hunt, Property 8: Overlapping Hunts
  // **Validates: Requirements 6.8, 6.1, 6.2**
  it('Property 8: of two scripted Hunt_Begin runs at most one reaches the checkout stage, and a run that ends with already_running changes nothing', async () => {
    const MUTATING = ['writeFile', 'rename', 'rm', 'mkdir', 'chmod'];
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(/** @type {0} */ (0), /** @type {1} */ (1)), { minLength: 1, maxLength: 300 }), async (choices) => {
        const w = makeWorld();
        const sched = makeScheduler(choices);
        /** @type {Array<Array<{op: string, path: string, ok: boolean}>>} successful or failed mutating operations per run */
        const mutations = [[], []];
        /** @type {string[][]} process lines per run */
        const spawned = [[], []];

        /** @param {0|1} id */
        const depsFor = (id) => {
          const gated = /** @type {Record<string, any>} */ (w.fs.withGate(sched.gate(id)));
          /** @type {Record<string, any>} */
          const fs = { ...gated };
          for (const op of MUTATING) {
            /** @param {...any} args */
            fs[op] = async (...args) => {
              try {
                const out = await gated[op](...args);
                mutations[id].push({ op, path: String(args[0]), ok: true });
                return out;
              } catch (e) {
                mutations[id].push({ op, path: String(args[0]), ok: false });
                throw e;
              }
            };
          }
          const inner = w.deps.spawn;
          return {
            ...w.deps,
            fs: /** @type {any} */ (fs),
            token: makeTokenSource(id * 1000),
            pid: 100 + id,
            spawn: /** @type {any} */ (
              Object.assign(
                /** @param {any} spec */
                async (spec) => {
                  spawned[id].push([spec.command, ...spec.args].join(' '));
                  return inner(spec);
                },
                { calls: /** @type {any} */ (inner).calls },
              )
            ),
          };
        };
        /** @param {0|1} id */
        const run = (id) => runBegin(depsFor(id), []).finally(() => sched.done(id));
        const results = await Promise.all([run(0), run(1)]);

        // Someone wins.
        expect(results.filter((r) => r.body.state !== 'already_running').length).toBeGreaterThanOrEqual(1);

        // At most one run reaches the checkout stage: git clone or fetch, and any other process.
        const checkoutRuns = [0, 1].filter((id) => spawned[id].some((l) => /^git (clone|fetch)\b/.test(l)));
        expect(checkoutRuns.length).toBeLessThanOrEqual(1);
        expect([0, 1].filter((id) => spawned[id].length > 0).length).toBeLessThanOrEqual(1);
        const gitCalls = w.calls.spawn.filter((c) => c.command === 'git' && (c.args[0] === 'clone' || c.args[0] === 'fetch'));
        expect(gitCalls.length).toBeLessThanOrEqual(1);

        // A run that ended with already_running made no successful write, rename, rm, mkdir or chmod
        // (its only mutating attempt is the refused exclusive create of the lock file) and started no process.
        for (const id of /** @type {const} */ ([0, 1])) {
          if (results[id].body.state !== 'already_running') continue;
          expect(results[id].exit).toBe(3);
          expect(mutations[id].filter((m) => m.ok)).toEqual([]);
          expect(mutations[id].every((m) => m.op === 'writeFile' && m.path === LOCK)).toBe(true);
          expect(spawned[id]).toEqual([]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
