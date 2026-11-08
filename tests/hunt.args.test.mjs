// @ts-check
// Unit tests for scripts/hunt/args.mjs (task 6.1). The module does not exist yet: these tests fail until task 6.2.
// See .kiro/specs/exploit-hunt/design.md, "args.mjs" and "Refusal reasons" for the order of `detail` values.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseInfoArgs, parseNoArgs, parseSubmitArgs } from '../scripts/hunt/args.mjs';
import { parseActions } from '../scripts/hunt/tokens.mjs';
import { arbArgv } from './hunt.arbitraries.mjs';
import { isValidLevelId } from '../scripts/replay/levels.mjs';

/** @param {unknown} r @param {string} detail */
function refused(r, detail) {
  expect(r).toEqual({ ok: false, detail });
}

const GOOD = ['--level', '02-the-chaser', '--class', 'cheaper_win', '--actions', 'N', 'E'];

describe('parseSubmitArgs: a good call', () => {
  it('returns the level, the class and the decoded actions', () => {
    expect(parseSubmitArgs(GOOD)).toEqual({
      ok: true,
      levelId: '02-the-chaser',
      claimedClass: 'cheaper_win',
      actions: [
        { kind: 'move', dir: 'N' },
        { kind: 'move', dir: 'E' },
      ],
    });
  });

  it('accepts every class and decodes edit, wait and undo tokens', () => {
    for (const c of ['cheaper_win', 'free_win', 'unexpected_route']) {
      const r = parseSubmitArgs(['--level', 'a1', '--class', c, '--actions', 'wait', 'undo', 'edit:B14=%3DB15%2B1']);
      expect(r).toEqual({
        ok: true,
        levelId: 'a1',
        claimedClass: c,
        actions: [{ kind: 'wait' }, { kind: 'undo' }, { kind: 'edit', address: 'B14', raw: '=B15+1' }],
      });
    }
  });
});

describe('parseSubmitArgs: refusals, one per detail', () => {
  it('missing_level: no --level in the list (also for an empty list)', () => {
    refused(parseSubmitArgs([]), 'missing_level');
    refused(parseSubmitArgs(['--class', 'cheaper_win', '--actions', 'N']), 'missing_level');
  });

  it('missing_class: no --class in the list', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--actions', 'N']), 'missing_class');
    refused(parseSubmitArgs(['--level', 'a1']), 'missing_class');
  });

  it('missing_actions: no --actions in the list', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'free_win']), 'missing_actions');
  });

  it('unexpected_argument: a flag out of order', () => {
    refused(parseSubmitArgs(['--class', 'cheaper_win', '--level', 'a1', '--actions', 'N']), 'unexpected_argument');
    refused(parseSubmitArgs(['--level', 'a1', '--actions', 'N', '--class', 'cheaper_win']), 'unexpected_argument');
  });

  it('unexpected_argument: a repeated flag', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--level', 'b2', '--class', 'cheaper_win', '--actions', 'N']), 'unexpected_argument');
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'cheaper_win', '--class', 'free_win', '--actions', 'N']), 'unexpected_argument');
  });

  it('unexpected_argument: --actions is not last (a second --actions after the tokens)', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'cheaper_win', '--actions', 'N', '--actions', 'E']), 'unexpected_argument');
  });

  it('unexpected_argument: any other word before --actions', () => {
    refused(parseSubmitArgs(['stray', ...GOOD]), 'unexpected_argument');
    refused(parseSubmitArgs(['--level', 'a1', 'stray', '--class', 'cheaper_win', '--actions', 'N']), 'unexpected_argument');
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'cheaper_win', 'stray', '--actions', 'N']), 'unexpected_argument');
  });

  it('bad_level_id: the cases agree with isValidLevelId', () => {
    for (const id of ['..', 'a/b', 'a\\b', 'a b', 'Abc', '']) {
      expect(isValidLevelId(id)).toBe(false);
      refused(parseSubmitArgs(['--level', id, '--class', 'cheaper_win', '--actions', 'N']), 'bad_level_id');
    }
  });

  it('bad_class: not one of the three classes (case sensitive)', () => {
    for (const c of ['', 'cheap', 'Cheaper_Win', 'cheaper-win', '--actions']) {
      refused(parseSubmitArgs(['--level', 'a1', '--class', c, '--actions', 'N']), 'bad_class');
    }
  });

  it('empty_actions: --actions with no token after it', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'cheaper_win', '--actions']), 'empty_actions');
  });

  it('too_many_tokens: 41 tokens refused, 40 accepted', () => {
    const head = ['--level', 'a1', '--class', 'cheaper_win', '--actions'];
    refused(parseSubmitArgs([...head, ...Array(41).fill('N')]), 'too_many_tokens');
    const ok = parseSubmitArgs([...head, ...Array(40).fill('N')]);
    expect(ok.ok).toBe(true);
  });
});

