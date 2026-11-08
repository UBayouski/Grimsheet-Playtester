// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { arbIndexEntry } from './replay.arbitraries.mjs';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  RESULT_FILE_PATTERN,
  runIdOf,
  insertEntry,
  markCutShort,
  loadOrRebuildIndex,
  writeResultFile,
  readResultFile,
  writeIndex,
  pruneResultFiles,
  startRun,
  finishRunInIndex,
} from '../scripts/replay/index-store.mjs';
import { newRunRecord, finalizeRecord, indexEntryOf } from '../scripts/replay/run-record.mjs';
import { makeFakeClock, makeMemFs, makeTokenSource } from './helpers/fake-fs.mjs';

const DATA = '/app/data';
const INDEX_PATH = `${DATA}/_index.json`;
const RUNS = `${DATA}/runs`;
const T0 = Date.UTC(2026, 10, 8, 11, 0, 0);

/** @param {number} n @returns {string} */
const iso = (n) => new Date(T0 + n * 60000).toISOString();

/**
 * @param {number} n counter
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
function entry(n, over = {}) {
  return { runId: runIdOf(n), counter: n, state: 'complete', startedAt: iso(n), finishedAt: iso(n + 1), commit: null, green: 1, amber: 0, red: 0, error: 0, ...over };
}

/**
 * @param {number} n counter
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
function record(n, over = {}) {
  const base = newRunRecord({ runId: runIdOf(n), counter: n, startedAt: iso(n), repoUrl: 'u', branch: 'b', previousLaunch: null });
  return { ...base, ...over };
}

function setup() {
  const clock = makeFakeClock(T0);
  const fs = makeMemFs({ clock });
  const deps = { fs, paths: { appFolder: '/app', dataFolder: DATA, localAppData: '/lad' }, token: makeTokenSource() };
  return { clock, fs, deps };
}

/** @param {any} index @returns {string} */
const indexText = (index) => `${JSON.stringify(index, null, 2)}\n`;

describe('runIdOf and RESULT_FILE_PATTERN', () => {
  it('pads to six digits and grows beyond', () => {
    expect(runIdOf(42)).toBe('run-000042');
    expect(runIdOf(1)).toBe('run-000001');
    expect(runIdOf(1234567)).toBe('run-1234567');
  });

  it('matches result file names and not temp file names', () => {
    expect(RESULT_FILE_PATTERN.test('run-000042.json')).toBe(true);
    expect(RESULT_FILE_PATTERN.test('run-1000000.json')).toBe(true);
    expect(RESULT_FILE_PATTERN.test('run-42.json')).toBe(false);
    expect(RESULT_FILE_PATTERN.test('.run-000042.json.00000000000000000000000000000001.tmp')).toBe(false);
    expect(RESULT_FILE_PATTERN.test('run-000042.json.tmp')).toBe(false);
    expect(RESULT_FILE_PATTERN.test('_index.json')).toBe(false);
  });
});

describe('insertEntry', () => {
  it('keeps the 30 highest counters, newest first, and reports the evicted entries', () => {
    let index = { schemaVersion: 1, lastCounter: 0, runs: /** @type {any[]} */ ([]) };
    /** @type {any[]} */
    let evictedAll = [];
    for (let n = 1; n <= 35; n += 1) {
      const r = insertEntry(/** @type {any} */ (index), entry(n));
      index = r.index;
      evictedAll = evictedAll.concat(r.evicted);
    }
    expect(index.runs).toHaveLength(30);
    expect(index.runs.map((e) => e.counter)).toEqual(Array.from({ length: 30 }, (_, i) => 35 - i));
    expect(evictedAll.map((e) => e.counter)).toEqual([1, 2, 3, 4, 5]);
    expect(index.lastCounter).toBe(35);
  });

  it('replaces an entry with the same runId (newer data wins) and does not change its input', () => {
    const index = /** @type {any} */ ({ schemaVersion: 1, lastCounter: 3, runs: [entry(3, { state: 'running', finishedAt: null }), entry(2)] });
    const before = structuredClone(index);
    const { index: next, evicted } = insertEntry(index, entry(3, { state: 'complete' }));
    expect(index).toStrictEqual(before);
    expect(next.runs.map((e) => [e.counter, e.state])).toEqual([[3, 'complete'], [2, 'complete']]);
    expect(evicted).toEqual([]);
  });

  it('inserts an older entry in its place and does not lower lastCounter', () => {
    const index = /** @type {any} */ ({ schemaVersion: 1, lastCounter: 9, runs: [entry(9), entry(5)] });
    const { index: next } = insertEntry(index, entry(7));
    expect(next.runs.map((e) => e.counter)).toEqual([9, 7, 5]);
    expect(next.lastCounter).toBe(9);
  });
});

