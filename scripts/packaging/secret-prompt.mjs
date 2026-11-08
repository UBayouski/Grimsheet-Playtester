// @ts-check
// Prompts for the gateway address and token. The answer to the masked prompt is not echoed. Nothing here writes a file,
// and no error text holds the answer.

/**
 * @typedef {Object} PromptStreams
 * @property {import('node:stream').Readable & {isTTY?: boolean, setRawMode?: (on: boolean) => unknown}} input
 * @property {{write: (text: string) => unknown}} output
 * @property {string} question
 */

/**
 * Take the gateway origin and the token from what the user pasted: the whole address that `kirocrew token` printed
 * (`http://host:port/?token=...`), or a bare token.
 * @param {string} text
 * @returns {{ok: true, origin: string|null, token: string} | {ok: false, reason: string}}
 */
export function parseAccessInput(text) {
  const s = String(text ?? '').trim();
  if (s === '') return { ok: false, reason: 'the answer is empty' };
  if (/^https?:\/\//i.test(s)) {
    const origin = /^(https?:\/\/[^/?#\s]+)/i.exec(s);
    const found = /[?&]token=([^&#\s]*)/.exec(s);
    if (!origin || !found || !found[1]) return { ok: false, reason: 'the address holds no token' };
    let token = found[1];
    try {
      token = decodeURIComponent(token);
    } catch {
      // keep the text as it is
    }
    return { ok: true, origin: origin[1] ?? null, token };
  }
  if (/\s/.test(s)) return { ok: false, reason: 'a token holds no white space' };
  return { ok: true, origin: null, token: s };
}

/**
 * @param {PromptStreams & {mask: boolean}} p
 * @returns {Promise<string>}
 */
function readAnswer({ input, output, question, mask }) {
  return new Promise((resolve, reject) => {
    const raw = mask && input.isTTY === true && typeof input.setRawMode === 'function';
    if (raw) input.setRawMode?.(true);
    output.write(question);
    let buffer = '';
    let done = false;
    /** @param {() => void} settle */
    const finish = (settle) => {
      if (done) return;
      done = true;
      input.off('data', onData);
      input.off('end', onEnd);
      if (raw) input.setRawMode?.(false);
      if (mask) output.write('\n');
      input.pause();
      settle();
    };
    const complete = () => finish(() => (buffer === '' ? reject(new Error('the answer is empty')) : resolve(buffer)));
    /** @param {Buffer|string} chunk */
    function onData(chunk) {
      for (const ch of String(chunk)) {
        if (ch === '\n' || ch === '\r') return complete();
        if (ch === '\x03') return finish(() => reject(new Error('cancelled')));
        if (ch === '\x7f' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    }
    function onEnd() {
      complete();
    }
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

/**
 * A prompt whose answer is not echoed (the answer holds the token).
 * @param {PromptStreams} p
 * @returns {Promise<string>}
 */
export function promptSecret(p) {
  return readAnswer({ ...p, mask: true });
}

/**
 * A prompt whose answer is the gateway origin. It refuses an answer that holds `token=`, so the whole address cannot be
 * given here by mistake, and it writes nothing of the answer.
 * @param {PromptStreams} p
 * @returns {Promise<string>}
 */
export async function promptVisible(p) {
  const answer = await readAnswer({ ...p, mask: false });
  if (/token=/i.test(answer)) throw new Error('that answer holds the token; give only the origin (for example http://127.0.0.1:5476)');
  return answer;
}
