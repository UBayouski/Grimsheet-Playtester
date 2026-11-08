// @ts-check
// Entry (run by the user in a terminal): node scripts/packaging/measure-config-route.mjs [--dry-run]
// Measures how large a config value the Config_Route returns in full. It prompts for the address that `kirocrew token`
// printed (masked), writes and removes one probe key in the installed app's data\config.json, and prints a JSON report.
// It writes no other file. This is the only file here that builds real dependencies.

import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROBE_KEY } from './config-probe.mjs';
import { redactHome, renderReport, runMeasurement } from './measure.mjs';
import { readRoute, scrub } from './route-reader.mjs';
import { parseAccessInput, promptSecret, promptVisible } from './secret-prompt.mjs';

/** @typedef {import('../results-store.mjs').ResultsDeps} ResultsDeps */

const USAGE = 'usage: node scripts/packaging/measure-config-route.mjs [--dry-run]\n';

/**
 * The data folder of the installed app.
 * @param {string} homeDir
 * @returns {string}
 */
export function appDataFolder(homeDir) {
  return path.join(homeDir, '.kiro', 'crew', 'apps', 'grimsheet-playtester', 'data');
}

/**
 * @param {string} dataFolder
 * @returns {ResultsDeps}
 */
function buildRealDeps(dataFolder) {
  return {
    clock: { nowMs: () => Date.now() },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fs: /** @type {any} */ (fsp),
    paths: { appFolder: path.dirname(dataFolder), dataFolder, localAppData: process.env.LOCALAPPDATA ?? '' },
    token: () => randomBytes(16).toString('hex'),
    pid: process.pid,
  };
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   homeDir?: string,
 *   buildDeps?: (dataFolder: string) => ResultsDeps,
 *   promptSecret?: (question: string) => Promise<string>,
 *   promptVisible?: (question: string) => Promise<string>,
 *   fetch?: (url: string, init: any) => Promise<any>,
 *   runMeasurement?: (ctx: any) => Promise<any>,
 *   write?: (text: string) => void,
 *   setExitCode?: (code: number) => void,
 *   onInterrupt?: (handler: () => void) => void,
 * }} [io]
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const write = io.write ?? ((text) => void process.stdout.write(text));
  const setExitCode =
    io.setExitCode ??
    ((code) => {
      process.exitCode = code;
    });
  const homeDir = io.homeDir ?? os.homedir();
  const secret = io.promptSecret ?? ((question) => promptSecret({ input: process.stdin, output: process.stdout, question }));
  const visible = io.promptVisible ?? ((question) => promptVisible({ input: process.stdin, output: process.stdout, question }));
  const run = /** @type {(ctx: any) => Promise<any>} */ (io.runMeasurement ?? runMeasurement);
  const onInterrupt = io.onInterrupt ?? ((handler) => void process.on('SIGINT', handler));

  if (argv.some((a) => a !== '--dry-run') || argv.length > 1) {
    write(USAGE);
    setExitCode(2);
    return;
  }
  const dryRun = argv.length === 1;

  /** @type {string} */
  let token = '';
  let prompting = true;
  try {
    const answer = await secret('Paste the address that `kirocrew token` printed (nothing is shown as you type): ');
    const parsed = parseAccessInput(answer);
    if (!parsed.ok) {
      write(`That answer cannot be used: ${parsed.reason}.\n`);
      setExitCode(2);
      return;
    }
    token = parsed.token;
    const origin = parsed.origin ?? (await visible('Gateway origin (for example http://127.0.0.1:5476): ')).trim();

    prompting = false;
    const controller = new AbortController();
    onInterrupt(() => controller.abort());
    const fetchFn = io.fetch ?? /** @type {any} */ (globalThis.fetch);
    const report = await run({
      deps: (io.buildDeps ?? buildRealDeps)(appDataFolder(homeDir)),
      read: (/** @type {string} */ route) => readRoute({ fetch: fetchFn, origin, token, path: route }),
      dryRun,
      homeDir,
      signal: controller.signal,
    });
    const warning = report.removal?.done === false ? `WARNING: the probe key ${PROBE_KEY} could not be removed from config.json in the app data folder; remove that key by hand.\n` : '';
    write(`${warning}${renderReport(report)}`);
    setExitCode(report.status === 'ok' || report.status === 'dry-run' ? 0 : 1);
  } catch (e) {
    const message = typeof (/** @type {any} */ (e)?.message) === 'string' ? /** @type {any} */ (e).message : 'unknown error';
    write(`The measurement stopped: ${redactHome(scrub(message, token), homeDir)}\n`);
    setExitCode(prompting ? 2 : 1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
