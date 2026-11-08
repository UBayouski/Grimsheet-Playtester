import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));

const ui = read('../package.json');
const root = read('../../package.json');
const all = { ...ui.dependencies, ...ui.devDependencies };

describe('ui/package.json', () => {
  it('does not list @kirocrew/app-sdk, as a dependency or a dev dependency', () => {
    expect(Object.keys(all).filter((name) => name.startsWith('@kirocrew'))).toEqual([]);
  });

  it('has no runtime dependencies', () => {
    expect(ui.dependencies ?? {}).toEqual({});
  });

  it('pins every version exactly', () => {
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('uses the same vitest, fast-check, typescript and @types/node as the root project', () => {
    for (const name of ['vitest', 'fast-check', 'typescript', '@types/node']) {
      expect(all[name], name).toBe(root.devDependencies?.[name]);
    }
  });

  it('pins react and react-dom to one version', () => {
    expect(all['react']).toBeDefined();
    expect(all['react-dom']).toBe(all['react']);
  });
});

describe('TextDecoder in this runtime', () => {
  it('with fatal and ignoreBOM keeps a leading byte order mark', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    expect(decoder.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('\uFEFFA');
  });

  it('with fatal rejects invalid UTF-8', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    expect(() => decoder.decode(new Uint8Array([0xc3, 0x28]))).toThrow();
    expect(() => decoder.decode(new Uint8Array([0xed, 0xa0, 0x80]))).toThrow();
    expect(() => decoder.decode(new Uint8Array([0xc0, 0xaf]))).toThrow();
  });
});