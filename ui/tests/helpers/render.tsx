import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { DashboardView } from '../../src/components/DashboardView';
import type { RouteState, ViewModel } from '../../src/core/types';
import { buildViewModel } from '../../src/core/viewmodel';

export const READ_AT = Date.UTC(2026, 10, 8, 2, 0, 0);
export const FINISHED = Date.UTC(2026, 10, 8, 1, 27, 0, 391);
export const HOUR = 3600 * 1000;

export const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export const pending = (): RouteState => ({ status: 'pending', hasGood: false, good: undefined, goodAtMs: null, error: null });
export const ok = (value: unknown, at: number | null = READ_AT): RouteState => ({ status: 'ok', hasGood: true, good: value, goodAtMs: at, error: null });
export const failed = (error: string, good?: { value: unknown; at: number }): RouteState =>
  good === undefined ? { status: 'failed', hasGood: false, good: undefined, goodAtMs: null, error } : { status: 'failed', hasGood: true, good: good.value, goodAtMs: good.at, error };

export function vmOf(config: RouteState, crons: RouteState = ok(fixture('crons.replay-idle.json')), nowMs: unknown = FINISHED + HOUR): ViewModel {
  return buildViewModel({ config, crons, nowMs });
}

type ViewProps = ComponentProps<typeof DashboardView>;

/** Renders the page for a View_Model with no-op handlers; `over` replaces any prop. */
export function renderView(vm: ViewModel, over: Partial<ViewProps> = {}): string {
  return renderToStaticMarkup(
    <DashboardView
      vm={vm}
      inFlight={false}
      apiMissing={false}
      appNameNotice={null}
      liveMessage=""
      copyState={{ kind: 'idle', seq: 0 }}
      onRefresh={() => {}}
      onCopy={() => {}}
      {...over}
    />,
  );
}

/** The text of some markup: tags removed, entities decoded, spaces collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}