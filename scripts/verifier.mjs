// @ts-check
// Pure verifier for Grimsheet play output (see .kiro/specs/verifier/). No I/O, no clock, no
// randomness, no environment, no imports. Inputs are read, never changed.

/** @typedef {{kind:'move', dir:'N'|'S'|'E'|'W'} | {kind:'wait'} | {kind:'edit', address:string, raw:string} | {kind:'undo'}} Action */
/** @typedef {'cheaper_win'|'free_win'|'unexpected_route'} ExploitClass */
/** @typedef {{levelId:string, minimalInk:number, actions:Action[]}} StoredSolution */
/** @typedef {{status:string, ink:number, hp:number}} PlayState  start and final also carry hero, turn, monsters; ignored */
/** @typedef {{index?:number, action:Action, accepted:boolean, hp?:number, ink?:number, status:string, reason?:string, message?:string}} Step */
/** @typedef {{levelId?:string, start:PlayState, steps:Step[], final:PlayState, refusedAt?:number}} PlayResult */
/** @typedef {'green'|'amber'|'red'} Colour */

/**
 * @typedef {'bad_input'|'play_failed'|'malformed_play_result'|'level_mismatch'|'malformed_solution'
 *   |'unknown_class'|'malformed_candidate'|'replay_mismatch'|'internal_error'
 *   |'class_reproduced'|'not_won'|'no_ink_below_zero'|'minimal_ink_zero'|'not_cheaper'|'has_edits'|'no_new_cell'} ReasonCode
 */

/**
 * @typedef {{levelId:string, colour:Colour, won:boolean, endHp:number, inkSpent:number,
 *   minimalInk:number, statusChangeIndex:number|null, refusedAt:number|null}} ReplayOk
 */
/** @typedef {{levelId?:string, colour:'error', reasonCode:ReasonCode, reason:string}} ReplayError */
/** @typedef {ReplayOk | ReplayError} ReplayVerdict */

/**
 * @typedef {{levelId:string, claimedClass:ExploitClass, outcome:'confirmed'|'rejected', reasonCode:ReasonCode,
 *   reason:string, won:boolean, inkSpent:number, minimalInk:number, editCount:number,
 *   newEditAddresses:string[]}} CheckOk
 */
/** @typedef {{levelId?:string, claimedClass?:string, outcome:'error', reasonCode:ReasonCode, reason:string}} CheckError */
/** @typedef {CheckOk | CheckError} CheckResult */

/** Fixed reason text per code (the design's reason-code table). @type {Record<ReasonCode, string>} */
const REASON_TEXT = {
  bad_input: 'The play command rejected its input (exit code 2).',
  play_failed: 'The play command failed (unexpected exit code).',
  malformed_play_result: 'The play output is missing fields or has values that cannot be judged.',
  level_mismatch: 'The level id does not match between the call, the play output and the stored solution.',
  malformed_solution:
    'The stored solution is missing, has no actions list, has an invalid minimalInk, or holds an action of unknown kind.',
  unknown_class: 'The claimed class is not cheaper_win, free_win or unexpected_route.',
  malformed_candidate: 'The candidate is not a list of actions of known kinds.',
  replay_mismatch: 'The play output is not the replay of these actions.',
  internal_error: 'The verifier hit an internal fault.',
  class_reproduced: 'The replay reproduces the claimed class.',
  not_won: 'The replay did not win.',
  no_ink_below_zero: 'minimalInk is 0, so no win can cost less.',
  minimal_ink_zero: 'minimalInk is 0, so a win with no edits is not a free win.',
  not_cheaper: 'The win spent at least minimalInk ink.',
  has_edits: 'The candidate contains edit actions, so it is not a free win.',
  no_new_cell: 'Every kept edit is on a cell the stored solution also edits.',
};

const DIRS = ['N', 'S', 'E', 'W'];

/** The exploit classes in a fixed order (also the order measured classes are named). @type {ExploitClass[]} */
const EXPLOIT_CLASSES = ['cheaper_win', 'free_win', 'unexpected_route'];

/**
 * True for a non-null, non-array object.
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * True when `a` is an action of a known kind with the fields that kind needs.
 * @param {unknown} a
 * @returns {boolean}
 */
function isKnownAction(a) {
  if (!isObject(a)) return false;
  switch (a.kind) {
    case 'move':
      return typeof a.dir === 'string' && DIRS.includes(a.dir);
    case 'wait':
    case 'undo':
      return true;
    case 'edit':
      return typeof a.address === 'string' && typeof a.raw === 'string';
    default:
      return false;
  }
}

