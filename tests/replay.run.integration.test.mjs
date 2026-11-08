// @ts-check
// runReplay with the real verifier (scripts/verifier.mjs, read only) over the real fixtures captured from
// Grimsheet. The only fakes are the process starter (canned play output) and the clock-free helpers; the
// file system is a real temp folder that each test removes.
import { describe, it, expect } from 'vitest';
import * as nodeFs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { runReplay } from '../scripts/replay/run.mjs';
import { replayVerdict as replayVerdictTyped } from '../scripts/verifier.mjs';
import { makeFakeGrimsheet, placeFixtureSolutions, procOk } from './helpers/fake-spawn.mjs';

const replayVerdict = /** @type {(...args: any[]) => any} */ (replayVerdictTyped);
const FIXTURES = new URL('./fixtures/', import.meta.url);
const APP = 'grimsheet-playtester';
const URL_ = 'https://github.com/UBayouski/Grimsheet';
const ARGS = { repoUrl: URL_, branch: 'main', cronTimeoutSec: 900 };

/** @param {string} relative @returns {any} */
const fixtureJson = (relative) => JSON.parse(nodeFs.readFileSync(new URL(relative, FIXTURES), 'utf8'));
/** @type {Array<{file: string, levelId: string, exitCode: number}>} */
const manifest = fixtureJson('manifest.json');
/** @param {string} file @returns {number} */
const exitCodeOf = (file) => /** @type {any} */ (manifest.find((m) => m.file === file)).exitCode;

/**
 * Runs `fn` with a temp root holding the app folder, the local app data folder and the checkout.
 * @param {(ctx: {root: string, checkout: string, data: string, deps: (fake: ReturnType<typeof makeFakeGrimsheet>) => any}) => Promise<void>} fn
 */
async function withTempRoot(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'replay-run-'));
  try {
    const lad = path.join(root, 'lad');
    const appFolder = path.join(root, 'app');
    const data = path.join(appFolder, 'data');
    const checkout = path.join(lad, APP, 'grimsheet');
    await fsp.mkdir(checkout, { recursive: true });
    await fsp.mkdir(appFolder, { recursive: true });
    await fn({
      root,
      checkout,
      data,
      deps: (fake) => ({
        clock: { nowMs: () => Date.now() },
        sleep: (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)),
        fs: /** @type {any} */ (fsp),
        paths: { appFolder, dataFolder: data, localAppData: lad },
        spawn: fake.spawn,
        verifier: replayVerdictTyped,
        token: () => randomBytes(16).toString('hex'),
        pid: process.pid,
        appName: APP,
        platform: /** @type {'win32'} */ ('win32'),
      }),
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

/** @param {string} data @returns {Promise<any>} */
const readRecord = async (data) => JSON.parse(await fsp.readFile(path.join(data, 'runs', 'run-000001.json'), 'utf8'));
/** @param {{calls: Array<{command: string, args: string[]}>}} spawn @returns {string[]} */
const played = (spawn) => spawn.calls.filter((c) => c.command === 'node' && c.args[1] !== '--list').map((c) => c.args[1]);

describe('runReplay with the real verifier and fixtures', () => {
  it('levels 01, 02 and 03 are green, with the fields the real verifier returns; 04 and 05 have no solution copy and start no play', async () => {
    await withTempRoot(async ({ checkout, data, deps }) => {
      await placeFixtureSolutions(checkout);
      const fake = makeFakeGrimsheet();
      const r = await runReplay(deps(fake), ARGS);
      expect(r.exitCode).toBe(0);
      expect(r.line).toEqual({ runId: 'run-000001', state: 'complete', commit: fake.commit });

      const rec = await readRecord(data);
      expect(rec.state).toBe('complete');
      for (const id of ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt']) {
        const expected = replayVerdict(id, fixtureJson(`solutions/${id}.json`), exitCodeOf(`${id}.play.json`), fixtureJson(`${id}.play.json`));
        const entry = rec.levels.find((/** @type {any} */ l) => l.levelId === id);
        expect(entry.colour).toBe('green');
        expect(entry).toStrictEqual(expected);
      }
      expect(rec.levels.slice(3).map((/** @type {any} */ l) => [l.levelId, l.colour, l.reasonCode])).toEqual([
        ['04-the-trap-row', 'error', 'no_solution_file'],
        ['05-the-lich', 'error', 'no_solution_file'],
      ]);
      expect(played(fake.spawn)).toEqual(['01-the-corridor', '02-the-chaser', '03-the-locked-crypt']);
      expect([rec.green, rec.amber, rec.red, rec.error]).toEqual([3, 0, 0, 2]);
      expect(rec.coverage).toMatchObject({ listed: 5, played: 3, noSolution: 2, unreadable: 0, unlisted: 0 });
      expect(rec.resultsKey).toBe('ok');
      const config = JSON.parse(await fsp.readFile(path.join(data, 'config.json'), 'utf8'));
      expect(config.playtesterResults.latest.levels.map((/** @type {any} */ l) => l.colour)).toEqual(['green', 'green', 'green', 'error', 'error']);
      expect((await fsp.readdir(data)).sort()).toEqual(['_index.json', 'config.json', 'runs']);
    });
  });

  it('the truncated action list for 02 is red when it is the stored solution', async () => {
    await withTempRoot(async ({ checkout, data, deps }) => {
      const truncated = fixtureJson('actions/02-the-chaser.truncated.json');
      const stored = { levelId: '02-the-chaser', minimalInk: 1, actions: truncated };
      await placeFixtureSolutions(checkout, { ids: ['02-the-chaser'], override: { '02-the-chaser': stored } });
      const truncatedPlay = fixtureJson('02-the-chaser.truncated.play.json');
      const fake = makeFakeGrimsheet({
        list: procOk(JSON.stringify({ levels: ['02-the-chaser'] })),
        plays: { '02-the-chaser': procOk(nodeFs.readFileSync(new URL('02-the-chaser.truncated.play.json', FIXTURES), 'utf8')) },
      });
      const r = await runReplay(deps(fake), ARGS);
      expect(r.line.state).toBe('complete');
      const rec = await readRecord(data);
      const expected = replayVerdict('02-the-chaser', stored, exitCodeOf('02-the-chaser.truncated.play.json'), truncatedPlay);
      expect(expected.colour).toBe('red');
      expect(rec.levels).toEqual([expected]);
      expect([rec.green, rec.amber, rec.red, rec.error]).toEqual([0, 0, 1, 0]);
    });
  });

  it('the same truncated play output against the full 02 solution is replay_mismatch, an error entry', async () => {
    await withTempRoot(async ({ checkout, data, deps }) => {
      await placeFixtureSolutions(checkout, { ids: ['02-the-chaser'] });
      const fake = makeFakeGrimsheet({
        list: procOk(JSON.stringify({ levels: ['02-the-chaser'] })),
        plays: { '02-the-chaser': procOk(nodeFs.readFileSync(new URL('02-the-chaser.truncated.play.json', FIXTURES), 'utf8')) },
      });
      const r = await runReplay(deps(fake), ARGS);
      expect(r.line.state).toBe('complete');
      const rec = await readRecord(data);
      expect(rec.levels).toHaveLength(1);
      expect(rec.levels[0]).toMatchObject({ levelId: '02-the-chaser', colour: 'error', reasonCode: 'replay_mismatch' });
      expect('timedOut' in rec.levels[0]).toBe(false);
      expect([rec.green, rec.amber, rec.red, rec.error]).toEqual([0, 0, 0, 1]);
    });
  });
});
