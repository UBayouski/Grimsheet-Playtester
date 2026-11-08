// @ts-check
// Unit tests for scripts/hunt/hunt-store.mjs (exploit-hunt, task 11.1). In-memory file system and fake clock only.
// The module does not exist until task 11.2, so this file fails to load until then.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clearActive,
  huntPaths,
  markStaleRunningCutShort,
  pruneCandidateFolders,
  pruneHuntRecords,
  readActive,
  readHuntRecord,
  resolveActiveHunt,
  withCallLock,
  writeActive,
  writeCandidateFile,
  writeHuntRecord,
  writeJsonAtomic,
} from '../scripts/hunt/hunt-store.mjs';
import { HUNT_RECORD_PATTERN, huntIdOf, newHuntRecord } from '../scripts/hunt/hunt-record.mjs';
import { APP_NAME, DATA_FOLDER, HUNT_CHECKOUT, HUNT_LOCAL_FOLDER, LOCAL_APP_DATA, makeHuntWorld } from './helpers/hunt-world.mjs';
import { CLASS_NAMES, arbHuntHistory } from './hunt.arbitraries.mjs';

const LOCK_AGE_MS = 2400 * 1000;
const HUNTS = `${DATA_FOLDER}\\hunts`;
const LOCK = `${DATA_FOLDER}\\.hunt.lock`;
const CALL_LOCK = `${DATA_FOLDER}\\.hunt-call.lock`;
const ACTIVE = `${HUNTS}\\active.json`;
const CANDIDATES = `${HUNT_LOCAL_FOLDER}\\candidates`;
const TOKEN = '9f3c0a51d2b84e67a1c05be3f7d92a48';

/** Compare paths without caring about the separator. @param {string} s */
const slash = (s) => s.replace(/\\/g, '/');
/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString();

/** A world with `data\hunts\` present. */
function setup() {
  const world = makeHuntWorld();
  world.fs.seedDir(HUNTS);
  return world;
}

/**
 * @param {string} huntId
 * @param {number} startedMs
 * @param {string} [state]
 * @returns {any}
 */
function record(huntId, startedMs, state = 'running') {
  return { ...newHuntRecord({ huntId, startedAt: iso(startedMs), repoUrl: 'https://example.invalid/g', branch: 'main' }), state };
}

/** @param {ReturnType<typeof setup>} w @param {any} rec */
function seedRecord(w, rec) {
  w.fs.seedFile(`${HUNTS}\\${rec.huntId}.json`, JSON.stringify(rec, null, 2) + '\n');
}

/** @param {ReturnType<typeof setup>} w @param {string} token @param {number} createdMs */
function seedLock(w, token, createdMs, path = LOCK) {
  w.fs.seedFile(path, JSON.stringify({ pid: 1, token, createdAt: iso(createdMs) }));
}

/** @param {ReturnType<typeof setup>} w @param {string} huntId */
function seedActive(w, huntId, token = TOKEN, readyAt = iso(w.clock.nowMs() - 5000)) {
  w.fs.seedFile(ACTIVE, JSON.stringify({ schemaVersion: 1, huntId, token, readyAt }));
}

describe('huntPaths', () => {
  it('builds every path from deps.paths and the app name', () => {
    const w = setup();
    const p = huntPaths(w.deps);
    expect(slash(p.dataFolder)).toBe(slash(DATA_FOLDER));
    expect(slash(p.huntsFolder)).toBe(slash(HUNTS));
    expect(slash(p.lockPath)).toBe(slash(LOCK));
    expect(slash(p.callLockPath)).toBe(slash(CALL_LOCK));
    expect(slash(p.activePath)).toBe(slash(ACTIVE));
    expect(slash(p.huntLocalFolder)).toBe(slash(`${LOCAL_APP_DATA}\\${APP_NAME}\\hunt`));
    expect(slash(p.checkoutDir)).toBe(slash(HUNT_CHECKOUT));
    expect(slash(p.candidatesFolder)).toBe(slash(CANDIDATES));
  });

  it('follows deps.paths when they change', () => {
    const w = setup();
    const deps = { ...w.deps, paths: { appFolder: 'D:\\X', dataFolder: 'D:\\X\\data', localAppData: 'D:\\L' } };
    const p = huntPaths(deps);
    expect(slash(p.lockPath)).toBe('D:/X/data/.hunt.lock');
    expect(slash(p.candidatesFolder)).toBe(`D:/L/${APP_NAME}/hunt/candidates`);
  });
});

