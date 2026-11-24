/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Somniloquy. Read by hand: fakemon-pitch-mechanics.ts `SomniloquyPostTurnAbAttr`, its base PostTurnAbAttr (ab-attrs.ts,
// canApply always true, apply empty), the dispatch `applyAbAttrs("PostTurnAbAttr", { pokemon })` in turn-end-phase.ts, and the
// helper `scriptedPokemonMove` (archetypes/scripted-move-util.ts).
//
// canApply, clause by clause, in the order they run (the split is `canApply = guards && gate`):
//   1. guard      I am still standing: `!pokemon.isFainted()`                                   -> `guards`, guard not-fainted
//   2. condition  I have been out for a turn or more: `(tempSummonData?.turnCount ?? 0) > 0`      -> `gate`, atom time.turn-count (gte 1)
//   3. condition  it is every Nth turn: `turn % 2 === 0`                                          -> `gate`, NO ATOM (request R26)
//   4. condition  I have not already acted on this turn number: `!summonData.erAbilityProvenance.includes("somniloquy:" + turn)`
//                                                                                                  -> `gate`, atom R3 (marker in switch-in memory, key with the turn number)
// apply, unless simulated: push "somniloquy:<turn>" into summonData.erAbilityProvenance, then find the first foe that is not fainted
// (`getOpponents().find`); if there is none, stop (the marker stays written); else queue a MovePhase of the move (Sleep Talk) at that
// foe through `scriptedPokemonMove(moveId)` with MoveUseMode.INDIRECT. No random draw.
import { SomniloquyPostTurnAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MoveId } from "#enums/move-id";

const moveNameCodec = enumCodec(MoveId, "move");

export default defineDecl(SomniloquyPostTurnAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.end-of-turn",
  label: "Use a move on the first foe every few turns",
  summary: params =>
    `Every ${params.everyTurns} turns I am out, at the end of the turn I use ${params.moveId} on the first foe still standing. Example: 2 means every other turn.`,
  synonyms: [
    "somniloquy",
    "sleep talk",
    "free move every other turn",
    "automatic move",
    "periodic move",
    "end of turn move",
  ],
  examples: ["Use Sleep Talk at the end of every 2nd turn", "Every third turn, use Rest for free on the first foe"],
  params: [
    {
      id: "everyTurns",
      ctorIndex: 0,
      path: "everyTurns",
      control: "number",
      label: "Acts every this many turns out (2 = every 2nd turn)",
      editable: true,
      default: 2,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
    {
      id: "moveId",
      ctorIndex: 1,
      path: "moveId",
      control: "text",
      label: "Move it uses (type the move name, for example Sleep Talk)",
      editable: true,
      gateIndependent: true,
      default: "SLEEP_TALK",
      // Staff may type the move the way players write it ("Sleep Talk"); the codec turns it into the move's name in the game data.
      codec: {
        toCtor: value => moveNameCodec.toCtor(String(value).trim().toUpperCase().replace(/[ -]+/g, "_")),
        fromInstance: raw => moveNameCodec.fromInstance(raw),
      },
    },
  ],
  // The "every Nth turn" condition of the gate repeats `everyTurns` as a literal once a library binding exists (proposed atom of request R26).
  gateParams: [{ param: "everyTurns", block: "time.turn-count-multiple", field: "n" }],
  conditions: [
    // The gate: all[time.turn-count gte 1, <every Nth turn (R26)>, not <marker "somniloquy:turn" is set (R3)>], in that order.
    // The middle and last clause have no atom yet, so the whole gate is legacy-closure-pending-request.
    {
      slot: "gate",
      ctx: "params",
      lib: "time.turn-count, plus requests R26 (every Nth turn) and R3 (a marker with the turn number is set)",
      removable: true,
      editable: true,
    },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "A foe must still be standing, otherwise nothing is used (the turn is still marked as done)",
    "It never uses the move for a preview (a simulated turn end)",
    "The used move is a real move: the move itself decides whether it can work (for Sleep Talk, its own conditions)",
  ],
  effect: { id: "effect.package", params: ["moveId"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [
    {
      // The grid holder has been out for a short time and never has the turn marker; the turn counter and the marker are driven by
      // hand in test/.../B17/chunk3.test.ts.
      name: "end of turn with a healthy and a half-health holder",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, PACKAGE for the effect only, with a written reason: effect.scripted-move cannot express it. It needs the 'other' slot (the end of the turn has none), uses a fixed move at default power with no power override, picks 'the first foe still standing' instead of the foe that was hit, and writes a turn marker in the same step; request R35 extends effect.scripted-move with those options. The trigger (end of turn) and every condition are separate blocks. The two literals of the old class (every 2nd turn and Sleep Talk) are now the constructor arguments `everyTurns` and `moveId` with those defaults, so Somniloquy is unchanged and both are typed settings. Source edit (pure move of code, spec 3.1): `isFainted` moved into a `guards` method and the other three clauses into `gate`, keeping the old order; all are pure reads. The gate is legacy-closure-pending-request (R26 every Nth turn, R3 marker with the turn number). Users: Somniloquy (6058, attr 0) only. Oddity, not a bug: the marker is written before the foe check, so a turn with no foe left still counts as done. The class does not test that the holder is asleep: the effect is a scripted Sleep Talk whose own move conditions decide; this was not changed or probed here.",
});
