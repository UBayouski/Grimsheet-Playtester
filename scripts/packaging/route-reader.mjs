// @ts-check
// Reads two routes of the local Crew gateway with GET and nothing else. The token goes in the form named by TOKEN_FORM and
// is removed from every text this module returns. It writes no file and prints nothing; the callers decide what to print.

/** The only paths that may be requested (packaging design, "Route access and the token"). */
export const ALLOWED_PATHS = Object.freeze(['/api/apps/grimsheet-playtester/config', '/api/crons']);
export const CONFIG_ROUTE = '/api/apps/grimsheet-playtester/config';
export const CRONS_ROUTE = '/api/crons';

/**
 * A short reason for an answer that is not a good one (R6.17): the `error`, `message`, `detail`, `code` or `reason` text of a
 * JSON answer, else the start of the body; for an answer that never came, its message. At most 80 characters, white space
 * collapsed. The text is already free of the token, because readRoute scrubs the body and its messages.
 * @param {RouteResult} r
 * @returns {string}
 */
export function bodyReason(r) {
  /** @param {unknown} s @returns {string} */
  const clip = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (r.kind !== 'response') return clip(r.message);
  const json = /** @type {any} */ (r.json);
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    for (const key of ['error', 'message', 'detail', 'code', 'reason']) {
      const v = json[key];
      if (typeof v === 'string' && v.trim() !== '') return clip(v);
      if (typeof v === 'object' && v !== null && typeof v.message === 'string' && v.message.trim() !== '') return clip(v.message);
    }
  }
  return clip(r.bodyText);
}

/**
 * The page's Replay_Job rule: a name of `replay` or ending `/replay`, else a `script` that holds `replay_cron.py`.
 * @param {unknown} job one element of the `jobs` list of /api/crons
 * @returns {boolean}
 */
export function isReplayJob(job) {
  if (typeof job !== 'object' || job === null) return false;
  const { name, script } = /** @type {Record<string, unknown>} */ (job);
  if (typeof name === 'string' && (name === 'replay' || name.endsWith('/replay'))) return true;
  return typeof script === 'string' && script.includes('replay_cron.py');
}

/**
 * How a request carries the token. `query` is the form the documentation shows for the dashboard token (notes, section i);
 * `bearer` is supported behind the same constant. The first real read shows which one the gateway accepts.
 * @type {'query'|'bearer'}
 */
export const TOKEN_FORM = 'query';

/** The gateway must be on this machine: the token is never sent anywhere else. */
const LOCAL_ORIGIN = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;

export const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Replace the token, in every form it can take in a text, with `<token>`.
 * @param {string} text
 * @param {string} token
 * @returns {string}
 */
export function scrub(text, token) {
  if (!token) return text;
  const forms = [encodeURIComponent(token), JSON.stringify(token).slice(1, -1), token]
    .filter((f, i, all) => f !== '' && all.indexOf(f) === i)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const form of forms) out = out.split(form).join('<token>');
  return out;
}

/**
 * @typedef {{status: number, text: () => Promise<string>}} FetchResponse
 * @typedef {Object} ReadRouteOptions
 * @property {(url: string, init: any) => Promise<FetchResponse>} [fetch]
 * @property {string} origin       e.g. http://127.0.0.1:5476
 * @property {string} token
 * @property {string} path         one of ALLOWED_PATHS
 * @property {number} [timeoutMs]  default 15000
 * @property {'query'|'bearer'} [form]
 * @property {(fn: () => void, ms: number) => any} [setTimer]
 * @property {(handle: any) => void} [clearTimer]
 * @property {() => number} [nowMs]
 *
 * @typedef {{ok: boolean, kind: 'response', status: number, bytes: number, bodyText: string, json?: unknown, ms: number}
 *   | {ok: false, kind: 'refused'|'network'|'timeout', message: string}} RouteResult
 */

/**
 * One GET request. The returned `bytes` is the UTF-8 length of the body as received; `bodyText` and `json` come from the body
 * after the token was removed from it.
 * @param {ReadRouteOptions} options
 * @returns {Promise<RouteResult>}
 */
export async function readRoute(options) {
  const {
    fetch = /** @type {any} */ (globalThis.fetch),
    origin,
    token,
    path,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    form = TOKEN_FORM,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    nowMs = Date.now,
  } = options;

  if (!ALLOWED_PATHS.includes(path)) return { ok: false, kind: 'refused', message: 'that path is not one of the two the reader may request' };
  if (typeof origin !== 'string' || !LOCAL_ORIGIN.test(origin)) return { ok: false, kind: 'refused', message: 'the gateway origin must be on this machine' };
  if (typeof token !== 'string' || token === '') return { ok: false, kind: 'refused', message: 'no token was given' };

  const url = form === 'bearer' ? `${origin}${path}` : `${origin}${path}?token=${encodeURIComponent(token)}`;
  /** @type {Record<string, string>} */
  const headers = form === 'bearer' ? { Authorization: `Bearer ${token}` } : {};
  const controller = new AbortController();
  let timedOut = false;
  const handle = setTimer(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const startedAt = nowMs();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'error', headers, signal: controller.signal });
    const raw = await res.text();
    const bodyText = scrub(raw, token);
    /** @type {RouteResult} */
    const result = {
      ok: res.status >= 200 && res.status < 300,
      kind: 'response',
      status: res.status,
      bytes: new TextEncoder().encode(raw).length,
      bodyText,
      ms: nowMs() - startedAt,
    };
    try {
      result.json = JSON.parse(bodyText);
    } catch {
      // not JSON: no parsed value
    }
    return result;
  } catch (e) {
    if (timedOut) return { ok: false, kind: 'timeout', message: `the request took longer than ${Math.round(timeoutMs / 1000)} seconds` };
    const err = /** @type {any} */ (e);
    const name = typeof err?.name === 'string' ? err.name : 'Error';
    const message = typeof err?.message === 'string' ? err.message : '';
    return { ok: false, kind: 'network', message: scrub(`the request failed: ${name}: ${message}`, token) };
  } finally {
    clearTimer(handle);
  }
}
