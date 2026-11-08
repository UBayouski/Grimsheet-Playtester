// @ts-check
import { describe, it, expect } from 'vitest';
import { makeHuntWorld, HUNT_CHECKOUT, HUNT_LOCAL_FOLDER, DATA_FOLDER, FIXTURE_SOLUTION_IDS } from './helpers/hunt-world.mjs';
import { procOk } from './helpers/fake-spawn.mjs';

/** @param {ReturnType<typeof makeHuntWorld>} w @param {string[]} args */
const run = (w, args) => w.deps.spawn({ command: 'node', args, cwd: HUNT_CHECKOUT, shell: false, timeoutMs: 1000, label: 'test' });

describe('hunt world builder', () => {
  it('builds HuntDeps with the expected keys and values', () => {
    const w = makeHuntWorld();
    expect(Object.keys(w.deps).sort()).toEqual(['appName', 'checkCandidate', 'clock', 'fs', 'paths', 'pid', 'platform', 'sleep', 'spawn', 'token']);
    expect('verifier' in w.deps).toBe(false);
    expect(w.deps.appName).toBe('grimsheet-playtester');
    expect(w.deps.platform).toBe('win32');
    expect(w.deps.paths.dataFolder).toBe(DATA_FOLDER);
    expect(HUNT_CHECKOUT).toBe(`${HUNT_LOCAL_FOLDER}\\grimsheet`);
    expect(w.paths.checkoutDir).toBe(HUNT_CHECKOUT);
    expect(w.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('places the stored solutions in the Hunt_Checkout', () => {
    const w = makeHuntWorld();
    for (const id of FIXTURE_SOLUTION_IDS) {
      const text = w.fs.peek(`${HUNT_CHECKOUT}\\tests\\solutions\\${id}.json`);
      expect(JSON.parse(/** @type {string} */ (text)).levelId).toBe(id);
    }
    expect(w.fs.has(`${HUNT_CHECKOUT}\\tests\\solutions\\04-the-trap-row.json`)).toBe(false);
  });

  it('seedConfig writes data\\config.json', () => {
    const w = makeHuntWorld();
    w.seedConfig({ foreign: 1 });
    expect(JSON.parse(/** @type {string} */ (w.fs.peek(w.paths.configPath)))).toEqual({ foreign: 1 });
  });

  it('answers the canned play and records the file path and content', async () => {
    const w = makeHuntWorld({ plays: { '02-the-chaser': procOk('{"canned":true}') } });
    w.fs.seedFile('C:\\x\\cand.json', '{"actions":[]}');
    const r = await run(w, ['scripts/play.mjs', '02-the-chaser', '--actions-file', 'C:\\x\\cand.json']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('{"canned":true}');
    expect(w.calls.play).toEqual([{ levelId: '02-the-chaser', file: 'C:\\x\\cand.json', content: '{"actions":[]}' }]);
    expect(w.calls.spawn).toHaveLength(1);
  });

  it('accepts a play function and exits 2 for a level without a canned play', async () => {
    const w = makeHuntWorld({ plays: (id) => procOk(`played ${id}`) });
    const a = await run(w, ['scripts/play.mjs', '05-the-lich', '--actions-file', 'f.json']);
    expect(a.stdout).toBe('played 05-the-lich');
    const w2 = makeHuntWorld({ plays: {} });
    const b = await run(w2, ['scripts/play.mjs', '05-the-lich', '--actions-file', 'f.json']);
    expect(b.exitCode).toBe(2);
  });

  it('answers --level-info with the stub or the given result', async () => {
    const w = makeHuntWorld();
    const r = await run(w, ['scripts/play.mjs', '01-the-corridor', '--level-info']);
    expect(r.exitCode).toBe(0);
    expect(typeof JSON.parse(r.stdout)).toBe('object');
    expect(w.calls.info).toEqual([{ levelId: '01-the-corridor' }]);
    const w2 = makeHuntWorld({ levelInfo: procOk('custom') });
    expect((await run(w2, ['scripts/play.mjs', '01-the-corridor', '--level-info'])).stdout).toBe('custom');
  });

  it('keeps the existing fake toolchain: --list and git', async () => {
    const w = makeHuntWorld();
    const l = await run(w, ['scripts/play.mjs', '--list']);
    expect(JSON.parse(l.stdout).levels).toHaveLength(5);
    const g = await w.deps.spawn({ command: 'git', args: ['rev-parse', 'HEAD'], cwd: HUNT_CHECKOUT, shell: false, timeoutMs: 1000, label: 'git' });
    expect(g.stdout.trim()).toBe(w.commit);
  });

  it('uses the check stub: function and table', () => {
    const ok = { outcome: 'confirmed' };
    const w = makeHuntWorld({ check: () => /** @type {any} */ (ok) });
    expect(w.deps.checkCandidate('x', null, null, null, 0, null)).toBe(ok);
    const w2 = makeHuntWorld({ check: { a: ok } });
    expect(w2.deps.checkCandidate('a', null, null, null, 0, null)).toBe(ok);
    expect(/** @type {any} */ (w2.deps.checkCandidate('b', null, null, null, 0, null)).outcome).toBe('error');
  });

  it('the orchestrator helpers load lazily', async () => {
    const w = makeHuntWorld();
    expect(typeof w.begin).toBe('function');
    expect(typeof w.submit).toBe('function');
  });
});
