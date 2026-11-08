// @ts-check
// The only file under scripts/hunt/ with real dependencies. Building the deps starts no process
// and writes nothing.

import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStartProcess } from '../replay/process.mjs';
import { checkCandidate } from '../verifier.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */

const APP_NAME = 'grimsheet-playtester';

/**
 * The App_Folder comes from this file's own location (scripts/hunt/ -> two levels up).
 * @param {{env?: Record<string, string|undefined>}} [opts]
 * @returns {HuntDeps}
 */
export function buildHuntDeps(opts) {
  const env = opts?.env ?? process.env;
  const appFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return {
    clock: { nowMs: () => Date.now() },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fs: /** @type {any} */ (fsp),
    paths: { appFolder, dataFolder: path.join(appFolder, 'data'), localAppData: env.LOCALAPPDATA ?? '' },
    spawn: makeStartProcess({}),
    checkCandidate: /** @type {any} */ (checkCandidate),
    token: () => randomBytes(16).toString('hex'),
    pid: process.pid,
    appName: APP_NAME,
    logStderr: (text) => void process.stderr.write(text),
    platform: process.platform === 'win32' ? 'win32' : 'other',
  };
}
