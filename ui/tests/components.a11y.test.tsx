import { describe, expect, it } from 'vitest';
import { STYLE_TEXT } from '../src/components/styles';
import { fixture, ok, renderView, textOf, vmOf } from './helpers/render';

const html = renderView(vmOf(ok(fixture('config.with-findings.json')), ok(fixture('crons.replay-idle.json'))));
const text = textOf(html);

describe('accessibility of the page', () => {
  it('has exactly one main landmark', () => {
    expect((html.match(/<main[\s>]/g) ?? []).length).toBe(1);
  });

  it('has headings in order: one h1, then h2 sections, with h3 only below an h2', () => {
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i += 1) expect((levels[i] as number) - (levels[i - 1] as number)).toBeLessThanOrEqual(1);
    expect(levels).toContain(2);
    expect(levels).toContain(3);
    expect(levels.every((l) => l <= 3)).toBe(true);
  });

  it('gives every section an accessible name that points to a heading that exists', () => {
    const sections = html.match(/<section[^>]*>/g) ?? [];
    expect(sections.length).toBeGreaterThanOrEqual(5);
    for (const tag of sections) {
      const labelledBy = /aria-labelledby="([^"]+)"/.exec(tag)?.[1];
      const label = /aria-label="([^"]+)"/.exec(tag)?.[1];
      expect(Boolean(labelledBy) || Boolean(label), tag).toBe(true);
      if (labelledBy) expect(html).toContain(`id="${labelledBy}"`);
    }
  });

  it('uses a list for the cards and the findings, and a table for the runs', () => {
    expect(html).toContain('<ul class="cards"');
    expect(html).toContain('<ul class="findings"');
    expect(html).toContain('<table');
  });

  it('gives every level card its Colour_Label text', () => {
    const cards = html.match(/<li class="card">[\s\S]*?<\/li>/g) ?? [];
    expect(cards).toHaveLength(5);
    for (const card of cards) expect(textOf(card)).toMatch(/Green: intended solution holds|Amber: wins with a different ink count|Red: no longer wins|Not judged|No result|Unknown colour/);
  });

  it('hides every colour marker from assistive technology and never uses colour alone', () => {
    const markers = html.match(/<span[^>]*class="[^"]*marker[^"]*"[^>]*>/g) ?? [];
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) expect(marker).toContain('aria-hidden="true"');
    const strips = html.match(/<div[^>]*role="img"[^>]*>/g) ?? [];
    expect(strips).toHaveLength(5);
    for (const strip of strips) {
      const name = /aria-label="([^"]+)"/.exec(strip)?.[1] ?? '';
      expect(name).toMatch(/^Last \d+ runs?: /);
      expect(text).toContain(name);
    }
  });

  it('makes every control a button element with a name, and the buttons about a level name it', () => {
    const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.length).toBe(1 + 3 + 3); // Refresh, and three for each of the two findings
    for (const b of buttons) {
      expect(b).toContain('type="button"');
      const name = /aria-label="([^"]+)"/.exec(b)?.[1] ?? textOf(b);
      expect(name.length).toBeGreaterThan(0);
    }
    const copy = buttons.filter((b) => b.includes('aria-label="Copy'));
    expect(copy).toHaveLength(6);
    for (const b of copy) expect(/aria-label="Copy [a-z ]+ for (02-the-chaser|04-the-trap-row)"/.test(b)).toBe(true);
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toMatch(/role="button"/);
  });

  it('has one polite live region', () => {
    expect((html.match(/aria-live="/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-live="polite"');
  });

  it('shows the Refresh button as busy, in text and in aria-busy, while a Read is in flight', () => {
    const busy = renderView(vmOf(ok(fixture('config.with-findings.json'))), { inFlight: true });
    const button = /<button[^>]*aria-busy="true"[^>]*>[^<]*<\/button>/.exec(busy)?.[0] ?? '';
    expect(textOf(button)).toBe('Reading');
    expect(/<button[^>]*aria-busy="false"[^>]*>Refresh<\/button>/.test(html)).toBe(true);
  });

  it('has no suggestion that a colour is the only signal: a warning is always a text', () => {
    const failing = textOf(renderView(vmOf(ok(fixture('config.with-findings.json')), ok(fixture('crons.replay-failing.json')))));
    expect(failing).toContain('Warning: 3 consecutive failures');
  });
});

describe('the style constant', () => {
  it('has a visible focus indicator and honours reduced motion', () => {
    expect(STYLE_TEXT).toContain(':focus-visible');
    expect(STYLE_TEXT).toContain('prefers-reduced-motion');
  });

  it('has no animation and no transition', () => {
    expect(STYLE_TEXT).not.toMatch(/animation|transition|@keyframes/);
  });

  it('sets no text colour: labels use the colour of the host text, and marker colours are a background only', () => {
    expect(STYLE_TEXT).not.toMatch(/(^|[^-a-z])color\s*:/);
    expect(STYLE_TEXT).toContain('.marker-green');
    expect(STYLE_TEXT).toMatch(/\.marker-green\s*\{\s*background:/);
  });

  it('wraps long token lists instead of scrolling the page', () => {
    expect(STYLE_TEXT).toMatch(/\.tokens[^{]*\{[^}]*white-space:\s*pre-wrap/);
    expect(STYLE_TEXT).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('holds no route data and no URL', () => {
    expect(STYLE_TEXT).not.toMatch(/url\(|@import|https?:/);
  });
});