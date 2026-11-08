// @ts-check
// The reduced view of a `play.mjs --level-info` value (design: Decision 8, "level-info.mjs"). Pure, no imports.

const ADDRESS_RE = /^([A-Z]+)([0-9]+)$/;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} text @returns {number} the length in code points, 0 for anything but a string */
const codePoints = (text) => (typeof text === 'string' ? [...text].length : 0);

/**
 * Column letters read as a base-26 number, A = 1.
 * @param {string} letters
 * @returns {number}
 */
function columnNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * The reduced view of a `--level-info` value. Returns a new object; the input is not changed. Never throws.
 * Every top-level field is kept unchanged and in its order. Only `cells` is reduced.
 * The grid is the rectangle of `map`: rows 1..map.length, columns A..(the letter of the longest row length, in code points).
 * An address is parsed as capital letters then digits (`^[A-Z]+[0-9]+$`; column letters read as a base-26 number, A = 1);
 * an address that does not parse, or lies outside the rectangle, is kept (outside = the rule panel).
 * Inside the grid a cell is kept only if `locked` is not true, or it has a `name`, or its `raw` starts with "=", or its `raw` is longer than one character.
 * A kept cell is the source cell as given (`address`, `raw`, `locked`, `name`; keys present only as in the source, none added).
 * If `info` has no `map` array or no `cells` array, it is returned unchanged (a copy).
 * @param {unknown} info the parsed JSON value
 * @returns {unknown}
 */
export function reduceLevelInfo(info) {
  try {
    if (!isObject(info)) return Array.isArray(info) ? [...info] : info;
    const { map, cells } = info;
    if (!Array.isArray(map) || !Array.isArray(cells)) return { ...info };

    const rows = map.length;
    let columns = 0;
    for (const row of map) columns = Math.max(columns, codePoints(row));

    /** @param {unknown} cell @returns {boolean} */
    const keep = (cell) => {
      if (!isObject(cell)) return true;
      const m = typeof cell.address === 'string' ? ADDRESS_RE.exec(cell.address) : null;
      if (m === null) return true;
      const column = columnNumber(m[1]);
      const row = Number(m[2]);
      if (!Number.isSafeInteger(row) || row < 1 || row > rows || column > columns) return true;
      if (cell.locked !== true) return true;
      if (typeof cell.name === 'string' && cell.name !== '') return true;
      const raw = cell.raw;
      return typeof raw === 'string' && (raw.startsWith('=') || codePoints(raw) > 1);
    };

    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(info)) {
      out[key] = key === 'cells' ? cells.filter(keep).map((c) => (isObject(c) ? { ...c } : c)) : info[key];
    }
    return out;
  } catch {
    return info;
  }
}
