// @ts-check
// Real outputs of Grimsheet's play command, captured by task 2 (see tests/fixtures/GRIMSHEET_COMMIT.txt).
// Read only: these tests never run play.mjs and never touch the Grimsheet checkout.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { replayVerdict as replayVerdictTyped, checkCandidate as checkCandidateTyped } from '../scripts/verifier.mjs';

const replayVerdict = /** @type {(...args: any[]) => any} */ (replayVerdictTyped);
const checkCandidate = /** @type {(...args: any[]) => any} */ (checkCandidateTyped);

/**
 * @param {string} relative path under tests/fixtures/
 * @returns {any}
 */
function readJson(relative) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${relative}`, import.meta.url), 'utf8'));
}

/** @type {any[]} */
const manifest = readJson('manifest.json');

/**
 * @param {string} file the .play.json file name from the manifest
 * @returns {{entry: any, play: any}}
 */
function capture(file) {
  const entry = manifest.find((m) => m.file === file);
  if (!entry) throw new Error(`no manifest entry for ${file}`);
  return { entry, play: readJson(file) };
}

/** @param {string} levelId @returns {any} the stored-solution copy */
function solution(levelId) {
  return readJson(`solutions/${levelId}.json`);
}

describe('fixtures: the manifest', () => {
  it('lists the five captures, all with exit code 0', () => {
    expect(manifest.map((m) => m.file).sort()).toEqual([
      '01-the-corridor.play.json',
      '01-the-corridor.undo-first.play.json',
      '02-the-chaser.play.json',
      '02-the-chaser.truncated.play.json',
      '03-the-locked-crypt.play.json',
    ]);
    for (const m of manifest) expect(m.exitCode).toBe(0);
  });
});

describe('fixtures: stored solutions replayed', () => {
  it.each([
    ['01-the-corridor.play.json', '01-the-corridor', 0],
    ['02-the-chaser.play.json', '02-the-chaser', 1],
    ['03-the-locked-crypt.play.json', '03-the-locked-crypt', 2],
  ])('%s is green with ink spent equal to minimalInk', (file, levelId, minimalInk) => {
    const { entry, play } = capture(file);
    const stored = solution(levelId);
    expect(stored.minimalInk).toBe(minimalInk);
    const v = replayVerdict(levelId, stored, entry.exitCode, play);
    expect(v.colour).toBe('green');
    expect(v.won).toBe(true);
    expect(v.inkSpent).toBe(minimalInk);
    expect(v.minimalInk).toBe(minimalInk);
    expect(v.refusedAt).toBeNull();
    expect(v.levelId).toBe(levelId);
  });
});

describe('fixtures: the truncated list (02-the-chaser, first 3 actions)', () => {
  const { entry, play } = capture('02-the-chaser.truncated.play.json');
  const truncated = readJson(entry.actionsFile);

  it('the capture did not win', () => {
    expect(play.final.status).not.toBe('won');
    expect(truncated).toHaveLength(3);
  });

  it('is red when the stored solution is the truncated list with the level minimalInk', () => {
    const stored = { ...solution('02-the-chaser'), actions: truncated };
    const v = replayVerdict('02-the-chaser', stored, entry.exitCode, play);
    expect(v.colour).toBe('red');
    expect(v.won).toBe(false);
  });

  it('against the full stored solution it is replay_mismatch (3 steps for 14 actions), never a colour', () => {
    const v = replayVerdict('02-the-chaser', solution('02-the-chaser'), entry.exitCode, play);
    expect(v.colour).toBe('error');
    expect(v.reasonCode).toBe('replay_mismatch');
  });

  it('as a candidate it is rejected with not_won for every class', () => {
    for (const claimedClass of ['cheaper_win', 'free_win', 'unexpected_route']) {
      const r = checkCandidate('02-the-chaser', solution('02-the-chaser'), claimedClass, truncated, entry.exitCode, play);
      expect(r.outcome).toBe('rejected');
      expect(r.reasonCode).toBe('not_won');
    }
  });
});

describe('fixtures: the 03 solution as a candidate', () => {
  it('is rejected for all three classes', () => {
    const { entry, play } = capture('03-the-locked-crypt.play.json');
    const stored = solution('03-the-locked-crypt');
    const expected = { cheaper_win: 'not_cheaper', free_win: 'has_edits', unexpected_route: 'no_new_cell' };
    for (const [claimedClass, reasonCode] of Object.entries(expected)) {
      const r = checkCandidate('03-the-locked-crypt', stored, claimedClass, stored.actions, entry.exitCode, play);
      expect(r.outcome).toBe('rejected');
      expect(r.reasonCode).toBe(reasonCode);
      expect(r.won).toBe(true);
      expect(r.inkSpent).toBe(2);
      expect(r.editCount).toBe(2);
      expect(r.newEditAddresses).toEqual([]);
    }
  });
});

describe('fixtures: the undo-first capture (a refused undo, then the 01 solution)', () => {
  const { entry, play } = capture('01-the-corridor.undo-first.play.json');
  const actions = readJson(entry.actionsFile);

  it('the play result reports the refusal at 0 with reason and message', () => {
    expect(play.refusedAt).toBe(0);
    expect(play.steps[0].accepted).toBe(false);
    expect(typeof play.steps[0].reason).toBe('string');
    expect(play.steps[0].reason.length).toBeGreaterThan(0);
    expect(typeof play.steps[0].message).toBe('string');
    expect(play.steps[0].message.length).toBeGreaterThan(0);
    expect(play.steps[0].action).toEqual({ kind: 'undo' });
  });

  it('is green with refusedAt 0 for a stored copy built from the undo-first action list (minimalInk 0)', () => {
    const stored = { levelId: '01-the-corridor', minimalInk: 0, actions };
    const v = replayVerdict('01-the-corridor', stored, entry.exitCode, play);
    expect(v.colour).toBe('green');
    expect(v.won).toBe(true);
    expect(v.refusedAt).toBe(0);
    expect(v.inkSpent).toBe(0);
  });
});
