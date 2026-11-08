// @ts-check
// Unit tests for scripts/hunt/findings.mjs (task 9.1 of the exploit-hunt spec).
// The module does not exist yet (task 9.2); these tests fail until it does.
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { arbFindingSequence, arbActionList, arbCheckResult, huntIdOfMs } from './hunt.arbitraries.mjs';
import { printActions } from '../scripts/hunt/tokens.mjs';
import {
  fits,
  findingId,
  buildFinding,
  isDuplicate,
  normalizeFindings,
  sortNewestFirst,
  sizeOf,
  addFinding,
  withHeader,
  worstCaseFinding,
} from '../scripts/hunt/findings.mjs';
import {
  FINDINGS_MAX_ITEMS,
  FINDING_MAX_BYTES,
  FINDINGS_MAX_BYTES,
} from '../scripts/hunt/limits.mjs';

/** @typedef {import('../scripts/hunt/types.mjs').Finding} Finding */
/** @typedef {import('../scripts/hunt/types.mjs').FindingsValue} FindingsValue */

const COMMIT = 'e1c61a35b3da027aada5d9ef4460efa4470488a4';
const HUNT_ID = 'hunt-20261108T110312Z';

/** The example Finding of the design, copied literally ("Findings_Value and one Finding"). */
const EXAMPLE_FINDING = {
  id: 'hunt-20261108T110312Z-007',
  levelId: '02-the-chaser',
  class: /** @type {'cheaper_win'} */ ('cheaper_win'),
  commit: 'e1c61a35b3da027aada5d9ef4460efa4470488a4',
  huntId: 'hunt-20261108T110312Z',
  foundAt: '2026-11-08T11:14:02.511Z',
  actions: ['E', 'E', 'E', 'E', 'N', 'N', 'E', 'E', 'E', 'E', 'E', 'S', 'S'],
  result: { won: true, inkSpent: 0, minimalInk: 1, editCount: 0, newEditAddresses: [], reasonCode: 'class_reproduced' },
};

/** Header of the design example, with the six counts at two digits (the 251-byte case). */
const HEADER = {
  updatedAt: '2026-11-08T11:14:02.640Z',
  commit: COMMIT,
  huntId: HUNT_ID,
  counts: { attempts: 10, confirmed: 10, rejected: 10, error: 10, duplicate: 10, notRecorded: 10 },
};

const EMPTY_COUNTS = { attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 };

/** @param {number} n @param {number} width */
const pad = (n, width) => String(n).padStart(width, '0');

/**
 * A small Finding (same size as the design example, 386 bytes) with a distinct id, level and time.
 * `i` runs from 0 to 99; foundAt grows with `i`.
 * @param {number} i
 * @returns {Finding}
 */
function small(i) {
  return {
    ...EXAMPLE_FINDING,
    id: `${HUNT_ID}-${pad(i, 3)}`,
    levelId: `lvl-${pad(i, 3)}`,
    foundAt: `2026-11-08T11:${pad(i % 60, 2)}:02.511Z`,
    actions: [...EXAMPLE_FINDING.actions],
    result: { ...EXAMPLE_FINDING.result, newEditAddresses: [] },
  };
}

/**
 * A worst-case Finding (1199 bytes) with a distinct id, level id and foundAt of the same lengths.
 * `i` runs from 0 to 59.
 * @param {number} i
 * @returns {Finding}
 */
function worst(i) {
  const base = worstCaseFinding();
  return {
    ...base,
    id: `${HUNT_ID}-${pad(i, 3)}`,
    levelId: `${base.levelId.slice(0, 37)}${pad(i, 3)}`,
    foundAt: `2026-11-08T11:${pad(i, 2)}:02.511Z`,
  };
}

/** @param {Finding[]} items @returns {FindingsValue} */
function valueOf(items) {
  return { schemaVersion: 1, ...HEADER, items };
}

/**
 * Folds addFinding over a list and returns the last result and the value.
 * @param {Finding[]} list
 */