describe('markCutShort', () => {
  const cron = 900;
  it('changes only running entries older than the cron timeout', () => {
    const entries = [
      entry(4, { state: 'running', finishedAt: null, startedAt: new Date(T0 - 899000).toISOString() }),
      entry(3, { state: 'running', finishedAt: null, startedAt: new Date(T0 - 901000).toISOString() }),
      entry(2, { state: 'complete', startedAt: new Date(T0 - 9000000).toISOString() }),
      entry(1, { state: 'failed', startedAt: new Date(T0 - 9000000).toISOString() }),
    ];
    const before = structuredClone(entries);
    const r = markCutShort(entries, T0, cron);
    expect(entries).toStrictEqual(before);
    expect(r.changedRunIds).toEqual([runIdOf(3)]);
    expect(r.entries.map((e) => e.state)).toEqual(['running', 'cut-short', 'complete', 'failed']);
    expect(r.entries[1].finishedAt).toBeNull();
  });

  it('an entry exactly cronTimeout old is not changed', () => {
    const e = entry(1, { state: 'running', finishedAt: null, startedAt: new Date(T0 - 900000).toISOString() });
    expect(markCutShort([e], T0, cron).changedRunIds).toEqual([]);
  });

  it('a running entry with an unparsable startedAt counts as stale', () => {
    const e = entry(1, { state: 'running', finishedAt: null, startedAt: 'not a date' });
    expect(markCutShort([e], T0, cron).changedRunIds).toEqual([runIdOf(1)]);
  });
});

describe('loadOrRebuildIndex', () => {
  it('returns a valid Index_File as it is, and writes nothing', async () => {
    const { fs, deps } = setup();
    const stored = { schemaVersion: 1, lastCounter: 7, runs: [entry(7), entry(6)] };
    fs.seedFile(INDEX_PATH, indexText(stored));
    const before = fs.snapshot();
    expect(await loadOrRebuildIndex(deps)).toStrictEqual(stored);
    expect(fs.snapshot()).toStrictEqual(before);
  });

  it('gives an empty index when there is no index and no runs folder', async () => {
    const { deps } = setup();
    expect(await loadOrRebuildIndex(deps)).toStrictEqual({ schemaVersion: 1, lastCounter: 0, runs: [] });
  });

  it('rebuilds from the Result_Files when the Index_File is missing', async () => {
    const { fs, deps } = setup();
    fs.seedFile(`${RUNS}/run-000002.json`, JSON.stringify(record(2, { state: 'complete', finishedAt: iso(3), green: 2 })));
    fs.seedFile(`${RUNS}/run-000005.json`, JSON.stringify(record(5)));
    const index = await loadOrRebuildIndex(deps);
    expect(index.runs.map((e) => e.runId)).toEqual(['run-000005', 'run-000002']);
    expect(index.runs[1]).toStrictEqual(indexEntryOf(record(2, { state: 'complete', finishedAt: iso(3), green: 2 })));
    expect(index.lastCounter).toBe(5);
    expect(index.schemaVersion).toBe(1);
  });

  it('rebuilds when the Index_File is unparsable, has a BOM, or has the wrong shape', async () => {
    for (const text of ['{ not json', `\ufeff${indexText({ schemaVersion: 1, lastCounter: 1, runs: [] })}`, '[]', '{"runs": 5}', '{"lastCounter":"x","runs":[]}']) {
      const { fs, deps } = setup();
      fs.seedFile(INDEX_PATH, text);
      fs.seedFile(`${RUNS}/run-000003.json`, JSON.stringify(record(3)));
      const index = await loadOrRebuildIndex(deps);
      expect(index.runs.map((e) => e.counter)).toEqual([3]);
      expect(index.lastCounter).toBe(3);
    }
  });

  it('ignores a Result_File that does not parse, but its name still counts toward lastCounter', async () => {
    const { fs, deps } = setup();
    fs.seedFile(`${RUNS}/run-000004.json`, JSON.stringify(record(4)));
    fs.seedFile(`${RUNS}/run-000008.json`, '{ broken');
    fs.seedFile(`${RUNS}/notes.txt`, 'x');
    fs.seedFile(`${RUNS}/.run-000009.json.00000000000000000000000000000001.tmp`, '{}');
    const index = await loadOrRebuildIndex(deps);
    expect(index.runs.map((e) => e.counter)).toEqual([4]);
    expect(index.lastCounter).toBe(8);
  });

  it('keeps the 30 highest counters when it rebuilds', async () => {
    const { fs, deps } = setup();
    for (let n = 1; n <= 33; n += 1) fs.seedFile(`${RUNS}/${runIdOf(n)}.json`, JSON.stringify(record(n)));
    const index = await loadOrRebuildIndex(deps);
    expect(index.runs).toHaveLength(30);
    expect(index.runs[0].counter).toBe(33);
    expect(index.runs[29].counter).toBe(4);
    expect(index.lastCounter).toBe(33);
  });
});

