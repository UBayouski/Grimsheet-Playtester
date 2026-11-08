// The Token codec of the exploit-hunt design ("Token grammar"). Pure and total: nothing here throws.
//
// token = "N" | "S" | "E" | "W" | "wait" | "undo" | "edit:" ADDRESS "=" RAW
// ADDRESS = capital letters then digits, at most 6 characters; RAW = safe characters and %XX escapes of UTF-8 bytes.

export type Action =
  | { kind: 'move'; dir: 'N' | 'S' | 'E' | 'W' }
  | { kind: 'wait' }
  | { kind: 'undo' }
  | { kind: 'edit'; address: string; raw: string };

const ADDRESS_PATTERN = /^[A-Z]+[0-9]+$/;
const SAFE_PATTERN = /^[A-Za-z0-9._-]$/;
const HEX_PATTERN = /^[0-9A-Fa-f]{2}$/;
const LEVEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// ignoreBOM keeps a leading U+FEFF (the default would strip it and change the text); fatal refuses invalid input.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function decodeRaw(encoded: string): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    const ch = encoded.charAt(i);
    if (SAFE_PATTERN.test(ch)) {
      bytes.push(ch.charCodeAt(0));
    } else if (ch === '%') {
      const hex = encoded.slice(i + 1, i + 3);
      if (!HEX_PATTERN.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      return null;
    }
  }
  try {
    return decoder.decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

/** The action of one token, or null when the token is not in the grammar. */
export function decodeToken(token: unknown): Action | null {
  if (typeof token !== 'string') return null;
  switch (token) {
    case 'N':
    case 'S':
    case 'E':
    case 'W':
      return { kind: 'move', dir: token };
    case 'wait':
      return { kind: 'wait' };
    case 'undo':
      return { kind: 'undo' };
    default:
      break;
  }
  if (!token.startsWith('edit:')) return null;
  const rest = token.slice('edit:'.length);
  const equals = rest.indexOf('=');
  if (equals < 0) return null;
  const address = rest.slice(0, equals);
  if (address.length > 6 || !ADDRESS_PATTERN.test(address)) return null;
  const raw = decodeRaw(rest.slice(equals + 1));
  return raw === null ? null : { kind: 'edit', address, raw };
}

/** The actions of a token list, or null when any token fails. */
export function decodeActions(tokens: readonly unknown[]): Action[] | null {
  if (!Array.isArray(tokens)) return null;
  const actions: Action[] = [];
  for (const token of tokens) {
    const action = decodeToken(token);
    if (action === null) return null;
    actions.push(action);
  }
  return actions;
}

function encodeRaw(raw: string): string {
  let out = '';
  for (const byte of encoder.encode(raw)) {
    const ch = String.fromCharCode(byte);
    out += byte < 128 && SAFE_PATTERN.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** The canonical token: upper-case hex, every byte outside A-Z a-z 0-9 . _ - escaped. */
export function encodeAction(action: Action): string {
  switch (action.kind) {
    case 'move':
      return action.dir;
    case 'wait':
      return 'wait';
    case 'undo':
      return 'undo';
    case 'edit':
      return `edit:${action.address}=${encodeRaw(action.raw)}`;
  }
}

export function encodeActions(actions: readonly Action[]): string[] {
  return actions.map(encodeAction);
}

/** The content of the actions file: a JSON array with two-space indentation and no trailing newline. */
export function actionsFileText(actions: readonly Action[]): string {
  return JSON.stringify(actions, null, 2);
}

/** The play command with the literal `<actions-file>`, or null when the level id does not match the pattern. */
export function replayCommand(levelId: string): string | null {
  return typeof levelId === 'string' && LEVEL_ID_PATTERN.test(levelId) ? `node scripts/play.mjs ${levelId} --actions-file <actions-file>` : null;
}