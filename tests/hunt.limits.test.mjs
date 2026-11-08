// @ts-check
import { readFileSync } from 'node:fs';
import * as limits from '../scripts/hunt/limits.mjs';
import { describe, expect, it } from 'vitest';
import {
  LEVEL_BUDGET,
  HUNT_BUDGET,
  TIME_BUDGET_SEC,
  REFUSAL_BUDGET,
  BEGIN_ALLOWANCE_SEC,
  LOCK_AGE_SEC,
  MAX_LEVELS,
  LEVEL_ID_MAX,
  MAX_TOKENS,
  MAX_EDITS,
  MAX_RAW_BYTES,
  MAX_ADDRESS_CHARS,
  FINDINGS_MAX_ITEMS,
  FINDING_MAX_BYTES,
  FINDINGS_MAX_BYTES,
  KEEP_HUNT_RECORDS,
  KEEP_CANDIDATE_FOLDERS,
  CALL_LOCK_STALE_MS,
  CALL_LOCK_WAIT_MS,
  INFO_MAX_BYTES,
  TOP_KEY,
  CLASSES,
  DEFAULT_REPO_URL,
  DEFAULT_BRANCH,
} from '../scripts/hunt/limits.mjs';

describe('hunt limits', () => {
  it('has the budget values', () => {
    expect(LEVEL_BUDGET).toBe(4);
    expect(HUNT_BUDGET).toBe(20);
    expect(TIME_BUDGET_SEC).toBe(1800);
    expect(REFUSAL_BUDGET).toBe(10);
    expect(BEGIN_ALLOWANCE_SEC).toBe(600);
    expect(LOCK_AGE_SEC).toBe(2400);
    expect(LOCK_AGE_SEC).toBe(TIME_BUDGET_SEC + 600);
  });

  it('has the argument limits', () => {
    expect(MAX_LEVELS).toBe(20);
    expect(LEVEL_ID_MAX).toBe(40);
    expect(MAX_TOKENS).toBe(40);
    expect(MAX_EDITS).toBe(4);
    expect(MAX_RAW_BYTES).toBe(40);
    expect('MAX_RAW_CHARS' in limits).toBe(false);
    expect(MAX_ADDRESS_CHARS).toBe(6);
  });

  it('has the size caps', () => {
    expect(FINDINGS_MAX_ITEMS).toBe(20);
    expect(FINDING_MAX_BYTES).toBe(1536);
    expect(FINDINGS_MAX_BYTES).toBe(16384);
    expect(INFO_MAX_BYTES).toBe(8192);
  });

  it('has the retention and call lock values', () => {
    expect(KEEP_HUNT_RECORDS).toBe(10);
    expect(KEEP_CANDIDATE_FOLDERS).toBe(10);
    expect(CALL_LOCK_STALE_MS).toBe(60000);
    expect(CALL_LOCK_WAIT_MS).toBe(45000);
  });

  it('has the key, classes and defaults', () => {
    expect(TOP_KEY).toBe('playtesterResults');
    expect(CLASSES).toEqual(['cheaper_win', 'free_win', 'unexpected_route']);
    expect(DEFAULT_REPO_URL).toBe('https://github.com/UBayouski/Grimsheet');
    expect(DEFAULT_BRANCH).toBe('main');
  });

  it('imports nothing', () => {
    const text = readFileSync(new URL('../scripts/hunt/limits.mjs', import.meta.url), 'utf8');
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\bimport\s*\(/);
    expect(text).not.toMatch(/\brequire\s*\(/);
  });
});