describe('parseSubmitArgs: token details of task 5, passed through', () => {
  const head = ['--level', 'a1', '--class', 'cheaper_win', '--actions'];
  /** @type {Array<[string, string[]]>} */
  const cases = [
    ['embedded_space', ['edit:B14=a b']],
    ['unknown_token', ['n']],
    ['unknown_token', ['Wait']],
    ['bad_address', ['edit:b14=7']],
    ['unescaped_character', ['edit:B14==7']],
    ['bad_escape', ['edit:B14=%4']],
    ['bad_utf8', ['edit:B14=%E9']],
    ['raw_too_long', ['edit:B14=' + 'a'.repeat(41)]],
    ['too_many_edits', Array(5).fill('edit:B14=7')],
  ];
  for (const [detail, tokens] of cases) {
    it(`${detail}: ${JSON.stringify(tokens).slice(0, 40)}`, () => {
      refused(parseSubmitArgs([...head, ...tokens]), detail);
    });
  }

  it('the token that comes first from the left decides', () => {
    refused(parseSubmitArgs([...head, 'N', 'edit:b14=7', 'zzz']), 'bad_address');
    refused(parseSubmitArgs([...head, 'zzz', 'edit:B14=%4']), 'unknown_token');
  });
});

describe('parseSubmitArgs: the first problem wins', () => {
  it('a missing flag beats an unexpected word and a bad value', () => {
    refused(parseSubmitArgs(['stray', '--class', 'nope', '--actions', 'N']), 'missing_level');
    refused(parseSubmitArgs(['--level', '..', '--actions', 'zzz']), 'missing_class');
    refused(parseSubmitArgs(['--level', '..', '--class', 'nope']), 'missing_actions');
  });

  it('missing_level beats missing_class beats missing_actions', () => {
    refused(parseSubmitArgs(['--actions']), 'missing_level');
    refused(parseSubmitArgs(['--level', 'a1', '--actions']), 'missing_class');
  });

  it('unexpected_argument beats bad_level_id, bad_class and a bad token', () => {
    refused(parseSubmitArgs(['stray', '--level', '..', '--class', 'nope', '--actions', 'zzz']), 'unexpected_argument');
  });

  it('bad_level_id beats bad_class, empty_actions-like and token problems', () => {
    refused(parseSubmitArgs(['--level', '..', '--class', 'nope', '--actions', 'zzz']), 'bad_level_id');
  });

  it('bad_class beats empty_actions and token problems', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'nope', '--actions']), 'bad_class');
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'nope', '--actions', 'zzz']), 'bad_class');
  });

  it('too_many_tokens beats a bad token', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'cheaper_win', '--actions', 'zzz', ...Array(40).fill('N')]), 'too_many_tokens');
  });
});

describe('parseSubmitArgs: never throws', () => {
  it('a non-array gives a refusal with a string detail', () => {
    for (const v of [undefined, null, 'x', 5, {}, true, () => 1, Symbol('s')]) {
      const r = /** @type {any} */ (parseSubmitArgs(v));
      expect(r.ok).toBe(false);
      expect(typeof r.detail).toBe('string');
    }
  });

  it('non-string members in the flag positions give a refusal', () => {
    for (const argv of [[1, 2, 3], [null, undefined, {}], ['--level', 5, '--class', 'cheaper_win', '--actions', 'N'], ['--level', 'a1', '--class', null, '--actions', 'N']]) {
      const r = /** @type {any} */ (parseSubmitArgs(argv));
      expect(r.ok).toBe(false);
      expect(typeof r.detail).toBe('string');
    }
  });

  it('a non-string token after --actions is an unknown_token', () => {
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'cheaper_win', '--actions', 'N', 7]), 'unknown_token');
    refused(parseSubmitArgs(['--level', 'a1', '--class', 'cheaper_win', '--actions', null]), 'unknown_token');
  });
});

describe('parseInfoArgs', () => {
  it('accepts --level ID only', () => {
    expect(parseInfoArgs(['--level', '02-the-chaser'])).toEqual({ ok: true, levelId: '02-the-chaser' });
  });

  it('missing_level: no --level', () => {
    refused(parseInfoArgs([]), 'missing_level');
  });

  it('unexpected_argument: anything besides --level ID', () => {
    refused(parseInfoArgs(['--level', 'a1', 'extra']), 'unexpected_argument');
    refused(parseInfoArgs(['--level', 'a1', '--level', 'b2']), 'unexpected_argument');
    refused(parseInfoArgs(['stray', '--level', 'a1']), 'unexpected_argument');
    refused(parseInfoArgs(['--level', 'a1', '--class', 'cheaper_win']), 'unexpected_argument');
  });

  it('bad_level_id: the cases agree with isValidLevelId', () => {
    for (const id of ['..', 'a/b', 'a b', 'Abc', '']) {
      expect(isValidLevelId(id)).toBe(false);
      refused(parseInfoArgs(['--level', id]), 'bad_level_id');
    }
  });

  it('unexpected_argument beats bad_level_id', () => {
    refused(parseInfoArgs(['--level', '..', 'extra']), 'unexpected_argument');
  });

  it('never throws on non-arrays or non-string members', () => {
    for (const v of [undefined, null, 'x', 5, {}, [null], [1, 2], ['--level', 5]]) {
      const r = /** @type {any} */ (parseInfoArgs(v));
      expect(r.ok).toBe(false);
      expect(typeof r.detail).toBe('string');
    }
  });
});

