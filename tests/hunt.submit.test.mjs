// @ts-check
// Unit tests of scripts/hunt/submit.mjs (`runSubmit`, `summarizePlay`) (design: "Hunt_Submit flow", "Order of checks",
// the Hunt_Submit printed bodies and the refusal table, Decisions 5, 6, 20, 21, 23, 24; Requirements 7, 8, 9, 10).
// The module does not exist yet: these tests fail until task 16.2.
// The properties (tasks 16.3 to 16.5) are added to this file later.
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CLASS_NAMES, LEVEL_POOL, arbActionList, arbArgv, arbCheckResult, arbSubmitScript, canonicalTokens } from './hunt.arbitraries.mjs';
import { checkCandidate } from '../scripts/verifier.mjs';
import { summarizePlay } from '../scripts/hunt/submit.mjs';
import { writeActive, writeHuntRecord } from '../scripts/hunt/hunt-store.mjs';
import { chargeAttempt, chargeRefusal, countsOf, newHuntRecord, readyRecord, recordOutcome } from '../scripts/hunt/hunt-record.mjs';
import { buildFinding, sizeOf } from '../scripts/hunt/findings.mjs';
import { encodeRaw, printActions } from '../scripts/hunt/tokens.mjs';
import { FINDING_MAX_BYTES } from '../scripts/hunt/limits.mjs';
import { procCannotStart, procFail, procHang, procOk } from './helpers/fake-spawn.mjs';
import { CONFIG_PATH, DATA_FOLDER, HUNT_CHECKOUT, HUNT_LOCAL_FOLDER, makeHuntWorld } from './helpers/hunt-world.mjs';

const HUNT_ID = 'hunt-20261108T110312Z';
const COMMIT = 'e1c61a35b3da027aada5d9ef4460efa4470488a4';
const TOKEN = '9f3c0a51d2b84e67a1c05be3f7d92a48';
const READY_AT = '2026-11-08T11:03:40.000Z';
const READY_MS = Date.parse(READY_AT);
const LEVELS = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt'];
const HUNTS = `${DATA_FOLDER}\\hunts`;
const LOCK = `${DATA_FOLDER}\\.hunt.lock`;
const CALL_LOCK = `${DATA_FOLDER}\\.hunt-call.lock`;
const ACTIVE = `${HUNTS}\\active.json`;
const RECORD_PATH = `${HUNTS}\\${HUNT_ID}.json`;
const L02 = '02-the-chaser';

/** @param {string} relative path under tests/fixtures/ @returns {string} */
const readFixture = (relative) => readFileSync(new URL(`./fixtures/${relative}`, import.meta.url), 'utf8');
const SOLUTION_02 = JSON.parse(readFixture('solutions/02-the-chaser.json'));

/** Where Candidate_File number `n` goes. @param {number} n @param {string} [level] @param {string} [cls] @returns {string} */
const candidatePath = (n, level = L02, cls = 'cheaper_win') =>
  path.join(HUNT_LOCAL_FOLDER, 'candidates', HUNT_ID, `${String(n).padStart(3, '0')}-${level}-${cls}.json`);

/**
 * Submit arguments.
 * @param {string[]} [tokens]
 * @param {string} [level]
 * @param {string} [cls]
 * @returns {string[]}
 */
const args = (tokens = ['E', 'E'], level = L02, cls = 'cheaper_win') => ['--level', level, '--class', cls, '--actions', ...tokens];

/** A CheckOk. @param {Record<string, unknown>} [over] @returns {any} */
function checkOk(over = {}) {
  return {
    levelId: L02,
    claimedClass: 'cheaper_win',
    outcome: 'confirmed',
    reasonCode: 'class_reproduced',
    reason: 'The replay reproduces the claimed class.',
    won: true,
    inkSpent: 0,
    minimalInk: 1,
    editCount: 0,
    newEditAddresses: [],
    ...over,
  };
}

/** A play result the stub verifier is given. @returns {import('../scripts/replay/types.mjs').ProcResult} */
const aPlay = () => procOk(readFixture('02-the-chaser.play.json'));

/**
 * A running record that is `n` Attempts and outcomes further, all counted as rejected.
 * @param {any} record @param {string} level @param {number} n @returns {any}
 */
function spend(record, level, n) {
  let r = record;
  for (let i = 0; i < n; i += 1) r = recordOutcome(chargeAttempt(r, level), level, 'rejected', 'not_cheaper');
  return r;
}

/** @param {any} record @param {number} n @returns {any} */
function refuse(record, n) {
  let r = record;
  for (let i = 0; i < n; i += 1) r = chargeRefusal(r, 'bad_arguments');
  return r;
}

/**
 * A world in the state of a live Hunt: the running ready record, the pointer, the Hunt lock with the Hunt token.
 * @param {{
 *   plays?: Parameters<typeof makeHuntWorld>[0] extends infer O ? (O extends {plays?: infer P} ? P : never) : never,
 *   check?: any, solutions?: string[], levels?: string[], mutate?: (record: any) => any,
 *   afterReadySec?: number, config?: unknown, configText?: string,
 * }} [o]
 */
async function liveWorld(o = {}) {
  const w = makeHuntWorld({ plays: /** @type {any} */ (o.plays), check: o.check, solutions: o.solutions });
  w.fs.seedDir(HUNTS);
  let record = newHuntRecord({ huntId: HUNT_ID, startedAt: '2026-11-08T11:03:12.000Z', repoUrl: 'https://example.invalid/g', branch: 'main' });
  record = readyRecord(record, { readyAt: READY_AT, commit: COMMIT, levels: o.levels ?? LEVELS, levelsSkipped: 0 });
  if (o.mutate) record = o.mutate(record);
  await writeHuntRecord(w.deps, record);
  await writeActive(w.deps, { schemaVersion: 1, huntId: HUNT_ID, token: TOKEN, readyAt: READY_AT });
  w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: TOKEN, createdAt: READY_AT }));
  if (o.configText !== undefined) w.fs.seedFile(CONFIG_PATH, o.configText);
  else w.seedConfig(o.config ?? {});
  w.clock.advance(READY_MS + (o.afterReadySec ?? 100) * 1000 - w.clock.nowMs());
  return w;
}

/** @param {ReturnType<typeof makeHuntWorld>} w @returns {any} */
const readRecord = (w) => JSON.parse(/** @type {string} */ (w.fs.peek(RECORD_PATH)));
/** @param {ReturnType<typeof makeHuntWorld>} w @returns {any} */
const readConfig = (w) => JSON.parse(/** @type {string} */ (w.fs.peek(CONFIG_PATH)));
/** @param {ReturnType<typeof makeHuntWorld>} w @returns {string[]} the Candidate_Files written */
const candidateFiles = (w) => w.fs.paths(path.join(HUNT_LOCAL_FOLDER, 'candidates'));

/**
 * Wraps the dependencies of a world to log the order of operations. The charge is the record write whose
 * level counts hold no outcome yet.
 * @param {ReturnType<typeof makeHuntWorld>} w
 * @returns {string[]} the log, filled while the test runs
 */
function instrument(w) {
  /** @type {string[]} */
  const events = [];
  const realFs = w.deps.fs;
  const realSpawn = w.deps.spawn;
  const realCheck = w.deps.checkCandidate;
  w.deps.fs = {
    ...realFs,
    async rename(from, to) {
      await realFs.rename(from, to);
      if (to === RECORD_PATH) {
        const rec = JSON.parse(/** @type {string} */ (w.fs.peek(to)));
        const outcomes = Object.values(rec.levels).reduce((n, l) => n + l.confirmed + l.rejected + l.error + l.duplicate + l.notRecorded, 0);
        events.push(`record:${rec.attempts}/${outcomes}`);
      } else if (to.includes('candidates')) events.push('candidate');
    },
  };
  w.deps.spawn = Object.assign(
    async (/** @type {any} */ spec) => {
      if (spec.args.includes('--actions-file')) events.push('play');
      return realSpawn(spec);
    },
    { calls: /** @type {any} */ (realSpawn).calls },
  );
  w.deps.checkCandidate = (...a) => {
    events.push('check');
    return realCheck(...a);
  };
  return events;
}

/** A write that fails for paths matching `pattern`. @param {ReturnType<typeof makeHuntWorld>} w @param {RegExp} pattern */
function failWrites(w, pattern) {
  const real = w.deps.fs;
  w.deps.fs = {
    ...real,
    async writeFile(p, data, opts) {
      if (pattern.test(p)) throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' });
      return real.writeFile(p, data, opts);
    },
  };
}

/**
 * A `check` that records its calls and answers `answer`.
 * @param {any} answer
 * @returns {{fn: (...a: any[]) => any, calls: any[][]}}
 */
