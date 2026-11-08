// Validation of the Findings_Value written by the hunt: header, items, order and caps.
// Total: a bad item is dropped and counted, and its siblings are kept.
import { LIMITS } from './constants';
import { clip, getOwn, isRecord, readBool, readCount, readString } from './json';
import { parseSchema } from './results';
import { TIME_UNKNOWN } from './text';
import { formatUtc, parseTime } from './time';
import { actionsFileText, decodeActions, replayCommand } from './tokens';
import type { FindingView, FindingsView, HuntHeader } from './types';

const CLASS_LABELS: Record<string, string> = {
  cheaper_win: 'Cheaper win',
  free_win: 'Free win',
  unexpected_route: 'Unexpected route',
};

function readCommit(value: unknown): { commit: string | null; commitShort: string | null } {
  const text = readString(value);
  if (text === null || text === '') return { commit: null, commitShort: null };
  return { commit: text, commitShort: text.slice(0, 7) };
}

function parseHeader(record: Record<string, unknown>): HuntHeader {
  const updatedAt = readString(getOwn(record, 'updatedAt'));
  const counts = getOwn(record, 'counts');
  const count = (key: string): number | null => (isRecord(counts) ? readCount(getOwn(counts, key)) : null);
  const huntId = readString(getOwn(record, 'huntId'));
  return {
    updatedAt: updatedAt === null ? TIME_UNKNOWN : formatUtc(parseTime(updatedAt)),
    ...readCommit(getOwn(record, 'commit')),
    huntId: huntId === null ? null : clip(huntId, LIMITS.levelIdChars),
    counts: {
      attempts: count('attempts'),
      confirmed: count('confirmed'),
      rejected: count('rejected'),
      error: count('error'),
      duplicate: count('duplicate'),
      notRecorded: count('notRecorded'),
    },
  };
}

interface Candidate {
  view: FindingView;
  foundMs: number | null;
}

function parseItem(item: unknown): Candidate | null {
  if (!isRecord(item)) return null;
  const id = readString(getOwn(item, 'id'));
  const levelId = readString(getOwn(item, 'levelId'));
  const cls = readString(getOwn(item, 'class'));
  const foundAt = readString(getOwn(item, 'foundAt'));
  const actions = getOwn(item, 'actions');
  if (id === null || id === '' || levelId === null || levelId === '' || cls === null || foundAt === null) return null;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > LIMITS.tokens) return null;
  const tokens: string[] = [];
  for (const token of actions) {
    if (typeof token !== 'string' || token.length > LIMITS.tokenChars) return null;
    tokens.push(token);
  }
  const resultRaw = getOwn(item, 'result');
  const result = isRecord(resultRaw) ? resultRaw : {};
  const addresses = getOwn(result, 'newEditAddresses');
  const decoded = decodeActions(tokens);
  const classKey = clip(cls, LIMITS.classChars);
  const foundMs = parseTime(foundAt);
  const levelIdClipped = clip(levelId, LIMITS.levelIdChars);
  return {
    foundMs,
    view: {
      id: clip(id, LIMITS.levelIdChars + 40),
      levelId: levelIdClipped,
      classKey,
      classLabel: Object.prototype.hasOwnProperty.call(CLASS_LABELS, classKey) ? (CLASS_LABELS[classKey] as string) : classKey,
      ...readCommit(getOwn(item, 'commit')),
      foundAt: formatUtc(foundMs),
      tokens,
      tokensText: tokens.join(' '),
      replayCommand: replayCommand(levelIdClipped),
      actionsFileText: decoded === null ? null : actionsFileText(decoded),
      result: {
        won: readBool(getOwn(result, 'won')),
        inkSpent: readCount(getOwn(result, 'inkSpent')),
        minimalInk: readCount(getOwn(result, 'minimalInk')),
        editCount: readCount(getOwn(result, 'editCount')),
        newEditAddresses: Array.isArray(addresses)
          ? addresses
              .filter((a): a is string => typeof a === 'string')
              .slice(0, LIMITS.newEditAddresses)
              .map((a) => clip(a, LIMITS.addressChars))
          : [],
      },
    },
  };
}

/** The findings view of the `findings` sub-key. */
export function parseFindings(value: unknown): FindingsView {
  if (value === undefined) return { present: false, notice: null, header: null, items: [], dropped: 0 };
  if (!isRecord(value)) return { present: false, notice: null, header: null, items: [], dropped: 1 };

  const notice = parseSchema(getOwn(value, 'schemaVersion'));
  const header = parseHeader(value);
  const rawItems = getOwn(value, 'items');
  if (rawItems === null && !Object.prototype.hasOwnProperty.call(value, 'items')) return { present: true, notice, header, items: [], dropped: 0 };
  if (!Array.isArray(rawItems)) return { present: true, notice, header, items: [], dropped: 1 };

  let dropped = 0;
  const valid: Candidate[] = [];
  for (const item of rawItems) {
    const parsed = parseItem(item);
    if (parsed === null) dropped += 1;
    else valid.push(parsed);
  }
  // Newest first: foundAt descending (an unparseable time last), then id descending.
  valid.sort((a, b) => {
    if (a.foundMs !== b.foundMs) {
      if (a.foundMs === null) return 1;
      if (b.foundMs === null) return -1;
      return b.foundMs - a.foundMs;
    }
    return a.view.id === b.view.id ? 0 : a.view.id < b.view.id ? 1 : -1;
  });
  const seen = new Set<string>();
  const unique = valid.filter(({ view }) => {
    const key = `${view.levelId}\u0000${view.classKey}\u0000${view.tokensText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  dropped += Math.max(0, unique.length - LIMITS.findings);
  return { present: true, notice, header, items: unique.slice(0, LIMITS.findings).map((c) => c.view), dropped };
}

/** True when both commits are non-empty strings and differ: the finding was made on an earlier commit. */
export function isEarlierCommit(latestCommit: string | null | undefined, findingCommit: string | null | undefined): boolean {
  return typeof latestCommit === 'string' && latestCommit !== '' && typeof findingCommit === 'string' && findingCommit !== '' && latestCommit !== findingCommit;
}