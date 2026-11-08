// @ts-check
// Task 19.1: the four entry files of skills/find-exploits/scripts/ (design: "Entry scripts"). Each is three lines:
// `// @ts-check`, the import of `main` from cli.mjs, and `await main('<name>');`. The files do not exist yet.
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scripts/hunt/cli.mjs', () => ({ main: vi.fn(async () => undefined) }));

const { main } = await import('../scripts/hunt/cli.mjs');

const SCRIPTS = path.resolve(import.meta.dirname, '..', 'skills', 'find-exploits', 'scripts');
const ENTRIES = [
  ['hunt-begin.mjs', 'begin'],
  ['hunt-info.mjs', 'info'],
  ['hunt-submit.mjs', 'submit'],
  ['hunt-end.mjs', 'end'],
];

describe.each(ENTRIES)('entry file %s', (file, name) => {
  const full = path.join(SCRIPTS, file);

  beforeEach(() => {
    vi.mocked(main).mockClear();
  });

  it('is exactly the three design lines', () => {
    const lines = readFileSync(full, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
    expect(lines).toEqual([
      '// @ts-check',
      "import { main } from '../../../scripts/hunt/cli.mjs';",
      `await main('${name}');`,
    ]);
  });

  it('calls main once with its own name when loaded', async () => {
    await import(/* @vite-ignore */ pathToFileURL(full).href);
    expect(main).toHaveBeenCalledTimes(1);
    expect(vi.mocked(main).mock.calls[0][0]).toBe(name);
  });
});