/**
 * Trim and upper-case a cell address. Strings only.
 * @param {string} address
 * @returns {string}
 */
function normaliseAddress(address) {
  return address.trim().toUpperCase();
}

/**
 * Builds a replay error outcome. `levelId` is included only when it is a string; no key is ever
 * set to `undefined`.
 * @param {ReasonCode} reasonCode
 * @param {unknown} levelId
 * @returns {ReplayError}
 */
function errorOutcome(reasonCode, levelId) {
  const reason = REASON_TEXT[reasonCode];
  return typeof levelId === 'string'
    ? { levelId, colour: 'error', reasonCode, reason }
    : { colour: 'error', reasonCode, reason };
}

/**
 * Validation steps 1 to 6 of the design's order. Uses `typeof`, `Array.isArray` and property reads
 * on values already known to be objects, so it does not throw on plain data.
 * @param {unknown} levelId
 * @param {unknown} stored
 * @param {unknown} exitCode
 * @param {unknown} play
 * @returns {ReasonCode | null} the reason code of the first failing step, or null
 */
function validateCommon(levelId, stored, exitCode, play) {
  // 1. levelId
  if (typeof levelId !== 'string') return 'level_mismatch';
  // 2. exit code
  if (exitCode === 2) return 'bad_input';
  if (exitCode !== 0) return 'play_failed';
  // 3. play result shape, numbers, steps, ink spent
  if (!isObject(play) || !isObject(play.start) || !isObject(play.final) || !Array.isArray(play.steps)) {
    return 'malformed_play_result';
  }
  if (
    !Number.isFinite(play.start.ink) ||
    !Number.isFinite(play.final.ink) ||
    !Number.isFinite(play.final.hp) ||
    typeof play.final.status !== 'string'
  ) {
    return 'malformed_play_result';
  }
  for (const step of play.steps) {
    if (!isObject(step) || !isObject(step.action) || typeof step.accepted !== 'boolean') {
      return 'malformed_play_result';
    }
  }
  if (play.start.ink - play.final.ink < 0) return 'malformed_play_result';
  // 4. play result level id
  if (play.levelId !== undefined && play.levelId !== levelId) return 'level_mismatch';
  // 5. stored solution
  if (
    !isObject(stored) ||
    !Array.isArray(stored.actions) ||
    !Number.isInteger(stored.minimalInk) ||
    stored.minimalInk < 0 ||
    !stored.actions.every(isKnownAction)
  ) {
    return 'malformed_solution';
  }
  // 6. stored solution level id
  if (stored.levelId !== levelId) return 'level_mismatch';
  return null;
}

/**
 * Ink spent in a play: the ink at the start minus the ink at the end.
 * @param {any} play
 * @returns {number}
 */
function inkSpent(play) {
  return play.start.ink - play.final.ink;
}

/**
 * Index of the first step whose status differs from the one before it (from `start.status` for the
 * first step), or null when no step changes the status.
 * @param {any} play
 * @returns {number | null}
 */
function statusChangeIndex(play) {
  let prev = play.start.status;
  for (let i = 0; i < play.steps.length; i += 1) {
    const status = play.steps[i].status;
    if (status !== prev) return i;
    prev = status;
  }
  return null;
}

/**
 * True when the steps are the replay of the actions: same count, and each step action equals the
 * action at the same position in `kind`, in `dir` for a move, and in `address` and `raw` for an edit.
 * Compared exactly (no normalisation); other fields are ignored.
 * @param {any[]} actions
 * @param {any[]} steps
 * @returns {boolean}
 */
function actionsMatchSteps(actions, steps) {
  if (actions.length !== steps.length) return false;
  for (let i = 0; i < actions.length; i += 1) {
    const a = actions[i];
    const s = steps[i].action;
    if (s.kind !== a.kind) return false;
    if (a.kind === 'move' && s.dir !== a.dir) return false;
    if (a.kind === 'edit' && (s.address !== a.address || s.raw !== a.raw)) return false;
  }
  return true;
}

/**
 * The refused action index: the play's `refusedAt` when it is a non-negative integer, else the
 * position of the first step with `accepted === false`, else null.
 * @param {any} play
 * @returns {number | null}
 */
function refusedAtOf(play) {
  if (Number.isInteger(play.refusedAt) && play.refusedAt >= 0) return play.refusedAt;
  const i = play.steps.findIndex((/** @type {any} */ s) => s.accepted === false);
  return i >= 0 ? i : null;
}

