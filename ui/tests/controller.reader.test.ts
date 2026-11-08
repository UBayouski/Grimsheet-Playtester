import { describe, expect, it } from 'vitest';
import { readRoute } from '../src/controller/reader';
import { makeFakeApi, makeFakeEnv } from './helpers/fake-env';

describe('readRoute', () => {
  it('gives the value of an answer', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'resolve', value: { a: 1 } });
    await expect(readRoute(api.api, '/x', fake.env, 10_000)).resolves.toEqual({ ok: true, value: { a: 1 } });
  });

  it('gives the error text of a rejected answer', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'reject', error: new Error('API 403: forbidden') });
    await expect(readRoute(api.api, '/x', fake.env, 10_000)).resolves.toEqual({ ok: false, error: 'API 403: forbidden' });
  });

  it('gives the fixed phrase for a rejection without a message', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'reject', error: 42 });
    await expect(readRoute(api.api, '/x', fake.env, 10_000)).resolves.toEqual({ ok: false, error: 'The request failed' });
  });

  it('gives the error text of a synchronous throw, and clears the timer', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'throw', error: new Error('not permitted: /x') });
    await expect(readRoute(api.api, '/x', fake.env, 10_000)).resolves.toEqual({ ok: false, error: 'not permitted: /x' });
    expect(fake.pendingTimers()).toBe(0);
  });

  it('redacts a token in the error text', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'reject', error: new Error('failed /x?token=abc') });
    expect(await readRoute(api.api, '/x', fake.env, 10_000)).toEqual({ ok: false, error: 'failed /x?token=…' });
  });

  it('gives the time-limit phrase when no answer comes within the limit', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'never' });
    let result: unknown = null;
    void readRoute(api.api, '/x', fake.env, 10_000).then((r) => (result = r));
    await fake.advance(9_999);
    expect(result).toBeNull();
    await fake.advance(1);
    expect(result).toEqual({ ok: false, error: 'The request took longer than 10 seconds' });
  });

  it('ignores an answer that comes after the limit', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'resolve', value: 'late', delayMs: 15_000 });
    const results: unknown[] = [];
    void readRoute(api.api, '/x', fake.env, 10_000).then((r) => results.push(r));
    await fake.advance(20_000);
    expect(results).toEqual([{ ok: false, error: 'The request took longer than 10 seconds' }]);
  });

  it('ignores a rejection that comes after the limit', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'reject', error: new Error('late failure'), delayMs: 15_000 });
    const results: unknown[] = [];
    void readRoute(api.api, '/x', fake.env, 10_000).then((r) => results.push(r));
    await fake.advance(20_000);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ok: false, error: 'The request took longer than 10 seconds' });
  });

  it('clears the timer after a fast answer, so nothing is left pending', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'resolve', value: 1, delayMs: 50 });
    const pending = readRoute(api.api, '/x', fake.env, 10_000);
    await fake.advance(50);
    await pending;
    expect(fake.pendingTimers()).toBe(0);
  });

  it('calls only get, once, with the path it was given', async () => {
    const fake = makeFakeEnv();
    const api = makeFakeApi(fake, { kind: 'resolve', value: null });
    await readRoute(api.api, '/api/crons', fake.env, 10_000);
    expect(api.calls).toEqual(['/api/crons']);
    expect(Object.keys(api.api)).toEqual(['get']);
  });
});