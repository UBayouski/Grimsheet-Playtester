import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyButton } from '../src/components/CopyButton';
import { FindingItem } from '../src/components/FindingItem';
import { FindingsList } from '../src/components/FindingsList';
import { parseFindings } from '../src/core/findings';
import type { FindingView, FindingsView } from '../src/core/types';
import { fixture, textOf } from './helpers/render';

const view = (name = 'config.with-findings.json'): FindingsView => parseFindings(fixture(name).playtesterResults.findings);
const idle = { kind: 'idle', seq: 0 } as const;
const LATEST = '6372d9a27ae81a6ab75e9f8ae45d1d70ccebe50b';

const list = (findings: FindingsView, over: Partial<{ latestCommit: string | null; copyState: Parameters<typeof FindingsList>[0]['copyState'] }> = {}): string =>
  renderToStaticMarkup(<FindingsList findings={findings} latestCommit={over.latestCommit ?? LATEST} copyState={over.copyState ?? idle} onCopy={() => {}} />);
const item = (finding: FindingView, latestCommit: string | null = LATEST): string =>
  renderToStaticMarkup(<ul><FindingItem item={finding} latestCommit={latestCommit} onCopy={() => {}} /></ul>);

const byId = (findings: FindingsView, suffix: string): FindingView => findings.items.find((i) => i.id.endsWith(suffix)) as FindingView;
const buttons = (html: string): string[] => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];

describe('FindingsList', () => {
  it('has the sentence about the findings, in a section with a heading', () => {
    const html = list(view());
    expect(textOf(html)).toContain('Every finding was reproduced by replaying its action list. The hunt is a bounded search, not a proof that no cheaper win exists.');
    expect(html).toContain('<section');
    expect(/<h2[^>]*>Findings<\/h2>/.test(html)).toBe(true);
  });

  it('shows "No hunt has run yet" when there is no findings value', () => {
    expect(textOf(list(parseFindings(undefined)))).toContain('No hunt has run yet');
  });

  it('shows the hunt header: time, short commit, hunt id and the six counts', () => {
    const text = textOf(list(view()));
    expect(text).toContain('2026-11-08 11:14 UTC');
    expect(text).toContain('e1c61a3');
    expect(text).toContain('hunt-20261108T110312Z');
    for (const part of ['attempts: 7', 'confirmed: 2', 'rejected: 4', 'error: 0', 'duplicate: 1', 'notRecorded: 0']) expect(text).toContain(part);
  });

  it('shows "unknown" for a count that is null', () => {
    const findings = parseFindings({ schemaVersion: 1, updatedAt: '2026-11-08T11:14:02Z', counts: { attempts: 'x' }, items: [] });
    const text = textOf(list(findings));
    expect(text).toContain('attempts: unknown');
    expect(text).toContain('The last hunt found no exploits');
  });

  it('shows the dropped count and the schema notice', () => {
    const findings = parseFindings({ schemaVersion: 2, updatedAt: '2026-11-08T11:14:02Z', items: [5, null] });
    const text = textOf(list(findings));
    expect(text).toContain('2 findings could not be read');
    expect(text).toContain('different schema version (found: 2)');
  });

  it('lists the findings newest first', () => {
    const html = list(view());
    // the ids are only keys and are not shown; the second finding (-012, level 04) was found after the first (-007, level 02)
    expect(html.indexOf('04-the-trap-row')).toBeGreaterThan(-1);
    expect(html.indexOf('04-the-trap-row')).toBeLessThan(html.indexOf('02-the-chaser'));
  });

  it('shows the fallback view: a read-only text area with the text and the message', () => {
    const html = list(view(), { copyState: { kind: 'fallback', seq: 1, text: 'node scripts/play.mjs 02-the-chaser --actions-file <actions-file>' } });
    const area = /<textarea[^>]*>[\s\S]*?<\/textarea>/.exec(html)?.[0] ?? '';
    expect(area).toContain('readonly');
    expect(area).toContain('node scripts/play.mjs 02-the-chaser --actions-file &lt;actions-file&gt;');
    expect(textOf(html)).toContain('Copy is not available here. Select the text and press Ctrl+C.');
  });

  it('shows no text area when the copy state is idle or copied', () => {
    expect(list(view())).not.toContain('<textarea');
    expect(list(view(), { copyState: { kind: 'copied', seq: 1 } })).not.toContain('<textarea');
  });
});

