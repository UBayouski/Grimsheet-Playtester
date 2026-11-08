import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbLevelEntriesRaw, arbRunsForCards } from './arbitraries';
import { colourLabel, markerClass } from '../src/core/colour';
import { parseLevelEntries, parseTrend } from '../src/core/results';
import { buildCards } from '../src/core/cards';
import type { Colour } from '../src/core/colour';
import type { LevelEntryParsed, TrendParsed } from '../src/core/results';

const entry = (levelId: string, colour: Colour, extra: Partial<LevelEntryParsed> = {}): LevelEntryParsed => ({
  levelId,
  colour,
  label: colour === 'green' ? 'Green: intended solution holds' : colour === 'amber' ? 'Amber: wins with a different ink count' : colour === 'red' ? 'Red: no longer wins' : 'Not judged',
  ink: null,
  endHp: null,
  reasonCode: null,
  timedOut: false,
  ...extra,
});

const run = (counter: number, levels: Array<[string, Colour]>): TrendParsed => ({
  runId: `run-${counter}`,
  counter,
  state: 'complete',
  startedAt: null,
  startedMs: null,
  commit: null,
  counts: { green: null, amber: null, red: null, error: null },
  levels: new Map(levels),
});

describe('buildCards: which cards', () => {
  it('has one card for each id of latest.levels and of the newest run, ascending by plain string comparison', () => {
    const cards = buildCards(
      [entry('10-b', 'green'), entry('02-a', 'red'), entry('b', 'amber')],
      [run(2, [['02-a', 'red'], ['03-only-in-run', 'green'], ['a', 'green']]), run(1, [['zz-older-run-only', 'green']])],
    );
    expect(cards.map((c) => c.levelId)).toEqual(['02-a', '03-only-in-run', '10-b', 'a', 'b']);
  });

  it('has no card when there is nothing', () => {
    expect(buildCards([], [])).toEqual([]);
    expect(buildCards([], [run(1, [])])).toEqual([]);
  });

  it('keeps 100 cards', () => {
    const levels = Array.from({ length: 100 }, (_, i) => entry(`level-${String(i).padStart(3, '0')}`, 'green'));
    const extra = run(1, [['zzz-extra', 'green']]);
    expect(buildCards(levels, [extra])).toHaveLength(100);
  });
});

describe('buildCards: one card', () => {
  it('a card from latest.levels shows its entry', () => {
    const [card] = buildCards([entry('a', 'amber', { ink: { spent: 2, minimal: 1 }, endHp: 3 })], []);
    expect(card).toMatchObject({
      levelId: 'a',
      colour: 'amber',
      label: 'Amber: wins with a different ink count',
      outcome: 'won',
      reasonCode: null,
      timedOut: false,
      ink: { spent: 2, minimal: 1 },
      endHp: 3,
      noDetail: false,
    });
  });

  it('a card only in the newest run takes the run colour, has noDetail, and no ink or end HP', () => {
    const [card] = buildCards([], [run(2, [['a', 'red']])]);
    expect(card).toMatchObject({ levelId: 'a', colour: 'red', label: 'Red: no longer wins', outcome: 'not won', noDetail: true, ink: null, endHp: null, timedOut: false, reasonCode: null });
  });

  it('gives the outcome of each colour', () => {
    const outcomes = buildCards(
      [entry('a', 'green'), entry('b', 'amber'), entry('c', 'red'), entry('d', 'error')],
      [],
    ).map((c) => c.outcome);
    expect(outcomes).toEqual(['won', 'won', 'not won', 'not judged']);
  });

  it('shows the reason code for an error entry only, and timedOut', () => {
    const cards = buildCards(
      [entry('a', 'error', { reasonCode: 'play_failed', timedOut: true }), entry('b', 'green', { reasonCode: 'ignored' })],
      [],
    );
    expect(cards[0]).toMatchObject({ reasonCode: 'play_failed', timedOut: true });
    expect(cards[1]).toMatchObject({ reasonCode: null, timedOut: false });
  });

  it('an unknown stored colour keeps the label "Unknown colour"', () => {
    const [card] = buildCards([entry('a', 'error', { label: 'Unknown colour' })], []);
    expect(card).toMatchObject({ colour: 'error', label: 'Unknown colour', outcome: 'not judged' });
  });

  it('the colour does not depend on the ink numbers', () => {
    const [a] = buildCards([entry('a', 'green', { ink: { spent: 9, minimal: 0 } })], []);
    const [b] = buildCards([entry('a', 'green', { ink: { spent: 0, minimal: 9 } })], []);
    const [c] = buildCards([entry('a', 'red', { ink: { spent: 0, minimal: 0 } })], []);
    expect(a?.colour).toBe('green');
    expect(b?.colour).toBe('green');
    expect(c?.colour).toBe('red');
  });
});

