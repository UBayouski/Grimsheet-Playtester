// @ts-check
// The world builder of the exploit-hunt tests (design, Testing Strategy). Builds a HuntDeps over the in-memory
// file system and the fake Grimsheet toolchain, plus helpers that run the four orchestrators.
// Reuses tests/helpers/fake-fs.mjs and fake-spawn.mjs without editing them.
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { makeFakeClock, makeMemFs, makeSleep, makeTokenSource } from './fake-fs.mjs';
import { fixtureCommit, fixturePlays, makeFakeGrimsheet, procOk } from './fake-spawn.mjs';
import { checkoutPath } from '../../scripts/replay/checkout.mjs';

/** @typedef {import('../../scripts/replay/types.mjs').ProcResult} ProcResult */
/** @typedef {import('../../scripts/replay/types.mjs').ProcSpec} ProcSpec */
/** @typedef {import('../../scripts/hunt/types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('../../scripts/hunt/types.mjs').HuntResult} HuntResult */
/** @typedef {(levelId: string, file: string, spec: ProcSpec) => ProcResult} PlayFn */
/** @typedef {{levelId: string, file: string, content: string|undefined}} PlayCall */
/** @typedef {{levelId: string}} InfoCall */

export const APP_NAME = 'grimsheet-playtester';
export const APP_FOLDER = 'C:\\Apps\\grimsheet-playtester';
export const DATA_FOLDER = 'C:\\Apps\\grimsheet-playtester\\data';
export const LOCAL_APP_DATA = 'C:\\Users\\dev\\AppData\\Local';
/** The Hunt_Local_Folder: %LOCALAPPDATA%\grimsheet-playtester\hunt */
export const HUNT_LOCAL_FOLDER = path.join(LOCAL_APP_DATA, APP_NAME, 'hunt');
/** The Hunt_Checkout: %LOCALAPPDATA%\grimsheet-playtester\hunt\grimsheet */
export const HUNT_CHECKOUT = /** @type {string} */ (checkoutPath(LOCAL_APP_DATA, APP_NAME, 'hunt\\grimsheet'));
export const CONFIG_PATH = `${DATA_FOLDER}\\config.json`;
/** The stored solutions that tests/fixtures/solutions/ holds. */
export const FIXTURE_SOLUTION_IDS = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt'];

/** @param {string} relative path under tests/fixtures/ @returns {string} */
function readFixture(relative) {
  return readFileSync(new URL(`../fixtures/${relative}`, import.meta.url), 'utf8');
}

/**
 * Copies tests/fixtures/solutions/<id>.json into `<checkoutDir>\tests\solutions\` of the in-memory file system.
 * (`placeFixtureSolutions` of fake-spawn.mjs writes to the real disk, so this is its in-memory equivalent.)
 * @param {{seedFile(path: string, content: string): void}} fs
 * @param {string} checkoutDir
 * @param {string[]} [ids]
 * @returns {string[]} the ids that were placed
 */
export function placeFixtureSolutionsMem(fs, checkoutDir, ids = FIXTURE_SOLUTION_IDS) {
  for (const id of ids) fs.seedFile(`${checkoutDir}\\tests\\solutions\\${id}.json`, readFixture(`solutions/${id}.json`));
  return ids;
}

/** The stub `--level-info` output until the real capture of Decision 8 is used. @returns {ProcResult} */
export function defaultLevelInfo() {
  return procOk(JSON.stringify({ title: 'stub level', hint: 'stub', startingHp: 3, ink: 2 }) + '\n');
}

/**
 * @param {unknown} check
 * @returns {HuntDeps['checkCandidate']}
 */
function toCheck(check) {
  if (typeof check === 'function') return /** @type {any} */ (check);
  const table = /** @type {Record<string, any>|undefined} */ (check);
  return /** @type {any} */ (
    (/** @type {any[]} */ ...a) => {
      const entry = table?.[String(a[0])];
      if (typeof entry === 'function') return entry(...a);
      return entry ?? { outcome: 'error', reasonCode: 'unknown_class', reason: 'no check entry in the test world' };
    }
  );
}

/**
 * @param {{
 *   fs?: ReturnType<typeof makeMemFs>,
 *   clock?: ReturnType<typeof makeFakeClock>,
 *   plays?: PlayFn | Record<string, ProcResult>,
 *   check?: HuntDeps['checkCandidate'] | Record<string, any>,
 *   levelInfo?: ProcResult | ((levelId: string) => ProcResult),
 *   grim?: Parameters<typeof makeFakeGrimsheet>[0],
 *   solutions?: string[],
 * }} [options]  `check`: a function, or a table level id to result (or function). `plays`: a function, or a map
 *   level id to result (default: the three fixture captures). `solutions`: ids to place (default the fixture three).
 */
