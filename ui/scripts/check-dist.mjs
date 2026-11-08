// @ts-check
// Checks the built page, dist/index.mjs, after the Vite build: only the five externals are imported, the SDK is imported
// as a namespace, the SDK ui module is not mentioned, and the text holds no absolute path, user name, token value or URL.
// Plain ESM with no dependency. Run by `npm run build`; exits with code 1 and prints the problems when a check fails.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The modules the host provides (the build marks them as externals). */
export const ALLOWED_IMPORTS = new Set(['@kirocrew/app-sdk', 'react', 'react/jsx-runtime', 'react-dom', 'lucide-react']);

/**
 * @param {string} text the content of dist/index.mjs
 * @returns {string[]} the problems found (empty when the text is fine)
 */
export function checkDistText(text) {
  /** @type {string[]} */
  const problems = [];

  // Static imports and re-exports: `import ... from "x"`, `export ... from "x"`.
  for (const m of text.matchAll(/(?:^|[;\n}\s])(?:import|export)\s*([^;"']*?)\s*from\s*["']([^"']+)["']/g)) {
    const clause = (m[1] ?? '').trim();
    const specifier = m[2] ?? '';
    if (!ALLOWED_IMPORTS.has(specifier)) problems.push(`imports "${specifier}", which is not an external of the host`);
    else if (specifier === '@kirocrew/app-sdk' && !/^\*\s*as\s+[\w$]+$/.test(clause)) {
      problems.push('imports @kirocrew/app-sdk by name; it must be imported as a namespace (import * as sdk)');
    }
  }
  // Bare imports: `import "x"`.
  for (const m of text.matchAll(/(?:^|[;\n}])\s*import\s*["']([^"']+)["']/g)) {
    problems.push(`imports "${m[1] ?? ''}" for its side effects`);
  }
  // Dynamic imports.
  if (/\bimport\s*\(/.test(text)) problems.push('uses a dynamic import');

  if (text.includes('@kirocrew/app-sdk/ui')) problems.push('mentions @kirocrew/app-sdk/ui');
  if (/[A-Za-z]:\\/.test(text)) problems.push('contains a drive-letter path');
  if (/Users\\/.test(text)) problems.push('contains a Users folder path');
  // A leaked token value: `token=` followed by at least 6 characters of a value. Code that only mentions `token=` (a pattern or a
  // replacement text) is not a leak: after `=` it has a bracket or an ellipsis, which are not value characters.
  if (/token=[A-Za-z0-9._~%-]{6,}/i.test(text)) problems.push('contains a token value');
  if (/https?:\/\//.test(text)) problems.push('contains a URL (http:// or https://)');
  return problems;
}

/**
 * @param {string[]} names the file names in dist/
 * @returns {string[]} the problems found
 */
export function checkDistFiles(names) {
  /** @type {string[]} */
  const problems = [];
  if (names.length === 0) problems.push('dist/ is empty');
  if (!names.includes('index.mjs')) problems.push('dist/index.mjs is missing');
  for (const name of names) {
    if (name !== 'index.mjs') problems.push(`dist/ holds an extra file: ${name}`);
  }
  return problems;
}

function main() {
  const dist = new URL('../dist/', import.meta.url);
  /** @type {string[]} */
  let problems = [];
  let size = 0;
  try {
    const names = readdirSync(dist);
    problems = checkDistFiles(names);
    if (names.includes('index.mjs')) {
      const text = readFileSync(new URL('index.mjs', dist), 'utf8');
      size = Buffer.byteLength(text, 'utf8');
      problems = problems.concat(checkDistText(text));
    }
  } catch (error) {
    problems.push(`dist/ could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-dist: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-dist: ok (dist/index.mjs, ${size} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();