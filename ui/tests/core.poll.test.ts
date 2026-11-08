import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbSchedulerOps } from './arbitraries';
import { POLL_INTERVAL_MS, RUNNING_INTERVAL_MS, decide, initialScheduler, step, type SchedulerState } from '../src/core/poll';

const base = { visible: true, inFlight: false, lastStartMs: 1000 as number | null, nowMs: 1000, pollIntervalMs: 60_000, isRunning: false };
const state = (extra: Partial<SchedulerState> = {}): SchedulerState => ({ ...initialScheduler(), visible: true, ...extra });

describe('intervals', () => {
  it('are 60 seconds and 15 seconds', () => {
    expect(POLL_INTERVAL_MS).toBe(60_000);
    expect(RUNNING_INTERVAL_MS).toBe(15_000);
  });
});

describe('decide', () => {
  it('does nothing when the page is hidden', () => {
    expect(decide({ ...base, visible: false, nowMs: 1_000_000 })).toEqual({ do: 'none' });
  });

  it('does nothing while a Read is in flight', () => {
    expect(decide({ ...base, inFlight: true, nowMs: 1_000_000 })).toEqual({ do: 'none' });
  });

  it('starts at once when there is no previous start', () => {
    expect(decide({ ...base, lastStartMs: null })).toEqual({ do: 'start' });
  });

  it('waits for the rest of the interval, and starts when it has passed', () => {
    expect(decide({ ...base, nowMs: 1000 + 59_999 })).toEqual({ do: 'wait', ms: 1 });
    expect(decide({ ...base, nowMs: 1000 })).toEqual({ do: 'wait', ms: 60_000 });
    expect(decide({ ...base, nowMs: 1000 + 60_000 })).toEqual({ do: 'start' });
    expect(decide({ ...base, nowMs: 1000 + 600_000 })).toEqual({ do: 'start' });
  });

  it('uses 15 seconds while the replay job is running', () => {
    expect(decide({ ...base, isRunning: true, nowMs: 1000 + 14_999 })).toEqual({ do: 'wait', ms: 1 });
    expect(decide({ ...base, isRunning: true, nowMs: 1000 + 15_000 })).toEqual({ do: 'start' });
  });

  it('never waits longer than the base interval, whatever the base is', () => {
    const effect = decide({ ...base, isRunning: true, pollIntervalMs: 5_000, nowMs: 1000 });
    expect(effect).toEqual({ do: 'wait', ms: 5_000 });
  });
});

