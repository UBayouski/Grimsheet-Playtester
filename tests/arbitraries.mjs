// @ts-check
// fast-check arbitraries for the verifier tests (see .kiro/specs/verifier/design.md, "Arbitraries").
import * as fc from 'fast-check';

/** @typedef {'won'|'lost'|'other'} PlayMode */

export const LEVEL_IDS = [
  '01-the-corridor',
  '02-the-chaser',
  '03-the-locked-crypt',
  '04-the-trap-row',
  '05-the-lich',
];

export const CLASSES = ['cheaper_win', 'free_win', 'unexpected_route'];

const DIRS = ['N', 'S', 'E', 'W'];

/** @type {fc.Arbitrary<string>} */
export const arbLevelId = fc.constantFrom(...LEVEL_IDS);

/** Cell addresses on a small grid: A1..C20. @type {fc.Arbitrary<string>} */
export const arbAddress = fc
  .tuple(fc.constantFrom('A', 'B', 'C'), fc.integer({ min: 1, max: 20 }))
  .map(([col, row]) => `${col}${row}`);

/**
 * One action: move, wait, edit or undo. Every call builds fresh objects.
 * @type {fc.Arbitrary<any>}
 */
export const arbAction = fc.oneof(
  fc.record({ kind: fc.constant('move'), dir: fc.constantFrom(...DIRS) }),
  fc.constantFrom('wait').map((kind) => ({ kind })),
  fc.record({
    kind: fc.constant('edit'),
    address: arbAddress,
    raw: fc.string({ maxLength: 8 }),
  }),
  fc.constantFrom('undo').map((kind) => ({ kind })),
);

/**
 * A stored solution for one level.
 * @param {string} levelId
 * @returns {fc.Arbitrary<any>}
 */
export function arbStored(levelId) {
  return fc.record({
    levelId: fc.constant(levelId),
    minimalInk: fc.nat({ max: 4 }),
    actions: fc.array(arbAction, { maxLength: 12 }),
  });
}

/**
 * The Step `action` echo: only kind, dir (move), address and raw (edit), as Grimsheet copies it.
 * @param {any} a
 * @returns {any}
 */
function echoAction(a) {
  if (a.kind === 'move') return { kind: 'move', dir: a.dir };
  if (a.kind === 'edit') return { kind: 'edit', address: a.address, raw: a.raw };
  return { kind: a.kind };
}

/**
 * Builds a consistent Play_Result for an action list: one step per action, `final` equal to the last
 * step, ink spent below, equal to or above `minimalInk`. `mode` sets the end status.
 * `minimalInk` is a fourth parameter (not in the task text) because "below, equal or above" needs it.
 * `spendKinds` (fifth, optional) limits which of the three are generated; the default is all three.
 * @param {string} levelId
 * @param {any[]} actions
 * @param {PlayMode} mode
 * @param {number} [minimalInk]
 * @param {Array<'below'|'equal'|'above'>} [spendKinds]
 * @returns {fc.Arbitrary<any>}
 */