describe('writeResultFile, readResultFile, writeIndex', () => {
  /** @param {string[]} log @returns {(label: string) => Promise<void>} */
  const logGate = (log) => async (label) => {
    log.push(label.replace(/\\/g, '/'));
  };

  it('writeResultFile writes a temp file in the runs folder, then renames it', async () => {
    const { fs, deps } = setup();
    /** @type {string[]} */
    const log = [];
    const logged = { ...deps, fs: fs.withGate(logGate(log)) };
    await writeResultFile(logged, record(42));
    const w = log.findIndex((l) => l.startsWith('writeFile '));
    const r = log.findIndex((l) => l.startsWith('rename '));
    expect(w).toBeGreaterThanOrEqual(0);
    expect(r).toBeGreaterThan(w);
    expect(log[w]).toMatch(/^writeFile \/app\/data\/runs\/\.run-000042\.json\.[0-9a-f]{32}\.tmp$/);
    expect(log[r]).toMatch(/^rename \/app\/data\/runs\/\.run-000042\.json\.[0-9a-f]{32}\.tmp \/app\/data\/runs\/run-000042\.json$/);
    expect(fs.paths(RUNS)).toEqual([`${RUNS}/run-000042.json`]);
  });

  it('writeResultFile and writeIndex write UTF-8 JSON with two-space indent, a trailing newline and no BOM', async () => {
    const { fs, deps } = setup();
    const rec = record(42);
    await writeResultFile(deps, rec);
    const text = /** @type {string} */ (fs.peek(`${RUNS}/run-000042.json`));
    expect(text).toBe(`${JSON.stringify(rec, null, 2)}\n`);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    const index = { schemaVersion: 1, lastCounter: 42, runs: [entry(42)] };
    await writeIndex(deps, /** @type {any} */ (index));
    const itext = /** @type {string} */ (fs.peek(INDEX_PATH));
    expect(itext).toBe(indexText(index));
    expect(itext.charCodeAt(0)).not.toBe(0xfeff);
    expect(fs.paths(DATA).filter((p) => p.endsWith('.tmp'))).toEqual([]);
  });

  it('writeResultFile replaces an existing file', async () => {
    const { fs, deps } = setup();
    await writeResultFile(deps, record(7));
    await writeResultFile(deps, record(7, { state: 'complete' }));
    expect(JSON.parse(/** @type {string} */ (fs.peek(`${RUNS}/run-000007.json`))).state).toBe('complete');
  });

  it('readResultFile returns the record, and null for a missing file, bad JSON or a non-object', async () => {
    const { fs, deps } = setup();
    await writeResultFile(deps, record(5));
    expect(await readResultFile(deps, 'run-000005')).toStrictEqual(record(5));
    expect(await readResultFile(deps, 'run-000006')).toBeNull();
    fs.seedFile(`${RUNS}/run-000007.json`, '{ bad');
    expect(await readResultFile(deps, 'run-000007')).toBeNull();
    fs.seedFile(`${RUNS}/run-000008.json`, '[1]');
    expect(await readResultFile(deps, 'run-000008')).toBeNull();
    expect(await readResultFile(deps, '../x')).toBeNull();
  });
});

