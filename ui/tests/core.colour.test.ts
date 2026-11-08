import { describe, expect, it } from 'vitest';
import { COLOURS, colourLabel, markerClass, normaliseColour } from '../src/core/colour';

describe('colour', () => {
  it('has the four colours in order', () => {
    expect([...COLOURS]).toEqual(['green', 'amber', 'red', 'error']);
  });

  it('colourLabel gives the exact text of the Glossary for each card colour', () => {
    expect(colourLabel('green')).toBe('Green: intended solution holds');
    expect(colourLabel('amber')).toBe('Amber: wins with a different ink count');
    expect(colourLabel('red')).toBe('Red: no longer wins');
    expect(colourLabel('error')).toBe('Not judged');
    expect(colourLabel('none')).toBe('No result');
  });

  it('normaliseColour keeps the four known strings and turns anything else into error', () => {
    for (const c of ['green', 'amber', 'red', 'error']) expect(normaliseColour(c)).toBe(c);
    for (const c of ['purple', '', 'GREEN', ' green', 'none', 'Green']) expect(normaliseColour(c), c).toBe('error');
  });

  it('markerClass is a different class for each of the five colours, and the same for the same colour', () => {
    const colours = ['green', 'amber', 'red', 'error', 'none'] as const;
    const classes = colours.map(markerClass);
    expect(new Set(classes).size).toBe(5);
    expect(classes).toEqual(['marker-green', 'marker-amber', 'marker-red', 'marker-error', 'marker-none']);
    expect(markerClass('green')).toBe(markerClass('green'));
  });
});