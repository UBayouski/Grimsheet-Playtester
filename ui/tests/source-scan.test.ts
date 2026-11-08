import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const srcFolder = new URL('../src/', import.meta.url);
const testsFolder = new URL('./', import.meta.url);

/** Text patterns that must never appear in a file under src/. */
const FORBIDDEN_SOURCE: Array<[string, RegExp]> = [
  ['a POST, PUT or DELETE call on the API object', /\.(post|put|delete)\(/],
  ['a fetch call', /\bfetch\(/],
  ['an XMLHttpRequest', /XMLHttpRequest/],
  ['a subscription to events', /useAppEvents/],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['a dynamic import', /\bimport\(/],
  ['the SDK ui module', /@kirocrew\/app-sdk\/ui/],
];

/** React exports that exist only in React 19, or that the page must not use. */
const FORBIDDEN_REACT_NAMES = ['use', 'useActionState', 'useOptimistic', 'useFormStatus'];

/** Every module specifier of an import or export-from in the text. */
export function importSpecifiers(text: string): Array<{ specifier: string; typeOnly: boolean; clause: string }> {
  const found: Array<{ specifier: string; typeOnly: boolean; clause: string }> = [];
  const pattern = /^\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const m of text.matchAll(pattern)) {
    if (m[3] !== undefined) found.push({ specifier: m[3], typeOnly: m[1] !== undefined, clause: m[2] ?? '' });
    else if (m[4] !== undefined) found.push({ specifier: m[4], typeOnly: false, clause: '' });
  }
  return found;
}

/** The violations of one file under src/. `path` is relative to src/, with forward slashes. */
export function scanSourceText(path: string, text: string): string[] {
  const problems: string[] = [];
  for (const [what, pattern] of FORBIDDEN_SOURCE) {
    if (pattern.test(text)) problems.push(`${path}: ${what}`);
  }
  for (const { specifier, typeOnly, clause } of importSpecifiers(text)) {
    if (specifier === 'react') {
      const names = clause.replace(/[{}]/g, ' ').split(/[\s,]+/).filter(Boolean);
      for (const name of names) {
        if (FORBIDDEN_REACT_NAMES.includes(name)) problems.push(`${path}: imports ${name} from react`);
      }
    }
    if (path.startsWith('core/')) {
      if (!specifier.startsWith('./')) problems.push(`${path}: core imports ${specifier}`);
    } else if (path.startsWith('controller/')) {
      const ok = specifier.startsWith('./') || specifier.startsWith('../core/') || (specifier === '../sdk' && typeOnly);
      if (!ok) problems.push(`${path}: controller imports ${specifier}`);
    }
    if (specifier === '@kirocrew/app-sdk' && path !== 'index.tsx') problems.push(`${path}: imports the SDK`);
  }
  return problems;
}

/** The violations of one test file. `isArbitraries` is true for tests/arbitraries.ts. */
export function scanTestText(path: string, text: string, isArbitraries: boolean): string[] {
  const problems: string[] = [];
  if (/\bfc\.pre\b/.test(text)) problems.push(`${path}: uses fc.pre`);
  text.split('\n').forEach((line, i) => {
    if (!/\.filter\(/.test(line) || line.includes('// by construction')) return;
    if (isArbitraries || /\bfc\./.test(line)) problems.push(`${path}:${i + 1}: .filter( in an arbitrary without "// by construction"`);
  });
  const direct = (text.match(/\bfc\.assert\(/g) ?? []).length;
  const runs = [...text.matchAll(/numRuns:\s*([A-Za-z_]\w*|\d+)/g)];
  for (const m of runs) {
    const raw = m[1] ?? '';
    let value = Number(raw);
    if (Number.isNaN(value)) {
      const def = new RegExp(`const\\s+${raw}\\s*=\\s*(\\d+)`).exec(text);
      value = def ? Number(def[1]) : 0;
    }
    if (value < 100) problems.push(`${path}: numRuns ${raw} is below 100`);
  }
  if (direct > runs.length) problems.push(`${path}: ${direct} fc.assert calls but ${runs.length} numRuns`);
  return problems;
}

function listFiles(folder: URL, extensions: string[]): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => `${entry.parentPath}/${entry.name}`.replace(/\\/g, '/'));
}

describe('source scan of ui/src', () => {
  const base = decodeURIComponent(srcFolder.pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const files = listFiles(srcFolder, ['.ts', '.tsx']);

  it('finds no violation in any file under src/', () => {
    const problems = files.flatMap((file) => scanSourceText(file.slice(file.indexOf(base) + base.length), readFileSync(file, 'utf8')));
    expect(problems).toEqual([]);
  });
});

describe('the scanning functions', () => {
  it('catch each forbidden pattern', () => {
    const samples: Array<[string, string]> = [
      ['x.ts', 'api.post("/x")'],
      ['x.ts', 'api.put("/x")'],
      ['x.ts', 'api.delete("/x")'],
      ['x.ts', 'await fetch("/x")'],
      ['x.ts', 'new XMLHttpRequest()'],
      ['x.ts', 'useAppEvents("a", f)'],
      ['x.tsx', '<div dangerouslySetInnerHTML={{ __html: s }} />'],
      ['x.ts', 'const m = await import("./x")'],
      ['x.ts', "import { Card } from '@kirocrew/app-sdk/ui';"],
      ['x.tsx', "import { use } from 'react';"],
      ['x.tsx', "import { useState, useActionState } from 'react';"],
      ['x.tsx', "import { useOptimistic } from 'react';"],
      ['x.tsx', "import { useFormStatus } from 'react';"],
      ['core/a.ts', "import { useState } from 'react';"],
      ['core/a.ts', "import { b } from '../sdk';"],
      ['core/a.ts', "import * as sdk from '@kirocrew/app-sdk';"],
      ['controller/a.ts', "import { useRef } from 'react';"],
      ['controller/a.ts', "import { b } from '../components/B';"],
      ['controller/a.ts', "import { pickFunction } from '../sdk';"],
      ['page.tsx', "import * as sdk from '@kirocrew/app-sdk';"],
    ];
    for (const [path, text] of samples) {
      expect(scanSourceText(path, text), `${path}: ${text}`).not.toEqual([]);
    }
  });

  it('accept clean files', () => {
    expect(scanSourceText('core/a.ts', "import { b } from './b';\nexport const x = 1;")).toEqual([]);
    expect(scanSourceText('controller/a.ts', "import { b } from '../core/b';\nimport type { SdkRecord } from '../sdk';\nimport { c } from './c';")).toEqual([]);
    expect(scanSourceText('index.tsx', "import * as sdk from '@kirocrew/app-sdk';\nimport { create } from './page';")).toEqual([]);
    expect(scanSourceText('page.tsx', "import { useMemo, useRef } from 'react';")).toEqual([]);
  });
});

describe('scan of the test files', () => {
  const files = listFiles(testsFolder, ['.test.ts', '.test.tsx', 'arbitraries.ts']).filter((f) => !f.endsWith('/source-scan.test.ts'));

  it('finds no fc.pre, no unmarked filter and no property with fewer than 100 runs', () => {
    const problems = files.flatMap((file) => scanTestText(file, readFileSync(file, 'utf8'), file.endsWith('/arbitraries.ts')));
    expect(problems).toEqual([]);
  });

  it('the scanning function catches each problem', () => {
    expect(scanTestText('t', 'fc.pre(x)', false)).not.toEqual([]);
    expect(scanTestText('t', 'const a = fc.string().filter((s) => s.length > 0);', false)).not.toEqual([]);
    expect(scanTestText('t', 'const a = fc.string().filter((s) => s.length > 0); // by construction', false)).toEqual([]);
    expect(scanTestText('arbitraries.ts', 'const a = list.filter((s) => s);', true)).not.toEqual([]);
    expect(scanTestText('t', 'fc.assert(p, { numRuns: 99 });', false)).not.toEqual([]);
    expect(scanTestText('t', 'fc.assert(p, { numRuns: 100 });', false)).toEqual([]);
    expect(scanTestText('t', 'const N = 50;\nfc.assert(p, { numRuns: N });', false)).not.toEqual([]);
    expect(scanTestText('t', 'const N = 200;\nfc.assert(p, { numRuns: N });', false)).toEqual([]);
    expect(scanTestText('t', 'fc.assert(p);', false)).not.toEqual([]);
  });

  it('no property number is tagged twice, and every tag is for a number from 1 to 15', () => {
    const tags: number[] = [];
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/^\s*\/\/ Feature: dashboard, Property (\d+):/gm)) tags.push(Number(m[1]));
    }
    expect(new Set(tags).size).toBe(tags.length);
    for (const n of tags) expect(n >= 1 && n <= 15).toBe(true);
    if (process.env['DASHBOARD_ALL_PROPERTIES'] === '1') expect([...tags].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
});