describe('pruneResultFiles', () => {
  it('deletes only pattern-matching files that have no Index_Entry', async () => {
    const { fs, deps } = setup();
    fs.seedFile(`${RUNS}/run-000001.json`, '{}');
    fs.seedFile(`${RUNS}/run-000002.json`, '{}');
    fs.seedFile(`${RUNS}/run-000003.json`, '{}');
    fs.seedFile(`${RUNS}/notes.txt`, 'x');
    fs.seedFile(`${RUNS}/.run-000001.json.00000000000000000000000000000001.tmp`, '{}');
    fs.seedFile(`${DATA}/_index.json`, 'x');
    const deleted = await pruneResultFiles(deps, /** @type {any} */ ({ schemaVersion: 1, lastCounter: 3, runs: [entry(3), entry(2)] }));
    expect(deleted).toEqual(['run-000001.json']);
    expect(fs.paths(DATA)).toEqual([
      `${DATA}/_index.json`,
      `${RUNS}/.run-000001.json.00000000000000000000000000000001.tmp`,
      `${RUNS}/notes.txt`,
      `${RUNS}/run-000002.json`,
      `${RUNS}/run-000003.json`,
    ]);
  });

  it('does nothing when the runs folder is missing', async () => {
    const { deps } = setup();
    expect(await pruneResultFiles(deps, /** @type {any} */ ({ schemaVersion: 1, lastCounter: 0, runs: [] }))).toEqual([]);
  });
});

