// @ts-check
// Feature: packaging. Tests of the Manifest_Check (scripts/packaging/manifest-check.mjs) and of the real repo files.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkManifest } from '../scripts/packaging/manifest-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const enc = new TextEncoder();

/** @typedef {{rule: string, message: string}} Problem */

/**
 * @param {number} t the launcher constant
 * @returns {string}
 */
const launcher = (t) => `import time\n\nCRON_TIMEOUT = ${t}  # seconds; equals the cron "timeout" in app.json\nKILL_AFTER = CRON_TIMEOUT - 5\n`;

/** @returns {string} */
const agentText = () =>
  JSON.stringify({
    name: 'playtester',
    description: 'x',
    tools: ['execute_bash'],
    resources: ['skill://~/.kiro/crew/apps/grimsheet-playtester/skills/*/SKILL.md'],
    prompt: 'p',
  });

const SKILLS = [
  { path: 'skills/play-level', hasSkillMd: true },
  { path: 'skills/find-exploits', hasSkillMd: true },
];

/**
 * The manifest of the design, with the values that the properties vary.
 * @param {{timeout?: number, timeoutSecs?: number, displayName?: string, description?: string, version?: string}} [o]
 * @returns {any}
 */
function validManifest(o = {}) {
  const displayName = o.displayName ?? 'Grimsheet Playtester';
  const timeout = o.timeout ?? 900;
  return {
    name: 'grimsheet-playtester',
    displayName,
    version: o.version ?? '1.0.0',
    description: o.description ?? 'The night watch for a haunted spreadsheet: replays every Grimsheet level each night and sends an agent to break them.',
    author: 'UBayouski',
    agents: ['agents/playtester.json'],
    skills: ['skills/play-level', 'skills/find-exploits'],
    crons: [
      {
        name: 'replay',
        script: 'scripts/replay_cron.py:run',
        cron_expr: '0 3 * * *',
        timezone: 'America/Los_Angeles',
        strict_schedule: true,
        enabled: true,
        timeout,
        timeout_secs: o.timeoutSecs ?? timeout + 5,
      },
    ],
    permissions: { cron: true, api: ['/api/apps/grimsheet-playtester/config', '/api/crons'] },
    ui: {
      entry: 'dist/index.mjs',
      pages: [{ route: '/apps/grimsheet-playtester', label: displayName, icon: 'Ghost' }],
    },
  };
}

const textOf = (/** @type {any} */ m) => `${JSON.stringify(m, null, 2)}\n`;

/**
 * @param {any} manifest an object (serialised) or a string (used as is)
 * @param {Record<string, unknown>} [over]
 */
function input(manifest, over = {}) {
  const text = typeof manifest === 'string' ? manifest : textOf(manifest);
  return {
    manifestBytes: enc.encode(text),
    launcherText: launcher(900),
    agentText: agentText(),
    skillDirs: SKILLS,
    bundleBytes: 43902,
    ...over,
  };
}

/** @param {Problem[]} problems */
const rules = (problems) => new Set(problems.map((p) => p.rule));

/**
 * @param {(m: any) => void} edit
 * @returns {Problem[]}
 */
function checkEdited(edit) {
  const m = validManifest();
  edit(m);
  return checkManifest(input(m));
}

describe('checkManifest: the valid manifest', () => {
  it('gives no problem', () => {
    expect(checkManifest(input(validManifest()))).toEqual([]);
  });

  it('every problem has a rule and a message', () => {
    const problems = checkEdited((m) => {
      delete m.name;
    });
    expect(problems.length).toBeGreaterThan(0);
    for (const p of problems) {
      expect(typeof p.rule).toBe('string');
      expect(p.message.length).toBeGreaterThan(0);
    }
  });
});

describe('checkManifest: bytes and JSON (R1.5)', () => {
  it('reports a BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(textOf(validManifest()))]);
    expect(rules(checkManifest(input('', { manifestBytes: bytes })))).toContain('bom');
  });

  it('reports text that is not JSON, and an array', () => {
    expect(rules(checkManifest(input('{ not json')))).toContain('json');
    expect(rules(checkManifest(input('[1, 2]')))).toContain('json');
  });

  it('reports bytes that are not UTF-8', () => {
    expect(rules(checkManifest(input('', { manifestBytes: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) })))).toContain('json');
  });
});

