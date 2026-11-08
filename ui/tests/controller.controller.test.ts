import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbControllerOps, arbRequestOutcomes, type RequestOutcome } from './arbitraries';
import { DashboardController } from '../src/controller/controller';
import type { Env } from '../src/controller/env';
import { CONFIG_PATH, CRONS_PATH } from '../src/core/constants';
import { makeFakeApi, makeFakeEnv, type Behaviour } from './helpers/fake-env';

const CONFIG_VALUE = { playtesterResults: { schemaVersion: 1 } };
const IDLE = { jobs: [{ name: 'replay', is_running: false }] };
const RUNNING = { jobs: [{ name: 'replay', is_running: true }] };

type Script = (path: string, n: number) => Behaviour;

function setup(script: Script, withApi = true) {
  const fake = makeFakeEnv();
  const api = makeFakeApi(fake, script);
  const controller = new DashboardController(withApi ? api.api : null, fake.env as Env);
  let notified = 0;
  controller.subscribe(() => (notified += 1));
  return { fake, api, controller, notified: () => notified };
}

const normal: Script = (path) => ({ kind: 'resolve', value: path === CONFIG_PATH ? CONFIG_VALUE : IDLE });
const running: Script = (path) => ({ kind: 'resolve', value: path === CONFIG_PATH ? CONFIG_VALUE : RUNNING });

describe('DashboardController: the first Read', () => {
  it('start while visible starts one Read at once, with the two requests issued before either settles', () => {
    const s = setup((path) => ({ kind: 'resolve', value: path === CONFIG_PATH ? CONFIG_VALUE : IDLE, delayMs: 100 }));
    s.controller.start();
    expect(s.api.calls).toEqual([CONFIG_PATH, CRONS_PATH]);
    expect(s.api.inFlight()).toBe(2);
  });

  it('the first snapshot has both routes pending and a Read in flight', () => {
    const s = setup(normal);
    s.controller.start();
    const snap = s.controller.getSnapshot();
    expect(snap.config.status).toBe('pending');
    expect(snap.crons.status).toBe('pending');
    expect(snap.config.hasGood).toBe(false);
    expect(snap.inFlight).toBe(true);
    expect(snap.visible).toBe(true);
  });

  it('after both answers the routes are ok with the value and the time of the read', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.settle();
    const snap = s.controller.getSnapshot();
    expect(snap.config).toEqual({ status: 'ok', hasGood: true, good: CONFIG_VALUE, goodAtMs: s.fake.env.nowMs(), error: null });
    expect(snap.crons).toMatchObject({ status: 'ok', hasGood: true, good: IDLE });
    expect(snap.inFlight).toBe(false);
  });

  it('every snapshot carries the time from the Env', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.settle();
    expect(s.controller.getSnapshot().nowMs).toBe(s.fake.env.nowMs());
    await s.fake.advance(60_000);
    expect(s.controller.getSnapshot().nowMs).toBe(s.fake.env.nowMs());
  });
});

describe('DashboardController: failures', () => {
  it('a failing config route in a later Read keeps the earlier good value and sets the error', async () => {
    const s = setup((path, n) => (path === CONFIG_PATH && n === 3 ? { kind: 'reject', error: new Error('config down') } : normal(path, n)));
    s.controller.start();
    await s.fake.settle();
    await s.fake.advance(60_000);
    const snap = s.controller.getSnapshot();
    expect(snap.config).toMatchObject({ status: 'failed', hasGood: true, good: CONFIG_VALUE, error: 'config down' });
    expect(snap.crons.status).toBe('ok');
  });

  it('one route failing and the other succeeding in the same Read updates only the successful one', async () => {
    const s = setup((path, n) => (path === CONFIG_PATH ? { kind: 'reject', error: new Error('boom') } : normal(path, n)));
    s.controller.start();
    await s.fake.settle();
    const snap = s.controller.getSnapshot();
    expect(snap.config).toMatchObject({ status: 'failed', hasGood: false, error: 'boom' });
    expect(snap.crons).toMatchObject({ status: 'ok', hasGood: true });
  });

  it('a request that never settles ends at the 10 second limit, and the other route is not held back', async () => {
    const s = setup((path, n) => (path === CONFIG_PATH && n === 1 ? { kind: 'never' } : normal(path, n)));
    s.controller.start();
    await s.fake.settle();
    expect(s.controller.getSnapshot().crons.status).toBe('ok');
    expect(s.controller.getSnapshot().config.status).toBe('pending');
    expect(s.controller.getSnapshot().inFlight).toBe(true);
    await s.fake.advance(10_000);
    const snap = s.controller.getSnapshot();
    expect(snap.config).toMatchObject({ status: 'failed', error: 'The request took longer than 10 seconds' });
    expect(snap.inFlight).toBe(false);
  });

  it('a Read does not start while one is in flight, and the next follows the interval after the start of the stuck one', async () => {
    const s = setup((path, n) => (path === CONFIG_PATH && n === 1 ? { kind: 'never' } : normal(path, n)));
    s.controller.start();
    await s.fake.advance(9_999);
    expect(s.api.calls).toHaveLength(2);
    await s.fake.advance(1); // the limit ends the Read at 10 s
    await s.fake.advance(49_999);
    expect(s.api.calls).toHaveLength(2);
    await s.fake.advance(1); // 60 s after the start
    expect(s.api.calls).toHaveLength(4);
  });
});