describe('parseNoArgs', () => {
  it('an empty list is ok', () => {
    expect(parseNoArgs([])).toEqual({ ok: true });
  });

  it('any argument is refused with unexpected_argument', () => {
    refused(parseNoArgs(['x']), 'unexpected_argument');
    refused(parseNoArgs(['--level', 'a1']), 'unexpected_argument');
    refused(parseNoArgs(['']), 'unexpected_argument');
  });

  it('never throws on non-arrays or non-string members', () => {
    for (const v of [undefined, null, 'x', 5, {}, [null], [1]]) {
      const r = /** @type {any} */ (parseNoArgs(v));
      expect(r.ok).toBe(false);
      expect(typeof r.detail).toBe('string');
    }
  });
});

// Feature: exploit-hunt, Property 3: The parser is total
// **Validates: Requirements 7.10, 7.5**
describe('Property 3: The parser is total', () => {
  const LIMITS = { tokens: 40, edits: 4, rawBytes: 40, addressChars: 6 };

  /** @param {any} actions */
  function expectObeysLimits(actions) {
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions.length).toBeLessThanOrEqual(LIMITS.tokens);
    const edits = actions.filter((/** @type {any} */ a) => a.kind === 'edit');
    expect(edits.length).toBeLessThanOrEqual(LIMITS.edits);
    for (const a of actions) {
      expect(['move', 'wait', 'undo', 'edit']).toContain(a.kind);
      if (a.kind === 'edit') {
        expect(typeof a.address).toBe('string');
        expect(a.address.length).toBeGreaterThanOrEqual(1);
        expect(a.address.length).toBeLessThanOrEqual(LIMITS.addressChars);
        expect(typeof a.raw).toBe('string');
        expect(new TextEncoder().encode(a.raw).length).toBeLessThanOrEqual(LIMITS.rawBytes);
      }
    }
  }

  /** @param {any} r @param {(r:any)=>void} onValid @returns {boolean} true when valid */
  function expectValidOrRefused(r, onValid) {
    expect(r !== null && typeof r === 'object').toBe(true);
    if (r.ok === true) {
      onValid(r);
      return true;
    }
    expect(r.ok).toBe(false);
    expect(typeof r.detail).toBe('string');
    expect(r.detail.length).toBeGreaterThan(0);
    return false;
  }

  const seen = { actionsValid: 0, actionsRefused: 0, submitValid: 0, submitRefused: 0 };

  it('parseActions returns a valid result within every limit or a refusal with a detail, never throws', () => {
    fc.assert(
      fc.property(arbArgv, (argv) => {
        /** @type {any} */
        let r;
        expect(() => {
          r = parseActions(argv);
        }).not.toThrow();
        const valid = expectValidOrRefused(r, (v) => expectObeysLimits(v.actions));
        if (valid) seen.actionsValid += 1;
        else seen.actionsRefused += 1;
      }),
      { numRuns: 300 },
    );
    expect(seen.actionsValid).toBeGreaterThan(0);
    expect(seen.actionsRefused).toBeGreaterThan(0);
  });

  it('parseSubmitArgs returns a valid result within every limit or a refusal with a detail, never throws', () => {
    const arbSubmitInput = fc.oneof(
      { weight: 1, arbitrary: arbArgv },
      {
        weight: 2,
        arbitrary: fc
          .tuple(fc.constantFrom('a1', '02-the-chaser', '..', 'Up'), fc.constantFrom('cheaper_win', 'free_win', 'unexpected_route', 'bogus'), arbArgv)
          .map(([level, cls, tokens]) => ['--level', level, '--class', cls, '--actions', ...tokens]),
      },
    );
    fc.assert(
      fc.property(arbSubmitInput, (argv) => {
        /** @type {any} */
        let r;
        expect(() => {
          r = parseSubmitArgs(argv);
        }).not.toThrow();
        const valid = expectValidOrRefused(r, (v) => {
          expect(isValidLevelId(v.levelId)).toBe(true);
          expect(['cheaper_win', 'free_win', 'unexpected_route']).toContain(v.claimedClass);
          expectObeysLimits(v.actions);
        });
        if (valid) seen.submitValid += 1;
        else seen.submitRefused += 1;
      }),
      { numRuns: 300 },
    );
    expect(seen.submitValid).toBeGreaterThan(0);
    expect(seen.submitRefused).toBeGreaterThan(0);
  });
});
