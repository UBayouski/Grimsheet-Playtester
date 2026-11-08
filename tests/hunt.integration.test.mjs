// @ts-check
// Task 19.1: a whole hunt through cli.mjs `main` over the in-memory world, plus one real `node` process on
// hunt-begin.mjs that must refuse before it touches anything. No network, no real Grimsheet.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { main } from '../scripts/hunt/cli.mjs';
import { makeHuntWorld } from './helpers/hunt-world.mjs';
import { procOk } from './helpers/fake-spawn.mjs';

const FIXTURE_TEXT = readFileSync(new URL('./fixtures/level-info/02-the-chaser.json', import.meta.url), 'utf8');
const L02 = '02-the-chaser';
const REPO = path.resolve(import.meta.dirname, '..');
const C3F = 'edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29';

/** @returns {Record<string, unknown>} a CheckOk-like confirmed or rejected answer */
function answer(/** @type {'confirmed'|'rejected'} */ outcome) {
  return outcome === 'confirmed'
    ? { levelId: L02, claimedClass: 'cheaper_win', outcome, reasonCode: 'class_reproduced', reason: 'The replay reproduces the claimed class.', won: true, inkSpent: 0, minimalInk: 1, editCount: 0, newEditAddresses: [] }
    : { levelId: L02, claimedClass: 'cheaper_win', outcome, reasonCode: 'not_cheaper', reason: 'The win spent at least minimalInk ink.', won: true, inkSpent: 1, minimalInk: 1, editCount: 0, newEditAddresses: [] };
}

/** Drives `main` like the entry file does, over the world's deps. */
function driver(/** @type {ReturnType<typeof makeHuntWorld>} */ w) {
  /** @type {string[]} */
  const lines = [];
  /** @type {number[]} */
  const codes = [];
  /** @param {'begin'|'info'|'submit'|'end'} name @param {string[]} [argv] */
  const call = async (name, argv = []) => {
    const before = lines.length;
    await main(name, argv, { buildDeps: () => w.deps, write: (t) => void lines.push(t), setExitCode: (c) => void codes.push(c) });
    expect(lines.length).toBe(before + 1);
    const text = lines[before];
    expect(text.endsWith('\n')).toBe(true);
    const body = JSON.parse(text);
    expect(Object.keys(body).at(-1)).toBe('exitStatus');
    expect(body.exitStatus).toBe(codes.at(-1));
    return body;
  };
  return { call, lines, codes };
}

describe('a whole hunt through main', () => {
  it('runs begin, info, four submits and end, one JSON line each', async () => {
    // Stub answers by call order: 1 confirmed, 2 and 3 rejected. Calls 1..3 are real Attempts; the fourth submit is refused.
    /** @type {any[][]} */
    const seen = [];
    const w = makeHuntWorld({
      levelInfo: procOk(FIXTURE_TEXT),
      check: (/** @type {any[]} */ ...a) => {
        seen.push(a);
        return answer(seen.length === 1 ? 'confirmed' : 'rejected');
      },
    });
    const d = driver(w);

    const begin = await d.call('begin');
    expect(begin).toMatchObject({ state: 'ready', exitStatus: 0 });
    expect(begin.levels).toContain(L02);
    w.seedConfig({});

    const info = await d.call('info', ['--level', L02]);
    expect(info).toMatchObject({ state: 'level', levelId: L02, exitStatus: 0 });
    expect(info.info.cells.map((/** @type {{address: string}} */ c) => c.address)).toEqual(['A14', 'B14', 'A15', 'B15']);
    expect(Buffer.byteLength(JSON.stringify(info.info), 'utf8')).toBe(686);

    const confirmed = await d.call('submit', ['--level', L02, '--class', 'cheaper_win', '--actions', 'E', 'E']);
    expect(confirmed).toMatchObject({ outcome: 'confirmed', exitStatus: 0 });
    const rejected = await d.call('submit', ['--level', L02, '--class', 'cheaper_win', '--actions', 'W']);
    expect(rejected).toMatchObject({ outcome: 'rejected', exitStatus: 0 });
    const c3f = await d.call('submit', ['--level', L02, '--class', 'cheaper_win', '--actions', 'N', C3F, 'E']);
    expect(c3f).toMatchObject({ outcome: 'rejected', exitStatus: 0 });
    expect(seen[2][3]).toEqual([
      { kind: 'move', dir: 'N' },
      { kind: 'edit', address: 'B14', raw: '=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")' },
      { kind: 'move', dir: 'E' },
    ]);
    const bad = await d.call('submit', ['--level', L02, '--class', 'cheaper_win']);
    expect(bad).toMatchObject({ outcome: 'refused', reasonCode: 'bad_arguments', exitStatus: 3 });
    expect(seen).toHaveLength(3);

    const end = await d.call('end');
    expect(end).toMatchObject({ state: 'complete', huntId: begin.huntId, finished: true, exitStatus: 0 });

    expect(d.lines).toHaveLength(7);
    expect(d.codes).toEqual([0, 0, 0, 0, 0, 3, 0]);

    const config = JSON.parse(/** @type {string} */ (w.fs.peek(w.paths.configPath)));
    const findings = config.playtesterResults.findings;
    expect(findings.items).toHaveLength(1);
    expect(findings.items[0]).toMatchObject({ id: confirmed.findingId, levelId: L02, class: 'cheaper_win', actions: ['E', 'E'] });
    expect(findings.counts).toMatchObject({ confirmed: 1, rejected: 2 });

    const record = JSON.parse(/** @type {string} */ (w.fs.peek(`${w.paths.dataFolder}\\hunts\\${begin.huntId}.json`)));
    expect(record.state).toBe('complete');
  });
});

/** Full listing (relative name, kind, size, mtime) of a folder, read only. @param {string} dir @returns {string[]} */
function listing(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ folder) => {
    for (const e of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(folder, e.name);
      const s = statSync(p);
      out.push(`${path.relative(dir, p)}|${e.isDirectory() ? 'd' : 'f'}|${s.size}|${s.mtimeMs}`);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

describe('the real hunt-begin.mjs process', () => {
  it('refuses an extra argument with one JSON line, exit 3, and leaves data\\ untouched', () => {
    const data = path.join(REPO, 'data');
    const hunts = path.join(data, 'hunts');
    const exists = (/** @type {string} */ p) => {
      try {
        statSync(p);
        return true;
      } catch {
        return false;
      }
    };
    const dataBefore = exists(data);
    const huntsBefore = exists(hunts);
    const listBefore = dataBefore ? listing(data) : [];

    const r = spawnSync(process.execPath, [path.join('skills', 'find-exploits', 'scripts', 'hunt-begin.mjs'), 'extra'], {
      cwd: REPO,
      encoding: 'utf8',
      shell: false,
      timeout: 20000,
      windowsHide: true,
    });

    expect(r.status).toBe(3);
    const lines = r.stdout.split(/\r?\n/).filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    const body = JSON.parse(lines[0]);
    expect(body.reasonCode).toBe('bad_arguments');
    expect(body.exitStatus).toBe(3);

    expect(exists(data)).toBe(dataBefore);
    expect(exists(hunts)).toBe(huntsBefore);
    expect(dataBefore ? listing(data) : []).toEqual(listBefore);
  });
});
