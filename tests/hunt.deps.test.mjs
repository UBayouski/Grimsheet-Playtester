// @ts-check
// Unit tests for scripts/hunt/deps.mjs (task 18.4). Building the deps starts no process,
// uses no network and writes no file; the tests never call spawn, fs writes or a long sleep.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHuntDeps } from '../scripts/hunt/deps.mjs';
import { checkCandidate } from '../scripts/verifier.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const huntFolder = path.join(repoRoot, 'scripts', 'hunt');

const REQUIRED_KEYS = [
  'clock', 'sleep', 'fs', 'paths', 'spawn', 'checkCandidate', 'token', 'pid', 'appName', 'platform',
];

describe('buildHuntDeps', () => {
  it('has every HuntDeps key and no verifier', () => {
    const deps = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (buildHuntDeps({ env: {} })));
    for (const key of REQUIRED_KEYS) expect(deps, key).toHaveProperty(key);
    expect(deps).not.toHaveProperty('verifier');
    expect(typeof /** @type {any} */ (deps.clock).nowMs).toBe('function');
    expect(typeof deps.sleep).toBe('function');
    expect(typeof deps.spawn).toBe('function');
    expect(typeof deps.pid).toBe('number');
  });

  it('platform is win32 or other', () => {
    const { platform } = buildHuntDeps({ env: {} });
    expect(['win32', 'other']).toContain(platform);
    expect(platform).toBe(process.platform === 'win32' ? 'win32' : 'other');
  });

  it('appName is grimsheet-playtester', () => {
    expect(buildHuntDeps({ env: {} }).appName).toBe('grimsheet-playtester');
  });

  it('token() gives 32 hex characters, new each call', () => {
    const deps = buildHuntDeps({ env: {} });
    const a = deps.token();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deps.token()).not.toBe(a);
  });

  it('checkCandidate is the verifier checkCandidate', () => {
    expect(buildHuntDeps({ env: {} }).checkCandidate).toBe(checkCandidate);
  });

  it('paths.localAppData comes from the env option or is empty', () => {
    expect(buildHuntDeps({ env: { LOCALAPPDATA: 'C:\\Fake\\Local' } }).paths.localAppData).toBe('C:\\Fake\\Local');
    expect(buildHuntDeps({ env: {} }).paths.localAppData).toBe('');
  });

  it('paths.appFolder is two levels above scripts/hunt and dataFolder is <appFolder>\\data', () => {
    const { paths } = buildHuntDeps({ env: {} });
    expect(path.resolve(paths.appFolder)).toBe(repoRoot);
    expect(paths.dataFolder).toBe(path.join(paths.appFolder, 'data'));
  });

  it('deps.mjs is the only file under scripts/hunt that mentions verifier.mjs (code or comment)', () => {
    const files = fs.readdirSync(huntFolder).filter((f) => f.endsWith('.mjs'));
    expect(files).toContain('deps.mjs');
    const mentioning = files.filter((f) => fs.readFileSync(path.join(huntFolder, f), 'utf8').includes('verifier.mjs'));
    expect(mentioning).toEqual(['deps.mjs']);
  });
});
