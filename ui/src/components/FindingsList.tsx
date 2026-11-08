import { useEffect, useRef } from 'react';
import type { CopyState } from '../controller/copy';
import { COPY_UNAVAILABLE, COMMIT_UNKNOWN, FINDINGS_SENTENCE, HUNT_EMPTY, NO_HUNT, UNKNOWN, droppedText } from '../core/text';
import type { FindingsView, HuntHeader } from '../core/types';
import { FindingItem } from './FindingItem';

const count = (n: number | null): string => (n === null ? UNKNOWN : String(n));

function Header({ header }: { header: HuntHeader }) {
  const c = header.counts;
  return (
    <>
      <p>{`Last hunt: ${header.updatedAt}, commit ${header.commitShort ?? COMMIT_UNKNOWN}, hunt ${header.huntId ?? UNKNOWN}`}</p>
      <p>{`Counts: attempts: ${count(c.attempts)}, confirmed: ${count(c.confirmed)}, rejected: ${count(c.rejected)}, error: ${count(c.error)}, duplicate: ${count(c.duplicate)}, notRecorded: ${count(c.notRecorded)}`}</p>
    </>
  );
}

/** A read-only text area, focused and fully selected, for a host that gives the page no clipboard. */
function CopyFallback({ text }: { text: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
    area.current?.select();
  }, [text]);
  return (
    <div>
      <p>{COPY_UNAVAILABLE}</p>
      <textarea ref={area} readOnly defaultValue={text} aria-label="Text to copy" rows={4} />
    </div>
  );
}

interface FindingsListProps {
  findings: FindingsView;
  latestCommit: string | null;
  copyState: CopyState;
  onCopy: (text: string) => void;
}

export function FindingsList({ findings, latestCommit, copyState, onCopy }: FindingsListProps) {
  return (
    <section aria-labelledby="findings-heading">
      <h2 id="findings-heading">Findings</h2>
      <p>{FINDINGS_SENTENCE}</p>
      {findings.notice === null ? null : <p>{findings.notice}</p>}
      {!findings.present ? <p>{NO_HUNT}</p> : null}
      {findings.present && findings.header !== null ? <Header header={findings.header} /> : null}
      {findings.present && findings.items.length === 0 ? <p>{HUNT_EMPTY}</p> : null}
      {findings.items.length > 0 ? (
        <ul className="findings">
          {findings.items.map((item) => (
            <FindingItem key={item.id} item={item} latestCommit={latestCommit} onCopy={onCopy} />
          ))}
        </ul>
      ) : null}
      {findings.dropped > 0 ? <p>{droppedText(findings.dropped, 'finding', 'findings')}</p> : null}
      {copyState.kind === 'fallback' ? <CopyFallback text={copyState.text} /> : null}
    </section>
  );
}