// @ts-check
// Unit tests for scripts/hunt/tokens.mjs (exploit-hunt design: "tokens.mjs" and "Token grammar").
// Task 5.1: these tests are written before the module exists, so they fail until task 5.2.
import { readFileSync } from 'node:fs';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeRaw, encodeRaw, parseActions, printAction, printActions, tryPrintActions } from '../scripts/hunt/tokens.mjs';
import { arbActionList, canonicalTokens, encodeRawLocal } from './hunt.arbitraries.mjs';

/** @param {string} name @returns {any} */
function readSolution(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/solutions/${name}.json`, import.meta.url), 'utf8'));
}

/** The `detail` of a refused parse, or undefined for an accepted one. @param {unknown} args @returns {string|undefined} */
const detailOf = (args) => {
  const r = parseActions(args);
  return r.ok ? undefined : r.detail;
};

/** @param {string} detail */
const refused = (detail) => ({ ok: false, detail });

/** @param {any[]} actions */
const accepted = (actions) => ({ ok: true, actions });

// The C3-f arguments after `--actions` (design, "The C3-f argument").
const C3F_EDIT = 'edit:B14=%3DIF%28DIST%28HERO%2CSELF%29%3C1%2CTOWARD%28HERO%29%2C%22-%22%29';
const C3F_RAW = '=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")';

describe('parseActions: grammar examples', () => {
  it('accepts moves, wait and undo', () => {
    expect(parseActions(['N', 'E', 'wait', 'undo'])).toEqual(
      accepted([{ kind: 'move', dir: 'N' }, { kind: 'move', dir: 'E' }, { kind: 'wait' }, { kind: 'undo' }]),
    );
  });

  it('accepts all four directions', () => {
    expect(parseActions(['N', 'S', 'E', 'W'])).toEqual(
      accepted([{ kind: 'move', dir: 'N' }, { kind: 'move', dir: 'S' }, { kind: 'move', dir: 'E' }, { kind: 'move', dir: 'W' }]),
    );
  });

  it('accepts an edit token', () => {
    expect(parseActions(['edit:B14=7'])).toEqual(accepted([{ kind: 'edit', address: 'B14', raw: '7' }]));
  });

  it('accepts moves around an edit', () => {
    expect(parseActions(['E', 'edit:C14=7', 'N'])).toEqual(
      accepted([{ kind: 'move', dir: 'E' }, { kind: 'edit', address: 'C14', raw: '7' }, { kind: 'move', dir: 'N' }]),
    );
  });

  it('decodes escaped characters', () => {
    expect(parseActions(['edit:B14=%3DB15%2B1'])).toEqual(accepted([{ kind: 'edit', address: 'B14', raw: '=B15+1' }]));
  });

  it('accepts lower-case hex and prints it back as upper case', () => {
    const r = parseActions(['edit:B14=%3d']);
    expect(r).toEqual(accepted([{ kind: 'edit', address: 'B14', raw: '=' }]));
    if (r.ok) expect(printActions(r.actions)).toEqual(['edit:B14=%3D']);
  });

  it('accepts an empty raw', () => {
    expect(parseActions(['edit:B14='])).toEqual(accepted([{ kind: 'edit', address: 'B14', raw: '' }]));
  });

  it('accepts an escaped safe character and prints it unescaped', () => {
    const r = parseActions(['edit:B14=%41']);
    expect(r).toEqual(accepted([{ kind: 'edit', address: 'B14', raw: 'A' }]));
    if (r.ok) expect(printActions(r.actions)).toEqual(['edit:B14=A']);
  });

  it('accepts a multi-byte character as UTF-8 escapes', () => {
    expect(parseActions(['edit:B14=%C3%A9'])).toEqual(accepted([{ kind: 'edit', address: 'B14', raw: '\u00e9' }]));
  });
});

describe('parseActions: refusals', () => {
  it('refuses a literal = in raw as unescaped_character', () => {
    expect(parseActions(['edit:B14==7'])).toEqual(refused('unescaped_character'));
  });

  it('refuses other unescaped characters', () => {
    expect(detailOf(['edit:B14=('])).toBe('unescaped_character');
    expect(detailOf(['edit:B14=a:b'])).toBe('unescaped_character');
    expect(detailOf(['edit:B14=\u00e9'])).toBe('unescaped_character');
  });

  it('refuses a lone byte as bad_utf8', () => {
    expect(parseActions(['edit:B14=%E9'])).toEqual(refused('bad_utf8'));
  });

  it('refuses an overlong form and an encoded surrogate as bad_utf8', () => {
    expect(parseActions(['edit:B14=%C0%80'])).toEqual(refused('bad_utf8'));
    expect(parseActions(['edit:B14=%ED%A0%80'])).toEqual(refused('bad_utf8'));
  });

  it('refuses a short escape as bad_escape', () => {
    expect(parseActions(['edit:B14=%4'])).toEqual(refused('bad_escape'));
    expect(parseActions(['edit:B14=%'])).toEqual(refused('bad_escape'));
    expect(parseActions(['edit:B14=%zz'])).toEqual(refused('bad_escape'));
  });

  it('refuses a lower-case address as bad_address', () => {
    expect(parseActions(['edit:b14=7'])).toEqual(refused('bad_address'));
  });

  it('refuses other malformed addresses as bad_address', () => {
    expect(detailOf(['edit:=7'])).toBe('bad_address');
    expect(detailOf(['edit:14=7'])).toBe('bad_address');
    expect(detailOf(['edit:B=7'])).toBe('bad_address');
  });

  it('refuses a 7-character address as bad_address and accepts a 6-character one', () => {
    expect(parseActions(['edit:ABCDEF1=7'])).toEqual(refused('bad_address'));
    expect(parseActions(['edit:ABCDE1=7'])).toEqual(accepted([{ kind: 'edit', address: 'ABCDE1', raw: '7' }]));
  });

  it('refuses unknown tokens', () => {
    expect(parseActions(['b'])).toEqual(refused('unknown_token'));
    expect(parseActions(['Wait'])).toEqual(refused('unknown_token'));
    expect(parseActions(['EDIT:'])).toEqual(refused('unknown_token'));
    expect(parseActions(['n'])).toEqual(refused('unknown_token'));
    expect(parseActions([''])).toEqual(refused('unknown_token'));
  });

  it('refuses a non-string token as unknown_token and never throws', () => {
    for (const bad of [5, null, undefined, true, {}, [], ['N'], Number.NaN]) {
      expect(parseActions([bad])).toEqual(refused('unknown_token'));
    }
  });

  it('refuses a token with a space as embedded_space', () => {
    expect(parseActions(['N E'])).toEqual(refused('embedded_space'));
    expect(parseActions(['edit:B14=a b'])).toEqual(refused('embedded_space'));
  });

  it('decides the first problem from the left, in the design order', () => {
    // embedded_space comes before unknown_token for the same token
    expect(detailOf(['b a'])).toBe('embedded_space');
    // the first bad token decides, even when a later one is worse
    expect(detailOf(['x', 'N E'])).toBe('unknown_token');
    expect(detailOf(['N E', 'x'])).toBe('embedded_space');
    // within one edit token: bad_address before unescaped_character before bad_escape before bad_utf8
    expect(detailOf(['edit:b14==%4'])).toBe('bad_address');
    expect(detailOf(['edit:B14=(%4'])).toBe('unescaped_character');
    expect(detailOf(['edit:B14=%4%E9'])).toBe('bad_escape');
  });
});

describe('parseActions: the C3-f arguments', () => {
  it('has the 74-character edit token and a 39-character raw', () => {
    expect(C3F_EDIT).toHaveLength(74);
    expect(C3F_RAW).toHaveLength(39);
    expect(encodeRawLocal(C3F_RAW)).toBe(C3F_EDIT.slice('edit:B14='.length));
  });

  it('accepts N, the edit token and E', () => {
    expect(parseActions(['N', C3F_EDIT, 'E'])).toEqual(
      accepted([{ kind: 'move', dir: 'N' }, { kind: 'edit', address: 'B14', raw: C3F_RAW }, { kind: 'move', dir: 'E' }]),
    );
  });

  it('prints the same tokens back', () => {
    expect(printActions([{ kind: 'move', dir: 'N' }, { kind: 'edit', address: 'B14', raw: C3F_RAW }, { kind: 'move', dir: 'E' }])).toEqual(['N', C3F_EDIT, 'E']);
  });
});

describe('parseActions: limits', () => {
  it('accepts a raw of exactly 40 ASCII characters (40 bytes)', () => {
    const raw = 'a'.repeat(40);
    expect(parseActions([`edit:B14=${raw}`])).toEqual(accepted([{ kind: 'edit', address: 'B14', raw }]));
  });

  it('refuses a raw of 41 ASCII characters (41 bytes) as raw_too_long', () => {
    expect(parseActions([`edit:B14=${'a'.repeat(41)}`])).toEqual(refused('raw_too_long'));
  });

  it('counts the limit in UTF-8 bytes, not code points or UTF-16 units', () => {
    const emoji = '\ud83d\ude00';
    const enc = encodeRawLocal(emoji);
    expect(enc).toBe('%F0%9F%98%80');
    // 10 x U+1F600 = 40 bytes: accepted, and its encoded value is exactly 120 characters.
    const token = `edit:B14=${enc.repeat(10)}`;
    expect(token).toBe(`edit:B14=${'%F0%9F%98%80'.repeat(10)}`);
    expect(token.length - 'edit:B14='.length).toBe(120);
    expect(parseActions([token])).toEqual(accepted([{ kind: 'edit', address: 'B14', raw: emoji.repeat(10) }]));
    expect(printAction({ kind: 'edit', address: 'B14', raw: emoji.repeat(10) })).toBe(token);
    // 11 x U+1F600 = 44 bytes: refused.
    expect(parseActions([`edit:B14=${enc.repeat(11)}`])).toEqual(refused('raw_too_long'));
    // 20 x U+00E9 = 40 bytes accepted, 21 = 42 bytes refused.
    const e = encodeRawLocal('\u00e9');
    expect(detailOf([`edit:B14=${e.repeat(20)}`])).toBeUndefined();
    expect(detailOf([`edit:B14=${e.repeat(21)}`])).toBe('raw_too_long');
  });

  it('accepts the worst-case edit token of 132 characters', () => {
    const raw = ' '.repeat(40);
    const token = `edit:ABCDE1=${'%20'.repeat(40)}`;
    expect(token).toHaveLength(132);
    expect(parseActions([token])).toEqual(accepted([{ kind: 'edit', address: 'ABCDE1', raw }]));
    expect(printAction({ kind: 'edit', address: 'ABCDE1', raw })).toBe(token);
  });

  it('accepts 40 tokens and refuses 41 as too_many_tokens', () => {
    expect(parseActions(Array(40).fill('wait'))).toEqual(accepted(Array(40).fill({ kind: 'wait' })));
    expect(parseActions(Array(41).fill('wait'))).toEqual(refused('too_many_tokens'));
  });

  it('decides too_many_tokens before the tokens are looked at', () => {
    expect(detailOf(Array(41).fill('bogus'))).toBe('too_many_tokens');
  });

  it('accepts 4 edits and refuses 5 as too_many_edits', () => {
    const four = ['edit:A1=1', 'edit:A2=2', 'edit:A3=3', 'edit:A4=4'];
    const r = parseActions(four);
    expect(r.ok).toBe(true);
    expect(parseActions([...four, 'edit:A5=5'])).toEqual(refused('too_many_edits'));
  });

  it('decides too_many_edits after the per-token problems', () => {
    const five = ['edit:A1=1', 'edit:A2=2', 'edit:A3=3', 'edit:A4=4', 'edit:A5=5'];
    expect(detailOf([...five, 'x'])).toBe('unknown_token');
  });
});

describe('printAction and printActions', () => {
  it('prints moves, wait and undo', () => {
    expect(printAction({ kind: 'move', dir: 'W' })).toBe('W');
    expect(printAction({ kind: 'wait' })).toBe('wait');
    expect(printAction({ kind: 'undo' })).toBe('undo');
  });

  it('prints an edit with upper-case hex', () => {
    expect(printAction({ kind: 'edit', address: 'B14', raw: '=B15+1' })).toBe('edit:B14=%3DB15%2B1');
    expect(printAction({ kind: 'edit', address: 'B14', raw: '' })).toBe('edit:B14=');
  });

  it('escapes a space, a double quote and e-acute', () => {
    expect(printAction({ kind: 'edit', address: 'B14', raw: ' ' })).toBe('edit:B14=%20');
    expect(printAction({ kind: 'edit', address: 'B14', raw: '"' })).toBe('edit:B14=%22');
    expect(printAction({ kind: 'edit', address: 'B14', raw: '\u00e9' })).toBe('edit:B14=%C3%A9');
  });

  it('keeps the safe set unescaped', () => {
    expect(printAction({ kind: 'edit', address: 'B14', raw: 'AZaz09._-' })).toBe('edit:B14=AZaz09._-');
  });

  it('printActions maps printAction over the list', () => {
    expect(printActions([{ kind: 'move', dir: 'N' }, { kind: 'wait' }, { kind: 'edit', address: 'C14', raw: '7' }])).toEqual(['N', 'wait', 'edit:C14=7']);
    expect(printActions([])).toEqual([]);
  });
});

describe('tryPrintActions', () => {
  it('returns null for an edit whose address cannot be written', () => {
    expect(tryPrintActions([{ kind: 'edit', address: 'b14', raw: '7' }])).toBeNull();
  });

  it('returns null for a raw that is not well-formed text', () => {
    expect(tryPrintActions([{ kind: 'edit', address: 'B14', raw: '\ud800' }])).toBeNull();
  });

  it('returns null for an unknown kind or a bad direction', () => {
    expect(tryPrintActions([{ kind: 'jump' }])).toBeNull();
    expect(tryPrintActions([{ kind: 'move', dir: 'X' }])).toBeNull();
  });

  it('applies no limits: 41 waits and 5 edits and a long raw print', () => {
    expect(tryPrintActions(Array(41).fill({ kind: 'wait' }))).toEqual(Array(41).fill('wait'));
    const five = ['A1', 'A2', 'A3', 'A4', 'A5'].map((address) => ({ kind: 'edit', address, raw: '1' }));
    expect(tryPrintActions(five)).toHaveLength(5);
    const long = 'x'.repeat(100);
    expect(tryPrintActions([{ kind: 'edit', address: 'B14', raw: long }])).toEqual([`edit:B14=${long}`]);
  });

  it('prints the stored solutions of the fixtures', () => {
    for (const name of ['01-the-corridor', '02-the-chaser', '03-the-locked-crypt']) {
      const solution = readSolution(name);
      const tokens = tryPrintActions(solution.actions);
      expect(tokens).toEqual(canonicalTokens(solution.actions));
      expect(tokens).not.toBeNull();
    }
  });

  it('prints the level 02 formula as the C3-f token', () => {
    const solution = readSolution('02-the-chaser');
    const tokens = tryPrintActions(solution.actions);
    expect(tokens).toContain(C3F_EDIT);
  });
});

describe('encodeRaw and decodeRaw', () => {
  it('encodes to the canonical form', () => {
    expect(encodeRaw('')).toBe('');
    expect(encodeRaw('AZaz09._-')).toBe('AZaz09._-');
    expect(encodeRaw('=B15+1')).toBe('%3DB15%2B1');
    expect(encodeRaw(' "\u00e9')).toBe('%20%22%C3%A9');
    expect(encodeRaw('\ud83d\ude00')).toBe('%F0%9F%98%80');
  });

  it('decodes both cases of hex and escaped safe characters', () => {
    expect(decodeRaw('%3d')).toEqual({ ok: true, raw: '=' });
    expect(decodeRaw('%3D')).toEqual({ ok: true, raw: '=' });
    expect(decodeRaw('%41')).toEqual({ ok: true, raw: 'A' });
    expect(decodeRaw('')).toEqual({ ok: true, raw: '' });
    expect(decodeRaw('%F0%9F%98%80')).toEqual({ ok: true, raw: '\ud83d\ude00' });
  });

  it('decodes what encodeRaw wrote', () => {
    for (const raw of ['', 'abc', '=IF(A1<2,"x")', 'caf\u00e9 \u20ac \ud83d\ude00', '%41%']) {
      expect(decodeRaw(encodeRaw(raw))).toEqual({ ok: true, raw });
    }
  });

  it('names the problem of a bad input', () => {
    expect(decodeRaw('=')).toEqual({ ok: false, detail: 'unescaped_character' });
    expect(decodeRaw('a b')).toEqual({ ok: false, detail: 'unescaped_character' });
    expect(decodeRaw('%4')).toEqual({ ok: false, detail: 'bad_escape' });
    expect(decodeRaw('%G0')).toEqual({ ok: false, detail: 'bad_escape' });
    expect(decodeRaw('%E9')).toEqual({ ok: false, detail: 'bad_utf8' });
  });

  it('refuses a lone surrogate, an overlong form and a truncated sequence as bad_utf8', () => {
    expect(decodeRaw('%ED%A0%80')).toEqual({ ok: false, detail: 'bad_utf8' }); // U+D800
    expect(decodeRaw('%ED%B0%80')).toEqual({ ok: false, detail: 'bad_utf8' }); // U+DC00
    expect(decodeRaw('%C0%AF')).toEqual({ ok: false, detail: 'bad_utf8' });
    expect(decodeRaw('%F0%9F%98')).toEqual({ ok: false, detail: 'bad_utf8' });
  });
});

describe('token properties', () => {
  // Feature: exploit-hunt, Property 1: Token round trip
  // Validates: Requirements 7.9, 7.4
  it('Property 1: parsing the printed tokens gives back an equal action list', () => {
    fc.assert(
      fc.property(arbActionList, (list) => {
        expect(parseActions(printActions(list))).toEqual({ ok: true, actions: list });
      }),
      { numRuns: 200 },
    );
  });
});

/**
 * Rewrite an edit token without changing its meaning: every `%XX` gets its hex digits
 * randomly lower- or upper-cased, and every safe character is randomly written as `%XX`
 * (hex case random). Choices come from `bits`, read in order and cycled.
 * @param {string} token a canonical token
 * @param {boolean[]} bits
 * @param {{ i: number }} cursor shared position in `bits`
 * @returns {string}
 */
function mutateToken(token, bits, cursor) {
  if (!token.startsWith('edit:')) return token;
  const next = () => bits[cursor.i++ % bits.length];
  const hex = (/** @type {string} */ h) => (next() ? h.toLowerCase() : h.toUpperCase());
  const eq = token.indexOf('=');
  const head = token.slice(0, eq + 1);
  const body = token.slice(eq + 1);
  let out = '';
  for (let k = 0; k < body.length; k += 1) {
    const ch = body[k];
    if (ch === '%') {
      out += `%${hex(body.slice(k + 1, k + 3))}`;
      k += 2;
    } else if (next()) {
      out += `%${hex(ch.charCodeAt(0).toString(16).padStart(2, '0'))}`;
    } else {
      out += ch;
    }
  }
  return head + out;
}

describe('token canonical form', () => {
  // Feature: exploit-hunt, Property 2: Canonical form
  // Validates: Requirements 7.9
  it('Property 2: print(parse(X)) is the canonical form of X and printing is stable', () => {
    fc.assert(
      fc.property(arbActionList, fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }), (list, bits) => {
        const canonical = canonicalTokens(list);
        const cursor = { i: 0 };
        const x = canonical.map((t) => mutateToken(t, bits, cursor));

        const parsed = parseActions(x);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const printed = printActions(parsed.actions);

        // print(parse(X)) is the canonical form of X.
        expect(printed).toEqual(canonical);
        // parse(print(parse(X))) equals parse(X).
        expect(parseActions(printed)).toEqual(parsed);
        // When X is already canonical, printing gives X back.
        if (x.every((t, k) => t === canonical[k])) expect(printed).toEqual(x);
        // The canonical form itself is a fixed point.
        expect(printActions(parseActions(canonical).ok ? /** @type {any} */ (parseActions(canonical)).actions : [])).toEqual(canonical);
      }),
      { numRuns: 200 },
    );
  });
});
