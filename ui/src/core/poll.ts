// The poll scheduler as a pure state machine. The controller keeps the state, feeds the events and carries out
// the effect. Only `step` sets `inFlight`, and only from a state where it is false, so two Reads cannot overlap.

export const POLL_INTERVAL_MS = 60_000;
export const RUNNING_INTERVAL_MS = 15_000;

export interface SchedulerState {
  visible: boolean;
  inFlight: boolean;
  lastStartMs: number | null;
  /** The replay job reports is_running. */
  isRunning: boolean;
  /** The page was unmounted. */
  closed: boolean;
}

export type SchedulerEvent =
  | { type: 'mount'; nowMs: number; visible: boolean }
  | { type: 'tick'; nowMs: number }
  | { type: 'visibility'; nowMs: number; visible: boolean }
  | { type: 'refresh'; nowMs: number }
  | { type: 'complete'; nowMs: number; isRunning: boolean }
  | { type: 'unmount' };

export type Effect = { do: 'start' } | { do: 'wait'; ms: number } | { do: 'none' };

export function initialScheduler(): SchedulerState {
  return { visible: false, inFlight: false, lastStartMs: null, isRunning: false, closed: false };
}

export interface DecideInput {
  visible: boolean;
  inFlight: boolean;
  lastStartMs: number | null;
  nowMs: number;
  pollIntervalMs: number;
  isRunning: boolean;
}

/** What to do now. The interval is 15 seconds while the job runs, and never more than `pollIntervalMs`. */
export function decide(input: DecideInput): Effect {
  if (!input.visible || input.inFlight) return { do: 'none' };
  if (input.lastStartMs === null) return { do: 'start' };
  const interval = input.isRunning ? Math.min(RUNNING_INTERVAL_MS, input.pollIntervalMs) : input.pollIntervalMs;
  const remaining = input.lastStartMs + interval - input.nowMs;
  return remaining <= 0 ? { do: 'start' } : { do: 'wait', ms: remaining };
}

interface StepResult {
  state: SchedulerState;
  effect: Effect;
}

function decideFor(state: SchedulerState, nowMs: number): StepResult {
  const effect = decide({ visible: state.visible, inFlight: state.inFlight, lastStartMs: state.lastStartMs, nowMs, pollIntervalMs: POLL_INTERVAL_MS, isRunning: state.isRunning });
  return effect.do === 'start' ? { state: { ...state, inFlight: true, lastStartMs: nowMs }, effect } : { state, effect };
}

export function step(state: SchedulerState, event: SchedulerEvent): StepResult {
  if (state.closed) return { state, effect: { do: 'none' } };
  switch (event.type) {
    case 'mount':
      return decideFor({ ...initialScheduler(), visible: event.visible }, event.nowMs);
    case 'tick':
      return decideFor(state, event.nowMs);
    case 'visibility': {
      const next = { ...state, visible: event.visible };
      return event.visible ? decideFor(next, event.nowMs) : { state: next, effect: { do: 'none' } };
    }
    case 'refresh':
      if (!state.visible || state.inFlight) return { state, effect: { do: 'none' } };
      return { state: { ...state, inFlight: true, lastStartMs: event.nowMs }, effect: { do: 'start' } };
    case 'complete':
      return decideFor({ ...state, inFlight: false, isRunning: event.isRunning }, event.nowMs);
    case 'unmount':
      return { state: { ...state, closed: true }, effect: { do: 'none' } };
  }
}