describe('checkManifest: identity (R1.1, R1.2, R1.7)', () => {
  it('reports a wrong name, a missing displayName, a bad version, a wrong author, a multi-line description', () => {
    expect(rules(checkEdited((m) => (m.name = 'other')))).toContain('identity');
    expect(rules(checkEdited((m) => (m.displayName = '')))).toContain('identity');
    expect(rules(checkEdited((m) => delete m.displayName))).toContain('identity');
    for (const v of ['1.0', 'v1.0.0', '1.0.0.0', '', 1]) expect(rules(checkEdited((m) => (m.version = v)))).toContain('identity');
    expect(rules(checkEdited((m) => (m.author = 'someone')))).toContain('identity');
    expect(rules(checkEdited((m) => (m.description = 'one.\ntwo.')))).toContain('identity');
    expect(rules(checkEdited((m) => (m.description = '')))).toContain('identity');
  });

  it('takes the version 1.0.0 as valid', () => {
    expect(checkManifest(input(validManifest({ version: '1.0.0' })))).toEqual([]);
  });
});

describe('checkManifest: fields that must be absent (R1.3, R1.4, R2.5, R3.2, R4.4, R4.6, R4.8)', () => {
  /** @type {Array<[string, (m: any) => void]>} */
  const cases = [
    ['resources', (m) => (m.resources = [])],
    ['setup.onInstall', (m) => (m.setup = { onInstall: 'x' })],
    ['setup.onUninstall', (m) => (m.setup = { onUninstall: 'x' })],
    ['setup.onEnable', (m) => (m.setup = { onEnable: 'x' })],
    ['setup.onDisable', (m) => (m.setup = { onDisable: 'x' })],
    ['mcpServers', (m) => (m.mcpServers = {})],
    ['sops', (m) => (m.sops = [])],
    ['permissions.events', (m) => (m.permissions.events = [])],
    ['permissions.network', (m) => (m.permissions.network = true)],
    ['permissions.mcpTools', (m) => (m.permissions.mcpTools = true)],
    ['permissions.memory', (m) => (m.permissions.memory = true)],
    ['permissions.sessionApproval', (m) => (m.permissions.sessionApproval = true)],
    ['permissions.spawn', (m) => (m.permissions.spawn = true)],
    ['permissions.jobs', (m) => (m.permissions.jobs = true)],
    ['permissions.exposeToApps', (m) => (m.permissions.exposeToApps = true)],
    ['ui.mountFunction', (m) => (m.ui.mountFunction = 'mount')],
    ['ui.pages[0].mountFunction', (m) => (m.ui.pages[0].mountFunction = 'mount')],
    ['ui.pages[0].entryPoint', (m) => (m.ui.pages[0].entryPoint = 'x')],
    ['crons[0].command', (m) => (m.crons[0].command = 'x')],
    ['crons[0].message', (m) => (m.crons[0].message = 'x')],
    ['crons[0].agent', (m) => (m.crons[0].agent = 'x')],
    ['crons[0].every', (m) => (m.crons[0].every = 60)],
    ['crons[0].env', (m) => (m.crons[0].env = {})],
  ];
  for (const [label, edit] of cases) {
    it(`reports ${label}`, () => {
      expect(rules(checkEdited(edit))).toContain('absent');
    });
  }
});

