// @ts-check
// Pure Finding logic of the exploit hunt: build, dedupe, order, size, caps, eviction.
// No I/O. See .kiro/specs/exploit-hunt/design.md, "findings.mjs", "Findings add and evict"
// and "Size calculation".
import { FINDINGS_MAX_ITEMS, FINDING_MAX_BYTES, FINDINGS_MAX_BYTES } from './limits.mjs';

/** @typedef {import('./types.mjs').Finding} Finding */
/** @typedef {import('./types.mjs').FindingsValue} FindingsValue */
/** @typedef {import('./types.mjs').FindingsCounts} FindingsCounts */
/** @typedef {import('./types.mjs').CheckOk} CheckOk */
/** @typedef {import('./types.mjs').ClaimedClass} ClaimedClass */
/** @typedef {{updatedAt: string, commit: string|null, huntId: string|null, counts: FindingsCounts}} FindingsHeader */

/**
 * @param {string} huntId
 * @param {number} attempt
 * @returns {string} for example 'hunt-20261108T110312Z-007'
 */
export function findingId(huntId, attempt) {
  return `${huntId}-${String(attempt).padStart(3, '0')}`;
}

/**
 * A Finding from a confirmed CheckOk. Copies won, inkSpent, minimalInk, editCount,
 * newEditAddresses and reasonCode; `tokens` are the canonical tokens.
 * @param {{huntId: string, attempt: number, commit: string, foundAt: string, levelId: string,
 *          claimedClass: ClaimedClass, tokens: string[], checkOk: CheckOk}} p
 * @returns {Finding}
 */
export function buildFinding({ huntId, attempt, commit, foundAt, levelId, claimedClass, tokens, checkOk }) {
  return {
    id: findingId(huntId, attempt),
    levelId,
    class: claimedClass,
    commit,
    huntId,
    foundAt,
    actions: [...tokens],
    result: {
      won: checkOk.won,
      inkSpent: checkOk.inkSpent,
      minimalInk: checkOk.minimalInk,
      editCount: checkOk.editCount,
      newEditAddresses: [...checkOk.newEditAddresses],
      reasonCode: checkOk.reasonCode,
    },
  };
}

/**
 * Same levelId, same class and same token list.
 * @param {Finding} a
 * @param {Finding} b
 * @returns {boolean}
 */
export function isDuplicate(a, b) {
  return (
    a.levelId === b.levelId &&
    a.class === b.class &&
    a.actions.length === b.actions.length &&
    a.actions.every((t, i) => t === b.actions[i])
  );
}

/** @returns {FindingsValue} */
function emptyValue() {
  return {
    schemaVersion: 1,
    updatedAt: '1970-01-01T00:00:00.000Z',
    commit: null,
    huntId: null,
    counts: { attempts: 0, confirmed: 0, rejected: 0, error: 0, duplicate: 0, notRecorded: 0 },
    items: [],
  };
}

/**
 * Whatever is stored under `findings`. A legacy array, a non-object or a malformed object
 * gives the empty value (Decision 29).
 * @param {unknown} raw
 * @returns {FindingsValue}
 */
export function normalizeFindings(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyValue();
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (
    o.schemaVersion !== 1 ||
    !Array.isArray(o.items) ||
    o.counts === null ||
    typeof o.counts !== 'object' ||
    Array.isArray(o.counts)
  ) {
    return emptyValue();
  }
  return /** @type {FindingsValue} */ (raw);
}

/**
 * Newest first: foundAt descending, then id descending. Returns a new array.
 * @param {Finding[]} items
 * @returns {Finding[]}
 */
export function sortNewestFirst(items) {
  return [...items].sort((a, b) => {
    if (a.foundAt !== b.foundAt) return a.foundAt < b.foundAt ? 1 : -1;
    if (a.id !== b.id) return a.id < b.id ? 1 : -1;
    return 0;
  });
}

/**
 * UTF-8 length of the compact JSON text.
 * @param {unknown} value
 * @returns {number}
 */
export function sizeOf(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * True when one Finding is within FINDING_MAX_BYTES.
 * @param {Finding} finding
 * @returns {boolean}
 */
export function fits(finding) {
  return sizeOf(finding) <= FINDING_MAX_BYTES;
}

/**
 * @param {FindingsHeader} header
 * @param {Finding[]} items
 * @returns {FindingsValue}
 */
function build(header, items) {
  return {
    schemaVersion: 1,
    updatedAt: header.updatedAt,
    commit: header.commit,
    huntId: header.huntId,
    counts: { ...header.counts },
    items,
  };
}

/**
 * Adds a Finding, evicting the oldest items first until the caps hold (Requirement 10,
 * criterion 8). A duplicate returns the normalized existing value unchanged.
 * @param {unknown} existing
 * @param {Finding} finding
 * @param {FindingsHeader} header
 * @returns {{value: FindingsValue, duplicate: boolean, duplicateOf: string|null, evicted: string[], tooLarge: boolean}}
 */
export function addFinding(existing, finding, header) {
  const value = normalizeFindings(existing);
  const dup = value.items.find((i) => isDuplicate(i, finding));
  if (dup) return { value, duplicate: true, duplicateOf: dup.id, evicted: [], tooLarge: false };

  const items = sortNewestFirst(value.items);
  /** @type {string[]} */
  const evicted = [];
  const make = () => build(header, sortNewestFirst([finding, ...items]));
  while (
    items.length > 0 &&
    (items.length + 1 > FINDINGS_MAX_ITEMS || sizeOf(make()) > FINDINGS_MAX_BYTES)
  ) {
    const oldest = /** @type {Finding} */ (items.pop());
    evicted.push(oldest.id);
  }
  const result = make();
  return {
    value: result,
    duplicate: false,
    duplicateOf: null,
    evicted,
    tooLarge: sizeOf(result) > FINDINGS_MAX_BYTES,
  };
}

/**
 * Header-only refresh used by Hunt_End: same items, new header.
 * @param {unknown} existing
 * @param {FindingsHeader} header
 * @returns {FindingsValue}
 */
export function withHeader(existing, header) {
  const value = normalizeFindings(existing);
  return build(header, [...value.items]);
}

/**
 * A Finding built from the limits with the longest possible values (1199 bytes).
 * 40 tokens: 4 edit tokens of 132 characters and 36 tokens of 4 characters.
 * @returns {Finding}
 */
export function worstCaseFinding() {
  const edit = `edit:AAAAA1=${'%25'.repeat(40)}`; // 5 + 6 + 1 + 120 = 132
  const actions = [];
  for (let i = 0; i < 40; i++) actions.push(i < 4 ? edit : i % 2 === 0 ? 'wait' : 'undo');
  return {
    id: 'hunt-20261108T110312Z-020',
    levelId: 'L'.repeat(40),
    class: 'unexpected_route',
    commit: 'a'.repeat(40),
    huntId: 'hunt-20261108T110312Z',
    foundAt: '2026-11-08T11:14:02.511Z',
    actions,
    result: {
      won: true,
      inkSpent: 9999,
      minimalInk: 9999,
      editCount: 4,
      newEditAddresses: ['AAAAA1', 'AAAAA1', 'AAAAA1', 'AAAAA1'],
      reasonCode: 'class_reproduced',
    },
  };
}