describe('step', () => {
  it('mount while visible starts at once and sets inFlight and lastStartMs', () => {
    const r = step(initialScheduler(), { type: 'mount', nowMs: 5000, visible: true });
    expect(r.effect).toEqual({ do: 'start' });
    expect(r.state).toMatchObject({ visible: true, inFlight: true, lastStartMs: 5000, closed: false });
  });

  it('mount while hidden does nothing', () => {
    const r = step(initialScheduler(), { type: 'mount', nowMs: 5000, visible: false });
    expect(r.effect).toEqual({ do: 'none' });
    expect(r.state).toMatchObject({ visible: false, inFlight: false, lastStartMs: null });
  });

  it('tick starts or waits as decide says', () => {
    expect(step(state({ lastStartMs: 0 }), { type: 'tick', nowMs: 59_000 }).effect).toEqual({ do: 'wait', ms: 1000 });
    const started = step(state({ lastStartMs: 0 }), { type: 'tick', nowMs: 60_000 });
    expect(started.effect).toEqual({ do: 'start' });
    expect(started.state).toMatchObject({ inFlight: true, lastStartMs: 60_000 });
  });

  it('tick while a Read is in flight does nothing', () => {
    const r = step(state({ inFlight: true, lastStartMs: 0 }), { type: 'tick', nowMs: 999_999 });
    expect(r.effect).toEqual({ do: 'none' });
    expect(r.state.inFlight).toBe(true);
  });

  it('visibility to hidden gives none', () => {
    const r = step(state({ lastStartMs: 0 }), { type: 'visibility', nowMs: 10, visible: false });
    expect(r.effect).toEqual({ do: 'none' });
    expect(r.state.visible).toBe(false);
  });

  it('visibility to visible after more than one interval starts at once, and after less waits for the rest', () => {
    const hidden = state({ visible: false, lastStartMs: 0 });
    expect(step(hidden, { type: 'visibility', nowMs: 70_000, visible: true }).effect).toEqual({ do: 'start' });
    expect(step(hidden, { type: 'visibility', nowMs: 20_000, visible: true }).effect).toEqual({ do: 'wait', ms: 40_000 });
  });

  it('refresh while visible and idle starts a Read, even before the interval has passed', () => {
    const r = step(state({ lastStartMs: 1000 }), { type: 'refresh', nowMs: 1500 });
    expect(r.effect).toEqual({ do: 'start' });
    expect(r.state).toMatchObject({ inFlight: true, lastStartMs: 1500 });
  });

  it('refresh while a Read is in flight or while hidden does nothing', () => {
    expect(step(state({ inFlight: true }), { type: 'refresh', nowMs: 1 }).effect).toEqual({ do: 'none' });
    expect(step(state({ visible: false }), { type: 'refresh', nowMs: 1 }).effect).toEqual({ do: 'none' });
  });

  it('complete clears inFlight, takes isRunning, and decides', () => {
    const r = step(state({ inFlight: true, lastStartMs: 0 }), { type: 'complete', nowMs: 2000, isRunning: true });
    expect(r.state).toMatchObject({ inFlight: false, isRunning: true });
    expect(r.effect).toEqual({ do: 'wait', ms: 13_000 });
    const idle = step(state({ inFlight: true, lastStartMs: 0 }), { type: 'complete', nowMs: 2000, isRunning: false });
    expect(idle.effect).toEqual({ do: 'wait', ms: 58_000 });
  });

  it('a complete with nothing in flight changes only isRunning and cannot start before the interval', () => {
    const r = step(state({ inFlight: false, lastStartMs: 0, isRunning: false }), { type: 'complete', nowMs: 1000, isRunning: true });
    expect(r.state).toEqual(state({ inFlight: false, lastStartMs: 0, isRunning: true }));
    expect(r.effect).toEqual({ do: 'wait', ms: 14_000 });
  });

  it('unmount closes the scheduler and every later event gives none', () => {
    const closed = step(state({ lastStartMs: 0 }), { type: 'unmount' });
    expect(closed.state.closed).toBe(true);
    expect(closed.effect).toEqual({ do: 'none' });
    for (const event of [
      { type: 'tick', nowMs: 999_999 },
      { type: 'refresh', nowMs: 999_999 },
      { type: 'visibility', nowMs: 999_999, visible: true },
      { type: 'complete', nowMs: 999_999, isRunning: false },
      { type: 'mount', nowMs: 999_999, visible: true },
    ] as const) {
      const after = step(closed.state, event);
      expect(after.effect, event.type).toEqual({ do: 'none' });
      expect(after.state).toEqual(closed.state);
    }
  });

  it('does not change the state it is given', () => {
    const before = state({ lastStartMs: 0 });
    const copy = { ...before };
    step(before, { type: 'tick', nowMs: 100_000 });
    expect(before).toEqual(copy);
  });
});
describe('poll scheduler properties', () => {
  // Feature: dashboard, Property 10: Poll scheduler
  it('Property 10: one Read at a time, none while hidden or closed, one interval apart, and progress', () => {
    fc.assert(
      fc.property(fc.boolean(), arbSchedulerOps, (visibleAtMount, ops) => {
        let now = 0;
        let s = initialScheduler();
        let inflight = 0; // Reads the model has started and not yet completed
        let lastStart: number | null = null;
        let wasClosed = false;

        const apply = (event: Parameters<typeof step>[1], kind: 'mount' | 'tick' | 'visibility' | 'refresh' | 'complete' | 'unmount') => {
          const before = s;
          const r = step(s, event);
          s = r.state;
          if (r.effect.do === 'start') {
            expect(before.closed).toBe(false);
            expect(s.visible).toBe(true); // no start while hidden
            expect(inflight).toBe(0); // one Read at a time
            if (kind === 'tick' || kind === 'visibility' || kind === 'mount' || kind === 'complete') {
              if (lastStart !== null) {
                const interval = before.isRunning && kind !== 'complete' ? RUNNING_INTERVAL_MS : kind === 'complete' ? (s.isRunning ? RUNNING_INTERVAL_MS : POLL_INTERVAL_MS) : POLL_INTERVAL_MS;
                expect(now - lastStart).toBeGreaterThanOrEqual(interval);
              }
            }
            inflight += 1;
            lastStart = now;
          }
          if (r.effect.do === 'wait') {
            expect(r.effect.ms).toBeGreaterThan(0);
            expect(r.effect.ms).toBeLessThanOrEqual(POLL_INTERVAL_MS);
            expect(s.visible).toBe(true);
          }
          if (before.closed || wasClosed) {
            expect(r.effect).toEqual({ do: 'none' });
            expect(s).toEqual(before);
          }
          if (s.closed) wasClosed = true;
          expect(inflight).toBeLessThanOrEqual(1);
          if (!s.closed) expect(inflight === 1).toBe(s.inFlight); // after unmount a late answer is discarded by the controller
        };

        apply({ type: 'mount', nowMs: now, visible: visibleAtMount }, 'mount');
        for (const op of ops) {
          now += op.dt;
          switch (op.type) {
            case 'tick':
              apply({ type: 'tick', nowMs: now }, 'tick');
              break;
            case 'visibility':
              apply({ type: 'visibility', nowMs: now, visible: op.visible }, 'visibility');
              break;
            case 'refresh':
              apply({ type: 'refresh', nowMs: now }, 'refresh');
              break;
            case 'complete':
              if (inflight === 1) {
                inflight = 0;
                apply({ type: 'complete', nowMs: now, isRunning: op.isRunning }, 'complete');
              }
              break;
            case 'unmount':
              apply({ type: 'unmount' }, 'unmount');
              break;
          }
        }

        // every Read that started ends
        // (a completion that lands exactly on the interval may start the next Read, which then also ends)
        if (s.closed) inflight = 0; // the controller discards the answer of a Read that outlives the page
        for (let guard = 0; inflight === 1 && guard < 4; guard += 1) {
          now += 1;
          inflight = 0;
          apply({ type: 'complete', nowMs: now, isRunning: false }, 'complete');
        }
        expect(inflight).toBe(0);

        // progress: a visible, open, idle page starts a Read once the interval has passed
        if (s.visible && !s.closed) {
          now = Math.max(now, (lastStart ?? now) + POLL_INTERVAL_MS);
          const r = step(s, { type: 'tick', nowMs: now });
          expect(r.effect).toEqual({ do: 'start' });
        }
      }),
      { numRuns: 400 },
    );
  });
});