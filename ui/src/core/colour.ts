// The colour of a level and its label. A colour is stored data; it is never computed here.
import { UNKNOWN_COLOUR } from './text';

export const COLOURS = ['green', 'amber', 'red', 'error'] as const;
export type Colour = (typeof COLOURS)[number];
export type CardColour = Colour | 'none';

/** One of the four known colour strings, or `error` for any other string. */
export function normaliseColour(value: string): Colour {
  return (COLOURS as readonly string[]).includes(value) ? (value as Colour) : 'error';
}

/** The Colour_Label text of the Glossary. */
export function colourLabel(colour: CardColour): string {
  switch (colour) {
    case 'green':
      return 'Green: intended solution holds';
    case 'amber':
      return 'Amber: wins with a different ink count';
    case 'red':
      return 'Red: no longer wins';
    case 'error':
      return 'Not judged';
    case 'none':
      return 'No result';
  }
}

/** The label of a card: the Colour_Label of a known stored colour, or "Unknown colour" for any other string. */
export function cardLabel(storedColour: string): string {
  return (COLOURS as readonly string[]).includes(storedColour) ? colourLabel(storedColour as Colour) : UNKNOWN_COLOUR;
}

/** The marker class: a function of the colour only. */
export function markerClass(colour: CardColour): string {
  return `marker-${colour}`;
}