describe('startRun', () => {
  const params = { startedAtMs: T0, cronTimeoutSec: 900, repoUrl: 'https://github.com/UBayouski/Grimsheet', branch: 'main', previousLaunch: null };

  it('starts the first run on an empty data folder', async () => {
    const { fs, deps } = setup();
    const { record: rec, index } = await startRun(deps, params);
    expect(rec).toStrictEqual(
      newRunRecord({ runId: 'run-000001', counter: 1, startedAt: new Date(T0).toISOString(), repoUrl: params.repoUrl, branch: 'main', previousLaunch: null }),
    );
    expect(index.lastCounter).toBe(1);
    expect(index.runs).toStrictEqual([indexEntryOf(rec)]);
    expect(JSON.parse(/** @type {string} */ (fs.peek(INDEX_PATH)))).toStrictEqual(index);
    expect(JSON.parse(/** @type {string} */ (fs.peek(`${RUNS}/run-000001.json`)))).toStrictEqual(rec);
  });

  it('marks stale running runs cut-short (index and Result_File), takes max(lastCounter, highest name) + 1, writes the index first, and prunes', async () => {
    const { fs, deps } = setup();
    const staleStart = new Date(T0 - 2 * 3600000).toISOString();
    const youngStart = new Date(T0 - 60000).toISOString();
    const stored = {
      schemaVersion: 1,
      lastCounter: 4,
      runs: [
        entry(4, { state: 'running', finishedAt: null, startedAt: youngStart }),
        entry(3, { state: 'running', finishedAt: null, startedAt: staleStart }),
        entry(2, { state: 'complete' }),
      ],
    };
    fs.seedFile(INDEX_PATH, indexText(stored));
    fs.seedFile(`${RUNS}/run-000004.json`, JSON.stringify(record(4, { startedAt: youngStart })));
    fs.seedFile(`${RUNS}/run-000003.json`, JSON.stringify(record(3, { startedAt: staleStart })));
    fs.seedFile(`${RUNS}/run-000002.json`, JSON.stringify(record(2, { state: 'complete' })));
    fs.seedFile(`${RUNS}/run-000009.json`, JSON.stringify(record(9)));
    fs.seedFile(`${RUNS}/.run-000001.json.00000000000000000000000000000001.tmp`, '{}');

    /** @type {string[]} */
    const log = [];
    const logged = { ...deps, fs: fs.withGate(async (l) => void log.push(l.replace(/\\/g, '/'))) };
    const { record: rec, index } = await startRun(logged, params);

    expect(rec.counter).toBe(10);
    expect(rec.runId).toBe('run-000010');
    expect(index.lastCounter).toBe(10);
    expect(index.runs.map((e) => [e.counter, e.state])).toEqual([[10, 'running'], [4, 'running'], [3, 'cut-short'], [2, 'complete']]);
    const cut = JSON.parse(/** @type {string} */ (fs.peek(`${RUNS}/run-000003.json`)));
    expect(cut.state).toBe('cut-short');
    expect(cut.finishedAt).toBeNull();
    expect(JSON.parse(/** @type {string} */ (fs.peek(`${RUNS}/run-000004.json`))).state).toBe('running');
    // The Index_File is renamed into place before the running Result_File.
    const idxRename = log.findIndex((l) => l.startsWith('rename ') && l.endsWith(' /app/data/_index.json'));
    const runRename = log.findIndex((l) => l.startsWith('rename ') && l.endsWith(' /app/data/runs/run-000010.json'));
    expect(idxRename).toBeGreaterThanOrEqual(0);
    expect(runRename).toBeGreaterThan(idxRename);
    // Pruning removed the file with no entry (9), and spared the temp file.
    expect(fs.has(`${RUNS}/run-000009.json`)).toBe(false);
    expect(fs.has(`${RUNS}/.run-000001.json.00000000000000000000000000000001.tmp`)).toBe(true);
    expect(fs.has(`${RUNS}/run-000010.json`)).toBe(true);
    expect(JSON.parse(/** @type {string} */ (fs.peek(INDEX_PATH)))).toStrictEqual(index);
  });

  it('keeps 30 entries and prunes the Result_File of the evicted run', async () => {
    const { fs, deps } = setup();
    const runs = Array.from({ length: 30 }, (_, i) => entry(30 - i));
    fs.seedFile(INDEX_PATH, indexText({ schemaVersion: 1, lastCounter: 30, runs }));
    for (let n = 1; n <= 30; n += 1) fs.seedFile(`${RUNS}/${runIdOf(n)}.json`, JSON.stringify(record(n, { state: 'complete' })));
    const { index } = await startRun(deps, params);
    expect(index.runs).toHaveLength(30);
    expect(index.runs[0].counter).toBe(31);
    expect(index.runs[29].counter).toBe(2);
    expect(fs.has(`${RUNS}/run-000001.json`)).toBe(false);
    expect(fs.has(`${RUNS}/run-000031.json`)).toBe(true);
  });

  it('rebuilds a missing Index_File from the Result_Files before it picks the counter', async () => {
    const { fs, deps } = setup();
    fs.seedFile(`${RUNS}/run-000006.json`, JSON.stringify(record(6, { state: 'complete' })));
    const { record: rec, index } = await startRun(deps, params);
    expect(rec.counter).toBe(7);
    expect(index.runs.map((e) => e.counter)).toEqual([7, 6]);
  });
});

