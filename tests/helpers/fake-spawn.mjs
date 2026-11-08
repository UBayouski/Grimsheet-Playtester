// @ts-check
// A fake process starter (`StartProcess`) for the replay-runner tests, and a ready-made fake Grimsheet
// toolchain (git, npm, the play command) built from tests/fixtures. Fixtures are read through node:fs only.
import { readFileSync } from 'node:fs';

/** @typedef {import('../../scripts/replay/types.mjs').ProcSpec} ProcSpec */
/** @typedef {import('../../scripts/replay/types.mjs').ProcResult} ProcResult */
/** @typedef {import('../../scripts/replay/types.mjs').StartProcess} StartProcess */
/** @typedef {{command: string, args?: string[], result: ProcResult | ((spec: ProcSpec) => ProcResult)}} FakeRule */
/** @typedef {{command: string, args: string[], cwd: string, shell: boolean, timeoutMs: number, label: string}} FakeCall */

/** A process that exited 0 with this stdout. @param {string} [stdout] @param {string} [stderr] @returns {ProcResult} */
export function procOk(stdout = '', stderr = '') {
  return { exitCode: 0, stdout, stderr, timedOut: false, startError: null };
}

/** A process that exited with a non-zero code. @param {number} exitCode @param {string} [stderr] @param {string} [stdout] @returns {ProcResult} */
export function procFail(exitCode, stderr = '', stdout = '') {
  return { exitCode, stdout, stderr, timedOut: false, startError: null };
}

/** A process that hung and was killed at its limit. @returns {ProcResult} */
export function procHang() {
  return { exitCode: null, stdout: '', stderr: '', timedOut: true, startError: null };
}

/** A command that could not be started. @param {string} [message] @returns {ProcResult} */
export function procCannotStart(message = 'spawn ENOENT') {
  return { exitCode: null, stdout: '', stderr: '', timedOut: false, startError: message };
}

/**
 * @param {string[]} args
 * @param {string[]} prefix
 * @returns {boolean} true when `args` starts with `prefix`
 */
function startsWith(args, prefix) {
  return prefix.every((p, i) => args[i] === p);
}

/**
 * A `StartProcess` that answers from a table. A rule matches on `command` and the leading `args`; the
 * rule with the most leading args wins (first one on a tie). A rule's `result` is a `ProcResult` or a
 * function of the spec. Every call is recorded in `calls`. With no matching rule the answer is
 * `options.fallback`, or exit code 127 with a message on stderr.
 * @param {FakeRule[]} table
 * @param {{fallback?: ProcResult}} [options]
 * @returns {StartProcess & {calls: FakeCall[]}}
 */
export function makeFakeSpawn(table, options = {}) {
  /** @type {FakeCall[]} */
  const calls = [];
  /** @type {StartProcess} */
  const fn = async (spec) => {
    calls.push({ command: spec.command, args: [...spec.args], cwd: spec.cwd, shell: spec.shell, timeoutMs: spec.timeoutMs, label: spec.label });
    let best = null;
    for (const rule of table) {
      const prefix = rule.args ?? [];
      if (rule.command !== spec.command || !startsWith(spec.args, prefix)) continue;
      if (best === null || prefix.length > (best.args ?? []).length) best = rule;
    }
    if (best === null) {
      return options.fallback ?? { exitCode: 127, stdout: '', stderr: `no fake rule for ${spec.command} ${spec.args.join(' ')}`, timedOut: false, startError: null };
    }
    const result = typeof best.result === 'function' ? best.result(spec) : best.result;
    return { ...result };
  };
  return Object.assign(fn, { calls });
}

/**
 * @param {string} relative path under tests/fixtures/
 * @returns {string}
 */
function readFixture(relative) {
  return readFileSync(new URL(`../fixtures/${relative}`, import.meta.url), 'utf8');
}

/** The commit hash recorded when the fixtures were captured (first line of GRIMSHEET_COMMIT.txt). @returns {string} */
export function fixtureCommit() {
  return /** @type {string} */ (readFixture('GRIMSHEET_COMMIT.txt').split(/\r?\n/)[0]);
}

/**
 * Canned play results for the three stored solutions, from manifest.json and the *.play.json captures.
 * @returns {Record<string, ProcResult>} level id to result
 */
