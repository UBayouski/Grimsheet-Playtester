// Validation of the replay's parts of the Results_Value: `latest`, its level entries, and `trend`.
// Every function is total. A part that fails validation is dropped and counted; nothing is converted by guessing.
import { cardLabel, normaliseColour, type Colour } from './colour';
import { LIMITS } from './constants';
import { clip, getOwn, isRecord, readCount, readFiniteNumber, readString } from './json';
import { parseTime, replayTimeOf } from './time';

const RUN_STATES = ['running', 'complete', 'failed', 'cut-short'] as const;

function readState(value: unknown): string | null {
  return typeof value === 'string' && (RUN_STATES as readonly string[]).includes(value) ? value : null;
}

/** A notice for a schema version other than the number 1, or null. */
export function parseSchema(value: unknown): string | null {
  if (value === 1) return null;
  const found = typeof value === 'number' ? String(value) : 'none';
  return `This value comes from a different schema version (found: ${found})`;
}

export interface LatestParsed {
  runId: string | null;
  state: string | null;
  commit: string | null;
  commitShort: string | null;
  timeMs: number | null;
  failure: { stage: string; reasonCode: string; message: string } | null;
}

/** The `latest` run, or null when it is not a record with a string `runId` or `startedAt`. */
export function parseLatest(value: unknown): LatestParsed | null {
  if (!isRecord(value)) return null;
  const runId = readString(getOwn(value, 'runId'));
  const startedAt = readString(getOwn(value, 'startedAt'));
  if (runId === null && startedAt === null) return null;
  const commitRaw = readString(getOwn(value, 'commit'));
  const commit = commitRaw === null || commitRaw === '' ? null : commitRaw;
  const failureRaw = getOwn(value, 'failure');
  let failure: LatestParsed['failure'] = null;
  if (isRecord(failureRaw)) {
    const stage = readString(getOwn(failureRaw, 'stage'));
    const reasonCode = readString(getOwn(failureRaw, 'reasonCode'));
    const message = readString(getOwn(failureRaw, 'message'));
    if (stage !== null && reasonCode !== null && message !== null) {
      failure = { stage: clip(stage, LIMITS.textChars), reasonCode: clip(reasonCode, LIMITS.textChars), message: clip(message, LIMITS.textChars) };
    }
  }
  return {
    runId: runId === null ? null : clip(runId, LIMITS.levelIdChars),
    state: readState(getOwn(value, 'state')),
    commit,
    commitShort: commit === null ? null : commit.slice(0, 7),
    timeMs: replayTimeOf(value),
    failure,
  };
}

export interface LevelEntryParsed {
  levelId: string;
  colour: Colour;
  label: string;
  ink: { spent: number; minimal: number } | null;
  endHp: number | null;
  reasonCode: string | null;
  timedOut: boolean;
}

/** The level entries of `latest.levels`: valid ones in order, with the number of entries dropped or left out. */
export function parseLevelEntries(value: unknown): { entries: LevelEntryParsed[]; dropped: number } {
  if (value === undefined || value === null) return { entries: [], dropped: 0 };
  if (!Array.isArray(value)) return { entries: [], dropped: 1 };
  const entries: LevelEntryParsed[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of value) {
    if (!isRecord(item)) {
      dropped += 1;
      continue;
    }
    const levelId = readString(getOwn(item, 'levelId'));
    const stored = readString(getOwn(item, 'colour'));
    if (levelId === null || levelId.length < 1 || levelId.length > LIMITS.levelIdChars || stored === null) {
      dropped += 1;
      continue;
    }
    if (seen.has(levelId) || entries.length >= LIMITS.levels) {
      dropped += 1;
      continue;
    }
    seen.add(levelId);
    const spent = readCount(getOwn(item, 'inkSpent'));
    const minimal = readCount(getOwn(item, 'minimalInk'));
    const endHp = readFiniteNumber(getOwn(item, 'endHp'));
    const reasonCode = readString(getOwn(item, 'reasonCode'));
    entries.push({
      levelId,
      colour: normaliseColour(stored),
      label: cardLabel(stored),
      ink: spent !== null && minimal !== null ? { spent, minimal } : null,
      endHp: endHp !== null && endHp >= 0 ? endHp : null,
      reasonCode: reasonCode === null ? null : clip(reasonCode, LIMITS.reasonChars),
      timedOut: getOwn(item, 'timedOut') === true,
    });
  }
  return { entries, dropped };
}

export interface TrendParsed {
  runId: string;
  counter: number;
  state: string | null;
  startedAt: string | null;
  startedMs: number | null;
  commit: string | null;
  counts: { green: number | null; amber: number | null; red: number | null; error: number | null };
  levels: Map<string, Colour>;
}

function compareDescending(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/** The valid Trend_Entries, newest first, at most 30, one for each runId, with the number dropped or left out. */
export function parseTrend(value: unknown): { runs: TrendParsed[]; dropped: number } {
  if (value === undefined || value === null) return { runs: [], dropped: 0 };
  if (!Array.isArray(value)) return { runs: [], dropped: 1 };
  const parsed: TrendParsed[] = [];
  let dropped = 0;
  for (const item of value) {
    if (!isRecord(item)) {
      dropped += 1;
      continue;
    }
    const runId = readString(getOwn(item, 'runId'));
    const counter = readCount(getOwn(item, 'counter'));
    if (runId === null || runId.length < 1 || counter === null) {
      dropped += 1;
      continue;
    }
    const startedAt = readString(getOwn(item, 'startedAt'));
    const commitRaw = readString(getOwn(item, 'commit'));
    const levels = new Map<string, Colour>();
    const levelsRaw = getOwn(item, 'levels');
    if (isRecord(levelsRaw)) {
      for (const key of Object.keys(levelsRaw).slice(0, LIMITS.trendLevelKeys)) {
        const colour = readString(getOwn(levelsRaw, key));
        if (colour !== null && key.length >= 1 && key.length <= LIMITS.levelIdChars) levels.set(key, normaliseColour(colour));
      }
    }
    parsed.push({
      runId: clip(runId, LIMITS.levelIdChars),
      counter,
      state: readState(getOwn(item, 'state')),
      startedAt: startedAt === null ? null : clip(startedAt, 40),
      startedMs: parseTime(startedAt),
      commit: commitRaw === null || commitRaw === '' ? null : commitRaw,
      counts: {
        green: readCount(getOwn(item, 'green')),
        amber: readCount(getOwn(item, 'amber')),
        red: readCount(getOwn(item, 'red')),
        error: readCount(getOwn(item, 'error')),
      },
      levels,
    });
  }
  parsed.sort((a, b) => b.counter - a.counter || compareDescending(a.startedAt, b.startedAt) || compareDescending(a.runId, b.runId));
  const seen = new Set<string>();
  const unique = parsed.filter((run) => {
    if (seen.has(run.runId)) return false;
    seen.add(run.runId);
    return true;
  });
  dropped += Math.max(0, unique.length - LIMITS.trend);
  return { runs: unique.slice(0, LIMITS.trend), dropped };
}