// @ts-check
// Level list validation, stored-solution reading and coverage counts. A level id is checked against
// LEVEL_ID_PATTERN before it is used in any path.

import * as path from 'node:path';

/** @typedef {import('./types.mjs').Deps} Deps */
/** @typedef {import('./types.mjs').LevelEntry} LevelEntry */
/** @typedef {import('./types.mjs').Coverage} Coverage */

export const LEVEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @param {unknown} id
 * @returns {boolean} true for a string that matches the pattern
 */
export function isValidLevelId(id) {
  return typeof id === 'string' && LEVEL_ID_PATTERN.test(id);
}

/**
 * Parse the output of `play.mjs --list`.
 * @param {unknown} json parsed stdout (undefined when it was not JSON)
 * @param {number} exitCode
 * @returns {{ok: true, ids: string[], duplicates: string[]} | {ok: false, reasonCode: 'list_failed' | 'empty_level_list'}}
 */
export function parseLevelList(json, exitCode) {
  if (exitCode !== 0) return { ok: false, reasonCode: 'list_failed' };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { ok: false, reasonCode: 'list_failed' };
  const levels = /** @type {any} */ (json).levels;
  if (!Array.isArray(levels) || !levels.every(isValidLevelId)) return { ok: false, reasonCode: 'list_failed' };
  if (levels.length === 0) return { ok: false, reasonCode: 'empty_level_list' };
  /** @type {string[]} */
  const ids = [];
  /** @type {string[]} */
  const duplicates = [];
  for (const id of /** @type {string[]} */ (levels)) {
    if (!ids.includes(id)) ids.push(id);
    else if (!duplicates.includes(id)) duplicates.push(id);
  }
  return { ok: true, ids, duplicates };
}

/**
 * Read a stored solution once. The parsed value goes to the verifier and the same path goes to
 * play.mjs. An invalid id gives `no_file` without touching the file system.
 * @param {Pick<Deps, 'fs'>} deps
 * @param {string} checkoutDir
 * @param {string} id
 * @returns {Promise<{kind: 'ok', path: string, solution: unknown} | {kind: 'no_file'} | {kind: 'unreadable'}>}
 */
export async function readSolution(deps, checkoutDir, id) {
  if (!isValidLevelId(id)) return { kind: 'no_file' };
  const file = path.join(checkoutDir, 'tests', 'solutions', `${id}.json`);
  let text;
  try {
    text = await deps.fs.readFile(file, 'utf8');
  } catch (e) {
    return /** @type {any} */ (e)?.code === 'ENOENT' ? { kind: 'no_file' } : { kind: 'unreadable' };
  }
  try {
    return { kind: 'ok', path: file, solution: JSON.parse(text) };
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * Ids of `tests/solutions/*.json` that are not in the list. A file whose name is not a valid level id
 * is not an id and is left out.
 * @param {Pick<Deps, 'fs'>} deps
 * @param {string} checkoutDir
 * @param {string[]} listedIds
 * @returns {Promise<string[]>} sorted
 */
export async function findUnlisted(deps, checkoutDir, listedIds) {
  let names;
  try {
    names = await deps.fs.readdir(path.join(checkoutDir, 'tests', 'solutions'));
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'ENOENT') return [];
    throw e;
  }
  const listed = new Set(listedIds);
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -'.json'.length))
    .filter((id) => isValidLevelId(id) && !listed.has(id))
    .sort();
}

/**
 * @param {LevelEntry[]} entries
 * @param {string[]} duplicates
 * @param {string[]} unlisted
 * @returns {Coverage}
 */
export function buildCoverage(entries, duplicates, unlisted) {
  const count = (/** @type {string} */ code) => entries.filter((e) => e.colour === 'error' && e.reasonCode === code).length;
  const noSolution = count('no_solution_file');
  const unreadable = count('solution_unreadable');
  const notPlayed = count('not_played');
  return {
    listed: entries.length,
    played: entries.length - noSolution - unreadable - notPlayed,
    noSolution,
    unreadable,
    unlisted: unlisted.length,
    duplicateListedLevels: duplicates,
    unlistedSolutions: unlisted,
  };
}
