// @ts-check
// Feature: packaging. The README lint (scripts/packaging/readme-lint.mjs) and the real README.md.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALLOWED_PREFIXES, REQUIRED_LINKS, REQUIRED_PHRASES, lintReadme } from '../scripts/packaging/readme-lint.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** @param {{rule: string}[]} problems */
const rulesOf = (problems) => new Set(problems.map((p) => p.rule));

/**
 * A README built from the required phrases and links, one per line.
 * @param {string[]} [extraLines]
 * @returns {string[]}
 */
const baseLines = (extraLines = []) => [
  '# Grimsheet Playtester',
  ...REQUIRED_PHRASES,
  ...REQUIRED_LINKS,
  'Install with the path built from $env:ProgramFiles, then use ~ and %LOCALAPPDATA% for folders.',
  ...extraLines,
];

describe('constants', () => {
  it('requires the phrases and the two links of R12.24 and R12.25', () => {
    for (const p of ['Windows', 'only Windows was tested', '03:00', 'on request', 'bounded search', 'MIT', 'companion', 'Grimsheet entry']) {
      expect(REQUIRED_PHRASES).toContain(p);
    }
    expect([...REQUIRED_LINKS]).toEqual(['https://github.com/UBayouski/Grimsheet', 'https://grimsheet.onrender.com']);
    expect([...ALLOWED_PREFIXES]).toEqual(['https://github.com/UBayouski/', 'https://grimsheet.onrender.com']);
  });
});

describe('lintReadme: examples', () => {
  it('passes for a README with every phrase and link', () => {
    expect(lintReadme(baseLines().join('\n'))).toEqual([]);
  });

  it('names each missing phrase and each missing link', () => {
    for (const phrase of REQUIRED_PHRASES) {
      const text = baseLines()
        .filter((l) => l !== phrase)
        .join('\n');
      const stillThere = text.includes(phrase);
      const problems = lintReadme(text);
      expect(problems.some((p) => p.rule === 'phrase' && p.message.includes(phrase))).toBe(!stillThere);
    }
    for (const link of REQUIRED_LINKS) {
      const text = baseLines()
        .filter((l) => l !== link)
        .join('\n');
      expect(lintReadme(text).some((p) => p.rule === 'link' && p.message.includes(link))).toBe(true);
    }
  });

  it('accepts an address that begins with an allowed prefix, with trailing punctuation or a path', () => {
    const text = baseLines(['See (https://github.com/UBayouski/Grimsheet-Playtester.git).', 'Play at https://grimsheet.onrender.com/play, then stop.']).join('\n');
    expect(lintReadme(text)).toEqual([]);
  });

  it('reports an address outside the two allowed prefixes', () => {
    for (const url of ['https://github.com/other/repo', 'http://example.test/x', 'https://grimsheet.onrender.com.evil.test', 'https://grimsheet.onrender.comx']) {
      expect(rulesOf(lintReadme(baseLines([`See ${url} now.`]).join('\n')))).toContain('address');
    }
  });

  it('reports a drive letter, Users\\, token=, localhost, 127.0.0.1, and placeholder words', () => {
    /** @type {Array<[string, string]>} */
    const cases = [
      ['drive-letter', 'Run C:\\Tools\\x'],
      ['drive-letter', 'Run z:\\x'],
      ['users-path', 'See Users\\someone'],
      ['token', 'Open ?token=abc'],
      ['local-address', 'Use localhost for it'],
      ['local-address', 'Use 127.0.0.1 for it'],
      ['placeholder', 'TBD'],
      ['placeholder', 'TODO: later'],
      ['placeholder', 'FIXME'],
    ];
    for (const [rule, line] of cases) {
      expect(rulesOf(lintReadme(baseLines([line]).join('\n')))).toContain(rule);
    }
  });

  it('does not take $env:ProgramFiles or %LOCALAPPDATA% for a drive letter', () => {
    const text = baseLines(['$env:ProgramFiles\\KiroCrew\\resources\\kirocrew.cmd', '%LOCALAPPDATA%\\grimsheet-playtester', '~\\.kiro\\crew']).join('\n');
    expect(lintReadme(text)).toEqual([]);
  });

  it('has a message for every problem', () => {
    const problems = lintReadme('nothing useful, C:\\x and TODO and http://example.test');
    expect(problems.length).toBeGreaterThan(3);
    for (const p of problems) expect(p.message.length).toBeGreaterThan(0);
  });
});

describe('lintReadme properties', () => {
  // Feature: packaging, Property 15: the README lint finds each missing phrase and each forbidden pattern
  const arbFiller = fc.array(fc.stringMatching(/^[A-Za-z0-9 .,-]{0,40}$/), { maxLength: 6 });

  it('Property 15a: a README built from the required phrases plus any filler text passes (the lint holds no list of other names)', () => {
    fc.assert(
      fc.property(arbFiller, (filler) => {
        const problems = lintReadme(baseLines(filler).join('\n'));
        // A filler line may spell a placeholder word or a required phrase by chance; the model below gives the exact expectation.
        const expectedRules = new Set(filler.some((l) => /TBD|TODO|FIXME/.test(l)) ? ['placeholder'] : []);
        expect(rulesOf(problems)).toEqual(expectedRules);
      }),
      { numRuns: 300 },
    );
  });

  it('Property 15b: a phrase is reported missing exactly when the text does not contain it', () => {
    const arbSubset = fc.subarray([...REQUIRED_PHRASES], { minLength: 0 });
    fc.assert(
      fc.property(arbSubset, arbFiller, (kept, filler) => {
        const text = ['# Title', ...kept, ...REQUIRED_LINKS, ...filler].join('\n');
        const reported = lintReadme(text)
          .filter((p) => p.rule === 'phrase')
          .map((p) => p.message);
        for (const phrase of REQUIRED_PHRASES) {
          expect(reported.some((m) => m.includes(`"${phrase}"`))).toBe(!text.includes(phrase));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('Property 15c: a forbidden pattern on its own line is reported by its rule, at any line position', () => {
    /** @type {Array<[string, string]>} */
    const patterns = [
      ['drive-letter', 'C:\\'],
      ['drive-letter', 'z:\\temp'],
      ['users-path', 'Users\\someone'],
      ['token', 'token='],
      ['token', 'token=abcdef'],
      ['local-address', 'localhost'],
      ['local-address', '127.0.0.1'],
      ['address', 'http://example.test/x'],
      ['address', 'https://github.com/other/x'],
      ['placeholder', 'TBD'],
      ['placeholder', 'TODO'],
      ['placeholder', 'FIXME'],
    ];
    fc.assert(
      fc.property(fc.constantFrom(...patterns), fc.nat(), arbFiller, ([rule, pattern], pos, filler) => {
        const lines = baseLines(filler);
        lines.splice(pos % (lines.length + 1), 0, `note ${pattern} end`);
        expect(rulesOf(lintReadme(lines.join('\n')))).toContain(rule);
      }),
      { numRuns: 300 },
    );
  });
});

describe('the real README.md', () => {
  it('gives no problem', () => {
    const text = readFileSync(`${ROOT}README.md`, 'utf8');
    expect(lintReadme(text)).toEqual([]);
  });
});
