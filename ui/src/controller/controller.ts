// The controller: it owns the Reads. It takes the API object and the Env as arguments, imports neither React nor the SDK,
// and sends only `get` requests. The scheduler (core/poll.ts) decides; this class carries out the decision.
import { CONFIG_PATH, CRONS_PATH, REQUEST_LIMIT_MS } from '../core/constants';
import { readIsRunning } from '../core/crons';
import { initialScheduler, step, type SchedulerEvent, type SchedulerState } from '../core/poll';
import { API_MISSING } from '../core/text';
import type { RouteState } from '../core/types';
import type { Env } from './env';
import { readRoute, type Api, type ReadResult } from './reader';

export interface Snapshot {
  config: RouteState;
  crons: RouteState;
  /** The Now_Input: the time from the Env when this snapshot was built. */
  nowMs: number;
  inFlight: boolean;
  visible: boolean;
  version: number;
}

const pending = (): RouteState => ({ status: 'pending', hasGood: false, good: undefined, goodAtMs: null, error: null });

export class DashboardController {
  private config: RouteState = pending();
  private crons: RouteState = pending();
  private sched: SchedulerState = initialScheduler();
  private timer: unknown = null;
  private unsubscribeVisibility: (() => void) | null = null;
  private generation = 0;
  private stopped = true;
  private version = 0;
  private snapshot: Snapshot;
  // An array, not a Set: the source scan forbids the method that removes a Set member anywhere in src (Requirement 1, criterion 8).
  private listeners: Array<() => void> = [];

  constructor(
    private readonly api: Api | null,
    private readonly env: Env,
    private readonly paths: { config: string; crons: string } = { config: CONFIG_PATH, crons: CRONS_PATH },
  ) {
    this.snapshot = this.build();
  }

  /** Mount: subscribes to the visibility of the page and sends `mount` to the scheduler. */
  start(): void {
    this.stopped = false;
    this.generation += 1;
    this.config = pending();
    this.crons = pending();
    this.sched = initialScheduler();
    this.clearTimer();
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    if (this.api === null) {
      const failed: RouteState = { status: 'failed', hasGood: false, good: undefined, goodAtMs: null, error: API_MISSING };
      this.config = failed;
      this.crons = { ...failed };
      this.emit();
      return;
    }
    this.unsubscribeVisibility = this.env.onVisibilityChange(() => this.dispatch({ type: 'visibility', nowMs: this.env.nowMs(), visible: this.env.isVisible() }));
    this.dispatch({ type: 'mount', nowMs: this.env.nowMs(), visible: this.env.isVisible() });
  }

  /** Unmount: clears the timer, unsubscribes, and discards every answer that is still to come. */
  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.sched = step(this.sched, { type: 'unmount' }).state;
    this.clearTimer();
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
  }

  /** The Refresh_Button. */
  refresh(): void {
    if (this.api === null) return;
    this.dispatch({ type: 'refresh', nowMs: this.env.nowMs() });
  }

  subscribe(listener: () => void): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((other) => other !== listener);
    };
  }

  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  private build(): Snapshot {
    return {
      config: this.config,
      crons: this.crons,
      nowMs: this.env.nowMs(),
      inFlight: this.sched.inFlight,
      visible: this.sched.visible,
      version: this.version,
    };
  }

  private emit(): void {
    this.version += 1;
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.env.clearTimeout(this.timer);
    this.timer = null;
  }

  private dispatch(event: SchedulerEvent): void {
    if (this.stopped) return;
    const before = this.sched;
    const { state, effect } = step(this.sched, event);
    this.sched = state;
    this.clearTimer();
    if (effect.do === 'start') {
      this.beginRead();
      return;
    }
    if (effect.do === 'wait') this.timer = this.env.setTimeout(() => this.dispatch({ type: 'tick', nowMs: this.env.nowMs() }), effect.ms);
    if (before.visible !== state.visible || before.inFlight !== state.inFlight) this.emit();
  }

  private beginRead(): void {
    this.generation += 1;
    const generation = this.generation;
    this.emit();
    const api = this.api as Api;
    const apply = (which: 'config' | 'crons', result: ReadResult): void => {
      if (generation !== this.generation || this.stopped) return;
      const previous = which === 'config' ? this.config : this.crons;
      const next: RouteState = result.ok
        ? { status: 'ok', hasGood: true, good: result.value, goodAtMs: this.env.nowMs(), error: null }
        : { ...previous, status: 'failed', error: result.error };
      if (which === 'config') this.config = next;
      else this.crons = next;
      this.emit();
    };
    // The two requests start together; a Read ends when both have settled or timed out.
    const config = readRoute(api, this.paths.config, this.env, REQUEST_LIMIT_MS).then((result) => apply('config', result));
    const crons = readRoute(api, this.paths.crons, this.env, REQUEST_LIMIT_MS).then((result) => apply('crons', result));
    void Promise.all([config, crons]).then(() => {
      if (generation !== this.generation || this.stopped) return;
      this.dispatch({ type: 'complete', nowMs: this.env.nowMs(), isRunning: this.crons.hasGood && readIsRunning(this.crons.good) });
    });
  }
}
