// @ts-check
// Typedefs only for the exploit-hunt (see .kiro/specs/exploit-hunt/design.md). No run-time code.
// CheckResult, CheckOk and CheckError are re-declared here from .kiro/specs/verifier/design.md,
// not imported from the verifier (only scripts/hunt/deps.mjs imports the verifier).

/**
 * Hunt dependencies: the replay's Deps without `verifier`, plus `checkCandidate`.
 * @typedef {Omit<import('../replay/types.mjs').Deps, 'verifier'> & {
 *   checkCandidate: (levelId: unknown, stored: unknown, claimedClass: unknown,
 *                    actions: unknown, exitCode: unknown, play: unknown) => CheckResult,
 * }} HuntDeps
 */

/** @typedef {'cheaper_win'|'free_win'|'unexpected_route'} ClaimedClass */

/** @typedef {{kind:'move', dir:'N'|'S'|'E'|'W'} | {kind:'wait'} | {kind:'undo'} | {kind:'edit', address:string, raw:string}} Action */

/** @typedef {{ok:true, actions:Action[]} | {ok:false, detail:string}} ParsedActions */

/** @typedef {'running'|'complete'|'failed'|'cut-short'} HuntState */

/** @typedef {'refusal'|'none'} Charge */

/**
 * What an orchestrator returns. `body` is printed with `exitStatus` (= `exit`) added as the last key.
 * @typedef {{exit: 0|3|4, body: Record<string, unknown>}} HuntResult
 */

/**
 * Per-level counters inside a Hunt_Record (also the shape of `levels` in the Hunt_End output).
 * @typedef {Object} LevelCounts
 * @property {number} attempts
 * @property {number} confirmed
 * @property {number} rejected
 * @property {number} error
 * @property {number} duplicate
 * @property {number} notRecorded
 */

/**
 * @typedef {Object} HuntRecord   data\hunts\hunt-<stamp>.json
 * @property {1} schemaVersion
 * @property {string} huntId
 * @property {HuntState} state
 * @property {string} startedAt
 * @property {string|null} readyAt   the Time_Budget starts here; null until ready
 * @property {string|null} finishedAt
 * @property {string} repoUrl
 * @property {string} branch
 * @property {string|null} commit
 * @property {{perLevel: number, total: number, seconds: number, refusals: number}} budget
 * @property {number} levelsSkipped
 * @property {number} attempts
 * @property {number} refusals
 * @property {Record<string, LevelCounts>} levels   keyed by level id
 * @property {Record<string, number>} reasonCodes   reason code to count
 * @property {FindingsKeyOutcome|null} findingsKey
 * @property {Finding[]} pendingFindings   confirmed Findings the merge could not store yet
 * @property {import('../replay/types.mjs').Failure|null} failure
 */

/** @typedef {'ok'|'lock_timeout'|'config_unreadable'|'too_large'|'write_failed'} FindingsKeyOutcome */

/**
 * data\hunts\active.json
 * @typedef {Object} ActivePointer
 * @property {1} schemaVersion
 * @property {string} huntId
 * @property {string} token
 * @property {string} readyAt
 */

/**
 * The measured part of a Finding (copied from a confirmed CheckOk).
 * @typedef {Object} FindingResult
 * @property {boolean} won
 * @property {number} inkSpent
 * @property {number} minimalInk
 * @property {number} editCount
 * @property {string[]} newEditAddresses
 * @property {string} reasonCode   always 'class_reproduced'
 */

/**
 * One verified exploit. `actions` are canonical tokens.
 * @typedef {Object} Finding
 * @property {string} id   Hunt_Id, a dash and the three-digit Attempt number
 * @property {string} levelId
 * @property {ClaimedClass} class
 * @property {string} commit
 * @property {string} huntId
 * @property {string} foundAt
 * @property {string[]} actions
 * @property {FindingResult} result
 */

/**
 * The six counts of Requirement 10, criterion 5. `attempts` is the sum of the other five.
 * @typedef {Object} FindingsCounts
 * @property {number} attempts
 * @property {number} confirmed
 * @property {number} rejected
 * @property {number} error
 * @property {number} duplicate
 * @property {number} notRecorded
 */

/**
 * The `findings` sub-key of `playtesterResults`.
 * @typedef {Object} FindingsValue
 * @property {1} schemaVersion
 * @property {string} updatedAt
 * @property {string|null} commit
 * @property {string|null} huntId
 * @property {FindingsCounts} counts
 * @property {Finding[]} items   Newest first
 */

/**
 * @typedef {Object} CheckOk
 * @property {string} levelId
 * @property {ClaimedClass} claimedClass
 * @property {'confirmed'|'rejected'} outcome
 * @property {string} reasonCode
 * @property {string} reason
 * @property {boolean} won
 * @property {number} inkSpent
 * @property {number} minimalInk
 * @property {number} editCount
 * @property {string[]} newEditAddresses
 */

/**
 * @typedef {Object} CheckError
 * @property {string} [levelId]
 * @property {string} [claimedClass]
 * @property {'error'} outcome
 * @property {string} reasonCode
 * @property {string} reason
 */

/** @typedef {CheckOk | CheckError} CheckResult */

/**
 * The decision of `decideSubmit` (budget.mjs): an Attempt, or a refusal with one reason code.
 * @typedef {{kind: 'attempt', levelId: string, claimedClass: ClaimedClass, actions: Action[]}
 *   | {kind: 'refuse',
 *      reasonCode: 'no_active_hunt'|'refusal_budget_spent'|'bad_arguments'|'unknown_level'|'level_budget_spent'|'total_budget_spent'|'time_budget_spent',
 *      charge: Charge, finish: boolean, detail?: string}} SubmitDecision
 */

/**
 * What is left of the budgets. `level` is null when no level applies.
 * @typedef {Object} Left
 * @property {number|null} level
 * @property {number} total
 * @property {number} refusals
 * @property {number} seconds
 */

/**
 * The short play block printed in a Hunt_Submit result.
 * @typedef {Object} PlaySummary
 * @property {number} steps
 * @property {string} finalStatus
 * @property {number} finalHp
 * @property {number|null} firstRefused
 * @property {{step: number, status: string}|null} firstStatusChange
 */

export {};