describe('writeJsonAtomic', () => {
  it('writes a temp file in the same folder, then renames it onto the final path', async () => {
    const w = setup();
    /** @type {string[]} */
    const log = [];
    const deps = { ...w.deps, fs: w.fs.withGate(async (label) => void log.push(label)) };
    const target = `${HUNTS}\\x.json`;
    await writeJsonAtomic(deps, target, { a: 1 });
    const write = log.find((l) => l.startsWith('writeFile '));
    const rename = log.find((l) => l.startsWith('rename '));
    expect(write).toBeDefined();
    expect(rename).toBeDefined();
    const tmp = slash(/** @type {string} */ (write).slice('writeFile '.length));
    expect(tmp).toMatch(new RegExp(`^${slash(HUNTS)}/\\.x\\.json\\.[0-9a-f]{32}\\.tmp$|^${slash(HUNTS)}/\\.x\\.[0-9a-f]{32}\\.tmp$`));
    expect(log.indexOf(/** @type {string} */ (write))).toBeLessThan(log.indexOf(/** @type {string} */ (rename)));
    expect(slash(/** @type {string} */ (rename))).toBe(`rename ${tmp} ${slash(target)}`);
    expect(w.fs.has(tmp)).toBe(false);
  });

  it('uses the token as the temp-name part', async () => {
    const w = setup();
    /** @type {string[]} */
    const log = [];
    const deps = { ...w.deps, token: () => 'ab'.repeat(16), fs: w.fs.withGate(async (label) => void log.push(label)) };
    await writeJsonAtomic(deps, `${HUNTS}\\y.json`, 1);
    expect(slash(log.find((l) => l.startsWith('writeFile ')) ?? '')).toMatch(/\/\.y[^/]*\.abababababababababababababababab\.tmp$/);
  });

  it('writes UTF-8 without a BOM, two-space indent and a trailing newline', async () => {
    const w = setup();
    const target = `${HUNTS}\\z.json`;
    await writeJsonAtomic(w.deps, target, { a: [1, 2], b: 'é' });
    const text = /** @type {string} */ (w.fs.peek(target));
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).toBe(JSON.stringify({ a: [1, 2], b: 'é' }, null, 2) + '\n');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('replaces an existing file', async () => {
    const w = setup();
    const target = `${HUNTS}\\r.json`;
    w.fs.seedFile(target, 'old');
    await writeJsonAtomic(w.deps, target, { n: 2 });
    expect(JSON.parse(/** @type {string} */ (w.fs.peek(target)))).toEqual({ n: 2 });
    expect(w.fs.paths(HUNTS)).toHaveLength(1);
  });
});

describe('readHuntRecord / writeHuntRecord', () => {
  it('returns null when the record is missing', async () => {
    const w = setup();
    expect(await readHuntRecord(w.deps, 'hunt-20261108T110312Z')).toBeNull();
  });

  it('returns null when the file is not an object', async () => {
    const w = setup();
    for (const [i, text] of ['[1,2]', '"x"', '7', 'null', 'not json'].entries()) {
      const id = `hunt-2026110${i + 1}T000000Z`;
      w.fs.seedFile(`${HUNTS}\\${id}.json`, text);
      expect(await readHuntRecord(w.deps, id)).toBeNull();
    }
  });

  it('round-trips a record at data\\hunts\\<Hunt_Id>.json', async () => {
    const w = setup();
    const rec = record('hunt-20261108T110312Z', w.clock.nowMs());
    await writeHuntRecord(w.deps, rec);
    const text = /** @type {string} */ (w.fs.peek(`${HUNTS}\\hunt-20261108T110312Z.json`));
    expect(text).toBe(JSON.stringify(rec, null, 2) + '\n');
    expect(await readHuntRecord(w.deps, 'hunt-20261108T110312Z')).toEqual(rec);
  });

  it('overwrites the previous record of the same Hunt_Id', async () => {
    const w = setup();
    const rec = record('hunt-20261108T110312Z', w.clock.nowMs());
    await writeHuntRecord(w.deps, rec);
    await writeHuntRecord(w.deps, { ...rec, attempts: 3 });
    expect((await readHuntRecord(w.deps, rec.huntId))?.attempts).toBe(3);
  });
});

describe('markStaleRunningCutShort', () => {
  it('changes only running records that are older than 2400 s', async () => {
    const w = setup();
    const now = w.clock.nowMs();
    const old = record('hunt-20261101T000000Z', now - LOCK_AGE_MS - 60000);
    const young = record('hunt-20261102T000000Z', now - 60000);
    const doneOld = record('hunt-20261103T000000Z', now - LOCK_AGE_MS - 60000, 'complete');
    const failedOld = record('hunt-20261104T000000Z', now - LOCK_AGE_MS - 60000, 'failed');
    for (const r of [old, young, doneOld, failedOld]) seedRecord(w, r);
    w.fs.seedFile(`${HUNTS}\\notes.txt`, 'keep');
    const before = w.fs.snapshot();

    await markStaleRunningCutShort(w.deps, now);

    expect((await readHuntRecord(w.deps, old.huntId))?.state).toBe('cut-short');
    const after = w.fs.snapshot();
    for (const r of [young, doneOld, failedOld]) {
      const key = slash(`${HUNTS}\\${r.huntId}.json`);
      expect(after[key]).toBe(before[key]);
    }
    expect(after[slash(`${HUNTS}\\notes.txt`)]).toBe('keep');
  });

  it('keeps a running record exactly 2400 s old', async () => {
    const w = setup();
    const now = w.clock.nowMs();
    const r = record('hunt-20261101T000000Z', now - LOCK_AGE_MS);
    seedRecord(w, r);
    const before = w.fs.snapshot();
    await markStaleRunningCutShort(w.deps, now);
    expect(w.fs.snapshot()).toEqual(before);
    expect((await readHuntRecord(w.deps, r.huntId))?.state).toBe('running');
  });

  it('cuts short a running record 2400 s + 1 ms old', async () => {
    const w = setup();
    const now = w.clock.nowMs();
    const r = record('hunt-20261101T000000Z', now - LOCK_AGE_MS - 1);
    seedRecord(w, r);
    await markStaleRunningCutShort(w.deps, now);
    expect((await readHuntRecord(w.deps, r.huntId))?.state).toBe('cut-short');
  });

  it('does nothing when data\\hunts\\ is empty', async () => {
    const w = setup();
    await markStaleRunningCutShort(w.deps, w.clock.nowMs());
    expect(w.fs.paths(HUNTS)).toEqual([]);
  });
});

describe('pruneHuntRecords', () => {
  it('keeps the 10 highest Hunt_Ids and leaves other names alone', async () => {
    const w = setup();
    const base = Date.UTC(2026, 10, 1, 0, 0, 0);
    const ids = Array.from({ length: 13 }, (_, i) => huntIdOf(base + i * 86400000));
    for (const id of ids) seedRecord(w, record(id, base));
    w.fs.seedFile(ACTIVE, '{"schemaVersion":1}');
    w.fs.seedFile(`${HUNTS}\\.${ids[0]}.json.${TOKEN}.tmp`, 'tmp');
    w.fs.seedFile(`${HUNTS}\\notes.txt`, 'note');
    w.fs.seedFile(`${HUNTS}\\hunt-bad.json`, '{}');

    await pruneHuntRecords(w.deps);

    const left = (await w.fs.readdir(HUNTS)).filter((n) => HUNT_RECORD_PATTERN.test(n));
    expect(left).toEqual(ids.slice(3).map((id) => `${id}.json`));
    expect(w.fs.has(ACTIVE)).toBe(true);
    expect(w.fs.has(`${HUNTS}\\.${ids[0]}.json.${TOKEN}.tmp`)).toBe(true);
    expect(w.fs.has(`${HUNTS}\\notes.txt`)).toBe(true);
    expect(w.fs.has(`${HUNTS}\\hunt-bad.json`)).toBe(true);
  });

  it('removes nothing when there are 10 records or fewer', async () => {
    const w = setup();
    const base = Date.UTC(2026, 10, 1, 0, 0, 0);
    for (let i = 0; i < 10; i += 1) seedRecord(w, record(huntIdOf(base + i * 86400000), base));
    const before = w.fs.snapshot();
    await pruneHuntRecords(w.deps);
    expect(w.fs.snapshot()).toEqual(before);
  });
});

describe('pruneCandidateFolders', () => {
  it('keeps the 10 highest matching folders, removes older ones recursively, nothing else', async () => {
    const w = setup();
    const base = Date.UTC(2026, 10, 1, 0, 0, 0);
    const names = Array.from({ length: 12 }, (_, i) => huntIdOf(base + i * 86400000));
    for (const n of names) {
      w.fs.seedFile(`${CANDIDATES}\\${n}\\001-a-free_win.json`, '{}');
      w.fs.seedFile(`${CANDIDATES}\\${n}\\002-a-cheaper_win.json`, '{}');
    }
    w.fs.seedFile(`${CANDIDATES}\\other\\keep.json`, '{}');
    w.fs.seedFile(`${CANDIDATES}\\hunt-2026110T000000Z\\keep.json`, '{}');
    w.fs.seedFile(`${CANDIDATES}\\loose.txt`, 'x');

    await pruneCandidateFolders(w.deps);

    const left = await w.fs.readdir(CANDIDATES);
    const matching = left.filter((n) => /^hunt-\d{8}T\d{6}Z$/.test(n));
    expect(matching).toEqual(names.slice(2));
    expect(w.fs.paths(`${CANDIDATES}\\${names[0]}`)).toEqual([]);
    expect(w.fs.paths(`${CANDIDATES}\\${names[1]}`)).toEqual([]);
    expect(w.fs.has(`${CANDIDATES}\\other\\keep.json`)).toBe(true);
    expect(w.fs.has(`${CANDIDATES}\\hunt-2026110T000000Z\\keep.json`)).toBe(true);
    expect(w.fs.has(`${CANDIDATES}\\loose.txt`)).toBe(true);
  });

  it('does not fail when the candidates folder is missing', async () => {
    const w = setup();
    await expect(pruneCandidateFolders(w.deps)).resolves.not.toThrow();
  });
});

describe('readActive / writeActive / clearActive', () => {
  it('readActive returns null when active.json is missing or not parseable', async () => {
    const w = setup();
    expect(await readActive(w.deps)).toBeNull();
    w.fs.seedFile(ACTIVE, 'not json');
    expect(await readActive(w.deps)).toBeNull();
    w.fs.seedFile(ACTIVE, '[1]');
    expect(await readActive(w.deps)).toBeNull();
  });

  it('writeActive then readActive round-trips huntId, token and readyAt', async () => {
    const w = setup();
    const pointer = { schemaVersion: /** @type {1} */ (1), huntId: 'hunt-20261108T110312Z', token: TOKEN, readyAt: '2026-11-08T11:03:19.870Z' };
    await writeActive(w.deps, pointer);
    expect(JSON.parse(/** @type {string} */ (w.fs.peek(ACTIVE)))).toEqual(pointer);
    expect(await readActive(w.deps)).toMatchObject({ huntId: pointer.huntId, token: TOKEN, readyAt: pointer.readyAt });
  });

  it('clearActive removes active.json and does not fail when it is missing', async () => {
    const w = setup();
    seedActive(w, 'hunt-20261108T110312Z');
    await clearActive(w.deps);
    expect(w.fs.has(ACTIVE)).toBe(false);
    await expect(clearActive(w.deps)).resolves.not.toThrow();
  });
});

describe('resolveActiveHunt', () => {
  const huntId = 'hunt-20261108T110312Z';

  it('succeeds when all four checks pass', async () => {
    const w = setup();
    const now = w.clock.nowMs();
    const readyAt = iso(now - 5000);
    seedActive(w, huntId, TOKEN, readyAt);
    seedLock(w, TOKEN, now - 10000);
    const rec = record(huntId, now - 10000);
    seedRecord(w, rec);
    const res = await resolveActiveHunt(w.deps);
    expect(res).toEqual({ ok: true, hunt: { huntId, token: TOKEN, readyAtMs: Date.parse(readyAt), record: rec } });
  });

  it('check 1: fails with no active.json', async () => {
    const w = setup();
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('check 1: fails when active.json does not parse', async () => {
    const w = setup();
    w.fs.seedFile(ACTIVE, '{oops');
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('check 2: fails when there is no lock file', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedRecord(w, record(huntId, w.clock.nowMs()));
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('check 2: fails when the lock token differs from the pointer token', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, '0'.repeat(32), w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('check 3: a lock exactly 2400 s old is still live', async () => {
    const w = setup();
    const now = w.clock.nowMs();
    seedActive(w, huntId);
    seedLock(w, TOKEN, now - LOCK_AGE_MS);
    seedRecord(w, record(huntId, now - LOCK_AGE_MS));
    const res = await resolveActiveHunt(w.deps);
    expect(res.ok).toBe(true);
  });

  it('check 3: a lock 2400 s + 1 ms old is stale', async () => {
    const w = setup();
    const now = w.clock.nowMs();
    seedActive(w, huntId);
    seedLock(w, TOKEN, now - LOCK_AGE_MS - 1);
    seedRecord(w, record(huntId, now - LOCK_AGE_MS - 1));
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('check 4: fails when the Hunt_Record is missing', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, TOKEN, w.clock.nowMs());
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('check 4: fails when the Hunt_Record is not running', async () => {
    const w = setup();
    for (const state of ['complete', 'failed', 'cut-short']) {
      seedActive(w, huntId);
      seedLock(w, TOKEN, w.clock.nowMs());
      seedRecord(w, record(huntId, w.clock.nowMs(), state));
      expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
    }
  });

  it('check 4: fails when the Hunt_Record is not an object', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, TOKEN, w.clock.nowMs());
    w.fs.seedFile(`${HUNTS}\\${huntId}.json`, '[]');
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  /** A fs whose readFile or stat fails with `code` for one path. */
  function faultOn(/** @type {ReturnType<typeof setup>} */ w, /** @type {string} */ target, /** @type {string} */ code, method = 'readFile') {
    const real = w.deps.fs;
    w.deps.fs = {
      ...real,
      async [method](/** @type {string} */ p, /** @type {any} */ ...rest) {
        if (p === target) throw Object.assign(new Error('denied'), { code });
        return /** @type {any} */ (real)[method](p, ...rest);
      },
    };
  }

  it.each(['EACCES', 'EBUSY', 'EIO'])('throws (is not "no active hunt") when active.json cannot be read: %s', async (code) => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    faultOn(w, ACTIVE, code);
    await expect(resolveActiveHunt(w.deps)).rejects.toMatchObject({ code });
  });

  it('throws when the lock file cannot be read (EACCES)', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    faultOn(w, LOCK, 'EACCES');
    await expect(resolveActiveHunt(w.deps)).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('throws when the lock cannot be stat-ed for another reason than ENOENT (EIO)', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    faultOn(w, LOCK, 'EIO', 'stat');
    await expect(resolveActiveHunt(w.deps)).rejects.toMatchObject({ code: 'EIO' });
  });

  it('a lock whose stat gives ENOENT is a missing lock: no active hunt', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    faultOn(w, LOCK, 'ENOENT', 'stat');
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('throws when the Hunt_Record cannot be read (EACCES)', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    faultOn(w, `${HUNTS}\\${huntId}.json`, 'EACCES');
    await expect(resolveActiveHunt(w.deps)).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('still answers {ok:false} for ENOENT on active.json and for unparseable active.json and lock', async () => {
    const w = setup();
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
    seedLock(w, TOKEN, w.clock.nowMs());
    seedRecord(w, record(huntId, w.clock.nowMs()));
    w.fs.seedFile(ACTIVE, '{oops');
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
    seedActive(w, huntId);
    w.fs.seedFile(LOCK, '{oops');
    expect(await resolveActiveHunt(w.deps)).toEqual({ ok: false });
  });

  it('touches nothing (read only)', async () => {
    const w = setup();
    seedActive(w, huntId);
    seedLock(w, '1'.repeat(32), w.clock.nowMs() - LOCK_AGE_MS - 5000);
    seedRecord(w, record(huntId, w.clock.nowMs()));
    const before = w.fs.snapshot();
    await resolveActiveHunt(w.deps);
    expect(w.fs.snapshot()).toEqual(before);
  });
});

describe('withCallLock', () => {
  it('runs the body under the lock and returns its value', async () => {
    const w = setup();
    let held = false;
    const res = await withCallLock(w.deps, async () => {
      held = w.fs.has(CALL_LOCK);
      return 42;
    });
    expect(res).toEqual({ ok: true, value: 42 });
    expect(held).toBe(true);
  });

  it('releases the lock after the body', async () => {
    const w = setup();
    await withCallLock(w.deps, async () => 'x');
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it('releases the lock when the body throws, and the error reaches the caller', async () => {
    const w = setup();
    await expect(
      withCallLock(w.deps, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it('returns busy when a fresh lock stays held for the 45 s wait, and does not run the body', async () => {
    const w = setup();
    const start = w.clock.nowMs();
    seedLock(w, 'f'.repeat(32), start, CALL_LOCK);
    let ran = false;
    const res = await withCallLock(w.deps, async () => {
      ran = true;
      return 1;
    });
    expect(res).toEqual({ ok: false, reason: 'busy' });
    expect(ran).toBe(false);
    expect(w.clock.nowMs() - start).toBeGreaterThanOrEqual(45000);
    expect(w.fs.has(CALL_LOCK)).toBe(true); // the other holder's lock is not removed
  });

  it('takes over a call lock older than 60 s', async () => {
    const w = setup();
    seedLock(w, 'f'.repeat(32), w.clock.nowMs() - 60001, CALL_LOCK);
    const res = await withCallLock(w.deps, async () => 'ok');
    expect(res).toEqual({ ok: true, value: 'ok' });
    expect(w.fs.has(CALL_LOCK)).toBe(false);
  });

  it('returns io_error when the lock file cannot be created', async () => {
    const w = setup();
    const fs = {
      ...w.fs,
      writeFile: async () => {
        throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' });
      },
    };
    let ran = false;
    const res = await withCallLock({ ...w.deps, fs: /** @type {any} */ (fs) }, async () => {
      ran = true;
      return 1;
    });
    expect(res).toEqual({ ok: false, reason: 'io_error' });
    expect(ran).toBe(false);
  });
});

describe('writeCandidateFile', () => {
  const huntId = 'hunt-20261108T110312Z';
  /** @type {import('../scripts/hunt/types.mjs').Action[]} */
  const actions = [
    { kind: 'edit', address: 'B14', raw: '7' },
    { kind: 'move', dir: 'E' },
  ];

  it('writes <candidates>\\<Hunt_Id>\\NNN-<level>-<class>.json and returns the absolute path', async () => {
    const w = setup();
    const file = await writeCandidateFile(w.deps, huntId, 7, '02-the-chaser', 'cheaper_win', actions);
    expect(slash(file)).toBe(slash(`${CANDIDATES}\\${huntId}\\007-02-the-chaser-cheaper_win.json`));
    expect(w.fs.has(file)).toBe(true);
  });

  it('writes {levelId, claimedClass, actions} as JSON', async () => {
    const w = setup();
    const file = await writeCandidateFile(w.deps, huntId, 7, '02-the-chaser', 'cheaper_win', actions);
    const text = /** @type {string} */ (w.fs.peek(file));
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(JSON.parse(text)).toEqual({ levelId: '02-the-chaser', claimedClass: 'cheaper_win', actions });
    expect(text).toBe(JSON.stringify({ levelId: '02-the-chaser', claimedClass: 'cheaper_win', actions }, null, 2) + '\n');
  });

  it('pads the Attempt number to three digits for each class', async () => {
    const w = setup();
    for (const [i, cls] of CLASS_NAMES.entries()) {
      const file = await writeCandidateFile(w.deps, huntId, i + 1, 'x1', cls, actions);
      expect(slash(file).endsWith(`/00${i + 1}-x1-${cls}.json`)).toBe(true);
    }
  });

  it('is atomic: a temp file is written first, renamed, and none is left', async () => {
    const w = setup();
    /** @type {string[]} */
    const log = [];
    const deps = { ...w.deps, fs: w.fs.withGate(async (label) => void log.push(label)) };
    const file = await writeCandidateFile(deps, huntId, 1, 'x1', 'free_win', actions);
    const w1 = log.findIndex((l) => l.startsWith('writeFile ') && l.endsWith('.tmp'));
    const r1 = log.findIndex((l) => l.startsWith('rename ') && slash(l).endsWith(` ${slash(file)}`));
    expect(w1).toBeGreaterThanOrEqual(0);
    expect(r1).toBeGreaterThan(w1);
    expect(w.fs.paths(`${CANDIDATES}\\${huntId}`)).toEqual([slash(file)]);
  });
});

describe('pruneHuntRecords properties', () => {
  /** Files that do not match the record pattern: active.json, temp files of records, and other names. */
  const arbHex32 = fc.stringMatching(/^[0-9a-f]{32}$/);
  const arbOtherNames = fc.uniqueArray(fc.constantFrom('notes.txt', 'hunt-bad.json', 'hunt-20261108T110312Z.json.bak', 'README', 'hunt-1.json'), { maxLength: 5 });
  const arbContent = fc.string({ maxLength: 40 });

  // Feature: exploit-hunt, Property 12: Hunt records are bounded
  it('Property 12: after the prune step at most 10 record files remain, they have the highest Hunt_Ids, and all other files are unchanged', async () => {
    // **Validates: Requirements 11.9, 11.7**
    await fc.assert(
      fc.asyncProperty(
        arbHuntHistory,
        fc.boolean(),
        fc.array(fc.tuple(arbHex32, arbContent), { maxLength: 4 }),
        arbOtherNames,
        arbContent,
        async (history, withActive, tmpSpecs, otherNames, content) => {
          const w = setup();
          for (const rec of history) seedRecord(w, rec);
          if (withActive) w.fs.seedFile(ACTIVE, content);
          history.slice(0, tmpSpecs.length).forEach((rec, i) => {
            w.fs.seedFile(`${HUNTS}\\.${rec.huntId}.json.${tmpSpecs[i][0]}.tmp`, tmpSpecs[i][1]);
          });
          for (const name of otherNames) w.fs.seedFile(`${HUNTS}\\${name}`, content);

          const before = w.fs.snapshot();
          const isRecordPath = (/** @type {string} */ p) => HUNT_RECORD_PATTERN.test(slash(p).split('/').pop() ?? '');

          // Independent expectation: sort the ids as numbers made of their digits, keep the 10 largest.
          const digits = (/** @type {string} */ id) => Number(id.replace(/\D/g, ''));
          const expectedKept = history
            .map((r) => r.huntId)
            .sort((a, b) => digits(b) - digits(a))
            .slice(0, 10)
            .map((id) => `${id}.json`)
            .sort();

          await pruneHuntRecords(w.deps);

          const after = w.fs.snapshot();
          const left = Object.keys(after).filter(isRecordPath).map((p) => slash(p).split('/').pop() ?? '').sort();
          expect(left.length).toBeLessThanOrEqual(10);
          expect(left).toEqual(expectedKept);
          for (const [p, text] of Object.entries(before)) {
            if (!isRecordPath(p)) expect(after[p]).toBe(text);
          }
          for (const name of left) {
            const key = Object.keys(before).find((p) => slash(p).endsWith(`/${name}`));
            expect(after[/** @type {string} */ (key)]).toBe(before[/** @type {string} */ (key)]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
