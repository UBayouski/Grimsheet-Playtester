// @ts-check
// A fake installed app for the measurement tests: an in-memory data folder with a config.json, a fake clock, and a fake
// gateway that answers the two routes from that file. The Config_Route returns the whole file for a probe up to `limit`
// bytes and fails in the chosen way for a bigger one.

import { makeFakeClock, makeMemFs, makeSleep, makeTokenSource } from './fake-fs.mjs';
import { PROBE_KEY } from '../../scripts/packaging/config-probe.mjs';

export const CONFIG_ROUTE = '/api/apps/grimsheet-playtester/config';
export const CRONS_ROUTE = '/api/crons';
export const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

/** The ways in which the route fails for a probe above the limit. */
export const FAILURE_MODES = /** @type {const} */ (['status', 'truncated', 'not-json', 'timeout']);

/**
 * @typedef {Object} WorldOptions
 * @property {string} [home]                  default /home/tester
 * @property {Record<string, unknown>|null} [config]  the seeded config; null seeds no file
 * @property {number} [limit]                 the largest probe the route returns in full (default: no limit)
 * @property {typeof FAILURE_MODES[number]} [mode]   how a bigger probe fails (default status)
 * @property {number} [failStatus]            the status of the status mode (default 413)
 * @property {number} [configStatus]          if set, the Config_Route always answers this status (a refused token)
 * @property {Array<Record<string, unknown>>} [jobs]  the jobs of /api/crons
 * @property {number} [cronsStatus]           the status of /api/crons (default 200)
 * @property {boolean} [seedFolder]           create the data folder (default true)
 */

/**
 * @param {WorldOptions} [o]
 */
export function makeMeasureWorld(o = {}) {
  const home = o.home ?? '/home/tester';
  const data = `${home}/.kiro/crew/apps/grimsheet-playtester/data`;
  const configPath = `${data}/config.json`;
  const clock = makeFakeClock(T0);
  const memFs = makeMemFs({ clock });
  if (o.seedFolder !== false) memFs.seedDir(data);
  const original =
    o.config === undefined
      ? { theme: 'dark', playtesterResults: { schemaVersion: 1, latest: { runId: 'run-000001', state: 'complete' }, trend: [] } }
      : o.config;
  if (original !== null && o.seedFolder !== false) memFs.seedFile(configPath, `${JSON.stringify(original, null, 2)}\n`);
  const deps = {
    fs: /** @type {import('../../scripts/replay/types.mjs').Fs} */ (/** @type {unknown} */ (memFs)),
    paths: { appFolder: `${home}/.kiro/crew/apps/grimsheet-playtester`, dataFolder: data, localAppData: `${home}/lad` },
    clock,
    sleep: makeSleep(clock),
    token: makeTokenSource(),
    pid: 4242,
  };
  const limit = o.limit ?? Number.POSITIVE_INFINITY;
  const mode = o.mode ?? 'status';
  const failStatus = o.failStatus ?? 413;
  const jobs = o.jobs ?? [{ name: 'replay', enabled: true, is_running: false, script: 'D:/secret/path/replay_cron.py:run' }];
  /** @type {string[]} */
  const requested = [];

  /**
   * What the gateway answers for a path.
   * @param {string} path
   * @returns {{status: number, text: string} | {timeout: true}}
   */
  function answer(path) {
    requested.push(path);
    if (path === CRONS_ROUTE) return { status: o.cronsStatus ?? 200, text: JSON.stringify({ jobs }) };
    if (path !== CONFIG_ROUTE) return { status: 404, text: '{"error":"not found"}' };
    if (o.configStatus !== undefined) return { status: o.configStatus, text: '{"detail":"Forbidden"}' };
    const text = memFs.peek(configPath);
    if (text === undefined) return { status: 404, text: '{"error":"no config"}' };
    const obj = JSON.parse(text);
    const probe = obj[PROBE_KEY];
    const probeBytes = probe === undefined ? 0 : Buffer.byteLength(JSON.stringify(probe), 'utf8');
    const body = JSON.stringify(obj);
    if (probeBytes <= limit) return { status: 200, text: body };
    if (mode === 'status') return { status: failStatus, text: failStatus === 413 ? '{"error":"too large"}' : failStatus === 403 ? '{"detail":"Forbidden"}' : `{"detail":"status ${failStatus}"}` };
    if (mode === 'truncated') return { status: 200, text: body.slice(0, Math.floor(body.length / 2)) };
    if (mode === 'not-json') return { status: 200, text: 'oops' };
    return { timeout: true };
  }

  /**
   * The `read` function that the measurement takes: a RouteResult for a path.
   * @param {string} path
   * @returns {Promise<import('../../scripts/packaging/route-reader.mjs').RouteResult>}
   */
  async function read(path) {
    const a = answer(path);
    if ('timeout' in a) return { ok: false, kind: 'timeout', message: 'the request took longer than 15 seconds' };
    /** @type {import('../../scripts/packaging/route-reader.mjs').RouteResult} */
    const result = { ok: a.status >= 200 && a.status < 300, kind: 'response', status: a.status, bytes: Buffer.byteLength(a.text, 'utf8'), bodyText: a.text, ms: 1 };
    try {
      result.json = JSON.parse(a.text);
    } catch {
      // not JSON
    }
    return result;
  }

  /**
   * A fetch for the real reader: it takes the path from the address and ignores the query.
   * @param {string} url
   * @returns {Promise<any>}
   */
  async function fetch(url) {
    const path = new URL(url).pathname;
    const a = answer(path);
    if ('timeout' in a) return new Promise(() => {});
    return { status: a.status, ok: a.status >= 200 && a.status < 300, text: async () => a.text };
  }

  return { home, data, configPath, clock, memFs, deps, original, read, fetch, requested };
}
