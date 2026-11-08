// @ts-check
// Entry: node scripts/replay.mjs --repo-url <url> --branch <name> --cron-timeout <seconds>
// This is the only file that builds real dependencies and the only one that imports the verifier.

import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeStartProcess } from './replay/process.mjs';
import { runReplay } from './replay/run.mjs';
import { replayVerdict } from './verifier.mjs';

/** @typedef {import('./replay/types.mjs').Deps} Deps */

const APP_NAME = 'grimsheet-playtester';
const FLAGS = ['--repo-url', '--branch', '--cron-timeout'];

/**
 * @param {string[]} argv
 * @returns {{repoUrl: string, branch: string, cronTimeoutSec: number} | null} null on a bad flag set
 */
export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== FLAGS.length * 2 || !argv.every((a) => typeof a === 'string')) return null;
  /** @type {Record<string, string>} */
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!FLAGS.includes(flag) || flag in values) return null;
    if (value === '' || value.startsWith('--')) return null;
    values[flag] = value;
  }
  if (!/^[0-9]+$/.test(values['--cron-timeout'])) return null;
  const cronTimeoutSec = Number(values['--cron-timeout']);
  if (!Number.isSafeInteger(cronTimeoutSec) || cronTimeoutSec <= 0) return null;
  return { repoUrl: values['--repo-url'], branch: values['--branch'], cronTimeoutSec };
}

/**
 * Real dependencies: the process, node:fs/promises, crypto and the verifier.
 * @returns {Deps}
 */
export function buildRealDeps() {
  const appFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return {
    clock: { nowMs: () => Date.now() },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fs: /** @type {any} */ (fsp),
    paths: { appFolder, dataFolder: path.join(appFolder, 'data'), localAppData: process.env.LOCALAPPDATA ?? '' },
    spawn: makeStartProcess({}),
    verifier: /** @type {any} */ (replayVerdict),
    token: () => randomBytes(16).toString('hex'),
    pid: process.pid,
    appName: APP_NAME,
    platform: process.platform === 'win32' ? 'win32' : 'other',
  };
}

/**
 * Calls runReplay, prints the one JSON line to stdout and sets the exit code.
 * @param {string[]} [argv]
 * @param {{
 *   runReplay?: typeof runReplay,
 *   buildRealDeps?: () => Deps,
 *   write?: (text: string) => void,
 *   setExitCode?: (code: number) => void,
 * }} [io]
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const run = io.runReplay ?? runReplay;
  const build = io.buildRealDeps ?? buildRealDeps;
  const write = io.write ?? ((text) => void process.stdout.write(text));
  const setExitCode =
    io.setExitCode ??
    ((code) => {
      process.exitCode = code;
    });

  const args = parseArgs(argv);
  if (args === null) {
    write('{"state":"record_failed"}\n');
    setExitCode(4);
    return;
  }
  try {
    const result = await run(build(), args);
    write(`${JSON.stringify(result.line)}\n`);
    setExitCode(result.exitCode);
  } catch {
    write('{"state":"record_failed"}\n');
    setExitCode(4);
  }
}

// Run only when this file is the entry point, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
