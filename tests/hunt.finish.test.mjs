// @ts-check
// Unit tests of scripts/hunt/finish.mjs (design: "publish.mjs, finish.mjs" and "Finish (finishHunt)";
// Requirements 9.6, 6.4, 6.5, 10.9, 11.5, 11.6). The module does not exist yet: these tests fail until task 13.2.
import { describe, expect, it } from 'vitest';
import { finishHunt } from '../scripts/hunt/finish.mjs';
import { readActive, readHuntRecord, writeActive, writeHuntRecord } from '../scripts/hunt/hunt-store.mjs';
import { chargeAttempt, chargeRefusal, newHuntRecord, readyRecord, recordOutcome } from '../scripts/hunt/hunt-record.mjs';
import { CONFIG_PATH, DATA_FOLDER, makeHuntWorld } from './helpers/hunt-world.mjs';

const HUNT_ID = 'hunt-20261108T110312Z';
const COMMIT = 'e1c61a35b3da027aada5d9ef4460efa4470488a4';
const LEVEL_A = '01-the-corridor';
const LEVEL_B = '02-the-chaser';
const TOKEN = '9f3c0a51d2b84e67a1c05be3f7d92a48';
const READY_AT = '2026-11-08T11:03:40.000Z';
const HUNTS = `${DATA_FOLDER}\\hunts`;
const LOCK = `${DATA_FOLDER}\\.hunt.lock`;
const ACTIVE = `${HUNTS}\\active.json`;
const RECORD_PATH = `${HUNTS}\\${HUNT_ID}.json`;

/** @param {string} s */
const slash = (s) => s.replace(/\\/g, '/');

/** One small Finding. @param {number} n @returns {any} */
function mk(n) {
  return {
    id: `${HUNT_ID}-${String(n).padStart(3, '0')}`,
    levelId: LEVEL_A,
    class: 'cheaper_win',
    commit: COMMIT,
    huntId: HUNT_ID,
    foundAt: new Date(Date.UTC(2026, 10, 8, 11, 5, n)).toISOString(),
    actions: ['move:N', ...Array.from({ length: n }, () => 'wait')],
    result: { won: true, inkSpent: 0, minimalInk: 2, editCount: 0, newEditAddresses: [], reasonCode: 'class_reproduced' },
  };
}

/**
 * A running, ready record with 7 charged Attempts (1 confirmed, 3 rejected, 1 error, 1 duplicate, 1 not recorded)
 * and 2 refusals.
 * @returns {any}
 */
function runningRecord() {
  let r = newHuntRecord({ huntId: HUNT_ID, startedAt: '2026-11-08T11:03:12.000Z', repoUrl: 'https://example.invalid/g', branch: 'main' });
  r = readyRecord(r, { readyAt: READY_AT, commit: COMMIT, levels: [LEVEL_A, LEVEL_B], levelsSkipped: 0 });
  /** @type {Array<[string, 'confirmed'|'rejected'|'error'|'duplicate'|'notRecorded']>} */
  const plan = [
    [LEVEL_A, 'confirmed'],
    [LEVEL_A, 'rejected'],
    [LEVEL_A, 'rejected'],
    [LEVEL_B, 'rejected'],
    [LEVEL_B, 'error'],
    [LEVEL_B, 'duplicate'],
    [LEVEL_B, 'notRecorded'],
  ];
  for (const [level, outcome] of plan) {
    r = chargeAttempt(r, level);
    r = recordOutcome(r, level, outcome, outcome === 'confirmed' ? 'class_reproduced' : 'not_won');
  }
  r = chargeRefusal(r, 'bad_arguments');
  r = chargeRefusal(r, 'unknown_level');
  return r;
}

/**
 * A world in the state of a live Hunt: the running record on disk, the pointer, the Hunt lock with the Hunt token.
 * @param {{lockToken?: string|null, config?: unknown|string, record?: any}} [o]
 */
async function liveWorld(o = {}) {
  const w = makeHuntWorld();
  w.fs.seedDir(HUNTS);
  const record = o.record ?? runningRecord();
  await writeHuntRecord(w.deps, record);
  await writeActive(w.deps, { schemaVersion: 1, huntId: HUNT_ID, token: TOKEN, readyAt: READY_AT });
  if (o.lockToken !== null) {
    w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: o.lockToken ?? TOKEN, createdAt: new Date(w.clock.nowMs()).toISOString() }));
  }
  if (typeof o.config === 'string') w.fs.seedFile(CONFIG_PATH, o.config);
  else w.seedConfig(o.config ?? {});
  // 912 seconds after ready
  w.clock.advance(Date.parse(READY_AT) + 912 * 1000 - w.clock.nowMs());
  return { w, record, hunt: { huntId: HUNT_ID, token: TOKEN, readyAtMs: Date.parse(READY_AT), record } };
}

/** @param {ReturnType<typeof makeHuntWorld>} w @returns {any} */
const readConfig = (w) => JSON.parse(/** @type {string} */ (w.fs.peek(CONFIG_PATH)));

