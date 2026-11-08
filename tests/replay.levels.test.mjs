// @ts-check
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVEL_ID_PATTERN, isValidLevelId, parseLevelList, readSolution, findUnlisted, buildCoverage } from '../scripts/replay/levels.mjs';
import { levelEntryError } from '../scripts/replay/run-record.mjs';
import { makeMemFs } from './helpers/fake-fs.mjs';
import { arbLevelList, arbValidLevelList, arbInvalidLevelId, VALID_LEVEL_POOL } from './replay.arbitraries.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const CHECKOUT = '/data/grimsheet';
const SOLUTIONS = `${CHECKOUT}/tests/solutions`;

/** @returns {any} the captured real --list output */
const realList = () => JSON.parse(nodeFs.readFileSync(path.join(FIXTURES, 'list.json'), 'utf8'));

/** @param {string} id @returns {string} */
const fixtureSolutionText = (id) => nodeFs.readFileSync(path.join(FIXTURES, 'solutions', `${id}.json`), 'utf8');

describe('isValidLevelId', () => {
  it('accepts ids that match the pattern', () => {
    expect(LEVEL_ID_PATTERN.source).toBe('^[a-z0-9][a-z0-9-]*$');
    for (const id of ['01-the-corridor', 'a', '0', 'a-b-c', '9z']) expect(isValidLevelId(id)).toBe(true);
  });

  it('rejects traversal, separators, spaces, upper case, empty and non-strings', () => {
    for (const id of ['..', 'a/b', 'a\\b', 'a b', 'Upper', '', '-leading', 'a.b', 'a\n', 42, null, undefined, {}, ['a']]) {
      expect(isValidLevelId(id)).toBe(false);
    }
  });
});

describe('parseLevelList', () => {
  it('accepts the captured real --list output, ids in order', () => {
    const list = realList();
    const r = parseLevelList(list, 0);
    expect(r).toEqual({ ok: true, ids: list.levels, duplicates: [] });
    expect(list.levels.length).toBeGreaterThan(0);
  });

  it('gives list_failed for a non-zero exit code, even with a good list', () => {
    expect(parseLevelList({ levels: ['a'] }, 2)).toEqual({ ok: false, reasonCode: 'list_failed' });
    expect(parseLevelList({ levels: ['a'] }, 1)).toEqual({ ok: false, reasonCode: 'list_failed' });
  });

  it.each([
    ['undefined output', undefined],
    ['null', null],
    ['a number', 5],
    ['a string', 'a'],
    ['an array', ['a']],
    ['a missing levels key', {}],
    ['levels that is not an array', { levels: 'a' }],
    ['a non-string id', { levels: ['a', 3] }],
    ['an invalid id', { levels: ['a', '../x'] }],
    ['an upper-case id', { levels: ['Abc'] }],
  ])('gives list_failed for %s', (_name, json) => {
    expect(parseLevelList(json, 0)).toEqual({ ok: false, reasonCode: 'list_failed' });
  });

  it('gives empty_level_list for an empty list', () => {
    expect(parseLevelList({ levels: [] }, 0)).toEqual({ ok: false, reasonCode: 'empty_level_list' });
  });

  it('keeps a repeated id once, in first-seen order, and lists it in duplicates', () => {
    const r = parseLevelList({ levels: ['b', 'a', 'b', 'c', 'a', 'b'] }, 0);
    expect(r).toEqual({ ok: true, ids: ['b', 'a', 'c'], duplicates: ['b', 'a'] });
  });
});