function spyCheck(answer) {
  /** @type {any[][]} */
  const calls = [];
  return {
    calls,
    fn: (...a) => {
      calls.push(a);
      return typeof answer === 'function' ? answer(...a) : answer;
    },
  };
}

describe('summarizePlay', () => {
  const play = (/** @type {Record<string, unknown>} */ over = {}) => ({
    start: { status: 'playing', hp: 3 },
    steps: [
      { accepted: true, status: 'playing' },
      { accepted: false, status: 'playing' },
      { accepted: true, status: 'won' },
    ],
    final: { status: 'won', hp: 2 },
    ...over,
  });

  it('counts the steps and reads the final status, the final hp, the first refused step and the first status change from 0', () => {
    expect(summarizePlay(play())).toEqual({ steps: 3, finalStatus: 'won', finalHp: 2, firstRefused: 1, firstStatusChange: { step: 2, status: 'won' } });
  });

  it('gives null for firstRefused and firstStatusChange when there are none', () => {
    const p = play({ steps: [{ accepted: true, status: 'playing' }, { accepted: true, status: 'playing' }], final: { status: 'playing', hp: 3 } });
    expect(summarizePlay(p)).toEqual({ steps: 2, finalStatus: 'playing', finalHp: 3, firstRefused: null, firstStatusChange: null });
  });

  it('takes the first step whose status differs from the start status, also at index 0', () => {
    const p = play({ steps: [{ accepted: true, status: 'lost' }, { accepted: true, status: 'won' }], final: { status: 'won', hp: 0 } });
    expect(/** @type {any} */ (summarizePlay(p)).firstStatusChange).toEqual({ step: 0, status: 'lost' });
  });

  it('reads the real captures', () => {
    expect(summarizePlay(JSON.parse(readFixture('01-the-corridor.play.json')))).toEqual({
      steps: 9, finalStatus: 'won', finalHp: 3, firstRefused: null, firstStatusChange: { step: 8, status: 'won' },
    });
    expect(/** @type {any} */ (summarizePlay(JSON.parse(readFixture('01-the-corridor.undo-first.play.json')))).firstRefused).toBe(0);
    expect(summarizePlay(JSON.parse(readFixture('02-the-chaser.truncated.play.json')))).toEqual({
      steps: 3, finalStatus: 'playing', finalHp: 3, firstRefused: null, firstStatusChange: null,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'text'],
    ['an array', []],
    ['an empty object', {}],
    ['steps that are not an array', { start: { status: 'playing' }, steps: 'x', final: { status: 'won', hp: 1 } }],
    ['no final', { start: { status: 'playing' }, steps: [{ accepted: true, status: 'won' }] }],
    ['no start', { steps: [{ accepted: true, status: 'won' }], final: { status: 'won', hp: 1 } }],
  ])('gives null for %s', (_name, value) => {
    expect(summarizePlay(value)).toBeNull();
  });

  it('never throws, also for an object whose members throw', () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('boom'); } });
    expect(() => summarizePlay(hostile)).not.toThrow();
    expect(summarizePlay(hostile)).toBeNull();
    const getter = { start: { status: 'playing' }, final: { status: 'won', hp: 1 }, get steps() { throw new Error('boom'); } };
    expect(summarizePlay(getter)).toBeNull();
  });
});

describe('Hunt_Submit: a confirmed Attempt', () => {
  /** A stub that confirms every claim. */
  const confirming = () => ({ [L02]: checkOk() });

  it('prints the confirmed body, exit 0, and records the Finding in config.json', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: confirming(), config: { keep: 1, playtesterResults: { schemaVersion: 1, latest: { x: 1 } } } });
    const res = await w.submit(args(['E', 'E', 'N']));
    expect(res.exit).toBe(0);
    const findingId = `${HUNT_ID}-001`;
    expect(res.body).toEqual({
      outcome: 'confirmed',
      reasonCode: 'class_reproduced',
      reason: 'The replay reproduces the claimed class.',
      levelId: L02,
      class: 'cheaper_win',
      attempt: 1,
      won: true,
      inkSpent: 0,
      minimalInk: 1,
      editCount: 0,
      newEditAddresses: [],
      findingId,
      play: summarizePlay(JSON.parse(readFixture('02-the-chaser.play.json'))),
      left: { level: 3, total: 19, refusals: 10, seconds: 1700 },
      finished: false,
    });
    const config = readConfig(w);
    expect(config.keep).toBe(1);
    expect(config.playtesterResults.latest).toEqual({ x: 1 });
    const findings = config.playtesterResults.findings;
    expect(findings.items).toHaveLength(1);
    expect(findings.items[0]).toEqual({
      id: findingId,
      levelId: L02,
      class: 'cheaper_win',
      commit: COMMIT,
      huntId: HUNT_ID,
      foundAt: new Date(w.clock.nowMs()).toISOString(),
      actions: ['E', 'E', 'N'],
      result: { won: true, inkSpent: 0, minimalInk: 1, editCount: 0, newEditAddresses: [], reasonCode: 'class_reproduced' },
    });
    expect(findings.counts).toEqual({ attempts: 1, confirmed: 1, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 });
    expect(findings.huntId).toBe(HUNT_ID);
    expect(findings.commit).toBe(COMMIT);
  });

  it('counts the Attempt in the Hunt_Record by Outcome and reason code, and keeps the Hunt running', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: confirming() });
    await w.submit(args());
    const rec = readRecord(w);
    expect(rec.state).toBe('running');
    expect(rec.attempts).toBe(1);
    expect(rec.refusals).toBe(0);
    expect(rec.levels[L02]).toEqual({ attempts: 1, confirmed: 1, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 });
    expect(rec.reasonCodes.class_reproduced).toBe(1);
    expect(rec.pendingFindings).toEqual([]);
    expect(rec.findingsKey).toBe('ok');
    expect(w.fs.has(ACTIVE)).toBe(true);
    expect(w.fs.has(LOCK)).toBe(true);
  });

  it('releases the call lock', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: confirming() });
    await w.submit(args());
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it('stores the canonical tokens in the Finding', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: confirming() });
    await w.submit(args(['edit:B14=%3d', 'E']));
    expect(readConfig(w).playtesterResults.findings.items[0].actions).toEqual(['edit:B14=%3D', 'E']);
  });
});

describe('Hunt_Submit: a confirmed Attempt whose merge fails', () => {
  it('gives confirmed with findingsKey, keeps the Finding in pendingFindings and leaves config.json alone', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() }, configText: '{not json' });
    const res = await w.submit(args());
    expect(res.exit).toBe(0);
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('confirmed');
    expect(body.findingsKey).toBe('config_unreadable');
    expect(body.findingId).toBe(`${HUNT_ID}-001`);
    expect(w.fs.peek(CONFIG_PATH)).toBe('{not json');
    const rec = readRecord(w);
    expect(rec.findingsKey).toBe('config_unreadable');
    expect(rec.pendingFindings).toHaveLength(1);
    expect(rec.pendingFindings[0].id).toBe(`${HUNT_ID}-001`);
    expect(rec.pendingFindings[0].levelId).toBe(L02);
    expect(rec.levels[L02].confirmed).toBe(1);
  });
});

describe('Hunt_Submit: a rejected Attempt', () => {
  it('prints the rejected body without findingId, exit 0, and changes no Finding', async () => {
    const rejected = checkOk({ outcome: 'rejected', reasonCode: 'not_cheaper', reason: 'The win spent at least minimalInk ink.', inkSpent: 1 });
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: rejected } });
    const before = w.fs.peek(CONFIG_PATH);
    const res = await w.submit(args());
    expect(res.exit).toBe(0);
    expect(res.body).toEqual({
      outcome: 'rejected',
      reasonCode: 'not_cheaper',
      reason: 'The win spent at least minimalInk ink.',
      levelId: L02,
      class: 'cheaper_win',
      attempt: 1,
      won: true,
      inkSpent: 1,
      minimalInk: 1,
      editCount: 0,
      newEditAddresses: [],
      play: summarizePlay(JSON.parse(readFixture('02-the-chaser.play.json'))),
      left: { level: 3, total: 19, refusals: 10, seconds: 1700 },
      finished: false,
    });
    expect(w.fs.peek(CONFIG_PATH)).toBe(before);
    const rec = readRecord(w);
    expect(rec.levels[L02]).toEqual({ attempts: 1, confirmed: 0, rejected: 1, error: 0, duplicate: 0, notRecorded: 0 });
    expect(rec.reasonCodes.not_cheaper).toBe(1);
  });
});

