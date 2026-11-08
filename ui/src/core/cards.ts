// The level cards: one for each level id, with its stored colour, its last result and its trend.
// A colour is stored data. Nothing here reads the ink numbers to decide a colour.
import { colourLabel, type CardColour } from './colour';
import { LIMITS } from './constants';
import { NO_RUNS } from './text';
import type { LevelEntryParsed, TrendParsed } from './results';
import type { LevelCardView } from './types';

function outcomeOf(colour: CardColour): LevelCardView['outcome'] {
  switch (colour) {
    case 'green':
    case 'amber':
      return 'won';
    case 'red':
      return 'not won';
    case 'error':
      return 'not judged';
    case 'none':
      return 'no result';
  }
}

const TREND_ORDER: Array<[CardColour, string]> = [
  ['green', 'green'],
  ['amber', 'amber'],
  ['red', 'red'],
  ['error', 'not judged'],
  ['none', 'no result'],
];

function trendText(colours: CardColour[]): string {
  if (colours.length === 0) return NO_RUNS;
  const parts: string[] = [];
  for (const [colour, name] of TREND_ORDER) {
    const n = colours.filter((c) => c === colour).length;
    if (n > 0) parts.push(`${n} ${name}`);
  }
  return `Last ${colours.length} ${colours.length === 1 ? 'run' : 'runs'}: ${parts.join(', ')}`;
}

/** The cards: the union of the ids of `levels` and of the newest run, ascending by plain string comparison. */
export function buildCards(levels: readonly LevelEntryParsed[], runs: readonly TrendParsed[]): LevelCardView[] {
  const byId = new Map(levels.map((entry) => [entry.levelId, entry]));
  const newest = runs[0];
  const ids = new Set<string>([...byId.keys(), ...(newest ? newest.levels.keys() : [])]);
  const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, LIMITS.levels);
  return sorted.map((levelId): LevelCardView => {
    const entry = byId.get(levelId);
    const cells = runs.map((run) => ({ runId: run.runId, counter: run.counter, colour: (run.levels.get(levelId) ?? 'none') as CardColour }));
    const common = { levelId, trend: cells, trendText: trendText(cells.map((cell) => cell.colour)) };
    if (entry !== undefined) {
      return {
        ...common,
        colour: entry.colour,
        label: entry.label,
        outcome: outcomeOf(entry.colour),
        reasonCode: entry.colour === 'error' ? entry.reasonCode : null,
        timedOut: entry.timedOut,
        ink: entry.ink,
        endHp: entry.endHp,
        noDetail: false,
      };
    }
    const colour: CardColour = newest?.levels.get(levelId) ?? 'none';
    return { ...common, colour, label: colourLabel(colour), outcome: outcomeOf(colour), reasonCode: null, timedOut: false, ink: null, endHp: null, noDetail: true };
  });
}