describe('readSolution', () => {
  it('returns the path and the parsed value from one read', async () => {
    const fs = makeMemFs();
    const id = '01-the-corridor';
    fs.seedFile(`${SOLUTIONS}/${id}.json`, fixtureSolutionText(id));
    /** @type {string[]} */
    const log = [];
    const r = await readSolution({ fs: fs.withGate(async (l) => void log.push(l)) }, CHECKOUT, id);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.path.replace(/\\/g, '/')).toBe(`${SOLUTIONS}/${id}.json`);
    expect(r.solution).toStrictEqual(JSON.parse(fixtureSolutionText(id)));
    expect(log.filter((l) => l.startsWith('readFile'))).toHaveLength(1);
    expect(log).toHaveLength(1);
  });

  it('reads every stored solution copy', async () => {
    const fs = makeMemFs();
    for (const id of ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt']) {
      fs.seedFile(`${SOLUTIONS}/${id}.json`, fixtureSolutionText(id));
      const r = await readSolution({ fs }, CHECKOUT, id);
      expect(r.kind).toBe('ok');
    }
  });

  it('gives no_file when the file is missing', async () => {
    const fs = makeMemFs();
    fs.seedDir(SOLUTIONS);
    expect(await readSolution({ fs }, CHECKOUT, '04-the-trap-row')).toEqual({ kind: 'no_file' });
  });

  it('gives unreadable for bad JSON, and for a read error other than a missing file', async () => {
    const fs = makeMemFs();
    fs.seedFile(`${SOLUTIONS}/a.json`, '{ not json');
    expect(await readSolution({ fs }, CHECKOUT, 'a')).toEqual({ kind: 'unreadable' });
    fs.seedDir(`${SOLUTIONS}/folder.json`);
    fs.seedFile(`${SOLUTIONS}/b.json`, '{}');
    const failing = { ...fs, readFile: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } };
    expect(await readSolution({ fs: /** @type {any} */ (failing) }, CHECKOUT, 'b')).toEqual({ kind: 'unreadable' });
  });

  it('gives no_file for an invalid id without touching the file system', async () => {
    const fs = makeMemFs();
    /** @type {string[]} */
    const log = [];
    for (const id of ['..', 'a/b', 'a\\b', '', 'Upper']) {
      expect(await readSolution({ fs: fs.withGate(async (l) => void log.push(l)) }, CHECKOUT, id)).toEqual({ kind: 'no_file' });
    }
    expect(log).toEqual([]);
  });
});

describe('findUnlisted', () => {
  it('lists, sorted, the solution ids that are not in the list', async () => {
    const fs = makeMemFs();
    for (const name of ['02-the-chaser.json', '99-old.json', '01-the-corridor.json', 'zz-extra.json', 'readme.txt', 'Bad Name.json']) {
      fs.seedFile(`${SOLUTIONS}/${name}`, '{}');
    }
    expect(await findUnlisted({ fs }, CHECKOUT, ['01-the-corridor', '02-the-chaser'])).toEqual(['99-old', 'zz-extra']);
  });

  it('gives an empty list when the solutions folder is missing', async () => {
    expect(await findUnlisted({ fs: makeMemFs() }, CHECKOUT, ['a'])).toEqual([]);
  });
});

describe('buildCoverage', () => {
  it('counts listed, played, noSolution, unreadable and unlisted, and carries the two lists', () => {
    const entries = [
      { levelId: 'a', colour: /** @type {const} */ ('green') },
      { levelId: 'b', colour: /** @type {const} */ ('red') },
      levelEntryError('c', 'no_solution_file'),
      levelEntryError('d', 'solution_unreadable'),
      levelEntryError('e', 'not_played'),
      { levelId: 'f', colour: /** @type {const} */ ('error'), reasonCode: 'play_failed', reason: 'x' },
    ];
    expect(buildCoverage(entries, ['a'], ['old-1', 'old-2'])).toEqual({
      listed: 6,
      played: 3,
      noSolution: 1,
      unreadable: 1,
      unlisted: 2,
      duplicateListedLevels: ['a'],
      unlistedSolutions: ['old-1', 'old-2'],
    });
  });

  it('gives zeros for no entries', () => {
    expect(buildCoverage([], [], [])).toEqual({ listed: 0, played: 0, noSolution: 0, unreadable: 0, unlisted: 0, duplicateListedLevels: [], unlistedSolutions: [] });
  });
});

