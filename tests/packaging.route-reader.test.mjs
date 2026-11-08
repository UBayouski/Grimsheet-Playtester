// @ts-check
// Feature: packaging. The route reader and the prompts (scripts/packaging/route-reader.mjs, secret-prompt.mjs).
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PassThrough } from 'node:stream';
import { ALLOWED_PATHS, TOKEN_FORM, bodyReason, isReplayJob, readRoute, scrub } from '../scripts/packaging/route-reader.mjs';
import { summariseConfig, summariseCrons } from '../scripts/packaging/read-route.mjs';
import { parseAccessInput, promptSecret, promptVisible } from '../scripts/packaging/secret-prompt.mjs';
import { fakeResponse, hang, makeFakeFetch, makeFakeTimer } from './helpers/packaging-fakes.mjs';

const ORIGIN = 'http://127.0.0.1:5476';
const CONFIG_PATH = '/api/apps/grimsheet-playtester/config';
const CRONS_PATH = '/api/crons';

/**
 * Every string anywhere in a value (keys and values), so that a leak is found whatever the JSON escaping.
 * @param {unknown} v
 * @param {string[]} [out]
 * @returns {string[]}
 */
function allStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) allStrings(x, out);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      allStrings(x, out);
    }
  }
  return out;
}

/**
 * @param {unknown} result
 * @param {string} token
 * @returns {boolean} true when the token (raw, URL-encoded or JSON-escaped) appears nowhere in the result
 */
function holdsNoToken(result, token) {
  const forms = [token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)];
  const texts = [...allStrings(result), JSON.stringify(result)];
  return texts.every((t) => forms.every((f) => !t.includes(f)));
}

describe('constants', () => {
  it('allows exactly the config route and the crons route, and uses the query form by default', () => {
    expect([...ALLOWED_PATHS]).toEqual([CONFIG_PATH, CRONS_PATH]);
    expect(TOKEN_FORM).toBe('query');
  });
});

