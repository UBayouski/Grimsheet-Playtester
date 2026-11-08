// @ts-check
import { describe, it, expect } from 'vitest';
import { makeMemFs, makeFakeClock, makeSleep, makeTokenSource, makeScheduler } from './helpers/fake-fs.mjs';

/**
 * @param {Promise<unknown>} p
 * @returns {Promise<string|undefined>} the error code, or undefined when it did not reject
 */
async function codeOf(p) {
  try {
    await p;
    return undefined;
  } catch (e) {
    return /** @type {any} */ (e).code;
  }
}

describe('fake file system', () => {
  it('writeFile with flag wx raises EEXIST when the file exists', async () => {
    const fs = makeMemFs();
    await fs.mkdir('C:/data', { recursive: true });
    await fs.writeFile('C:/data/a.lock', 'one', { flag: 'wx' });
    expect(await codeOf(fs.writeFile('C:/data/a.lock', 'two', { flag: 'wx' }))).toBe('EEXIST');
    expect(await fs.readFile('C:/data/a.lock', 'utf8')).toBe('one');
  });

  it('a plain writeFile replaces the content', async () => {
    const fs = makeMemFs();
    fs.seedDir('C:/data');
    await fs.writeFile('C:/data/a', 'one', 'utf8');
    await fs.writeFile('C:/data/a', 'two', { encoding: 'utf8' });
    expect(fs.peek('C:/data/a')).toBe('two');
  });

  it('rename replaces an existing target atomically', async () => {
    const fs = makeMemFs();
    fs.seedFile('C:/data/new.tmp', 'new');
    fs.seedFile('C:/data/config.json', 'old');
    await fs.rename('C:/data/new.tmp', 'C:/data/config.json');
    expect(fs.peek('C:/data/config.json')).toBe('new');
    expect(fs.has('C:/data/new.tmp')).toBe(false);
  });

  it('a missing file raises ENOENT (read, rename, stat, rm without force)', async () => {
    const fs = makeMemFs();
    fs.seedDir('C:/data');
    expect(await codeOf(fs.readFile('C:/data/none', 'utf8'))).toBe('ENOENT');
    expect(await codeOf(fs.rename('C:/data/none', 'C:/data/other'))).toBe('ENOENT');
    expect(await codeOf(fs.stat('C:/data/none'))).toBe('ENOENT');
    expect(await codeOf(fs.rm('C:/data/none'))).toBe('ENOENT');
    expect(await codeOf(fs.rm('C:/data/none', { force: true }))).toBeUndefined();
  });

  it('writing into a folder that does not exist raises ENOENT', async () => {
    const fs = makeMemFs();
    expect(await codeOf(fs.writeFile('C:/nowhere/a', 'x', 'utf8'))).toBe('ENOENT');
  });

  it('a read-only file needs chmod before rm', async () => {
    const fs = makeMemFs();
    fs.seedFile('C:/repo/.git/pack.idx', 'x', { readOnly: true });
    expect(await codeOf(fs.rm('C:/repo/.git/pack.idx'))).toBe('EPERM');
    expect(await codeOf(fs.rm('C:/repo', { recursive: true }))).toBe('EPERM');
    expect(fs.has('C:/repo/.git/pack.idx')).toBe(true);
    await fs.chmod('C:/repo/.git/pack.idx', 0o666);
    await fs.rm('C:/repo', { recursive: true });
    expect(fs.has('C:/repo/.git/pack.idx')).toBe(false);
  });

  it('readdir lists direct children; stat gives mtime from the fake clock', async () => {
    const clock = makeFakeClock(1000);
    const fs = makeMemFs({ clock });
    fs.seedFile('C:/data/runs/run-000001.json', '{}');
    clock.advance(500);
    fs.seedFile('C:/data/runs/run-000002.json', '{}');
    fs.seedFile('C:/data/_index.json', '{}');
    expect(await fs.readdir('C:/data/runs')).toEqual(['run-000001.json', 'run-000002.json']);
    expect(await fs.readdir('C:/data')).toEqual(['_index.json', 'runs']);
    expect((await fs.stat('C:/data/runs/run-000002.json')).mtimeMs).toBe(1500);
    expect((await fs.stat('C:/data/runs')).isDirectory()).toBe(true);
    expect(await codeOf(fs.readdir('C:/none'))).toBe('ENOENT');
  });

  it('backslash paths and forward slash paths are the same file', async () => {
    const fs = makeMemFs();
    fs.seedFile('C:\\data\\a.json', 'x');
    expect(await fs.readFile('C:/data/a.json', 'utf8')).toBe('x');
    expect(await fs.realpath('C:\\data\\a.json')).toBe('C:/data/a.json');
  });

  it('the fake sleep moves the clock; the token source gives 32 hex characters', async () => {
    const clock = makeFakeClock(0);
    await makeSleep(clock)(200);
    expect(clock.nowMs()).toBe(200);
    const token = makeTokenSource();
    const a = token();
    const b = token();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).not.toBe(a);
  });
});

describe('two-writer scheduler', () => {
  /**
   * @param {Array<0|1>} choices
   * @returns {Promise<string[]>} the order in which operations were granted
   */
  async function run(choices) {
    const sched = makeScheduler(choices);
    const mem = makeMemFs();
    mem.seedDir('C:/d');
    const fs0 = mem.withGate(sched.gate(0));
    const fs1 = mem.withGate(sched.gate(1));
    const w0 = (async () => {
      await fs0.writeFile('C:/d/a0', 'x', 'utf8');
      await fs0.writeFile('C:/d/a1', 'x', 'utf8');
    })().finally(() => sched.done(0));
    const w1 = (async () => {
      await fs1.writeFile('C:/d/b0', 'x', 'utf8');
      await fs1.writeFile('C:/d/b1', 'x', 'utf8');
    })().finally(() => sched.done(1));
    await Promise.all([w0, w1]);
    return sched.log.map((l) => l.replace(/^(\d):.*\/(\w+)$/, '$1 $2'));
  }

  it('runs the writers in the given order', async () => {
    expect(await run([0, 0, 1, 1])).toEqual(['0 a0', '0 a1', '1 b0', '1 b1']);
    expect(await run([1, 1, 0, 0])).toEqual(['1 b0', '1 b1', '0 a0', '0 a1']);
    expect(await run([0, 1, 0, 1])).toEqual(['0 a0', '1 b0', '0 a1', '1 b1']);
    expect(await run([1, 0, 1, 0])).toEqual(['1 b0', '0 a0', '1 b1', '0 a1']);
  });

  it('lets the other writer go on when the chosen one has finished', async () => {
    const order = await run([0, 0, 0, 0, 0, 0]);
    expect(order).toHaveLength(4);
    expect(order.slice(0, 2)).toEqual(['0 a0', '0 a1']);
  });
});
