// @ts-check
// Publish step of the exploit hunt: merges the Findings_Value into data\config.json under
// playtesterResults.findings, through the shared results-store merge. No HTTP call.
// See .kiro/specs/exploit-hunt/design.md, "publish.mjs" and "publishFindings".
import { mergeTopKey } from '../results-store.mjs';
import { BYTE_BUDGET } from '../replay/run-record.mjs';
import { addFinding, normalizeFindings, withHeader } from './findings.mjs';
import { countsOf } from './hunt-record.mjs';

/** @typedef {import('../results-store.mjs').ResultsDeps} ResultsDeps */
/** @typedef {import('./types.mjs').Finding} Finding */
/** @typedef {import('./types.mjs').HuntRecord} HuntRecord */
/** @typedef {'ok'|'lock_timeout'|'config_unreadable'|'too_large'|'write_failed'} FindingsKey */

/**
 * Merge the Findings_Value. Reads the existing value inside buildOwned (under the results lock), so
 * there is no lost update. With a new Finding it calls addFinding; without one it only refreshes the
 * header (Hunt_End). Also retries record.pendingFindings, oldest first. Never throws.
 * `record` in the result is a copy of the input with `findingsKey` set and `pendingFindings` cleared
 * (ok) or extended with the new Finding (failure); the caller writes it.
 * @param {ResultsDeps} deps
 * @param {{record: HuntRecord, finding: Finding|null, nowMs: number}} args
 * @returns {Promise<{findingsKey: FindingsKey, duplicate: boolean, duplicateOf: string|null, tooLarge: boolean, evicted: string[], record: HuntRecord}>}
 */
export async function publishFindings(deps, { record, finding, nowMs }) {
  const pending = Array.isArray(record?.pendingFindings) ? record.pendingFindings : [];
  let duplicate = false;
  /** @type {string|null} */
  let duplicateOf = null;
  let tooLarge = false;
  /** @type {string[]} */
  let evicted = [];

  /** @type {FindingsKey} */
  let findingsKey;
  try {
    const counts = countsOf(record);
    if (finding) {
      counts.confirmed += 1; // this Attempt counts as confirmed
      counts.attempts += 1;
    }
    const header = {
      updatedAt: new Date(nowMs).toISOString(),
      commit: record.commit ?? null,
      huntId: record.huntId ?? null,
      counts,
    };

    const merged = await mergeTopKey(deps, {
      topKey: 'playtesterResults',
      budgetBytes: BYTE_BUDGET,
      buildOwned: (existingTop) => {
        // Reset on each call so a repeated call cannot leave stale values.
        duplicate = false;
        duplicateOf = null;
        tooLarge = false;
        evicted = [];

        let value = normalizeFindings(existingTop.findings);
        for (const p of pending) {
          const r = addFinding(value, p, header);
          value = r.value;
          evicted.push(...r.evicted);
          if (r.tooLarge) tooLarge = true;
        }
        if (finding) {
          const r = addFinding(value, finding, header);
          value = r.value;
          duplicate = r.duplicate;
          duplicateOf = r.duplicateOf;
          evicted.push(...r.evicted);
          if (r.tooLarge) tooLarge = true;
        } else {
          value = withHeader(value, header);
        }
        if (tooLarge) return { ok: false };
        return { ok: true, owned: { findings: value } };
      },
    });
    findingsKey = merged.ok ? 'ok' : merged.reason;
  } catch {
    findingsKey = 'write_failed';
  }

  if (findingsKey === 'ok') {
    return {
      findingsKey,
      duplicate,
      duplicateOf,
      tooLarge: false,
      evicted,
      record: { ...record, findingsKey, pendingFindings: [] },
    };
  }
  return {
    findingsKey,
    duplicate: false,
    duplicateOf: null,
    tooLarge: findingsKey === 'too_large' && tooLarge,
    evicted: [],
    record: { ...record, findingsKey, pendingFindings: finding ? [...pending, finding] : [...pending] },
  };
}
