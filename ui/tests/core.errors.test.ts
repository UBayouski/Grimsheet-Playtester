import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbJson } from './arbitraries';
import { errorText, TIME_LIMIT_TEXT } from '../src/core/errors';

describe('errorText', () => {
  it('takes the first line of the message of an error-like object', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText({ message: 'line one\nline two' })).toBe('line one');
    expect(errorText({ message: 'line one\r\nline two' })).toBe('line one');
  });

  it('never shows a stack', () => {
    const e = new Error('short');
    e.stack = 'Error: short\n    at secret (C:\\path\\file.js:1:1)';
    expect(errorText(e)).toBe('short');
    expect(errorText({ message: 'm', stack: 'S' })).toBe('m');
  });

  it('gives a fixed phrase for a value without a string message', () => {
    for (const v of [5, null, undefined, 'a string', {}, { message: 5 }, [], true]) expect(errorText(v)).toBe('The request failed');
  });

  it('gives the fixed phrase for an empty message', () => {
    expect(errorText({ message: '' })).toBe('The request failed');
    expect(errorText({ message: '   \nsecond' })).toBe('The request failed');
  });

  it('clips to 200 characters', () => {
    expect(errorText({ message: 'x'.repeat(500) })).toHaveLength(200);
    expect(errorText({ message: 'x'.repeat(200) })).toHaveLength(200);
    expect(errorText({ message: 'x'.repeat(199) })).toHaveLength(199);
  });

  it('redacts a token value and a bearer value', () => {
    expect(errorText({ message: 'GET /x?token=abc123&x=1 failed' })).toBe('GET /x?token=…&x=1 failed');
    expect(errorText({ message: 'denied for Bearer abc.def-1' })).toBe('denied for Bearer …');
    expect(errorText({ message: 'token=a token=b' })).toBe('token=… token=…');
  });

  it('has the fixed phrase for the time limit', () => {
    expect(TIME_LIMIT_TEXT).toBe('The request took longer than 10 seconds');
  });
});
describe('errorText properties', () => {
  const arbPiece = fc.oneof(
    fc.string({ maxLength: 30 }),
    fc.constantFrom('token=', 'TOKEN=', 'Bearer ', 'bearer ', '\n', '\r\n', ' ', '&', '\t', '=', 'token=secret123', 'Bearer abc.def'),
  );
  const arbMessage = fc.array(arbPiece, { maxLength: 40 }).map((pieces) => pieces.join(''));
  const arbThrown = fc.oneof(
    arbJson,
    arbMessage.map((message) => ({ message })),
    arbMessage.map((message) => new Error(message)),
    fc.string({ minLength: 150, maxLength: 400 }).map((message) => ({ message })),
  );

  // Feature: dashboard, Property 15: Bounded text
  it('Property 15: one line, at most 200 characters, no token value and no bearer value', () => {
    fc.assert(
      fc.property(arbThrown, (thrown) => {
        const text = errorText(thrown);
        expect(text).not.toMatch(/[\r\n]/);
        expect(text.length).toBeLessThanOrEqual(200);
        expect(text).not.toMatch(/token=[^\s&…]/i);
        expect(text).not.toMatch(/bearer\s+[^\s…]/i);
        expect(text.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });
});