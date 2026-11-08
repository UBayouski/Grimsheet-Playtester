// @ts-check
// All constants of the exploit hunt. No imports: the skill test reads this file as text.

export const LEVEL_BUDGET = 4;
export const HUNT_BUDGET = 20;
export const TIME_BUDGET_SEC = 1800;
export const REFUSAL_BUDGET = 10;
export const BEGIN_ALLOWANCE_SEC = 600;
export const LOCK_AGE_SEC = TIME_BUDGET_SEC + 600; // 2400
export const MAX_LEVELS = 20;
export const LEVEL_ID_MAX = 40; // Decision 10
export const MAX_TOKENS = 40;
export const MAX_EDITS = 4; // Decision 1
export const MAX_RAW_BYTES = 40; // Decision 2: UTF-8 bytes of the decoded raw
export const MAX_ADDRESS_CHARS = 6; // Decision 2
export const FINDINGS_MAX_ITEMS = 20;
export const FINDING_MAX_BYTES = 1536; // Decision 1
export const FINDINGS_MAX_BYTES = 16384;
export const KEEP_HUNT_RECORDS = 10;
export const KEEP_CANDIDATE_FOLDERS = 10;
export const CALL_LOCK_STALE_MS = 60000;
export const CALL_LOCK_WAIT_MS = 45000;
export const INFO_MAX_BYTES = 8192;
export const TOP_KEY = 'playtesterResults';
export const CLASSES = ['cheaper_win', 'free_win', 'unexpected_route'];
export const DEFAULT_REPO_URL = 'https://github.com/UBayouski/Grimsheet'; // same as the Launcher default
export const DEFAULT_BRANCH = 'main';
