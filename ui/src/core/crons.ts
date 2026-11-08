// The replay job in the /api/crons value. The `script` string is read only inside findReplayJob, to find the job,
// and is never copied into a result.
import { LIMITS } from './constants';
import { clip, getOwn, isRecord, readBool, readCount, readString } from './json';
import { formatUtc, parseCronTime } from './time';
import type { JobView } from './types';

type Lookup = { kind: 'unavailable' } | { kind: 'not-registered' } | { kind: 'found'; job: Record<string, unknown> };

/** The replay job (Assumption A-5): a job named `replay` or ending with `/replay`, else one whose script is replay_cron.py. */
export function findReplayJob(cronsValue: unknown): Lookup {
  if (!isRecord(cronsValue)) return { kind: 'unavailable' };
  const list = getOwn(cronsValue, 'jobs');
  if (!Array.isArray(list)) return { kind: 'unavailable' };
  const inspected = list.slice(0, LIMITS.jobs).filter(isRecord);
  const byName = inspected.find((job) => {
    const name = readString(getOwn(job, 'name'));
    return name !== null && (name === 'replay' || name.endsWith('/replay'));
  });
  if (byName !== undefined) return { kind: 'found', job: byName };
  const byScript = inspected.find((job) => (readString(getOwn(job, 'script')) ?? '').includes('replay_cron.py'));
  return byScript === undefined ? { kind: 'not-registered' } : { kind: 'found', job: byScript };
}

/** The view of one job. A field with the wrong type is read as absent. */
export function parseJob(job: Record<string, unknown>): Extract<JobView, { kind: 'found' }> {
  const status = readString(getOwn(job, 'last_status'));
  return {
    kind: 'found',
    lastRun: formatUtc(parseCronTime(getOwn(job, 'last_run_ts'))),
    lastStatus: status === null ? null : clip(status, LIMITS.statusChars),
    running: getOwn(job, 'is_running') === true,
    consecutiveFailures: readCount(getOwn(job, 'consecutive_failures')),
    nextRun: formatUtc(parseCronTime(getOwn(job, 'next_run_ts'))),
    paused: readBool(getOwn(job, 'user_paused')) === true || readBool(getOwn(job, 'enabled')) === false,
  };
}

/** The job area of the View_Model for a crons value. */
export function buildJobView(cronsValue: unknown): JobView {
  const found = findReplayJob(cronsValue);
  return found.kind === 'found' ? parseJob(found.job) : found;
}

/** True only for a found replay job whose `is_running` is exactly true. */
export function readIsRunning(cronsValue: unknown): boolean {
  const found = findReplayJob(cronsValue);
  return found.kind === 'found' && getOwn(found.job, 'is_running') === true;
}