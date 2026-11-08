import { describe, expect, it } from 'vitest';
import { makeFakeApi, makeFakeEnv } from './fake-env';

describe('makeFakeEnv', () => {
  it('moves the clock only when advanced', async () => {
    const fake = makeFakeEnv(1000);
    expect(fake.env.nowMs()).toBe(1000);
    await fake.advance(250);
    expect(fake.env.nowMs()).toBe(1250);
  });

  it('runs timers in order of due time, with the clock at the due time', async () => {
    const fake = makeFakeEnv(0);
    const seen: Array<[string, number]> = [];
    fake.env.setTimeout(() => seen.push(['b', fake.env.nowMs()]), 200);
    fake.env.setTimeout(() => seen.push(['a', fake.env.nowMs()]), 100);
    fake.env.setTimeout(() => seen.push(['c', fake.env.nowMs()]), 300);
    await fake.advance(250);
    expect(seen).toEqual([['a', 100], ['b', 200]]);
    expect(fake.pendingTimers()).toBe(1);
    await fake.advance(100);
    expect(seen.at(-1)).toEqual(['c', 300]);
  });

  it('runs a timer that a timer sets, if it falls due inside the advance', async () => {
    const fake = makeFakeEnv(0);
    const seen: number[] = [];
    fake.env.setTimeout(() => {
      seen.push(fake.env.nowMs());
      fake.env.setTimeout(() => seen.push(fake.env.nowMs()), 50);
    }, 100);
    await fake.advance(200);
    expect(seen).toEqual([100, 150]);
  });

  it('does not run a cleared timer', async () => {
    const fake = makeFakeEnv(0);
    let ran = false;
    const handle = fake.env.setTimeout(() => (ran = true), 10);
    fake.env.clearTimeout(handle);
    await fake.advance(100);
    expect(ran).toBe(false);
    expect(fake.pendingTimers()).toBe(0);
  });

  it('tells the listeners when the visibility changes, and stops after unsubscribe', () => {
    const fake = makeFakeEnv();
    let count = 0;
    const off = fake.env.onVisibilityChange(() => (count += 1));
    expect(fake.env.isVisible()).toBe(true);
    fake.setVisible(false);
    expect(fake.env.isVisible()).toBe(false);
    expect(count).toBe(1);
    off();
    fake.setVisible(true);
    expect(count).toBe(1);
    expect(fake.listenerCount()).toBe(0);
  });
});

describe('makeFakeApi', () => {
  it('has only a get method, and records the paths', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'resolve', value: { ok: 1 } });
    expect(Object.keys(api.api)).toEqual(['get']);
    await expect(api.api.get('/a')).resolves.toEqual({ ok: 1 });
    await api.api.get('/b');
    expect(api.calls).toEqual(['/a', '/b']);
  });

  it('rejects, throws synchronously, and never settles, as the script says', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, (path) =>
      path === '/reject' ? { kind: 'reject', error: new Error('no') } : path === '/throw' ? { kind: 'throw', error: new Error('sync') } : { kind: 'never' },
    );
    await expect(api.api.get('/reject')).rejects.toThrow('no');
    expect(() => api.api.get('/throw')).toThrow('sync');
    let settled = false;
    void api.api.get('/never').then(() => (settled = true), () => (settled = true));
    await fake.advance(1_000_000);
    expect(settled).toBe(false);
    expect(api.inFlight()).toBe(1);
  });

  it('answers after the delay on the fake clock', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'resolve', value: 7, delayMs: 500 });
    let value: unknown = null;
    void api.api.get('/x').then((v) => (value = v));
    await fake.advance(499);
    expect(value).toBeNull();
    await fake.advance(1);
    expect(value).toBe(7);
    expect(api.inFlight()).toBe(0);
    expect(api.maxInFlight()).toBe(1);
  });
});