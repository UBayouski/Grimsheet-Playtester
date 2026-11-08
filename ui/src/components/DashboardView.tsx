import type { CopyState } from '../controller/copy';
import { API_MISSING, LOADING, NO_REPLAY, NO_RESULTS, RESULTS_FAILED, droppedText } from '../core/text';
import type { ViewModel } from '../core/types';
import { FindingsList } from './FindingsList';
import { JobPanel } from './JobPanel';
import { LevelCard } from './LevelCard';
import { LiveRegion } from './LiveRegion';
import { ReplaySummary } from './ReplaySummary';
import { STYLE_TEXT } from './styles';
import { RunCounts } from './TrendStrip';

export interface DashboardViewProps {
  vm: ViewModel;
  inFlight: boolean;
  /** The host gave no app API: the Refresh_Button is disabled. */
  apiMissing: boolean;
  appNameNotice: string | null;
  /** The text of the polite live region. */
  liveMessage: string;
  copyState: CopyState;
  onRefresh: () => void;
  onCopy: (text: string) => void;
}

/** The whole page, from a View_Model. It reads no route and calls no hook. */
export function DashboardView({ vm, inFlight, apiMissing, appNameNotice, liveMessage, copyState, onRefresh, onCopy }: DashboardViewProps) {
  const results = vm.results;
  const readAt = vm.resultsRoute.readAt === null ? null : `${vm.resultsRoute.error === null ? 'Results read at' : 'Results last read at'} ${vm.resultsRoute.readAt}`;
  return (
    <>
      <style>{STYLE_TEXT}</style>
      <main className="gp-page" aria-labelledby="page-title">
        <h1 id="page-title">Grimsheet Playtester</h1>
        <div className="toolbar">
          <button type="button" onClick={onRefresh} aria-busy={inFlight} disabled={inFlight || apiMissing}>
            {inFlight ? 'Reading' : 'Refresh'}
          </button>
          {readAt === null ? null : <span>{` ${readAt}`}</span>}
        </div>
        {apiMissing ? <p role="alert">{API_MISSING}</p> : null}
        {appNameNotice === null ? null : <p>{appNameNotice}</p>}
        {vm.loading ? <p>{LOADING}</p> : null}
        {vm.loading ? null : (
          <>
            {vm.resultsRoute.error === null ? null : <p role="alert">{`${RESULTS_FAILED}: ${vm.resultsRoute.error}`}</p>}
            {results.hasData && !results.present ? <p>{NO_RESULTS}</p> : null}
            {results.present ? (
              <>
                {results.notice === null ? null : <p>{results.notice}</p>}
                {results.dropped.levels > 0 ? <p>{droppedText(results.dropped.levels, 'level entry', 'level entries')}</p> : null}
                {results.dropped.trend > 0 ? <p>{droppedText(results.dropped.trend, 'trend entry', 'trend entries')}</p> : null}
                {results.replay === null ? null : <ReplaySummary replay={results.replay} />}
              </>
            ) : null}
            <JobPanel job={vm.job} route={vm.jobRoute} />
            {results.present ? (
              <>
                <section aria-labelledby="levels-heading">
                  <h2 id="levels-heading">Levels</h2>
                  {results.replay === null ? <p>{NO_REPLAY}</p> : null}
                  {results.levels.length > 0 ? (
                    <ul className="cards">
                      {results.levels.map((card) => (
                        <LevelCard key={card.levelId} card={card} />
                      ))}
                    </ul>
                  ) : results.replay !== null ? (
                    <p>No level results in this run</p>
                  ) : null}
                </section>
                {results.runs.length > 0 ? (
                  <section aria-labelledby="runs-heading">
                    <h2 id="runs-heading">Runs</h2>
                    <RunCounts runs={results.runs} />
                  </section>
                ) : null}
                <FindingsList findings={results.findings} latestCommit={results.replay?.commit ?? null} copyState={copyState} onCopy={onCopy} />
              </>
            ) : null}
          </>
        )}
        <LiveRegion message={liveMessage} />
      </main>
    </>
  );
}