// @ts-check
// Feature: packaging. The probe writer (scripts/packaging/config-probe.mjs): one key in data\config.json, written and removed
// under the results lock that the replay and the hunt use.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PROBE_KEY, MIN_PROBE_BYTES, buildProbe, writeProbe, removeProbe } from '../scripts/packaging/config-probe.mjs';
import { RESULTS_LOCK_FILE } from '../scripts/results-store.mjs';
import { makeFakeClock, makeMemFs, makeSleep, makeTokenSource } from './helpers/fake-fs.mjs';

const DATA = '/app/data';
const CONFIG = `${DATA}/config.json`;
const LOCK = `${DATA}/${RESULTS_LOCK_FILE}`;
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

/**
 * @param {{gate?: (label: string) => Promise<void>}} [o]
 */
function setup(o = {}) {
  const clock = makeFakeClock(T0);
  const memFs = makeMemFs({ clock });
  memFs.seedDir(DATA);
  const view = o.gate ? memFs.withGate(o.gate) : memFs;
  const deps = {
    fs: /** @type {import('../scripts/replay/types.mjs').Fs} */ (/** @type {unknown} */ (view)),
    paths: { appFolder: '/app', dataFolder: DATA, localAppData: '/lad' },
    clock,
    sleep: makeSleep(clock),
    token: makeTokenSource(),
    pid: 91,
  };
  return { clock, memFs, deps };
}

/** @param {any} value @returns {string} */
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** @param {string|undefined} text @returns {any} */
const parse = (text) => JSON.parse(/** @type {string} */ (text));

describe('PROBE_KEY and buildProbe', () => {
  it('uses a key that is not the Results_Key', () => {
    expect(PROBE_KEY).toBe('packagingProbe');
    expect(PROBE_KEY).not.toBe('playtesterResults');
    expect(MIN_PROBE_BYTES).toBe(10);
  });

  it('builds the smallest probe, {"pad":""}, and refuses a smaller size', () => {
    expect(JSON.stringify(buildProbe(10))).toBe('{"pad":""}');
    expect(() => buildProbe(9)).toThrow(RangeError);
    expect(() => buildProbe(-1)).toThrow(RangeError);
    expect(() => buildProbe(10.5)).toThrow(RangeError);
  });

  it('fills the pad with a repeating pattern, so a cut or a changed byte shows in a comparison', () => {
    expect(buildProbe(10 + 25).pad).toBe('abcdefghijabcdefghijabcde');
  });
});