describe('Hunt_Submit: an error from the verifier', () => {
  it('prints the error body with no measured fields and no play block', async () => {
    const error = { outcome: 'error', reasonCode: 'replay_mismatch', reason: 'The play does not match the candidate.' };
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: error } });
    const before = w.fs.peek(CONFIG_PATH);
    const res = await w.submit(args());
    expect(res.exit).toBe(0);
    expect(res.body).toEqual({
      outcome: 'error',
      reasonCode: 'replay_mismatch',
      reason: 'The play does not match the candidate.',
      levelId: L02,
      class: 'cheaper_win',
      attempt: 1,
      left: { level: 3, total: 19, refusals: 10, seconds: 1700 },
      finished: false,
    });
    expect(w.fs.peek(CONFIG_PATH)).toBe(before);
    const rec = readRecord(w);
    expect(rec.levels[L02].error).toBe(1);
    expect(rec.reasonCodes.replay_mismatch).toBe(1);
  });
});

describe('Hunt_Submit: a duplicate', () => {
  it('reports duplicate_finding with duplicateOf and leaves the Findings_Value unchanged', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    await w.submit(args(['E', 'E']));
    const before = JSON.stringify(readConfig(w).playtesterResults.findings);
    const res = await w.submit(args(['E', 'E']));
    expect(res.exit).toBe(0);
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('duplicate');
    expect(body.reasonCode).toBe('duplicate_finding');
    expect(body.duplicateOf).toBe(`${HUNT_ID}-001`);
    expect('findingId' in body).toBe(false);
    expect(body).toMatchObject({ levelId: L02, class: 'cheaper_win', attempt: 2, won: true, finished: false });
    expect(body.play).toEqual(summarizePlay(JSON.parse(readFixture('02-the-chaser.play.json'))));
    expect(body.left).toEqual({ level: 2, total: 18, refusals: 10, seconds: 1700 });
    expect(JSON.stringify(readConfig(w).playtesterResults.findings)).toBe(before);
    const rec = readRecord(w);
    expect(rec.levels[L02]).toMatchObject({ attempts: 2, confirmed: 1, duplicate: 1 });
    expect(rec.reasonCodes.duplicate_finding).toBe(1);
  });
});

describe('Hunt_Submit: a Finding that is too large', () => {
  it('reports not_recorded with finding_too_large, bytes and maxBytes, and writes no Finding', async () => {
    const big = checkOk({ newEditAddresses: Array.from({ length: 60 }, () => 'A'.repeat(30)) });
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: big } });
    const before = w.fs.peek(CONFIG_PATH);
    const res = await w.submit(args());
    expect(res.exit).toBe(0);
    const finding = buildFinding({
      huntId: HUNT_ID, attempt: 1, commit: COMMIT, foundAt: new Date(w.clock.nowMs()).toISOString(), levelId: L02,
      claimedClass: 'cheaper_win', tokens: ['E', 'E'], checkOk: big,
    });
    expect(sizeOf(finding)).toBeGreaterThan(FINDING_MAX_BYTES);
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('not_recorded');
    expect(body.reasonCode).toBe('finding_too_large');
    expect(body.bytes).toBe(sizeOf(finding));
    expect(body.maxBytes).toBe(1536);
    expect('findingId' in body).toBe(false);
    expect(body).toMatchObject({ levelId: L02, class: 'cheaper_win', attempt: 1, won: true, finished: false });
    expect(w.fs.peek(CONFIG_PATH)).toBe(before);
    const rec = readRecord(w);
    expect(rec.levels[L02].notRecorded).toBe(1);
    expect(rec.reasonCodes.finding_too_large).toBe(1);
    expect(rec.pendingFindings).toEqual([]);
  });
});