function foldAdds(list) {
  /** @type {any} */
  let value = null;
  /** @type {any} */
  let last = null;
  for (const f of list) {
    last = addFinding(value, f, HEADER);
    value = last.value;
  }
  return { value, last };
}

describe('findingId', () => {
  it('joins the Hunt_Id, a dash and a three-digit attempt', () => {
    expect(findingId(HUNT_ID, 7)).toBe('hunt-20261108T110312Z-007');
    expect(findingId(HUNT_ID, 20)).toBe('hunt-20261108T110312Z-020');
    expect(findingId(HUNT_ID, 123)).toBe('hunt-20261108T110312Z-123');
  });
});

describe('buildFinding', () => {
  const checkOk = {
    levelId: '02-the-chaser',
    claimedClass: 'cheaper_win',
    outcome: 'confirmed',
    reasonCode: 'class_reproduced',
    reason: 'The claimed class was reproduced.',
    won: true,
    inkSpent: 0,
    minimalInk: 1,
    editCount: 0,
    newEditAddresses: [],
  };

  it('builds the example Finding from a confirmed check', () => {
    const f = buildFinding({
      huntId: HUNT_ID,
      attempt: 7,
      commit: COMMIT,
      foundAt: '2026-11-08T11:14:02.511Z',
      levelId: '02-the-chaser',
      claimedClass: 'cheaper_win',
      tokens: ['E', 'E', 'E', 'E', 'N', 'N', 'E', 'E', 'E', 'E', 'E', 'S', 'S'],
      checkOk: /** @type {any} */ (checkOk),
    });
    expect(f).toEqual(EXAMPLE_FINDING);
    expect(sizeOf(f)).toBe(386);
  });

  it('copies won, inkSpent, minimalInk, editCount, newEditAddresses and reasonCode, and nothing else', () => {
    const f = buildFinding({
      huntId: HUNT_ID,
      attempt: 12,
      commit: COMMIT,
      foundAt: '2026-11-08T11:20:00.000Z',
      levelId: '03-the-locked-crypt',
      claimedClass: 'unexpected_route',
      tokens: ['E', 'edit:B14=7', 'wait'],
      checkOk: /** @type {any} */ ({
        ...checkOk,
        won: true,
        inkSpent: 3,
        minimalInk: 5,
        editCount: 2,
        newEditAddresses: ['B14', 'C2'],
      }),
    });
    expect(f.id).toBe('hunt-20261108T110312Z-012');
    expect(f.result).toEqual({
      won: true,
      inkSpent: 3,
      minimalInk: 5,
      editCount: 2,
      newEditAddresses: ['B14', 'C2'],
      reasonCode: 'class_reproduced',
    });
    expect(Object.keys(f.result).sort()).toEqual(
      ['editCount', 'inkSpent', 'minimalInk', 'newEditAddresses', 'reasonCode', 'won'],
    );
    expect(Object.keys(f).sort()).toEqual(
      ['actions', 'class', 'commit', 'foundAt', 'huntId', 'id', 'levelId', 'result'],
    );
  });

  it('stores the canonical tokens as the actions', () => {
    const tokens = ['edit:B14=7', 'N', 'wait', 'undo'];
    const f = buildFinding({
      huntId: HUNT_ID,
      attempt: 1,
      commit: COMMIT,
      foundAt: '2026-11-08T11:20:00.000Z',
      levelId: '02-the-chaser',
      claimedClass: 'free_win',
      tokens,
      checkOk: /** @type {any} */ (checkOk),
    });
    expect(f.actions).toEqual(tokens);
    expect(f.class).toBe('free_win');
    expect(f.levelId).toBe('02-the-chaser');
    expect(f.commit).toBe(COMMIT);
    expect(f.huntId).toBe(HUNT_ID);
    expect(f.foundAt).toBe('2026-11-08T11:20:00.000Z');
  });
});

