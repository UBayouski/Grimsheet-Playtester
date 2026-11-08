// Names, paths and display limits of the Dashboard_Page. Pure: no import.

/** The App_Name (Assumption A-1). The page never reads it from the host; it only compares. */
export const APP_NAME = 'grimsheet-playtester';

/** The two routes the page reads (Requirement 1, criterion 1). */
export const CONFIG_PATH = `/api/apps/${APP_NAME}/config`;
export const CRONS_PATH = '/api/crons';

/** The key of the results in the config object. */
export const TOP_KEY = 'playtesterResults';

/** The page's own display limits (Assumption A-12) and text limits. */
export const LIMITS = {
  trend: 30,
  findings: 20,
  levels: 100,
  tokens: 40,
  tokenChars: 140,
  jobs: 50,
  levelIdChars: 80,
  classChars: 40,
  reasonChars: 60,
  statusChars: 40,
  textChars: 200,
  newEditAddresses: 8,
  addressChars: 12,
  trendLevelKeys: 100,
} as const;

/** The time limit of one route request, in milliseconds (Requirement 8, criterion 8). */
export const REQUEST_LIMIT_MS = 10_000;