describe('writeProbe and removeProbe: examples', () => {
  it('writes only the probe key and keeps every other key, and removes it again', async () => {
    const { memFs, deps } = setup();
    const original = { theme: 'dark', playtesterResults: { schemaVersion: 1, latest: { runId: 'run-000001' }, trend: [] }, n: [1, 2, { a: null }] };
    memFs.seedFile(CONFIG, jsonText(original));
    expect(await writeProbe(deps, 1000)).toEqual({ ok: true });
    const mid = parse(memFs.peek(CONFIG));
    expect(JSON.stringify(mid[PROBE_KEY]).length).toBe(1000);
    delete mid[PROBE_KEY];
    expect(mid).toEqual(original);
    expect(await removeProbe(deps)).toEqual({ ok: true });
    expect(parse(memFs.peek(CONFIG))).toEqual(original);
    expect(memFs.paths(DATA)).toEqual([CONFIG]);
  });

  it('writing the same size twice gives the same file', async () => {
    const { memFs, deps } = setup();
    memFs.seedFile(CONFIG, jsonText({ a: 1 }));
    await writeProbe(deps, 4096);
    const once = memFs.peek(CONFIG);
    await writeProbe(deps, 4096);
    expect(memFs.peek(CONFIG)).toBe(once);
  });

  it('removing when the probe is absent changes nothing, byte for byte', async () => {
    const { memFs, deps } = setup();
    const text = '{\n    "odd":   "spacing"\n}\n';
    memFs.seedFile(CONFIG, text);
    expect(await removeProbe(deps)).toEqual({ ok: true });
    expect(memFs.peek(CONFIG)).toBe(text);
    expect(memFs.has(LOCK)).toBe(false);
  });

  it('stops without a write when config.json is missing, is not valid JSON, has a BOM, or is not an object', async () => {
    for (const text of [undefined, '{ nope', '\uFEFF{"a":1}', '[1,2]', '"text"', 'null']) {
      const { memFs, deps } = setup();
      if (text !== undefined) memFs.seedFile(CONFIG, text);
      const before = memFs.snapshot();
      const r = await writeProbe(deps, 100);
      expect(r).toMatchObject({ ok: false });
      expect(memFs.snapshot()).toEqual(before);
      expect(memFs.has(LOCK)).toBe(false);
    }
  });

  it('reports config_missing for a missing file and config_unreadable for the rest', async () => {
    const a = setup();
    expect(await writeProbe(a.deps, 100)).toEqual({ ok: false, reason: 'config_missing' });
    const b = setup();
    b.memFs.seedFile(CONFIG, '[1]');
    expect(await writeProbe(b.deps, 100)).toEqual({ ok: false, reason: 'config_unreadable' });
  });

  it('waits for a lock held by another owner, then ends with lock_timeout and no write', async () => {
    const { memFs, deps, clock } = setup();
    memFs.seedFile(CONFIG, jsonText({ a: 1 }));
    memFs.seedFile(LOCK, JSON.stringify({ pid: 5, token: 'other', createdAt: new Date(clock.nowMs()).toISOString() }));
    const before = memFs.snapshot();
    const r = await writeProbe(deps, 100);
    expect(r).toEqual({ ok: false, reason: 'lock_timeout' });
    expect(memFs.snapshot()).toEqual(before);
    expect(parse(memFs.peek(LOCK)).token).toBe('other');
  });

  it('leaves config.json unchanged, no temp file and no lock when the write fails', async () => {
    let failing = false;
    const gate = async (/** @type {string} */ label) => {
      if (failing && label.startsWith('writeFile') && label.includes('.config.')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    };
    const { memFs, deps } = setup({ gate });
    memFs.seedFile(CONFIG, jsonText({ a: 1 }));
    const before = memFs.snapshot();
    failing = true;
    expect(await writeProbe(deps, 500)).toEqual({ ok: false, reason: 'write_failed' });
    expect(memFs.snapshot()).toEqual(before);
  });

  it('takes the lock for the write and for the removal, and holds it for neither afterwards', async () => {
    /** @type {string[]} */
    const labels = [];
    const { memFs, deps } = setup({ gate: async (label) => void labels.push(label) });
    memFs.seedFile(CONFIG, jsonText({ a: 1 }));
    await writeProbe(deps, 200);
    expect(memFs.has(LOCK)).toBe(false);
    await removeProbe(deps);
    expect(memFs.has(LOCK)).toBe(false);
    const lockWrites = labels.filter((l) => l.includes(RESULTS_LOCK_FILE) && l.startsWith('writeFile'));
    expect(lockWrites).toHaveLength(2);
  });
});

describe('probe properties', () => {
  const arbConfig = fc
    .dictionary(
      fc.string({ maxLength: 12 }).filter((k) => k !== PROBE_KEY),
      fc.jsonValue({ maxDepth: 3 }),
      { maxKeys: 8 },
    )
    .map((o) => /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(o))));

  // Feature: packaging, Property 6: the probe round trip restores the file
  it('Property 6: write then remove restores the parsed file, leaves no lock or temp file, and never changes another key in between', async () => {
    await fc.assert(
      fc.asyncProperty(arbConfig, fc.integer({ min: MIN_PROBE_BYTES, max: 200000 }), async (original, size) => {
        /** @type {string[]} */
        const violations = [];
        /** @type {{memFs: ReturnType<typeof makeMemFs>} | null} */
        let holder = null;
        const gate = async () => {
          const text = holder?.memFs.peek(CONFIG);
          if (text === undefined) return;
          const seen = JSON.parse(text);
          delete seen[PROBE_KEY];
          if (JSON.stringify(seen) !== JSON.stringify(original)) violations.push('another key changed');
        };
        const s = setup({ gate });
        holder = { memFs: s.memFs };
        s.memFs.seedFile(CONFIG, jsonText(original));
        expect(await writeProbe(s.deps, size)).toEqual({ ok: true });
        const mid = parse(s.memFs.peek(CONFIG));
        expect(JSON.stringify(mid[PROBE_KEY])).toBe(JSON.stringify(buildProbe(size)));
        expect(await removeProbe(s.deps)).toEqual({ ok: true });
        expect(parse(s.memFs.peek(CONFIG))).toEqual(original);
        expect(s.memFs.paths(DATA)).toEqual([CONFIG]);
        expect(violations).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  // Feature: packaging, Property 6 (error path): a failure between the write and the removal does not stop the removal
  it('Property 6, error path: removal in a finally block restores the file after an error', async () => {
    await fc.assert(
      fc.asyncProperty(arbConfig, fc.integer({ min: MIN_PROBE_BYTES, max: 50000 }), async (original, size) => {
        const { memFs, deps } = setup();
        memFs.seedFile(CONFIG, jsonText(original));
        await expect(
          (async () => {
            try {
              await writeProbe(deps, size);
              throw new Error('a read failed');
            } finally {
              await removeProbe(deps);
            }
          })(),
        ).rejects.toThrow('a read failed');
        expect(parse(memFs.peek(CONFIG))).toEqual(original);
        expect(memFs.paths(DATA)).toEqual([CONFIG]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: packaging, Property 7: the probe has the exact size
  it('Property 7: the UTF-8 length of the serialised probe is exactly the requested size', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_PROBE_BYTES, max: 2 * 1024 * 1024 }), (n) => {
        expect(Buffer.byteLength(JSON.stringify(buildProbe(n)), 'utf8')).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: packaging, Property 6 (idempotence): the same size written twice gives the same file
  it('writing the same size twice gives the same file for all configs', async () => {
    await fc.assert(
      fc.asyncProperty(arbConfig, fc.integer({ min: MIN_PROBE_BYTES, max: 20000 }), async (original, size) => {
        const { memFs, deps } = setup();
        memFs.seedFile(CONFIG, jsonText(original));
        await writeProbe(deps, size);
        const once = memFs.peek(CONFIG);
        await writeProbe(deps, size);
        expect(memFs.peek(CONFIG)).toBe(once);
      }),
      { numRuns: 100 },
    );
  });
});