describe('Hunt_Submit: refusals', () => {
  /**
   * Common checks of a refusal that starts nothing and writes no Candidate_File.
   * @param {ReturnType<typeof makeHuntWorld>} w
   * @param {{exit: number, body: Record<string, unknown>}} res
   * @param {string} code
   * @returns {any} the body
   */
  function expectRefused(w, res, code) {
    expect(res.exit).toBe(3);
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('refused');
    expect(body.reasonCode).toBe(code);
    expect(w.calls.spawn).toHaveLength(0);
    expect(candidateFiles(w)).toEqual([]);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
    return body;
  }

  it('no_active_hunt: exit 3, the printed body, nothing written', async () => {
    const w = makeHuntWorld();
    const before = w.fs.snapshot();
    const res = await w.submit(args());
    expect(res.exit).toBe(3);
    expect(res.body).toEqual({ outcome: 'refused', reasonCode: 'no_active_hunt', reason: 'No hunt is active. Run Hunt_Begin first.' });
    expect(w.calls.spawn).toHaveLength(0);
    // Only the call lock may come and go; the files are as before.
    expect(w.fs.snapshot()).toEqual(before);
  });

  it('no_active_hunt: the Hunt lock holds another token, nothing written', async () => {
    const w = await liveWorld();
    w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: 'a-newer-hunt-token', createdAt: READY_AT }));
    const before = w.fs.snapshot();
    const res = await w.submit(args());
    expect(res.exit).toBe(3);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('no_active_hunt');
    expect(w.fs.snapshot()).toEqual(before);
  });

  it('refusal_budget_spent: finishes the Hunt, charges nothing, prints finished and summary', async () => {
    const w = await liveWorld({ mutate: (r) => refuse(r, 10) });
    const res = await w.submit(args());
    const body = expectRefused(w, res, 'refusal_budget_spent');
    expect(body.reason).toBe('The 10 refusals are used. The hunt is over.');
    expect(body.finished).toBe(true);
    expect(body.summary).toEqual({
      attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0, seconds: 100, refusals: 10, findingsKey: 'ok',
    });
    const rec = readRecord(w);
    expect(rec.state).toBe('complete');
    expect(rec.refusals).toBe(10);
    expect(rec.attempts).toBe(0);
    expect(rec.reasonCodes.refusal_budget_spent).toBe(1);
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.fs.has(LOCK)).toBe(false);
  });

  it('refusal_budget_spent comes before bad_arguments (check 2 before check 3)', async () => {
    const w = await liveWorld({ mutate: (r) => refuse(r, 10) });
    const res = await w.submit([]);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('refusal_budget_spent');
  });

  it('the call after a self-finish is no_active_hunt and writes nothing', async () => {
    const w = await liveWorld({ mutate: (r) => refuse(r, 10) });
    await w.submit(args());
    const before = w.fs.snapshot();
    const res = await w.submit(args());
    expect(res.exit).toBe(3);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('no_active_hunt');
    expect(w.fs.snapshot()).toEqual(before);
  });

  it('the 10th refusal is answered and charged; the next call is refusal_budget_spent', async () => {
    const w = await liveWorld({ mutate: (r) => refuse(r, 9) });
    const tenth = /** @type {any} */ ((await w.submit([])).body);
    expect(tenth.reasonCode).toBe('bad_arguments');
    expect(tenth.left.refusals).toBe(0);
    expect(tenth.finished).toBe(false);
    expect(readRecord(w).state).toBe('running');
    const next = /** @type {any} */ ((await w.submit(args())).body);
    expect(next.reasonCode).toBe('refusal_budget_spent');
    expect(next.finished).toBe(true);
  });

  it('bad_arguments: prints detail and left (refusal charged), stores no detail, finishes nothing', async () => {
    const w = await liveWorld();
    const res = await w.submit(args([`edit:B14=${'A'.repeat(41)}`]));
    const body = expectRefused(w, res, 'bad_arguments');
    expect(body).toEqual({
      outcome: 'refused',
      reasonCode: 'bad_arguments',
      detail: 'raw_too_long',
      reason: 'The arguments could not be read.',
      left: { level: null, total: 20, refusals: 9, seconds: 1700 },
      finished: false,
    });
    const rec = readRecord(w);
    expect(rec.refusals).toBe(1);
    expect(rec.attempts).toBe(0);
    expect(rec.levels[L02].attempts).toBe(0);
    expect(rec.reasonCodes.bad_arguments).toBe(1);
    expect(rec.state).toBe('running');
    expect(JSON.stringify(rec)).not.toContain('raw_too_long');
    expect(w.fs.has(ACTIVE)).toBe(true);
  });

  it('raw_too_long counts UTF-8 bytes: 11 emoji (44 bytes) are refused', async () => {
    const w = await liveWorld();
    const res = await w.submit(args([`edit:B14=${encodeRaw('\u{1F600}'.repeat(11))}`]));
    const body = expectRefused(w, res, 'bad_arguments');
    expect(body.detail).toBe('raw_too_long');
  });

  it('a raw of exactly 40 bytes is accepted', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk({ outcome: 'rejected', reasonCode: 'not_cheaper' }) } });
    const res = await w.submit(args([`edit:B14=${'A'.repeat(40)}`]));
    expect(/** @type {any} */ (res.body).outcome).toBe('rejected');
  });

  it('bad_arguments for no arguments: missing_level', async () => {
    const w = await liveWorld();
    const body = expectRefused(w, await w.submit([]), 'bad_arguments');
    expect(body.detail).toBe('missing_level');
    expect(body.left).toEqual({ level: null, total: 20, refusals: 9, seconds: 1700 });
  });

  it('unknown_level: refusal charged, left.level null', async () => {
    const w = await liveWorld();
    const res = await w.submit(args(['E'], 'no-such-level'));
    const body = expectRefused(w, res, 'unknown_level');
    expect(body).toEqual({
      outcome: 'refused',
      reasonCode: 'unknown_level',
      reason: 'The level is not in this hunt.',
      left: { level: null, total: 20, refusals: 9, seconds: 1700 },
      finished: false,
    });
    const rec = readRecord(w);
    expect(rec.refusals).toBe(1);
    expect(rec.attempts).toBe(0);
    expect(rec.reasonCodes.unknown_level).toBe(1);
    expect(rec.state).toBe('running');
  });

  it('level_budget_spent: refusal charged, left.level 0, Hunt not finished', async () => {
    const w = await liveWorld({ mutate: (r) => spend(r, L02, 4) });
    const res = await w.submit(args());
    const body = expectRefused(w, res, 'level_budget_spent');
    expect(body).toEqual({
      outcome: 'refused',
      reasonCode: 'level_budget_spent',
      reason: 'The 4 attempts for this level are used.',
      left: { level: 0, total: 16, refusals: 9, seconds: 1700 },
      finished: false,
    });
    const rec = readRecord(w);
    expect(rec.refusals).toBe(1);
    expect(rec.attempts).toBe(4);
    expect(rec.levels[L02].attempts).toBe(4);
    expect(rec.reasonCodes.level_budget_spent).toBe(1);
    expect(rec.state).toBe('running');
  });

  it('total_budget_spent: charges nothing, finishes the Hunt with finished and summary', async () => {
    const levels = ['lvl-a', 'lvl-b', 'lvl-c', 'lvl-d', 'lvl-e', L02];
    const w = await liveWorld({
      levels,
      mutate: (r) => ['lvl-a', 'lvl-b', 'lvl-c', 'lvl-d', 'lvl-e'].reduce((acc, id) => spend(acc, id, 4), r),
    });
    const res = await w.submit(args());
    const body = expectRefused(w, res, 'total_budget_spent');
    expect(body.reason).toBe('The 20 attempts are used. The hunt is over.');
    expect(body.finished).toBe(true);
    expect(body.summary).toEqual({
      attempts: 20, confirmed: 0, rejected: 20, error: 0, duplicate: 0, notRecorded: 0, seconds: 100, refusals: 0, findingsKey: 'ok',
    });
    const rec = readRecord(w);
    expect(rec.state).toBe('complete');
    expect(rec.attempts).toBe(20);
    expect(rec.refusals).toBe(0);
    expect(rec.reasonCodes.total_budget_spent).toBe(1);
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.fs.has(LOCK)).toBe(false);
  });

  it('time_budget_spent at exactly 1800 s: charges nothing, finishes the Hunt', async () => {
    const w = await liveWorld({ afterReadySec: 1800 });
    const res = await w.submit(args());
    const body = expectRefused(w, res, 'time_budget_spent');
    expect(body.reason).toBe('The 1800 seconds are used. The hunt is over.');
    expect(body.finished).toBe(true);
    expect(body.summary).toEqual({
      attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0, seconds: 1800, refusals: 0, findingsKey: 'ok',
    });
    const rec = readRecord(w);
    expect(rec.state).toBe('complete');
    expect(rec.refusals).toBe(0);
    expect(rec.attempts).toBe(0);
    expect(rec.reasonCodes.time_budget_spent).toBe(1);
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.fs.has(LOCK)).toBe(false);
  });

  it('one second before the Time_Budget ends, the call is still an Attempt', async () => {
    const w = await liveWorld({ afterReadySec: 1799, plays: { [L02]: aPlay() }, check: { [L02]: checkOk({ outcome: 'rejected', reasonCode: 'not_cheaper' }) } });
    const res = await w.submit(args());
    expect(res.exit).toBe(0);
    expect(/** @type {any} */ (res.body).left.seconds).toBe(1);
  });

  it('call_busy: a fresh call lock is held, exit 3, the printed body, charged to nothing', async () => {
    const w = await liveWorld();
    const held = JSON.stringify({ pid: 1, token: 'other-call', createdAt: new Date(w.clock.nowMs()).toISOString() });
    w.fs.seedFile(CALL_LOCK, held);
    const before = w.fs.snapshot();
    const res = await w.submit(args());
    expect(res.exit).toBe(3);
    expect(res.body).toEqual({ outcome: 'refused', reasonCode: 'call_busy', reason: 'Another hunt call is still running. Try again.' });
    expect(w.calls.spawn).toHaveLength(0);
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.fs.peek(CALL_LOCK)).toBe(held);
  });

  it('call_busy comes before every other check, also when no Hunt is active', async () => {
    const w = makeHuntWorld();
    w.fs.seedFile(CALL_LOCK, JSON.stringify({ pid: 1, token: 'other-call', createdAt: new Date(w.clock.nowMs()).toISOString() }));
    const res = await w.submit(args());
    expect(/** @type {any} */ (res.body).reasonCode).toBe('call_busy');
  });
});

