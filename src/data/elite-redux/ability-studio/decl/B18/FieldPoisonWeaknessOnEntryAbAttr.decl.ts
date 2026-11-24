/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// Toxic Spill (Tier C, package). "When I enter the battle, DO mark every Pokemon on the field as weak to Poison for as long as
// it stays in".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostSummonAbAttr (showAbility true). Dispatch:
// applyAbAttrs("PostSummonAbAttr", { pokemon, simulated }) when a Pokemon enters. There is no canApply of its own.
// apply: unless simulated, for every Pokemon of `globalScene.getField(true)` (all battlers on the field, both sides, the holder
// included) sets `tempSummonData.erPoisonWeakness = true`. The reader is Pokemon.getAttackTypeEffectiveness (pokemon.ts:4474):
// for a Poison move, `multi = max(2, multi)` when multi > 0, so existing immunities stay immune and every other matchup
// becomes super effective. tempSummonData ends when that Pokemon leaves the field.
import { FieldPoisonWeaknessOnEntryAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";

export default defineDecl(FieldPoisonWeaknessOnEntryAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Make everyone on the field weak to Poison",
  summary: () =>
    "When I enter the battle, every Pokemon on the field (mine, my allies and the foes) takes at least double damage from Poison moves while it stays in. Poison-immune Pokemon stay immune.",
  synonyms: [
    "toxic spill",
    "poison weakness",
    "everyone weak to poison",
    "poison field",
    "super effective poison",
    "poison hazard",
  ],
  examples: ["Everyone on the field becomes weak to Poison when I come in, like Toxic Spill"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the Poison type and the 'at least double damage' rule are fixed in the class and in the damage calculation that reads the mark. Staff get the same recipe only by wiring the mark itself.",
  conditions: [],
  guards: [],
  feasibility: ["Nothing is marked while the game is only previewing"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: it writes a per-summon mark (summonData `erPoisonWeakness`) on every battler on the field that the damage calculation reads for Poison moves; the library has no 'make everything on the field weak to a type' effect and no type-chart override effect (request R-B18-16). There is no condition: the class has no canApply, so the trigger (event.on-entry) is the only block around the effect and staff can AND any condition on top. No settings: the type (Poison) and the floor (x2) live in the reader at pokemon.ts:4474, not in the class, so a setting here would not be real (the request asks for a type-weakness effect with a type setting). Users: Toxic Spill (5147, attr 0). ODDITIES (not fixed): (1) the mark is set only for Pokemon on the field at that moment; a Pokemon that comes in later is not marked, and a marked one loses it when it leaves; (2) the holder itself is marked too, so Toxic Spill is weak to Poison as well; (3) the mark is an unconditional `true`, so two Toxic Spill holders do nothing extra.",
});
