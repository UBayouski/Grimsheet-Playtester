import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbActionList, arbCodePointString } from './arbitraries';
import { actionsFileText, decodeActions, decodeToken, encodeAction, encodeActions, replayCommand, type Action } from '../src/core/tokens';

const C3F = 'edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29';

describe('decodeToken', () => {
  it('decodes the moves, wait and undo', () => {
    expect(decodeToken('N')).toEqual({ kind: 'move', dir: 'N' });
    expect(decodeToken('S')).toEqual({ kind: 'move', dir: 'S' });
    expect(decodeToken('E')).toEqual({ kind: 'move', dir: 'E' });
    expect(decodeToken('W')).toEqual({ kind: 'move', dir: 'W' });
    expect(decodeToken('wait')).toEqual({ kind: 'wait' });
    expect(decodeToken('undo')).toEqual({ kind: 'undo' });
  });

  it('is case sensitive', () => {
    for (const t of ['n', 'e', 'Wait', 'WAIT', 'Undo', 'EDIT:B14=7', 'Edit:B14=7']) expect(decodeToken(t), t).toBeNull();
  });

  it('decodes an edit token', () => {
    expect(decodeToken('edit:B14=7')).toEqual({ kind: 'edit', address: 'B14', raw: '7' });
    expect(decodeToken('edit:B14=%3DB15%2B1')).toEqual({ kind: 'edit', address: 'B14', raw: '=B15+1' });
    expect(decodeToken('edit:B14=')).toEqual({ kind: 'edit', address: 'B14', raw: '' });
    expect(decodeToken('edit:AB123=x.y_z-1')).toEqual({ kind: 'edit', address: 'AB123', raw: 'x.y_z-1' });
  });

  it('accepts lower-case hex digits, and an escaped safe character', () => {
    expect(decodeToken('edit:B14=%3d')).toEqual({ kind: 'edit', address: 'B14', raw: '=' });
    expect(decodeToken('edit:B14=%41')).toEqual({ kind: 'edit', address: 'B14', raw: 'A' });
    expect(decodeToken('edit:B14=%c3%a9')).toEqual({ kind: 'edit', address: 'B14', raw: '\u00e9' });
  });

  it('rejects a bad address', () => {
    for (const t of ['edit:b14=7', 'edit:B=7', 'edit:14=7', 'edit:ABCDEFG1=7', 'edit:ABCDE12=7', 'edit:=7', 'edit:B1 4=7', 'edit:B14', 'edit:']) {
      expect(decodeToken(t), t).toBeNull();
    }
  });

  it('accepts an address of exactly 6 characters', () => {
    expect(decodeToken('edit:ABCDE1=7')).toEqual({ kind: 'edit', address: 'ABCDE1', raw: '7' });
  });

  it('rejects a lone %, a % with fewer than two hex digits, a non-hex escape, and an unescaped unsafe character', () => {
    for (const raw of ['%', '%4', 'a%', '%ZZ', '%G1', '%4G', 'a b', 'a=b', 'a:b', '\u00e9', '(', '"', '\u{1F600}', '\ud800']) {
      expect(decodeToken(`edit:B14=${raw}`), raw).toBeNull();
    }
  });

  it('rejects bytes that are not valid UTF-8', () => {
    for (const raw of ['%C3%28', '%FF', '%C0%AF', '%ED%A0%80', '%80', '%C3', '%F4%90%80%80', '%E2%82']) {
      expect(decodeToken(`edit:B14=${raw}`), raw).toBeNull();
    }
  });

  it('keeps a leading byte order mark', () => {
    expect(decodeToken('edit:A1=%EF%BB%BF')).toEqual({ kind: 'edit', address: 'A1', raw: '\uFEFF' });
    expect(decodeToken('edit:A1=%EF%BB%BFx')).toEqual({ kind: 'edit', address: 'A1', raw: '\uFEFFx' });
  });

  it('gives null for a value that is not a string', () => {
    for (const v of [null, undefined, 5, {}, [], true]) expect(decodeToken(v as unknown as string)).toBeNull();
  });

  it('decodes the C3-f token of the exploit-hunt design', () => {
    expect(decodeToken(C3F)).toEqual({ kind: 'edit', address: 'B14', raw: '=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")' });
  });
});

describe('decodeActions', () => {
  it('returns the list, or null when any token fails', () => {
    expect(decodeActions(['N', 'wait', 'edit:A1=7'])).toEqual([{ kind: 'move', dir: 'N' }, { kind: 'wait' }, { kind: 'edit', address: 'A1', raw: '7' }]);
    expect(decodeActions(['N', 'bogus', 'E'])).toBeNull();
    expect(decodeActions([])).toEqual([]);
  });
});