describe('isDuplicate', () => {
  it('is true for the same level, class and tokens, whatever the id, time and result', () => {
    const a = small(1);
    const b = { ...small(2), levelId: a.levelId, actions: [...a.actions], result: { ...a.result, inkSpent: 9 } };
    expect(isDuplicate(a, b)).toBe(true);
    expect(isDuplicate(b, a)).toBe(true);
  });

  it('is false when the level differs', () => {
    const a = small(1);
    expect(isDuplicate(a, { ...a, levelId: 'other-level' })).toBe(false);
  });

  it('is false when the class differs', () => {
    const a = small(1);
    expect(isDuplicate(a, { ...a, class: 'free_win' })).toBe(false);
  });

  it('is false when the tokens differ, in value, order or length', () => {
    const a = small(1);
    expect(isDuplicate(a, { ...a, actions: [...a.actions.slice(0, -1), 'N'] })).toBe(false);
    expect(isDuplicate(a, { ...a, actions: [...a.actions].reverse() })).toBe(false);
    expect(isDuplicate(a, { ...a, actions: a.actions.slice(0, -1) })).toBe(false);
  });
});

describe('normalizeFindings (Decision 29)', () => {
  const empty = normalizeFindings(null);

  it('gives an empty Findings_Value for null', () => {
    expect(empty.schemaVersion).toBe(1);
    expect(empty.items).toEqual([]);
    expect(empty.commit).toBeNull();
    expect(empty.huntId).toBeNull();
    expect(empty.counts).toEqual(EMPTY_COUNTS);
  });

  it('gives the same empty value for a legacy array, a string and a number', () => {
    expect(normalizeFindings([])).toEqual(empty);
    expect(normalizeFindings([{ id: 'old' }])).toEqual(empty);
    expect(normalizeFindings('findings')).toEqual(empty);
    expect(normalizeFindings(42)).toEqual(empty);
  });

  it('keeps a well-formed value', () => {
    const v = valueOf([small(1), small(2)]);
    expect(normalizeFindings(v)).toEqual(v);
  });
});

describe('sortNewestFirst', () => {
  it('orders by foundAt descending, then id descending', () => {
    const a = { ...small(1), foundAt: '2026-11-08T11:00:00.000Z', id: 'h-001' };
    const b = { ...small(2), foundAt: '2026-11-08T12:00:00.000Z', id: 'h-002' };
    const c = { ...small(3), foundAt: '2026-11-08T12:00:00.000Z', id: 'h-003' };
    const d = { ...small(4), foundAt: '2026-11-08T10:00:00.000Z', id: 'h-004' };
    expect(sortNewestFirst([a, b, c, d]).map((f) => f.id)).toEqual(['h-003', 'h-002', 'h-001', 'h-004']);
  });

  it('returns a new array and leaves the input as it was', () => {
    const input = [small(1), small(5), small(3)];
    const before = input.map((f) => f.id);
    const out = sortNewestFirst(input);
    expect(out).not.toBe(input);
    expect(input.map((f) => f.id)).toEqual(before);
    expect(out.map((f) => f.id)).toEqual([small(5).id, small(3).id, small(1).id]);
  });
});

describe('sizeOf', () => {
  it('is the UTF-8 length of the compact JSON text', () => {
    expect(sizeOf({ a: 1 })).toBe(7);
    expect(sizeOf([])).toBe(2);
    expect(sizeOf(EXAMPLE_FINDING)).toBe(Buffer.byteLength(JSON.stringify(EXAMPLE_FINDING), 'utf8'));
  });

  it('counts bytes, not characters, for a non-ASCII string', () => {
    // '{"a":"€é"}' has 10 characters; the euro sign takes 3 bytes and e-acute 2.
    expect(sizeOf({ a: '€é' })).toBe(Buffer.byteLength('{"a":"€é"}', 'utf8'));
    expect(sizeOf({ a: '€é' })).toBe(13);
  });
});

