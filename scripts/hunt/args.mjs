// @ts-check
// Pure parsers for the command lines of the hunt scripts. See .kiro/specs/exploit-hunt/design.md,
// "args.mjs" and "Refusal reasons". No parser throws.
import { isValidLevelId } from '../replay/levels.mjs';
import { CLASSES } from './limits.mjs';
import { parseActions } from './tokens.mjs';

/** @typedef {import('./types.mjs').Action} Action */

/** @param {unknown} v @returns {string[]} the string members of an array, [] for anything else */
function stringMembers(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

/**
 * `--level ID --class CLASS --actions TOKEN...` in this order.
 * @param {unknown} argv
 * @returns {{ok:true, levelId:string, claimedClass:string, actions:Action[]} | {ok:false, detail:string}}
 */
export function parseSubmitArgs(argv) {
  try {
    const list = /** @type {unknown[]} */ (Array.isArray(argv) ? argv : []);
    const words = stringMembers(list);
    if (!words.includes('--level')) return { ok: false, detail: 'missing_level' };
    if (!words.includes('--class')) return { ok: false, detail: 'missing_class' };
    if (!words.includes('--actions')) return { ok: false, detail: 'missing_actions' };
    // Order and shape: three flags with one value each at 0, 2 and 4; no second --actions among the tokens.
    if (list[0] !== '--level' || list[2] !== '--class' || list[4] !== '--actions' || list.slice(5).includes('--actions')) {
      return { ok: false, detail: 'unexpected_argument' };
    }
    const levelId = list[1];
    if (typeof levelId !== 'string' || !isValidLevelId(levelId)) return { ok: false, detail: 'bad_level_id' };
    const claimedClass = list[3];
    if (typeof claimedClass !== 'string' || !CLASSES.includes(claimedClass)) return { ok: false, detail: 'bad_class' };
    const parsed = parseActions(list.slice(5));
    if (!parsed.ok) return { ok: false, detail: parsed.detail };
    return { ok: true, levelId, claimedClass, actions: parsed.actions };
  } catch {
    return { ok: false, detail: 'unexpected_argument' };
  }
}

/**
 * `--level ID`
 * @param {unknown} argv
 * @returns {{ok:true, levelId:string} | {ok:false, detail:string}}
 */
export function parseInfoArgs(argv) {
  try {
    const list = /** @type {unknown[]} */ (Array.isArray(argv) ? argv : []);
    if (!stringMembers(list).includes('--level')) return { ok: false, detail: 'missing_level' };
    if (list[0] !== '--level' || list.length > 2) return { ok: false, detail: 'unexpected_argument' };
    const levelId = list[1];
    if (typeof levelId !== 'string' || !isValidLevelId(levelId)) return { ok: false, detail: 'bad_level_id' };
    return { ok: true, levelId };
  } catch {
    return { ok: false, detail: 'unexpected_argument' };
  }
}

/**
 * No arguments allowed.
 * @param {unknown} argv
 * @returns {{ok:true} | {ok:false, detail:string}}
 */
export function parseNoArgs(argv) {
  try {
    if (Array.isArray(argv) && argv.length === 0) return { ok: true };
    return { ok: false, detail: 'unexpected_argument' };
  } catch {
    return { ok: false, detail: 'unexpected_argument' };
  }
}
