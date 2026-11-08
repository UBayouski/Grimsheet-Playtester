// What the controller may touch of the world: the clock, timers and the visibility of the page.
// Tests pass a fake; `realEnv()` is built inside the component's effect, never at module load.

export interface Env {
  nowMs(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  isVisible(): boolean;
  /** Calls `cb` when the visibility of the page changes. Returns the function that unsubscribes. */
  onVisibilityChange(cb: () => void): () => void;
}

export function realEnv(): Env {
  return {
    nowMs: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    onVisibilityChange(cb) {
      if (typeof document === 'undefined') return () => {};
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
  };
}