export function fixturePlays() {
  /** @type {Array<{file: string, levelId: string, exitCode: number}>} */
  const manifest = JSON.parse(readFixture('manifest.json'));
  /** @type {Record<string, ProcResult>} */
  const plays = {};
  for (const m of manifest) {
    if (m.file !== `${m.levelId}.play.json`) continue;
    plays[m.levelId] = { exitCode: m.exitCode, stdout: readFixture(m.file), stderr: '', timedOut: false, startError: null };
  }
  return plays;
}

/**
 * A fake git, npm and Grimsheet play command.
 * - git: `clone`, `fetch`, `reset`, `rev-parse HEAD` (the fixture commit plus a newline) and
 *   `remote get-url` (the origin URL plus a newline). Each can be replaced through `git`.
 * - npm: `ci` and `run build:play`, both exit 0 unless replaced through `npm`.
 * - node: `<script> --list` answers tests/fixtures/list.json; `<script> <level-id> ...` answers the canned
 *   play for that level (`plays`, default the three fixture captures), or exit code 2 for an unknown level.
 * `rules` are put first, so a test can override any of the above.
 * @param {{
 *   commit?: string,
 *   originUrl?: string,
 *   git?: Partial<Record<'clone'|'fetch'|'reset'|'rev-parse'|'remote get-url', ProcResult>>,
 *   npm?: Partial<Record<'ci'|'build', ProcResult>>,
 *   list?: ProcResult,
 *   plays?: Record<string, ProcResult>,
 *   rules?: FakeRule[]
 * }} [options]
 * @returns {{spawn: StartProcess & {calls: FakeCall[]}, commit: string, plays: Record<string, ProcResult>}}
 */
export function makeFakeGrimsheet(options = {}) {
  const commit = options.commit ?? fixtureCommit();
  const originUrl = options.originUrl ?? 'https://github.com/UBayouski/Grimsheet';
  const plays = options.plays ?? fixturePlays();
  const git = options.git ?? {};
  const npm = options.npm ?? {};
  const list = options.list ?? procOk(readFixture('list.json'));
  /** @type {FakeRule[]} */
  const table = [
    ...(options.rules ?? []),
    { command: 'git', args: ['clone'], result: git.clone ?? procOk('', 'Cloning into ...') },
    { command: 'git', args: ['fetch'], result: git.fetch ?? procOk('', 'From https://github.com/...') },
    { command: 'git', args: ['reset'], result: git.reset ?? procOk('HEAD is now at ...') },
    { command: 'git', args: ['rev-parse', 'HEAD'], result: git['rev-parse'] ?? procOk(`${commit}\n`) },
    { command: 'git', args: ['remote', 'get-url'], result: git['remote get-url'] ?? procOk(`${originUrl}\n`) },
    { command: 'npm', args: ['ci'], result: npm.ci ?? procOk('added 142 packages') },
    { command: 'npm', args: ['run', 'build:play'], result: npm.build ?? procOk('built') },
    {
      command: 'node',
      result: (spec) => {
        if (spec.args[1] === '--list') return list;
        const levelId = spec.args[1];
        const canned = levelId === undefined ? undefined : plays[levelId];
        return canned ?? procFail(2, `unknown level ${levelId}`);
      },
    },
  ];
  return { spawn: makeFakeSpawn(table), commit, plays };
}

/**
 * Places copies of tests/fixtures/solutions/<id>.json into `<checkoutDir>/tests/solutions/` on the real
 * file system (the caller gives a temp folder and removes it). `override` replaces the content of an id.
 * @param {string} checkoutDir
 * @param {{ids?: string[], override?: Record<string, unknown>}} [options]
 * @returns {Promise<string[]>} the ids that were placed
 */
export async function placeFixtureSolutions(checkoutDir, options = {}) {
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const ids = options.ids ?? ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt'];
  const folder = path.join(checkoutDir, 'tests', 'solutions');
  await fsp.mkdir(folder, { recursive: true });
  for (const id of ids) {
    const content = options.override && id in options.override ? JSON.stringify(options.override[id], null, 2) : readFixture(`solutions/${id}.json`);
    await fsp.writeFile(path.join(folder, `${id}.json`), content, 'utf8');
  }
  return ids;
}