export function arbPlayFor(levelId, actions, mode, minimalInk = 1, spendKinds = ['below', 'equal', 'above']) {
  const n = actions.length;
  return fc
    .record({
      spendKind: fc.constantFrom(...spendKinds),
      below: fc.nat({ max: Math.max(0, minimalInk - 1) }),
      extra: fc.integer({ min: 1, max: 3 }),
      slack: fc.nat({ max: 3 }),
      startHp: fc.integer({ min: 1, max: 5 }),
      refused: fc.array(
        fc.integer({ min: 0, max: 9 }).map((x) => x === 0),
        { minLength: n, maxLength: n },
      ),
    })
    .map((g) => {
      let spent = minimalInk;
      if (g.spendKind === 'below' && minimalInk > 0) spent = g.below;
      else if (g.spendKind === 'above') spent = minimalInk + g.extra;
      const startInk = spent + g.slack;
      const finalStatus = mode === 'won' ? 'won' : mode === 'lost' ? 'lost' : 'playing';
      const endHp = mode === 'lost' ? 0 : g.startHp;
      const steps = actions.map((a, i) => {
        const last = i === n - 1;
        /** @type {any} */
        const step = { index: i, action: echoAction(a), accepted: !g.refused[i] };
        if (g.refused[i]) {
          step.reason = 'refused-for-test';
          step.message = 'The action was refused.';
        }
        step.damage = [];
        step.hero = 'A1';
        step.hp = last ? endHp : g.startHp;
        step.ink = startInk - Math.round((spent * (i + 1)) / n);
        step.turn = i + 1;
        step.status = last ? finalStatus : 'playing';
        return step;
      });
      const start = { hero: 'A1', hp: g.startHp, ink: startInk, turn: 0, status: 'playing', monsters: [] };
      const lastStep = steps[n - 1];
      const final = lastStep
        ? { hero: lastStep.hero, hp: lastStep.hp, ink: lastStep.ink, turn: lastStep.turn, status: lastStep.status, monsters: [] }
        : { hero: 'A1', hp: endHp, ink: startInk - spent, turn: 0, status: finalStatus, monsters: [] };
      /** @type {any} */
      const play = { levelId, start, steps };
      const refusedAt = g.refused.indexOf(true);
      if (refusedAt >= 0) play.refusedAt = refusedAt;
      play.final = final;
      play.sheet = [];
      return play;
    });
}

/** @type {fc.Arbitrary<PlayMode>} */
const arbMode = fc.constantFrom('won', 'lost', 'other');

/**
 * Valid replay input: `[levelId, stored, 0, play]`, the play built from `stored.actions`, with the end
 * status mode drawn from `modes`. Valid by construction (chains, never `fc.pre`).
 * @param {fc.Arbitrary<PlayMode>} modes
 * @returns {fc.Arbitrary<any[]>}
 */
export function arbReplayInputFor(modes) {
  return arbLevelId.chain((levelId) =>
    arbStored(levelId).chain((stored) =>
      modes.chain((mode) =>
        arbPlayFor(levelId, stored.actions, mode, stored.minimalInk).map((play) => [levelId, stored, 0, play]),
      ),
    ),
  );
}

/**
 * Valid replay input with any end status.
 * @type {fc.Arbitrary<any[]>}
 */
export const arbReplayInput = arbReplayInputFor(arbMode);

/**
 * Valid candidate input: `[levelId, stored, claimedClass, candidate, 0, play]`, the play built from the
 * candidate, with the end status mode drawn from `modes`. The candidate is a fresh action list, or
 * sometimes a copy of the stored actions.
 * @param {fc.Arbitrary<PlayMode>} modes
 * @returns {fc.Arbitrary<any[]>}
 */
export function arbCandidateInputFor(modes) {
  return arbLevelId.chain((levelId) =>
    arbStored(levelId).chain((stored) =>
      fc.constantFrom(...CLASSES).chain((claimedClass) =>
        fc
          .oneof(
            { weight: 3, arbitrary: fc.array(arbAction, { maxLength: 12 }) },
            { weight: 1, arbitrary: fc.constant(null).map(() => structuredClone(stored.actions)) },
          )
          .chain((candidate) =>
            modes.chain((mode) =>
              arbPlayFor(levelId, candidate, mode, stored.minimalInk).map((play) => [
                levelId,
                stored,
                claimedClass,
                candidate,
                0,
                play,
              ]),
            ),
          ),
      ),
    ),
  );
}

/**
 * Valid candidate input with any end status.
 * @type {fc.Arbitrary<any[]>}
 */
export const arbCandidateInput = arbCandidateInputFor(arbMode);
/**
 * Anything in each argument position, for the "never throws" property. Use the first 4 values for
 * `replayVerdict` and all 6 for `checkCandidate`.
 * @type {fc.Arbitrary<any[]>}
 */
export const arbAnything = fc.tuple(
  fc.anything(),
  fc.anything(),
  fc.anything(),
  fc.anything(),
  fc.anything(),
  fc.anything(),
);

