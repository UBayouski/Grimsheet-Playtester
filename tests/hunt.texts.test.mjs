// @ts-check
// Lint test and budget-number test for the agent file and the two skills.
// Requirement 16 criteria 6-8; Requirement 2 criterion 9. Reads the real files; no process, no network.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LEVEL_BUDGET,
  HUNT_BUDGET,
  TIME_BUDGET_SEC,
  REFUSAL_BUDGET,
  MAX_TOKENS,
  MAX_EDITS,
  MAX_RAW_BYTES,
} from '../scripts/hunt/limits.mjs';

const SKILL_GLOB = 'skill://~/.kiro/crew/apps/grimsheet-playtester/skills/*/SKILL.md';

/** @param {string} rel */
function read(rel) {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
}

const AGENT = 'agents/playtester.json';
const PLAY = 'skills/play-level/SKILL.md';
const FIND = 'skills/find-exploits/SKILL.md';

/** @returns {any} */
function agent() {
  return JSON.parse(read(AGENT));
}

/** The three texts; the agent prompt is checked as text (design: Lint test). */
function texts() {
  return /** @type {Array<[string, string]>} */ ([
    [AGENT, String(agent().prompt)],
    [PLAY, read(PLAY)],
    [FIND, read(FIND)],
  ]);
}

