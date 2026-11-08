// @ts-check
// Fixture checks for the exploit-hunt spec (task 3.3). Read only: nothing here runs play.mjs
// or touches the Grimsheet checkout. Nothing is imported from scripts/hunt; the reduction
// rule (design Decision 8, Hunt_Info) is written inline below.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * @param {string} relative path under tests/fixtures/
 * @returns {Buffer}
 */
function readRaw(relative) {
  return readFileSync(new URL(`./fixtures/${relative}`, import.meta.url));
}

/**
 * @param {string} relative path under tests/fixtures/
 * @returns {any}
 */
function readJson(relative) {
  return JSON.parse(readRaw(relative).toString('utf8'));
}

/**
 * Column letters as a base-26 number, A = 1.
 * @param {string} letters
 * @returns {number}
 */
function columnNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * The reduction rule, inline copy: keep every cell outside the map grid (or with an
 * unparsable address); inside the grid keep a cell only if it is unlocked, named,
 * its raw starts with "=", or its raw is longer than one character.
 * @param {any} info
 * @returns {any}
 */
function reduce(info) {
  const rows = info.map.length;
  let cols = 0;
  for (const row of info.map) cols = Math.max(cols, [...row].length);
  const cells = info.cells.filter((/** @type {any} */ cell) => {
    const m = /^([A-Z]+)([0-9]+)$/.exec(String(cell.address));
    if (!m) return true;
    const col = columnNumber(m[1]);
    const row = Number(m[2]);
    const inside = col >= 1 && col <= cols && row >= 1 && row <= rows;
    if (!inside) return true;
    const raw = String(cell.raw);
    return (
      cell.locked !== true ||
      (typeof cell.name === 'string' && cell.name !== '') ||
      raw.startsWith('=') ||
      [...raw].length > 1
    );
  });
  return { ...info, cells };
}

describe('level-info capture of 02-the-chaser', () => {
  const buf = readRaw('level-info/02-the-chaser.json');
  const info = readJson('level-info/02-the-chaser.json');

  it('parses to a JSON object and has no BOM', () => {
    expect(buf[0]).not.toBe(0xef);
    expect(buf.toString('utf8').charCodeAt(0)).not.toBe(0xfeff);
    expect(typeof info).toBe('object');
    expect(info).not.toBeNull();
    expect(Array.isArray(info)).toBe(false);
  });

  it('has the field names recorded in task 3.1', () => {
    for (const key of ['id', 'title', 'hint', 'startingHp', 'ink', 'seed', 'hero', 'monsters', 'map', 'cells']) {
      expect(info).toHaveProperty(key);
    }
    expect(info.id).toBe('02-the-chaser');
  });

  it('reduced view is at most 8192 bytes and keeps exactly A14, B14, A15, B15', () => {
    const reduced = reduce(info);
    const bytes = Buffer.byteLength(JSON.stringify(reduced), 'utf8');
    expect(bytes).toBeLessThanOrEqual(8192);
    expect(bytes).toBe(686); // measured in design.md (Size note)
    expect(reduced.cells.map((/** @type {any} */ c) => c.address)).toEqual(['A14', 'B14', 'A15', 'B15']);
    expect(reduced.cells).toHaveLength(4);
  });
});

describe('candidate-file fixtures for 01-the-corridor', () => {
  it('play output with extra keys equals the stored-solution play output', () => {
    const withExtra = readJson('01-the-corridor.candidate-file.play.json');
    const plain = readJson('01-the-corridor.play.json');
    expect(withExtra).toEqual(plain);
  });

  it('candidate file has levelId, claimedClass and the stored actions', () => {
    const candidate = readJson('actions/01-the-corridor.candidate-file.json');
    const stored = readJson('solutions/01-the-corridor.json');
    expect(candidate.levelId).toBe('01-the-corridor');
    expect(typeof candidate.claimedClass).toBe('string');
    expect(Array.isArray(candidate.actions)).toBe(true);
    expect(candidate.actions).toEqual(stored.actions);
  });
});
