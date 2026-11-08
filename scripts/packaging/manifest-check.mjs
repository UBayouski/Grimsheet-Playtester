// @ts-check
// The Manifest_Check: a pure function from the bytes of app.json and the files it depends on to a list of problems.
// It reads no file and makes no request, so the root `npm test` needs no gateway and no network.
// The rules are those of the packaging design, "Manifest_Check".

/**
 * @typedef {{rule: string, message: string}} Problem
 * @typedef {Object} ManifestCheckInput
 * @property {Uint8Array} manifestBytes  the bytes of app.json (a BOM must be visible)
 * @property {string} launcherText       the text of scripts/replay_cron.py
 * @property {string} agentText          the text of agents/playtester.json
 * @property {Array<{path: string, hasSkillMd: boolean}>} skillDirs  the skill folders found in the repo
 * @property {number|null} bundleBytes   the size of ui/dist/index.mjs, or null when the file is missing
 */

export const APP_NAME = 'grimsheet-playtester';
export const AUTHOR = 'UBayouski';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Keys that the Manifest must not hold, as paths below the top level. */
const FORBIDDEN_TOP = ['resources', 'mcpServers', 'sops'];
const FORBIDDEN_SETUP = ['onInstall', 'onUninstall', 'onEnable', 'onDisable'];
const FORBIDDEN_PERMISSIONS = ['events', 'network', 'mcpTools', 'memory', 'sessionApproval', 'spawn', 'jobs', 'exposeToApps'];
const FORBIDDEN_CRON_FIELDS = ['command', 'message', 'agent', 'every', 'env'];
const REPLAY_CRON_KEYS = ['name', 'script', 'cron_expr', 'timezone', 'strict_schedule', 'enabled', 'timeout', 'timeout_secs'];

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {ManifestCheckInput} input
 * @returns {Problem[]}
 */
