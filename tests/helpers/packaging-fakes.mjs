// @ts-check
// Fakes for the packaging tests: a recording fetch, and a runner that records the order of steps and how many run at once.

/**
 * A response with the two members that the route reader uses.
 * @param {number} status
 * @param {string} text
 * @returns {{status: number, ok: boolean, text: () => Promise<string>}}
 */
export function fakeResponse(status, text) {
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}

/** @returns {Error} the error that an aborted fetch throws */
export function abortError() {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * A request that never answers and rejects when its signal aborts.
 * @param {{signal?: AbortSignal}} init
 * @returns {Promise<never>}
 */
export function hang(init) {
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(abortError()));
  });
}

/**
 * @typedef {Object} FakeCall
 * @property {string} url
 * @property {string} method
 * @property {string|undefined} redirect
 * @property {Record<string, string>} headers
 */

/**
 * A fetch that records every call. `behave(url, init)` returns a response, throws, or returns a pending promise.
 * @param {(url: string, init: any) => any} behave
 * @returns {{fetch: (url: string, init?: any) => Promise<any>, calls: FakeCall[]}}
 */
export function makeFakeFetch(behave) {
  /** @type {FakeCall[]} */
  const calls = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', redirect: init.redirect, headers: { ...(init.headers ?? {}) } });
      if (init.signal?.aborted) throw abortError();
      return behave(String(url), init);
    },
  };
}

/**
 * A timer that fires at once (so a timeout test needs no real wait) or never.
 * @param {boolean} fires
 * @returns {{setTimer: (fn: () => void, ms: number) => number, clearTimer: (h: number) => void, delays: number[]}}
 */
export function makeFakeTimer(fires) {
  /** @type {number[]} */
  const delays = [];
  return {
    delays,
    setTimer: (fn, ms) => {
      delays.push(ms);
      if (fires) fn();
      return 1;
    },
    clearTimer: () => {},
  };
}

/**
 * A runner for the steps of `test:all`. `codes[i]` is the exit code of the (i+1)th call; `null` means the step cannot start.
 * It records the labels in call order and the largest number of steps that were in flight at once.
 * @param {Array<number|null>} codes
 * @returns {{calls: string[], maxInFlight: () => number, run: (step: {label: string}) => Promise<number>}}
 */
export function makeFakeRunner(codes) {
  /** @type {string[]} */
  const calls = [];
  let inFlight = 0;
  let max = 0;
  return {
    calls,
    maxInFlight: () => max,
    run: async (step) => {
      const index = calls.length;
      calls.push(step.label);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      const code = codes[index];
      if (code === null || code === undefined) throw new Error('could not start');
      return code;
    },
  };
}
