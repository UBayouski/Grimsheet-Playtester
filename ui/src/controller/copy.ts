// The clipboard flow: try the clipboard API, then a selection-based copy. Never throws.
// The page builds the real CopyEnv from `navigator` and `document` inside the click handler.
import { COPIED, COPY_UNAVAILABLE } from '../core/text';

export interface CopyEnv {
  /** `navigator.clipboard.writeText` when it is a function. */
  writeText?: (text: string) => Promise<void>;
  /** Creates a hidden text area, selects it and runs the copy command; returns whether it worked. */
  selectionCopy?: (text: string) => boolean;
}

export type CopyOutcome = { ok: true } | { ok: false };

export async function copyText(text: string, env: CopyEnv): Promise<CopyOutcome> {
  if (typeof env.writeText === 'function') {
    try {
      await env.writeText(text);
      return { ok: true };
    } catch {
      // fall through to the selection copy
    }
  }
  if (typeof env.selectionCopy === 'function') {
    try {
      if (env.selectionCopy(text) === true) return { ok: true };
    } catch {
      // fall through to the fallback view
    }
  }
  return { ok: false };
}

/** The message in "Copied" is cleared this long after the copy. */
export const COPIED_CLEAR_MS = 3000;

export type CopyState = { kind: 'idle'; seq: number } | { kind: 'copied'; seq: number } | { kind: 'fallback'; seq: number; text: string };
export type CopyAction = { type: 'success' } | { type: 'failure'; text: string } | { type: 'clear'; seq: number };

export function copyReducer(state: CopyState, action: CopyAction): CopyState {
  switch (action.type) {
    case 'success':
      return { kind: 'copied', seq: state.seq + 1 };
    case 'failure':
      return { kind: 'fallback', seq: state.seq + 1, text: action.text };
    case 'clear':
      return state.kind === 'copied' && state.seq === action.seq ? { kind: 'idle', seq: state.seq } : state;
  }
}

/** The text for the live region. */
export function copyMessage(state: CopyState): string {
  return state.kind === 'copied' ? COPIED : state.kind === 'fallback' ? COPY_UNAVAILABLE : '';
}