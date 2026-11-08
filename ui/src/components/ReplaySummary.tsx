import { COMMIT_UNKNOWN, STALE } from '../core/text';
import type { ReplayView } from '../core/types';

/** Commit, time and state of the last replay, and its failure when it failed. */
export function ReplaySummary({ replay }: { replay: ReplayView }) {
  return (
    <section aria-labelledby="replay-heading">
      <h2 id="replay-heading">Last replay</h2>
      {replay.runId === null ? null : <p>{`Run: ${replay.runId}`}</p>}
      <p>{replay.state === null ? 'State: state unknown' : `State: ${replay.state}`}</p>
      <p>
        {'Commit: '}
        {replay.commit === null ? (
          COMMIT_UNKNOWN
        ) : (
          <>
            <span title={replay.commit}>{replay.commitShort}</span>
            <span className="sr-only">{` ${replay.commit}`}</span>
          </>
        )}
      </p>
      <p>
        {'Time: '}
        <time>{replay.time}</time>
        {replay.stale ? <strong className="warning">{` ${STALE}`}</strong> : null}
      </p>
      {replay.failure === null ? null : <p>{`Failure: stage ${replay.failure.stage}, reason ${replay.failure.reasonCode}: ${replay.failure.message}`}</p>}
    </section>
  );
}