describe('DashboardController: the schedule', () => {
  it('starts the next Read 60 seconds after the start of the previous one', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.settle();
    await s.fake.advance(59_999);
    expect(s.api.calls).toHaveLength(2);
    await s.fake.advance(1);
    expect(s.api.calls).toHaveLength(4);
    await s.fake.advance(60_000);
    expect(s.api.calls).toHaveLength(6);
  });

  it('starts it after 15 seconds while the replay job is running', async () => {
    const s = setup(running);
    s.controller.start();
    await s.fake.settle();
    await s.fake.advance(14_999);
    expect(s.api.calls).toHaveLength(2);
    await s.fake.advance(1);
    expect(s.api.calls).toHaveLength(4);
  });

  it('goes back to 60 seconds when the job is no longer running', async () => {
    const s = setup((path, n) => (path === CRONS_PATH ? { kind: 'resolve', value: n <= 2 ? RUNNING : IDLE } : { kind: 'resolve', value: CONFIG_VALUE }));
    s.controller.start();
    await s.fake.settle();
    await s.fake.advance(15_000); // Read 2 sees the job idle
    expect(s.api.calls).toHaveLength(4);
    await s.fake.advance(59_999);
    expect(s.api.calls).toHaveLength(4);
    await s.fake.advance(1);
    expect(s.api.calls).toHaveLength(6);
  });

  it('starts no Read while the page is hidden, and starts one at once when it becomes visible', async () => {
    const s = setup(normal);
    s.fake.setVisible(false);
    s.controller.start();
    await s.fake.advance(1_000_000);
    expect(s.api.calls).toEqual([]);
    s.fake.setVisible(true);
    expect(s.api.calls).toEqual([CONFIG_PATH, CRONS_PATH]);
  });

  it('on becoming visible after more than one interval it reads at once, and after less it waits for the rest', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.settle();
    s.fake.setVisible(false);
    await s.fake.advance(70_000);
    expect(s.api.calls).toHaveLength(2);
    s.fake.setVisible(true);
    expect(s.api.calls).toHaveLength(4);
    await s.fake.settle();
    s.fake.setVisible(false);
    await s.fake.advance(20_000);
    s.fake.setVisible(true);
    expect(s.api.calls).toHaveLength(4);
    await s.fake.advance(39_999);
    expect(s.api.calls).toHaveLength(4);
    await s.fake.advance(1);
    expect(s.api.calls).toHaveLength(6);
  });

  it('refresh while idle starts a Read at once, and while a Read is in flight does nothing', async () => {
    const s = setup((path) => ({ kind: 'resolve', value: path === CONFIG_PATH ? CONFIG_VALUE : IDLE, delayMs: 100 }));
    s.controller.start();
    s.controller.refresh(); // in flight
    expect(s.api.calls).toHaveLength(2);
    await s.fake.advance(100);
    s.controller.refresh();
    expect(s.api.calls).toHaveLength(4);
    s.controller.refresh();
    expect(s.api.calls).toHaveLength(4);
  });

  it('refresh while hidden does nothing', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.settle();
    s.fake.setVisible(false);
    s.controller.refresh();
    expect(s.api.calls).toHaveLength(2);
  });
});

describe('DashboardController: stop and start', () => {
  it('stop clears the timer and the visibility subscription', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.settle();
    expect(s.fake.pendingTimers()).toBe(1);
    expect(s.fake.listenerCount()).toBe(1);
    s.controller.stop();
    expect(s.fake.pendingTimers()).toBe(0);
    expect(s.fake.listenerCount()).toBe(0);
    await s.fake.advance(1_000_000);
    expect(s.api.calls).toHaveLength(2);
  });

  it('an answer that comes after stop changes nothing', async () => {
    const s = setup((path) => ({ kind: 'resolve', value: path === CONFIG_PATH ? CONFIG_VALUE : IDLE, delayMs: 5_000 }));
    s.controller.start();
    s.controller.stop();
    const before = s.controller.getSnapshot();
    const seen = s.notified();
    await s.fake.advance(20_000);
    expect(s.controller.getSnapshot()).toBe(before);
    expect(s.notified()).toBe(seen);
    expect(s.controller.getSnapshot().config.status).toBe('pending');
    expect(s.api.calls).toHaveLength(2);
    expect(s.fake.pendingTimers()).toBe(0);
  });

  it('a Read that outlives stop does not start another, and refresh after stop does nothing', async () => {
    const s = setup(normal);
    s.controller.start();
    s.controller.stop();
    s.controller.refresh();
    await s.fake.advance(200_000);
    expect(s.api.calls).toHaveLength(2);
  });

  it('start after stop begins again with a fresh state (strict mode)', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.settle();
    s.controller.stop();
    s.controller.start();
    expect(s.controller.getSnapshot().config.status).toBe('pending');
    expect(s.api.calls).toHaveLength(4);
    await s.fake.settle();
    expect(s.controller.getSnapshot().config.status).toBe('ok');
    expect(s.fake.listenerCount()).toBe(1);
  });
});

