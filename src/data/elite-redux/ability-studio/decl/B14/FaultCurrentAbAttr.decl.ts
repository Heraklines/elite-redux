/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. Tier C, the effect works as one piece. "At the end of every second turn I have been on the field, release all my
// charge stacks as a spread Electric attack on every foe, 15 base power per stack" (Fault Current).
//
// Source: electivire.ts FaultCurrentAbAttr (extends PostTurnAbAttr, dispatched at the end of every turn). It has NO `canApply`
// (the parent's is `true`); every clause is in `apply`, in this order:
//   1. `if (simulated || !pokemon.isActive(true)) return`        a preview or a Pokemon that left the field does nothing
//   2. `turns = incrementActiveTurns(pokemon)`                   WRITE: the holder's counter of turns on the field goes up by one
//                                                                 (a WeakMap in charge-stack.ts; reset by `erFaultCurrentOnLeaveField`
//                                                                 when the holder leaves the field, called from `pokemon.ts`)
//   3. `if (turns % FAULT_CURRENT_PERIOD !== 0) return`          only every 2nd turn
//   4. `stacks = getCharge(pokemon)`; `if (stacks <= 0) return`  nothing to release without a charge
//   5. `opponents = getOpponents().filter(isActive)`; `if none, return`    at least one foe is standing
//   6. `clearCharge(pokemon)`                                    WRITE: all stacks are spent
//   7. `move = scriptedPokemonMove(DISCHARGE, 15 * stacks)`; for every foe, in order: `foe.getAttackDamage({source, move})`, and when
//      the damage is above 0, `foe.damageAndUpdate(damage, {source, result})` (the damage formula runs with type effectiveness;
//      no move phase, no accuracy roll, no secondary effects, no ability flyout)
// Nothing is random in this class.
// WHY THE CONDITIONS STAY IN THE CLASS: clause 2 is a state write that must happen on EVERY end of turn the holder is active, also
// when clauses 4 and 5 stop the discharge later. A gate in `canApply` runs first and would skip `apply` (and so the write) whenever
// the stacks or the foes are missing, which would shift the every-second-turn cycle. Splitting them out is therefore not a pure move
// of code. The three rules are listed under feasibility and requested as atoms (R-B14-6.7 every Nth turn on the field, R-B14-6.2
// charge stacks, R-B14-6.8 a foe is standing) so the librarian can offer them once the counter can be read without being advanced.
// Class edit (pure move of code): a constructor `(period = 2, powerPerStack = 15, moveId = DISCHARGE)`; `apply` reads the fields.
import { FaultCurrentAbAttr } from "#data/elite-redux/abilities/electivire";
import { moveNameCodec } from "#data/elite-redux/ability-studio/decl/B14/chunk6-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FaultCurrentAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.end-of-turn",
  label: "Release all charge stacks as a spread attack every few turns",
  summary: params =>
    `Every ${params.period} turns on the field I spend all my charge stacks to hit every foe like ${params.move} at ${params.powerPerStack} base power per stack. Example: 3 stacks x 15 = 45 base power.`,
  synonyms: [
    "fault current",
    "discharge the charge",
    "release stored power",
    "spread attack every other turn",
    "spend all stacks",
    "charge blast",
    "delayed discharge",
  ],
  examples: ["Every second turn on the field I spend my charge stacks on a spread Electric attack, like Fault Current"],
  params: [
    {
      id: "period",
      ctorIndex: 0,
      path: "period",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Release every this many turns on the field (2 = every second turn)",
      editable: true,
      default: 2,
    },
    {
      id: "powerPerStack",
      ctorIndex: 1,
      path: "powerPerStack",
      control: "number",
      min: 1,
      max: 60,
      step: 1,
      integer: true,
      label: "Base power added per spent stack (15 = 60 with a full charge)",
      editable: true,
      default: 15,
    },
    {
      id: "move",
      ctorIndex: 2,
      path: "moveId",
      control: "text",
      label: "Attack to copy for type and damage (its name, for example Discharge)",
      editable: true,
      default: "Discharge",
      codec: moveNameCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Counts only the end-of-turn checks where I am on the field; the count starts again when I leave the field",
    "Only releases when I hold at least one charge stack",
    "Needs at least one foe still standing; every foe still standing is hit, with its type matchup",
    "Does nothing while the game is only previewing",
    "Hits straight through the damage formula: no accuracy roll, no extra effects of the copied move",
  ],
  effect: { id: "effect.package", params: ["period", "powerPerStack", "move"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "the turn ends with no stacks", axes: {} }],
  l2StaticReason:
    "A battle twin needs charge stacks, which no scenario axis can build; B14/chunk6.test.ts drives apply directly with stacks over several turns (counter, release, spend, damage, preview, leaving the field).",
  status: "decomposed",
  notes:
    "Package, Tier C. Reason: the effect is a small state machine (a turns-on-the-field counter that advances on every active end of turn, the charge store, and a direct damage loop over the foes) whose clauses are interleaved with two state writes, so they cannot be moved into a gate without changing the cycle (see the header). Params are typed: the period, the power per stack and the copied move are constructor arguments now (defaults 2, 15, Discharge; behaviour identical). Users (1): Fault Current (5926), its only attr. Requests: R-B14-6.1 (an effect that spends the charge counter), R-B14-6.2 (a charge-stack atom), R-B14-6.7 (an every-Nth-active-turn atom with its own reset), R-B14-6.8 (a foe is standing) and R-B14-6.9 (an effect that hits every foe through the damage formula with a base power taken from a count). The count is reset by `erFaultCurrentOnLeaveField`, called from `Pokemon` when the holder leaves the field; that engine hook finds the store, not the class, so it is not affected by a rebuilt attr but it is part of the behaviour. Oddities, not fixed: (1) the discharge ignores accuracy, Protect and ability flyouts because it calls the damage formula directly (the code comment says a MovePhase at the end of the turn does not run reliably); (2) with a period of 1 every turn is a discharge turn.",
});
