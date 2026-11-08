// @ts-check
import { describe, it, expect } from 'vitest';
import { acquireLock, releaseLock, lockCreatedMs } from '../scripts/file-lock.mjs';
import { makeFakeClock, makeMemFs, makeSleep, makeTokenSource } from './helpers/fake-fs.mjs';

const LOCK = '/app/data/.test.lock';
const T0 = Date.UTC(2026, 11, 1, 3, 0, 0);

function setup() {
  const clock = makeFakeClock(T0);
  const fs = makeMemFs({ clock });
  fs.seedDir('/app/data');
  /** @type {number[]} */
  const sleeps = [];
  const baseSleep = makeSleep(clock);
  const deps = {
    fs: /** @type {import('../scripts/replay/types.mjs').Fs} */ (fs),
    clock,
    sleep: async (/** @type {number} */ ms) => {
      sleeps.push(ms);
      await baseSleep(ms);
    },
    token: makeTokenSource(),
    pid: 4321,
  };
  return { clock, fs, deps, sleeps };
}

const opts = (/** @type {Partial<{staleAfterMs: number, waitMs: number, retryEveryMs: number}>} */ o = {}) => ({
  path: LOCK,
  staleAfterMs: 60000,
  waitMs: 0,
  retryEveryMs: 200,
  ...o,
});

/** @param {string} token @param {number} createdMs @param {number} [pid] @returns {string} */
const lockText = (token, createdMs, pid = 1) => JSON.stringify({ pid, token, createdAt: new Date(createdMs).toISOString() });

describe('acquireLock: a first take', () => {
  it('succeeds and the file holds {pid, token, createdAt}, a 32-hex token and no BOM', async () => {
    const { fs, deps } = setup();
    const r = await acquireLock(deps, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token).toMatch(/^[0-9a-f]{32}$/);
    const text = /** @type {string} */ (fs.peek(LOCK));
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    const content = JSON.parse(text);
    expect(content).toEqual({ pid: 4321, token: r.token, createdAt: new Date(T0).toISOString() });
  });

  it('release removes the lock', async () => {
    const { fs, deps } = setup();
    const r = await acquireLock(deps, opts());
    if (!r.ok) throw new Error('not acquired');
    await r.release();
    expect(fs.has(LOCK)).toBe(false);
  });
});

describe('acquireLock: a fresh lock', () => {
  it('gives held when waitMs is 0, and leaves the lock alone', async () => {
    const { fs, deps, sleeps } = setup();
    const text = lockText('a'.repeat(32), T0 - 1000);
    fs.seedFile(LOCK, text);
    expect(await acquireLock(deps, opts({ waitMs: 0 }))).toEqual({ ok: false, reason: 'held' });
    expect(fs.peek(LOCK)).toBe(text);
    expect(sleeps).toEqual([]);
  });

  it('with a wait it retries every 200 ms on the fake clock and gives timeout', async () => {
    const { clock, fs, deps, sleeps } = setup();
    const text = lockText('a'.repeat(32), T0);
    fs.seedFile(LOCK, text);
    const r = await acquireLock(deps, opts({ waitMs: 1000, staleAfterMs: 600000 }));
    expect(r).toEqual({ ok: false, reason: 'timeout' });
    expect(sleeps).toEqual([200, 200, 200, 200, 200]);
    expect(clock.nowMs()).toBe(T0 + 1000);
    expect(fs.peek(LOCK)).toBe(text);
  });

  it('takes the lock when the holder releases it during the wait', async () => {
    const { fs, deps } = setup();
    fs.seedFile(LOCK, lockText('a'.repeat(32), T0));
    let n = 0;
    const sleepAndRelease = async () => {
      n += 1;
      if (n === 2) await fs.rm(LOCK, { force: true });
    };
    const r = await acquireLock({ ...deps, sleep: sleepAndRelease }, opts({ waitMs: 5000, staleAfterMs: 600000 }));
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });
});