export function checkManifest({ manifestBytes, launcherText, agentText, skillDirs, bundleBytes }) {
  /** @type {Problem[]} */
  const problems = [];
  /** @param {string} rule @param {string} message */
  const add = (rule, message) => void problems.push({ rule, message });

  // The bundle rule does not depend on the manifest text.
  if (bundleBytes === null || !(bundleBytes > 0)) add('bundle', 'ui/dist/index.mjs is missing or empty; run "npm run build" in ui/ and commit the result');

  // bom, json
  let bytes = manifestBytes;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    add('bom', 'app.json starts with a byte order mark; write it as UTF-8 without a BOM');
    bytes = bytes.subarray(3);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    add('json', 'app.json is not valid UTF-8');
    return problems;
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    add('json', 'app.json is not valid JSON');
    return problems;
  }
  if (!isObject(parsed)) {
    add('json', 'app.json is not a JSON object');
    return problems;
  }
  const m = parsed;

  // text: no drive letter, no Users folder, no token, no web address
  if (/[A-Za-z]:\\/.test(text)) add('text', 'app.json holds a drive-letter path');
  if (/Users\\/.test(text)) add('text', 'app.json holds a Users folder path');
  if (/token=/i.test(text)) add('text', 'app.json holds "token="');
  if (/https?:\/\//i.test(text)) add('text', 'app.json holds a web address');

  const name = typeof m.name === 'string' ? m.name : APP_NAME;

  // identity
  if (m.name !== APP_NAME) add('identity', `name must be ${APP_NAME}`);
  if (typeof m.displayName !== 'string' || m.displayName.trim() === '') add('identity', 'displayName must be a non-empty string');
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) add('identity', 'version must be a semver string');
  if (typeof m.description !== 'string' || m.description.trim() === '' || /[\r\n]/.test(m.description)) {
    add('identity', 'description must be a non-empty one-line string');
  }
  if (m.author !== AUTHOR) add('identity', `author must be ${AUTHOR}`);

  // absent
  for (const key of FORBIDDEN_TOP) if (key in m) add('absent', `app.json must not hold ${key}`);
  if (isObject(m.setup)) {
    for (const key of FORBIDDEN_SETUP) if (key in m.setup) add('absent', `app.json must not hold setup.${key}`);
  }
  const permissions = isObject(m.permissions) ? m.permissions : {};
  for (const key of FORBIDDEN_PERMISSIONS) if (key in permissions) add('absent', `app.json must not hold permissions.${key}`);
  const ui = isObject(m.ui) ? m.ui : null;
  if (ui && 'mountFunction' in ui) add('absent', 'app.json must not hold ui.mountFunction');
  const pages = ui && Array.isArray(ui.pages) ? ui.pages : [];
  pages.forEach((page, i) => {
    if (isObject(page)) {
      for (const key of ['entryPoint', 'mountFunction']) if (key in page) add('absent', `app.json must not hold ui.pages[${i}].${key}`);
    }
  });
  const crons = Array.isArray(m.crons) ? m.crons : [];
  crons.forEach((cron, i) => {
    if (isObject(cron)) {
      for (const key of FORBIDDEN_CRON_FIELDS) if (key in cron) add('absent', `app.json must not hold crons[${i}].${key}`);
    }
  });

  // agents-skills
  if (!sameJson(m.agents, ['agents/playtester.json'])) add('agents-skills', 'agents must be ["agents/playtester.json"]');
  if (!sameJson(m.skills, ['skills/play-level', 'skills/find-exploits'])) {
    add('agents-skills', 'skills must be ["skills/play-level", "skills/find-exploits"]');
  }
  if (Array.isArray(m.skills)) {
    for (const path of m.skills) {
      if (typeof path !== 'string') continue;
      const dir = skillDirs.find((d) => d.path === path);
      if (!dir) add('agents-skills', `no skill folder was found for ${path}`);
      else if (!dir.hasSkillMd) add('agents-skills', `${path} has no SKILL.md`);
    }
  }
  /** @type {unknown} */
  let agent;
  try {
    agent = JSON.parse(agentText);
  } catch {
    agent = undefined;
  }
  if (!isObject(agent)) {
    add('agents-skills', 'agents/playtester.json is not a JSON object');
  } else {
    if (!sameJson(agent.tools, ['execute_bash'])) add('agents-skills', 'the agent tools must be ["execute_bash"]');
    if ('allowedTools' in agent) add('agents-skills', 'the agent file must not hold allowedTools');
    const skillResources = Array.isArray(agent.resources) ? agent.resources.filter((r) => typeof r === 'string' && r.startsWith('skill://')) : [];
    const expected = `skill://~/.kiro/crew/apps/${name}/skills/*/SKILL.md`;
    if (skillResources.length !== 1 || skillResources[0] !== expected) {
      add('agents-skills', `the agent file must hold exactly one skill resource: ${expected}`);
    }
  }

  // crons
  if (!Array.isArray(m.crons)) {
    add('crons', 'crons must be a list');
  } else {
    if (crons.length !== 1) add('crons', 'crons must hold exactly the replay entry and no other');
    for (const cron of crons) {
      if (isObject(cron) && cron.name === 'hunt') add('crons', 'a cron named hunt is not allowed; the hunt is on request only');
    }
  }
  const replay = crons.find((c) => isObject(c) && c.name === 'replay');
  if (!isObject(replay)) {
    add('crons', 'crons must hold an entry named replay');
  } else {
    if (replay.script !== 'scripts/replay_cron.py:run') add('crons', 'the replay cron script must be scripts/replay_cron.py:run');
    if (replay.cron_expr !== '0 3 * * *') add('crons', 'the replay cron_expr must be "0 3 * * *"');
    if (replay.timezone !== 'America/Los_Angeles') add('crons', 'the replay cron timezone must be America/Los_Angeles');
    if (replay.strict_schedule !== true) add('crons', 'the replay cron strict_schedule must be true');
    if (replay.enabled !== true) add('crons', 'the replay cron enabled must be true');
    for (const key of Object.keys(replay)) {
      if (!REPLAY_CRON_KEYS.includes(key)) add('crons', `the replay cron holds an unexpected field: ${key}`);
    }
  }

  // permissions
  if (!isObject(m.permissions) || m.permissions.cron !== true) add('permissions', 'permissions.cron must be true');
  if (!sameJson(permissions.api, [`/api/apps/${name}/config`, '/api/crons'])) {
    add('permissions', `permissions.api must be exactly ["/api/apps/${name}/config", "/api/crons"]`);
  }

  // ui
  if (!ui) {
    add('ui', 'ui must be an object');
  } else {
    if (ui.entry !== 'dist/index.mjs') add('ui', 'ui.entry must be dist/index.mjs');
    if (pages.length !== 1) {
      add('ui', 'ui.pages must hold exactly one page');
    } else {
      const page = pages[0];
      if (!isObject(page)) {
        add('ui', 'the page must be an object');
      } else {
        if (page.route !== `/apps/${name}`) add('ui', `the page route must be /apps/${name}`);
        if (page.label !== m.displayName) add('ui', 'the page label must equal displayName');
        if (typeof page.icon !== 'string' || page.icon.trim() === '') add('ui', 'the page icon must be a non-empty string');
      }
    }
  }

  // timeout, timeout-secs
  const constant = /^CRON_TIMEOUT\s*=\s*(\d+)/m.exec(launcherText);
  const launcherTimeout = constant ? Number(constant[1]) : null;
  const timeout = isObject(replay) ? replay.timeout : undefined;
  const timeoutSecs = isObject(replay) ? replay.timeout_secs : undefined;
  if (launcherTimeout === null) add('timeout', 'scripts/replay_cron.py has no CRON_TIMEOUT constant');
  if (!Number.isInteger(timeout)) {
    add('timeout', 'the replay cron timeout must be an integer');
  } else if (launcherTimeout !== null && timeout !== launcherTimeout) {
    add('timeout', `the replay cron timeout (${String(timeout)}) must equal CRON_TIMEOUT (${launcherTimeout})`);
  }
  if (!Number.isInteger(timeoutSecs)) {
    add('timeout-secs', 'the replay cron timeout_secs must be an integer');
  } else if (Number.isInteger(timeout) && /** @type {number} */ (timeoutSecs) < /** @type {number} */ (timeout) + 5) {
    add('timeout-secs', `the replay cron timeout_secs (${String(timeoutSecs)}) must be at least timeout plus 5`);
  }

  return problems;
}
