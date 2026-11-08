// @ts-check
// The measurement of the config route size (Requirement 6): write a probe of growing size into the installed app's
// data\config.json, read the Config_Route after each write, find the first size that is not returned in full, and remove
// the probe. The report holds numbers and short texts only: no token, no body, no home folder.

import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { lockCreatedMs } from '../file-lock.mjs';
import { PROBE_KEY, buildProbe, removeProbe, writeProbe } from './config-probe.mjs';
import { CONFIG_ROUTE, CRONS_ROUTE, isReplayJob } from './route-reader.mjs';

/** @typedef {import('../results-store.mjs').ResultsDeps} ResultsDeps */
/** @typedef {import('./route-reader.mjs').RouteResult} RouteResult */

/** Probe sizes in bytes: the six of R6.4, then doubling to 1 MiB. */
export const SIZES = Object.freeze([16384, 32768, 49152, 65536, 98304, 131072, 262144, 524288, 1048576]);
export const CAP = 1048576;
export const BISECT_GAP = 1024;

/** A run lock is stale after CRON_TIMEOUT (900 s); a hunt lock after 2400 s (Time_Budget 1800 s plus 600 s). */
const RUN_LOCK_STALE_MS = 900_000;
const HUNT_LOCK_STALE_MS = 2_400_000;

/**
 * @typedef {Object} Step
 * @property {'ladder'|'bisect'} phase
 * @property {number} probeBytes
 * @property {number|null} status
 * @property {string} kind
 * @property {number|null} bodyBytes
 * @property {boolean} parsed
 * @property {boolean} equal
 * @property {boolean} good
 * @property {number|null} ms
 *
 * @typedef {Object} Removal
 * @property {boolean} done
 * @property {boolean|null} configRestored
 * @property {boolean|null} routeRestored
 *
 * @typedef {Object} Report
 * @property {1} schema
 * @property {'ok'|'dry-run'|'blocked'|'failed'|'aborted'} status
 * @property {string} dataFolder
 * @property {number[]} [plannedSizes]
 * @property {Step[]} steps
 * @property {number} largestGood  0 when even the first size failed or nothing was tested
 * @property {number|null} firstBad
 * @property {boolean} reachedCap
 * @property {Removal} removal
 * @property {string} message
 */

/**
 * Show a path below the home folder as `~`, keeping the slash style of the path.
 * @param {string} p
 * @param {string} home
 * @returns {string}
 */
export function displayPath(p, home) {
  if (!home) return p;
  const a = p.replace(/\\/g, '/').toLowerCase();
  const h = home.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (h && a.startsWith(h) && (a.length === h.length || a[h.length] === '/')) return `~${p.slice(h.length)}`;
  return p;
}

/**
 * Replace every occurrence of the home folder in a text, in both slash styles.
 * @param {string} text
 * @param {string} home
 * @returns {string}
 */
