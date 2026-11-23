/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 5 / calc-modifier (Tier A: both tests are constructor closures).
//
// Read by hand from archetypes/stab-suppress-aura.ts. It extends MovePowerBoostAbAttr, so the trigger is "while the game
// calculates a move's power" (dispatch key MovePowerBoostAbAttr), and the Pokemon whose ability it is is the ATTACKER (the engine
// asks the attacker's own abilities). The real "no STAB for others" rule of Relic Stone is NOT this class: it is the engine
// capability RELIC_STONE_STAB_SUPPRESSION read in Pokemon.calculateStabMultiplier (pokemon.ts around line 5750), which returns a
// bonus of 1 for any attacker other than a holder. This class adds a second, separate effect (see the notes).
// Constructor `(auraCondition?, ownTypeCondition?, suppression = 1 / 1.5)`; `super(combined, 1)` (the parent's multiplier is not
// used), no banner. Before this change the constructor took nothing and the two tests sat inside `apply`; they are now the parent's
// condition, in the SAME order (aura test first), so `apply` only runs for a move that is really suppressed (all pure reads, no
// random draw, `simulated` is not looked at):
//   1. another battler on the field (not fainted, not the attacker) has the attacker's ability, as its ability or its passive
//        (CONDITION: ctor:0, no library atom yet, request R-B11-C5-02)
//   2. the move's resolved type is one of the attacker's types, Tera type counted: `getTypes(true).includes(getMoveType(move))`
//        (CONDITION: ctor:1, no library atom yet, request R-B11-C5-01)
//   apply: `power.value *= suppression` (default 1 / 1.5: cancels the 1.5 bonus). The library effect "multiply the move's power".
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STAB_SUPPRESSION_MULTIPLIER, StabSuppressAuraAbAttr } from "#data/elite-redux/archetypes/stab-suppress-aura";

export default defineDecl(StabSuppressAuraAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Cut the power of my same-type moves to cancel their bonus",
  summary: params =>
    `While another Pokemon on the field has my ability, my same-type moves have their power multiplied by ${Number(params.suppression).toFixed(2)} (cancels the usual 1.5 bonus). Example: a field with no STAB.`,
  synonyms: [
    "no stab",
    "cancel stab",
    "remove same type bonus",
    "stab suppression",
    "relic stone",
    "titan",
    "other battlers lose stab",
  ],
  examples: ["Same-type moves lose their 1.5 bonus while another holder is on the field", "Cancel STAB for everyone"],
  params: [
    {
      id: "suppression",
      ctorIndex: 2,
      path: "suppression",
      control: "number",
      min: 0.1,
      max: 1,
      step: 0.01,
      label: "Power multiplier for my same-type moves (0.67 = two thirds, cancels the 1.5 bonus)",
      editable: true,
      default: STAB_SUPPRESSION_MULTIPLIER,
    },
  ],
  conditions: [
    // Another battler on the field has the same ability as I do (legacy closure, request R-B11-C5-02).
    { slot: "ctor:0", ctx: "attack", path: "auraCondition", removable: true, editable: true },
    // The move's type is one of my own types, Tera type counted (legacy closure, request R-B11-C5-01).
    { slot: "ctor:1", ctx: "attack", path: "ownTypeCondition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The other Pokemon must be on the field and not fainted, and have the same ability as its normal or passive ability",
    "The type is the move's type after abilities such as Aerilate have changed it",
  ],
  effect: { id: "effect.multiply-power", params: ["suppression"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my moves against a foe that uses a Normal move and a Water move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, justified in the header (the two tests moved from apply into the parent condition, same order, no behaviour change: canApply is now false where apply used to return without doing anything; the power is the same, only the 'applied' bookkeeping differs). Users: Relic Stone (5567 attr 0; its attr 1 is the engine capability that does the real work) and Titan (5934 attr 1). Both closures of both users are legacy closures (requests R-B11-C5-01 and R-B11-C5-02). Suspected game bug, NOT fixed: the class runs only when the ATTACKER owns the ability and looks for ANOTHER battler with the same ability, so it only does something when two Relic Stone (or Titan) holders are on the field at once; in that case the engine capability already cancels both holders' STAB (calculateStabMultiplier returns 1 when another holder is out), so the holder's same-type move is cut twice (x1/1.5 on top of no bonus). Alone on the field the class never acts, and it never lowers an ENEMY's power as the header comment of the class claims (the engine asks the attacker's abilities only). The L1 grid cannot put a second holder on the field, so test/tests/elite-redux/decomp/B11/chunk5.test.ts drives the rule with stand-ins.",
});