describe('DashboardController: no API', () => {
  it('makes no request, shows the message on both routes, and refresh does nothing', async () => {
    const s = setup(normal, false);
    s.controller.start();
    s.controller.refresh();
    await s.fake.advance(200_000);
    expect(s.api.calls).toEqual([]);
    const snap = s.controller.getSnapshot();
    expect(snap.config).toMatchObject({ status: 'failed', hasGood: false, error: 'Kiro Crew did not provide the app API' });
    expect(snap.crons).toMatchObject({ status: 'failed', error: 'Kiro Crew did not provide the app API' });
    expect(s.fake.pendingTimers()).toBe(0);
  });
});

describe('DashboardController: snapshots and calls', () => {
  it('getSnapshot returns the same object until something changes, and a new one after', async () => {
    const s = setup(normal);
    s.controller.start();
    const a = s.controller.getSnapshot();
    expect(s.controller.getSnapshot()).toBe(a);
    await s.fake.settle();
    const b = s.controller.getSnapshot();
    expect(b).not.toBe(a);
    expect(s.controller.getSnapshot()).toBe(b);
    expect(b.version).toBeGreaterThan(a.version);
  });

  it('notifies the listeners when the snapshot changes, and not after they unsubscribe', async () => {
    const s = setup(normal);
    let count = 0;
    const off = s.controller.subscribe(() => (count += 1));
    s.controller.start();
    await s.fake.settle();
    expect(count).toBeGreaterThan(0);
    const seen = count;
    off();
    await s.fake.advance(60_000);
    expect(count).toBe(seen);
  });

  it('the recorded calls are get calls to the two paths only', async () => {
    const s = setup(normal);
    s.controller.start();
    await s.fake.advance(300_000);
    expect(new Set(s.api.calls)).toEqual(new Set([CONFIG_PATH, CRONS_PATH]));
    expect(Object.keys(s.api.api)).toEqual(['get']);
  });
});
describe('controller properties', () => {
  const behaviourOf = (outcome: RequestOutcome, path: string): Behaviour => {
    const value = path === CONFIG_PATH ? CONFIG_VALUE : RUNNING;
    switch (outcome) {
      case 'ok':
        return { kind: 'resolve', value };
      case 'okDelayed':
        return { kind: 'resolve', value, delayMs: 2_000 };
      case 'okLate':
        return { kind: 'resolve', value, delayMs: 15_000 };
      case 'fail':
        return { kind: 'reject', error: new Error('request failed') };
      case 'failDelayed':
        return { kind: 'reject', error: new Error('slow failure'), delayMs: 4_000 };
      case 'never':
        return { kind: 'never' };
      case 'throw':
        return { kind: 'throw', error: new Error('not permitted') };
    }
  };

  // Feature: dashboard, Property 13: Read only
  it('Property 13: only get calls to the two paths, one Read at a time, none while hidden or after stop', async () => {
    await fc.assert(
      fc.asyncProperty(arbRequestOutcomes, arbControllerOps, async (outcomes, ops) => {
        const fake = makeFakeEnv();
        let open = 0; // Reads the controller has started and not ended
        let stopped = true;
        const allowed = new Set([CONFIG_PATH, CRONS_PATH]);
        const api = makeFakeApi(fake, (path, n) => {
          expect(allowed.has(path)).toBe(true);
          expect(stopped).toBe(false);
          if (n % 2 === 1) {
            // the first request of a Read: the page must be visible and no other Read may be open
            expect(fake.env.isVisible()).toBe(true);
            expect(open).toBe(0);
            open = 1;
          }
          return behaviourOf(outcomes[(n - 1) % outcomes.length] as RequestOutcome, path);
        });
        const controller = new DashboardController(api.api, fake.env as Env);
        controller.subscribe(() => {
          if (!controller.getSnapshot().inFlight) open = 0;
        });

        const start = (): void => {
          open = 0;
          stopped = false;
          controller.start();
        };
        start();
        for (const step of ops) {
          switch (step.op) {
            case 'advance':
              await fake.advance(step.ms);
              break;
            case 'visible':
              fake.setVisible(step.visible);
              break;
            case 'refresh':
              controller.refresh();
              break;
            case 'stop':
              controller.stop();
              stopped = true;
              open = 0;
              break;
            case 'start':
              start();
              break;
          }
          await fake.settle();
        }
        // only get exists on the API object, and every call was to one of the two paths
        expect(Object.keys(api.api)).toEqual(['get']);
        for (const path of api.calls) expect(allowed.has(path)).toBe(true);
        expect(api.calls.length % 2).toBe(0);
        expect(api.calls.length).toBeGreaterThanOrEqual(2); // the first Read always starts: the page is visible at mount
        controller.stop();
      }),
      { numRuns: 200 },
    );
  });
});