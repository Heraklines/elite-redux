/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / calc modifier (a cancel check), Tier C. Copy of the BlockOneHitKOAbAttr shape. See ../PRECEDENTS.md.
//
// The class body is empty (`CancelInteractionAbAttr`: canApply `!cancelled.value`, apply `cancelled.value = true`) and it has
// no constructor of its own, so `showAbility` is the AbAttr default true (the dump of the live attrs shows true for all
// five users). It is dispatched from three engine places, all of them "can this Pokemon be forced out?":
//   - ForceSwitchOutAttr.getFailedText and its move condition (move.ts, Roar, Whirlwind, Dragon Tail, Circle Throw):
//     `applyAbAttrs("ForceSwitchOutImmunityAbAttr", { pokemon: target, cancelled })`;
//   - ForceSwitchOutHelper.getSwitchOutCondition and ForceSwitchOutHelper.getFailedText (ab-attrs.ts, the helper of Wimp Out and Emergency Exit);
//   - the tactical Red Card (er-tactical-items.ts) does NOT dispatch: it asks `user.hasAbilityWithAttr(...)` (an engine
//     query, see notes).
import { ForceSwitchOutImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ForceSwitchOutImmunityAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.forced-switch",
  label: "Cannot be forced out of battle",
  summary: () =>
    "Moves that drag me out (Roar, Whirlwind, Dragon Tail, Circle Throw) fail against me, so I stay in the battle. Example: a foe's Roar does nothing.",
  synonyms: [
    "suction cups",
    "anchor",
    "no phazing",
    "roar immunity",
    "whirlwind immunity",
    "cannot be dragged out",
    "stay in the battle",
    "guard dog",
  ],
  examples: ["Roar and Whirlwind fail against me, like Suction Cups"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: every forced switch is blocked. The only constructor argument is showAbility, which is never exposed (fixed to true).",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when the forced switch was already blocked by something earlier"],
  effect: { id: "effect.negate", params: [] },
  fixedCtorArgs: { 0: true },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a foe forces the holder out", axes: {} }],
  status: "decomposed",
  notes:
    'Tier C. Users: Suction Cups (21, attr 0), Guard Dog (275, attr 1), Superheavy (5549, attr 7), Strong Foundation (5605, attr 2) and Glam Rock (5975, attr 0); showAbility true for all of them (dump of the live attrs). No closure, so no binding. ENGINE QUERY ASPECT (not reproduced by a rebuild, nothing to fix): the tactical Red Card (er-tactical-items.ts, `!user.hasAbilityWithAttr("ForceSwitchOutImmunityAbAttr")`) reads the flag by presence, so a rebuilt attr must stay on the Pokemon for that to keep working. SUSPECTED GAME BUG (not fixed): `ForceSwitchOutHelper.getSwitchOutCondition` (ab-attrs.ts) asks the immunity of the OPPONENT when the Pokemon that wants to leave is a player Pokemon (`applyAbAttrs(..., { pokemon: opponent, ... })`), so a foe with Suction Cups stops the player\'s Wimp Out / Emergency Exit, which looks like it should read the leaving Pokemon. The class ignores `simulated` (the cancel never reads it).',
});