describe('checkManifest: agents and skills (R2.1 to R2.4)', () => {
  it('reports changed agents and skills lists', () => {
    expect(rules(checkEdited((m) => (m.agents = [])))).toContain('agents-skills');
    expect(rules(checkEdited((m) => (m.agents = ['agents/other.json'])))).toContain('agents-skills');
    expect(rules(checkEdited((m) => (m.skills = ['skills/play-level'])))).toContain('agents-skills');
    expect(rules(checkEdited((m) => (m.skills = ['skills/find-exploits', 'skills/play-level'])))).toContain('agents-skills');
    expect(rules(checkEdited((m) => (m.skills = [{ path: 'skills/play-level' }])))).toContain('agents-skills');
  });

  it('reports a skill folder without SKILL.md', () => {
    const skillDirs = [SKILLS[0], { path: 'skills/find-exploits', hasSkillMd: false }];
    expect(rules(checkManifest(input(validManifest(), { skillDirs })))).toContain('agents-skills');
  });

  it('reports an agent file with wrong tools, allowedTools, or a skill resource of another app', () => {
    const base = JSON.parse(agentText());
    /** @type {any[]} */
    const bad = [
      { ...base, tools: ['execute_bash', 'fs_read'] },
      { ...base, tools: [] },
      { ...base, allowedTools: ['execute_bash'] },
      { ...base, resources: ['skill://~/.kiro/crew/apps/other-app/skills/*/SKILL.md'] },
      { ...base, resources: [] },
      { ...base, resources: [...base.resources, 'skill://~/.kiro/crew/apps/grimsheet-playtester/skills/*/SKILL.md'] },
    ];
    for (const a of bad) {
      expect(rules(checkManifest(input(validManifest(), { agentText: JSON.stringify(a) })))).toContain('agents-skills');
    }
    expect(rules(checkManifest(input(validManifest(), { agentText: '{ nope' })))).toContain('agents-skills');
  });

  it('takes the skill resource app segment from the manifest name', () => {
    const m = validManifest();
    m.name = 'x-app';
    m.permissions.api = ['/api/apps/x-app/config', '/api/crons'];
    m.ui.pages[0].route = '/apps/x-app';
    const a = { ...JSON.parse(agentText()), resources: ['skill://~/.kiro/crew/apps/x-app/skills/*/SKILL.md'] };
    const found = rules(checkManifest(input(m, { agentText: JSON.stringify(a) })));
    expect(found).not.toContain('agents-skills');
    expect(found).not.toContain('permissions');
    expect(found).not.toContain('ui');
  });
});

describe('checkManifest: crons (R3.1, R3.4, R3.5)', () => {
  it('reports each changed field of the replay cron', () => {
    /** @type {Array<[string, unknown]>} */
    const changes = [
      ['name', 'nightly'],
      ['script', 'scripts/other.py:run'],
      ['cron_expr', '0 4 * * *'],
      ['timezone', 'UTC'],
      ['strict_schedule', false],
      ['enabled', false],
    ];
    for (const [key, value] of changes) {
      expect(rules(checkEdited((m) => (m.crons[0][key] = value)))).toContain('crons');
    }
  });

  it('reports no cron, and an extra hunt cron by name', () => {
    expect(rules(checkEdited((m) => (m.crons = [])))).toContain('crons');
    const problems = checkEdited((m) => m.crons.push({ name: 'hunt', message: 'hunt', cron_expr: '0 4 * * 0' }));
    expect(rules(problems)).toContain('crons');
    expect(problems.some((p) => p.rule === 'crons' && /hunt/.test(p.message))).toBe(true);
  });
});

describe('checkManifest: permissions (R3.3, R4.3, R4.5, R4.9)', () => {
  it('reports cron not true and a changed api list', () => {
    expect(rules(checkEdited((m) => (m.permissions.cron = false)))).toContain('permissions');
    expect(rules(checkEdited((m) => delete m.permissions.cron))).toContain('permissions');
    expect(rules(checkEdited((m) => (m.permissions.api = ['/api/crons'])))).toContain('permissions');
    expect(rules(checkEdited((m) => (m.permissions.api = [...m.permissions.api, '/api/crons/*'])))).toContain('permissions');
    expect(rules(checkEdited((m) => (m.permissions.api = ['/api/crons', '/api/apps/grimsheet-playtester/config'])))).toContain('permissions');
    expect(rules(checkEdited((m) => (m.permissions.api = ['/api/apps/other/config', '/api/crons'])))).toContain('permissions');
  });
});