describe('readRoute: the request', () => {
  it('query form: puts the encoded token in the address, sends GET with redirect error and no Authorization header', async () => {
    const { fetch, calls } = makeFakeFetch(() => fakeResponse(200, '{"a":1}'));
    const r = await readRoute({ fetch, origin: ORIGIN, token: 'a+b/c d', path: CRONS_PATH, form: 'query', ...makeFakeTimer(false) });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(calls[0]?.url).toBe(`${ORIGIN}${CRONS_PATH}?token=${encodeURIComponent('a+b/c d')}`);
    expect(Object.keys(calls[0]?.headers ?? {}).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('bearer form: puts the token in the Authorization header and not in the address', async () => {
    const { fetch, calls } = makeFakeFetch(() => fakeResponse(200, '{}'));
    await readRoute({ fetch, origin: ORIGIN, token: 'tok-123456', path: CONFIG_PATH, form: 'bearer', ...makeFakeTimer(false) });
    expect(calls[0]?.url).toBe(`${ORIGIN}${CONFIG_PATH}`);
    expect(calls[0]?.headers['Authorization']).toBe('Bearer tok-123456');
    expect(calls[0]?.method).toBe('GET');
  });

  it('uses the query form when no form is given', async () => {
    const { fetch, calls } = makeFakeFetch(() => fakeResponse(200, '{}'));
    await readRoute({ fetch, origin: ORIGIN, token: 'tok-123456', path: CONFIG_PATH, ...makeFakeTimer(false) });
    expect(calls[0]?.url).toContain('?token=tok-123456');
  });
});

describe('readRoute: the result', () => {
  it('returns status, the UTF-8 byte count of the body, the parsed JSON and the elapsed time', async () => {
    const body = '{"k":"\u00e9\u20ac"}';
    const { fetch } = makeFakeFetch(() => fakeResponse(200, body));
    let now = 1000;
    const r = await readRoute({ fetch, origin: ORIGIN, token: 'tok-123456', path: CONFIG_PATH, nowMs: () => (now += 7), ...makeFakeTimer(false) });
    expect(r).toMatchObject({ ok: true, kind: 'response', status: 200, bytes: new TextEncoder().encode(body).length, json: { k: '\u00e9\u20ac' }, ms: 7 });
  });

  it('gives no parsed JSON for a body that is not JSON, and ok false for a non-2xx status', async () => {
    const a = makeFakeFetch(() => fakeResponse(200, 'plain text'));
    const ra = await readRoute({ fetch: a.fetch, origin: ORIGIN, token: 'tok-123456', path: CRONS_PATH, ...makeFakeTimer(false) });
    expect(ra).toMatchObject({ ok: true, status: 200 });
    expect('json' in ra).toBe(false);
    const b = makeFakeFetch(() => fakeResponse(404, '{"error":"not found"}'));
    const rb = await readRoute({ fetch: b.fetch, origin: ORIGIN, token: 'tok-123456', path: CRONS_PATH, ...makeFakeTimer(false) });
    expect(rb).toMatchObject({ ok: false, kind: 'response', status: 404 });
  });

  it('ends a request after 15 seconds by default, with the kind timeout', async () => {
    const timer = makeFakeTimer(true);
    const { fetch } = makeFakeFetch((_url, init) => hang(init));
    const r = await readRoute({ fetch, origin: ORIGIN, token: 'tok-123456', path: CONFIG_PATH, ...timer });
    expect(timer.delays).toEqual([15000]);
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('reports a network error with the kind network', async () => {
    const { fetch } = makeFakeFetch(() => {
      throw new Error('connect ECONNREFUSED');
    });
    const r = await readRoute({ fetch, origin: ORIGIN, token: 'tok-123456', path: CONFIG_PATH, ...makeFakeTimer(false) });
    expect(r).toMatchObject({ ok: false, kind: 'network' });
  });
});

describe('readRoute properties', () => {
  // Feature: packaging, Property 9: the token never leaves
  it('Property 9: the token, its URL-encoded form and its JSON-escaped form appear nowhere in a result', async () => {
    const arbToken = fc.stringMatching(/^[\x21-\x7e]{8,64}$/);
    const arbBehaviour = fc.constantFrom('ok', 'echo401', 'echo401-encoded', 'throw', 'body-has-token', 'status500-url', 'timeout');
    const arbForm = fc.constantFrom('query', 'bearer');
    await fc.assert(
      fc.asyncProperty(arbToken, arbBehaviour, arbForm, async (token, behaviour, form) => {
        const { fetch } = makeFakeFetch((url, init) => {
          switch (behaviour) {
            case 'ok':
              return fakeResponse(200, '{"a":1}');
            case 'echo401':
              return fakeResponse(401, `denied for ${token}`);
            case 'echo401-encoded':
              return fakeResponse(401, `denied for ${encodeURIComponent(token)}`);
            case 'throw':
              throw new Error(`boom ${token} at ${url}`);
            case 'body-has-token':
              return fakeResponse(200, JSON.stringify({ echo: token, again: encodeURIComponent(token) }));
            case 'status500-url':
              return fakeResponse(500, `request was ${url}`);
            default:
              return hang(init);
          }
        });
        const timer = makeFakeTimer(behaviour === 'timeout');
        const result = await readRoute({ fetch, origin: ORIGIN, token, path: CRONS_PATH, form: /** @type {'query'|'bearer'} */ (form), ...timer });
        expect(holdsNoToken(result, token)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  // Feature: packaging, Property 12: the route reader is GET-only and allow-listed
  it('Property 12: a path outside the allow list is refused before any request; an allowed path is requested with GET', async () => {
    const near = [
      `${CONFIG_PATH}/`,
      `${CONFIG_PATH}?x=1`,
      '/api/apps',
      '/api/apps/other-app/config',
      '/api/crons/a471b9f5',
      `${CRONS_PATH}?x=1`,
      `/${CRONS_PATH}`,
      '/API/crons',
      'api/crons',
      '',
    ];
    const arbBad = fc.oneof(fc.constantFrom(...near), fc.string({ maxLength: 40 })).filter((p) => !ALLOWED_PATHS.includes(p));
    await fc.assert(
      fc.asyncProperty(arbBad, async (path) => {
        const { fetch, calls } = makeFakeFetch(() => fakeResponse(200, '{}'));
        const r = await readRoute({ fetch, origin: ORIGIN, token: 'tok-123456', path, ...makeFakeTimer(false) });
        expect(r).toMatchObject({ ok: false, kind: 'refused' });
        expect(calls).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ALLOWED_PATHS), fc.constantFrom('query', 'bearer'), async (path, form) => {
        const { fetch, calls } = makeFakeFetch(() => fakeResponse(200, '{}'));
        await readRoute({ fetch, origin: ORIGIN, token: 'tok-123456', path, form: /** @type {'query'|'bearer'} */ (form), ...makeFakeTimer(false) });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.redirect).toBe('error');
      }),
      { numRuns: 100 },
    );
  });

  it('refuses an origin that is not on this machine, before any request', async () => {
    for (const origin of ['http://example.test', 'https://10.0.0.5:5476', 'http://127.0.0.1.evil.test', 'ftp://127.0.0.1', '', 'http://localhost:abc']) {
      const { fetch, calls } = makeFakeFetch(() => fakeResponse(200, '{}'));
      const r = await readRoute({ fetch, origin, token: 'tok-123456', path: CRONS_PATH, ...makeFakeTimer(false) });
      expect(r).toMatchObject({ ok: false, kind: 'refused' });
      expect(calls).toHaveLength(0);
    }
    for (const origin of ['http://127.0.0.1:5476', 'http://localhost:5476', 'http://127.0.0.1']) {
      const { fetch, calls } = makeFakeFetch(() => fakeResponse(200, '{}'));
      await readRoute({ fetch, origin, token: 'tok-123456', path: CRONS_PATH, ...makeFakeTimer(false) });
      expect(calls).toHaveLength(1);
    }
  });
});

describe('scrub', () => {
  it('replaces the token in every form, and leaves text alone for an empty token', () => {
    expect(scrub('a tok+1 b', 'tok+1')).toBe('a <token> b');
    expect(scrub(`x ${encodeURIComponent('t k+1')} y`, 't k+1')).toBe('x <token> y');
    expect(scrub('nothing here', 'tok-123456')).toBe('nothing here');
    expect(scrub('abc', '')).toBe('abc');
  });
});

describe('parseAccessInput', () => {
  it('takes the origin and the token from the printed address', () => {
    expect(parseAccessInput('http://127.0.0.1:5476/?token=abcDEF123')).toEqual({ ok: true, origin: 'http://127.0.0.1:5476', token: 'abcDEF123' });
    expect(parseAccessInput('  http://localhost:5476/?token=abc.def-ghi  \n')).toEqual({ ok: true, origin: 'http://localhost:5476', token: 'abc.def-ghi' });
  });

  it('keeps a plus sign and decodes percent escapes in the token', () => {
    expect(parseAccessInput('http://127.0.0.1:5476/?token=a+b%2Fc&x=1')).toEqual({ ok: true, origin: 'http://127.0.0.1:5476', token: 'a+b/c' });
  });

  it('accepts a bare token with no origin', () => {
    expect(parseAccessInput('abcDEF123456')).toEqual({ ok: true, origin: null, token: 'abcDEF123456' });
  });

  it('refuses an address with no token, an empty answer, and a token that holds white space', () => {
    expect(parseAccessInput('http://127.0.0.1:5476/')).toMatchObject({ ok: false });
    expect(parseAccessInput('http://127.0.0.1:5476/?token=')).toMatchObject({ ok: false });
    expect(parseAccessInput('   ')).toMatchObject({ ok: false });
    expect(parseAccessInput('two words')).toMatchObject({ ok: false });
  });
});

describe('the prompts', () => {
  /** @returns {{input: PassThrough & {isTTY?: boolean, setRawMode?: (b: boolean) => void}, output: PassThrough, written: () => string}} */
  function streams() {
    const input = /** @type {any} */ (new PassThrough());
    const output = new PassThrough();
    /** @type {string[]} */
    const chunks = [];
    output.on('data', (c) => chunks.push(String(c)));
    return { input, output, written: () => chunks.join('') };
  }

  it('promptSecret: writes the question, echoes nothing of the answer, and returns it', async () => {
    const { input, output, written } = streams();
    const p = promptSecret({ input, output, question: 'Paste the address: ' });
    input.write('http://127.0.0.1:5476/?token=SECRETVALUE\n');
    await expect(p).resolves.toBe('http://127.0.0.1:5476/?token=SECRETVALUE');
    expect(written()).toContain('Paste the address: ');
    expect(written()).not.toContain('SECRET');
    expect(written()).not.toContain('token=');
  });

  it('promptSecret: handles an answer that arrives in pieces, and a carriage return', async () => {
    const { input, output } = streams();
    const p = promptSecret({ input, output, question: 'q: ' });
    input.write('abc');
    input.write('def\r\n');
    await expect(p).resolves.toBe('abcdef');
  });

  it('promptSecret: turns raw mode on for a terminal and off again, and removes a character on backspace', async () => {
    const { input, output, written } = streams();
    /** @type {boolean[]} */
    const modes = [];
    input.isTTY = true;
    input.setRawMode = (b) => void modes.push(b);
    const p = promptSecret({ input, output, question: 'q: ' });
    input.write('abcX\x7f\r');
    await expect(p).resolves.toBe('abc');
    expect(modes).toEqual([true, false]);
    expect(written()).not.toContain('abc');
  });

  it('promptSecret: refuses an empty answer without echoing anything', async () => {
    const { input, output, written } = streams();
    const p = promptSecret({ input, output, question: 'q: ' });
    input.write('\n');
    await expect(p).rejects.toThrow(/empty/i);
    expect(written()).not.toMatch(/token/i);
  });

  it('promptSecret: Ctrl-C on a terminal cancels and restores the mode', async () => {
    const { input, output } = streams();
    /** @type {boolean[]} */
    const modes = [];
    input.isTTY = true;
    input.setRawMode = (b) => void modes.push(b);
    const p = promptSecret({ input, output, question: 'q: ' });
    input.write('ab\x03');
    await expect(p).rejects.toThrow(/cancel/i);
    expect(modes).toEqual([true, false]);
  });

  it('promptVisible: returns the line, and writes only the question', async () => {
    const { input, output, written } = streams();
    const p = promptVisible({ input, output, question: 'Origin: ' });
    input.write('http://127.0.0.1:5476\n');
    await expect(p).resolves.toBe('http://127.0.0.1:5476');
    expect(written()).toBe('Origin: ');
  });

  it('promptVisible: refuses an answer that holds token= and never writes it back', async () => {
    const { input, output, written } = streams();
    const p = promptVisible({ input, output, question: 'Origin: ' });
    input.write('http://127.0.0.1:5476/?token=SECRETVALUE\n');
    const error = await p.then(
      () => null,
      (e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).not.toContain('SECRET');
    expect(written()).not.toContain('SECRET');
  });
});

describe('bodyReason (the short reason of an answer that is not good, R6.17)', () => {
  /** @param {Partial<{status: number, bodyText: string, json: unknown}>} o */
  const response = (o) => /** @type {any} */ ({ ok: false, kind: 'response', status: 403, bytes: 10, ms: 1, bodyText: '', ...o });

  it('takes the error, message, detail or code text of a JSON answer, in that order', () => {
    expect(bodyReason(response({ bodyText: '{"error":"too large"}', json: { error: 'too large' } }))).toBe('too large');
    expect(bodyReason(response({ json: { message: 'm', detail: 'd', code: 'c' }, bodyText: '{}' }))).toBe('m');
    expect(bodyReason(response({ json: { detail: 'Forbidden' }, bodyText: '{}' }))).toBe('Forbidden');
    expect(bodyReason(response({ json: { code: 'forbidden' }, bodyText: '{}' }))).toBe('forbidden');
    expect(bodyReason(response({ json: { error: { message: 'nested text' } }, bodyText: '{}' }))).toBe('nested text');
  });

  it('falls back to the start of the body, with white space collapsed, at most 80 characters', () => {
    expect(bodyReason(response({ bodyText: 'Forbidden:\n  not   allowed' }))).toBe('Forbidden: not allowed');
    expect(bodyReason(response({ bodyText: 'x'.repeat(300) }))).toBe('x'.repeat(80));
    expect(bodyReason(response({ bodyText: '{"other":1}', json: { other: 1 } }))).toBe('{"other":1}');
    expect(bodyReason(response({ bodyText: '' }))).toBe('');
  });

  it('gives the message of an answer that never came, cut to 80 characters', () => {
    expect(bodyReason({ ok: false, kind: 'timeout', message: 'the request took longer than 15 seconds' })).toBe('the request took longer than 15 seconds');
    expect(bodyReason({ ok: false, kind: 'network', message: 'y'.repeat(200) })).toBe('y'.repeat(80));
  });

  // Feature: packaging, Property 9 (reason text): the reason never holds the token
  it('Property 9: the reason of an answer that echoes the token holds no token, in any form', async () => {
    const arbToken = fc.stringMatching(/^[\x21-\x7e]{8,40}$/);
    await fc.assert(
      fc.asyncProperty(arbToken, fc.constantFrom('text', 'json-error', 'json-detail', 'encoded'), async (token, shape) => {
        const echo = shape === 'encoded' ? encodeURIComponent(token) : token;
        const body = shape === 'json-error' ? JSON.stringify({ error: `denied ${echo}` }) : shape === 'json-detail' ? JSON.stringify({ detail: `no ${echo}` }) : `denied for ${echo}`;
        const { fetch } = makeFakeFetch(() => fakeResponse(403, body));
        const result = await readRoute({ fetch, origin: ORIGIN, token, path: CONFIG_PATH, ...makeFakeTimer(false) });
        const reason = bodyReason(result);
        expect(reason.length).toBeLessThanOrEqual(80);
        for (const form of [token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)]) expect(reason.includes(form)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});
describe('isReplayJob (the page rule for the replay job)', () => {
  it('accepts the name replay, a name ending /replay, and else a script that holds replay_cron.py', () => {
    expect(isReplayJob({ name: 'replay' })).toBe(true);
    expect(isReplayJob({ name: 'grimsheet-playtester/replay' })).toBe(true);
    expect(isReplayJob({ name: 'other', script: 'x/replay_cron.py:run' })).toBe(true);
    expect(isReplayJob({ script: 'x/replay_cron.py:run' })).toBe(true);
  });

  it('refuses other jobs and values that are not objects', () => {
    expect(isReplayJob({ name: 'replay2' })).toBe(false);
    expect(isReplayJob({ name: 'myreplay' })).toBe(false);
    expect(isReplayJob({ name: 'other', script: 'x/other.py:run' })).toBe(false);
    for (const v of [null, undefined, 'replay', 7, []]) expect(isReplayJob(v)).toBe(false);
  });
});

describe('summariseCrons', () => {
  const ALLOWED_KEYS = ['name', 'enabled', 'user_paused', 'is_running', 'last_status', 'consecutive_failures', 'last_run_ts', 'next_run_ts'];

  it('keeps the allow-listed fields, detects the time formats, and finds the replay job', () => {
    const body = {
      jobs: [
        {
          name: 'grimsheet-playtester/replay',
          enabled: true,
          user_paused: false,
          is_running: false,
          last_status: 'ok',
          consecutive_failures: 0,
          last_run_ts: 1731121200,
          next_run_ts: 1731207600000,
          script: 'D:\\x\\replay_cron.py:run',
          every_secs: null,
        },
        { name: 'other', last_run_ts: '2026-11-09T11:00:00Z', next_run_ts: null },
        { name: 'odd', last_run_ts: 'tomorrow' },
      ],
    };
    const s = summariseCrons(body);
    expect(s.replayJobCount).toBe(1);
    expect(s.replayJobFound).toBe(true);
    expect(s.jobs[0]).toEqual({
      name: 'grimsheet-playtester/replay',
      enabled: true,
      user_paused: false,
      is_running: false,
      last_status: 'ok',
      consecutive_failures: 0,
      last_run_ts: { value: 1731121200, type: 'number', format: 'epoch-seconds' },
      next_run_ts: { value: 1731207600000, type: 'number', format: 'epoch-milliseconds' },
    });
    expect(s.jobs[1]?.last_run_ts).toEqual({ value: '2026-11-09T11:00:00Z', type: 'string', format: 'iso-string' });
    expect(s.jobs[1]?.next_run_ts).toEqual({ value: null, type: 'null', format: 'none' });
    expect(s.jobs[2]?.last_run_ts).toEqual({ value: 'tomorrow', type: 'string', format: 'unknown' });
  });

  it('gives an empty summary for a body with no jobs list', () => {
    for (const body of [null, 'x', 5, {}, { jobs: 'no' }]) {
      expect(summariseCrons(body)).toMatchObject({ jobs: [], replayJobFound: false, replayJobCount: 0 });
    }
  });

  it('hides a name that equals or holds the script value, and a drive-letter path', () => {
    const s = summariseCrons({ jobs: [{ name: 'D:\\secret\\replay_cron.py:run', script: 'D:\\secret\\replay_cron.py:run' }, { name: 'C:\\x\\y', last_status: 'at C:\\x' }] });
    const text = JSON.stringify(s);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('C:\\\\x');
  });

  // Feature: packaging, Property 10: the cron summary leaks nothing
  it('Property 10: the script value never appears, and only allow-listed keys are kept', () => {
    const arbScript = fc.stringMatching(/^[A-Z]:\\[a-z]{12,20}\\replay_cron\.py:run$/);
    const arbPrimitive = fc.oneof(fc.string({ maxLength: 12 }), fc.integer(), fc.boolean(), fc.constant(null));
    const arbExtra = fc.dictionary(fc.string({ maxLength: 8 }), fc.oneof(arbPrimitive, fc.array(arbPrimitive, { maxLength: 3 }), fc.object({ maxDepth: 1 })), { maxKeys: 5 });
    const arbJob = fc.tuple(arbScript, arbExtra, fc.boolean(), arbPrimitive, arbPrimitive).map(([script, extra, nameIsScript, status, ts]) => ({
      ...extra,
      name: nameIsScript ? script : 'grimsheet-playtester/replay',
      last_status: status,
      last_run_ts: ts,
      script,
    }));
    fc.assert(
      fc.property(fc.array(arbJob, { minLength: 1, maxLength: 4 }), (jobs) => {
        const s = summariseCrons({ jobs });
        const text = JSON.stringify(s);
        for (const job of jobs) expect(text.includes(job.script)).toBe(false);
        for (const j of s.jobs) for (const key of Object.keys(j)) expect(ALLOWED_KEYS).toContain(key);
      }),
      { numRuns: 200 },
    );
  });
});

describe('summariseConfig', () => {
  it('gives sizes in bytes and counts, and nothing else', () => {
    const latest = { runId: 'run-000002', levels: [{ levelId: 'a' }, { levelId: 'b' }, { levelId: 'c' }] };
    const trend = [{ runId: 'run-000002' }, { runId: 'run-000001' }];
    const body = { theme: 'dark', playtesterResults: { schemaVersion: 1, latest, trend, findings: { items: [] } } };
    const bytes = (/** @type {unknown} */ v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
    expect(summariseConfig({ bytes: 1234, json: body })).toEqual({
      bodyBytes: 1234,
      resultsKeyBytes: bytes(body.playtesterResults),
      latestBytes: bytes(latest),
      trendBytes: bytes(trend),
      findingsBytes: bytes(body.playtesterResults.findings),
      levelCount: 3,
      trendCount: 2,
    });
  });

  it('gives null for a part that is absent, and only the body size for a body that is not an object', () => {
    expect(summariseConfig({ bytes: 10, json: { playtesterResults: { latest: { levels: [] } } } })).toEqual({
      bodyBytes: 10,
      resultsKeyBytes: Buffer.byteLength(JSON.stringify({ latest: { levels: [] } })),
      latestBytes: Buffer.byteLength(JSON.stringify({ levels: [] })),
      trendBytes: null,
      findingsBytes: null,
      levelCount: 0,
      trendCount: null,
    });
    expect(summariseConfig({ bytes: 7, json: undefined })).toEqual({ bodyBytes: 7, resultsKeyBytes: null, latestBytes: null, trendBytes: null, findingsBytes: null, levelCount: null, trendCount: null });
    expect(summariseConfig({ bytes: 7, json: [1] })).toMatchObject({ resultsKeyBytes: null });
  });
});