export function redactHome(text, home) {
  if (!home) return text;
  const bare = home.replace(/[\\/]+$/, '');
  if (!bare) return text;
  const forms = [bare, bare.replace(/\\/g, '/'), bare.replace(/\//g, '\\')].filter((f, i, all) => all.indexOf(f) === i).sort((x, y) => y.length - x.length);
  let out = text;
  for (const f of forms) out = out.split(f).join('~');
  return out;
}

/** @param {Report} report @returns {string} */
export function renderReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * @param {RouteResult} r
 * @returns {string}
 */
function describeFailure(r) {
  return r.kind === 'response' ? `status ${r.status}` : r.kind;
}

/**
 * @param {number} size
 * @param {'ladder'|'bisect'} phase
 * @param {RouteResult} r
 * @returns {Step}
 */
function classify(size, phase, r) {
  if (r.kind !== 'response') {
    return { phase, probeBytes: size, status: null, kind: r.kind, bodyBytes: null, parsed: false, equal: false, good: false, ms: null };
  }
  const parsed = r.json !== undefined;
  const body = /** @type {any} */ (r.json);
  const equal = parsed && typeof body === 'object' && body !== null && isDeepStrictEqual(body[PROBE_KEY], buildProbe(size));
  return { phase, probeBytes: size, status: r.status, kind: 'response', bodyBytes: r.bytes, parsed, equal, good: r.ok && r.status === 200 && equal, ms: r.ms };
}

/**
 * The checks before any write. Returns the config as read, or the reason to stop.
 * @param {ResultsDeps} deps
 * @param {(path: string) => Promise<RouteResult>} read
 * @param {string} dataFolder
 * @returns {Promise<{ok: true, before: Record<string, unknown>} | {ok: false, message: string}>}
 */
async function preChecks(deps, read, dataFolder) {
  try {
    await deps.fs.stat(dataFolder);
  } catch {
    return { ok: false, message: 'the app data folder was not found; install and enable the app first' };
  }
  for (const [name, label, staleMs] of /** @type {const} */ ([
    ['.run.lock', 'run lock', RUN_LOCK_STALE_MS],
    ['.hunt.lock', 'hunt lock', HUNT_LOCK_STALE_MS],
  ])) {
    const lockPath = path.join(dataFolder, name);
    /** @type {string} */
    let text;
    try {
      text = await deps.fs.readFile(lockPath, 'utf8');
    } catch (e) {
      if (/** @type {any} */ (e)?.code === 'ENOENT') continue;
      return { ok: false, message: `the ${label} could not be read` };
    }
    /** @type {number|null} */
    let mtimeMs = null;
    try {
      mtimeMs = (await deps.fs.stat(lockPath)).mtimeMs;
    } catch {
      // the content alone decides
    }
    const created = lockCreatedMs(text, mtimeMs);
    if (created === null || deps.clock.nowMs() - created <= staleMs) {
      return { ok: false, message: `a fresh ${label} exists in the app data folder; a ${label === 'run lock' ? 'replay' : 'hunt'} may be active` };
    }
  }
  const crons = await read(CRONS_ROUTE);
  if (crons.kind !== 'response' || !crons.ok) return { ok: false, message: `${CRONS_ROUTE} could not be read (${describeFailure(crons)})` };
  const jobs = /** @type {any} */ (crons.json)?.jobs;
  if (!Array.isArray(jobs)) return { ok: false, message: `${CRONS_ROUTE} did not return a list of jobs` };
  const replayJobs = jobs.filter(isReplayJob);
  if (replayJobs.length === 0) return { ok: false, message: `the replay job was not found in ${CRONS_ROUTE}` };
  if (replayJobs.some((j) => j.is_running === true)) return { ok: false, message: 'the replay job is running; wait until it has stopped' };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(await deps.fs.readFile(path.join(dataFolder, 'config.json'), 'utf8'));
  } catch (e) {
    return { ok: false, message: /** @type {any} */ (e)?.code === 'ENOENT' ? 'config.json was not found in the app data folder' : 'config.json is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, message: 'config.json is not a JSON object' };
  return { ok: true, before: /** @type {Record<string, unknown>} */ (parsed) };
}

/**
 * @param {{
 *   deps: ResultsDeps,
 *   read: (path: string) => Promise<RouteResult>,
 *   dryRun?: boolean,
 *   homeDir: string,
 *   signal?: AbortSignal,
 * }} ctx
 * @returns {Promise<Report>}
 */
export async function runMeasurement({ deps, read, dryRun = false, homeDir, signal }) {
  /** @param {unknown} t @returns {string} */
  const hide = (t) => redactHome(String(t), homeDir);
  const dataFolder = deps.paths.dataFolder;
  /** @type {Report} */
  const report = {
    schema: 1,
    status: 'ok',
    dataFolder: displayPath(dataFolder, homeDir),
    steps: [],
    largestGood: 0,
    firstBad: null,
    reachedCap: false,
    removal: { done: true, configRestored: null, routeRestored: null },
    message: '',
  };

  const checks = await preChecks(deps, read, dataFolder).catch((e) => ({ ok: /** @type {const} */ (false), message: `a pre-check failed: ${hide(/** @type {any} */ (e)?.message)}` }));
  if (!checks.ok) {
    report.status = 'blocked';
    report.message = hide(checks.message);
    return report;
  }
  if (dryRun) {
    report.status = 'dry-run';
    report.plannedSizes = [...SIZES];
    return report;
  }
  const { before } = checks;

  /** @type {{stop: string|null}} */
  const state = { stop: null };
  let lo = 0;
  /** @type {number|null} */
  let hi = null;

  /**
   * One write-read-compare. Returns 'good', 'bad' or 'stop'.
   * @param {'ladder'|'bisect'} phase
   * @param {number} size
   * @returns {Promise<'good'|'bad'|'stop'>}
   */
  async function step(phase, size) {
    if (signal?.aborted) {
      state.stop = 'aborted';
      return 'stop';
    }
    const w = await writeProbe(deps, size);
    if (!w.ok) {
      state.stop = `the probe could not be written (${w.reason})`;
      return 'stop';
    }
    const record = classify(size, phase, await read(CONFIG_ROUTE));
    report.steps.push(record);
    return record.good ? 'good' : 'bad';
  }

  try {
    for (const size of SIZES) {
      const r = await step('ladder', size);
      if (r === 'good') lo = size;
      else if (r === 'bad') {
        hi = size;
        break;
      } else break;
    }
    while (state.stop === null && hi !== null && hi - lo > BISECT_GAP) {
      const mid = lo + Math.floor((hi - lo) / 2);
      const r = await step('bisect', mid);
      if (r === 'good') lo = mid;
      else if (r === 'bad') hi = mid;
    }
    if (state.stop === null && hi === null) report.reachedCap = true;
    report.largestGood = lo;
    report.firstBad = hi;
    if (state.stop === 'aborted') report.status = 'aborted';
    else if (state.stop !== null) {
      report.status = 'failed';
      report.message = hide(state.stop);
    } else if (signal?.aborted) {
      report.status = 'aborted';
    }
  } catch (e) {
    report.status = 'failed';
    report.largestGood = lo;
    report.firstBad = hi;
    report.message = `unexpected error: ${hide(/** @type {any} */ (e)?.message)}`;
  } finally {
    report.removal = { done: false, configRestored: false, routeRestored: null };
    try {
      const removed = await removeProbe(deps);
      if (removed.ok) {
        report.removal.done = true;
        try {
          const now = JSON.parse(await deps.fs.readFile(path.join(dataFolder, 'config.json'), 'utf8'));
          report.removal.configRestored = isDeepStrictEqual(now, before);
        } catch {
          report.removal.configRestored = false;
        }
        try {
          const after = await read(CONFIG_ROUTE);
          report.removal.routeRestored = after.kind === 'response' && after.ok && isDeepStrictEqual(after.json, before);
        } catch {
          report.removal.routeRestored = false;
        }
      } else {
        report.status = 'failed';
        report.message = `${report.message}${report.message ? ' ' : ''}The probe key ${PROBE_KEY} could not be removed (${removed.reason}); remove that key from config.json by hand.`;
      }
    } catch (e) {
      report.status = 'failed';
      report.message = `${report.message}${report.message ? ' ' : ''}The probe key ${PROBE_KEY} may still be in config.json (${hide(/** @type {any} */ (e)?.message)}); remove that key by hand.`;
    }
  }
  report.message = hide(report.message);
  return report;
}
