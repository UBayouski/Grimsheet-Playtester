import { describe, expect, it } from 'vitest';
import { COPIED_CLEAR_MS, copyMessage, copyReducer, copyText, type CopyState } from '../src/controller/copy';

describe('copyText', () => {
  it('uses writeText and does not try the selection copy when it works', async () => {
    const calls: string[] = [];
    const result = await copyText('abc', {
      writeText: async (text) => void calls.push(`write:${text}`),
      selectionCopy: (text) => (calls.push(`select:${text}`), true),
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['write:abc']);
  });

  it('falls back to the selection copy when writeText is missing, rejects or throws', async () => {
    const select = (text: string): boolean => text === 'abc';
    expect(await copyText('abc', { selectionCopy: select })).toEqual({ ok: true });
    expect(await copyText('abc', { writeText: () => Promise.reject(new Error('denied')), selectionCopy: select })).toEqual({ ok: true });
    expect(
      await copyText('abc', {
        writeText: () => {
          throw new Error('sync');
        },
        selectionCopy: select,
      }),
    ).toEqual({ ok: true });
  });

  it('is not ok when the selection copy returns false, throws or is missing', async () => {
    expect(await copyText('abc', { writeText: () => Promise.reject(new Error('x')), selectionCopy: () => false })).toEqual({ ok: false });
    expect(
      await copyText('abc', {
        selectionCopy: () => {
          throw new Error('x');
        },
      }),
    ).toEqual({ ok: false });
    expect(await copyText('abc', {})).toEqual({ ok: false });
  });

  it('never throws', async () => {
    await expect(
      copyText('abc', {
        writeText: () => {
          throw 5;
        },
        selectionCopy: () => {
          throw null;
        },
      }),
    ).resolves.toEqual({ ok: false });
  });
});

describe('copy state', () => {
  const idle: CopyState = { kind: 'idle', seq: 0 };

  it('clears the message after 3 seconds', () => {
    expect(COPIED_CLEAR_MS).toBe(3000);
  });

  it('success gives copied with the message Copied', () => {
    const state = copyReducer(idle, { type: 'success' });
    expect(state.kind).toBe('copied');
    expect(copyMessage(state)).toBe('Copied');
  });

  it('failure gives the fallback with the message and the text to show', () => {
    const state = copyReducer(idle, { type: 'failure', text: 'node scripts/play.mjs x' });
    expect(state).toMatchObject({ kind: 'fallback', text: 'node scripts/play.mjs x' });
    expect(copyMessage(state)).toBe('Copy is not available here. Select the text and press Ctrl+C.');
  });

  it('idle has no message', () => {
    expect(copyMessage(idle)).toBe('');
  });

  it('clear removes a copied message of the same copy', () => {
    const copied = copyReducer(idle, { type: 'success' });
    expect(copyReducer(copied, { type: 'clear', seq: copied.seq }).kind).toBe('idle');
  });

  it('a newer copy replaces the earlier state, and the earlier clear does not remove the newer message', () => {
    const first = copyReducer(idle, { type: 'success' });
    const second = copyReducer(first, { type: 'success' });
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(copyReducer(second, { type: 'clear', seq: first.seq })).toBe(second);
    expect(copyReducer(second, { type: 'clear', seq: second.seq }).kind).toBe('idle');
  });

  it('a clear does not remove the fallback', () => {
    const fallback = copyReducer(idle, { type: 'failure', text: 't' });
    expect(copyReducer(fallback, { type: 'clear', seq: fallback.seq })).toBe(fallback);
  });

  it('a success replaces the fallback', () => {
    const fallback = copyReducer(idle, { type: 'failure', text: 't' });
    expect(copyReducer(fallback, { type: 'success' }).kind).toBe('copied');
  });
});