import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as entry from '../src/index';
import { textOf } from './helpers/render';

describe('the entry module', () => {
  it('has only a default export, and it is the page component', () => {
    expect(Object.keys(entry)).toEqual(['default']);
    expect(typeof entry.default).toBe('function');
  });

  it('renders without throwing when the host gives no app API (the test stub has no SDK exports)', () => {
    const Page = entry.default;
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('<main');
    expect(textOf(html)).toContain('Kiro Crew did not provide the app API');
  });
});