describe('checkManifest: ui (R4.1, R4.2)', () => {
  it('reports a changed entry, page count, route, label or icon', () => {
    expect(rules(checkEdited((m) => (m.ui.entry = 'index.mjs')))).toContain('ui');
    expect(rules(checkEdited((m) => (m.ui.pages = [])))).toContain('ui');
    expect(rules(checkEdited((m) => m.ui.pages.push({ ...m.ui.pages[0] })))).toContain('ui');
    expect(rules(checkEdited((m) => (m.ui.pages[0].route = '/apps/other')))).toContain('ui');
    expect(rules(checkEdited((m) => (m.ui.pages[0].label = 'Other')))).toContain('ui');
    expect(rules(checkEdited((m) => delete m.ui.pages[0].icon))).toContain('ui');
    expect(rules(checkEdited((m) => (m.ui.pages[0].icon = 7)))).toContain('ui');
    expect(rules(checkEdited((m) => delete m.ui))).toContain('ui');
  });
});

describe('checkManifest: the timeout rules (R5.1 to R5.3, R5.7, R5.8)', () => {
  it('reports a timeout that differs from the launcher constant', () => {
    const m = validManifest({ timeout: 899, timeoutSecs: 905 });
    expect(rules(checkManifest(input(m)))).toContain('timeout');
  });

  it('reports a timeout_secs of timeout plus 4, and accepts timeout plus 5', () => {
    expect(rules(checkManifest(input(validManifest({ timeout: 900, timeoutSecs: 904 }))))).toContain('timeout-secs');
    expect(checkManifest(input(validManifest({ timeout: 900, timeoutSecs: 905 })))).toEqual([]);
  });

  it('reports a missing or non-integer timeout or timeout_secs', () => {
    expect(rules(checkEdited((m) => delete m.crons[0].timeout))).toContain('timeout');
    expect(rules(checkEdited((m) => delete m.crons[0].timeout_secs))).toContain('timeout-secs');
    expect(rules(checkEdited((m) => (m.crons[0].timeout = '900')))).toContain('timeout');
    expect(rules(checkEdited((m) => (m.crons[0].timeout_secs = 905.5)))).toContain('timeout-secs');
  });

  it('fails when the launcher constant changes until the manifest follows', () => {
    expect(rules(checkManifest(input(validManifest(), { launcherText: launcher(1200) })))).toContain('timeout');
    expect(checkManifest(input(validManifest({ timeout: 1200, timeoutSecs: 1205 }), { launcherText: launcher(1200) }))).toEqual([]);
  });

  it('reports a launcher text with no CRON_TIMEOUT', () => {
    expect(rules(checkManifest(input(validManifest(), { launcherText: 'KILL_AFTER = 1\n' })))).toContain('timeout');
  });

  it('reports an extra hunt cron (R5.7)', () => {
    expect(rules(checkEdited((m) => m.crons.push({ name: 'hunt' })))).toContain('crons');
  });
});

describe('checkManifest: forbidden text (R1.6, R5.4)', () => {
  it('reports a drive letter, Users\\, token=, and a web address', () => {
    for (const bad of ['C:\\Temp', 'Users\\someone', 'token=abc', 'https://example.test/x', 'http://example.test']) {
      expect(rules(checkEdited((m) => (m.description = `Fine ${bad} text`)))).toContain('text');
    }
  });
});

describe('checkManifest: the bundle (R8.2)', () => {
  it('reports a missing or empty ui/dist/index.mjs, and accepts a non-empty one', () => {
    expect(rules(checkManifest(input(validManifest(), { bundleBytes: null })))).toContain('bundle');
    expect(rules(checkManifest(input(validManifest(), { bundleBytes: 0 })))).toContain('bundle');
    expect(checkManifest(input(validManifest(), { bundleBytes: 1 }))).toEqual([]);
  });
});