describe('buildCards: the trend of a card', () => {
  const runs = [run(3, [['a', 'amber'], ['b', 'green']]), run(2, [['a', 'green']]), run(1, [['a', 'green'], ['b', 'red']])];

  it('has one cell for each run, newest first, with none where the run does not name the level', () => {
    const cards = buildCards([entry('a', 'amber'), entry('b', 'green')], runs);
    expect(cards[0]?.trend).toEqual([
      { runId: 'run-3', counter: 3, colour: 'amber' },
      { runId: 'run-2', counter: 2, colour: 'green' },
      { runId: 'run-1', counter: 1, colour: 'green' },
    ]);
    expect(cards[1]?.trend.map((cell) => cell.colour)).toEqual(['green', 'none', 'red']);
  });

  it('writes the text equivalent with the non-zero counts in a fixed order', () => {
    const many = Array.from({ length: 12 }, (_, i) => run(12 - i, [['a', i === 3 ? 'amber' : 'green']]));
    const [card] = buildCards([entry('a', 'green')], many);
    expect(card?.trendText).toBe('Last 12 runs: 11 green, 1 amber');
  });

  it('counts red, not judged and no result, in the order green, amber, red, not judged, no result', () => {
    const [card] = buildCards(
      [entry('a', 'green')],
      [run(5, [['a', 'error']]), run(4, [['a', 'red']]), run(3, []), run(2, [['a', 'amber']]), run(1, [['a', 'green']])],
    );
    expect(card?.trendText).toBe('Last 5 runs: 1 green, 1 amber, 1 red, 1 not judged, 1 no result');
  });

  it('says "run" for one run, and "No runs recorded" for none', () => {
    expect(buildCards([entry('a', 'green')], [run(1, [['a', 'green']])])[0]?.trendText).toBe('Last 1 run: 1 green');
    expect(buildCards([entry('a', 'green')], [])[0]?.trendText).toBe('No runs recorded');
  });
});
describe('card properties', () => {
  // Feature: dashboard, Property 5: One card per level id
  it('Property 5: the cards are exactly the distinct ids of the entries and of the newest run, ascending', () => {
    fc.assert(
      fc.property(arbLevelEntriesRaw, arbRunsForCards, (rawLevels, rawRuns) => {
        const { entries } = parseLevelEntries(rawLevels);
        const { runs } = parseTrend(rawRuns);
        const cards = buildCards(entries, runs);
        const newest = rawRuns.reduce<Record<string, unknown> | null>((best, r) => (best === null || (r['counter'] as number) > (best['counter'] as number) ? r : best), null);
        const expected = [...new Set([...rawLevels.map((e) => e['levelId'] as string), ...(newest ? Object.keys(newest['levels'] as object) : [])])].sort();
        expect(cards.map((c) => c.levelId)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  // Feature: dashboard, Property 6: Colour and label
  it('Property 6: the colour is one of five, the label follows the colour, the marker follows the colour, and ink never changes a colour', () => {
    fc.assert(
      fc.property(arbLevelEntriesRaw, arbRunsForCards, fc.nat({ max: 9 }), fc.nat({ max: 9 }), (rawLevels, rawRuns, inkSpent, minimalInk) => {
        const { runs } = parseTrend(rawRuns);
        const cards = buildCards(parseLevelEntries(rawLevels).entries, runs);
        const stored = new Map<string, string>();
        for (const e of rawLevels) if (!stored.has(e['levelId'] as string)) stored.set(e['levelId'] as string, e['colour'] as string);
        for (const card of cards) {
          expect(['green', 'amber', 'red', 'error', 'none']).toContain(card.colour);
          const storedColour = stored.get(card.levelId);
          if (storedColour !== undefined && !KNOWN.includes(storedColour)) {
            expect(card.colour).toBe('error');
            expect(card.label).toBe('Unknown colour');
          } else {
            expect(card.label).toBe(colourLabel(card.colour));
          }
          for (const other of cards) expect(markerClass(card.colour) === markerClass(other.colour)).toBe(card.colour === other.colour);
        }
        // changing every ink value leaves every colour as it was
        const changed = rawLevels.map((e) => ({ ...e, inkSpent, minimalInk }));
        const after = buildCards(parseLevelEntries(changed).entries, runs);
        expect(after.map((c) => c.colour)).toEqual(cards.map((c) => c.colour));
      }),
      { numRuns: 300 },
    );
  });
});

const KNOWN = ['green', 'amber', 'red', 'error'];