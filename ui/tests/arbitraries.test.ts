import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbCodePointString, arbJson, arbNow, changedPaths, corrupt, pathsOf, RISKY_KEYS } from './arbitraries';

describe('arbitraries', () => {
  it('arbJson output survives a JSON round trip', () => {
    fc.assert(
      fc.property(arbJson, (value) => {
        // toStrictEqual is not used: it compares .constructor === b.constructor, which is false for two objects that both have an own key named constructor.
        const text = JSON.stringify(value);
        expect(JSON.parse(text)).toEqual(value);
        expect(JSON.stringify(JSON.parse(text))).toBe(text);
      }),
      { numRuns: 200 },
    );
  });

  it('arbJson sometimes produces objects with risky own keys, arrays and nulls', () => {
    const seen = { risky: false, array: false, nul: false, object: false };
    fc.assert(
      fc.property(arbJson, (value) => {
        if (Array.isArray(value)) seen.array = true;
        else if (value === null) seen.nul = true;
        else if (typeof value === 'object') {
          seen.object = true;
          if (Object.keys(value).some((key) => RISKY_KEYS.includes(key))) seen.risky = true;
        }
      }),
      { numRuns: 1000 },
    );
    expect(seen).toEqual({ risky: true, array: true, nul: true, object: true });
  });

  it('corrupt with a scalar replacement changes exactly one place, and leaves the input unchanged', () => {
    const valid = { a: 1, b: [1, 2, { c: 'x', d: null }], e: { f: true, g: 'y' } };
    const before = structuredClone(valid);
    fc.assert(
      fc.property(corrupt(valid, fc.constant('REPLACED')), (changed) => {
        expect(valid).toStrictEqual(before);
        expect(changedPaths(valid, changed).length).toBe(1);
      }),
      { numRuns: 300 },
    );
  });

  it('corrupt with any replacement changes only the subtree below one path of the valid value', () => {
    const valid = { a: 1, b: [1, 2, { c: 'x', d: null }], e: { f: true, g: 'y' } };
    const known = pathsOf(valid).map((p) => p.join('\u0000'));
    fc.assert(
      fc.property(corrupt(valid), (changed) => {
        const changes = changedPaths(valid, changed);
        if (changes.length === 0) return;
        const covered = known.some((prefix) => changes.every((path) => path.join('\u0000').startsWith(prefix)));
        expect(covered).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
  it('corrupt reaches every place of a small value', () => {
    const valid = { a: 1, b: [1, 2] };
    const seen = new Set<string>();
    fc.assert(
      fc.property(corrupt(valid, fc.constant('REPLACED')), (changed) => {
        for (const path of changedPaths(valid, changed)) seen.add(path.join('.'));
      }),
      { numRuns: 300 },
    );
    expect([...seen].sort()).toEqual(['a', 'b', 'b.0', 'b.1']);
  });

  it('corrupt of a scalar gives a value from the replacement arbitrary', () => {
    fc.assert(
      fc.property(corrupt(5, fc.constant('X')), (changed) => {
        expect(changed).toBe('X');
      }),
      { numRuns: 100 },
    );
  });

  it('arbCodePointString never holds a lone surrogate and stays within the byte limit', () => {
    fc.assert(
      fc.property(arbCodePointString(40), (s) => {
        expect(() => encodeURIComponent(s)).not.toThrow(); // throws on a lone surrogate
        expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(40);
        expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(s))).toBe(s);
      }),
      { numRuns: 300 },
    );
  });

  it('arbNow gives finite numbers and other values', () => {
    let finite = 0;
    let other = 0;
    fc.assert(
      fc.property(arbNow, (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) finite += 1;
        else other += 1;
      }),
      { numRuns: 500 },
    );
    expect(finite).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(0);
  });
});