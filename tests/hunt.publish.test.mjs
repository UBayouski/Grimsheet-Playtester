// @ts-check
// Unit tests of scripts/hunt/publish.mjs (design: "publish.mjs", "publishFindings", Decisions 16 and 29;
// Requirement 10). The module does not exist yet: these tests fail until task 12.2.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { publishFindings } from '../scripts/hunt/publish.mjs';
import { newHuntRecord, readyRecord, chargeAttempt, countsOf } from '../scripts/hunt/hunt-record.mjs';
import { BYTE_BUDGET, buildResultsKey, compactLatest, trendEntryOf } from '../scripts/replay/run-record.mjs';
import { mergeTopKey } from '../scripts/results-store.mjs';
import { FINDINGS_MAX_ITEMS } from '../scripts/hunt/limits.mjs';
import { arbFinding, arbConfig, arbFindingSequence } from './hunt.arbitraries.mjs';
import { makeHuntWorld, DATA_FOLDER, CONFIG_PATH } from './helpers/hunt-world.mjs';

const HUNT_ID = 'hunt-20261108T110312Z';
const COMMIT = 'e1c61a35b3da027aada5d9ef4460efa4470488a4';
const LEVEL = '01-the-corridor';
const BASE_MS = Date.UTC(2026, 10, 8, 11, 5, 0);
const LOCK_PATH = `${DATA_FOLDER}\\.results.lock`;

/** @param {number} n @returns {string} */
const pad = (n) => String(n).padStart(3, '0');

/**
 * A small Finding. `n` makes the id, the foundAt and the token list unique.
 * @param {number} n
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
function mk(n, over = {}) {
  return {
    id: `${HUNT_ID}-${pad(n)}`,
    levelId: LEVEL,
    class: 'cheaper_win',
    commit: COMMIT,
    huntId: HUNT_ID,
    foundAt: new Date(BASE_MS + n * 1000).toISOString(),
    actions: ['move:N', ...Array.from({ length: n }, () => 'wait')],
    result: { won: true, inkSpent: 0, minimalInk: 2, editCount: 0, newEditAddresses: [], reasonCode: 'class_reproduced' },
    ...over,
  };
}

/** A running record, ready, with one Attempt charged and no outcome counted yet. @returns {any} */
function makeRecord() {
  let r = newHuntRecord({ huntId: HUNT_ID, startedAt: '2026-11-08T11:03:12.000Z', repoUrl: 'https://example.invalid/g', branch: 'main' });
  r = readyRecord(r, { readyAt: '2026-11-08T11:03:40.000Z', commit: COMMIT, levels: [LEVEL, '02-the-chaser'], levelsSkipped: 0 });
  return chargeAttempt(r, LEVEL);
}

/** @param {ReturnType<typeof makeHuntWorld>} w @returns {any} */
const readConfig = (w) => JSON.parse(/** @type {string} */ (w.fs.peek(CONFIG_PATH)));

/** @param {ReturnType<typeof makeHuntWorld>} w @param {any} finding @param {any} [record] @returns {Promise<any>} */
const publish = (w, finding, record = makeRecord()) => publishFindings(w.deps, { record, finding, nowMs: w.clock.nowMs() });

/** The value a successful merge would leave as the replay's keys. @returns {Record<string, any>} */
function replayKeys() {
  return {
    schemaVersion: 1,
    updatedAt: '2026-11-08T03:00:00.000Z',
    latest: { runId: 'run-000002', green: 3, levels: [{ levelId: LEVEL, colour: 'green' }] },
    trend: [{ runId: 'run-000001', green: 3, red: 0 }, { runId: 'run-000002', green: 3, red: 0 }],
  };
}

