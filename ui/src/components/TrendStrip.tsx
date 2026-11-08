import { markerClass } from '../core/colour';
import { COMMIT_UNKNOWN, OLDEST_TO_NEWEST, UNKNOWN } from '../core/text';
import type { TrendCell, TrendRunView } from '../core/types';

interface TrendStripProps {
  /** Newest first, as the View_Model holds them. */
  cells: TrendCell[];
  /** The text equivalent, for example "Last 12 runs: 11 green, 1 amber". */
  text: string;
}

/** The strip is decoration with an accessible name; the text next to it is the information. */
export function TrendStrip({ cells, text }: TrendStripProps) {
  return (
    <div className="trend">
      <div role="img" aria-label={text} className="strip">
        {[...cells].reverse().map((cell, index) => (
          <span key={index} className={`cell ${markerClass(cell.colour)}`} aria-hidden="true" />
        ))}
      </div>
      <p>{`${text} (${OLDEST_TO_NEWEST})`}</p>
    </div>
  );
}

const count = (n: number | null): string => (n === null ? UNKNOWN : String(n));

/** The four counts of each run as a table, newest first (Requirement 4, criterion 13). */
export function RunCounts({ runs }: { runs: TrendRunView[] }) {
  return (
    <table className="runs">
      <caption>Counts for each run, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Run</th>
          <th scope="col">Started</th>
          <th scope="col">Commit</th>
          <th scope="col">Green</th>
          <th scope="col">Amber</th>
          <th scope="col">Red</th>
          <th scope="col">Not judged</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.runId}>
            <td>{run.runId}</td>
            <td>{run.startedAt}</td>
            <td>{run.commitShort ?? COMMIT_UNKNOWN}</td>
            <td>{count(run.counts.green)}</td>
            <td>{count(run.counts.amber)}</td>
            <td>{count(run.counts.red)}</td>
            <td>{count(run.counts.error)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}