describe('Hunt_Submit: the play and the verifier call', () => {
  it('writes the charge to the Hunt_Record before the Candidate_File and the play, then the outcome after the check', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    const events = instrument(w);
    await w.submit(args());
    expect(events.indexOf('record:1/0')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('record:1/0')).toBeLessThan(events.indexOf('candidate'));
    expect(events.indexOf('candidate')).toBeLessThan(events.indexOf('play'));
    expect(events.indexOf('play')).toBeLessThan(events.indexOf('check'));
    expect(events.indexOf('check')).toBeLessThan(events.indexOf('record:1/1'));
  });

  it('the charge is already on disk when the play starts', async () => {
    /** @type {any} */
    let seen = null;
    /** @type {ReturnType<typeof makeHuntWorld>|null} */
    let world = null;
    world = await liveWorld({
      plays: (_id, _file) => {
        seen = readRecord(/** @type {any} */ (world));
        return aPlay();
      },
      check: { [L02]: checkOk() },
    });
    await world.submit(args());
    expect(seen.attempts).toBe(1);
    expect(seen.levels[L02].attempts).toBe(1);
    expect(seen.levels[L02].confirmed).toBe(0);
  });

  it('runs node scripts/play.mjs <id> --actions-file <Candidate_File> in the Hunt_Checkout without a shell, limit 30000 ms', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    await w.submit(args());
    expect(w.calls.spawn).toHaveLength(1);
    const call = w.calls.spawn[0];
    expect(call.command).toBe('node');
    expect(call.args).toEqual(['scripts/play.mjs', L02, '--actions-file', candidatePath(1)]);
    expect(call.cwd).toBe(HUNT_CHECKOUT);
    expect(call.shell).toBe(false);
    expect(call.timeoutMs).toBe(30000);
    expect(w.calls.play).toHaveLength(1);
    expect(w.calls.play[0].file).toBe(candidatePath(1));
  });

  it('limits the play to the time left when less than 30 s remain: min(30000, time left)', async () => {
    const w = await liveWorld({ afterReadySec: 1790, plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    await w.submit(args());
    expect(w.calls.spawn[0].timeoutMs).toBe(10000);
  });

  it('writes the Candidate_File before the play, with content that matches the parse, UTF-8 without a BOM', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    await w.submit(args(['N', 'edit:B14=%3D1%2B1', 'wait', 'undo', 'E']));
    const content = /** @type {string} */ (w.calls.play[0].content);
    expect(content).toBeDefined();
    expect(content.charCodeAt(0)).not.toBe(0xfeff);
    expect(JSON.parse(content)).toEqual({
      levelId: L02,
      claimedClass: 'cheaper_win',
      actions: [
        { kind: 'move', dir: 'N' },
        { kind: 'edit', address: 'B14', raw: '=1+1' },
        { kind: 'wait' },
        { kind: 'undo' },
        { kind: 'move', dir: 'E' },
      ],
    });
    expect(w.fs.peek(candidatePath(1))).toBe(content);
  });

  it('names the Candidate_File with the Attempt number padded to three digits', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk({ outcome: 'rejected', reasonCode: 'not_cheaper' }) } });
    await w.submit(args(['E'], L02, 'cheaper_win'));
    await w.submit(args(['W'], L02, 'free_win'));
    expect(w.fs.has(candidatePath(1, L02, 'cheaper_win'))).toBe(true);
    expect(w.fs.has(candidatePath(2, L02, 'free_win'))).toBe(true);
  });

  it('calls checkCandidate with exactly six arguments: level, stored solution, class, actions, exit code, play', async () => {
    const spy = spyCheck(checkOk());
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: spy.fn });
    await w.submit(args(['E', 'wait']));
    expect(spy.calls).toHaveLength(1);
    const call = spy.calls[0];
    expect(call).toHaveLength(6);
    expect(call[0]).toBe(L02);
    expect(call[1]).toEqual(SOLUTION_02);
    expect(call[2]).toBe('cheaper_win');
    expect(call[3]).toEqual([{ kind: 'move', dir: 'E' }, { kind: 'wait' }]);
    expect(call[4]).toBe(0);
    expect(call[5]).toEqual(JSON.parse(readFixture('02-the-chaser.play.json')));
  });

  it('passes the exit code of a play that exited non-zero, with its parsed output', async () => {
    const spy = spyCheck(checkOk({ outcome: 'error', reasonCode: 'play_failed', reason: 'x' }));
    const w = await liveWorld({ plays: { [L02]: procFail(2, 'bad input', readFixture('02-the-chaser.play.json')) }, check: spy.fn });
    await w.submit(args());
    expect(spy.calls[0][4]).toBe(2);
    expect(spy.calls[0][5]).toEqual(JSON.parse(readFixture('02-the-chaser.play.json')));
  });

  it('a killed (timed out) play passes a non-number exit code and undefined as play, even with JSON on stdout', async () => {
    const spy = spyCheck({ outcome: 'error', reasonCode: 'play_failed', reason: 'x' });
    const hung = { ...procHang(), stdout: readFixture('02-the-chaser.play.json') };
    const w = await liveWorld({ plays: { [L02]: hung }, check: spy.fn });
    await w.submit(args());
    expect(spy.calls).toHaveLength(1);
    expect(typeof spy.calls[0][4]).not.toBe('number');
    expect(spy.calls[0][5]).toBeUndefined();
  });

  it('a play that could not start passes a non-number exit code and undefined as play', async () => {
    const spy = spyCheck({ outcome: 'error', reasonCode: 'play_failed', reason: 'x' });
    const w = await liveWorld({ plays: { [L02]: procCannotStart() }, check: spy.fn });
    await w.submit(args());
    expect(typeof spy.calls[0][4]).not.toBe('number');
    expect(spy.calls[0][5]).toBeUndefined();
  });

  it('stdout that is not JSON gives undefined as play and keeps the exit code', async () => {
    const spy = spyCheck({ outcome: 'error', reasonCode: 'malformed_play_result', reason: 'x' });
    const w = await liveWorld({ plays: { [L02]: procOk('this is not json') }, check: spy.fn });
    await w.submit(args());
    expect(spy.calls[0][4]).toBe(0);
    expect(spy.calls[0][5]).toBeUndefined();
  });

  it('the C3-f candidate runs end to end', async () => {
    const spy = spyCheck(checkOk({ outcome: 'rejected', reasonCode: 'not_cheaper' }));
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: spy.fn });
    const res = await w.submit([
      '--level', L02, '--class', 'cheaper_win', '--actions',
      'N', 'edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29', 'E',
    ]);
    expect(res.exit).toBe(0);
    expect(/** @type {any} */ (res.body).outcome).toBe('rejected');
    const expected = [
      { kind: 'move', dir: 'N' },
      { kind: 'edit', address: 'B14', raw: '=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")' },
      { kind: 'move', dir: 'E' },
    ];
    expect(JSON.parse(/** @type {string} */ (w.calls.play[0].content)).actions).toEqual(expected);
    expect(spy.calls[0][3]).toEqual(expected);
  });
});

describe('Hunt_Submit: a stored solution that cannot be used', () => {
  it.each([
    ['missing', undefined, 'no_solution_file'],
    ['not JSON', '{bad', 'solution_unreadable'],
  ])('a %s stored solution gives error %s, starts no play and does not call checkCandidate', async (_name, content, code) => {
    const spy = spyCheck(checkOk());
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: spy.fn });
    const file = `${HUNT_CHECKOUT}\\tests\\solutions\\${L02}.json`;
    if (content === undefined) await w.fs.rm(file);
    else w.fs.seedFile(file, content);
    const res = await w.submit(args());
    expect(res.exit).toBe(0);
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('error');
    expect(body.reasonCode).toBe(code);
    expect(typeof body.reason).toBe('string');
    expect(body.reason.length).toBeGreaterThan(0);
    expect(body).toMatchObject({ levelId: L02, class: 'cheaper_win', attempt: 1, finished: false });
    expect(body.left).toEqual({ level: 3, total: 19, refusals: 10, seconds: 1700 });
    expect(spy.calls).toHaveLength(0);
    expect(w.calls.spawn).toHaveLength(0);
    const rec = readRecord(w);
    expect(rec.attempts).toBe(1);
    expect(rec.levels[L02]).toMatchObject({ attempts: 1, error: 1 });
    expect(rec.reasonCodes[code]).toBe(1);
  });
});

