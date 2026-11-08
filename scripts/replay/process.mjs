// @ts-check
// Step limits, the run deadline and the real process starter. Every external command is started
// with an argument array; only `npm` on Windows uses a shell, with fixed arguments.

import { spawn } from 'node:child_process';

/** @typedef {import('./types.mjs').ProcSpec} ProcSpec */
/** @typedef {import('./types.mjs').ProcResult} ProcResult */
/** @typedef {import('./types.mjs').StartProcess} StartProcess */

export const STEP_LIMITS_MS = { gitFetch: 120000, npmCi: 180000, build: 120000, list: 30000, play: 30000, git: 30000 };
export const SAFETY_MARGIN_MS = 60000;
/** Collected stdout and stderr are each cut at this many bytes. */
export const OUTPUT_CAP_BYTES = 16 * 1024 * 1024;

/** The only npm argument sets the runner starts, and the exact command line each gives on Windows. */
const NPM_COMMANDS = new Map([
  [JSON.stringify(['ci']), 'npm ci'],
  [JSON.stringify(['run', 'build:play']), 'npm run build:play'],
]);

/**
 * min(fixed, deadline - now), never below 0.
 * @param {number} fixedMs
 * @param {number} nowMs
 * @param {number} deadlineMs
 * @returns {number}
 */
export function effectiveLimit(fixedMs, nowMs, deadlineMs) {
  return Math.max(0, Math.min(fixedMs, deadlineMs - nowMs));
}

/**
 * @param {number} startedAtMs
 * @param {number} cronTimeoutSec
 * @returns {number} startedAtMs + cronTimeoutSec * 1000 - SAFETY_MARGIN_MS
 */
export function runDeadline(startedAtMs, cronTimeoutSec) {
  return startedAtMs + cronTimeoutSec * 1000 - SAFETY_MARGIN_MS;
}

/**
 * @typedef {Object} StartOptions
 * @property {string} [platform]            defaults to `process.platform`
 * @property {typeof setTimeout} [setTimeoutFn]
 * @property {typeof clearTimeout} [clearTimeoutFn]
 * @property {typeof spawn} [spawnFn]       defaults to `node:child_process.spawn`
 * @property {number} [maxOutputBytes]      defaults to OUTPUT_CAP_BYTES
 */

/**
 * Real starter. On timeout it kills the whole process tree and resolves `timedOut: true`.
 * @param {StartOptions} [opts]
 * @returns {StartProcess}
 */
export function makeStartProcess(opts = {}) {
  const win = (opts.platform ?? process.platform) === 'win32';
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  const spawnFn = opts.spawnFn ?? spawn;
  const cap = opts.maxOutputBytes ?? OUTPUT_CAP_BYTES;

  /**
   * @param {number|undefined} pid
   * @returns {Promise<void>} resolves once the kill has been attempted
   */
  function killTree(pid) {
    if (pid === undefined) return Promise.resolve();
    if (!win) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // already gone
      }
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      try {
        const killer = spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => resolve());
        killer.on('close', () => resolve());
      } catch {
        resolve();
      }
    });
  }

  return (spec) =>
    new Promise((resolve) => {
      if (spec.timeoutMs <= 0) {
        resolve({ exitCode: null, stdout: '', stderr: '', timedOut: true, startError: null });
        return;
      }
      // Only `npm` on Windows needs a shell (it is a .cmd file); the request in the spec is ignored.
      // It is started as one fixed command string from an allow-list, never with an argument array
      // (Node DEP0190), and any other npm argument set is refused before anything is started.
      const isNpm = spec.command === 'npm';
      const npmLine = isNpm ? NPM_COMMANDS.get(JSON.stringify(spec.args)) : undefined;
      if (isNpm && npmLine === undefined) {
        resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, startError: `npm arguments not allowed: ${JSON.stringify(spec.args)}` });
        return;
      }
      /** @type {import('node:child_process').ChildProcess} */
      let child;
      try {
        const spawnOptions = { cwd: spec.cwd, windowsHide: true, detached: !win, stdio: /** @type {['ignore','pipe','pipe']} */ (['ignore', 'pipe', 'pipe']) };
        child =
          isNpm && win
            ? spawnFn(/** @type {string} */ (npmLine), { ...spawnOptions, shell: true })
            : spawnFn(spec.command, spec.args, { ...spawnOptions, shell: false });
      } catch (e) {
        resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, startError: e instanceof Error ? e.message : String(e) });
        return;
      }

      /** @type {Buffer[]} */
      const out = [];
      /** @type {Buffer[]} */
      const err = [];
      const sizes = { out: 0, err: 0 };
      let settled = false;
      let timerFired = false;
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let timer;

      /**
       * @param {Buffer[]} parts
       * @param {'out'|'err'} which
       * @returns {(chunk: Buffer|string) => void}
       */
      const collect = (parts, which) => (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const room = cap - sizes[which];
        if (room <= 0) return;
        const piece = buf.length > room ? buf.subarray(0, room) : buf;
        parts.push(piece);
        sizes[which] += piece.length;
      };
      child.stdout?.on('data', collect(out, 'out'));
      child.stderr?.on('data', collect(err, 'err'));

      /** @param {Partial<ProcResult>} result */
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeoutFn(timer);
        resolve({
          exitCode: null,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          timedOut: false,
          startError: null,
          ...result,
        });
      };

      child.on('error', (e) => finish({ startError: e.message }));
      // A close caused by our own kill (after the timer fired) is a timeout, whatever exit code the kill gave.
      child.on('close', (code) => finish(timerFired ? { timedOut: true } : { exitCode: code }));

      timer = setTimeoutFn(() => {
        if (settled) return;
        timerFired = true;
        killTree(child.pid).then(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish({ timedOut: true });
        });
      }, spec.timeoutMs);
    });
}
