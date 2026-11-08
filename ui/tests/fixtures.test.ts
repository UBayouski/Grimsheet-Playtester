import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const folder = new URL('./fixtures/', import.meta.url);
const names = readdirSync(folder).filter((name) => name.endsWith('.json'));

const forbidden: Array<[string, RegExp]> = [
  ['a drive-letter path', /\b[A-Za-z]:[\\/](?!\/)/],
  ['a Users folder', /Users[\\/]/],
  ['a token in a URL', /token=/],
  ['a home folder', /\/home\//],
];

describe('fixtures', () => {
  it('has the expected files', () => {
    expect(names.sort()).toEqual([
      'config.amber-and-red.json',
      'config.failed-run.json',
      'config.findings-only.json',
      'config.no-key.json',
      'config.replay-two-runs.json',
      'config.schema-2.json',
      'config.with-findings.json',
      'crons.none.json',
      'crons.replay-failing.json',
      'crons.replay-idle.json',
      'crons.replay-running.json',
    ]);
  });

  it.each(names)('%s parses as a JSON object', (name) => {
    const value = JSON.parse(readFileSync(new URL(name, folder), 'utf8'));
    expect(typeof value).toBe('object');
    expect(Array.isArray(value)).toBe(false);
  });

  it.each(names)('%s holds no path, user name, token or home folder', (name) => {
    const text = readFileSync(new URL(name, folder), 'utf8');
    for (const [what, pattern] of forbidden) {
      expect(pattern.test(text), `${name} holds ${what}`).toBe(false);
    }
  });

  it('the scan patterns catch what they should', () => {
    const samples = ['C:\\Users\\someone', 'D:/work', '"C:\\\\x"', 'x/Users/y', 'a?token=1', '/home/me'];
    for (const sample of samples) {
      expect(forbidden.some(([, pattern]) => pattern.test(sample)), sample).toBe(true);
    }
    expect(forbidden.some(([, pattern]) => pattern.test('https://github.com/UBayouski/Grimsheet'))).toBe(false);
  });

  it('a cron fixture has no script, or only a placeholder in angle brackets', () => {
    for (const name of names.filter((n) => n.startsWith('crons.'))) {
      const value = JSON.parse(readFileSync(new URL(name, folder), 'utf8')) as { jobs: Array<{ script?: string }> };
      for (const job of value.jobs) {
        if (job.script !== undefined) expect(job.script.startsWith('<'), name).toBe(true);
      }
    }
  });

  it('the cron fixtures use all three time forms', () => {
    const times = names
      .filter((n) => n.startsWith('crons.'))
      .flatMap((n) => (JSON.parse(readFileSync(new URL(n, folder), 'utf8')) as { jobs: Array<Record<string, unknown>> }).jobs)
      .flatMap((job) => [job['last_run_ts'], job['next_run_ts']]);
    expect(times.some((v) => typeof v === 'string')).toBe(true);
    expect(times.some((v) => typeof v === 'number' && v < 1e11)).toBe(true);
    expect(times.some((v) => typeof v === 'number' && v >= 1e11)).toBe(true);
  });
});