// @ts-check
// Feature: packaging. The repo files that make a committed ui/dist/index.mjs possible: .gitignore and .gitattributes.
// Only read-only git commands are run (check-ignore, check-attr). No network.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string[]} args
 * @returns {{status: number|null, stdout: string}}
 */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '' };
}

/**
 * Git's own verdict first (`git check-ignore -q`: exit 0 ignored, exit 1 not ignored), then `-v` for the matching rule.
 * With `-v`, git also prints a matching negated rule (`!pattern`) and exits 0, so `-v` alone cannot tell "ignored" from "re-included".
 * @param {string} path
 * @returns {{ignored: boolean, pattern: string|null}}
 */
function checkIgnore(path) {
  const verdict = git(['check-ignore', '-q', '--', path]);
  if (verdict.status === 1) return { ignored: false, pattern: null };
  expect(verdict.status).toBe(0);
  const r = git(['check-ignore', '-v', '--', path]);
  expect(r.status).toBe(0);
  const m = /^[^:]*:\d+:([^\t]*)\t/.exec(r.stdout.trim());
  return { ignored: true, pattern: m ? (m[1] ?? null) : null };
}

describe('.gitignore', () => {
  it('holds the four lines for the committed bundle, in order', () => {
    const lines = readFileSync(`${ROOT}.gitignore`, 'utf8').split(/\r?\n/);
    const at = (/** @type {string} */ s) => lines.indexOf(s);
    expect(at('dist/')).toBeGreaterThanOrEqual(0);
    expect(at('!ui/dist/')).toBe(at('dist/') + 1);
    expect(at('ui/dist/*')).toBe(at('dist/') + 2);
    expect(at('!ui/dist/index.mjs')).toBe(at('dist/') + 3);
  });

  it('does not ignore ui/dist/index.mjs', () => {
    expect(checkIgnore('ui/dist/index.mjs')).toEqual({ ignored: false, pattern: null });
  });

  it('ignores every other file inside ui/dist by the rule ui/dist/*', () => {
    expect(checkIgnore('ui/dist/other.js')).toEqual({ ignored: true, pattern: 'ui/dist/*' });
    expect(checkIgnore('ui/dist/maps/a.map')).toEqual({ ignored: true, pattern: 'ui/dist/*' });
  });

  it('still ignores other dist folders by the rule dist/', () => {
    expect(checkIgnore('ui/other/dist/x.js')).toEqual({ ignored: true, pattern: 'dist/' });
    expect(checkIgnore('dist/x.js')).toEqual({ ignored: true, pattern: 'dist/' });
  });

  it('keeps the other ignore rules', () => {
    expect(checkIgnore('node_modules/x').ignored).toBe(true);
    expect(checkIgnore('ui/node_modules/x').ignored).toBe(true);
    expect(checkIgnore('data/x').ignored).toBe(true);
    expect(checkIgnore('coverage/x').ignored).toBe(true);
  });
});

describe('.gitattributes', () => {
  it('turns line-ending conversion off for the bundle', () => {
    const r = git(['check-attr', 'text', '--', 'ui/dist/index.mjs']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('ui/dist/index.mjs: text: unset');
  });

  it('holds the one line for the bundle', () => {
    const text = readFileSync(`${ROOT}.gitattributes`, 'utf8');
    expect(text.split(/\r?\n/).filter((l) => l.trim() !== '')).toEqual(['ui/dist/index.mjs -text']);
  });
});
