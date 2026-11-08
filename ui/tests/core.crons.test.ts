import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildJobView, findReplayJob, parseJob, readIsRunning } from '../src/core/crons';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const jobs = (...list: unknown[]): unknown => ({ jobs: list });

describe('findReplayJob', () => {
  it('picks the job named exactly replay', () => {
    const r = findReplayJob(jobs({ id: 'x', name: 'other' }, { id: 'a', name: 'replay' }));
    expect(r).toMatchObject({ kind: 'found', job: { id: 'a' } });
  });

  it('picks a job whose name ends with /replay', () => {
    const r = findReplayJob(jobs({ id: 'x', name: 'grimsheet-playtester/hunt' }, { id: 'a', name: 'grimsheet-playtester/replay' }));
    expect(r).toMatchObject({ kind: 'found', job: { id: 'a' } });
  });

  it('does not match a name that only contains replay', () => {
    for (const name of ['replayer', 'my-replay-job', 'replay/x', 'Replay', 'a/replay2']) {
      expect(findReplayJob(jobs({ id: 'a', name })), name).toEqual({ kind: 'not-registered' });
    }
  });

  it('falls back to the job whose script contains replay_cron.py when no name matches', () => {
    const r = findReplayJob(jobs({ id: 'x', name: 'other', script: '<app>/scripts/other.py' }, { id: 'a', script: '<app folder>/scripts/replay_cron.py' }));
    expect(r).toMatchObject({ kind: 'found', job: { id: 'a' } });
  });

  it('prefers a name match over a script match, even when the script job comes first', () => {
    const r = findReplayJob(jobs({ id: 's', script: 'scripts/replay_cron.py' }, { id: 'n', name: 'replay' }));
    expect(r).toMatchObject({ kind: 'found', job: { id: 'n' } });
  });

  it('takes the first match in list order', () => {
    const r = findReplayJob(jobs({ id: '1', name: 'replay' }, { id: '2', name: 'app/replay' }));
    expect(r).toMatchObject({ kind: 'found', job: { id: '1' } });
  });

  it('gives not-registered for no job, and for jobs that are not records', () => {
    expect(findReplayJob(jobs())).toEqual({ kind: 'not-registered' });
    expect(findReplayJob(jobs(5, null, 'x', [], { id: 'a' }))).toEqual({ kind: 'not-registered' });
  });

  it('gives unavailable when the value is not a record or jobs is not a list', () => {
    for (const v of [null, undefined, 5, 'x', [], {}, { jobs: 'x' }, { jobs: {} }, { jobs: null }]) expect(findReplayJob(v), JSON.stringify(v)).toEqual({ kind: 'unavailable' });
  });

  it('inspects only the first 50 jobs', () => {
    const filler = Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: 'other' }));
    expect(findReplayJob(jobs(...filler, { id: 'late', name: 'replay' }))).toEqual({ kind: 'not-registered' });
    expect(findReplayJob(jobs(...filler.slice(1), { id: 'ok', name: 'replay' }))).toMatchObject({ kind: 'found' });
  });
});

