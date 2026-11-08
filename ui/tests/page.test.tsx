import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDashboardPage } from '../src/page';
import { pickFunction } from '../src/sdk';
import { textOf } from './helpers/render';

const recordingApi = () => {
  const calls: string[] = [];
  return { calls, api: { get: async (path: string) => (calls.push(path), {}) } };
};

describe('pickFunction', () => {
  it('returns a function export, and null for a missing export, a value that is not a function, and a missing record', () => {
    const fn = () => 1;
    expect(pickFunction({ a: fn }, 'a')).toBe(fn);
    expect(pickFunction({ a: fn }, 'b')).toBeNull();
    expect(pickFunction({ a: 5 }, 'a')).toBeNull();
    expect(pickFunction({ a: {} }, 'a')).toBeNull();
    expect(pickFunction({ a: null }, 'a')).toBeNull();
    expect(pickFunction(null, 'a')).toBeNull();
    expect(pickFunction(undefined, 'a')).toBeNull();
  });

  it('does not read the prototype chain of the record', () => {
    expect(pickFunction(Object.create({ useAppApi: () => 1 }) as Record<string, unknown>, 'useAppApi')).toBeNull();
  });
});

describe('createDashboardPage', () => {
  it('reads useAppApi and useAppInfo once, when it is called, and never again', () => {
    const reads: string[] = [];
    const sdk = new Proxy({ useAppApi: () => recordingApi().api, useAppInfo: () => ({ name: 'grimsheet-playtester' }) } as Record<string, unknown>, {
      get(target, key) {
        reads.push(String(key));
        return target[key as string];
      },
      getOwnPropertyDescriptor(target, key) {
        reads.push(String(key));
        return Object.getOwnPropertyDescriptor(target, key);
      },
    });
    const Page = createDashboardPage(sdk);
    const afterCreate = reads.length;
    expect(reads.filter((k) => k === 'useAppApi').length).toBeGreaterThanOrEqual(1);
    expect(reads.filter((k) => k === 'useAppInfo').length).toBeGreaterThanOrEqual(1);
    renderToStaticMarkup(<Page />);
    renderToStaticMarkup(<Page />);
    expect(reads.length).toBe(afterCreate);
  });

  it('renders with a fake SDK, shows "Reading results" first, and makes no request while rendering', () => {
    const { api, calls } = recordingApi();
    const Page = createDashboardPage({ useAppApi: () => api, useAppInfo: () => ({ name: 'grimsheet-playtester' }) });
    const html = renderToStaticMarkup(<Page />);
    expect(textOf(html)).toContain('Reading results');
    expect(html).toContain('<main');
    expect(calls).toEqual([]);
    expect(textOf(html)).not.toContain('Kiro Crew did not provide the app API');
    expect(/<button[^>]*>\s*Refresh\s*<\/button>/.exec(html)?.[0]).not.toContain('disabled');
  });

  it('with useAppApi missing, shows the message and disables the Refresh button', () => {
    const Page = createDashboardPage({});
    const html = renderToStaticMarkup(<Page />);
    expect(textOf(html)).toContain('Kiro Crew did not provide the app API');
    expect(/<button[^>]*>\s*Refresh\s*<\/button>/.exec(html)?.[0]).toContain('disabled');
  });

  it('with useAppApi not a function, shows the same', () => {
    const Page = createDashboardPage({ useAppApi: 'nope' });
    expect(textOf(renderToStaticMarkup(<Page />))).toContain('Kiro Crew did not provide the app API');
  });

  it('with useAppApi throwing, shows the message and does not crash', () => {
    const Page = createDashboardPage({
      useAppApi: () => {
        throw new Error('no provider');
      },
    });
    const html = renderToStaticMarkup(<Page />);
    expect(textOf(html)).toContain('Kiro Crew did not provide the app API');
    expect(/<button[^>]*>\s*Refresh\s*<\/button>/.exec(html)?.[0]).toContain('disabled');
  });

  it('with useAppApi returning something without a get method, shows the same', () => {
    const Page = createDashboardPage({ useAppApi: () => ({ post: () => 1 }) });
    expect(textOf(renderToStaticMarkup(<Page />))).toContain('Kiro Crew did not provide the app API');
  });

  it('with useAppInfo returning another name, shows a notice with both names', () => {
    const Page = createDashboardPage({ useAppApi: () => recordingApi().api, useAppInfo: () => ({ name: 'other-app' }) });
    const text = textOf(renderToStaticMarkup(<Page />));
    expect(text).toContain('grimsheet-playtester');
    expect(text).toContain('other-app');
  });

  it('with useAppInfo returning the same name, missing, throwing or odd, shows no notice and does not crash', () => {
    const cases: Array<Record<string, unknown>> = [
      { useAppInfo: () => ({ name: 'grimsheet-playtester' }) },
      {},
      {
        useAppInfo: () => {
          throw new Error('x');
        },
      },
      { useAppInfo: () => null },
      { useAppInfo: () => ({ name: 5 }) },
      { useAppInfo: 'nope' },
    ];
    for (const extra of cases) {
      const Page = createDashboardPage({ useAppApi: () => recordingApi().api, ...extra });
      const text = textOf(renderToStaticMarkup(<Page />));
      expect(text).not.toContain('This page is built for the app');
      expect(text).toContain('Reading results');
    }
  });

  it('the page uses no hook other than the five React hooks and the two SDK hooks', () => {
    const allowed = new Set(['useSyncExternalStore', 'useMemo', 'useRef', 'useEffect', 'useState', 'useAppApi', 'useAppInfo']);
    for (const file of ['page.tsx', 'components/FindingsList.tsx', 'components/DashboardView.tsx']) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      const used = new Set(source.match(/\buse[A-Z]\w*/g) ?? []);
      for (const name of used) expect(allowed.has(name), `${name} in ${file}`).toBe(true);
    }
  });
});