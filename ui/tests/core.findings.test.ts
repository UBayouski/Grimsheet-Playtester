import { readFileSync } from 'node:fs';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbFindingItems, findingsValueOf } from './arbitraries';
import { isEarlierCommit, parseFindings } from '../src/core/findings';

const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const findingsOf = (name: string): unknown => (fixture(name)['playtesterResults'] as Record<string, unknown>)['findings'];

const finding = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'hunt-a-001',
  levelId: '02-the-chaser',
  class: 'cheaper_win',
  commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
  huntId: 'hunt-a',
  foundAt: '2026-11-08T11:14:02.511Z',
  actions: ['E', 'N'],
  result: { won: true, inkSpent: 0, minimalInk: 1, editCount: 0, newEditAddresses: [], reasonCode: 'class_reproduced' },
  ...extra,
});
const value = (items: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ schemaVersion: 1, updatedAt: '2026-11-08T11:14:02.640Z', items, ...extra });

describe('parseFindings: the value as a whole', () => {
  it('absent: present is false and nothing is dropped', () => {
    expect(parseFindings(undefined)).toEqual({ present: false, notice: null, header: null, items: [], dropped: 0 });
  });

  it('a record with empty items: present is true with an empty list', () => {
    const view = parseFindings(value([]));
    expect(view.present).toBe(true);
    expect(view.items).toEqual([]);
    expect(view.dropped).toBe(0);
    expect(view.header).not.toBeNull();
  });

  it('a legacy array, a string, a number and null: present is false and one part is dropped', () => {
    for (const v of [[], [finding()], 'x', 5, null, true]) {
      const view = parseFindings(v);
      expect(view.present, JSON.stringify(v)).toBe(false);
      expect(view.items).toEqual([]);
      expect(view.dropped).toBe(1);
    }
  });

  it('items that is not a list: no items and one dropped', () => {
    for (const items of ['x', 5, {}, null]) {
      const view = parseFindings({ schemaVersion: 1, updatedAt: '2026-11-08T11:14:02.640Z', items });
      expect(view.present).toBe(true);
      expect(view.items).toEqual([]);
      expect(view.dropped).toBe(1);
    }
    expect(parseFindings({ schemaVersion: 1 }).dropped).toBe(0);
  });

  it('a different schema version gives the notice and the items are still read', () => {
    const view = parseFindings({ ...value([finding()]), schemaVersion: 2 });
    expect(view.notice).toBe('This value comes from a different schema version (found: 2)');
    expect(view.items).toHaveLength(1);
    expect(parseFindings(value([])).notice).toBeNull();
  });
});

describe('parseFindings: the header', () => {
  it('reads time, commit, short commit, hunt id and the six counts', () => {
    const header = parseFindings(findingsOf('config.with-findings.json')).header;
    expect(header).toEqual({
      updatedAt: '2026-11-08 11:14 UTC',
      commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
      commitShort: 'e1c61a3',
      huntId: 'hunt-20261108T110312Z',
      counts: { attempts: 7, confirmed: 2, rejected: 4, error: 0, duplicate: 1, notRecorded: 0 },
    });
  });

  it('a count that is not a finite integer at least 0 is null; counts that is not a record gives six nulls', () => {
    const header = parseFindings(value([], { counts: { attempts: '7', confirmed: -1, rejected: 1.5, error: null, duplicate: 3 } })).header;
    expect(header?.counts).toEqual({ attempts: null, confirmed: null, rejected: null, error: null, duplicate: 3, notRecorded: null });
    for (const counts of [undefined, 5, [], 'x']) {
      expect(parseFindings(value([], { counts })).header?.counts).toEqual({ attempts: null, confirmed: null, rejected: null, error: null, duplicate: null, notRecorded: null });
    }
  });

  it('a missing or wrong updatedAt gives "time unknown"; commit and huntId are null when not strings', () => {
    const header = parseFindings({ items: [], updatedAt: 5, commit: 7, huntId: null }).header;
    expect(header).toMatchObject({ updatedAt: 'time unknown', commit: null, commitShort: null, huntId: null });
  });
});