describe('parseJob', () => {
  const base = { name: 'replay', enabled: true, user_paused: false, is_running: false };

  it('formats last_run_ts and next_run_ts given as seconds, milliseconds and ISO strings', () => {
    const ms = Date.UTC(2026, 10, 8, 11, 3, 12);
    const job = parseJob({ ...base, last_run_ts: ms / 1000, next_run_ts: ms });
    expect(job).toMatchObject({ kind: 'found', lastRun: '2026-11-08 11:03 UTC', nextRun: '2026-11-08 11:03 UTC' });
    expect(parseJob({ ...base, last_run_ts: '2026-11-08T11:03:12Z', next_run_ts: null })).toMatchObject({ lastRun: '2026-11-08 11:03 UTC', nextRun: 'time unknown' });
  });

  it('a time of another type is "time unknown"', () => {
    for (const v of [{}, [], true, undefined, -5, NaN, 'x']) {
      expect(parseJob({ ...base, last_run_ts: v, next_run_ts: v })).toMatchObject({ lastRun: 'time unknown', nextRun: 'time unknown' });
    }
  });

  it('clips last_status to 40 characters and omits a status that is not a string', () => {
    expect(parseJob({ ...base, last_status: 'ok' })).toMatchObject({ lastStatus: 'ok' });
    expect(parseJob({ ...base, last_status: 's'.repeat(80) })).toMatchObject({ lastStatus: 's'.repeat(40) });
    expect(parseJob({ ...base, last_status: 5 })).toMatchObject({ lastStatus: null });
  });

  it('running is true only for exactly true', () => {
    expect(parseJob({ ...base, is_running: true })).toMatchObject({ running: true });
    for (const v of [false, 1, 'true', null, undefined, {}]) expect(parseJob({ ...base, is_running: v }), String(v)).toMatchObject({ running: false });
  });

  it('consecutive failures use readCount', () => {
    expect(parseJob({ ...base, consecutive_failures: 3 })).toMatchObject({ consecutiveFailures: 3 });
    expect(parseJob({ ...base, consecutive_failures: 0 })).toMatchObject({ consecutiveFailures: 0 });
    for (const v of ['3', -1, 1.5, null, undefined]) expect(parseJob({ ...base, consecutive_failures: v }), String(v)).toMatchObject({ consecutiveFailures: null });
  });

  it('paused when user_paused is true or enabled is false', () => {
    expect(parseJob({ name: 'replay', user_paused: true, enabled: true })).toMatchObject({ paused: true });
    expect(parseJob({ name: 'replay', user_paused: false, enabled: false })).toMatchObject({ paused: true });
    expect(parseJob({ name: 'replay', user_paused: false, enabled: true })).toMatchObject({ paused: false });
    expect(parseJob({ name: 'replay' })).toMatchObject({ paused: false });
    expect(parseJob({ name: 'replay', user_paused: 'yes', enabled: 0 })).toMatchObject({ paused: false });
  });

  it('carries no script, command or folder, and no value that contains the script string', () => {
    const job = parseJob({ ...base, script: 'C:\\secret\\place\\replay_cron.py', command: 'run secret', folder: '/secret/folder', last_status: 'ok' });
    const text = JSON.stringify(job);
    expect(Object.keys(job)).not.toContain('script');
    expect(Object.keys(job)).not.toContain('command');
    expect(Object.keys(job)).not.toContain('folder');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('replay_cron');
  });
});

describe('buildJobView and readIsRunning', () => {
  it('builds the view for each fixture', () => {
    expect(buildJobView(fixture('crons.replay-idle.json'))).toMatchObject({ kind: 'found', running: false, consecutiveFailures: 0, paused: false, lastStatus: 'ok' });
    expect(buildJobView(fixture('crons.replay-running.json'))).toMatchObject({ kind: 'found', running: true });
    expect(buildJobView(fixture('crons.replay-failing.json'))).toMatchObject({ kind: 'found', consecutiveFailures: 3, paused: true, lastStatus: 'error' });
    expect(buildJobView(fixture('crons.none.json'))).toEqual({ kind: 'not-registered' });
    expect(buildJobView('x')).toEqual({ kind: 'unavailable' });
  });

  it('readIsRunning is true only for a found replay job with is_running exactly true', () => {
    expect(readIsRunning(fixture('crons.replay-running.json'))).toBe(true);
    expect(readIsRunning(fixture('crons.replay-idle.json'))).toBe(false);
    expect(readIsRunning(fixture('crons.none.json'))).toBe(false);
    expect(readIsRunning(jobs({ name: 'other', is_running: true }))).toBe(false);
    expect(readIsRunning(jobs({ name: 'replay', is_running: 'true' }))).toBe(false);
    for (const v of [null, undefined, 5, 'x', [], {}, { jobs: 'x' }]) expect(readIsRunning(v)).toBe(false);
  });
});