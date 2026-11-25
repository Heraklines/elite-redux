/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. Tier B calc-modifier. "While the game calculates a move's power, if the move deals damage and my ally has chosen a
// damaging move for this turn, multiply the power" (Synchronized Current: both attacks of a pair get +25%).
//
// Source: plusle-minun.ts SynchronizedCurrentBothAttackPowerAbAttr (extends VariableMovePowerAbAttr, dispatched as the move-power
// hook). canApply, original clause order, is now `guards && gate` with no guard and no residual (the whole original is the gate):
//   gate  1. `move.category === STATUS` -> false          the move deals damage                      (library: move.damaging)
//   gate  2. `activeAlly(pokemon) !== undefined`          an ally is on the field and active         (no atom: R-B14-5.8)
//   gate  3. `usesDamagingMoveThisTurn(ally)`             that ally's SELECTED command this turn is a FIGHT command whose move is not a
//                                                         status move, read from `currentBattle.turnCommands` so the faster partner
//                                                         is boosted before the slower one has acted (no atom: R-B14-5.9)
// apply: `power.value *= SYNC_CURRENT_BOTH_ATTACK_MULTIPLIER` (1.25), now `this.powerMultiplier`. Nothing is random, nothing is
// remembered, nothing reads `simulated`. The class never called super.canApply (the parent only reads `skipDuringMovesetGen`, which is
// false here), and still does not; recorded in notes.
// The gate binding is LEGACY because clauses 2 and 3 have no atom. Planned tree (clause order kept; the atoms are pure reads):
//   all[ move.damaging, party.ally-chose-damaging-move ]     (R-B14-5.9 includes clause 2: the SAME first active ally)
// Class edit (pure move of code): the 1.25 is a constructor argument with the old value as default.
import { SynchronizedCurrentBothAttackPowerAbAttr } from "#data/elite-redux/abilities/plusle-minun";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SynchronizedCurrentBothAttackPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost move power (Synchronized Current style)",
  summary: params =>
    `My damaging moves have their power multiplied by ${params.multiplier} while my ally has also chosen to attack this turn. Example: 1.25 = 25% more for both of us.`,
  synonyms: [
    "synchronized current",
    "team attack boost",
    "ally attack bonus",
    "both attack boost",
    "partner attack bonus",
    "double attack bonus",
    "pair power up",
  ],
  examples: ["If both my ally and I attack this turn, each attack gets 25% more power, like Synchronized Current"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.25 = 25% more, 0.5 = half)",
      editable: true,
      default: 1.25,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [move.damaging, my ally has chosen a damaging move] (bindings.ts, legacy until R-B14-5.9). Removable: "boost every
    // damaging move" is a valid design.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "I attack in a double battle", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom reads the ally's chosen command yet), so the twin has no rebuilt attr to compare; B14/chunk5.test.ts proves the Tier B split against a literal copy of the original canApply over every state of its clauses, in a real double battle.",
  status: "decomposed",
  notes:
    "Tier B calc-modifier, effect = the library multiply-power. Users (1): Synchronized Current (5921) attr 1 (attr 0 is the marker SynchronizedCurrentAbAttr, attr 2 the heal). No guard: the original canApply had none, and the base `skipDuringMovesetGen` check was never called. The gate is a legacy binding: `party.ally-chose-damaging-move` (R-B14-5.9) is requested with the active-ally clause inside it, because the ally of clause 3 must be the same first active ally as in clause 2 (`activeAlly` is the first ally with isActive(true); the library `party.ally-exists` uses `getAlly()`, which is not active-filtered, so it is not the same test). Oddities, not fixed: (1) the boost counts the ally's SELECTED command, so it applies even if the ally is then stopped (asleep, flinched, fully paralyzed) and never attacks; (2) in a triple battle only the first active ally counts; (3) the hook runs on every power calculation including previews and the AI's, because the class ignores `simulated` (it only reads state); (4) the ability text says 'both attack', and the boost is also given to a holder whose ally targets a different foe (documented as intended in the class comment). The ability-level conditions are none.",
});
