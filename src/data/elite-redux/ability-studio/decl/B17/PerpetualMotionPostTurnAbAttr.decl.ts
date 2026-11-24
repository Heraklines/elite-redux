/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Perpetual Motion, second of five attrs (the end-of-turn half). Read by hand: fakemon-pitch-mechanics.ts
// `PerpetualMotionPostTurnAbAttr`, its base PostTurnAbAttr (always true, dispatched at the end of every turn), `scriptedPokemonMove`
// and `ScriptedMoveMarkerAttr` (archetypes/scripted-move-util.ts), and the siblings (Trigger, Resolution here; Progress, Power in B14).
//
// canApply, clause by clause, in the order they run (`canApply = guards && gate && residual`):
//   1. guard        I have not fainted: `!pokemon.isFainted()`                                         -> `guards`, guard not-fainted
//   2. condition    I have been out for at least one turn: `pokemon.tempSummonData.turnCount > 0`     -> `gate`, atom time.turn-count (>= 1)
//   3. feasibility  the Trigger half left its marker this turn: turnData.erAbilityProvenance includes
//                   "perpetual-motion:trigger"                                                         -> `residual` (the coupling to the Trigger block)
// apply, unless simulated, in this order: remove the marker; pick the first living foe (none: stop, the marker is already used up);
// if a Rollout chain was already pending, reset the streak to 0; mark the chain pending; queue an INDIRECT Rollout MovePhase with
// the typed power, the marker "perpetual-motion" and the consecutive-use power stripped. No random draw.
import { PerpetualMotionPostTurnAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PerpetualMotionPostTurnAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.end-of-turn",
  label: "Hit the foe with a follow-up Rollout at the end of the turn",
  summary: params =>
    `At the end of the turn, if my attack landed earlier this turn, I use a follow-up Rollout of power ${params.power} on the first foe still standing. Example: 20 means power 20.`,
  synonyms: [
    "perpetual motion",
    "rollout",
    "free rollout",
    "end of turn attack",
    "extra move at turn end",
    "keep rolling",
  ],
  examples: ["Roll into the foe with a free Rollout at the end of every turn in which I landed a hit"],
  params: [
    {
      id: "power",
      ctorIndex: 0,
      path: "power",
      control: "number",
      label: "Power of the follow-up Rollout (20 = a move of power 20)",
      editable: true,
      // Only the effect reads it; the gate (turns out) never repeats the number.
      gateIndependent: true,
      default: 20,
      min: 1,
      max: 250,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The gate: "I have been out for at least one turn". Bound in bindings.ts.
    { slot: "gate", ctx: "params", lib: "time.turn-count", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "My attack must have landed earlier this turn: the matching 'mark that my attack landed' block leaves a marker that this block uses up",
    "A foe must still be standing, otherwise nothing is queued (the marker is used up anyway)",
    "It never queues anything for a preview (a simulated end of turn)",
  ],
  effect: { id: "effect.package", params: ["power"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [
    {
      // Quiet turns: with no marker nothing happens at any point of the grid. The marked case (a landed hit, then the queued
      // Rollout and its chain state) is driven in penta-perpetual.test.ts because the shared grid cannot arm a marker.
      name: "quiet turn at full and half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B with a PACKAGE effect. Written reason it cannot be split further: the effect is one ordered, stateful sequence (use up the marker, find the first living foe, reset the streak if a chain was already pending, mark the chain pending, queue a Rollout that carries the marker 'perpetual-motion' and has its consecutive-use power stripped). The library's effect.scripted-move cannot reproduce it: it has no marker option, no 'strip consecutive-use power' option, it needs the foe that was hit (here there is none: the first living foe is picked) and it writes none of the chain state that the Progress, Power and Resolution attrs read (request R14). Typed param: power (the Rollout's power, 1-250). The Rollout itself and the marker names are fixed. The marker check (clause 3) stays as `residual` because it is the coupling between the two halves, not a design choice, and `apply` tests it again; requests R3/R15 name the library atom and effect for the marker memory. Users: Perpetual Motion (6022, attr 1) only. The turn-count gate has the exact atom `time.turn-count` (>= 1 turn, same field tempSummonData.turnCount). Oddity, not a bug: apply removes the marker BEFORE it looks for a foe, so when no foe is standing the marker is lost with no Rollout. No game bug found.",
});