describe('addFinding', () => {
  it('adds a new Finding to nothing', () => {
    const f = small(1);
    const r = addFinding(null, f, HEADER);
    expect(r.duplicate).toBe(false);
    expect(r.duplicateOf).toBeNull();
    expect(r.evicted).toEqual([]);
    expect(r.tooLarge).toBe(false);
    expect(r.value).toEqual({ schemaVersion: 1, ...HEADER, items: [f] });
  });

  it('adds a Finding to a legacy array as if the value were empty (Decision 29)', () => {
    const f = small(1);
    const r = addFinding([], f, HEADER);
    expect(r.duplicate).toBe(false);
    expect(r.value.items).toEqual([f]);
  });

  it('puts the new Finding first when it is the newest, and keeps the others in order', () => {
    const existing = valueOf([small(3), small(1)]);
    const r = addFinding(existing, small(5), HEADER);
    expect(r.value.items.map((f) => f.id)).toEqual([small(5).id, small(3).id, small(1).id]);
  });

  it('takes the header from the argument', () => {
    const existing = valueOf([small(1)]);
    const header = { ...HEADER, updatedAt: '2027-01-01T00:00:00.000Z', huntId: 'hunt-20270101T000000Z' };
    const r = addFinding(existing, small(2), header);
    expect(r.value.updatedAt).toBe('2027-01-01T00:00:00.000Z');
    expect(r.value.huntId).toBe('hunt-20270101T000000Z');
    expect(r.value.schemaVersion).toBe(1);
  });

  it('reports a duplicate, names duplicateOf and leaves the value unchanged', () => {
    const first = small(1);
    const existing = valueOf([small(2), first]);
    const again = { ...small(9), levelId: first.levelId, actions: [...first.actions] };
    const newHeader = { ...HEADER, updatedAt: '2030-01-01T00:00:00.000Z' };
    const r = addFinding(existing, again, newHeader);
    expect(r.duplicate).toBe(true);
    expect(r.duplicateOf).toBe(first.id);
    expect(r.evicted).toEqual([]);
    expect(r.tooLarge).toBe(false);
    expect(r.value).toEqual(existing);
  });

  it('evicts the oldest item when the 20-item cap is reached', () => {
    const list = Array.from({ length: 21 }, (_, i) => small(i));
    const { value: after20, last: last20 } = foldAdds(list.slice(0, 20));
    expect(after20.items).toHaveLength(FINDINGS_MAX_ITEMS);
    expect(last20.evicted).toEqual([]);
    expect(sizeOf(after20)).toBeLessThanOrEqual(FINDINGS_MAX_BYTES);

    const r = addFinding(after20, list[20], HEADER);
    expect(r.duplicate).toBe(false);
    expect(r.evicted).toEqual([list[0].id]);
    expect(r.value.items).toHaveLength(FINDINGS_MAX_ITEMS);
    expect(r.value.items[0].id).toBe(list[20].id);
    expect(r.value.items.map((f) => f.id)).not.toContain(list[0].id);
    expect(r.tooLarge).toBe(false);
  });

  it('removes the oldest items first by foundAt, then id (equal foundAt: lowest id goes first)', () => {
    const sameTime = '2026-11-08T10:00:00.000Z';
    const oldA = { ...small(1), foundAt: sameTime, id: `${HUNT_ID}-002` };
    const oldB = { ...small(2), foundAt: sameTime, id: `${HUNT_ID}-001` };
    const rest = Array.from({ length: 18 }, (_, i) => small(30 + i));
    // Not in Newest-first order on purpose.
    const existing = valueOf([oldA, ...rest, oldB]);
    expect(existing.items).toHaveLength(20);

    const r = addFinding(existing, small(50), HEADER);
    expect(r.evicted).toEqual([`${HUNT_ID}-001`]);
    expect(r.value.items.map((f) => f.id)).toContain(`${HUNT_ID}-002`);
    expect(r.value.items[0].id).toBe(small(50).id);
  });

  it('evicts by the byte cap, not the item cap, with worst-case items', () => {
    const list = Array.from({ length: 14 }, (_, i) => worst(i));
    for (const f of list) expect(sizeOf(f)).toBe(1199);

    const { value: after13, last: last13 } = foldAdds(list.slice(0, 13));
    expect(last13.evicted).toEqual([]);
    expect(after13.items).toHaveLength(13);
    expect(sizeOf(after13)).toBe(251 + 13 * 1199 + 12); // 15850
    expect(sizeOf(after13)).toBeLessThanOrEqual(FINDINGS_MAX_BYTES);

    const r = addFinding(after13, list[13], HEADER);
    expect(r.duplicate).toBe(false);
    expect(r.tooLarge).toBe(false);
    expect(r.evicted).toEqual([list[0].id]);
    expect(r.value.items).toHaveLength(13);
    expect(r.value.items[0].id).toBe(list[13].id);
    expect(sizeOf(r.value)).toBeLessThanOrEqual(FINDINGS_MAX_BYTES);
  });

  it('keeps the whole value at or under the byte cap after 30 worst-case adds', () => {
    const list = Array.from({ length: 30 }, (_, i) => worst(i));
    /** @type {any} */
    let value = null;
    for (const f of list) {
      const r = addFinding(value, f, HEADER);
      value = r.value;
      expect(sizeOf(value)).toBeLessThanOrEqual(FINDINGS_MAX_BYTES);
      expect(value.items.length).toBeLessThanOrEqual(13);
      expect(value.items.map((/** @type {Finding} */ i) => i.id)).toContain(f.id);
    }
  });

  it('flags tooLarge when one Finding with the header is over the byte cap', () => {
    const huge = { ...small(1), actions: ['x'.repeat(FINDINGS_MAX_BYTES)] };
    const existing = valueOf([small(2), small(3)]);
    const r = addFinding(existing, huge, HEADER);
    expect(r.tooLarge).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.evicted.sort()).toEqual([small(2).id, small(3).id].sort());
    expect(r.value.items.map((f) => f.id)).toEqual([huge.id]);
  });
});