describe('FindingItem', () => {
  const findings = view();
  const first = byId(findings, '-007');
  const second = byId(findings, '-012');

  it('shows the level id, the class label, the short commit, the time and the result', () => {
    const html = item(first);
    const text = textOf(html);
    expect(/<h3[^>]*>[^<]*02-the-chaser[^<]*Cheaper win[^<]*<\/h3>/.test(html)).toBe(true);
    expect(text).toContain('e1c61a3');
    expect(text).toContain('2026-11-08 11:14 UTC');
    expect(text).toContain('ink spent 0 of minimal 1');
    expect(text).toContain('edit count 0');
    const edited = textOf(item(second));
    expect(edited).toContain('ink spent 1 of minimal 1');
    expect(edited).toContain('edit count 1');
    expect(edited).toContain('new edit cells B14');
  });

  it('shows the tokens separated by single spaces in a monospace code element', () => {
    const html = item(first);
    expect(/<code[^>]*>E E E E N N E E E E E S S<\/code>/.test(html)).toBe(true);
  });

  it('labels a finding of an earlier commit, and only then', () => {
    expect(textOf(item(first))).toContain('found on an earlier commit');
    expect(textOf(item(second))).not.toContain('found on an earlier commit');
    expect(textOf(item(first, null))).not.toContain('found on an earlier commit');
    expect(textOf(item(first, first.commit)).includes('found on an earlier commit')).toBe(false);
  });

  it('shows an unknown class as the stored string', () => {
    const unknown = parseFindings({ schemaVersion: 1, items: [{ ...fixture('config.with-findings.json').playtesterResults.findings.items[0], class: 'new_class' }] }).items[0] as FindingView;
    expect(textOf(item(unknown))).toContain('new_class');
  });

  it('shows the replay command and the help text for a valid level id', () => {
    const text = textOf(item(first));
    expect(text).toContain('node scripts/play.mjs 02-the-chaser --actions-file <actions-file>');
    expect(text).toContain('Run it in a Grimsheet checkout after npm ci and npm run build:play (play.mjs stops with "Run npm run build:play first" without the bundle), with the path of a file that holds the Actions_File_Text.');
  });

  it('shows "level id not valid" and no command for an invalid level id', () => {
    const bad = { ...first, levelId: '../x', replayCommand: null };
    const text = textOf(item(bad));
    expect(text).toContain('level id not valid');
    expect(text).not.toContain('node scripts/play.mjs');
    expect(buttons(item(bad))).toHaveLength(2); // the action list and the actions file; no command button
  });

  it('shows the actions file text in a read-only block when every token decodes', () => {
    const html = item(first);
    const block = /<pre[^>]*>[\s\S]*?<\/pre>/.exec(html)?.[0] ?? '';
    expect(block).toContain('&quot;kind&quot;: &quot;move&quot;');
    expect(block).toContain('&quot;dir&quot;: &quot;E&quot;');
  });

  it('has three copy buttons for a decodable finding, each a button element with an accessible name that includes the level id', () => {
    const found = buttons(item(first));
    expect(found).toHaveLength(3);
    expect(found.join('')).toContain('aria-label="Copy action list for 02-the-chaser"');
    expect(found.join('')).toContain('aria-label="Copy replay command for 02-the-chaser"');
    expect(found.join('')).toContain('aria-label="Copy actions file for 02-the-chaser"');
    for (const b of found) expect(b).toContain('type="button"');
  });

  it('for a finding that does not decode shows the message, the tokens and two copy buttons, and no file text', () => {
    const bad = { ...first, actionsFileText: null };
    const html = item(bad);
    expect(textOf(html)).toContain('action list could not be converted to a file');
    expect(html).not.toContain('<pre');
    expect(textOf(html)).toContain('E E E E N N E E E E E S S');
    const found = buttons(html);
    expect(found).toHaveLength(2);
    expect(found.join('')).toContain('Copy action list for 02-the-chaser');
    expect(found.join('')).toContain('Copy replay command for 02-the-chaser');
  });

  it('does not suggest passing JSON inline', () => {
    const text = textOf(item(first));
    expect(text).not.toMatch(/inline/i);
    expect(text).not.toContain("--actions '");
    expect(text).not.toContain('--actions "');
  });

  it('shows route text as text, not markup', () => {
    const hostile = { ...first, levelId: '<img src=x>', classLabel: '<script>1</script>', tokensText: '<b>', tokens: ['<b>'], replayCommand: null, actionsFileText: null };
    const html = item(hostile);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
  });
});

describe('CopyButton', () => {
  it('is a button element with the visible text and an accessible name that includes the level id', () => {
    const html = renderToStaticMarkup(<CopyButton label="Copy action list for 02-the-chaser" text="E N" onCopy={() => {}} />);
    expect(html.startsWith('<button')).toBe(true);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Copy action list for 02-the-chaser"');
    expect(textOf(html)).toBe('Copy action list');
  });
});