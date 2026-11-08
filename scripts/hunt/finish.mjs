// @ts-check
// Finish step of the exploit hunt: final counts merge, final record, pointer removal, lock release.
// See .kiro/specs/exploit-hunt/design.md, "Finish (finishHunt)".
import { releaseLock } from '../file-lock.mjs';
import { finishRecord, summaryOf } from './hunt-record.mjs';
import { clearActive, huntPaths, writeHuntRecord } from './hunt-store.mjs';
import { publishFindings } from './publish.mjs';

/** @typedef {import('./types.mjs').HuntDeps} HuntDeps */
/** @typedef {import('./types.mjs').HuntRecord} HuntRecord */

/**
 * The summary printed by the scripts: totals, refusals, whole seconds used and the findings merge outcome.
 * For a final record the seconds are counted up to `finishedAt`, so a repeated call returns the same numbers.
 * @param {HuntRecord} record
 * @param {number} nowMs
 */
function summaryFor(record, nowMs) {
  const finishedMs = typeof record.finishedAt === 'string' ? Date.parse(record.finishedAt) : NaN;
  const endMs = record.state !== 'running' && !Number.isNaN(finishedMs) ? finishedMs : nowMs;
  return { ...summaryOf(record, endMs), refusals: record.refusals, findingsKey: record.findingsKey };
}

/**
 * Final counts merge, final record, pointer removal, lock release (token checked), in this order.
 * Safe to call twice: a record that is not `running` is returned as it is and nothing is touched.
 * @param {HuntDeps & import('../results-store.mjs').ResultsDeps} deps
 * @param {{hunt: {huntId: string, token: string, readyAtMs: number, record: HuntRecord}, record: HuntRecord, state: 'complete'|'failed'|'cut-short'}} args
 * @returns {Promise<{record: HuntRecord, summary: ReturnType<typeof summaryFor>}>}
 */
export async function finishHunt(deps, { hunt, record, state }) {
  if (record.state !== 'running') return { record, summary: summaryFor(record, deps.clock.nowMs()) };

  // 1. Refresh the header counts and retry pending Findings. A failure here only sets findingsKey.
  const published = await publishFindings(deps, { record, finding: null, nowMs: deps.clock.nowMs() });

  // 2. Final record.
  const nowMs = deps.clock.nowMs();
  const final = finishRecord(published.record, { state, finishedAt: new Date(nowMs).toISOString(), failure: null });
  await writeHuntRecord(deps, final);

  // 3. Pointer.
  await clearActive(deps);

  // 4. Lock, only when it holds the Hunt token.
  await releaseLock(deps, huntPaths(deps).lockPath, hunt.token);

  return { record: final, summary: summaryFor(final, nowMs) };
}