describe('checkManifest properties', () => {
  const arbT = fc.integer({ min: 30, max: 3600 });
  const arbExtra = fc.integer({ min: 5, max: 305 });
  const arbText = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .,'-]{0,60}$/);
  const arbVersion = fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 }), fc.nat({ max: 20 })).map(([a, b, c]) => `${a}.${b}.${c}`);

  // Feature: packaging, Property 1: valid manifests pass
  it('Property 1: a manifest built by the valid builder gives no problem', () => {
    fc.assert(
      fc.property(arbT, arbExtra, arbText, arbText, arbVersion, (t, extra, displayName, description, version) => {
        const m = validManifest({ timeout: t, timeoutSecs: t + extra, displayName, description, version });
        expect(checkManifest(input(m, { launcherText: launcher(t) }))).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: packaging, Property 2: a timeout that differs from the constant is found
  it('Property 2: a timeout that differs from the launcher constant is reported', () => {
    fc.assert(
      fc.property(arbT, fc.integer({ min: -29, max: 2000 }).filter((d) => d !== 0), arbExtra, (t, delta, extra) => {
        const timeout = t + delta;
        const m = validManifest({ timeout, timeoutSecs: timeout + extra });
        expect(rules(checkManifest(input(m, { launcherText: launcher(t) })))).toContain('timeout');
      }),
      { numRuns: 200 },
    );
  });

  // Feature: packaging, Property 3: a short timeout_secs is found
  it('Property 3: a timeout_secs from 0 to timeout plus 4 is reported', () => {
    fc.assert(
      fc.property(arbT, fc.nat({ max: 4 }), fc.boolean(), (t, shortBy, zero) => {
        const timeoutSecs = zero ? 0 : t + 4 - shortBy;
        const m = validManifest({ timeout: t, timeoutSecs });
        expect(rules(checkManifest(input(m, { launcherText: launcher(t) })))).toContain('timeout-secs');
      }),
      { numRuns: 200 },
    );
  });

  // Feature: packaging, Property 4: an extra cron is found
  it('Property 4: an additional cron entry of any name and fields is reported; a cron named hunt is reported by name', () => {
    const arbField = fc.constantFrom('message', 'agent', 'command', 'every', 'env', 'script', 'cron_expr', 'timeout');
    const arbCron = fc.record({
      name: fc.oneof(fc.constant('hunt'), fc.constant('replay'), fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)),
      fields: fc.array(fc.tuple(arbField, fc.oneof(fc.string({ maxLength: 8 }), fc.nat(), fc.boolean())), { maxLength: 4 }),
    });
    fc.assert(
      fc.property(arbCron, ({ name, fields }) => {
        const m = validManifest();
        const extra = { name, ...Object.fromEntries(fields) };
        extra.name = name;
        m.crons.push(extra);
        const problems = checkManifest(input(m));
        expect(rules(problems)).toContain('crons');
        if (name === 'hunt') expect(problems.some((p) => p.rule === 'crons' && /hunt/.test(p.message))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: packaging, Property 5: forbidden text and a BOM are found
  it('Property 5: a drive letter, Users\\, token=, a web address or a BOM at any position is reported', () => {
    const arbBad = fc.constantFrom('C:\\', 'z:\\', 'D:\\x', 'Users\\', 'token=', 'token=abcdef', 'https://x.test', 'http://a.test');
    fc.assert(
      fc.property(arbText, arbBad, fc.nat(), (description, bad, pos) => {
        const at = pos % (description.length + 1);
        const m = validManifest({ description: `${description.slice(0, at)}${bad}${description.slice(at)}` });
        expect(rules(checkManifest(input(m)))).toContain('text');
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(arbText, (description) => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(textOf(validManifest({ description })))]);
        expect(rules(checkManifest(input('', { manifestBytes: bytes })))).toContain('bom');
      }),
      { numRuns: 200 },
    );
  });
});

describe('the real files (R5.4 and the rules above, applied to the repo)', () => {
  it('app.json, the launcher, the agent file, the skills and the bundle give no problem', () => {
    const manifestBytes = new Uint8Array(readFileSync(`${ROOT}app.json`));
    const launcherText = readFileSync(`${ROOT}scripts/replay_cron.py`, 'utf8');
    const agent = readFileSync(`${ROOT}agents/playtester.json`, 'utf8');
    const skillDirs = ['skills/play-level', 'skills/find-exploits'].map((path) => ({ path, hasSkillMd: existsSync(`${ROOT}${path}/SKILL.md`) }));
    const bundlePath = `${ROOT}ui/dist/index.mjs`;
    const bundleBytes = existsSync(bundlePath) ? statSync(bundlePath).size : null;
    expect(checkManifest({ manifestBytes, launcherText, agentText: agent, skillDirs, bundleBytes })).toEqual([]);
  });
});
