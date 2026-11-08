// @ts-check
// The README lint (R12.24): the points that a program can check. It holds no list of other tool or assistant names,
// because such a list would put those names in a repo file; R12.21 is a review rule, checked by reading.

/** @typedef {{rule: string, message: string}} Problem */

/** Phrases the README must hold. */
export const REQUIRED_PHRASES = Object.freeze(['Windows', 'only Windows was tested', '03:00', 'on request', 'bounded search', 'MIT', 'companion', 'Grimsheet entry']);

/** The two links the README must hold (R12.25). */
export const REQUIRED_LINKS = Object.freeze(['https://github.com/UBayouski/Grimsheet', 'https://grimsheet.onrender.com']);

/** Every web address in the README begins with one of these. */
export const ALLOWED_PREFIXES = Object.freeze(['https://github.com/UBayouski/', 'https://grimsheet.onrender.com']);

/** What may follow an allowed prefix: the end, a path or query start, punctuation, or a full stop that ends a sentence. */
const AFTER_PREFIX = /^(?:$|[/?#:)\],;'"`\s]|\.(?![A-Za-z0-9]))/;

/**
 * @param {string} address
 * @returns {boolean}
 */
function isAllowedAddress(address) {
  return ALLOWED_PREFIXES.some((prefix) => {
    if (!address.startsWith(prefix)) return false;
    // A prefix that ends with a slash is a folder of the host; a bare host needs a boundary so that a look-alike host fails.
    return prefix.endsWith('/') || AFTER_PREFIX.test(address.slice(prefix.length));
  });
}

/**
 * @param {string} text the content of README.md
 * @returns {Problem[]}
 */
export function lintReadme(text) {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {string} rule @param {string} message */
  const add = (rule, message) => void problems.push({ rule, message });

  for (const phrase of REQUIRED_PHRASES) {
    if (!text.includes(phrase)) add('phrase', `the README must hold the phrase "${phrase}"`);
  }
  for (const link of REQUIRED_LINKS) {
    if (!text.includes(link)) add('link', `the README must link ${link}`);
  }
  if (/[A-Za-z]:\\/.test(text)) add('drive-letter', 'the README holds a drive-letter path; use $env:ProgramFiles, ~ or %LOCALAPPDATA%');
  if (/Users\\/.test(text)) add('users-path', 'the README holds a Users folder path');
  if (/token=/i.test(text)) add('token', 'the README holds "token="');
  if (/localhost|127\.0\.0\.1/i.test(text)) add('local-address', 'the README holds a local address');
  if (/\b(?:TBD|TODO|FIXME)\b/.test(text)) add('placeholder', 'the README holds a placeholder word');
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const address = match[0].replace(/[).,;:\]]+$/, '');
    if (!isAllowedAddress(address)) add('address', `the README holds an address outside the allowed prefixes: ${address}`);
  }
  return problems;
}
