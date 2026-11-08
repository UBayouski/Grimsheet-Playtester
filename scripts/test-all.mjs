// @ts-check
// Entry: npm run test:all
// Runs the whole gate, one step at a time, and stops at the first failure with that step's exit code:
// the root tests, the root typecheck, the launcher tests, the ui tests, the ui typecheck, and a check that the committed
// ui/dist/index.mjs equals a fresh build of ui/ (built into a temporary folder, never into ui/dist).
// Plain ESM with no dependency. `npm` is started as a fixed command string with a shell (it is a .cmd file on Windows);
// every other step is started with an argument array and no shell. No argument comes from the user.

import { spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @typedef {Object} Step
 * @property {string} label
 * @property {string} folder          relative to the repository root
 * @property {'process'|'bundle'} [kind]
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {boolean} [shell]
 */

/** @type {readonly Step[]} */
export const STEPS = Object.freeze([
  { label: 'root tests', folder: '.', command: 'npm test', shell: true },
  { label: 'root typecheck', folder: '.', command: 'npm run typecheck', shell: true },
  { label: 'launcher tests', folder: '.', command: 'python', args: ['-m', 'unittest', 'tests.test_replay_cron'], shell: false },
  { label: 'ui tests', folder: 'ui', command: 'npm test', shell: true },
  { label: 'ui typecheck', folder: 'ui', command: 'npm run typecheck', shell: true },
  { label: 'bundle is fresh', folder: 'ui', kind: 'bundle' },
]);

export const STALE_MESSAGE = 'ui/dist/index.mjs is stale or missing: run "npm run build" in ui/ and commit the result.';

/**
 * Byte-for-byte comparison of a fresh build with the committed bundle.
 * @param {Uint8Array|null} fresh
 * @param {Uint8Array|null} committed  null when the file is missing
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function compareBundle(fresh, committed) {
  if (fresh === null || committed === null) return { ok: false, message: STALE_MESSAGE };
  return Buffer.from(fresh).equals(Buffer.from(committed)) ? { ok: true } : { ok: false, message: STALE_MESSAGE };
}

/**
 * Run the steps in order, one at a time. A step that cannot start counts as exit code 1.
 * @param {{run: (step: Step) => Promise<number>}} runner  rejects when the step cannot be started
 * @param {readonly Step[]} steps
 * @param {(line: string) => void} log
 * @returns {Promise<number>} 0, or the exit code of the first failing step
 */
export async function runSteps(runner, steps, log) {
  for (let i = 0; i < steps.length; i += 1) {
    const step = /** @type {Step} */ (steps[i]);
    log(`[test:all] step ${i + 1} of ${steps.length}: ${step.label}`);
    /** @type {number} */
    let code;
    try {
      code = await runner.run(step);
    } catch {
      log(`[test:all] could not start: ${step.label}`);
      return 1;
    }
    if (code !== 0) {
      log(`[test:all] step ${i + 1} of ${steps.length} failed: ${step.label} (exit code ${code})`);
      return code;
    }
  }
  log(`[test:all] all ${steps.length} steps passed`);
  return 0;
}

/**
 * Start one process with inherited output. Resolves with the exit code (1 when it ended by a signal); rejects when it cannot start.
 * @param {typeof spawn | ((command: string, args: any, options: any) => any)} spawnFn
 * @param {{command?: string, args?: string[], shell?: boolean, folder: string}} step
 * @param {string} root
 * @returns {Promise<number>}
 */
export function startProcess(spawnFn, step, root) {
  return new Promise((resolve, reject) => {
    const cwd = path.join(root, step.folder);
    try {
      const child = /** @type {any} */ (spawnFn)(step.command, step.shell ? [] : (step.args ?? []), { shell: step.shell === true, cwd, stdio: 'inherit', windowsHide: true });
      child.on('error', (/** @type {Error} */ e) => reject(e));
      child.on('close', (/** @type {number|null} */ code) => resolve(code === null ? 1 : code));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * The bundle step: build ui/ into a temporary folder, compare it with ui/dist/index.mjs, remove the temporary folder.
 * @param {{
 *   root: string,
 *   log: (line: string) => void,
 *   mkdtemp: () => Promise<string>,
 *   rm: (path: string) => Promise<void>,
 *   readFile: (path: string) => Promise<Uint8Array>,
 *   runNode: (args: string[], cwd: string) => Promise<number>,
 * }} io
 * @returns {Promise<number>}
 */
export async function runBundleStep(io) {
  const temp = await io.mkdtemp();
  try {
    const uiFolder = path.join(io.root, 'ui');
    const vite = path.join(uiFolder, 'node_modules', 'vite', 'bin', 'vite.js');
    const code = await io.runNode([vite, 'build', '--outDir', temp, '--emptyOutDir'], uiFolder);
    if (code !== 0) return code;
    /** @param {string} p @returns {Promise<Uint8Array|null>} */
    const read = (p) => io.readFile(p).then((b) => b, () => null);
    const fresh = await read(path.join(temp, 'index.mjs'));
    const committed = await read(path.join(uiFolder, 'dist', 'index.mjs'));
    const compared = compareBundle(fresh, committed);
    if (!compared.ok) {
      io.log(compared.message);
      return 1;
    }
    return 0;
  } finally {
    await io.rm(temp);
  }
}

/**
 * @param {string} root
 * @param {(line: string) => void} log
 * @returns {{run: (step: Step) => Promise<number>}}
 */
function makeRealRunner(root, log) {
  return {
    run: (step) => {
      if (step.kind !== 'bundle') return startProcess(spawn, step, root);
      return runBundleStep({
        root,
        log,
        mkdtemp: () => fsp.mkdtemp(path.join(os.tmpdir(), 'pkg-bundle-')),
        rm: (p) => fsp.rm(p, { recursive: true, force: true }),
        readFile: (p) => fsp.readFile(p),
        runNode: (args, cwd) => startProcess(spawn, { command: process.execPath, args, shell: false, folder: path.relative(root, cwd) || '.' }, root),
      });
    },
  };
}

/**
 * @param {{
 *   runner?: {run: (step: Step) => Promise<number>},
 *   log?: (line: string) => void,
 *   setExitCode?: (code: number) => void,
 * }} [io]
 * @returns {Promise<void>}
 */
export async function main(io = {}) {
  const log = io.log ?? ((line) => void process.stdout.write(`${line}\n`));
  const setExitCode =
    io.setExitCode ??
    ((code) => {
      process.exitCode = code;
    });
  const runner = io.runner ?? makeRealRunner(ROOT, log);
  setExitCode(await runSteps(runner, STEPS, log));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