describe('withHeader', () => {
  it('keeps the items and takes the new header', () => {
    const items = [small(3), small(2), small(1)];
    const header = {
      updatedAt: '2027-02-02T02:02:02.002Z',
      commit: 'f'.repeat(40),
      huntId: 'hunt-20270202T020202Z',
      counts: { attempts: 3, confirmed: 0, rejected: 3, error: 0, duplicate: 0, notRecorded: 0 },
    };
    const v = withHeader(valueOf(items), header);
    expect(v).toEqual({ schemaVersion: 1, ...header, items });
  });

  it('does not change the input value', () => {
    const existing = valueOf([small(1)]);
    const copy = JSON.parse(JSON.stringify(existing));
    withHeader(existing, { ...HEADER, updatedAt: '2030-01-01T00:00:00.000Z' });
    expect(existing).toEqual(copy);
  });

  it('turns a legacy array into the object shape with no items (Decision 29)', () => {
    const v = withHeader([], HEADER);
    expect(v).toEqual({ schemaVersion: 1, ...HEADER, items: [] });
  });

  it('gives a 251-byte value for the design header with no items', () => {
    expect(sizeOf(withHeader(null, HEADER))).toBe(251);
  });
});

describe('size arithmetic of the design', () => {
  it('worstCaseFinding() is 1199 bytes', () => {
    expect(sizeOf(worstCaseFinding())).toBe(1199);
  });

  it('worstCaseFinding() has 40 tokens, 4 edit tokens of 132 characters, and the longest fixed fields', () => {
    const f = worstCaseFinding();
    expect(f.actions).toHaveLength(40);
    const edits = f.actions.filter((t) => t.startsWith('edit:'));
    expect(edits).toHaveLength(4);
    for (const t of edits) expect(t).toHaveLength(132);
    expect(f.levelId).toHaveLength(40);
    expect(f.class).toBe('unexpected_route');
    expect(f.commit).toHaveLength(40);
    expect(f.huntId).toHaveLength(21);
    expect(f.foundAt).toHaveLength(24);
    expect(f.id).toHaveLength(25);
    expect(f.result.editCount).toBe(4);
    expect(f.result.newEditAddresses).toHaveLength(4);
    expect(f.result.reasonCode).toBe('class_reproduced');
  });

  it('the worst case passes the per-item gate: 1199 <= 1536, 337 bytes to spare', () => {
    expect(FINDING_MAX_BYTES).toBe(1536);
    expect(sizeOf(worstCaseFinding())).toBeLessThanOrEqual(FINDING_MAX_BYTES);
    expect(FINDING_MAX_BYTES - sizeOf(worstCaseFinding())).toBe(337);
  });

  it('the header with six two-digit counts and no items is 251 bytes', () => {
    expect(sizeOf({ schemaVersion: 1, ...HEADER, items: [] })).toBe(251);
  });

  it('13 worst-case items fit in 16384 bytes and 14 do not', () => {
    const w = sizeOf(worstCaseFinding());
    expect(251 + 13 * w + 12).toBe(15850);
    expect(251 + 14 * w + 13).toBe(17050);
    expect(sizeOf(valueOf(Array.from({ length: 13 }, (_, i) => worst(i))))).toBeLessThanOrEqual(FINDINGS_MAX_BYTES);
    expect(sizeOf(valueOf(Array.from({ length: 14 }, (_, i) => worst(i))))).toBeGreaterThan(FINDINGS_MAX_BYTES);
  });

  it('the example Finding of the design is 386 bytes, and 20 of them fit with the header', () => {
    expect(sizeOf(EXAMPLE_FINDING)).toBe(386);
    expect(251 + 20 * 386 + 19).toBe(7990);
    expect(sizeOf(valueOf(Array.from({ length: 20 }, (_, i) => small(i))))).toBeLessThanOrEqual(FINDINGS_MAX_BYTES);
  });
});

