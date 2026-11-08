// The View_Model builder: one pure function from the two route states and the Now_Input to a plain object.
// Each part is validated on its own and inside its own `try`, so a bad part is replaced by its empty state
// and its siblings are kept. Nothing here reads a clock, a random source or a global.
import { buildCards } from './cards';
import { TOP_KEY, LIMITS } from './constants';
import { buildJobView } from './crons';
import { parseFindings } from './findings';
import { clip, getOwn, isRecord, ownValue } from './json';
import { parseLatest, parseLevelEntries, parseSchema, parseTrend, type LatestParsed, type LevelEntryParsed, type TrendParsed } from './results';
import { REQUEST_FAILED } from './text';
import { formatUtc, isStale } from './time';
import type { FindingsView, JobView, ReplayView, ResultsView, RouteState, RouteView, TrendRunView, ViewModel, ViewModelInput } from './types';

export type { ViewModel, ViewModelInput } from './types';

const NO_FINDINGS: FindingsView = { present: false, notice: null, header: null, items: [], dropped: 0 };

function safeRoute(route: unknown): RouteState {
  if (!isRecord(route)) return { status: 'pending', hasGood: false, good: undefined, goodAtMs: null, error: null };
  const status = route['status'] === 'ok' || route['status'] === 'failed' ? route['status'] : 'pending';
  const goodAtMs = typeof route['goodAtMs'] === 'number' && Number.isFinite(route['goodAtMs']) ? route['goodAtMs'] : null;
  return {
    status,
    hasGood: route['hasGood'] === true,
    good: route['good'],
    goodAtMs,
    error: typeof route['error'] === 'string' ? route['error'] : null,
  };
}

function routeView(route: RouteState): RouteView {
  return {
    error: route.status === 'failed' ? clip(route.error ?? REQUEST_FAILED, LIMITS.textChars) : null,
    readAt: route.hasGood && route.goodAtMs !== null ? formatUtc(route.goodAtMs) : null,
  };
}

/** Runs one part builder; on an unexpected exception the part gets its empty state. */
function guarded<T>(build: () => T, empty: T): T {
  try {
    return build();
  } catch {
    return empty;
  }
}

function emptyResults(hasData: boolean, present: boolean): ResultsView {
  return { hasData, present, notice: null, replay: null, levels: [], runs: [], findings: NO_FINDINGS, dropped: { levels: 0, trend: 0 } };
}

function replayView(latest: LatestParsed, nowMs: unknown): ReplayView {
  return {
    runId: latest.runId,
    state: latest.state,
    commit: latest.commit,
    commitShort: latest.commitShort,
    time: formatUtc(latest.timeMs),
    stale: isStale(latest.timeMs, nowMs),
    failure: latest.failure,
  };
}

function runView(run: TrendParsed): TrendRunView {
  return {
    runId: run.runId,
    counter: run.counter,
    state: run.state,
    startedAt: formatUtc(run.startedMs),
    commitShort: run.commit === null ? null : run.commit.slice(0, 7),
    counts: run.counts,
  };
}

function buildResults(config: RouteState, nowMs: unknown): ResultsView {
  if (!config.hasGood) return emptyResults(false, false);
  const value = config.good;
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, TOP_KEY)) return emptyResults(true, false);
  const top = getOwn(value, TOP_KEY);
  if (!isRecord(top)) return emptyResults(true, true);

  const latestRaw = guarded(() => getOwn(top, 'latest'), null);
  const latest = guarded(() => parseLatest(latestRaw), null);
  const levels = guarded(
    () => (isRecord(latestRaw) && latest !== null ? parseLevelEntries(getOwn(latestRaw, 'levels')) : { entries: [] as LevelEntryParsed[], dropped: 0 }),
    { entries: [] as LevelEntryParsed[], dropped: 1 },
  );
  const trend = guarded(() => parseTrend(getOwn(top, 'trend')), { runs: [] as TrendParsed[], dropped: 1 });
  const findings = guarded(() => parseFindings(ownValue(top, 'findings')), { ...NO_FINDINGS, dropped: 1 });
  const notice = guarded(() => parseSchema(getOwn(top, 'schemaVersion')), null);
  return {
    hasData: true,
    present: true,
    notice,
    replay: guarded(() => (latest === null ? null : replayView(latest, nowMs)), null),
    levels: guarded(() => buildCards(levels.entries, trend.runs), []),
    runs: guarded(() => trend.runs.map(runView), []),
    findings,
    dropped: { levels: levels.dropped, trend: trend.dropped },
  };
}

function buildJob(crons: RouteState): JobView {
  if (crons.status === 'pending') return { kind: 'pending' };
  if (!crons.hasGood) return { kind: 'unavailable' };
  return guarded((): JobView => buildJobView(crons.good), { kind: 'unavailable' });
}

/** The View_Model for the two route states. Total: it does not throw for any input. */
export function buildViewModel(input: ViewModelInput): ViewModel {
  const config = safeRoute(input?.config);
  const crons = safeRoute(input?.crons);
  const nowMs = input?.nowMs;
  return {
    loading: config.status === 'pending' || crons.status === 'pending',
    resultsRoute: guarded(() => routeView(config), { error: null, readAt: null }),
    jobRoute: guarded(() => routeView(crons), { error: null, readAt: null }),
    results: guarded(() => buildResults(config, nowMs), emptyResults(config.hasGood, false)),
    job: guarded(() => buildJob(crons), { kind: 'unavailable' }),
  };
}