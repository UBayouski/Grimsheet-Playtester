// The types of the View_Model. All values are plain JSON values (strings, finite numbers, booleans, null,
// arrays, objects): there is no undefined and no class instance, so equal inputs give strictly equal results.
import type { CardColour } from './colour';

export type { CardColour, Colour } from './colour';

export type RouteStatus = 'pending' | 'ok' | 'failed';

/** What the controller knows about one route. `good` is the value of the last successful Read. */
export interface RouteState {
  status: RouteStatus;
  hasGood: boolean;
  good: unknown;
  goodAtMs: number | null;
  error: string | null;
}

export interface ViewModelInput {
  config: RouteState;
  crons: RouteState;
  nowMs: unknown;
}

export interface RouteView {
  error: string | null;
  readAt: string | null;
}

export interface ReplayView {
  runId: string | null;
  state: string | null;
  commit: string | null;
  commitShort: string | null;
  time: string;
  stale: boolean;
  failure: { stage: string; reasonCode: string; message: string } | null;
}

export interface TrendCell {
  runId: string;
  counter: number;
  colour: CardColour;
}

export interface LevelCardView {
  levelId: string;
  colour: CardColour;
  label: string;
  outcome: 'won' | 'not won' | 'not judged' | 'no result';
  reasonCode: string | null;
  timedOut: boolean;
  ink: { spent: number; minimal: number } | null;
  endHp: number | null;
  noDetail: boolean;
  trend: TrendCell[];
  trendText: string;
}

export interface TrendRunView {
  runId: string;
  counter: number;
  state: string | null;
  startedAt: string;
  commitShort: string | null;
  counts: { green: number | null; amber: number | null; red: number | null; error: number | null };
}

export interface HuntHeader {
  updatedAt: string;
  commit: string | null;
  commitShort: string | null;
  huntId: string | null;
  counts: { attempts: number | null; confirmed: number | null; rejected: number | null; error: number | null; duplicate: number | null; notRecorded: number | null };
}

export interface FindingView {
  id: string;
  levelId: string;
  classKey: string;
  classLabel: string;
  commit: string | null;
  commitShort: string | null;
  foundAt: string;
  tokens: string[];
  tokensText: string;
  replayCommand: string | null;
  actionsFileText: string | null;
  result: { won: boolean | null; inkSpent: number | null; minimalInk: number | null; editCount: number | null; newEditAddresses: string[] };
}

export interface FindingsView {
  present: boolean;
  notice: string | null;
  header: HuntHeader | null;
  items: FindingView[];
  dropped: number;
}

export type JobView =
  | { kind: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'not-registered' }
  | {
      kind: 'found';
      lastRun: string;
      lastStatus: string | null;
      running: boolean;
      consecutiveFailures: number | null;
      nextRun: string;
      paused: boolean;
    };

export interface ResultsView {
  hasData: boolean;
  present: boolean;
  notice: string | null;
  replay: ReplayView | null;
  levels: LevelCardView[];
  runs: TrendRunView[];
  findings: FindingsView;
  dropped: { levels: number; trend: number };
}

export interface ViewModel {
  loading: boolean;
  resultsRoute: RouteView;
  jobRoute: RouteView;
  results: ResultsView;
  job: JobView;
}