describe('Hunt_Submit: failures after the charge or in the writes', () => {
  it('an unwritable Hunt_Record gives exit 4 hunt_record_unwritable, with no process and no Candidate_File', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    failWrites(w, /[\\/]hunts[\\/]\.hunt-.*\.tmp$/);
    const res = await w.submit(args());
    expect(res.exit).toBe(4);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('hunt_record_unwritable');
    expect(w.calls.spawn).toHaveLength(0);
    expect(candidateFiles(w)).toEqual([]);
    expect(readRecord(w).attempts).toBe(0);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it('an unwritable Hunt_Record also gives exit 4 for a refusal that is charged', async () => {
    const w = await liveWorld();
    failWrites(w, /[\\/]hunts[\\/]\.hunt-.*\.tmp$/);
    const res = await w.submit([]);
    expect(res.exit).toBe(4);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('hunt_record_unwritable');
    expect(readRecord(w).refusals).toBe(0);
  });

  it('an unwritable Candidate_File gives exit 4 candidate_unwritable and the Attempt stays charged', async () => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    failWrites(w, /[\\/]candidates[\\/]/);
    const res = await w.submit(args());
    expect(res.exit).toBe(4);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('candidate_unwritable');
    expect(w.calls.spawn).toHaveLength(0);
    const rec = readRecord(w);
    expect(rec.attempts).toBe(1);
    expect(rec.levels[L02].attempts).toBe(1);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it('a missing active.json is no_active_hunt, exit 3, nothing written, call lock released', async () => {
    const w = makeHuntWorld({ check: { [L02]: checkOk() } });
    w.fs.seedDir(HUNTS);
    const before = w.fs.snapshot();
    const res = await w.submit(args());
    expect(res.exit).toBe(3);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('no_active_hunt');
    expect(w.fs.snapshot()).toEqual(before);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it.each([ACTIVE, LOCK])('an EACCES while reading %s: exit 4 hunt_internal_error, nothing charged, call lock released', async (target) => {
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: { [L02]: checkOk() } });
    const before = w.fs.snapshot();
    const real = w.deps.fs;
    w.deps.fs = {
      ...real,
      async readFile(p, ...rest) {
        if (p === target) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return /** @type {any} */ (real.readFile)(p, ...rest);
      },
    };
    const res = await w.submit(args());
    expect(res.exit).toBe(4);
    expect(res.body).toEqual({ outcome: 'error', reasonCode: 'hunt_internal_error', reason: expect.any(String) });
    expect(w.fs.snapshot()).toEqual(before);
    expect(readRecord(w).attempts).toBe(0);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
    expect(w.calls.spawn).toHaveLength(0);
  });

  it.each([
    ['the verifier', 'check'],
    ['the play process', 'play'],
  ])('an unexpected throw in %s counts the Attempt as error hunt_internal_error, releases the call lock and rethrows', async (_name, where) => {
    const boom = () => {
      throw new Error('boom');
    };
    const w = await liveWorld(where === 'check' ? { plays: { [L02]: aPlay() }, check: boom } : { plays: boom, check: { [L02]: checkOk() } });
    await expect(w.submit(args())).rejects.toThrow('boom');
    const rec = readRecord(w);
    expect(rec.attempts).toBe(1);
    expect(rec.levels[L02]).toMatchObject({ attempts: 1, error: 1, confirmed: 0 });
    expect(rec.reasonCodes.hunt_internal_error).toBe(1);
    expect(w.fs.has(CALL_LOCK)).toBe(false);
    expect(readConfig(w).playtesterResults).toBeUndefined();
  });
});

describe('Hunt_Submit with the real checkCandidate over the fixture plays', () => {
  /**
   * @param {string} id
   * @param {string} cls
   * @param {string} playFile
   * @param {string} actionsFile
   * @param {string} stdout
   */
  async function runReal(id, cls, playFile, actionsFile, stdout = readFixture(playFile)) {
    const parsed = JSON.parse(readFixture(actionsFile));
    const actions = Array.isArray(parsed) ? parsed : parsed.actions;
    const tokens = /** @type {string[]} */ (printActions(actions));
    const w = await liveWorld({ plays: { [id]: procOk(stdout) }, check: checkCandidate });
    const res = await w.submit(args(tokens, id, cls));
    const stored = JSON.parse(readFixture(`solutions/${id}.json`));
    const expected = /** @type {any} */ (checkCandidate(id, stored, cls, actions, 0, JSON.parse(stdout)));
    return { w, res, expected, body: /** @type {any} */ (res.body) };
  }

  it.each([
    ['the 01 stored solution claimed as cheaper_win', '01-the-corridor', 'cheaper_win', '01-the-corridor.play.json', 'actions/01-the-corridor.json'],
    ['the 02 stored solution claimed as cheaper_win', L02, 'cheaper_win', '02-the-chaser.play.json', 'actions/02-the-chaser.json'],
    ['the cut 02 solution claimed as cheaper_win', L02, 'cheaper_win', '02-the-chaser.truncated.play.json', 'actions/02-the-chaser.truncated.json'],
  ])('%s is rejected by the verifier and no Finding is written', async (_name, id, cls, playFile, actionsFile) => {
    const { w, res, expected, body } = await runReal(id, cls, playFile, actionsFile);
    expect(expected.outcome).toBe('rejected');
    expect(res.exit).toBe(0);
    expect(body.outcome).toBe('rejected');
    expect(body.reasonCode).toBe(expected.reasonCode);
    expect(body.reason).toBe(expected.reason);
    expect(body.won).toBe(expected.won);
    expect(body.inkSpent).toBe(expected.inkSpent);
    expect(readConfig(w).playtesterResults).toBeUndefined();
  });

  it('a free_win over a synthesized play is confirmed and its Finding holds the measured result', async () => {
    const acts = [{ kind: 'wait' }, { kind: 'wait' }, { kind: 'wait' }, { kind: 'wait' }];
    const n = acts.length;
    const steps = acts.map((_a, i) => ({
      index: i, action: { kind: 'wait' }, accepted: true, damage: [], hero: 'B6', hp: 3, ink: i === n - 1 ? 0 : 1, turn: i + 1, status: i === n - 1 ? 'won' : 'playing',
    }));
    const play = {
      levelId: L02,
      start: { hero: 'B6', hp: 3, ink: 1, turn: 0, status: 'playing', monsters: [] },
      steps,
      final: { hero: 'B6', hp: 3, ink: 0, turn: n, status: 'won', monsters: [] },
    };
    const w = await liveWorld({ plays: { [L02]: procOk(JSON.stringify(play)) }, check: checkCandidate });
    const res = await w.submit(args(['wait', 'wait', 'wait', 'wait'], L02, 'free_win'));
    const body = /** @type {any} */ (res.body);
    expect(body.outcome).toBe('confirmed');
    expect(body.reasonCode).toBe('class_reproduced');
    expect(body.findingId).toBe(`${HUNT_ID}-001`);
    expect(body.class).toBe('free_win');
    expect(body.play).toEqual({ steps: 4, finalStatus: 'won', finalHp: 3, firstRefused: null, firstStatusChange: { step: 3, status: 'won' } });
    const item = readConfig(w).playtesterResults.findings.items[0];
    expect(item.class).toBe('free_win');
    expect(item.actions).toEqual(['wait', 'wait', 'wait', 'wait']);
    expect(item.result).toEqual({ won: true, inkSpent: 1, minimalInk: 1, editCount: 0, newEditAddresses: [], reasonCode: 'class_reproduced' });
  });
});

// Feature: exploit-hunt, Property 4: Findings change only for a confirmed Candidate
describe('Property 4: Findings change only for a confirmed Candidate', () => {
  /** Steps seen over the whole run, by kind. */
  const seen = { confirmed: 0, rejected: 0, error: 0, refused: 0, finishing: 0, other: 0 };
  /** @param {ReturnType<typeof makeHuntWorld>} w @returns {string} the findings value as stored text */
  const findingsText = (w) => JSON.stringify(readConfig(w).playtesterResults?.findings ?? null);

  /**
   * What a call that finished the Hunt may change in `findings` (design, "Finish" step 1): only the header
   * fields `updatedAt`, `commit`, `huntId` and `counts`, plus the items added by retrying `pendingFindings`.
   * @param {ReturnType<typeof makeHuntWorld>} w
   * @param {{findingsBefore: any, recordBefore: any, callMs: number}} before state captured before the call
   */
  function expectFinishHeaderOnly(w, { findingsBefore, recordBefore, callMs }) {
    const after = readConfig(w).playtesterResults?.findings;
    const recordAfter = readRecord(w);
    expect(after).toBeDefined();
    expect(after.schemaVersion).toBe(1);
    if (findingsBefore) expect(findingsBefore.schemaVersion).toBe(1);
    expect(after.updatedAt).toBe(new Date(callMs).toISOString());
    expect(after.commit).toBe(recordBefore.commit);
    expect(after.huntId).toBe(recordBefore.huntId);
    expect(after.counts).toEqual(countsOf(recordAfter));
    expect(Object.keys(after).sort()).toEqual(['commit', 'counts', 'huntId', 'items', 'schemaVersion', 'updatedAt']);
    const itemsBefore = findingsBefore?.items ?? [];
    const pending = Array.isArray(recordBefore.pendingFindings) ? recordBefore.pendingFindings : [];
    if (pending.length === 0) {
      expect(JSON.stringify(after.items)).toBe(JSON.stringify(itemsBefore));
    } else {
      const ids = new Set([...itemsBefore, ...pending].map((/** @type {any} */ f) => f.id));
      expect(new Set(after.items.map((/** @type {any} */ f) => f.id))).toEqual(ids);
      for (const f of itemsBefore) expect(JSON.stringify(after.items.find((/** @type {any} */ i) => i.id === f.id))).toBe(JSON.stringify(f));
    }
  }

  const property = () =>
      fc.asyncProperty(arbSubmitScript, fc.array(arbCheckResult, { minLength: 30, maxLength: 30 }), async (script, answers) => {
        let step = 0;
        let called = false;
        /** @type {Map<number, string>} attempt number to the outcome the stub gave it */
        const gave = new Map();
        // A total map: confirmed and rejected answers take the level and class of the call being checked.
        const check = (/** @type {any[]} */ ...a) => {
          called = true;
          const ans = answers[step];
          return ans.outcome === 'error' ? ans : { ...ans, levelId: a[0], claimedClass: a[2] };
        };
        /** @type {Record<string, any>} */
        const plays = {};
        for (const id of LEVEL_POOL) plays[id] = aPlay();
        const w = await liveWorld({ plays, check, levels: LEVEL_POOL });
        // Every level of the Hunt gets a stored solution: a copy of the 01 fixture with its levelId set.
        const base = JSON.parse(/** @type {string} */ (w.fs.peek(`${HUNT_CHECKOUT}\\tests\\solutions\\01-the-corridor.json`)));
        for (const id of LEVEL_POOL) w.fs.seedFile(`${HUNT_CHECKOUT}\\tests\\solutions\\${id}.json`, JSON.stringify({ ...base, levelId: id }));
        for (; step < script.length; step += 1) {
          called = false;
          const before = findingsText(w);
          const findingsBefore = readConfig(w).playtesterResults?.findings;
          const recordBefore = readRecord(w);
          w.clock.advance(script[step].jumpMs);
          const callMs = w.clock.nowMs();
          const res = await w.submit(/** @type {string[]} */ (script[step].argv));
          const after = findingsText(w);
          const body = /** @type {any} */ (res.body);
          const refused = res.exit === 3 || body?.refused !== undefined || typeof body?.attempt !== 'number';
          if (refused) {
            seen.refused += 1;
            expect(called).toBe(false);
            if (body?.finished === true && recordBefore.state === 'running') {
              seen.finishing += 1;
              expectFinishHeaderOnly(w, { findingsBefore, recordBefore, callMs });
            } else {
              expect(after).toBe(before);
            }
            continue;
          }
          gave.set(body.attempt, called ? answers[step].outcome : 'none');
          if (body.outcome === 'confirmed') seen.confirmed += 1;
          else if (body.outcome === 'rejected') seen.rejected += 1;
          else if (body.outcome === 'error') seen.error += 1;
          else seen.other += 1;
          if (body.outcome !== 'confirmed') expect(after).toBe(before);
          else expect(called && answers[step].outcome === 'confirmed').toBe(true);
        }
        const items = readConfig(w).playtesterResults?.findings?.items ?? [];
        for (const f of items) {
          const n = Number(String(f.id).slice(HUNT_ID.length + 1));
          expect(f.id).toBe(`${HUNT_ID}-${String(n).padStart(3, '0')}`);
          expect(gave.get(n)).toBe('confirmed');
        }
      });

  it('a Finding exists only for a confirmed stub answer; rejected, error and non-finishing refused calls leave findings byte for byte unchanged; a finishing refusal changes only the Finish header', async () => {
    await fc.assert(property(), { numRuns: 150 });
    expect(seen.confirmed).toBeGreaterThanOrEqual(20);
    expect(seen.rejected + seen.error + seen.refused).toBeGreaterThan(0);
  });

  // The case fast-check found with seed 648562001 (run 126): a time_budget_spent refusal that finished the Hunt.
  it('replays run 126 of seed 648562001 (a finishing refusal refreshes the header)', async () => {
    const finishingBefore = seen.finishing;
    await fc.assert(property(), { seed: 648562001, path: '126', endOnFailure: true });
    expect(seen.finishing).toBeGreaterThan(finishingBefore);
  });

  it('a time_budget_spent refusal finishes the Hunt: header refreshed, items and schemaVersion unchanged', async () => {
    const found = { ...checkOk(), levelId: L02, claimedClass: 'cheaper_win' };
    const w = await liveWorld({ plays: { [L02]: aPlay() }, check: () => found, solutions: [L02], levels: LEVELS });
    const first = await w.submit(args());
    expect(/** @type {any} */ (first.body).outcome).toBe('confirmed');
    const findingsBefore = readConfig(w).playtesterResults.findings;
    expect(findingsBefore.items).toHaveLength(1);
    const recordBefore = readRecord(w);
    w.clock.advance(READY_MS + 1800 * 1000 + 1000 - w.clock.nowMs());
    const callMs = w.clock.nowMs();
    const res = await w.submit(args());
    const body = /** @type {any} */ (res.body);
    expect(res.exit).toBe(3);
    expect(body.reasonCode).toBe('time_budget_spent');
    expect(body.finished).toBe(true);
    const after = readConfig(w).playtesterResults.findings;
    expect(after.updatedAt).toBe(new Date(callMs).toISOString());
    expect(after.updatedAt).not.toBe(findingsBefore.updatedAt);
    expectFinishHeaderOnly(w, { findingsBefore, recordBefore, callMs });
    expect(JSON.stringify(after.items)).toBe(JSON.stringify(findingsBefore.items));
    expect(readRecord(w).state).toBe('complete');
  });
});

// Feature: exploit-hunt, Property 5: Determinism
describe('Property 5: Determinism', () => {
  const REAL_LEVELS = ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt'];
  const PLAY_FILES = {
    '01-the-corridor': ['01-the-corridor.play.json', '01-the-corridor.undo-first.play.json', '01-the-corridor.candidate-file.play.json'],
    '02-the-chaser': ['02-the-chaser.play.json', '02-the-chaser.truncated.play.json'],
    '03-the-locked-crypt': ['03-the-locked-crypt.play.json'],
  };
  /** Outcomes seen over the whole run. */
  const seen = { confirmed: 0, rejected: 0, error: 0, refused: 0, other: 0 };

  /**
   * A play-shaped JSON that mirrors the candidate: one accepted step per action, ending in a win.
   * @param {string} id @param {any[]} actions @param {number} startInk @param {number} spent @param {string} finalStatus
   */
  function mirrorPlay(id, actions, startInk, spent, finalStatus) {
    const n = actions.length;
    const steps = actions.map((a, i) => ({
      index: i, action: a, accepted: true, damage: [], hero: 'B6', hp: 3,
      ink: i === 0 ? startInk - spent : startInk - spent, turn: i + 1, status: i === n - 1 ? finalStatus : 'playing',
    }));
    return {
      levelId: id,
      start: { hero: 'B6', hp: 3, ink: startInk, turn: 0, status: 'playing', monsters: [] },
      steps,
      final: { hero: 'B6', hp: 3, ink: startInk - spent, turn: n, status: finalStatus, monsters: [] },
    };
  }

  /** @type {fc.Arbitrary<(id: string, actions: any[]) => import('../scripts/replay/types.mjs').ProcResult>} */
  const arbPlayMaker = fc.oneof(
    { weight: 3, arbitrary: fc.nat(2).map((k) => (/** @type {string} */ id) => procOk(readFixture(/** @type {any} */ (PLAY_FILES)[id][k % /** @type {any} */ (PLAY_FILES)[id].length]))) },
    {
      weight: 6,
      arbitrary: fc
        .tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 }), fc.constantFrom('won', 'won', 'lost', 'playing'))
        .map(([startInk, spentRaw, status]) => (/** @type {string} */ id, /** @type {any[]} */ actions) =>
          procOk(JSON.stringify(mirrorPlay(id, actions, startInk, Math.min(startInk, spentRaw), status)))),
    },
    { weight: 1, arbitrary: fc.string().map((s) => () => procOk(s)) },
    { weight: 1, arbitrary: fc.constantFrom(procFail(2, 'bad input'), procFail(1), procHang(), procCannotStart()).map((p) => () => p) },
  );

  it('two runs from identical worlds and the same clock give equal Outcomes, bodies, records and config', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...REAL_LEVELS),
        fc.constantFrom('cheaper_win', 'free_win', 'unexpected_route'),
        arbActionList,
        arbPlayMaker,
        async (id, cls, actions, makePlay) => {
          const tokens = /** @type {string[]} */ (printActions(actions));
          const play = makePlay(id, actions);
          const run = async () => {
            const w = await liveWorld({ plays: { [id]: play }, check: checkCandidate, levels: REAL_LEVELS });
            for (const lv of REAL_LEVELS) w.fs.seedFile(`${HUNT_CHECKOUT}\\tests\\solutions\\${lv}.json`, readFixture(`solutions/${lv}.json`));
            const res = await w.submit(args(tokens, id, cls));
            return {
              exit: res.exit,
              body: res.body,
              record: w.fs.peek(RECORD_PATH),
              config: w.fs.peek(CONFIG_PATH),
              files: candidateFiles(w).map((p) => [p, w.fs.peek(p)]),
            };
          };
          const a = await run();
          const b = await run();
          expect(b.exit).toBe(a.exit);
          expect(b.body).toEqual(a.body);
          expect(b.record).toBe(a.record);
          expect(b.config).toBe(a.config);
          expect(b.files).toEqual(a.files);
          const outcome = /** @type {any} */ (a.body)?.outcome;
          if (outcome === 'confirmed') seen.confirmed += 1;
          else if (outcome === 'rejected') seen.rejected += 1;
          else if (outcome === 'error') seen.error += 1;
          else if (a.exit === 3) seen.refused += 1;
          else seen.other += 1;
        },
      ),
      { numRuns: 150 },
    );
    const kinds = [seen.confirmed, seen.rejected, seen.error].filter((n) => n > 0).length;
    expect(kinds).toBeGreaterThanOrEqual(2);
  });
});