// ---------------------------------------------------------------------------------------------
// Breakers: each turns a valid input into one broken input and names the reason code it must give.
// A breaker is only offered for an input it applies to, so every broken input is built by
// construction (no `fc.pre`).
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{levelId:any, stored:any, claimedClass:any, candidate:any, exitCode:any, play:any}} Ctx
 * @typedef {{name:string, code:string, scope:'both'|'candidate', applies:(ctx:Ctx)=>boolean, apply:(ctx:Ctx)=>void}} Breaker
 * @typedef {{args:any[], expectedCode:string|null, breaker:string|null}} MaybeBroken
 */

/**
 * @param {any[]} args
 * @param {boolean} isCandidate
 * @returns {Ctx}
 */
function toCtx(args, isCandidate) {
  return isCandidate
    ? { levelId: args[0], stored: args[1], claimedClass: args[2], candidate: args[3], exitCode: args[4], play: args[5] }
    : { levelId: args[0], stored: args[1], claimedClass: undefined, candidate: undefined, exitCode: args[2], play: args[3] };
}

/**
 * @param {Ctx} ctx
 * @param {boolean} isCandidate
 * @returns {any[]}
 */
function fromCtx(ctx, isCandidate) {
  return isCandidate
    ? [ctx.levelId, ctx.stored, ctx.claimedClass, ctx.candidate, ctx.exitCode, ctx.play]
    : [ctx.levelId, ctx.stored, ctx.exitCode, ctx.play];
}

/**
 * @param {string} levelId
 * @returns {string}
 */
function otherLevel(levelId) {
  return LEVEL_IDS.find((id) => id !== levelId) ?? 'other-level';
}

/**
 * A step that matches no action: used to make the step count differ.
 * @param {any} play
 * @returns {any}
 */
function extraStep(play) {
  return {
    index: play.steps.length,
    action: { kind: 'wait' },
    accepted: true,
    status: 'playing',
    ink: play.final.ink,
    hp: play.final.hp,
  };
}

/**
 * @param {Ctx} ctx
 * @returns {number}
 */
function firstEditStep(ctx) {
  return ctx.play.steps.findIndex((/** @type {any} */ s) => s.action.kind === 'edit');
}

const always = () => true;

/** @type {Breaker[]} */
export const BREAKERS = [
  { name: 'exit_code_2', code: 'bad_input', scope: 'both', applies: always, apply: (c) => { c.exitCode = 2; } },
  { name: 'exit_code_1', code: 'play_failed', scope: 'both', applies: always, apply: (c) => { c.exitCode = 1; } },
  { name: 'exit_code_string', code: 'play_failed', scope: 'both', applies: always, apply: (c) => { c.exitCode = '0'; } },
  { name: 'play_start_deleted', code: 'malformed_play_result', scope: 'both', applies: always, apply: (c) => { delete c.play.start; } },
  { name: 'play_final_null', code: 'malformed_play_result', scope: 'both', applies: always, apply: (c) => { c.play.final = null; } },
  { name: 'play_steps_null', code: 'malformed_play_result', scope: 'both', applies: always, apply: (c) => { c.play.steps = null; } },
  { name: 'final_ink_nan', code: 'malformed_play_result', scope: 'both', applies: always, apply: (c) => { c.play.final.ink = Number.NaN; } },
  { name: 'negative_ink_spent', code: 'malformed_play_result', scope: 'both', applies: always, apply: (c) => { c.play.final.ink = c.play.start.ink + 1; } },
  { name: 'play_level_other', code: 'level_mismatch', scope: 'both', applies: always, apply: (c) => { c.play.levelId = otherLevel(c.levelId); } },
  { name: 'solution_level_other', code: 'level_mismatch', scope: 'both', applies: always, apply: (c) => { c.stored.levelId = otherLevel(c.levelId); } },
  { name: 'minimal_ink_negative', code: 'malformed_solution', scope: 'both', applies: always, apply: (c) => { c.stored.minimalInk = -1; } },
  { name: 'minimal_ink_fraction', code: 'malformed_solution', scope: 'both', applies: always, apply: (c) => { c.stored.minimalInk = 1.5; } },
  { name: 'stored_actions_missing', code: 'malformed_solution', scope: 'both', applies: always, apply: (c) => { delete c.stored.actions; } },
  { name: 'stored_action_unknown_kind', code: 'malformed_solution', scope: 'both', applies: always, apply: (c) => { c.stored.actions.push({ kind: 'teleport' }); } },
  { name: 'unknown_class', code: 'unknown_class', scope: 'candidate', applies: always, apply: (c) => { c.claimedClass = 'speed_run'; } },
  { name: 'candidate_action_unknown_kind', code: 'malformed_candidate', scope: 'candidate', applies: always, apply: (c) => { c.candidate.push({ kind: 'teleport' }); } },
  { name: 'step_action_changed', code: 'replay_mismatch', scope: 'both', applies: (c) => c.play.steps.length > 0, apply: (c) => {
      const step = c.play.steps[0];
      const a = step.action;
      if (a.kind === 'move') a.dir = a.dir === 'N' ? 'S' : 'N';
      else if (a.kind === 'edit') a.raw = `${a.raw}x`;
      else if (a.kind === 'wait') step.action = { kind: 'undo' };
      else step.action = { kind: 'wait' };
    } },
  { name: 'step_dropped', code: 'replay_mismatch', scope: 'both', applies: (c) => c.play.steps.length > 0, apply: (c) => { c.play.steps.pop(); } },
  { name: 'step_added', code: 'replay_mismatch', scope: 'both', applies: always, apply: (c) => { c.play.steps.push(extraStep(c.play)); } },
  { name: 'address_case_flipped', code: 'replay_mismatch', scope: 'both', applies: (c) => firstEditStep(c) >= 0, apply: (c) => {
      const step = c.play.steps[firstEditStep(c)];
      step.action.address = step.action.address.toLowerCase();
    } },
];