/** A well-formed Findings_Value holding `count` items numbered 1..count. @param {number} count @returns {any} */
function valueWith(count) {
  return {
    schemaVersion: 1,
    updatedAt: '2026-11-08T10:00:00.000Z',
    commit: COMMIT,
    huntId: HUNT_ID,
    counts: { attempts: count, confirmed: count, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 },
    items: Array.from({ length: count }, (_, i) => mk(i + 1)).reverse(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('publishFindings: merging', () => {
  it('merges a new Finding under playtesterResults.findings and leaves the replay sub-keys and foreign keys alone', async () => {
    const w = makeHuntWorld();
    const before = { theme: 'dark', port: 8080, playtesterResults: { ...replayKeys(), extra: { keep: true } } };
    w.seedConfig(before);
    const res = await publish(w, mk(1));
    expect(res).toMatchObject({ findingsKey: 'ok', duplicate: false, duplicateOf: null, tooLarge: false, evicted: [] });
    const after = readConfig(w);
    expect(after.theme).toBe('dark');
    expect(after.port).toBe(8080);
    for (const k of ['schemaVersion', 'updatedAt', 'latest', 'trend', 'extra']) {
      expect(after.playtesterResults[k]).toEqual(/** @type {any} */ (before.playtesterResults)[k]);
    }
    expect(Object.keys(after.playtesterResults).sort()).toEqual(['extra', 'findings', 'latest', 'schemaVersion', 'trend', 'updatedAt']);
    const f = after.playtesterResults.findings;
    expect(f.schemaVersion).toBe(1);
    expect(f.items).toEqual([mk(1)]);
    expect(f.huntId).toBe(HUNT_ID);
    expect(f.commit).toBe(COMMIT);
    expect(f.updatedAt).toBe(new Date(w.clock.nowMs()).toISOString());
  });

  it('counts this Attempt as confirmed in the header', async () => {
    const w = makeHuntWorld();
    const record = makeRecord();
    expect(countsOf(record).confirmed).toBe(0);
    await publish(w, mk(1), record);
    expect(readConfig(w).playtesterResults.findings.counts).toEqual({ attempts: 1, confirmed: 1, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 });
  });

  it('creates config.json holding only the top key when the file is missing', async () => {
    const w = makeHuntWorld();
    expect(w.fs.has(CONFIG_PATH)).toBe(false);
    const res = await publish(w, mk(1));
    expect(res.findingsKey).toBe('ok');
    const cfg = readConfig(w);
    expect(Object.keys(cfg)).toEqual(['playtesterResults']);
    expect(Object.keys(cfg.playtesterResults)).toEqual(['findings']);
  });

  it('replaces a legacy array under findings with the object shape (Decision 29)', async () => {
    const w = makeHuntWorld();
    w.seedConfig({ playtesterResults: { ...replayKeys(), findings: [] } });
    const res = await publish(w, mk(1));
    expect(res.findingsKey).toBe('ok');
    const f = readConfig(w).playtesterResults.findings;
    expect(Array.isArray(f)).toBe(false);
    expect(f.schemaVersion).toBe(1);
    expect(f.items).toEqual([mk(1)]);
  });

  it('keeps the earlier items and puts the newest first', async () => {
    const w = makeHuntWorld();
    await publish(w, mk(1));
    await publish(w, mk(2));
    expect(readConfig(w).playtesterResults.findings.items.map((/** @type {any} */ i) => i.id)).toEqual([mk(2).id, mk(1).id]);
  });

  it('leaves findings identical, header included, for a duplicate, and reports duplicate and duplicateOf', async () => {
    const w = makeHuntWorld();
    await publish(w, mk(1));
    const before = readConfig(w).playtesterResults.findings;
    w.clock.advance(120000);
    const again = mk(2, { actions: mk(1).actions, foundAt: new Date(BASE_MS + 99000).toISOString() });
    const res = await publish(w, again);
    expect(res).toMatchObject({ findingsKey: 'ok', duplicate: true, duplicateOf: mk(1).id, evicted: [] });
    expect(readConfig(w).playtesterResults.findings).toEqual(before);
  });

  it('reports the evicted ids when the item cap is reached, oldest first', async () => {
    const w = makeHuntWorld();
    w.seedConfig({ playtesterResults: { findings: valueWith(FINDINGS_MAX_ITEMS) } });
    const res = await publish(w, mk(FINDINGS_MAX_ITEMS + 1));
    expect(res.findingsKey).toBe('ok');
    expect(res.evicted).toEqual([mk(1).id]);
    const items = readConfig(w).playtesterResults.findings.items;
    expect(items).toHaveLength(FINDINGS_MAX_ITEMS);
    expect(items[0].id).toBe(mk(FINDINGS_MAX_ITEMS + 1).id);
    expect(items.some((/** @type {any} */ i) => i.id === mk(1).id)).toBe(false);
  });

  it('with no Finding only refreshes the header (Hunt_End)', async () => {
    const w = makeHuntWorld();
    w.seedConfig({ playtesterResults: { findings: valueWith(2) } });
    const record = { ...makeRecord(), huntId: 'hunt-20261108T120000Z' };
    w.clock.advance(60000);
    const res = await publishFindings(w.deps, { record, finding: null, nowMs: w.clock.nowMs() });
    expect(res).toMatchObject({ findingsKey: 'ok', duplicate: false, duplicateOf: null, tooLarge: false, evicted: [] });
    const f = readConfig(w).playtesterResults.findings;
    expect(f.items).toEqual(valueWith(2).items);
    expect(f.huntId).toBe('hunt-20261108T120000Z');
    expect(f.updatedAt).toBe(new Date(w.clock.nowMs()).toISOString());
    expect(f.counts).toEqual({ attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 });
  });
});

describe('publishFindings: findingsKey values', () => {
  it('ok clears pendingFindings and sets findingsKey on the returned record', async () => {
    const w = makeHuntWorld();
    const res = await publish(w, mk(1));
    expect(res.findingsKey).toBe('ok');
    expect(res.record.findingsKey).toBe('ok');
    expect(res.record.pendingFindings).toEqual([]);
  });

  it('lock_timeout when the results lock is held for the whole wait', async () => {
    const w = makeHuntWorld();
    w.seedConfig({ keep: 1 });
    w.fs.seedFile(LOCK_PATH, JSON.stringify({ pid: 1, token: 'other', createdAt: new Date(w.clock.nowMs()).toISOString() }));
    const before = /** @type {string} */ (w.fs.peek(CONFIG_PATH));
    const res = await publish(w, mk(1));
    expect(res.findingsKey).toBe('lock_timeout');
    expect(res.record.findingsKey).toBe('lock_timeout');
    expect(res.record.pendingFindings).toEqual([mk(1)]);
    expect(w.fs.peek(CONFIG_PATH)).toBe(before);
    expect(w.fs.has(LOCK_PATH)).toBe(true);
  });

  it('config_unreadable when config.json has a BOM or is not valid JSON', async () => {
    for (const text of ['\uFEFF{"a":1}', '{not json']) {
      const w = makeHuntWorld();
      w.fs.seedFile(CONFIG_PATH, text);
      const res = await publish(w, mk(1));
      expect(res.findingsKey).toBe('config_unreadable');
      expect(res.record.pendingFindings).toEqual([mk(1)]);
      expect(w.fs.peek(CONFIG_PATH)).toBe(text);
    }
  });

  it('too_large when the top key would pass BYTE_BUDGET', async () => {
    const w = makeHuntWorld();
    w.seedConfig({ playtesterResults: { ...replayKeys(), pad: 'x'.repeat(BYTE_BUDGET) } });
    const before = /** @type {string} */ (w.fs.peek(CONFIG_PATH));
    const res = await publish(w, mk(1));
    expect(res.findingsKey).toBe('too_large');
    expect(res.record.pendingFindings).toEqual([mk(1)]);
    expect(w.fs.peek(CONFIG_PATH)).toBe(before);
  });

  it('write_failed when the rename of config.json fails', async () => {
    const w = makeHuntWorld();
    w.seedConfig({ keep: 1 });
    const before = /** @type {string} */ (w.fs.peek(CONFIG_PATH));
    const failing = {
      ...w.deps,
      fs: {
        ...w.deps.fs,
        rename: async (/** @type {string} */ from, /** @type {string} */ to) => {
          if (to.endsWith('config.json')) throw Object.assign(new Error('EBUSY: injected'), { code: 'EBUSY' });
          return w.deps.fs.rename(from, to);
        },
      },
    };
    const res = await publishFindings(failing, { record: makeRecord(), finding: mk(1), nowMs: w.clock.nowMs() });
    expect(res.findingsKey).toBe('write_failed');
    expect(res.record.pendingFindings).toEqual([mk(1)]);
    expect(w.fs.peek(CONFIG_PATH)).toBe(before);
    expect(w.fs.has(LOCK_PATH)).toBe(false);
  });
});

describe('publishFindings: pendingFindings retry', () => {
  it('retries pending Findings on the next successful merge, then clears them', async () => {
    const w = makeHuntWorld();
    w.fs.seedFile(LOCK_PATH, JSON.stringify({ pid: 1, token: 'other', createdAt: new Date(w.clock.nowMs()).toISOString() }));
    const first = await publish(w, mk(1));
    expect(first.record.pendingFindings).toEqual([mk(1)]);
    const second = await publish(w, mk(2), first.record);
    expect(second.findingsKey).toBe('lock_timeout');
    expect(second.record.pendingFindings).toEqual([mk(1), mk(2)]); // oldest first

    await w.fs.rm(LOCK_PATH, { force: true });
    const third = await publish(w, mk(3), second.record);
    expect(third).toMatchObject({ findingsKey: 'ok', duplicate: false });
    expect(third.record.findingsKey).toBe('ok');
    expect(third.record.pendingFindings).toEqual([]);
    expect(readConfig(w).playtesterResults.findings.items.map((/** @type {any} */ i) => i.id)).toEqual([mk(3).id, mk(2).id, mk(1).id]);
  });

  it('retries pending Findings on a header-only call', async () => {
    const w = makeHuntWorld();
    const record = { ...makeRecord(), pendingFindings: [mk(1)], findingsKey: 'write_failed' };
    const res = await publishFindings(w.deps, { record, finding: null, nowMs: w.clock.nowMs() });
    expect(res.findingsKey).toBe('ok');
    expect(res.record.pendingFindings).toEqual([]);
    expect(readConfig(w).playtesterResults.findings.items).toEqual([mk(1)]);
  });

  it('keeps pending Findings and adds nothing when a header-only call fails', async () => {
    const w = makeHuntWorld();
    w.fs.seedFile(CONFIG_PATH, '{bad');
    const record = { ...makeRecord(), pendingFindings: [mk(1)] };
    const res = await publishFindings(w.deps, { record, finding: null, nowMs: w.clock.nowMs() });
    expect(res.findingsKey).toBe('config_unreadable');
    expect(res.record.pendingFindings).toEqual([mk(1)]);
  });
});

describe('publishFindings: safety', () => {
  it('never throws, even when every file-system call throws', async () => {
    const w = makeHuntWorld();
    const boom = async () => {
      throw new Error('injected');
    };
    const broken = { ...w.deps, fs: { ...w.deps.fs, readFile: boom, writeFile: boom, rename: boom, rm: boom, mkdir: boom, stat: boom, readdir: boom } };
    const res = await publishFindings(/** @type {any} */ (broken), { record: makeRecord(), finding: mk(1), nowMs: w.clock.nowMs() });
    expect(['lock_timeout', 'config_unreadable', 'too_large', 'write_failed']).toContain(res.findingsKey);
  });

  it('never throws for generated Findings and a record without pendingFindings', async () => {
    const samples = fc.sample(arbFinding, { numRuns: 8, seed: 12 });
    for (const finding of samples) {
      const w = makeHuntWorld();
      const record = makeRecord();
      delete record.pendingFindings;
      await expect(publishFindings(w.deps, { record, finding, nowMs: w.clock.nowMs() })).resolves.toHaveProperty('findingsKey');
    }
  });

  it('makes no HTTP call and holds no HTTP dependency', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const w = makeHuntWorld();
    expect(Object.keys(w.deps).filter((k) => /http|fetch|request/i.test(k))).toEqual([]);
    await publish(w, mk(1));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------------------------------------
// Cross-check with the replay merge (design: Property 11; Requirement 16, criterion 9)
// ---------------------------------------------------------------------------------------------------------

/** Replay run records, newest counter first, built the way run.mjs reads them back from the result files. */
const arbReplayRuns = fc
  .uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 6 })
  .chain((counters) =>
    fc.tuple(
      ...counters.map((counter) =>
        fc
          .record({
            colours: fc.array(fc.constantFrom('green', 'amber', 'red', 'error'), { minLength: 0, maxLength: 5 }),
            state: fc.constantFrom('complete', 'failed'),
          })
          .map(({ colours, state }) => {
            const levels = colours.map((colour, i) => ({ levelId: `0${i + 1}-level`, colour, inkSpent: i, minimalInk: i, reasonCode: 'ok' }));
            const count = (/** @type {string} */ c) => levels.filter((l) => l.colour === c).length;
            return {
              runId: `run-${String(counter).padStart(6, '0')}`,
              counter,
              state,
              startedAt: new Date(BASE_MS + counter * 1000).toISOString(),
              finishedAt: new Date(BASE_MS + counter * 1000 + 500).toISOString(),
              commit: COMMIT,
              repoUrl: 'https://example.invalid/g',
              branch: 'main',
              levels,
              coverage: null,
              failure: null,
              green: count('green'),
              amber: count('amber'),
              red: count('red'),
              error: count('error'),
            };
          }),
      ),
    ),
  )
  .map((runs) => [...runs].sort((a, b) => b.counter - a.counter));

/**
 * The replay's merge, called as run.mjs step 8.3 calls it.
 * @param {ReturnType<typeof makeHuntWorld>} w
 * @param {any[]} runs newest first
 * @returns {Promise<{ok: boolean}>}
 */
async function replayMerge(w, runs) {
  const trend = runs.map((r) => trendEntryOf(r));
  const latest = compactLatest(runs[0]);
  const updatedAt = new Date(w.clock.nowMs()).toISOString();
  const merged = await mergeTopKey(w.deps, {
    topKey: 'playtesterResults',
    budgetBytes: BYTE_BUDGET,
    buildOwned: (existingTop) => buildResultsKey({ existingTop, latest, trend, updatedAt, budget: BYTE_BUDGET }),
  });
  return { ok: merged.ok };
}

/** @param {any} config @returns {any} */
const findingsOf = (config) => config?.playtesterResults?.findings;

/**
 * Hunt-side check: everything except playtesterResults.findings is deeply equal.
 * @param {any} before
 * @param {any} after
 */
function expectHuntKeepsOthers(before, after) {
  const others = (/** @type {any} */ c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'playtesterResults'));
  expect(others(after)).toEqual(others(before));
  const subs = (/** @type {any} */ c) => Object.fromEntries(Object.entries(c.playtesterResults ?? {}).filter(([k]) => k !== 'findings'));
  expect(subs(after)).toEqual(subs(before));
}

/**
 * Publishes every Finding in order; checks each merge against the config before it.
 * @param {ReturnType<typeof makeHuntWorld>} w
 * @param {any[]} sequence
 * @returns {Promise<boolean>} true when every merge reported ok
 */
async function huntSequence(w, sequence) {
  let record = makeRecord();
  let allOk = true;
  for (const finding of sequence) {
    const before = readConfig(w);
    const res = await publishFindings(w.deps, { record, finding, nowMs: w.clock.nowMs() });
    record = res.record;
    const after = readConfig(w);
    if (res.findingsKey === 'ok') expectHuntKeepsOthers(before, after);
    else {
      allOk = false;
      expect(after).toEqual(before); // a failed merge leaves the file untouched
    }
  }
  return allOk;
}

describe('publishFindings: cross-check with the replay merge', () => {
  // Feature: exploit-hunt, Property 11: Merges do not touch the other writer's keys
  it('hunt and replay merges leave each other\'s keys alone and commute', async () => {
    const counts = { compared: 0, skipped: 0 };
    await fc.assert(
      fc.asyncProperty(arbConfig, arbFindingSequence, arbReplayRuns, async (config, sequence, runs) => {
        // Order A: hunt first, then replay.
        const a = makeHuntWorld();
        a.seedConfig(config);
        const huntOkA = await huntSequence(a, sequence);
        const beforeReplayA = readConfig(a);
        const replayA = await replayMerge(a, runs);
        const afterA = readConfig(a);
        expect(findingsOf(afterA)).toEqual(findingsOf(beforeReplayA));
        if (!replayA.ok) expect(afterA).toEqual(beforeReplayA);

        // Order B: replay first, then hunt.
        const b = makeHuntWorld();
        b.seedConfig(config);
        const replayB = await replayMerge(b, runs);
        const afterReplayB = readConfig(b);
        expect(findingsOf(afterReplayB)).toEqual(findingsOf(config));
        if (!replayB.ok) expect(afterReplayB).toEqual(config);
        const huntOkB = await huntSequence(b, sequence);
        const afterB = readConfig(b);

        // The orders agree when every merge in both succeeded.
        if (huntOkA && huntOkB && replayA.ok && replayB.ok) {
          counts.compared += 1;
          expect(findingsOf(afterB)).toEqual(findingsOf(afterA));
          expect(afterB.playtesterResults.latest).toEqual(afterA.playtesterResults.latest);
          expect(afterB.playtesterResults.trend).toEqual(afterA.playtesterResults.trend);
        } else {
          counts.skipped += 1;
        }
      }),
      { numRuns: 150 },
    );
    const total = counts.compared + counts.skipped;
    expect(counts.compared).toBeGreaterThan(0);
    expect(counts.compared).toBeGreaterThanOrEqual(Math.ceil(0.5 * total));
  });
});
