// Every fixed phrase of the page, in one place. Tests quote the literal wording of the requirements.

export const LOADING = 'Reading results';
export const NO_RESULTS = 'No results yet. The nightly replay has not written any results.';
export const NO_REPLAY = 'No replay run recorded yet';
export const NO_HUNT = 'No hunt has run yet';
export const HUNT_EMPTY = 'The last hunt found no exploits';
export const RESULTS_FAILED = 'Results could not be read';
export const JOB_UNAVAILABLE = 'Replay job state is unavailable';
export const JOB_NOT_REGISTERED = 'The replay job is not registered';
export const API_MISSING = 'Kiro Crew did not provide the app API';
export const STALE = 'The last replay is older than 36 hours';
export const COPIED = 'Copied';
export const COPY_UNAVAILABLE = 'Copy is not available here. Select the text and press Ctrl+C.';
export const RESULTS_UPDATED = 'Results updated';
export const UNKNOWN_COLOUR = 'Unknown colour';
export const TIME_UNKNOWN = 'time unknown';
export const COMMIT_UNKNOWN = 'commit unknown';
export const FINDINGS_SENTENCE =
  'Every finding was reproduced by replaying its action list. The hunt is a bounded search, not a proof that no cheaper win exists.';
export const REPLAY_HELP =
  'Run it in a Grimsheet checkout after npm ci and npm run build:play (play.mjs stops with "Run npm run build:play first" without the bundle), with the path of a file that holds the Actions_File_Text.';
export const EARLIER_COMMIT = 'found on an earlier commit';
export const LEVEL_ID_INVALID = 'level id not valid';
export const NOT_CONVERTIBLE = 'action list could not be converted to a file';
export const NO_DETAIL = 'no detail in the last run';
export const INK_NOT_RECORDED = 'ink not recorded';
export const TIMED_OUT = 'play timed out';
export const OLDEST_TO_NEWEST = 'oldest to newest';
export const RUNNING_NOW = 'replay running now';
export const CONSECUTIVE_FAILURES = 'consecutive failures';
export const PAUSED = 'paused';
export const READING = 'Reading';
export const UNKNOWN = 'unknown';
export const NO_RUNS = 'No runs recorded';
export const REQUEST_FAILED = 'The request failed';
export const REQUEST_TOO_SLOW = 'The request took longer than 10 seconds';
/** "2 findings could not be read" or "1 finding could not be read". */
export function droppedText(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural} could not be read`;
}
