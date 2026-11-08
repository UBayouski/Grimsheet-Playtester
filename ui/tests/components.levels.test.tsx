import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LevelCard } from '../src/components/LevelCard';
import { RunCounts, TrendStrip } from '../src/components/TrendStrip';
import type { CardColour, LevelCardView, TrendCell, TrendRunView } from '../src/core/types';
import { textOf } from './helpers/render';

const cell = (counter: number, colour: CardColour): TrendCell => ({ runId: `run-${counter}`, counter, colour });

const card = (over: Partial<LevelCardView> = {}): LevelCardView => ({
  levelId: '02-the-chaser',
  colour: 'green',
  label: 'Green: intended solution holds',
  outcome: 'won',
  reasonCode: null,
  timedOut: false,
  ink: { spent: 1, minimal: 1 },
  endHp: null,
  noDetail: false,
  trend: [cell(2, 'green'), cell(1, 'green')],
  trendText: 'Last 2 runs: 2 green',
  ...over,
});

const render = (c: LevelCardView): string => renderToStaticMarkup(<ul><LevelCard card={c} /></ul>);

describe('LevelCard', () => {
  it('shows the level id in an h3 inside a list item', () => {
    const html = render(card());
    expect(/<li[^>]*>[\s\S]*<h3[^>]*>02-the-chaser<\/h3>/.test(html)).toBe(true);
  });

  it.each([
    ['green', 'Green: intended solution holds'],
    ['amber', 'Amber: wins with a different ink count'],
    ['red', 'Red: no longer wins'],
    ['error', 'Not judged'],
    ['none', 'No result'],
  ] as const)('shows the Colour_Label of %s as text', (colour, label) => {
    expect(textOf(render(card({ colour, label })))).toContain(label);
  });

  it('shows the label "Unknown colour" for an unknown stored colour', () => {
    expect(textOf(render(card({ colour: 'error', label: 'Unknown colour', outcome: 'not judged' })))).toContain('Unknown colour');
  });

  it('marks the colour with a decoration that is hidden from assistive technology, and the class depends on the colour only', () => {
    const a = render(card({ colour: 'amber', label: 'Amber: wins with a different ink count', levelId: 'a' }));
    const b = render(card({ colour: 'amber', label: 'Amber: wins with a different ink count', levelId: 'b', endHp: 2, ink: null }));
    const marker = (html: string) => /<span[^>]*class="[^"]*marker marker-amber[^"]*"[^>]*aria-hidden="true"[^>]*>/.exec(html)?.[0];
    expect(marker(a)).toBeDefined();
    expect(marker(a)).toBe(marker(b));
    expect(render(card({ colour: 'red' }))).toContain('marker-red');
    expect(render(card({ colour: 'error' }))).toContain('marker-error');
    expect(render(card({ colour: 'none' }))).toContain('marker-none');
  });

  it('shows the outcome: won, not won, not judged with the reason code', () => {
    expect(textOf(render(card({ colour: 'green', outcome: 'won' })))).toContain('won');
    expect(textOf(render(card({ colour: 'red', label: 'Red: no longer wins', outcome: 'not won' })))).toContain('not won');
    const error = textOf(render(card({ colour: 'error', label: 'Not judged', outcome: 'not judged', reasonCode: 'replay_mismatch' })));
    expect(error).toContain('not judged');
    expect(error).toContain('replay_mismatch');
  });

  it('shows "play timed out" when the play timed out, and not otherwise', () => {
    expect(textOf(render(card({ timedOut: true })))).toContain('play timed out');
    expect(textOf(render(card()))).not.toContain('play timed out');
  });

  it('shows the ink, or "ink not recorded"', () => {
    expect(textOf(render(card({ ink: { spent: 2, minimal: 1 } })))).toContain('ink spent 2 of minimal 1');
    expect(textOf(render(card({ ink: { spent: 0, minimal: 0 } })))).toContain('ink spent 0 of minimal 0');
    expect(textOf(render(card({ ink: null })))).toContain('ink not recorded');
  });

  it('shows the end HP when it is present, and omits it when it is not', () => {
    expect(textOf(render(card({ endHp: 3 })))).toContain('end HP 3');
    expect(textOf(render(card({ endHp: 0 })))).toContain('end HP 0');
    expect(textOf(render(card({ endHp: null })))).not.toContain('end HP');
  });

  it('shows "no detail in the last run" for a card that is only in the newest trend entry', () => {
    expect(textOf(render(card({ noDetail: true })))).toContain('no detail in the last run');
    expect(textOf(render(card()))).not.toContain('no detail');
  });

  it('shows a level id as text, not markup', () => {
    const html = render(card({ levelId: '<b>x</b>' }));
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('holds the trend strip with its text', () => {
    const html = render(card({ trend: [cell(3, 'amber'), cell(2, 'green')], trendText: 'Last 2 runs: 1 green, 1 amber' }));
    expect(html).toContain('role="img"');
    expect(textOf(html)).toContain('Last 2 runs: 1 green, 1 amber');
  });
});

describe('TrendStrip', () => {
  const strip = (cells: TrendCell[], text: string): string => renderToStaticMarkup(<TrendStrip cells={cells} text={text} />);

  it('is an image with an accessible name equal to the text equivalent, and the same text is visible', () => {
    const html = strip([cell(2, 'amber'), cell(1, 'green')], 'Last 2 runs: 1 green, 1 amber');
    expect(/role="img"[^>]*aria-label="Last 2 runs: 1 green, 1 amber"|aria-label="Last 2 runs: 1 green, 1 amber"[^>]*role="img"/.test(html)).toBe(true);
    expect(textOf(html)).toContain('Last 2 runs: 1 green, 1 amber');
  });

  it('hides each cell from assistive technology', () => {
    const html = strip([cell(3, 'red'), cell(2, 'none'), cell(1, 'green')], 'x');
    const cells = html.match(/<span[^>]*class="[^"]*cell[^"]*"[^>]*>/g) ?? [];
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(c).toContain('aria-hidden="true"');
  });

  it('draws the oldest run on the left and says "oldest to newest"', () => {
    const html = strip([cell(3, 'amber'), cell(2, 'red'), cell(1, 'green')], 'x');
    const order = [...html.matchAll(/marker-(green|amber|red|error|none)/g)].map((m) => m[1]);
    expect(order).toEqual(['green', 'red', 'amber']);
    expect(textOf(html)).toContain('oldest to newest');
  });

  it('a cell without a result has the class of the colour none', () => {
    expect(strip([cell(1, 'none')], 'x')).toContain('marker-none');
  });

  it('shows the text when there are no cells', () => {
    expect(textOf(strip([], 'No runs recorded'))).toContain('No runs recorded');
  });
});

describe('RunCounts', () => {
  const run = (counter: number, counts: TrendRunView['counts']): TrendRunView => ({ runId: `run-${counter}`, counter, state: 'complete', startedAt: '2026-11-08 01:26 UTC', commitShort: '6372d9a', counts });
  const table = (runs: TrendRunView[]): string => renderToStaticMarkup(<RunCounts runs={runs} />);

  it('is a table with a caption and one row per run, newest first, with the four counts as text', () => {
    const html = table([run(2, { green: 5, amber: 0, red: 0, error: 0 }), run(1, { green: 3, amber: 1, red: 1, error: 0 })]);
    expect(html).toContain('<table');
    expect(html).toContain('<caption');
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(3); // the header row and two runs
    expect(textOf(rows[1] ?? '')).toContain('run-000002'.replace('000002', '2'));
    expect(textOf(rows[1] ?? '')).toContain('5');
    expect(textOf(rows[2] ?? '')).toContain('run-1');
    expect(textOf(html)).toContain('6372d9a');
  });

  it('shows "unknown" for a count that is null', () => {
    const html = table([run(1, { green: null, amber: 2, red: null, error: 0 })]);
    expect((textOf(html).match(/unknown/g) ?? []).length).toBe(2);
  });

  it('names the columns in text', () => {
    const text = textOf(table([run(1, { green: 1, amber: 0, red: 0, error: 0 })]));
    for (const name of ['Run', 'Started', 'Commit', 'Green', 'Amber', 'Red', 'Not judged']) expect(text).toContain(name);
  });
});