/**
 * Normalised addresses of the edits that changed a cell, in step order. A refused edit changed
 * nothing. An accepted edit is also skipped when the next accepted step after it is an accepted
 * `undo` (the one-step undo reverts it); refused steps in between are passed over.
 * Step actions must already have been matched to known actions (so edit addresses are strings).
 * @param {any[]} steps
 * @returns {string[]}
 */
function acceptedEditAddresses(steps) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    if (!(s.accepted && s.action.kind === 'edit')) continue;
    let j = i + 1;
    while (j < steps.length && !steps[j].accepted) j += 1;
    if (j < steps.length && steps[j].action.kind === 'undo') continue;
    out.push(normaliseAddress(s.action.address));
  }
  return out;
}

/**
 * Accepted edit addresses that the stored solution never edits: normalised, without duplicates,
 * in default string order. Copies before sorting, so no input array is changed.
 * @param {any[]} storedActions
 * @param {any[]} steps
 * @returns {string[]}
 */
function newEditAddresses(storedActions, steps) {
  const storedEdits = new Set(
    storedActions.filter((a) => a.kind === 'edit').map((a) => normaliseAddress(a.address)),
  );
  return [...new Set(acceptedEditAddresses(steps).filter((address) => !storedEdits.has(address)))].sort();
}

/**
 * Builds a candidate-check error outcome. `levelId` and `claimedClass` are included only when they
 * are strings; no key is ever set to `undefined`.
 * @param {ReasonCode} reasonCode
 * @param {unknown} levelId
 * @param {unknown} claimedClass
 * @returns {CheckError}
 */
function checkErrorOutcome(reasonCode, levelId, claimedClass) {
  return {
    ...(typeof levelId === 'string' ? { levelId } : {}),
    ...(typeof claimedClass === 'string' ? { claimedClass } : {}),
    outcome: 'error',
    reasonCode,
    reason: REASON_TEXT[reasonCode],
  };
}

/**
 * Candidate check: does the replay of an agent's actions reproduce the claimed exploit class?
 * @param {unknown} levelId
 * @param {unknown} storedSolution
 * @param {unknown} claimedClass     ExploitClass when valid
 * @param {unknown} candidateActions Action[] when valid
 * @param {unknown} exitCode
 * @param {unknown} playResult       replay of candidateActions
 * @returns {CheckResult}
 */
function checkCandidateInner(levelId, storedSolution, claimedClass, candidateActions, exitCode, playResult) {
  const invalid = validateCommon(levelId, storedSolution, exitCode, playResult);
  if (invalid !== null) return checkErrorOutcome(invalid, levelId, claimedClass);
  // 7. claimed class
  if (claimedClass !== 'cheaper_win' && claimedClass !== 'free_win' && claimedClass !== 'unexpected_route') {
    return checkErrorOutcome('unknown_class', levelId, claimedClass);
  }
  // 8. candidate actions
  if (!Array.isArray(candidateActions) || !candidateActions.every(isKnownAction)) {
    return checkErrorOutcome('malformed_candidate', levelId, claimedClass);
  }
  // 9. the play must be the replay of the candidate actions
  const stored = /** @type {StoredSolution} */ (storedSolution);
  const play = /** @type {any} */ (playResult);
  if (!actionsMatchSteps(candidateActions, play.steps)) {
    return checkErrorOutcome('replay_mismatch', levelId, claimedClass);
  }
  // 10. decide
  const won = play.final.status === 'won';
  const spent = inkSpent(play);
  const minimalInk = stored.minimalInk;
  const edits = newEditAddresses(stored.actions, play.steps);
  const editCount = candidateActions.filter((a) => a.kind === 'edit').length;
  /**
   * @param {'confirmed'|'rejected'} outcome
   * @param {ReasonCode} reasonCode
   * @returns {CheckOk}
   */
  const result = (outcome, reasonCode) => ({
    levelId: stored.levelId,
    claimedClass,
    outcome,
    reasonCode,
    reason: REASON_TEXT[reasonCode],
    won,
    inkSpent: spent,
    minimalInk,
    editCount,
    newEditAddresses: edits,
  });
  if (!won) return result('rejected', 'not_won');
  // Which classes the replay meets (design: Class tests). Used only to word a rejection.
  /** @type {Record<ExploitClass, boolean>} */
  const meets = {
    cheaper_win: spent < minimalInk && minimalInk > 0,
    free_win: editCount === 0 && minimalInk > 0,
    unexpected_route: edits.length > 0,
  };
  /**
   * A rejection from a class branch: the reason ends with the other classes that apply.
   * The reason code is the claimed class's code, whatever is measured.
   * @param {ReasonCode} reasonCode
   * @returns {CheckOk}
   */
  const rejectedWithMeasured = (reasonCode) => {
    const others = EXPLOIT_CLASSES.filter((c) => c !== claimedClass && meets[c]);
    const suffix =
      others.length === 0
        ? 'Measured class: none.'
        : others.length === 1
          ? `Measured class: ${others[0]}.`
          : `Measured classes: ${others[0]} and ${others[1]}.`;
    return { ...result('rejected', reasonCode), reason: `${REASON_TEXT[reasonCode]} ${suffix}` };
  };
  switch (claimedClass) {
    case 'cheaper_win':
      if (minimalInk === 0) return result('rejected', 'no_ink_below_zero');
      return meets.cheaper_win ? result('confirmed', 'class_reproduced') : rejectedWithMeasured('not_cheaper');
    case 'free_win':
      if (minimalInk === 0) return result('rejected', 'minimal_ink_zero');
      return meets.free_win ? result('confirmed', 'class_reproduced') : rejectedWithMeasured('has_edits');
    default:
      return meets.unexpected_route ? result('confirmed', 'class_reproduced') : rejectedWithMeasured('no_new_cell');
  }
}

