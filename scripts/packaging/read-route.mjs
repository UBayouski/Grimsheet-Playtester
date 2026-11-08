// @ts-check
// Entry (run by the user in a terminal): node scripts/packaging/read-route.mjs crons|config
// Reads one route once and prints a summary: numbers and short facts only, never a body, a script path or the token.
// `crons` answers the first-install questions about the job (name, time formats, the page's replay-job rule);
// `config` prints the sizes of the Results_Key and its parts. It writes no file.

import { pathToFileURL } from 'node:url';
import { CONFIG_ROUTE, CRONS_ROUTE, bodyReason, isReplayJob, readRoute, scrub } from './route-reader.mjs';
import { parseAccessInput, promptSecret, promptVisible } from './secret-prompt.mjs';

const USAGE = 'usage: node scripts/packaging/read-route.mjs crons|config\n';

/** The only job fields that reach the summary. */
const JOB_FIELDS = ['name', 'enabled', 'user_paused', 'is_running', 'last_status', 'consecutive_failures'];
const TIME_FIELDS = ['last_run_ts', 'next_run_ts'];

/**
 * @param {unknown} v
 * @returns {v is string|number|boolean|null}
 */
const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/**
 * A primitive for the summary: a text that holds the script value or a drive-letter path is hidden.
 * @param {string|number|boolean|null} v
 * @param {string|undefined} script
 * @returns {string|number|boolean|null}
 */
function safe(v, script) {
  if (typeof v !== 'string') return v;
  if (script && v.includes(script)) return '[redacted]';
  if (/[A-Za-z]:\\/.test(v)) return '[path]';
  return v.slice(0, 120);
}

/**
 * @param {unknown} v
 * @returns {'epoch-seconds'|'epoch-milliseconds'|'iso-string'|'unknown'|'none'}
 */
function timeFormat(v) {
  if (v === null) return 'none';
  if (typeof v === 'number') return v < 1e11 ? 'epoch-seconds' : 'epoch-milliseconds';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) return 'iso-string';
  return 'unknown';
}

/**
 * The summary of the /api/crons body (R9.4): allow-listed fields of each job, the format of the two time fields, and how
 * many jobs the page's replay-job rule finds. The `script` field and every other field are dropped.
 * @param {unknown} body
 * @returns {{jobs: Array<Record<string, unknown>>, replayJobFound: boolean, replayJobCount: number}}
 */
export function summariseCrons(body) {
  const list = typeof body === 'object' && body !== null && !Array.isArray(body) ? /** @type {any} */ (body).jobs : undefined;
  if (!Array.isArray(list)) return { jobs: [], replayJobFound: false, replayJobCount: 0 };
  /** @type {Array<Record<string, unknown>>} */
  const jobs = [];
  let replayJobCount = 0;
  for (const job of list) {
    if (typeof job !== 'object' || job === null || Array.isArray(job)) continue;
    const j = /** @type {Record<string, unknown>} */ (job);
    const script = typeof j.script === 'string' ? j.script : undefined;
    if (isReplayJob(j)) replayJobCount += 1;
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of JOB_FIELDS) {
      const v = j[key];
      if (key in j && isPrimitive(v)) out[key] = safe(v, script);
    }
    for (const key of TIME_FIELDS) {
      const v = j[key];
      if (key in j && isPrimitive(v)) out[key] = { value: safe(v, script), type: v === null ? 'null' : typeof v, format: timeFormat(v) };
    }
    jobs.push(out);
  }
  return { jobs, replayJobFound: replayJobCount > 0, replayJobCount };
}

/**
 * @param {unknown} v
 * @returns {number|null}
 */
const sizeOf = (v) => (v === undefined ? null : Buffer.byteLength(JSON.stringify(v), 'utf8'));

/**
 * The sizes of the Results_Key and its parts (R9.15, R10.3): numbers only.
 * @param {{bytes: number, json: unknown}} r
 * @returns {{bodyBytes: number, resultsKeyBytes: number|null, latestBytes: number|null, trendBytes: number|null, findingsBytes: number|null, levelCount: number|null, trendCount: number|null}}
 */
export function summariseConfig({ bytes, json }) {
  const empty = { bodyBytes: bytes, resultsKeyBytes: null, latestBytes: null, trendBytes: null, findingsBytes: null, levelCount: null, trendCount: null };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return empty;
  const top = /** @type {any} */ (json).playtesterResults;
  if (typeof top !== 'object' || top === null || Array.isArray(top)) return empty;
  return {
    bodyBytes: bytes,
    resultsKeyBytes: sizeOf(top),
    latestBytes: sizeOf(top.latest),
    trendBytes: sizeOf(top.trend),
    findingsBytes: sizeOf(top.findings),
    levelCount: Array.isArray(top.latest?.levels) ? top.latest.levels.length : null,
    trendCount: Array.isArray(top.trend) ? top.trend.length : null,
  };
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   promptSecret?: (question: string) => Promise<string>,
 *   promptVisible?: (question: string) => Promise<string>,
 *   fetch?: (url: string, init: any) => Promise<any>,
 *   write?: (text: string) => void,
 *   setExitCode?: (code: number) => void,
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
  const secret = io.promptSecret ?? ((question) => promptSecret({ input: process.stdin, output: process.stdout, question }));
  const visible = io.promptVisible ?? ((question) => promptVisible({ input: process.stdin, output: process.stdout, question }));

  const sub = argv.length === 1 ? argv[0] : undefined;
  if (sub !== 'crons' && sub !== 'config') {
    write(USAGE);
    setExitCode(2);
    return;
  }
  const route = sub === 'crons' ? CRONS_ROUTE : CONFIG_ROUTE;

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
    const result = await readRoute({ fetch: io.fetch ?? /** @type {any} */ (globalThis.fetch), origin, token, path: route });
    if (result.kind !== 'response') {
      write(`${JSON.stringify({ route, error: result.kind, message: result.message }, null, 2)}\n`);
      setExitCode(1);
      return;
    }
    if (!result.ok) {
      write(`${JSON.stringify({ route, status: result.status, reason: bodyReason(result) }, null, 2)}\n`);
      setExitCode(1);
      return;
    }
    const summary = sub === 'crons' ? summariseCrons(result.json) : summariseConfig({ bytes: result.bytes, json: result.json });
    write(`${JSON.stringify({ route, status: result.status, summary }, null, 2)}\n`);
    setExitCode(0);
  } catch (e) {
    const message = typeof (/** @type {any} */ (e)?.message) === 'string' ? /** @type {any} */ (e).message : 'unknown error';
    write(`The read stopped: ${scrub(message, token)}\n`);
    setExitCode(prompting ? 2 : 1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
