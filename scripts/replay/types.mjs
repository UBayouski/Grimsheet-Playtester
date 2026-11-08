// @ts-check
// Typedefs only for the replay-runner (see .kiro/specs/replay-runner/design.md). No run-time code.
// ReplayOk and ReplayError are declared here, not imported from ../verifier.mjs (design, Overview).

/**
 * @typedef {Object} ProcSpec
 * @property {string} command
 * @property {string[]} args
 * @property {string} cwd
 * @property {boolean} shell
 * @property {number} timeoutMs
 * @property {string} label
 */

/**
 * @typedef {Object} ProcResult
 * @property {number|null} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 * @property {string|null} startError
 */

/** @typedef {(spec: ProcSpec) => Promise<ProcResult>} StartProcess */

/**
 * The subset of node:fs/promises the runner uses. All methods return promises.
 * `writeFile` takes `{flag: 'wx'}` for an exclusive create (error code `EEXIST`).
 * @typedef {Object} Fs
 * @property {(path: string, encoding: 'utf8') => Promise<string>} readFile
 * @property {(path: string, data: string, options?: string | {encoding?: string, flag?: string}) => Promise<void>} writeFile
 * @property {(from: string, to: string) => Promise<void>} rename
 * @property {(path: string, options?: {force?: boolean, recursive?: boolean}) => Promise<void>} rm
 * @property {(path: string, options?: {recursive?: boolean}) => Promise<unknown>} mkdir
 * @property {(path: string) => Promise<string[]>} readdir
 * @property {(path: string) => Promise<{mtimeMs: number, size: number, isDirectory(): boolean, isFile(): boolean}>} stat
 * @property {(path: string, mode: number) => Promise<void>} chmod
 * @property {(path: string) => Promise<string>} realpath
 */

/**
 * A verdict for a level that was judged (the eight fields of the verifier's ReplayOk).
 * @typedef {Object} ReplayOk
 * @property {string} levelId
 * @property {'green'|'amber'|'red'} colour
 * @property {boolean} won
 * @property {number} endHp
 * @property {number} inkSpent
 * @property {number} minimalInk
 * @property {number|null} statusChangeIndex
 * @property {number|null} refusedAt
 */

/**
 * A verdict for unusable input (the verifier's ReplayError).
 * @typedef {Object} ReplayError
 * @property {string} [levelId]
 * @property {'error'} colour
 * @property {string} reasonCode
 * @property {string} reason
 */

/**
 * One entry of a Run_Record `levels` list: a ReplayOk's fields, or an error entry with a runner or
 * verifier reason code. `timedOut` is present only when true.
 * @typedef {Object} LevelEntry
 * @property {string} levelId
 * @property {'green'|'amber'|'red'|'error'} colour
 * @property {boolean} [won]
 * @property {number} [endHp]
 * @property {number} [inkSpent]
 * @property {number} [minimalInk]
 * @property {number|null} [statusChangeIndex]
 * @property {number|null} [refusedAt]
 * @property {string} [reasonCode]
 * @property {string} [reason]
 * @property {true} [timedOut]
 */

/**
 * @typedef {Object} Coverage
 * @property {number} listed
 * @property {number} played
 * @property {number} noSolution
 * @property {number} unreadable
 * @property {number} unlisted
 * @property {string[]} duplicateListedLevels
 * @property {string[]} unlistedSolutions
 */

/**
 * @typedef {Object} Failure
 * @property {'checkout'|'install'|'build'|'list'|'replay'|'record'} stage
 * @property {string} reasonCode
 * @property {string} message
 * @property {number|null} exitCode
 * @property {string} [step]   only for the reason code step_timeout
 */

/** @typedef {'running'|'complete'|'failed'|'cut-short'} RunState */
/** @typedef {'ok'|'too_large'|'config_unreadable'|'lock_timeout'|'write_failed'} ResultsKeyOutcome */

/**
 * @typedef {Object} RunRecord   data\runs\run-NNNNNN.json
 * @property {1} schemaVersion
 * @property {string} runId
 * @property {number} counter
 * @property {RunState} state
 * @property {string} startedAt
 * @property {string|null} finishedAt
 * @property {string} repoUrl
 * @property {string} branch
 * @property {string|null} commit
 * @property {LevelEntry[]} levels
 * @property {Coverage} coverage
 * @property {Failure|null} failure
 * @property {{outcome: string, finishedAt: string|null}|null} previousLaunch
 * @property {ResultsKeyOutcome|null} resultsKey
 * @property {number} green
 * @property {number} amber
 * @property {number} red
 * @property {number} error
 */

/**
 * @typedef {Object} IndexEntry
 * @property {string} runId
 * @property {number} counter
 * @property {RunState} state
 * @property {string} startedAt
 * @property {string|null} finishedAt
 * @property {string|null} commit
 * @property {number} green
 * @property {number} amber
 * @property {number} red
 * @property {number} error
 */

/**
 * @typedef {Object} IndexFile   data\_index.json
 * @property {1} schemaVersion
 * @property {number} lastCounter
 * @property {IndexEntry[]} runs   at most 30, Newest first
 */

/**
 * @typedef {Object} TrendEntry
 * @property {string} runId
 * @property {number} counter
 * @property {RunState} state
 * @property {string} startedAt
 * @property {string|null} commit
 * @property {number} green
 * @property {number} amber
 * @property {number} red
 * @property {number} error
 * @property {Record<string, string>} levels   level id to colour
 */

/**
 * The compact `latest` form of a Run_Record.
 * @typedef {Object} CompactRun
 * @property {string} runId
 * @property {number} counter
 * @property {RunState} state
 * @property {string} startedAt
 * @property {string|null} finishedAt
 * @property {string|null} commit
 * @property {string} repoUrl
 * @property {string} branch
 * @property {Failure|null} failure
 * @property {Coverage} coverage
 * @property {Array<{levelId: string, colour: string, endHp?: number, inkSpent?: number, minimalInk?: number, reasonCode?: string, timedOut?: true}>} levels
 */

/**
 * The sub-keys the replay owns inside `playtesterResults`.
 * @typedef {Object} ResultsKey
 * @property {1} schemaVersion
 * @property {string} updatedAt
 * @property {CompactRun} latest
 * @property {TrendEntry[]} trend
 */

/**
 * Everything that does I/O is reached through this object, so tests can pass fakes.
 * @typedef {Object} Deps
 * @property {{nowMs(): number}} clock
 * @property {(ms: number) => Promise<void>} sleep
 * @property {Fs} fs
 * @property {{appFolder: string, dataFolder: string, localAppData: string}} paths
 * @property {StartProcess} spawn
 * @property {(levelId: unknown, stored: unknown, exitCode: unknown, play: unknown) => ReplayOk|ReplayError} verifier
 * @property {() => string} token   32 hex characters
 * @property {number} pid
 * @property {string} appName
 * @property {(text: string) => void} [logStderr]   Writes to the Replay_Script's stderr (data\launcher\last-child.log). Absent: nothing is printed.
 * @property {'win32'|'other'} platform
 */

export {};
