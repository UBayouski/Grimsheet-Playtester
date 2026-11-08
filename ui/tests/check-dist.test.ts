import { describe, expect, it } from 'vitest';
import { ALLOWED_IMPORTS, checkDistFiles, checkDistText } from '../scripts/check-dist.mjs';

const clean = [
  'import{jsx as e,jsxs as t}from"react/jsx-runtime";',
  'import{useRef as n,useState as r}from"react";',
  'import*as o from"@kirocrew/app-sdk";',
  'const a=1;export{a as default};',
].join('\n');

describe('ALLOWED_IMPORTS', () => {
  it('are the five externals of the build', () => {
    expect([...ALLOWED_IMPORTS].sort()).toEqual(['@kirocrew/app-sdk', 'lucide-react', 'react', 'react-dom', 'react/jsx-runtime']);
  });
});

describe('checkDistText', () => {
  it('passes a clean module that imports only the allowed specifiers and the SDK as a namespace', () => {
    expect(checkDistText(clean)).toEqual([]);
  });

  it('passes the same imports written with spaces and single quotes', () => {
    const spaced = ["import { jsx } from 'react/jsx-runtime';", "import * as sdk from '@kirocrew/app-sdk';", "import { useMemo } from 'react';"].join('\n');
    expect(checkDistText(spaced)).toEqual([]);
  });

  it('passes a module with no import at all', () => {
    expect(checkDistText('export default function(){}')).toEqual([]);
  });

  it.each([
    ['an import from @kirocrew/app-sdk/ui', 'import{Card as e}from"@kirocrew/app-sdk/ui";'],
    ['an import from react-dom/client', 'import{createRoot as e}from"react-dom/client";'],
    ['an import from a relative file', 'import{x as e}from"./other.js";'],
    ['an import from a package that is not an external', 'import{x as e}from"lodash";'],
    ['a bare import', 'import"./side-effect.js";'],
    ['an export from another module', 'export{x}from"./other.js";'],
    ['a dynamic import', 'const m=await import("./chunk.js");'],
    ['a named SDK import', 'import{useAppApi as e}from"@kirocrew/app-sdk";'],
    ['a default SDK import', 'import sdk from"@kirocrew/app-sdk";'],
    ['a default and named SDK import', 'import sdk,{x}from"@kirocrew/app-sdk";'],
    ['the text @kirocrew/app-sdk/ui', 'const s="@kirocrew/app-sdk/ui";'],
    ['a drive-letter path with a user', 'const p="C:\\\\Users\\\\someone\\\\x";'],
    ['a drive-letter path', 'const p="D:\\\\work";'],
    ['a Users folder', 'const p="Users\\\\someone";'],
    ['a token value in a URL', 'const u="/x?token=ab12cd34ef";'],
    ['a token value in upper case', 'const u="TOKEN=abcdef";'],
    ['a token value with the characters of a JWT or a hex id', 'const u="x?Token=eyJhbGciOi.Jx_-~%41";'],
    ['a localhost URL', 'const u="http://localhost:5476/x";'],
    ['an https URL', 'const u="https://example.com/x";'],
  ])('fails for %s', (_name, extra) => {
    const problems = checkDistText(`${clean}\n${extra}`);
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) expect(typeof problem).toBe('string');
  });

  it('names the problem in the message', () => {
    expect(checkDistText('import{x}from"./a.js";').join(' ')).toContain('./a.js');
    expect(checkDistText('import{x}from"@kirocrew/app-sdk";').join(' ')).toMatch(/namespace/i);
    expect(checkDistText('const p="C:\\\\Users\\\\x";').join(' ')).toMatch(/path/i);
    expect(checkDistText('const u="?token=ab12cd34ef";').join(' ')).toContain('contains a token value');
  });

  it('does not fail on code that mentions token=: the source of a redaction pattern and the text it writes', () => {
    expect(checkDistText(`${clean}\nconst r=/token=[^\\s&]*/gi;`)).toEqual([]);
    expect(checkDistText(`${clean}\nconst r=/(token)[=][^\\s&]*/gi;`)).toEqual([]);
    expect(checkDistText(`${clean}\nconst out="token=…";`)).toEqual([]);
    expect(checkDistText(`${clean}\n.replace(/token=[^\\s&]*/gi,"token=…")`)).toEqual([]);
  });

  it('does not fail on token= with fewer than 6 value characters, and does not take a short value for a token', () => {
    expect(checkDistText(`${clean}\nconst a="token=abc";`)).toEqual([]);
    expect(checkDistText(`${clean}\nconst a="token=12345";`)).toEqual([]);
    expect(checkDistText(`${clean}\nconst a="token=123456";`)).not.toEqual([]);
  });

  it('does not fail on the word token, or on an equals sign alone', () => {
    expect(checkDistText(`${clean}\nconst label="token";const tokens=[1];const a=b==c;`)).toEqual([]);
  });
});

describe('checkDistFiles', () => {
  it('passes only index.mjs', () => {
    expect(checkDistFiles(['index.mjs'])).toEqual([]);
  });

  it('fails for an empty list, a missing index.mjs, and any extra file', () => {
    expect(checkDistFiles([]).length).toBeGreaterThan(0);
    expect(checkDistFiles(['other.mjs']).length).toBeGreaterThan(0);
    expect(checkDistFiles(['index.mjs', 'index.css']).join(' ')).toContain('index.css');
    expect(checkDistFiles(['index.mjs', 'index.mjs.map']).length).toBeGreaterThan(0);
  });
});