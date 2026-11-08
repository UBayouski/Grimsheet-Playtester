// @ts-check
// Command-line shell of the exploit hunt: build deps, run one orchestrator, print one JSON line, set the exit code.
// See .kiro/specs/exploit-hunt/design.md, "cli.mjs" and Decision 22.
import { runBegin } from './begin.mjs';
import { runEnd } from './end.mjs';
import { runInfo } from './info.mjs';
import { runSubmit } from './submit.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('./types.mjs').HuntResult} HuntResult */

/** @type {Record<string, (deps: any, argv: string[]) => Promise<HuntResult>>} */
const REAL_RUN = { begin: runBegin, info: runInfo, submit: runSubmit, end: runEnd };

/**
 * Pure. Adds exitStatus as the LAST key (an existing exitStatus key is moved to the end).
 * @param {Record<string, unknown>} body
 * @param {0|3|4} exit
 * @returns {Record<string, unknown>}
 */
export function withExitStatus(body, exit) {
  const { exitStatus: _ignored, ...rest } = body;
  return { ...rest, exitStatus: exit };
}

/**
 * A safe one-word label for a fault: its string `code`, else its string `name`, else `unknown`.
 * Never the message or stack. Only [A-Za-z0-9_.-] survive, at most 40 characters.
 * @param {unknown} fault
 * @returns {string}
 */
function faultToken(fault) {
  /** @param {string} key */
  const pick = (key) => {
    try {
      const value = /** @type {any} */ (fault)[key];
      if (typeof value !== 'string') return '';
      return value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
    } catch {
      return '';
    }
  };
  return pick('code') || pick('name') || 'unknown';
}

/**
 * @param {'begin'|'info'|'submit'|'end'} name
 * @param {string[]} [argv]   default process.argv.slice(2)
 * @param {{buildDeps?: () => HuntDeps, run?: Record<string, (deps: HuntDeps, argv: string[]) => Promise<HuntResult>>,
 *          write?: (text: string) => void, writeErr?: (text: string) => void,
 *          setExitCode?: (code: number) => void}} [io]
 * @returns {Promise<HuntResult>}
 */
export async function main(name, argv, io = {}) {
  const args = argv ?? process.argv.slice(2);
  const run = io.run ?? REAL_RUN;
  const write = io.write ?? ((/** @type {string} */ text) => void process.stdout.write(text));
  const writeErr = io.writeErr ?? ((/** @type {string} */ text) => void process.stderr.write(text));
  const setExitCode =
    io.setExitCode ??
    ((/** @type {number} */ code) => {
      process.exitCode = code;
    });

  /** @type {HuntResult} */
  let result;
  try {
    let deps;
    if (io.buildDeps) {
      deps = io.buildDeps();
    } else {
      // Lazy: deps.mjs is the only file with real dependencies and is loaded only in production.
      const { buildHuntDeps } = await import('./deps.mjs');
      deps = buildHuntDeps({});
    }
    result = await run[name](deps, args);
  } catch (fault) {
    result = { exit: 4, body: { outcome: 'error', reasonCode: 'hunt_internal_error' } };
    try {
      writeErr(`hunt: internal error ${faultToken(fault)}\n`);
    } catch {
      // A broken stderr must not change stdout or the exit code.
    }
  }

  // One variable feeds both the printed exitStatus and the process exit code.
  const exit = result.exit;
  write(JSON.stringify(withExitStatus(result.body, exit)) + '\n');
  setExitCode(exit);
  return result;
}