/**
 * Always-broken inputs: one applicable breaker per input, with the code it must give.
 * @param {fc.Arbitrary<any[]>} arbArgs
 * @param {boolean} isCandidate
 * @returns {fc.Arbitrary<MaybeBroken>}
 */
function arbBrokenFrom(arbArgs, isCandidate) {
  return arbArgs.chain((args) => {
    const ctx = toCtx(args, isCandidate);
    const usable = BREAKERS.filter((b) => (isCandidate || b.scope === 'both') && b.applies(ctx));
    return fc.constantFrom(...usable).map((b) => {
      const copy = structuredClone(ctx);
      b.apply(copy);
      return { args: fromCtx(copy, isCandidate), expectedCode: b.code, breaker: b.name };
    });
  });
}

/**
 * About 15% broken inputs; the rest are valid with `expectedCode: null`.
 * @param {fc.Arbitrary<any[]>} arbArgs
 * @param {boolean} isCandidate
 * @returns {fc.Arbitrary<MaybeBroken>}
 */
function arbMixedFrom(arbArgs, isCandidate) {
  return fc.oneof(
    { weight: 85, arbitrary: arbArgs.map((args) => ({ args, expectedCode: null, breaker: null })) },
    { weight: 15, arbitrary: arbBrokenFrom(arbArgs, isCandidate) },
  );
}

/** Replay inputs, always broken, with the expected reason code. @type {fc.Arbitrary<MaybeBroken>} */
export const arbReplayInputBroken = arbBrokenFrom(arbReplayInput, false);

/** Replay inputs, about 15% broken (`expectedCode` is `null` for an unbroken one). @type {fc.Arbitrary<MaybeBroken>} */
export const arbReplayInputMixed = arbMixedFrom(arbReplayInput, false);

/** Candidate inputs, always broken, with the expected reason code. @type {fc.Arbitrary<MaybeBroken>} */
export const arbCandidateInputBroken = arbBrokenFrom(arbCandidateInput, true);

/** Candidate inputs, about 15% broken (`expectedCode` is `null` for an unbroken one). @type {fc.Arbitrary<MaybeBroken>} */
export const arbCandidateInputMixed = arbMixedFrom(arbCandidateInput, true);
