import { describe, expect, it } from 'vitest';
import { APP_NAME, CONFIG_PATH, CRONS_PATH, LIMITS, TOP_KEY } from '../src/core/constants';
import { clip, getOwn, isRecord, readBool, readCount, readFiniteNumber, readString } from '../src/core/json';
import * as text from '../src/core/text';

describe('constants', () => {
  it('has the names and paths of the requirements', () => {
    expect(APP_NAME).toBe('grimsheet-playtester');
    expect(CONFIG_PATH).toBe('/api/apps/grimsheet-playtester/config');
    expect(CRONS_PATH).toBe('/api/crons');
    expect(TOP_KEY).toBe('playtesterResults');
  });

  it('has the display limits of Requirement 2, criterion 7', () => {
    expect(LIMITS.trend).toBe(30);
    expect(LIMITS.findings).toBe(20);
    expect(LIMITS.levels).toBe(100);
    expect(LIMITS.tokens).toBe(40);
    expect(LIMITS.tokenChars).toBe(140);
    expect(LIMITS.jobs).toBe(50);
  });
});

describe('fixed texts', () => {
  it('equal the wording of the requirements', () => {
    expect(text.LOADING).toBe('Reading results');
    expect(text.NO_RESULTS).toBe('No results yet. The nightly replay has not written any results.');
    expect(text.NO_REPLAY).toBe('No replay run recorded yet');
    expect(text.NO_HUNT).toBe('No hunt has run yet');
    expect(text.HUNT_EMPTY).toBe('The last hunt found no exploits');
    expect(text.RESULTS_FAILED).toBe('Results could not be read');
    expect(text.JOB_UNAVAILABLE).toBe('Replay job state is unavailable');
    expect(text.JOB_NOT_REGISTERED).toBe('The replay job is not registered');
    expect(text.API_MISSING).toBe('Kiro Crew did not provide the app API');
    expect(text.STALE).toBe('The last replay is older than 36 hours');
    expect(text.COPIED).toBe('Copied');
    expect(text.COPY_UNAVAILABLE).toBe('Copy is not available here. Select the text and press Ctrl+C.');
    expect(text.RESULTS_UPDATED).toBe('Results updated');
    expect(text.UNKNOWN_COLOUR).toBe('Unknown colour');
    expect(text.TIME_UNKNOWN).toBe('time unknown');
    expect(text.COMMIT_UNKNOWN).toBe('commit unknown');
    expect(text.FINDINGS_SENTENCE).toBe(
      'Every finding was reproduced by replaying its action list. The hunt is a bounded search, not a proof that no cheaper win exists.',
    );
    expect(text.REPLAY_HELP).toBe(
      'Run it in a Grimsheet checkout after npm ci and npm run build:play (play.mjs stops with "Run npm run build:play first" without the bundle), with the path of a file that holds the Actions_File_Text.',
    );
    expect(text.EARLIER_COMMIT).toBe('found on an earlier commit');
    expect(text.LEVEL_ID_INVALID).toBe('level id not valid');
    expect(text.NOT_CONVERTIBLE).toBe('action list could not be converted to a file');
    expect(text.NO_DETAIL).toBe('no detail in the last run');
    expect(text.INK_NOT_RECORDED).toBe('ink not recorded');
    expect(text.TIMED_OUT).toBe('play timed out');
    expect(text.OLDEST_TO_NEWEST).toBe('oldest to newest');
    expect(text.RUNNING_NOW).toBe('replay running now');
    expect(text.CONSECUTIVE_FAILURES).toBe('consecutive failures');
    expect(text.PAUSED).toBe('paused');
    expect(text.READING).toBe('Reading');
    expect(text.UNKNOWN).toBe('unknown');
  });
});

describe('json helpers', () => {
  const values: unknown[] = [null, undefined, true, false, 0, 1, -1, 1.5, NaN, Infinity, '', 'x', '1', [], [1], {}, { a: 1 }];

  it('isRecord is true for plain objects only', () => {
    expect(values.filter(isRecord)).toEqual([{}, { a: 1 }]);
  });

  it('readString returns a string and null for anything else', () => {
    expect(values.map(readString)).toEqual([null, null, null, null, null, null, null, null, null, null, '', 'x', '1', null, null, null, null]);
  });

  it('readFiniteNumber returns a finite number and does not convert a string', () => {
    expect(values.map(readFiniteNumber)).toEqual([null, null, null, null, 0, 1, -1, 1.5, null, null, null, null, null, null, null, null, null]);
  });

  it('readCount returns a finite integer at least 0', () => {
    expect(values.map(readCount)).toEqual([null, null, null, null, 0, 1, null, null, null, null, null, null, null, null, null, null, null]);
    expect(readCount(7)).toBe(7);
    expect(readCount(2 ** 40)).toBe(2 ** 40);
  });

  it('readBool returns true or false and null for anything else', () => {
    expect(values.map(readBool)).toEqual([null, null, true, false, null, null, null, null, null, null, null, null, null, null, null, null, null]);
  });

  it('a string is never converted to a number', () => {
    expect(readFiniteNumber('1')).toBeNull();
    expect(readCount('1')).toBeNull();
    expect(readBool('true')).toBeNull();
  });

  it('clip cuts to n code units, never leaves half a surrogate pair, and keeps a short string', () => {
    expect(clip('abcdef', 3)).toBe('abc');
    expect(clip('abc', 3)).toBe('abc');
    expect(clip('abc', 10)).toBe('abc');
    expect(clip('', 3)).toBe('');
    expect(clip('a\u{1F600}b', 2)).toBe('a');
    expect(clip('a\u{1F600}b', 3)).toBe('a\u{1F600}');
  });

  it('getOwn reads own keys and gives null for a key that is only on the prototype chain', () => {
    const record = JSON.parse('{"a":1,"__proto__":{"x":2},"nothing":null}') as Record<string, unknown>;
    expect(getOwn(record, 'a')).toBe(1);
    expect(getOwn(record, 'nothing')).toBeNull();
    expect(getOwn(record, 'missing')).toBeNull();
    expect(getOwn({}, '__proto__')).toBeNull();
    expect(getOwn({}, 'constructor')).toBeNull();
    expect(getOwn({}, 'toString')).toBeNull();
    expect(getOwn({}, 'hasOwnProperty')).toBeNull();
    expect(getOwn(record, '__proto__')).toEqual({ x: 2 });
  });
});