describe('encodeAction and encodeActions', () => {
  it('writes the canonical form', () => {
    expect(encodeAction({ kind: 'move', dir: 'W' })).toBe('W');
    expect(encodeAction({ kind: 'wait' })).toBe('wait');
    expect(encodeAction({ kind: 'undo' })).toBe('undo');
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: '' })).toBe('edit:B14=');
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: 'x.y_z-1' })).toBe('edit:B14=x.y_z-1');
  });

  it('uses upper-case hex for every byte outside A-Z a-z 0-9 . _ -', () => {
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: 'a b' })).toBe('edit:B14=a%20b');
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: '"' })).toBe('edit:B14=%22');
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: '\u00e9' })).toBe('edit:B14=%C3%A9');
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: '\u20ac' })).toBe('edit:B14=%E2%82%AC');
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: '\u{1F600}' })).toBe('edit:B14=%F0%9F%98%80');
    expect(encodeAction({ kind: 'edit', address: 'B14', raw: '=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")' })).toBe(C3F);
  });

  it('encodeActions maps the list', () => {
    expect(encodeActions([{ kind: 'move', dir: 'E' }, { kind: 'undo' }])).toEqual(['E', 'undo']);
  });
});

describe('actionsFileText', () => {
  it('is JSON with two-space indentation, no trailing newline, and keys in the order of the design', () => {
    const actions: Action[] = [{ kind: 'move', dir: 'N' }, { kind: 'wait' }, { kind: 'edit', address: 'B14', raw: '=1' }];
    const text = actionsFileText(actions);
    expect(text).toBe(JSON.stringify(actions, null, 2));
    expect(text.endsWith('\n')).toBe(false);
    expect(text).toContain('\n  {\n    "kind": "move",\n    "dir": "N"\n  }');
    expect(text.indexOf('"address"')).toBeLessThan(text.indexOf('"raw"'));
    expect(JSON.parse(text)).toEqual(actions);
  });

  it('is a JSON array, also for an empty list', () => {
    expect(actionsFileText([])).toBe('[]');
  });
});

describe('replayCommand', () => {
  it('builds the play command with the literal <actions-file>', () => {
    expect(replayCommand('02-the-chaser')).toBe('node scripts/play.mjs 02-the-chaser --actions-file <actions-file>');
    expect(replayCommand('a')).toBe('node scripts/play.mjs a --actions-file <actions-file>');
  });

  it('gives null for a level id that does not match the pattern', () => {
    for (const id of ['..', 'a/b', 'a\\b', 'A', '', 'a b', '-a', 'a.b', 'a\n', '02-the-chaser; calc']) expect(replayCommand(id), id).toBeNull();
  });
});
describe('token properties', () => {
  // Feature: dashboard, Property 8: Token round trip
  it('Property 8: decoding the canonical tokens of a valid action list gives the list back', () => {
    fc.assert(
      fc.property(arbActionList, (list) => {
        const tokens = encodeActions(list);
        expect(decodeActions(tokens)).toEqual(list);
        for (const token of tokens) {
          expect(token.length).toBeLessThanOrEqual(140);
          if (token.startsWith('edit:')) {
            expect(token).toMatch(/^edit:[A-Z]+[0-9]+=(?:[A-Za-z0-9._-]|%[0-9A-F]{2})*$/);
          } else {
            expect(['N', 'S', 'E', 'W', 'wait', 'undo']).toContain(token);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('Property 8: the C3-f token decodes to the edit value of the exploit-hunt design', () => {
    expect(decodeToken(C3F)).toEqual({ kind: 'edit', address: 'B14', raw: '=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")' });
  });

  // Feature: dashboard, Property 9: Decoder totality and rejection
  it('Property 9: the decoder never throws, rejects bad escapes and bad UTF-8, and ignores the case of hex digits', () => {
    // Totality: any string, including strings with lone surrogates.
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 60 }), fc.string({ unit: 'binary', maxLength: 60 }), fc.constantFrom('', '%', 'edit:', 'edit:A1=%')), (token) => {
        const action = decodeToken(token);
        expect(action === null || typeof action.kind === 'string').toBe(true);
      }),
      { numRuns: 300 },
    );
    // Rejection: a valid encoded prefix followed by a bad ending.
    const badEndings = ['%', '%4', '%G1', '%ZZ', '%4G', '%C3%28', '%FF', '%C0%AF', '%ED%A0%80', '%80', '%C3', '%F4%90%80%80', '%E2%82'];
    fc.assert(
      fc.property(arbCodePointString(30), fc.constantFrom(...badEndings), (prefix, ending) => {
        const encodedPrefix = encodeAction({ kind: 'edit', address: 'A1', raw: prefix });
        expect(decodeToken(`${encodedPrefix}${ending}`), ending).toBeNull();
      }),
      { numRuns: 300 },
    );
    // Case: lower-case hex digits decode to the same actions.
    fc.assert(
      fc.property(arbActionList, (list) => {
        const lower = encodeActions(list).map((token) => token.replace(/%([0-9A-F]{2})/g, (_m, hex: string) => `%${hex.toLowerCase()}`));
        expect(decodeActions(lower)).toEqual(list);
      }),
      { numRuns: 300 },
    );
  });
});