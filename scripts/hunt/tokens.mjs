// @ts-check
// Token parser and printer of the exploit hunt (pure). See .kiro/specs/exploit-hunt/design.md,
// "tokens.mjs" and "Token grammar".
import { MAX_ADDRESS_CHARS, MAX_EDITS, MAX_RAW_BYTES, MAX_TOKENS } from './limits.mjs';

/** @typedef {import('./types.mjs').Action} Action */
/** @typedef {import('./types.mjs').ParsedActions} ParsedActions */

const EDIT_PREFIX = 'edit:';
const ADDRESS_RE = /^[A-Z]+[0-9]+$/;
const DIRECTIONS = ['N', 'S', 'E', 'W'];
const HEX = '0123456789ABCDEF';

/** @param {number} c a UTF-16 code unit @returns {boolean} A-Z a-z 0-9 . _ - */
function isSafe(c) {
  return (
    (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2e || c === 0x5f || c === 0x2d
  );
}

/** @param {number} c a UTF-16 code unit @returns {number} the hex value, or -1 */
function hexValue(c) {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

/** @param {string} s @returns {boolean} true when s has no lone surrogate */
function isWellFormed(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * The percent-encoding of a string, canonical. Precondition: s is well-formed text.
 * @param {string} raw
 * @returns {string}
 */
export function encodeRaw(raw) {
  const bytes = new TextEncoder().encode(raw);
  let out = '';
  for (const b of bytes) {
    out += isSafe(b) ? String.fromCharCode(b) : `%${HEX[b >> 4]}${HEX[b & 15]}`;
  }
  return out;
}

/**
 * @param {string} encoded
 * @returns {{ok:true, raw:string}|{ok:false, detail:'unescaped_character'|'bad_escape'|'bad_utf8'}}
 */
export function decodeRaw(encoded) {
  /** @type {number[]} */
  const bytes = [];
  for (let i = 0; i < encoded.length; i += 1) {
    const c = encoded.charCodeAt(i);
    if (isSafe(c)) {
      bytes.push(c);
    } else if (c === 0x25) {
      const hi = i + 1 < encoded.length ? hexValue(encoded.charCodeAt(i + 1)) : -1;
      const lo = i + 2 < encoded.length ? hexValue(encoded.charCodeAt(i + 2)) : -1;
      if (hi < 0 || lo < 0) return { ok: false, detail: 'bad_escape' };
      bytes.push(hi * 16 + lo);
      i += 2;
    } else {
      return { ok: false, detail: 'unescaped_character' };
    }
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes));
    return { ok: true, raw };
  } catch {
    return { ok: false, detail: 'bad_utf8' };
  }
}

/**
 * Decode one token. Returns the action or the detail of the first problem.
 * @param {unknown} token
 * @returns {{ok:true, action:Action}|{ok:false, detail:string}}
 */
function parseToken(token) {
  if (typeof token !== 'string') return { ok: false, detail: 'unknown_token' };
  if (token.includes(' ')) return { ok: false, detail: 'embedded_space' };
  if (DIRECTIONS.includes(token)) return { ok: true, action: { kind: 'move', dir: /** @type {'N'|'S'|'E'|'W'} */ (token) } };
  if (token === 'wait') return { ok: true, action: { kind: 'wait' } };
  if (token === 'undo') return { ok: true, action: { kind: 'undo' } };
  if (!token.startsWith(EDIT_PREFIX)) return { ok: false, detail: 'unknown_token' };
  const body = token.slice(EDIT_PREFIX.length);
  const eq = body.indexOf('=');
  if (eq < 0) return { ok: false, detail: 'bad_address' };
  const address = body.slice(0, eq);
  if (address.length > MAX_ADDRESS_CHARS || !ADDRESS_RE.test(address)) return { ok: false, detail: 'bad_address' };
  const decoded = decodeRaw(body.slice(eq + 1));
  if (!decoded.ok) return { ok: false, detail: decoded.detail };
  if (new TextEncoder().encode(decoded.raw).length > MAX_RAW_BYTES) return { ok: false, detail: 'raw_too_long' };
  return { ok: true, action: { kind: 'edit', address, raw: decoded.raw } };
}

/**
 * @param {unknown} args the arguments after --actions
 * @returns {ParsedActions} Never throws. Applies MAX_TOKENS, MAX_EDITS, MAX_RAW_BYTES.
 */
export function parseActions(args) {
  try {
    if (!Array.isArray(args) || args.length === 0) return { ok: false, detail: 'empty_actions' };
    if (args.length > MAX_TOKENS) return { ok: false, detail: 'too_many_tokens' };
    /** @type {Action[]} */
    const actions = [];
    for (let i = 0; i < args.length; i += 1) {
      const r = parseToken(args[i]);
      if (!r.ok) return { ok: false, detail: r.detail };
      actions.push(r.action);
    }
    if (actions.filter((a) => a.kind === 'edit').length > MAX_EDITS) return { ok: false, detail: 'too_many_edits' };
    return { ok: true, actions };
  } catch {
    return { ok: false, detail: 'unknown_token' };
  }
}

/**
 * @param {Action} action Precondition: a well-formed action (valid address, well-formed string).
 * @returns {string} one canonical token
 */
export function printAction(action) {
  switch (action.kind) {
    case 'move':
      return action.dir;
    case 'wait':
      return 'wait';
    case 'undo':
      return 'undo';
    default:
      return `${EDIT_PREFIX}${action.address}=${encodeRaw(action.raw)}`;
  }
}

/**
 * @param {Action[]} actions
 * @returns {string[]}
 */
export function printActions(actions) {
  return actions.map(printAction);
}

/**
 * For stored solutions: no limits, null when an action cannot be written as a token.
 * @param {unknown} actions
 * @returns {string[]|null}
 */
export function tryPrintActions(actions) {
  if (!Array.isArray(actions)) return null;
  /** @type {string[]} */
  const out = [];
  for (const a of actions) {
    if (a === null || typeof a !== 'object') return null;
    const o = /** @type {Record<string, unknown>} */ (a);
    if (o.kind === 'move') {
      if (typeof o.dir !== 'string' || !DIRECTIONS.includes(o.dir)) return null;
      out.push(o.dir);
    } else if (o.kind === 'wait') {
      out.push('wait');
    } else if (o.kind === 'undo') {
      out.push('undo');
    } else if (o.kind === 'edit') {
      if (typeof o.address !== 'string' || !ADDRESS_RE.test(o.address)) return null;
      if (typeof o.raw !== 'string' || !isWellFormed(o.raw)) return null;
      out.push(`${EDIT_PREFIX}${o.address}=${encodeRaw(o.raw)}`);
    } else {
      return null;
    }
  }
  return out;
}
