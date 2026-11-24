/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / calc modifier, Tier A (one constructor closure). See ../PRECEDENTS.md.
//
// `Move.doesFlagEffectApply(IGNORE_ABILITIES)` (move.ts) asks `user.hasAbilityWithAttr("MoveAbilityBypassAbAttr")` and then
// `applyAbAttrs("MoveAbilityBypassAbAttr", { pokemon: user, cancelled, move, target })`. In its original order:
//   canApply  `!cancelled.value && this.moveIgnoreFunc(pokemon, move)`
//             `!cancelled.value` is the shared "already decided" check (FEASIBILITY / guard of the cancel family);
//             `moveIgnoreFunc` is the constructor closure (ctor 0), default `() => true`  -> the CONDITION staff may change.
//   apply     `cancelled.value = true`  -> the effect (the user's move ignores the target's ability).
// The closure has the signature `(pokemon, move) => boolean`, which fits none of the condition contexts of build-attr.ts
// ("attack" is (user, target, move), "defend" is (target, user, move), "holder" is (pokemon)). The slot therefore has
// context "none" and every user is bound as a legacy closure with the exact formula (request R-B07-1 asks for a context
// "mover" = `(pokemon, move)`, and for the WHEN to hand out the move user, so the `move.type` and `move.category` atoms
// can take over).
import { MoveAbilityBypassAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoveAbilityBypassAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.ability-bypass",
  label: "My moves ignore the target's ability",
  summary: () =>
    "My moves ignore the target's ability, so abilities that block or weaken them do not work. Example: a Levitate foe is still hit by my Ground moves.",
  synonyms: [
    "mold breaker",
    "ignore abilities",
    "bypass ability",
    "ignore the target's ability",
    "teravolt",
    "turboblaze",
    "get past levitate",
    "break through abilities",
  ],
  examples: [
    "My moves ignore the target's ability, like Mold Breaker",
    "Only my Rock moves ignore abilities, like Stonecutter",
  ],
  params: [],
  noParamsReason:
    "The only constructor argument is the per-move closure, which is the condition slot (ctor:0), not a setting. showAbility is not an argument (`super(false)`).",
  conditions: [
    // `(pokemon, move) => boolean`: no library context takes this signature yet (see the header comment).
    { slot: "ctor:0", ctx: "none", path: "moveIgnoreFunc", removable: false, editable: false },
  ],
  guards: [],
  feasibility: ["Does nothing when something earlier already decided that abilities are ignored"],
  // No library effect says "ignore the target's ability" (effect.negate would read as "Block it"); request R-B07-1.
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a move is checked for ignoring the target's ability", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, but all six closures are legacy-closure for now (the (pokemon, move) signature has no condition context; request R-B07-1). The effect is 'package' for the same reason (no 'ignore the target's ability' effect; request R-B07-1). Users and closures (live dump): Mold Breaker (104, attr 1), Turboblaze (163, attr 1), Teravolt (164, attr 1), Blind Rage (5397, attr 3): `() => true` (the constructor default); Mycelium Might (298, attr 2): `(_pokemon, move) => move.category === 2` (status moves only); Stonecutter (5582, attr 2): `(pokemon, move) => pokemon.getMoveType(move) === 5` (Rock, after ability type changes). The subclass SuperEffectiveMoveAbilityBypassAbAttr is its own declaration. ENGINE QUERY ASPECT: `hasAbilityWithAttr(\"MoveAbilityBypassAbAttr\")` is also asked by presence in Pokemon.getAccuracyMultiplier (pokemon.ts, the ally accuracy line) and as a pre-filter in Move.doesFlagEffectApply, so a rebuilt attr must stay on the Pokemon. The class ignores `simulated`.",
});