describe('finishHunt: the four steps', () => {
  it('merges the header, writes the final record, removes the pointer and releases the lock, in this order', async () => {
    const { w, record, hunt } = await liveWorld();
    /** @type {string[]} */
    const log = [];
    const deps = { ...w.deps, fs: w.fs.withGate(async (label) => void log.push(slash(label))) };
    await finishHunt(deps, { hunt, record, state: 'complete' });

    const at = (/** @type {(l: string) => boolean} */ pred) => log.findIndex(pred);
    const configRename = at((l) => l.startsWith('rename ') && l.endsWith('/data/config.json'));
    const recordRename = at((l) => l.startsWith('rename ') && l.endsWith(`/hunts/${HUNT_ID}.json`));
    const activeRm = at((l) => l === `rm ${slash(ACTIVE)}`);
    const lockRm = at((l) => l === `rm ${slash(LOCK)}`);
    expect(configRename).toBeGreaterThanOrEqual(0);
    expect(recordRename).toBeGreaterThan(configRename);
    expect(activeRm).toBeGreaterThan(recordRename);
    expect(lockRm).toBeGreaterThan(activeRm);
  });

  it('leaves a complete record with finishedAt, no pointer and no Hunt lock', async () => {
    const { w, record, hunt } = await liveWorld();
    const res = await finishHunt(w.deps, { hunt, record, state: 'complete' });
    const finishedAt = new Date(w.clock.nowMs()).toISOString();

    expect(res.record.state).toBe('complete');
    expect(res.record.finishedAt).toBe(finishedAt);
    const onDisk = await readHuntRecord(w.deps, HUNT_ID);
    expect(onDisk).toEqual(res.record);
    expect(onDisk?.state).toBe('complete');
    expect(onDisk?.finishedAt).toBe(finishedAt);
    expect(onDisk?.findingsKey).toBe('ok');
    expect(await readActive(w.deps)).toBeNull();
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.fs.has(LOCK)).toBe(false);
  });

  it('refreshes the header of the Findings_Value in config.json with the final counts', async () => {
    const { w, record, hunt } = await liveWorld();
    await finishHunt(w.deps, { hunt, record, state: 'complete' });
    const findings = readConfig(w).playtesterResults.findings;
    expect(findings.huntId).toBe(HUNT_ID);
    expect(findings.counts).toEqual({ attempts: 7, confirmed: 1, rejected: 3, error: 1, duplicate: 1, notRecorded: 1 });
  });
});

describe('finishHunt: summary', () => {
  it('holds attempts, refusals, the five outcome counts, seconds and findingsKey', async () => {
    const { w, record, hunt } = await liveWorld();
    const res = await finishHunt(w.deps, { hunt, record, state: 'complete' });
    expect(res.summary).toEqual({
      attempts: 7,
      refusals: 2,
      confirmed: 1,
      rejected: 3,
      error: 1,
      duplicate: 1,
      notRecorded: 1,
      seconds: 912,
      findingsKey: 'ok',
    });
  });
});

describe('finishHunt: idempotence', () => {
  it('a second call on the final record changes nothing and returns the summary', async () => {
    const { w, record, hunt } = await liveWorld();
    const first = await finishHunt(w.deps, { hunt, record, state: 'complete' });

    // The Hunt lock and the pointer of a later Hunt must not be touched by the second call.
    w.fs.seedFile(LOCK, JSON.stringify({ pid: 4242, token: TOKEN, createdAt: new Date(w.clock.nowMs()).toISOString() }));
    await writeActive(w.deps, { schemaVersion: 1, huntId: HUNT_ID, token: TOKEN, readyAt: READY_AT });
    const configBefore = w.fs.peek(CONFIG_PATH);
    const recordBefore = w.fs.peek(RECORD_PATH);
    const lockBefore = w.fs.peek(LOCK);
    const activeBefore = w.fs.peek(ACTIVE);
    w.clock.advance(60_000);

    /** @type {string[]} */
    const log = [];
    const deps = { ...w.deps, fs: w.fs.withGate(async (label) => void log.push(label)) };
    const second = await finishHunt(deps, { hunt: { ...hunt, record: first.record }, record: first.record, state: 'complete' });

    expect(second.record).toEqual(first.record);
    expect(second.summary).toMatchObject({
      attempts: 7,
      refusals: 2,
      confirmed: 1,
      rejected: 3,
      error: 1,
      duplicate: 1,
      notRecorded: 1,
      findingsKey: 'ok',
    });
    expect(log.filter((l) => /^(writeFile|rename|rm) /.test(l))).toEqual([]);
    expect(w.fs.peek(CONFIG_PATH)).toBe(configBefore);
    expect(w.fs.peek(RECORD_PATH)).toBe(recordBefore);
    expect(w.fs.peek(LOCK)).toBe(lockBefore);
    expect(w.fs.peek(ACTIVE)).toBe(activeBefore);
  });

  it('a call on a record that is already failed or cut-short also changes nothing', async () => {
    for (const state of ['failed', 'cut-short']) {
      const { w, hunt } = await liveWorld({ record: { ...runningRecord(), state, finishedAt: null } });
      const record = { ...hunt.record };
      const recordBefore = w.fs.peek(RECORD_PATH);
      const configBefore = w.fs.peek(CONFIG_PATH);
      const res = await finishHunt(w.deps, { hunt, record, state: 'complete' });
      expect(res.record.state).toBe(state);
      expect(w.fs.peek(RECORD_PATH)).toBe(recordBefore);
      expect(w.fs.peek(CONFIG_PATH)).toBe(configBefore);
      expect(w.fs.has(LOCK)).toBe(true);
      expect(w.fs.has(ACTIVE)).toBe(true);
    }
  });
});

