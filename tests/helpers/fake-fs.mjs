// @ts-check
// In-memory fake of the `Fs` subset used by the replay-runner (see scripts/replay/types.mjs), plus a fake
// clock, a fake sleep, a fake token source and a two-writer scheduler for scripted interleavings.

/**
 * A clock the test controls. `advance` moves it forward.
 * @param {number} [startMs]
 * @returns {{nowMs(): number, advance(ms: number): void}}
 */
export function makeFakeClock(startMs = Date.UTC(2026, 10, 8, 11, 0, 0)) {
  let now = startMs;
  return {
    nowMs: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

/**
 * A `sleep` that moves the fake clock instead of waiting, then yields once so other tasks can run.
 * @param {{advance(ms: number): void}} clock
 * @returns {(ms: number) => Promise<void>}
 */
export function makeSleep(clock) {
  return async (ms) => {
    clock.advance(ms);
    await Promise.resolve();
  };
}

/**
 * A token source: 32 hex characters, unique, increasing.
 * @param {number} [start]
 * @returns {() => string}
 */
export function makeTokenSource(start = 0) {
  let n = start;
  return () => {
    n += 1;
    return n.toString(16).padStart(32, '0');
  };
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error & {code: string}}
 */
function fsError(code, message) {
  const e = /** @type {Error & {code: string}} */ (new Error(`${code}: ${message}`));
  e.code = code;
  return e;
}

/**
 * Normalises a path: forward slashes, no doubled or trailing slash.
 * @param {string} p
 * @returns {string}
 */
function norm(p) {
  let s = String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/**
 * @param {string} p normalised path
 * @returns {string}
 */
function parentOf(p) {
  const i = p.lastIndexOf('/');
  if (i < 0) return '';
  if (i === 0) return '/';
  return p.slice(0, i);
}

/**
 * A path that always exists: the empty root, `/` and a drive such as `C:`.
 * @param {string} p normalised path
 * @returns {boolean}
 */
function isRoot(p) {
  return p === '' || p === '/' || /^[A-Za-z]:$/.test(p);
}

/**
 * Builds an in-memory file system that implements exactly the `Fs` methods of the design.
 * Files are a map from normalised path to `{content, mtimeMs, readOnly}`. A missing file raises an error
 * with `code` `ENOENT`; `writeFile` with `flag: 'wx'` raises `EEXIST`; `rename` replaces atomically;
 * a read-only file refuses `rm` (`EPERM`) until `chmod(path, 0o666)`. Every operation first awaits
 * `gate(label)` (default: no wait), so a test can decide which writer's next operation proceeds.
 * `withGate(gate)` returns another view of the same files with its own gate.
 * @param {{clock?: {nowMs(): number}, gate?: (label: string) => Promise<void>}} [options]
 */
export function makeMemFs(options = {}) {
  const clock = options.clock ?? makeFakeClock();
  /** @type {Map<string, {content: string, mtimeMs: number, readOnly: boolean}>} */
  const files = new Map();
  /** @type {Set<string>} */
  const dirs = new Set();

  /** @param {string} p normalised */
  const dirExists = (p) => isRoot(p) || dirs.has(p);

  /** @param {string} p normalised */
  function addDirs(p) {
    let cur = p;
    while (!isRoot(cur)) {
      dirs.add(cur);
      cur = parentOf(cur);
    }
  }

  /**
   * @param {(label: string) => Promise<void>} gate
   * @returns {import('../../scripts/replay/types.mjs').Fs}
   */
  function viewWith(gate) {
    return {
      async readFile(path) {
        await gate(`readFile ${path}`);
        const f = files.get(norm(path));
        if (!f) throw fsError('ENOENT', `no such file ${path}`);
        return f.content;
      },
      async writeFile(path, data, opts) {
        await gate(`writeFile ${path}`);
        const p = norm(path);
        const flag = typeof opts === 'object' && opts !== null ? opts.flag : undefined;
        if (!dirExists(parentOf(p))) throw fsError('ENOENT', `no such folder for ${path}`);
        if (dirs.has(p)) throw fsError('EISDIR', `${path} is a folder`);
        const existing = files.get(p);
        if (flag === 'wx' && existing) throw fsError('EEXIST', `file exists ${path}`);
        if (existing && existing.readOnly) throw fsError('EPERM', `read-only file ${path}`);
        files.set(p, { content: String(data), mtimeMs: clock.nowMs(), readOnly: false });
      },
      async rename(from, to) {
        await gate(`rename ${from} ${to}`);
        const a = norm(from);
        const b = norm(to);
        const f = files.get(a);
        if (!f) throw fsError('ENOENT', `no such file ${from}`);
        if (!dirExists(parentOf(b))) throw fsError('ENOENT', `no such folder for ${to}`);
        const target = files.get(b);
        if (target && target.readOnly) throw fsError('EPERM', `read-only file ${to}`);
        files.delete(a);
        files.set(b, { ...f });
      },
      async rm(path, opts) {
        await gate(`rm ${path}`);
        const p = norm(path);
        const f = files.get(p);
        if (f) {
          if (f.readOnly) throw fsError('EPERM', `read-only file ${path}`);
          files.delete(p);
          return;
        }
        if (dirs.has(p)) {
          if (!opts || !opts.recursive) throw fsError('ERR_FS_EISDIR', `${path} is a folder`);
          const under = [...files.keys()].filter((k) => k.startsWith(`${p}/`));
          if (under.some((k) => files.get(k)?.readOnly)) throw fsError('EPERM', `read-only file under ${path}`);
          for (const k of under) files.delete(k);
          for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
          return;
        }
        if (!opts || !opts.force) throw fsError('ENOENT', `no such file ${path}`);
      },
      async mkdir(path, opts) {
        await gate(`mkdir ${path}`);
        const p = norm(path);
        if (opts && opts.recursive) {
          addDirs(p);
          return;
        }
        if (dirExists(p) || files.has(p)) throw fsError('EEXIST', `exists ${path}`);
        if (!dirExists(parentOf(p))) throw fsError('ENOENT', `no such folder for ${path}`);
        dirs.add(p);
      },
      async readdir(path) {
        await gate(`readdir ${path}`);
        const p = norm(path);
        if (!dirExists(p)) throw fsError('ENOENT', `no such folder ${path}`);
        const prefix = p === '/' ? '/' : `${p}/`;
        const names = new Set();
        for (const k of [...files.keys(), ...dirs]) {
          if (k.startsWith(prefix) && k.length > prefix.length) names.add(k.slice(prefix.length).split('/')[0]);
        }
        return [...names].sort();
      },
      async stat(path) {
        await gate(`stat ${path}`);
        const p = norm(path);
        const f = files.get(p);
        if (f) return { mtimeMs: f.mtimeMs, size: f.content.length, isDirectory: () => false, isFile: () => true };
        if (dirExists(p)) return { mtimeMs: clock.nowMs(), size: 0, isDirectory: () => true, isFile: () => false };
        throw fsError('ENOENT', `no such file or folder ${path}`);
      },
      async chmod(path, mode) {
        await gate(`chmod ${path}`);
        const f = files.get(norm(path));
        if (!f) throw fsError('ENOENT', `no such file ${path}`);
        f.readOnly = (mode & 0o200) === 0;
      },
      async realpath(path) {
        await gate(`realpath ${path}`);
        const p = norm(path);
        if (!files.has(p) && !dirExists(p)) throw fsError('ENOENT', `no such file or folder ${path}`);
        return p;
      },
    };
  }

  const noGate = async () => {};
  const base = viewWith(options.gate ?? noGate);
  return {
    ...base,
    /** Another view of the same files whose operations wait on `gate`. @param {(label: string) => Promise<void>} gate */
    withGate: (gate) => viewWith(gate),
    /** Test setup: create a file (and its folders) without going through the gate. @param {string} path @param {string} content @param {{readOnly?: boolean, mtimeMs?: number}} [o] */
    seedFile(path, content, o = {}) {
      const p = norm(path);
      addDirs(parentOf(p));
      files.set(p, { content, mtimeMs: o.mtimeMs ?? clock.nowMs(), readOnly: o.readOnly === true });
    },
    /** Test setup: create a folder. @param {string} path */
    seedDir(path) {
      addDirs(norm(path));
    },
    /** Test check: the content of a file, or undefined. @param {string} path @returns {string|undefined} */
    peek: (path) => files.get(norm(path))?.content,
    /** Test check: does the file exist. @param {string} path @returns {boolean} */
    has: (path) => files.has(norm(path)),
    /** Test check: all files as a plain object (path to content), for byte-for-byte comparison. @returns {Record<string,string>} */
    snapshot() {
      /** @type {Record<string,string>} */
      const out = {};
      for (const k of [...files.keys()].sort()) out[k] = /** @type {{content: string}} */ (files.get(k)).content;
      return out;
    },
    /** Test check: the file paths under a folder prefix (sorted). @param {string} prefix @returns {string[]} */
    paths(prefix = '') {
      const p = norm(prefix);
      return [...files.keys()].filter((k) => k.startsWith(p)).sort();
    },
    clock,
  };
}

/**
 * Scripted scheduling for two writers. Each writer gets a gate from `gate(writerIndex)`; the gate makes
 * the writer's next file-system operation wait. When every writer that is not finished is waiting, the
 * next entry of `choices` (0 or 1) lets that writer's operation proceed (if that writer is not waiting,
 * the other one proceeds). `choices` repeat when exhausted. Call `done(writerIndex)` when a writer's
 * promise has settled, so the scheduler stops waiting for it. `log` records the granted operations.
 *
 * `sleep` in tests advances the fake clock and yields (see `makeSleep`), so a writer in a retry loop
 * returns to a gated operation without real waiting.
 * @param {Array<0|1>} choices
 */
export function makeScheduler(choices) {
  /** @type {Array<{resolve: () => void, label: string}|null>} */
  const pending = [null, null];
  const finished = [false, false];
  let cursor = 0;
  /** @type {string[]} */
  const log = [];

  function tryGrant() {
    for (let w = 0; w < 2; w += 1) {
      if (!finished[w] && pending[w] === null) return;
    }
    const open = [0, 1].filter((w) => pending[w] !== null);
    if (open.length === 0) return;
    let pick = choices.length > 0 ? choices[cursor % choices.length] : 0;
    cursor += 1;
    if (!open.includes(pick)) pick = /** @type {0|1} */ (open[0]);
    const entry = /** @type {{resolve: () => void, label: string}} */ (pending[pick]);
    pending[pick] = null;
    log.push(`${pick}:${entry.label}`);
    entry.resolve();
  }

  return {
    log,
    /** @param {0|1} writer @returns {(label: string) => Promise<void>} */
    gate(writer) {
      return (label) =>
        new Promise((resolve) => {
          pending[writer] = { resolve, label };
          tryGrant();
        });
    },
    /** @param {0|1} writer */
    done(writer) {
      finished[writer] = true;
      tryGrant();
    },
  };
}