describe('finishRunInIndex', () => {
  it('updates the entry of the run, writes the index and prunes', async () => {
    const { fs, deps } = setup();
    const params = { startedAtMs: T0, cronTimeoutSec: 900, repoUrl: 'u', branch: 'main', previousLaunch: null };
    const { record: started } = await startRun(deps, params);
    fs.seedFile(`${RUNS}/run-000099.json`, '{}');
    const done = finalizeRecord(started, {
      state: 'complete',
      finishedAt: iso(5),
      commit: 'abc',
      levels: [{ levelId: 'a', colour: 'green' }, { levelId: 'b', colour: 'red' }],
      coverage: started.coverage,
      failure: null,
    });
    const index = await finishRunInIndex(deps, done);
    expect(index.runs).toHaveLength(1);
    expect(index.runs[0]).toStrictEqual(indexEntryOf(done));
    expect(index.runs[0].state).toBe('complete');
    expect(index.runs[0].green).toBe(1);
    expect(index.runs[0].red).toBe(1);
    expect(JSON.parse(/** @type {string} */ (fs.peek(INDEX_PATH)))).toStrictEqual(index);
    expect(fs.has(`${RUNS}/run-000099.json`)).toBe(false);
  });
});

describe('real file system smoke test', () => {
  it('writes the Result_File and the Index_File with an atomic rename and leaves no temp file', async () => {
    const folder = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'index-store-'));
    try {
      const deps = {
        fs: /** @type {any} */ (nodeFs),
        paths: { appFolder: folder, dataFolder: path.join(folder, 'data'), localAppData: folder },
        token: makeTokenSource(),
      };
      await writeResultFile(deps, record(3));
      await writeIndex(deps, /** @type {any} */ ({ schemaVersion: 1, lastCounter: 3, runs: [entry(3)] }));
      const runsFolder = path.join(folder, 'data', 'runs');
      expect(await nodeFs.readdir(runsFolder)).toEqual(['run-000003.json']);
      expect((await nodeFs.readdir(path.join(folder, 'data'))).sort()).toEqual(['_index.json', 'runs']);
      const text = await nodeFs.readFile(path.join(runsFolder, 'run-000003.json'), 'utf8');
      expect(text).toBe(`${JSON.stringify(record(3), null, 2)}\n`);
      const bytes = await nodeFs.readFile(path.join(runsFolder, 'run-000003.json'));
      expect(bytes[0]).not.toBe(0xef);
      // A second write replaces the first.
      await writeResultFile(deps, record(3, { state: 'complete' }));
      expect((await readResultFile(deps, 'run-000003'))?.state).toBe('complete');
      expect(await nodeFs.readdir(runsFolder)).toEqual(['run-000003.json']);
    } finally {
      await nodeFs.rm(folder, { recursive: true, force: true });
    }
  });
});