describe('acquireLock: a stale lock', () => {
  it('older than staleAfterMs by createdAt is moved to <lock>.stale-<token>, removed, and the take succeeds', async () => {
    const { fs, deps } = setup();
    fs.seedFile(LOCK, lockText('b'.repeat(32), T0 - 61000));
    /** @type {string[]} */
    const log = [];
    const logged = { ...deps, fs: fs.withGate(async (l) => void log.push(l)) };
    const r = await acquireLock(logged, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rename = log.find((l) => l.startsWith('rename '));
    expect(rename).toBe(`rename ${LOCK} ${LOCK}.stale-${r.token}`);
    expect(fs.paths('/app/data')).toEqual([LOCK]);
    expect(JSON.parse(/** @type {string} */ (fs.peek(LOCK))).token).toBe(r.token);
  });

  it('exactly staleAfterMs old is still fresh', async () => {
    const { fs, deps } = setup();
    fs.seedFile(LOCK, lockText('b'.repeat(32), T0 - 60000));
    expect(await acquireLock(deps, opts())).toEqual({ ok: false, reason: 'held' });
  });

  it('with content that does not parse, the age comes from the modification time', async () => {
    const stale = setup();
    stale.fs.seedFile(LOCK, 'garbage', { mtimeMs: T0 - 120000 });
    expect((await acquireLock(stale.deps, opts())).ok).toBe(true);
    const fresh = setup();
    fresh.fs.seedFile(LOCK, 'garbage', { mtimeMs: T0 - 1000 });
    expect(await acquireLock(fresh.deps, opts())).toEqual({ ok: false, reason: 'held' });
  });

  it('puts back a moved lock whose content differs from the one read', async () => {
    const { fs, deps } = setup();
    fs.seedFile(LOCK, lockText('c'.repeat(32), T0 - 120000));
    const newer = lockText('d'.repeat(32), T0);
    let swapped = false;
    const swapping = fs.withGate(async (label) => {
      if (label.startsWith('rename ') && !swapped) {
        swapped = true;
        fs.seedFile(LOCK, newer); // another process replaced the stale lock just before our rename
      }
    });
    const r = await acquireLock({ ...deps, fs: swapping }, opts());
    expect(r).toEqual({ ok: false, reason: 'held' });
    expect(fs.peek(LOCK)).toBe(newer);
    expect(fs.paths('/app/data')).toEqual([LOCK]);
  });
});

describe('acquireLock: other errors', () => {
  it('gives io_error for a file-system error other than EEXIST', async () => {
    const { fs, deps } = setup();
    const failing = { ...fs, writeFile: async () => { throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' }); } };
    expect(await acquireLock({ ...deps, fs: /** @type {any} */ (failing) }, opts())).toEqual({ ok: false, reason: 'io_error' });
  });

  it('gives io_error when the folder of the lock does not exist', async () => {
    const { deps } = setup();
    expect(await acquireLock(deps, { ...opts(), path: '/nowhere/.x.lock' })).toEqual({ ok: false, reason: 'io_error' });
  });

  it('gives io_error when the stale lock cannot be moved for a reason other than a missing file', async () => {
    const { fs, deps } = setup();
    fs.seedFile(LOCK, lockText('b'.repeat(32), T0 - 120000));
    const failing = { ...fs, rename: async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } };
    expect(await acquireLock({ ...deps, fs: /** @type {any} */ (failing) }, opts())).toEqual({ ok: false, reason: 'io_error' });
  });
});

describe('releaseLock', () => {
  it('removes the file only when it holds the token', async () => {
    const { fs, deps } = setup();
    const mine = 'e'.repeat(32);
    fs.seedFile(LOCK, lockText(mine, T0));
    expect(await releaseLock(deps, LOCK, 'f'.repeat(32))).toBe(false);
    expect(fs.has(LOCK)).toBe(true);
    expect(await releaseLock(deps, LOCK, mine)).toBe(true);
    expect(fs.has(LOCK)).toBe(false);
  });

  it('returns false for a missing lock and for content that does not parse', async () => {
    const { fs, deps } = setup();
    expect(await releaseLock(deps, LOCK, 'a'.repeat(32))).toBe(false);
    fs.seedFile(LOCK, 'garbage');
    expect(await releaseLock(deps, LOCK, 'a'.repeat(32))).toBe(false);
    expect(fs.has(LOCK)).toBe(true);
  });

  it('a holder whose lock was taken over does not remove the new lock', async () => {
    const { fs, deps } = setup();
    const old = await acquireLock(deps, opts());
    if (!old.ok) throw new Error('not acquired');
    deps.clock.advance(120000);
    const next = await acquireLock(deps, opts());
    expect(next.ok).toBe(true);
    await old.release();
    expect(fs.has(LOCK)).toBe(true);
    expect(JSON.parse(/** @type {string} */ (fs.peek(LOCK))).token).toBe(next.ok ? next.token : '');
  });
});

describe('lockCreatedMs', () => {
  it('reads createdAt from valid JSON', () => {
    expect(lockCreatedMs(lockText('a'.repeat(32), T0), 5)).toBe(T0);
  });

  it('falls back to the modification time for bad JSON, a missing createdAt or an unparsable createdAt', () => {
    expect(lockCreatedMs('garbage', 1234)).toBe(1234);
    expect(lockCreatedMs('{"pid":1}', 1234)).toBe(1234);
    expect(lockCreatedMs('{"createdAt":"nope"}', 1234)).toBe(1234);
    expect(lockCreatedMs('[1]', 1234)).toBe(1234);
  });

  it('is null when there is no usable content and no modification time', () => {
    expect(lockCreatedMs(null, null)).toBeNull();
    expect(lockCreatedMs('garbage', null)).toBeNull();
    expect(lockCreatedMs(null, 99)).toBe(99);
  });
});