describe('finishHunt: a merge failure in step 1', () => {
  it('does not stop the finish and sets findingsKey', async () => {
    const { w, record, hunt } = await liveWorld({ config: '{bad' });
    const res = await finishHunt(w.deps, { hunt, record, state: 'complete' });

    expect(res.record.state).toBe('complete');
    expect(res.record.findingsKey).toBe('config_unreadable');
    expect(res.summary).toMatchObject({ findingsKey: 'config_unreadable', attempts: 7, seconds: 912 });
    const onDisk = await readHuntRecord(w.deps, HUNT_ID);
    expect(onDisk?.state).toBe('complete');
    expect(onDisk?.findingsKey).toBe('config_unreadable');
    expect(w.fs.peek(CONFIG_PATH)).toBe('{bad');
    expect(w.fs.has(ACTIVE)).toBe(false);
    expect(w.fs.has(LOCK)).toBe(false);
  });

  it('keeps the pending Findings in the final record when the merge fails', async () => {
    const pendingRecord = { ...runningRecord(), pendingFindings: [mk(1)] };
    const { w, hunt } = await liveWorld({ config: '{bad', record: pendingRecord });
    const res = await finishHunt(w.deps, { hunt, record: pendingRecord, state: 'complete' });
    expect(res.record.pendingFindings).toEqual([mk(1)]);
    expect((await readHuntRecord(w.deps, HUNT_ID))?.pendingFindings).toEqual([mk(1)]);
  });

  it('still finishes when the results lock is held by another writer (lock_timeout)', async () => {
    const { w, record, hunt } = await liveWorld();
    w.fs.seedFile(`${DATA_FOLDER}\\.results.lock`, JSON.stringify({ pid: 1, token: 'other', createdAt: new Date(w.clock.nowMs()).toISOString() }));
    const res = await finishHunt(w.deps, { hunt, record, state: 'complete' });
    expect(res.record.state).toBe('complete');
    expect(res.record.findingsKey).toBe('lock_timeout');
    expect(w.fs.has(LOCK)).toBe(false);
    expect(w.fs.has(ACTIVE)).toBe(false);
  });
});

describe('finishHunt: pendingFindings', () => {
  it('retries them in step 1 and clears them from the final record', async () => {
    const pendingRecord = { ...runningRecord(), pendingFindings: [mk(1), mk(2)], findingsKey: 'write_failed' };
    const { w, hunt } = await liveWorld({ record: pendingRecord });
    const res = await finishHunt(w.deps, { hunt, record: pendingRecord, state: 'complete' });

    expect(res.record.findingsKey).toBe('ok');
    expect(res.record.pendingFindings).toEqual([]);
    expect(res.summary).toMatchObject({ findingsKey: 'ok' });
    const onDisk = await readHuntRecord(w.deps, HUNT_ID);
    expect(onDisk?.pendingFindings).toEqual([]);
    const ids = readConfig(w).playtesterResults.findings.items.map((/** @type {any} */ i) => i.id);
    expect(ids.sort()).toEqual([mk(1).id, mk(2).id].sort());
  });
});

describe('finishHunt: the Hunt lock is released only with the Hunt token', () => {
  it('removes a lock that holds the Hunt token', async () => {
    const { w, record, hunt } = await liveWorld();
    expect(w.fs.has(LOCK)).toBe(true);
    await finishHunt(w.deps, { hunt, record, state: 'complete' });
    expect(w.fs.has(LOCK)).toBe(false);
  });

  it('does not remove a lock that holds another token, but finishes the rest', async () => {
    const { w, record, hunt } = await liveWorld({ lockToken: 'a-newer-hunt-token' });
    const lockBefore = w.fs.peek(LOCK);
    const res = await finishHunt(w.deps, { hunt, record, state: 'complete' });
    expect(w.fs.peek(LOCK)).toBe(lockBefore);
    expect(res.record.state).toBe('complete');
    expect((await readHuntRecord(w.deps, HUNT_ID))?.state).toBe('complete');
    expect(w.fs.has(ACTIVE)).toBe(false);
  });

  it('does not fail when there is no lock file', async () => {
    const { w, record, hunt } = await liveWorld({ lockToken: null });
    const res = await finishHunt(w.deps, { hunt, record, state: 'complete' });
    expect(res.record.state).toBe('complete');
    expect(w.fs.has(ACTIVE)).toBe(false);
  });
});