/**
 * Replay verdict for one stored solution.
 * @param {unknown} levelId
 * @param {unknown} storedSolution   StoredSolution when valid
 * @param {unknown} exitCode         number when valid
 * @param {unknown} playResult       PlayResult when valid
 * @returns {ReplayVerdict}
 */
function replayVerdictInner(levelId, storedSolution, exitCode, playResult) {
  const invalid = validateCommon(levelId, storedSolution, exitCode, playResult);
  if (invalid !== null) return errorOutcome(invalid, levelId);
  // validateCommon proved the shapes; the casts below only tell the type checker.
  const stored = /** @type {StoredSolution} */ (storedSolution);
  const play = /** @type {any} */ (playResult);
  // 9. the play must be the replay of the stored actions
  if (!actionsMatchSteps(stored.actions, play.steps)) {
    return errorOutcome('replay_mismatch', levelId);
  }
  // 10. decide
  const won = play.final.status === 'won';
  const spent = inkSpent(play);
  /** @type {Colour} */
  let colour = 'red';
  if (won) colour = spent === stored.minimalInk ? 'green' : 'amber';
  return {
    levelId: stored.levelId,
    colour,
    won,
    endHp: play.final.hp,
    inkSpent: spent,
    minimalInk: stored.minimalInk,
    statusChangeIndex: statusChangeIndex(play),
    refusedAt: refusedAtOf(play),
  };
}

/**
 * Replay verdict for one stored solution. A thin wrapper: any throw in the inner function becomes an
 * `internal_error` outcome, so one bad input cannot abort a whole run. The catch result is built with
 * `typeof` checks only, so building it cannot throw.
 * @param {unknown} levelId
 * @param {unknown} storedSolution   StoredSolution when valid
 * @param {unknown} exitCode         number when valid
 * @param {unknown} playResult       PlayResult when valid
 * @returns {ReplayVerdict}
 */
export function replayVerdict(levelId, storedSolution, exitCode, playResult) {
  try {
    return replayVerdictInner(levelId, storedSolution, exitCode, playResult);
  } catch {
    return errorOutcome('internal_error', levelId);
  }
}

/**
 * Candidate check: does the replay of an agent's actions reproduce the claimed exploit class? A thin
 * wrapper around `checkCandidateInner`, with the same safety net as `replayVerdict`.
 * @param {unknown} levelId
 * @param {unknown} storedSolution
 * @param {unknown} claimedClass     ExploitClass when valid
 * @param {unknown} candidateActions Action[] when valid
 * @param {unknown} exitCode
 * @param {unknown} playResult       replay of candidateActions
 * @returns {CheckResult}
 */
export function checkCandidate(levelId, storedSolution, claimedClass, candidateActions, exitCode, playResult) {
  try {
    return checkCandidateInner(levelId, storedSolution, claimedClass, candidateActions, exitCode, playResult);
  } catch {
    return checkErrorOutcome('internal_error', levelId, claimedClass);
  }
}