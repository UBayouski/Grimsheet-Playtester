// One request with a time limit. It only ever calls `api.get`. The answer of a request that already ended
// (a late answer, after the limit) is ignored.
import { errorText, TIME_LIMIT_TEXT } from '../core/errors';
import type { Env } from './env';

export interface Api {
  get(path: string): Promise<unknown>;
}

export type ReadResult = { ok: true; value: unknown } | { ok: false; error: string };

export function readRoute(api: Api, path: string, env: Env, limitMs: number): Promise<ReadResult> {
  return new Promise<ReadResult>((resolve) => {
    let settled = false;
    let timer: unknown;
    const done = (result: ReadResult): void => {
      if (settled) return;
      settled = true;
      env.clearTimeout(timer);
      resolve(result);
    };
    timer = env.setTimeout(() => done({ ok: false, error: TIME_LIMIT_TEXT }), limitMs);
    let pending: Promise<unknown>;
    try {
      pending = api.get(path);
    } catch (error) {
      done({ ok: false, error: errorText(error) });
      return;
    }
    Promise.resolve(pending).then(
      (value) => done({ ok: true, value }),
      (error: unknown) => done({ ok: false, error: errorText(error) }),
    );
  });
}