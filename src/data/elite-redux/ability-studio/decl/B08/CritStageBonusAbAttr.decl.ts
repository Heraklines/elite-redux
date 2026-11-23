/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / calc-modifier, Tier B. Read from the source (archetypes/crit-mod.ts, the parent BonusCritAbAttr in ab-attrs.ts,
// the dispatch in field/pokemon.ts getCritStage) and from the live instances of the 8 users. canApply is now `guards && gate`:
//
//   guards  1. super.canApply(params): the parent's always-true answer                                     (kept in the class)
//   gate    2. the engine gave no pokemon or no move                                  -> true  (pass without looking at the filter)
//           3. the move filter: type, flag, move ids, maximum base power (every setting that is present)  -> false when it fails
//   apply   critStage.value += bonus. No random draw. `showAbility` is false (the parent's constructor).
//
// IMPORTANT (suspected game bug, NOT fixed): the engine asks this question as
//     applyAbAttrs("BonusCritAbAttr", { pokemon: source, critStage })       (field/pokemon.ts getCritStage)
// with NO move in the parameters, so clause 2 always answers true and the move filter of clause 3 is NEVER reached in a real
// battle. Every user therefore gives its bonus to EVERY move of the holder: Perfectionist (50 power or less), Precise Fist
// and Way of Precision (punching moves), Giant Shuriken (Water Shuriken only), Penta-Punch (Five-Star Fury only) and
// Hyper Cutter (contact moves) all act like Heaven Asunder and Strategic Pause (no filter). A rebuilt gate that really tested
// the move would CHANGE the game, so the six filtered gates are NOT rewritten as atoms: they are legacy closures with a
// reason (bindings.ts), and the library cannot even ask the question yet, because `calc.crit-stage` provides no `move`
// (request R-B08-29: pass the move at the call site AND provide the slot; the owner decides, it makes six abilities weaker).
import { CRIT_FILTER_CHOICES, critFilterCodec } from "#data/elite-redux/ability-studio/decl/B08/chunk3-choices";
import { NO_FILTER } from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";

export default defineDecl(CritStageBonusAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.crit-stage",
  label: "Land critical hits more often",
  summary: params =>
    `While the game works out the critical-hit chance of my attack, its critical-hit stage goes up by ${params.bonus} (${String(params.filter).toLowerCase()}). Example: +1 turns a 1 in 24 chance into 1 in 8.`,
  synonyms: [
    "crit chance",
    "higher crit rate",
    "super luck",
    "more critical hits",
    "crit boost",
    "critical hit stage",
    "high crit ratio",
    "precise fist",
  ],
  examples: ["Punching moves get +1 critical-hit stage, like Precise Fist"],
  params: [
    {
      id: "bonus",
      ctorIndex: 0,
      ctorOption: "bonus",
      path: "bonusAmount",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Critical-hit stages to add (1-6; 3 or more is a guaranteed critical hit)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
    {
      id: "filter",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "bonusFilter",
      control: "text",
      label: "Which moves get the bonus (set by the conditions)",
      // The move filter is the gate (one atom per user, bindings.ts): the choice decides the SHAPE of the gate.
      editable: false,
      default: NO_FILTER,
      options: CRIT_FILTER_CHOICES,
      codec: critFilterCodec,
    },
  ],
  conditions: [
    // The gate is the move filter (bindings.ts). Two users have no filter: their gate is the empty, always-true group. The
    // six filtered gates are legacy closures: the engine passes no move to this moment (see the header and the notes).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: ["bonus"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      name: "the holder attacks with a contact move, a punching move and a status move",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards && gate (a pure move of the original clauses; nothing random). The effect is a package PLACEHOLDER, written reason: the library has no effect that adds critical-hit stages (`effect.force-crit` forces a crit and writes `isCritical`, not `critStage`); request R-B08-30 asks for `effect.raise-crit-stage`. One typed setting, the stages to add. SUSPECTED GAME BUG, NOT FIXED, found by reading the dispatch: `Pokemon.getCritStage` calls applyAbAttrs('BonusCritAbAttr', { pokemon: source, critStage }) without the move, so the class's own move filter is never evaluated and ALL 8 users add their bonus to every move (the filter was meant to work: the constructor and the static matchesFilter are written for it). The test decomp/B08/chunk3-crit.test.ts drives a real getCritStage with a spy and proves the params carry no move. Users (8): Heaven Asunder (bonus 1, no filter, bound), Strategic Pause (bonus 2, no filter, bound; its own ability-level condition is copied by recompose), Hyper Cutter attr 2 (contact), Perfectionist (power 50 or less), Precise Fist and Way of Precision attr 3 (punching), Giant Shuriken attr 1 (Water Shuriken), Penta-Punch attr 3 (Five-Star Fury): these six are legacy-closure on the gate because the library cannot ask a move question at this moment and a correct-looking rewrite would change the game. Their filters ARE described as atoms in the B08 test, except Five-Star Fury, a custom move the atom cannot name (R-B08-33) (chunk3-crit.test.ts proves the four nameable forms equal matchesFilter over every registered move), so the day the engine passes the move the bindings can be switched on. Siblings (BonusCritAbAttr, which Super Luck uses) are separate classes.",
});