describe('parseFindings: one finding', () => {
  it('shows the class label, short commit, time, tokens, command, file text and result', () => {
    const view = parseFindings(findingsOf('config.with-findings.json'));
    const first = view.items.find((i) => i.id === 'hunt-20261108T110312Z-007');
    expect(first).toEqual({
      id: 'hunt-20261108T110312Z-007',
      levelId: '02-the-chaser',
      classKey: 'cheaper_win',
      classLabel: 'Cheaper win',
      commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
      commitShort: 'e1c61a3',
      foundAt: '2026-11-08 11:14 UTC',
      tokens: ['E', 'E', 'E', 'E', 'N', 'N', 'E', 'E', 'E', 'E', 'E', 'S', 'S'],
      tokensText: 'E E E E N N E E E E E S S',
      replayCommand: 'node scripts/play.mjs 02-the-chaser --actions-file <actions-file>',
      actionsFileText: expect.stringContaining('"kind": "move"'),
      result: { won: true, inkSpent: 0, minimalInk: 1, editCount: 0, newEditAddresses: [] },
    });
  });

  it('decodes the C3-f edit token into the actions file text', () => {
    const view = parseFindings(findingsOf('config.with-findings.json'));
    const second = view.items.find((i) => i.id === 'hunt-20261108T110312Z-012');
    expect(second?.classLabel).toBe('Unexpected route');
    expect(second?.result).toEqual({ won: true, inkSpent: 1, minimalInk: 1, editCount: 1, newEditAddresses: ['B14'] });
    const actions = JSON.parse(second?.actionsFileText ?? 'null') as Array<Record<string, string>>;
    expect(actions[0]).toEqual({ kind: 'edit', address: 'B14', raw: '=IF(DIST(HERO,SELF)<1,TOWARD(HERO),"-")' });
    expect(actions).toHaveLength(4);
  });

  it('the three known classes have labels; an unknown class shows the stored string clipped to 40', () => {
    const labelOf = (cls: string) => parseFindings(value([finding({ class: cls })])).items[0]?.classLabel;
    expect(labelOf('cheaper_win')).toBe('Cheaper win');
    expect(labelOf('free_win')).toBe('Free win');
    expect(labelOf('unexpected_route')).toBe('Unexpected route');
    expect(labelOf('new_class')).toBe('new_class');
    expect(labelOf('c'.repeat(60))).toBe('c'.repeat(40));
    expect(parseFindings(value([finding({ class: 'c'.repeat(60) })])).items[0]?.classKey).toBe('c'.repeat(40));
  });

  it('drops and counts a finding with 41 tokens, a 141-character token, no actions, a non-string id, level id, class or time', () => {
    const items = [
      finding({ id: 'ok' }),
      finding({ id: 'a', actions: Array.from({ length: 41 }, () => 'E') }),
      finding({ id: 'b', actions: ['E', 'x'.repeat(141)] }),
      finding({ id: 'c', actions: undefined }),
      finding({ id: 'd', actions: [] }),
      finding({ id: 'e', actions: ['E', 5] }),
      finding({ id: 5 }),
      finding({ id: 'f', levelId: null }),
      finding({ id: 'g', class: 7 }),
      finding({ id: 'h', foundAt: null }),
      5,
      null,
      [],
    ];
    const view = parseFindings(value(items));
    expect(view.items.map((i) => i.id)).toEqual(['ok']);
    expect(view.dropped).toBe(12);
  });

  it('accepts exactly 40 tokens and a token of exactly 140 characters', () => {
    const view = parseFindings(value([finding({ id: 'a', actions: Array.from({ length: 40 }, () => 'E') }), finding({ id: 'b', actions: ['x'.repeat(140)] })]));
    expect(view.items).toHaveLength(2);
    expect(view.dropped).toBe(0);
  });

  it('keeps a finding with a token that does not decode, with no file text', () => {
    const view = parseFindings(value([finding({ actions: ['E', 'bogus'] })]));
    expect(view.items).toHaveLength(1);
    expect(view.items[0]?.actionsFileText).toBeNull();
    expect(view.items[0]?.tokensText).toBe('E bogus');
  });

  it('keeps a finding whose level id is not valid, with no command', () => {
    const view = parseFindings(value([finding({ levelId: '../x' })]));
    expect(view.items[0]?.replayCommand).toBeNull();
    expect(view.items[0]?.levelId).toBe('../x');
  });

  it('result fields of the wrong type are null; new edit addresses keep strings only, at most 8, clipped to 12', () => {
    const view = parseFindings(
      value([finding({ result: { won: 'yes', inkSpent: -1, minimalInk: '1', editCount: 1.5, newEditAddresses: ['A1', 5, 'B'.repeat(20), 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1'] } })]),
    );
    expect(view.items[0]?.result).toEqual({
      won: null,
      inkSpent: null,
      minimalInk: null,
      editCount: null,
      newEditAddresses: ['A1', 'B'.repeat(12), 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'],
    });
    expect(parseFindings(value([finding({ result: 'x' })])).items[0]?.result).toEqual({ won: null, inkSpent: null, minimalInk: null, editCount: null, newEditAddresses: [] });
  });
});

describe('parseFindings: order and caps', () => {
  it('sorts by foundAt descending, then id descending, with an unparseable time last', () => {
    const view = parseFindings(
      value([
        finding({ id: 'a', actions: ['E'], foundAt: '2026-11-08T10:00:00Z' }),
        finding({ id: 'b', actions: ['N'], foundAt: '2026-11-08T12:00:00Z' }),
        finding({ id: 'c', actions: ['S'], foundAt: '2026-11-08T12:00:00Z' }),
        finding({ id: 'd', actions: ['W'], foundAt: 'garbage' }),
      ]),
    );
    expect(view.items.map((i) => i.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('keeps the first of items with the same level id, class and tokens, and does not count the rest', () => {
    const view = parseFindings(
      value([
        finding({ id: 'old', foundAt: '2026-11-08T10:00:00Z' }),
        finding({ id: 'new', foundAt: '2026-11-08T12:00:00Z' }),
        finding({ id: 'other-level', levelId: '03-the-locked-crypt', foundAt: '2026-11-08T11:00:00Z' }),
        finding({ id: 'other-class', class: 'free_win', foundAt: '2026-11-08T09:00:00Z' }),
        finding({ id: 'other-tokens', actions: ['E', 'N', 'N'], foundAt: '2026-11-08T08:00:00Z' }),
      ]),
    );
    expect(view.items.map((i) => i.id)).toEqual(['new', 'other-level', 'other-class', 'other-tokens']);
    expect(view.dropped).toBe(0);
  });

  it('keeps 20 distinct findings and counts the rest', () => {
    const items = Array.from({ length: 21 }, (_, i) => finding({ id: `h-${String(i).padStart(3, '0')}`, actions: ['E', ...Array.from({ length: i }, () => 'N')] }));
    const view = parseFindings(value(items));
    expect(view.items).toHaveLength(20);
    expect(view.dropped).toBe(1);
  });
});

describe('isEarlierCommit', () => {
  it('is true when both commits are present and differ', () => {
    expect(isEarlierCommit('aaaaaaa', 'bbbbbbb')).toBe(true);
  });

  it('is false when equal, or when either is null, undefined or empty', () => {
    expect(isEarlierCommit('aaaaaaa', 'aaaaaaa')).toBe(false);
    for (const [a, b] of [[null, 'b'], ['a', null], [undefined, 'b'], ['a', undefined], ['', 'b'], ['a', ''], [null, null]] as const) {
      expect(isEarlierCommit(a, b), `${a} ${b}`).toBe(false);
    }
  });
});
describe('findings properties', () => {
  // Feature: dashboard, Property 7: Findings view
  it('Property 7: at most 20 items, unique, newest first, within the token limits, with the dropped count accounted for', () => {
    fc.assert(
      fc.property(arbFindingItems, (items) => {
        const view = parseFindings(findingsValueOf(items));
        expect(view.items.length).toBeLessThanOrEqual(20);
        // no two items with the same level id, class and token list
        const keys = view.items.map((i) => `${i.levelId}\u0000${i.classKey}\u0000${i.tokens.join(' ')}`);
        expect(new Set(keys).size).toBe(keys.length);
        // newest first: formatted time descending (an unknown time last), then id descending
        const rank = (time: string): string => (time === 'time unknown' ? '' : time);
        for (let i = 1; i < view.items.length; i += 1) {
          const a = view.items[i - 1]!;
          const b = view.items[i]!;
          if (rank(a.foundAt) !== rank(b.foundAt)) expect(rank(a.foundAt) > rank(b.foundAt)).toBe(true);
          else expect(a.id >= b.id).toBe(true);
        }
        // tokens within the limits
        for (const item of view.items) {
          expect(item.tokens.length).toBeGreaterThanOrEqual(1);
          expect(item.tokens.length).toBeLessThanOrEqual(40);
          for (const token of item.tokens) expect(token.length).toBeLessThanOrEqual(140);
        }
        // dropped = invalid items + distinct valid items beyond 20; every shown item comes from a valid item
        const validKeys = new Set(items.filter((i) => i.valid).map((i) => i.key));
        expect(view.items.length).toBe(Math.min(validKeys.size, 20));
        expect(view.dropped).toBe(items.filter((i) => !i.valid).length + Math.max(0, validKeys.size - 20));
        for (const key of keys) expect(validKeys.has(key)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});