// Feature: exploit-hunt, Property 7: Budgets bound every Hunt
describe('Property 7: Budgets bound every Hunt', () => {
  const DEADLINE_MS = READY_MS + 1800 * 1000;
  /** Samples (and steps) that reached each cap, over the whole run. */
  const reached = { samples: 0, attempts20: 0, refusals10: 0, level4: 0, timeCap: 0, calls30: 0, levelRefusal: 0 };

  /** A stub check that answers rejected for whatever level and class it is given. */
  const rejectedCheck = (/** @type {any[]} */ ...a) =>
    checkOk({ outcome: 'rejected', reasonCode: 'not_cheaper', levelId: a[0], claimedClass: a[2] });

  /** A live Hunt over every level of the pool, stored solutions seeded, canned plays, the rejecting stub. */
  async function budgetWorld() {
    /** @type {Record<string, any>} */
    const plays = {};
    for (const id of LEVEL_POOL) plays[id] = aPlay();
    const w = await liveWorld({ plays, check: rejectedCheck, levels: LEVEL_POOL });
    const base = JSON.parse(/** @type {string} */ (w.fs.peek(`${HUNT_CHECKOUT}\\tests\\solutions\\01-the-corridor.json`)));
    for (const id of LEVEL_POOL) w.fs.seedFile(`${HUNT_CHECKOUT}\\tests\\solutions\\${id}.json`, JSON.stringify({ ...base, levelId: id }));
    // Record the fake clock at every play process (a spawn whose args include --actions-file).
    /** @type {number[]} */
    const playStarts = [];
    const realSpawn = w.deps.spawn;
    w.deps.spawn = Object.assign(
      async (/** @type {any} */ spec) => {
        if (spec.args.includes('--actions-file')) playStarts.push(w.clock.nowMs());
        return realSpawn(spec);
      },
      { calls: /** @type {any} */ (realSpawn).calls },
    );
    return { w, playStarts };
  }

  /**
   * The bounds of the design, checked from the Hunt_Record, the play log and the Candidate_Files.
   * @param {ReturnType<typeof makeHuntWorld>} w @param {number[]} playStarts @param {number} chargingCalls
   * @returns {any} the Hunt_Record read
   */
  function expectBounds(w, playStarts, chargingCalls) {
    const rec = readRecord(w);
    expect(rec.attempts).toBeLessThanOrEqual(20);
    expect(rec.refusals).toBeLessThanOrEqual(10);
    for (const level of Object.values(rec.levels)) expect(/** @type {any} */ (level).attempts).toBeLessThanOrEqual(4);
    expect(playStarts.length).toBeLessThanOrEqual(rec.attempts);
    expect(playStarts.length).toBeLessThanOrEqual(20);
    const files = candidateFiles(w).length;
    expect(files).toBeLessThanOrEqual(rec.attempts);
    expect(files).toBeLessThanOrEqual(20);
    for (const t of playStarts) expect(t).toBeLessThan(DEADLINE_MS);
    expect(chargingCalls).toBeLessThanOrEqual(30);
    return rec;
  }

  /** Runs one call and says whether it changed the record by a charge. */
  async function callAndCount(/** @type {ReturnType<typeof makeHuntWorld>} */ w, /** @type {string[]} */ argv) {
    const before = readRecord(w);
    const res = await w.submit(argv);
    const after = readRecord(w);
    return { res, charged: after.attempts > before.attempts || after.refusals > before.refusals };
  }

  /**
   * Long scripts (22 to 45 steps) of mostly well-formed calls over 5 or 6 of the Hunt's levels, so the same level
   * repeats (4-per-level) and the 20-Attempt cap can be reached. Clock jumps are 0 to 30 s. About one call in
   * seven is an unknown level or a malformed argument list, so refusals still occur. Built, not filtered.
   */
  const arbLongValidScript = fc.shuffledSubarray(LEVEL_POOL, { minLength: 5, maxLength: 6 }).chain((levels) =>
    fc
      .array(
        fc.record({
          jumpMs: fc.integer({ min: 0, max: 30000 }),
          step: fc.oneof(
            { weight: 8, arbitrary: fc.tuple(fc.constant('good'), fc.constantFrom(...CLASS_NAMES), arbActionList) },
            { weight: 1, arbitrary: fc.tuple(fc.constantFrom('99-not-in-hunt', 'zz-other'), fc.constantFrom(...CLASS_NAMES), arbActionList) },
            { weight: 1, arbitrary: arbArgv.map((argv) => /** @type {[string, unknown[]]} */ (['malformed', argv])) },
          ),
        }),
        { minLength: 24, maxLength: 45 },
      )
      .map((steps) => {
        // Good calls take the Hunt's levels in turn, so each level is hit about equally often (4 each = 20 Attempts).
        let good = 0;
        return steps.map(({ jumpMs, step }) => {
          const [first, second, third] = /** @type {any[]} */ (step);
          if (first === 'malformed') return { jumpMs, argv: /** @type {unknown[]} */ (second) };
          const level = first === 'good' ? levels[good++ % levels.length] : first;
          return { jumpMs, argv: ['--level', level, '--class', second, '--actions', ...canonicalTokens(third)] };
        });
      }),
  );

  const arbBudgetScript = fc.oneof({ weight: 1, arbitrary: arbSubmitScript }, { weight: 1, arbitrary: arbLongValidScript });

  const property = () =>
    fc.asyncProperty(arbBudgetScript, async (script) => {
      const { w, playStarts } = await budgetWorld();
      let charging = 0;
      let sawLevelRefusal = false;
      for (const step of script) {
        w.clock.advance(step.jumpMs);
        const { res, charged } = await callAndCount(w, /** @type {string[]} */ (step.argv));
        if (charged) charging += 1;
        if (/** @type {any} */ (res.body)?.reasonCode === 'level_budget_spent') sawLevelRefusal = true;
        expectBounds(w, playStarts, charging);
      }
      const rec = readRecord(w);
      if (sawLevelRefusal) reached.levelRefusal += 1;
      reached.samples += 1;
      if (rec.attempts >= 20) reached.attempts20 += 1;
      if (rec.refusals >= 10) reached.refusals10 += 1;
      if (Object.values(rec.levels).some((l) => /** @type {any} */ (l).attempts >= 4)) reached.level4 += 1;
      if (w.clock.nowMs() >= DEADLINE_MS) reached.timeCap += 1;
      if (charging >= 30) reached.calls30 += 1;
    });

  it('attempts, per-level attempts, refusals, play processes, Candidate_Files, the time cap and charging calls stay within budget', async () => {
    await fc.assert(property(), { numRuns: 150 });
    // The inputs reach the caps often enough for the bounds above to mean something.
    expect(reached.attempts20 / reached.samples).toBeGreaterThanOrEqual(0.2);
    expect(reached.level4 / reached.samples).toBeGreaterThanOrEqual(0.2);
    expect(reached.levelRefusal).toBeGreaterThan(0);
  });

  it('example: 20 Attempts across five levels, then total_budget_spent; nothing more is charged', async () => {
    const { w, playStarts } = await budgetWorld();
    let charging = 0;
    for (let i = 0; i < 20; i += 1) {
      const { res, charged } = await callAndCount(w, args(['E'], LEVEL_POOL[Math.floor(i / 4)]));
      expect(res.exit).toBe(0);
      if (charged) charging += 1;
    }
    expect(readRecord(w).attempts).toBe(20);
    const { res, charged } = await callAndCount(w, args(['E'], LEVEL_POOL[5]));
    expect(/** @type {any} */ (res.body).reasonCode).toBe('total_budget_spent');
    expect(charged).toBe(false);
    const rec = expectBounds(w, playStarts, charging);
    expect(rec.attempts).toBe(20);
    expect(playStarts).toHaveLength(20);
    expect(candidateFiles(w)).toHaveLength(20);
  });

  it('example: the fifth Attempt on one level is refused with level_budget_spent and charged as a Refusal', async () => {
    const { w, playStarts } = await budgetWorld();
    let charging = 0;
    for (let i = 0; i < 4; i += 1) {
      const { charged } = await callAndCount(w, args(['E'], L02));
      if (charged) charging += 1;
    }
    const { res, charged } = await callAndCount(w, args(['E'], L02));
    if (charged) charging += 1;
    expect(/** @type {any} */ (res.body).reasonCode).toBe('level_budget_spent');
    const rec = expectBounds(w, playStarts, charging);
    expect(rec.levels[L02].attempts).toBe(4);
    expect(rec.attempts).toBe(4);
    expect(rec.refusals).toBe(1);
    expect(playStarts).toHaveLength(4);
  });

  it('example: ten Refusals, then refusal_budget_spent finishes the Hunt without a charge', async () => {
    const { w, playStarts } = await budgetWorld();
    let charging = 0;
    for (let i = 0; i < 10; i += 1) {
      const { res, charged } = await callAndCount(w, ['--bogus']);
      expect(res.exit).toBe(3);
      if (charged) charging += 1;
    }
    expect(readRecord(w).refusals).toBe(10);
    const { res, charged } = await callAndCount(w, ['--bogus']);
    expect(/** @type {any} */ (res.body).reasonCode).toBe('refusal_budget_spent');
    expect(charged).toBe(false);
    const rec = expectBounds(w, playStarts, charging);
    expect(rec.refusals).toBe(10);
    expect(rec.attempts).toBe(0);
    expect(playStarts).toHaveLength(0);
  });

  it('example: at readyAt + 1800 s no play process starts; the call is time_budget_spent and not charged', async () => {
    const { w, playStarts } = await budgetWorld();
    let charging = 0;
    const first = await callAndCount(w, args(['E'], L02));
    if (first.charged) charging += 1;
    w.clock.advance(DEADLINE_MS - w.clock.nowMs());
    const { res, charged } = await callAndCount(w, args(['E'], L02));
    expect(/** @type {any} */ (res.body).reasonCode).toBe('time_budget_spent');
    expect(charged).toBe(false);
    const rec = expectBounds(w, playStarts, charging);
    expect(rec.attempts).toBe(1);
    expect(playStarts).toHaveLength(1);
  });
});