export function makeHuntWorld(options = {}) {
  const clock = options.clock ?? makeFakeClock();
  const fs = options.fs ?? makeMemFs({ clock });
  fs.seedDir(DATA_FOLDER);
  fs.seedDir(HUNT_CHECKOUT);
  placeFixtureSolutionsMem(fs, HUNT_CHECKOUT, options.solutions);

  const playsOpt = options.plays ?? fixturePlays();
  /** @type {PlayCall[]} */
  const playCalls = [];
  /** @type {InfoCall[]} */
  const infoCalls = [];

  const listed = /** @type {{levels: string[]}} */ (JSON.parse(readFixture('list.json'))).levels;
  const mapIds = typeof playsOpt === 'function' ? [] : Object.keys(playsOpt);
  const ids = [...new Set([...listed, ...mapIds, ...FIXTURE_SOLUTION_IDS])];

  /** @type {import('./fake-spawn.mjs').FakeRule[]} */
  const rules = [];
  for (const id of ids) {
    rules.push({
      command: 'node',
      args: ['scripts/play.mjs', id, '--actions-file'],
      result: (spec) => {
        const file = spec.args[3] ?? '';
        playCalls.push({ levelId: id, file, content: fs.peek(file) });
        if (typeof playsOpt === 'function') return playsOpt(id, file, spec);
        return playsOpt[id] ?? { exitCode: 2, stdout: '', stderr: `no canned play for ${id}`, timedOut: false, startError: null };
      },
    });
    rules.push({
      command: 'node',
      args: ['scripts/play.mjs', id, '--level-info'],
      result: () => {
        infoCalls.push({ levelId: id });
        const info = options.levelInfo ?? defaultLevelInfo();
        return typeof info === 'function' ? info(id) : info;
      },
    });
  }
  const fake = makeFakeGrimsheet({ ...options.grim, rules: [...rules, ...(options.grim?.rules ?? [])] });

  /** @type {HuntDeps} */
  const deps = {
    clock,
    sleep: makeSleep(clock),
    fs: /** @type {import('../../scripts/replay/types.mjs').Fs} */ (fs),
    paths: { appFolder: APP_FOLDER, dataFolder: DATA_FOLDER, localAppData: LOCAL_APP_DATA },
    spawn: fake.spawn,
    checkCandidate: toCheck(options.check),
    token: makeTokenSource(),
    pid: 4242,
    appName: APP_NAME,
    platform: 'win32',
  };

  /**
   * @param {string} name
   * @param {string} fn
   * @param {string[]} argv
   * @returns {Promise<HuntResult>}
   */
  async function run(name, fn, argv) {
    const specifier = `../../scripts/hunt/${name}.mjs`; // a variable, so this file loads before the module exists
    const mod = await import(specifier);
    return mod[fn](deps, argv);
  }

  return {
    deps,
    fs,
    clock,
    spawn: fake.spawn,
    commit: fixtureCommit(),
    paths: {
      appFolder: APP_FOLDER,
      dataFolder: DATA_FOLDER,
      localAppData: LOCAL_APP_DATA,
      huntLocalFolder: HUNT_LOCAL_FOLDER,
      checkoutDir: HUNT_CHECKOUT,
      configPath: CONFIG_PATH,
    },
    /** @param {string[]} [argv] */
    begin: (argv = []) => run('begin', 'runBegin', argv),
    /** @param {string[]} [argv] */
    info: (argv = []) => run('info', 'runInfo', argv),
    /** @param {string[]} [argv] */
    submit: (argv = []) => run('submit', 'runSubmit', argv),
    /** @param {string[]} [argv] */
    end: (argv = []) => run('end', 'runEnd', argv),
    /** Writes data\config.json into the fake file system. @param {unknown} obj */
    seedConfig(obj) {
      fs.seedFile(CONFIG_PATH, JSON.stringify(obj, null, 2) + '\n');
    },
    /** What the fake play command was asked: `play` (level and Candidate_File path, with its content at that time),
     *  `info` (--level-info calls) and `spawn` (every process call). */
    calls: { play: playCalls, info: infoCalls, spawn: fake.spawn.calls },
  };
}