/** Split a skill into fenced code blocks, inline code spans and prose. */
/** @param {string} text */
function split(text) {
  /** @type {string[]} */
  const blocks = [];
  const noBlocks = text.replace(/```[\s\S]*?```/g, (m) => {
    blocks.push(m);
    return '\n';
  });
  /** @type {string[]} */
  const spans = [];
  const prose = noBlocks.replace(/`[^`\n]+`/g, (m) => {
    spans.push(m);
    return ' ';
  });
  return { blocks, spans, prose };
}

/** @param {string} text @returns {Record<string, string>} flat frontmatter: top keys and metadata.* */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  /** @type {Record<string, string>} */
  const out = {};
  let inMeta = false;
  for (const line of m[1].split(/\r?\n/)) {
    const top = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    const sub = /^\s+([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (top) {
      inMeta = top[1] === 'metadata';
      out[top[1]] = top[2];
    } else if (sub && inMeta) {
      out[`metadata.${sub[1]}`] = sub[2];
    }
  }
  return out;
}

/** @param {unknown} v @returns {string[]} every key at every depth */
function allKeys(v) {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
  }
  return [];
}

describe('agents/playtester.json', () => {
  it('parses, is named playtester and has the single execute_bash tool', () => {
    const a = agent();
    expect(a.name).toBe('playtester');
    expect(a.tools).toEqual(['execute_bash']);
  });

  it('has the single skill resource entry', () => {
    expect(agent().resources).toEqual([SKILL_GLOB]);
  });

  it('has no allowedTools, permissions or model field', () => {
    const a = agent();
    for (const k of ['allowedTools', 'permissions', 'model']) {
      expect(Object.prototype.hasOwnProperty.call(a, k)).toBe(false);
    }
  });

  it('has no $ in any key', () => {
    for (const k of allKeys(agent())) expect(k.includes('$')).toBe(false);
  });

  it('has a string prompt', () => {
    expect(typeof agent().prompt).toBe('string');
  });
});

describe('skill frontmatter', () => {
  for (const [file, name] of /** @type {Array<[string, string]>} */ ([
    [PLAY, 'play-level'],
    [FIND, 'find-exploits'],
  ])) {
    it(`${file} has name, description, license, author and version`, () => {
      const fm = frontmatter(read(file));
      expect(fm.name).toBe(name);
      expect((fm.description ?? '').length).toBeGreaterThan(0);
      expect(fm.license).toBe('MIT');
      expect((fm['metadata.author'] ?? '').length).toBeGreaterThan(0);
      expect((fm['metadata.version'] ?? '').length).toBeGreaterThan(0);
    });
  }
});

describe('forbidden tokens', () => {
  it('none of && | > $env: $letter "cd " inside code blocks and spans', () => {
    const bad = [/&&/, /\|/, />/, /\$env:/i, /\$[A-Za-z]/, /\bcd /];
    for (const file of [PLAY, FIND]) {
      const { blocks, spans } = split(read(file));
      for (const code of [...blocks, ...spans]) {
        for (const re of bad) expect(code, `${file} ${re}`).not.toMatch(re);
      }
    }
    for (const re of bad) expect(String(agent().prompt), `prompt ${re}`).not.toMatch(re);
  });

  it('none of && $env: "cd " in prose', () => {
    const bad = [/&&/, /\$env:/i, /\bcd /];
    for (const file of [PLAY, FIND]) {
      const { prose } = split(read(file));
      for (const re of bad) expect(prose, `${file} ${re}`).not.toMatch(re);
    }
  });

  it('no { followed by a double quote anywhere (inline JSON)', () => {
    for (const [file, t] of texts()) expect(t, file).not.toMatch(/\{\s*"/);
    for (const file of [PLAY, FIND]) expect(read(file)).not.toMatch(/\{\s*"/);
  });
});

describe('required phrases', () => {
  const phrases = [
    'exactly as given',
    'append nothing',
    'The user sees the command in the approval prompt',
  ];
  for (const p of phrases) {
    it(`each of the three texts holds "${p}"`, () => {
      for (const [file, t] of texts()) expect(t, file).toContain(p);
    });
  }
});

describe('paths and approval mode', () => {
  it('no drive letter, Users\\ or home path (the app skill glob is the one allowed ~ path)', () => {
    const raw = [read(AGENT), read(PLAY), read(FIND)];
    for (const t of raw) {
      // Scope: the required skill glob is removed first; everything else is scanned.
      const scanned = t.split(SKILL_GLOB).join('');
      expect(scanned).not.toMatch(/[A-Za-z]:\\/);
      expect(scanned).not.toMatch(/[A-Za-z]:\\\\/);
      expect(scanned).not.toMatch(/Users[\\/]/i);
      expect(scanned).not.toMatch(/~[\\/]/);
      expect(scanned).not.toMatch(/\/home\//i);
      expect(scanned).not.toMatch(/%USERPROFILE%|%APPDATA%|%LOCALAPPDATA%/i);
    }
  });

  it('no word that changes the approval mode', () => {
    for (const t of [read(AGENT), read(PLAY), read(FIND)]) {
      expect(t).not.toMatch(/\btrust/i);
      expect(t).not.toMatch(/\byolo\b/i);
      expect(t).not.toMatch(/approval mode/i);
    }
  });
});

describe('skill wording', () => {
  it('no npm, clone, fetch, install or build outside the Hunt_Begin sentence', () => {
    for (const file of [PLAY, FIND]) {
      const t = read(file).replace(/Hunt_Begin prepares the game[^.\n]*\./g, '');
      expect(t, file).not.toMatch(/\b(npm|clone|fetch|install|build)/i);
    }
  });

  it('play-level keeps the Hunt_Begin sentence', () => {
    expect(read(PLAY)).toContain('Hunt_Begin prepares the game for you');
  });

  it('undo wording does not say "take back"', () => {
    for (const file of [PLAY, FIND]) expect(read(file)).not.toMatch(/take back/i);
  });

  it('find-exploits holds the three classes, each with an example', () => {
    const t = read(FIND);
    for (const c of ['cheaper_win', 'free_win', 'unexpected_route']) {
      expect(t).toContain(`- ${c}:`);
      expect(t).toMatch(new RegExp(`hunt-submit\\.mjs[^\\n]*--class ${c}\\b`));
    }
  });
});

describe('budget numbers match limits.mjs', () => {
  /**
   * @param {string} unit
   * @param {string} [text] defaults to the real find-exploits text
   * @returns {number[]}
   */
  function numbersBefore(unit, text = read(FIND)) {
    // Only the literal "UTF-8" is exempt ("UTF-8 bytes" is an encoding, not a budget).
    // Any other number, even one after a hyphen or letter, is read as a budget.
    const re = new RegExp(`(?<![\\d.])(\\d+) ${unit}\\b`, 'g');
    return [...text.replaceAll('UTF-8', '').matchAll(re)].map((m) => Number(m[1]));
  }

  /** @type {Array<[string, number, string]>} */
  const table = [
    ['attempts', LEVEL_BUDGET, 'LEVEL_BUDGET'],
    ['attempts', HUNT_BUDGET, 'HUNT_BUDGET'],
    ['seconds', TIME_BUDGET_SEC, 'TIME_BUDGET_SEC'],
    ['refusals', REFUSAL_BUDGET, 'REFUSAL_BUDGET'],
    ['tokens', MAX_TOKENS, 'MAX_TOKENS'],
    ['edit tokens', MAX_EDITS, 'MAX_EDITS'],
    ['bytes', MAX_RAW_BYTES, 'MAX_RAW_BYTES'],
  ];

  for (const [unit, value, name] of table) {
    it(`"${value} ${unit}" appears in find-exploits (${name})`, () => {
      expect(numbersBefore(unit)).toContain(value);
    });
  }

  it('every "N attempts" number is one of the two attempt budgets', () => {
    for (const n of numbersBefore('attempts')) expect([LEVEL_BUDGET, HUNT_BUDGET]).toContain(n);
  });

  it('on the real text the attempt numbers are exactly the two budgets', () => {
    expect(new Set(numbersBefore('attempts'))).toEqual(new Set([LEVEL_BUDGET, HUNT_BUDGET]));
  });

  it('"UTF-8 bytes" is not read as 8', () => {
    const text = read(FIND);
    expect(text).toContain('UTF-8 bytes');
    expect(numbersBefore('bytes')).not.toContain(8);
    expect(numbersBefore('bytes', 'of its UTF-8 bytes')).toEqual([]);
  });

  it('a wrong budget written with a hyphen is caught', () => {
    const real = read(FIND);
    const variant = real.replace('4 attempts for each level', 'level-5 attempts for each level');
    expect(variant).not.toBe(real);
    expect(numbersBefore('attempts', variant)).toContain(5);
    expect(
      numbersBefore('attempts', variant).every((n) => [LEVEL_BUDGET, HUNT_BUDGET].includes(n)),
    ).toBe(false);
  });

  it('the single-valued budgets have no other number', () => {
    expect(new Set(numbersBefore('seconds'))).toEqual(new Set([TIME_BUDGET_SEC]));
    expect(new Set(numbersBefore('refusals'))).toEqual(new Set([REFUSAL_BUDGET]));
    expect(new Set(numbersBefore('tokens'))).toEqual(new Set([MAX_TOKENS]));
    expect(new Set(numbersBefore('edit tokens'))).toEqual(new Set([MAX_EDITS]));
    expect(new Set(numbersBefore('bytes'))).toEqual(new Set([MAX_RAW_BYTES]));
  });
});