// Feature: exploit-hunt, Property 9: Findings caps hold after every merge
describe('Property 9: Findings caps hold after every merge', () => {
  /** Oldest first: foundAt ascending, then id ascending (independent of sortNewestFirst).
   * @param {Finding} a @param {Finding} b */
  const oldestFirst = (a, b) => {
    if (a.foundAt !== b.foundAt) return a.foundAt < b.foundAt ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  };

  it('holds the item, per-item and byte caps after every add, and evicts the oldest first', () => {
    // **Validates: Requirements 10.11, 10.7, 10.8**
    fc.assert(
      fc.property(arbFindingSequence, (sequence) => {
        /** @type {any} */
        let value = null;
        for (const finding of /** @type {Finding[]} */ (sequence)) {
          /** @type {Finding[]} */
          const before = value === null ? [] : value.items;
          const r = addFinding(value, finding, HEADER);

          if (r.duplicate) {
            // Not part of Property 9: the fold must stay intact.
            expect(r.value).toEqual(normalizeFindings(value));
            expect(r.evicted).toEqual([]);
            value = r.value;
            continue;
          }

          expect(r.tooLarge).toBe(false);
          expect(r.value.items.length).toBeLessThanOrEqual(FINDINGS_MAX_ITEMS);
          for (const item of r.value.items) expect(sizeOf(item)).toBeLessThanOrEqual(FINDING_MAX_BYTES);
          expect(sizeOf(r.value)).toBeLessThanOrEqual(FINDINGS_MAX_BYTES);
          expect(r.value.items.map((i) => i.id)).toContain(finding.id);

          // The evicted items are the oldest of (pre-add items + the new Finding).
          const ascending = [...before, finding].sort(oldestFirst);
          const expectedEvicted = ascending.slice(0, r.evicted.length).map((i) => i.id);
          expect([...r.evicted].sort()).toEqual([...expectedEvicted].sort());
          expect(r.evicted).not.toContain(finding.id);
          const kept = ascending.slice(r.evicted.length).map((i) => i.id);
          expect(r.value.items.map((i) => i.id).sort()).toEqual([...kept].sort());

          value = r.value;
        }
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: exploit-hunt, Property 10: Findings are unique and ordered Newest first
describe('Property 10: Findings are unique and ordered Newest first', () => {
  /** Identity of a Finding for uniqueness: level, class and action list (independent of isDuplicate).
   * @param {Finding} f */
  const keyOf = (f) => JSON.stringify([f.levelId, f.class, f.actions]);

  it('never holds two items with the same level, class and actions; repeats leave the value unchanged; items are Newest first', () => {
    // **Validates: Requirements 10.13, 8.9**
    fc.assert(
      fc.property(arbFindingSequence, (sequence) => {
        /** @type {any} */
        let value = null;
        for (const finding of /** @type {Finding[]} */ (sequence)) {
          /** @type {Finding[]} */
          const before = value === null ? [] : value.items;
          // A repeat is judged against the items held now: an earlier twin may have been evicted.
          const isRepeat = before.some((i) => keyOf(i) === keyOf(finding));
          const snapshot = JSON.stringify(value);
          const r = addFinding(value, finding, HEADER);

          expect(r.duplicate).toBe(isRepeat);
          if (isRepeat) {
            expect(JSON.stringify(value)).toBe(snapshot);
            expect(r.value).toEqual(normalizeFindings(value));
            expect(r.evicted).toEqual([]);
            const twin = before.find((i) => keyOf(i) === keyOf(finding));
            expect(r.duplicateOf).toBe(/** @type {Finding} */ (twin).id);
          } else {
            expect(r.duplicateOf).toBeNull();
          }

          const items = r.value.items;
          // Unique by level, class and actions.
          expect(new Set(items.map(keyOf)).size).toBe(items.length);
          // Newest first: foundAt descending, then id descending.
          for (let k = 1; k < items.length; k += 1) {
            const a = items[k - 1];
            const b = items[k];
            const ok = a.foundAt !== b.foundAt ? a.foundAt > b.foundAt : a.id > b.id;
            expect(ok).toBe(true);
          }
          value = r.value;
        }
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: exploit-hunt, Property 15: A Finding is recorded if and only if it fits
describe('Property 15: A Finding is recorded if and only if it fits', () => {
  const WORST_BYTES = sizeOf(worstCaseFinding());

  /**
   * Candidates with the fixed fields at their maximum lengths: huntId 21 characters, foundAt 24, commit 40 hex,
   * levelId 40 characters (valid id), attempt 1 to 20 (id of 25 characters), any of the three classes (one of
   * them `unexpected_route`). The action list comes from arbActionList. The check result is any arbCheckResult
   * turned into a confirmed one by a total map (missing ink and address fields default to 0 and []).
   */
  const arbCandidate = fc.record({
    levelId: fc.stringMatching(/^[a-z0-9][a-z0-9-]{39}$/),
    claimedClass: fc.constantFrom('cheaper_win', 'free_win', 'unexpected_route'),
    commit: fc.stringMatching(/^[0-9a-f]{40}$/),
    huntSec: fc.integer({ min: 0, max: 40 * 24 * 3600 }),
    foundSec: fc.integer({ min: 0, max: 40 * 24 * 3600 }),
    foundMillis: fc.integer({ min: 100, max: 999 }),
    attempt: fc.integer({ min: 1, max: 20 }),
    // Half the lists come from the widened arbActionList (multi-byte raws near 40 bytes are common there); the
    // other half are the byte worst case: 4 edits of 10 x U+1F600 at random positions plus 36 waits.
    actions: fc.oneof(
      arbActionList,
      fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { minLength: 4, maxLength: 4 }).map((slots) =>
        Array.from({ length: 40 }, (_, i) =>
          slots.includes(i) ? { kind: 'edit', address: 'AAAAA1', raw: '\ud83d\ude00'.repeat(10) } : { kind: 'wait' },
        ),
      ).map((list) => /** @type {any[]} */ (list)),
    ),
    check: arbCheckResult,
  });

  it('a Finding of any in-limit confirmed Candidate fits and is no longer than the worst case', () => {
    expect(WORST_BYTES).toBe(1199);
    expect(WORST_BYTES).toBeLessThanOrEqual(FINDING_MAX_BYTES);
    fc.assert(
      fc.property(arbCandidate, (c) => {
        const base = Date.UTC(2026, 10, 1, 0, 0, 0);
        const huntId = huntIdOfMs(base + c.huntSec * 1000);
        const foundAt = new Date(base + c.foundSec * 1000 + c.foundMillis).toISOString();
        const checkOk = {
          outcome: /** @type {'confirmed'} */ ('confirmed'),
          levelId: c.levelId,
          claimedClass: c.claimedClass,
          won: /** @type {true} */ (true),
          inkSpent: c.check.inkSpent ?? 0,
          minimalInk: c.check.minimalInk ?? 0,
          editCount: c.check.editCount ?? 0,
          newEditAddresses: c.check.newEditAddresses ?? [],
          reasonCode: /** @type {'class_reproduced'} */ ('class_reproduced'),
          reason: 'The replay reproduces the claimed class.',
        };
        const finding = buildFinding({
          huntId,
          attempt: c.attempt,
          commit: c.commit,
          foundAt,
          levelId: c.levelId,
          claimedClass: c.claimedClass,
          tokens: printActions(c.actions),
          checkOk: /** @type {any} */ (checkOk),
        });
        expect(finding.id.length).toBe(25);
        expect(finding.foundAt.length).toBe(24);
        expect(sizeOf(finding)).toBeLessThanOrEqual(WORST_BYTES);
        expect(fits(finding)).toBe(true);
        // Recorded or duplicate, never too large.
        const r = addFinding(null, finding, HEADER_OF(finding));
        expect(r.tooLarge).toBe(false);
        const again = addFinding(r.value, finding, HEADER_OF(finding));
        expect(again.duplicate).toBe(true);
        // One oversized field makes it not fit.
        expect(fits({ ...finding, levelId: 'x'.repeat(FINDING_MAX_BYTES) })).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /** @param {Finding} f */
  function HEADER_OF(f) {
    return { updatedAt: f.foundAt, commit: f.commit, huntId: f.huntId, counts: { ...EMPTY_COUNTS } };
  }

  it('4 edits of 10 x U+1F600 plus 36 waits, fixed fields and ink at maximum, is at most 1199 bytes and fits', () => {
    const emoji = '\ud83d\ude00'.repeat(10);
    /** @type {any[]} */
    const actions = [];
    for (let i = 0; i < 4; i += 1) actions.push({ kind: 'edit', address: 'AAAAA1', raw: emoji });
    for (let i = 0; i < 36; i += 1) actions.push({ kind: 'wait' });
    const tokens = printActions(actions);
    expect(tokens[0]).toBe(`edit:AAAAA1=${'%F0%9F%98%80'.repeat(10)}`);
    expect(tokens[0]).toHaveLength(132);
    const levelId = 'a'.repeat(40);
    const finding = buildFinding({
      huntId: 'hunt-20261108T110312Z',
      attempt: 20,
      commit: 'f'.repeat(40),
      foundAt: '2026-11-08T11:03:12.999Z',
      levelId,
      claimedClass: 'unexpected_route',
      tokens,
      checkOk: /** @type {any} */ ({
        outcome: 'confirmed',
        levelId,
        claimedClass: 'unexpected_route',
        won: true,
        inkSpent: 9999,
        minimalInk: 9999,
        editCount: 4,
        newEditAddresses: ['AAAAA1', 'AAAAA2', 'AAAAA3', 'AAAAA4'],
        reasonCode: 'class_reproduced',
        reason: 'The replay reproduces the claimed class.',
      }),
    });
    expect(sizeOf(finding)).toBeLessThanOrEqual(1199);
    expect(fits(finding)).toBe(true);
  });
});
