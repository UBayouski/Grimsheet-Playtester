// @ts-check
// Writes and removes one probe key in the installed app's data\config.json, under the results lock that the replay and the
// hunt use (scripts/results-store.mjs). It changes no other key. It cannot use mergeTopKey, because the probe has to be
// deleted afterwards and mergeTopKey only sets keys.

import * as path from 'node:path';
import { withResultsLock } from './../results-store.mjs';

/** @typedef {import('../results-store.mjs').ResultsDeps} ResultsDeps */
/** @typedef {{ok: true} | {ok: false, reason: 'lock_timeout' | 'config_missing' | 'config_unreadable' | 'write_failed'}} ProbeResult */

/** A key that is not the Results_Key. */
export const PROBE_KEY = 'packagingProbe';

/** The smallest probe: `{"pad":""}` (10 bytes: the braces, "pad" with its quotes, the colon and the empty string). */
export const MIN_PROBE_BYTES = 10;

const PATTERN = 'abcdefghij';

/**
 * A probe whose `JSON.stringify` is exactly `bytes` bytes long. The pad repeats a fixed pattern, so a cut or a changed
 * byte shows in a comparison. The text is ASCII, so bytes and characters are the same.
 * @param {number} bytes
 * @returns {{pad: string}}
 */
export function buildProbe(bytes) {
  if (!Number.isInteger(bytes) || bytes < MIN_PROBE_BYTES) throw new RangeError(`a probe is at least ${MIN_PROBE_BYTES} bytes`);
  const length = bytes - MIN_PROBE_BYTES;
  return { pad: PATTERN.repeat(Math.ceil(length / PATTERN.length)).slice(0, length) };
}

/**
 * Read config.json, let `edit` return the next object (or null for no change), and write it with a temp file and a rename.
 * @param {ResultsDeps} deps
 * @param {(config: Record<string, unknown>) => Record<string, unknown>|null} edit
 * @returns {Promise<ProbeResult>}
 */
async function update(deps, edit) {
  const configPath = path.join(deps.paths.dataFolder, 'config.json');
  const locked = await withResultsLock(deps, async () => {
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(await deps.fs.readFile(configPath, 'utf8')); // a leading BOM makes this throw
    } catch (e) {
      return /** @type {const} */ ({ ok: false, reason: /** @type {any} */ (e)?.code === 'ENOENT' ? 'config_missing' : 'config_unreadable' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return /** @type {const} */ ({ ok: false, reason: 'config_unreadable' });
    const next = edit(/** @type {Record<string, unknown>} */ (parsed));
    if (next === null) return /** @type {const} */ ({ ok: true });
    const temp = path.join(deps.paths.dataFolder, `.config.${deps.token()}.tmp`);
    try {
      await deps.fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await deps.fs.rename(temp, configPath);
    } catch {
      await deps.fs.rm(temp, { force: true }).catch(() => {});
      return /** @type {const} */ ({ ok: false, reason: 'write_failed' });
    }
    return /** @type {const} */ ({ ok: true });
  });
  if (!locked.ok) return { ok: false, reason: locked.reason === 'io_error' ? 'write_failed' : 'lock_timeout' };
  return locked.value;
}

/**
 * Set the probe key to a probe of the given size. Every other key is copied as read.
 * @param {ResultsDeps} deps
 * @param {number} bytes
 * @returns {Promise<ProbeResult>}
 */
export function writeProbe(deps, bytes) {
  const probe = buildProbe(bytes);
  return update(deps, (config) => ({ ...config, [PROBE_KEY]: probe }));
}

/**
 * Delete the probe key. When it is absent the file is not written.
 * @param {ResultsDeps} deps
 * @returns {Promise<ProbeResult>}
 */
export function removeProbe(deps) {
  return update(deps, (config) => {
    if (!(PROBE_KEY in config)) return null;
    const { [PROBE_KEY]: _removed, ...rest } = config;
    return rest;
  });
}
