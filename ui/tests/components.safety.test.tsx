import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbConfigValue, arbCronsValue, arbHostile, prefixStrings } from './arbitraries';
import { ok, renderView, vmOf } from './helpers/render';

const ALLOWED_TAGS = new Set(['style', 'main', 'h1', 'h2', 'h3', 'div', 'button', 'span', 'p', 'section', 'ul', 'li', 'code', 'pre', 'strong', 'time', 'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td', 'textarea']);
const MARKER = 'ZZSCRIPTMARKERZZ';

describe('text, not markup', () => {
  // Feature: dashboard, Property 14: Text, not markup
  it('Property 14: hostile strings in the route values appear only as escaped text, and a job script never appears', () => {
    fc.assert(
      fc.property(arbConfigValue, arbCronsValue, arbHostile, fc.boolean(), (config, crons, hostile, withScript) => {
        const hostileConfig = prefixStrings(config, hostile);
        const cronsValue = crons !== null && typeof crons === 'object' && !Array.isArray(crons) && Array.isArray((crons as { jobs?: unknown }).jobs)
          ? { ...(crons as object), jobs: ((crons as { jobs: unknown[] }).jobs).map((job) => ({ ...(job as object), script: `${hostile}${MARKER}/replay_cron.py`, name: 'replay' })) }
          : crons;
        const vm = vmOf(ok(hostileConfig), ok(withScript ? cronsValue : crons), Date.UTC(2026, 10, 9));
        const html = renderView(vm, { copyState: { kind: 'fallback', seq: 1, text: `${hostile}text` } });

        // no element that the page did not put there, and the page's own style element exactly once
        const tags = [...html.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)/g)].map((m) => (m[1] as string).toLowerCase());
        for (const tag of tags) expect(ALLOWED_TAGS.has(tag), `<${tag}> in the page`).toBe(true);
        expect((html.match(/<style/g) ?? []).length).toBe(1);
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<a ');
        expect(html).not.toContain('<svg');
        // no link, source or event handler built from route data: look at the attribute names of every tag
        // (quoted values are removed first, so text such as "onmouseover=" inside a value or in the page text is not mistaken for an attribute)
        for (const tag of html.match(/<[A-Za-z][^>]*>/g) ?? []) {
          const names = [...tag.replace(/="[^"]*"/g, '').matchAll(/\s([A-Za-z][A-Za-z0-9:-]*)/g)].map((m) => (m[1] as string).toLowerCase());
          for (const name of names) {
            expect(['href', 'src', 'srcdoc', 'formaction', 'style'].includes(name), `${name} in ${tag.slice(0, 60)}`).toBe(false);
            expect(name.startsWith('on'), `${name} in ${tag.slice(0, 60)}`).toBe(false);
          }
        }
        // the script field of a job is in neither the page nor the View_Model
        expect(html).not.toContain(MARKER);
        expect(JSON.stringify(vm)).not.toContain(MARKER);
        expect(html).not.toContain('replay_cron');
      }),
      { numRuns: 200 },
    );
  });

  it('a hostile string that is shown appears in its escaped form', () => {
    const config = { playtesterResults: { latest: { runId: 'r', state: 'failed', startedAt: '2026-11-08T01:00:00Z', failure: { stage: '<script>1</script>', reasonCode: 'x"y', message: "a & b <c> 'd'" }, levels: [] } } };
    const html = renderView(vmOf(ok(config)));
    expect(html).toContain('&lt;script&gt;1&lt;/script&gt;');
    expect(html).toContain('x&quot;y');
    expect(html).toContain('a &amp; b &lt;c&gt; &#x27;d&#x27;');
  });
});