describe('levels properties', () => {
  const NUM_RUNS = 200;
  const STATUSES = /** @type {const} */ (['valid', 'missing', 'unreadable']);

  // Feature: replay-runner, Property 15: One entry per distinct listed id
  it('Property 15: one entry per distinct listed id, in list order, and no play request without a usable solution', async () => {
    const arbSolutionState = fc.record({
      status: fc.array(fc.constantFrom(...STATUSES), { minLength: VALID_LEVEL_POOL.length, maxLength: VALID_LEVEL_POOL.length }),
      unlisted: fc.array(fc.constantFrom('99-old', 'zz-extra', 'old-one'), { maxLength: 3 }),
    });
    await fc.assert(
      fc.asyncProperty(arbValidLevelList, arbSolutionState, async (list, state) => {
        const fs = makeMemFs();
        fs.seedDir(SOLUTIONS);
        VALID_LEVEL_POOL.forEach((id, i) => {
          if (state.status[i] === 'valid') fs.seedFile(`${SOLUTIONS}/${id}.json`, '{"levelId":"x"}');
          else if (state.status[i] === 'unreadable') fs.seedFile(`${SOLUTIONS}/${id}.json`, '{ broken');
        });
        for (const u of state.unlisted) fs.seedFile(`${SOLUTIONS}/${u}.json`, '{}');

        const parsed = parseLevelList({ levels: list }, 0);
        if (list.length === 0) {
          expect(parsed).toEqual({ ok: false, reasonCode: 'empty_level_list' });
          return;
        }
        if (!parsed.ok) throw new Error('a valid list was refused');
        const distinct = [...new Set(list)];
        expect(parsed.ids).toEqual(distinct);

        /** @type {string[]} */
        const playRequests = [];
        /** @type {import('../scripts/replay/types.mjs').LevelEntry[]} */
        const entries = [];
        for (const id of parsed.ids) {
          const sol = await readSolution({ fs }, CHECKOUT, id);
          if (sol.kind === 'ok') {
            playRequests.push(id);
            entries.push({ levelId: id, colour: 'green' });
          } else {
            entries.push(levelEntryError(id, sol.kind === 'no_file' ? 'no_solution_file' : 'solution_unreadable'));
          }
        }
        const unlisted = await findUnlisted({ fs }, CHECKOUT, parsed.ids);
        const coverage = buildCoverage(entries, parsed.duplicates, unlisted);

        expect(entries.map((e) => e.levelId)).toEqual(distinct);
        const statusOf = (/** @type {string} */ id) => state.status[VALID_LEVEL_POOL.indexOf(id)];
        expect(playRequests).toEqual(distinct.filter((id) => statusOf(id) === 'valid'));
        expect(coverage.listed).toBe(distinct.length);
        expect(coverage.played).toBe(playRequests.length);
        expect(coverage.noSolution).toBe(distinct.filter((id) => statusOf(id) === 'missing').length);
        expect(coverage.unreadable).toBe(distinct.filter((id) => statusOf(id) === 'unreadable').length);
        expect(coverage.played + coverage.noSolution + coverage.unreadable).toBe(coverage.listed);
        // Unlisted: the extra files, plus every seeded pool file whose id is not in the list.
        const expectedUnlisted = [
          ...new Set([...state.unlisted, ...VALID_LEVEL_POOL.filter((id) => statusOf(id) !== 'missing' && !distinct.includes(id))]),
        ].sort();
        expect(unlisted).toEqual(expectedUnlisted);
        expect(coverage.unlisted).toBe(expectedUnlisted.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: replay-runner, Property 16: Level ids are validated before use
  it('Property 16: a list is accepted only as {levels: string[]} of valid ids, and an invalid id builds no path', async () => {
    const oracleOk = (/** @type {unknown} */ id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);
    const arbMaybeInvalidId = fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...VALID_LEVEL_POOL) }, { weight: 2, arbitrary: arbInvalidLevelId });
    const arbOutput = fc.oneof(
      arbLevelList.map((levels) => ({ levels })),
      fc.array(arbMaybeInvalidId, { maxLength: 6 }).map((levels) => ({ levels })),
      fc.constantFrom(undefined, null, 0, 'levels', [], ['a'], {}, { levels: 'a' }, { levels: {} }, { levels: null }, { other: ['a'] }),
    );
    await fc.assert(
      fc.asyncProperty(arbOutput, fc.constantFrom(0, 0, 0, 1, 2), async (output, exitCode) => {
        const r = parseLevelList(output, exitCode);
        const levels = typeof output === 'object' && output !== null && !Array.isArray(output) ? /** @type {any} */ (output).levels : undefined;
        const shapeOk = Array.isArray(levels) && levels.every(oracleOk);
        if (exitCode !== 0 || !shapeOk) {
          expect(r).toEqual({ ok: false, reasonCode: 'list_failed' });
        } else if (levels.length === 0) {
          expect(r).toEqual({ ok: false, reasonCode: 'empty_level_list' });
        } else {
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.ids.every(oracleOk)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );

    await fc.assert(
      fc.asyncProperty(arbInvalidLevelId, async (id) => {
        expect(isValidLevelId(id)).toBe(false);
        /** @type {string[]} */
        const log = [];
        const fs = makeMemFs();
        const r = await readSolution({ fs: fs.withGate(async (l) => void log.push(l)) }, CHECKOUT, /** @type {any} */ (id));
        expect(r).toEqual({ kind: 'no_file' });
        expect(log).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
