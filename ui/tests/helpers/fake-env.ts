// Fakes for the controller tests: a manual clock with a timer queue, a visibility switch, and a recording API
// that has only a `get` method (so any other call throws). No real timer and no real network is used.

export interface FakeEnv {
  /** The shape of the controller's Env (src/controller/env.ts); task 14.3 checks that it is assignable. */
  env: {
    nowMs(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    isVisible(): boolean;
    onVisibilityChange(cb: () => void): () => void;
  };
  /** Moves the clock forward, running the timers that fall due in order of time, and lets promises settle after each. */
  advance(ms: number): Promise<void>;
  /** Lets the promises that are ready settle, without moving the clock. */
  settle(): Promise<void>;
  setVisible(visible: boolean): void;
  /** Timers that are set and have not fired or been cleared. */
  pendingTimers(): number;
  listenerCount(): number;
}

export function makeFakeEnv(startMs = Date.UTC(2026, 10, 8, 12, 0, 0)): FakeEnv {
  let now = startMs;
  let nextId = 1;
  let visible = true;
  const timers = new Map<number, { fn: () => void; due: number }>();
  const listeners = new Set<() => void>();

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  };

  const advance = async (ms: number): Promise<void> => {
    const target = now + ms;
    for (;;) {
      let nextKey: number | null = null;
      for (const [key, timer] of timers) {
        if (timer.due <= target && (nextKey === null || timer.due < (timers.get(nextKey) as { due: number }).due)) nextKey = key;
      }
      if (nextKey === null) break;
      const timer = timers.get(nextKey) as { fn: () => void; due: number };
      timers.delete(nextKey);
      now = Math.max(now, timer.due);
      timer.fn();
      await settle();
    }
    now = target;
    await settle();
  };

  return {
    env: {
      nowMs: () => now,
      setTimeout(fn, ms) {
        const id = nextId;
        nextId += 1;
        timers.set(id, { fn, due: now + Math.max(0, ms) });
        return id;
      },
      clearTimeout(handle) {
        if (typeof handle === 'number') timers.delete(handle);
      },
      isVisible: () => visible,
      onVisibilityChange(cb) {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    },
    advance,
    settle,
    setVisible(next) {
      visible = next;
      for (const cb of [...listeners]) cb();
    },
    pendingTimers: () => timers.size,
    listenerCount: () => listeners.size,
  };
}

export type Behaviour =
  | { kind: 'resolve'; value: unknown; delayMs?: number }
  | { kind: 'reject'; error: unknown; delayMs?: number }
  | { kind: 'never' }
  | { kind: 'throw'; error: unknown };

export interface FakeApi {
  /** An object with a `get` method only. */
  api: { get(path: string): Promise<unknown> };
  /** Every path asked for, in order. */
  calls: string[];
  /** Requests that have been started and have not settled. */
  inFlight(): number;
  maxInFlight(): number;
}

/** `script` gives the behaviour of a request from its path and its position (1 for the first call). */
export function makeFakeApi(env: FakeEnv, script: Behaviour | ((path: string, callNumber: number) => Behaviour)): FakeApi {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const api = {
    get(path: string): Promise<unknown> {
      calls.push(path);
      const behaviour = typeof script === 'function' ? script(path, calls.length) : script;
      if (behaviour.kind === 'throw') throw behaviour.error;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<unknown>((resolve, reject) => {
        if (behaviour.kind === 'never') return;
        const finish = (): void => {
          inFlight -= 1;
          if (behaviour.kind === 'resolve') resolve(behaviour.value);
          else reject(behaviour.error);
        };
        if ((behaviour.delayMs ?? 0) > 0) env.env.setTimeout(finish, behaviour.delayMs as number);
        else finish();
      });
    },
  };
  return { api, calls, inFlight: () => inFlight, maxInFlight: () => maxInFlight };
}