describe('index-store properties', () => {
  const NUM_RUNS = 200;
  const emptyIndex = () => /** @type {any} */ ({ schemaVersion: 1, lastCounter: 0, runs: [] });
  const arbDistinctEntries = fc.uniqueArray(arbIndexEntry, { selector: (e) => e.counter, maxLength: 80 });

  // Feature: replay-runner, Property 1: Index bound and newest kept
  it('Property 1: the index never holds more than 30 entries and holds exactly the highest counters, Newest first', () => {
    fc.assert(
      fc.property(arbDistinctEntries, (entries) => {
        let index = emptyIndex();
        /** @type {number[]} */
        const seen = [];
        for (const e of entries) {
          index = insertEntry(index, e).index;
          seen.push(e.counter);
          expect(index.runs.length).toBeLessThanOrEqual(30);
          const expected = [...seen].sort((a, b) => b - a).slice(0, 30);
          expect(index.runs.map((/** @type {any} */ r) => r.counter)).toEqual(expected);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 2: Unique Run_Ids
  it('Property 2: the entries have unique Run_Ids, also after repeated insertions of the same Run_Id', () => {
    fc.assert(
      fc.property(fc.array(arbIndexEntry, { maxLength: 120 }), (entries) => {
        let index = emptyIndex();
        for (const e of entries) {
          index = insertEntry(index, e).index;
          const ids = index.runs.map((/** @type {any} */ r) => r.runId);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 3: Insertion order does not matter
  it('Property 3: any two orders of inserting the same runs keep the same runs', () => {
    const arbTwoOrders = arbDistinctEntries.chain((entries) =>
      fc.tuple(
        fc.shuffledSubarray(entries, { minLength: entries.length, maxLength: entries.length }),
        fc.shuffledSubarray(entries, { minLength: entries.length, maxLength: entries.length }),
      ),
    );
    fc.assert(
      fc.property(arbTwoOrders, ([orderA, orderB]) => {
        /** @param {any[]} order */
        const insertAll = (order) => order.reduce((index, e) => insertEntry(index, e).index, emptyIndex());
        const a = insertAll(orderA);
        const b = insertAll(orderB);
        expect(a.runs).toStrictEqual(b.runs);
        expect(a.lastCounter).toBe(b.lastCounter);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 4: Counters strictly increase
  it('Property 4: every counter issued is greater than every counter issued before', async () => {
    const arbOp = fc.constantFrom('finish-complete', 'finish-failed', 'leave-running', 'delete-index', 'corrupt-index', 'advance-long');
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp, { minLength: 1, maxLength: 70 }), async (ops) => {
        const { clock, fs, deps } = setup();
        let highest = 0;
        for (const op of ops) {
          if (op === 'delete-index') await fs.rm(INDEX_PATH, { force: true });
          else if (op === 'corrupt-index') fs.seedFile(INDEX_PATH, '{ corrupted');
          else if (op === 'advance-long') clock.advance(2 * 3600 * 1000);
          else {
            const { record: rec } = await startRun(deps, { startedAtMs: clock.nowMs(), cronTimeoutSec: 900, repoUrl: 'u', branch: 'b', previousLaunch: null });
            expect(rec.counter).toBeGreaterThan(highest);
            highest = rec.counter;
            if (op !== 'leave-running') {
              const done = finalizeRecord(rec, {
                state: op === 'finish-failed' ? 'failed' : 'complete',
                finishedAt: new Date(clock.nowMs()).toISOString(),
                commit: null,
                levels: [],
                coverage: rec.coverage,
                failure: null,
              });
              await writeResultFile(deps, done);
              await finishRunInIndex(deps, done);
            }
            clock.advance(1000);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 5: Cut-short marking is idempotent and spares final states
  it('Property 5: marking twice equals marking once, and complete, failed and cut-short entries are unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(arbIndexEntry, { maxLength: 40 }),
        fc.integer({ min: 0, max: 60 * 24 * 3600 * 1000 }).map((o) => Date.UTC(2026, 10, 1) + o),
        fc.integer({ min: 1, max: 7200 }),
        (entries, nowMs, cronTimeoutSec) => {
          const once = markCutShort(entries, nowMs, cronTimeoutSec);
          const twice = markCutShort(once.entries, nowMs, cronTimeoutSec);
          expect(twice.entries).toStrictEqual(once.entries);
          expect(twice.changedRunIds).toEqual([]);
          expect(once.entries).toHaveLength(entries.length);
          entries.forEach((e, i) => {
            if (e.state !== 'running') expect(once.entries[i]).toStrictEqual(e);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 6: Young running Runs are unchanged
  it('Property 6: a running entry not older than cronTimeoutSec is unchanged and an older one becomes cut-short', () => {
    fc.assert(
      fc.property(
        arbIndexEntry,
        fc.integer({ min: 1, max: 7200 }),
        fc.integer({ min: -5000, max: 20000000 }),
        (base, cronTimeoutSec, ageMs) => {
          const nowMs = Date.UTC(2026, 11, 1);
          const e = { ...base, state: 'running', finishedAt: null, startedAt: new Date(nowMs - ageMs).toISOString() };
          const r = markCutShort([e], nowMs, cronTimeoutSec);
          if (ageMs <= cronTimeoutSec * 1000) {
            expect(r.entries[0]).toStrictEqual(e);
            expect(r.changedRunIds).toEqual([]);
          } else {
            expect(r.entries[0]).toStrictEqual({ ...e, state: 'cut-short' });
            expect(r.changedRunIds).toEqual([e.runId]);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
