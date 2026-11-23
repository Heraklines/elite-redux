/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { koFlagBonusCodec, percentCodec } from "#data/elite-redux/ability-studio/decl/B09/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { LifestealOnKoAbAttr } from "#data/elite-redux/archetypes/lifesteal";

// B09 chunk 4. "I heal when my attack knocks a Pokemon out" (Soul Eater, Predator, Looter, Scavenger, Apex Predator, Bloodlust,
// Brain Food, Ghost Frenzy, Gillie Suit, Crushing Antlers, Magma Eater, Soul Devourer, Hunter's Horn, Reaper's Scythe, Bandit,
// and the biting versions Hungry Maws, Jaws of Carnage and World-Eater).
//
// Source: src/data/elite-redux/archetypes/lifesteal.ts, class LifestealOnKoAbAttr (extends PostKnockOutAbAttr, ab-attrs.ts:2625).
// Dispatched by FaintPhase to EVERY Pokemon on the field when anything faints
// (`applyAbAttrs("PostKnockOutAbAttr", { pokemon: p, victim })`, faint-phase.ts:268), so the class decides who is credited.
// Clauses of canApply, in order:
//   1. `super.canApply(params)`, always true                                                             -> nothing
//   2. `koLandedByDirectHit(params)`: `victim.turnData.attacksReceived[0].sourceId === pokemon.id` (the latest direct attack the
//      victim took came from THIS holder; weather, status and hazard knock-outs credit nobody)             -> bundled safety rule
//   3. `!pokemon.isFainted()`                                                                            -> guard `not-fainted`
//   4. `!pokemon.isFullHp()`                                                                             -> feasibility (a heal at full HP is a wasted phase)
// apply: skipped when simulated; fraction = `koHealFraction`, replaced by `flagBonus.fraction` when the knocking-out move (the
// victim's latest received attack, looked up in allMoves) has the printed property `flagBonus.flag`; heal = toDmgValue(maxHp *
// fraction), nothing when it rounds to 0; paid through applyAbilityDrainRecovery (Liquid Ooze on the VICTIM turns it into damage).
// No random draw, no state.
// Constructor: ({ healFraction, flagBonus }), one options object; throws unless healFraction is in (0, 1] and, when given, the bonus
// fraction is in (0, 1].
// Tier C: no constructor closure and nothing a staff member could drop without changing what the ability is (the direct-hit credit
// is a correctness rule). The settings are the two shares; extra conditions can be ANDed on top. The direct-hit rule is not in the
// guard registry yet, so it is written as an "also requires" line and requested (R-B09-32).
export default defineDecl(LifestealOnKoAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-ko",
  label: "Heal when my attack knocks a Pokemon out",
  summary: params =>
    `After my attack knocks out a Pokemon, I heal ${params.healPercent}% of my max HP${params.flagBonus === "" ? "" : ` (more with: ${params.flagBonus})`}. Example: 25 = a quarter, like Soul Eater.`,
  synonyms: [
    "soul eater",
    "predator",
    "heal on ko",
    "heal when i faint a foe",
    "knock out heal",
    "recover after a kill",
    "victory heal",
    "hungry maws",
  ],
  examples: [
    "Heal a quarter of my max HP when I knock a Pokemon out, like Soul Eater",
    "Heal 50% when a biting move knocks one out and 25% otherwise, like Hungry Maws",
  ],
  params: [
    {
      id: "healPercent",
      ctorIndex: 0,
      ctorOption: "healFraction",
      path: "koHealFraction",
      control: "number",
      label: "Heal this share of my max HP (% of max HP, 25 = a quarter)",
      editable: true,
      min: 1,
      max: 100,
      step: 0.5,
      default: 25,
      codec: percentCodec,
    },
    {
      id: "flagBonus",
      ctorIndex: 0,
      ctorOption: "flagBonus",
      path: "flagBonus",
      control: "text",
      label: "Bigger heal for a move property, as property=percent (biting=50; empty = none)",
      editable: true,
      default: "",
      codec: koFlagBonusCodec,
    },
  ],
  conditions: [],
  guards: ["not-fainted"],
  feasibility: [
    "Only the Pokemon whose direct hit landed the knock-out heals; a knock-out from weather, poison or hazards, or one caused by an ally, credits nobody",
    "Nothing happens when I am already at full HP",
    "If the Pokemon I knocked out has Liquid Ooze, I take the amount as damage instead of healing it",
  ],
  effect: { id: "effect.heal-percent", params: ["healPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The heal needs missing HP (the class refuses at full HP), so the boundary is max versus max-1.
      name: "I knock the foe out at full HP and one HP below, and at half HP",
      axes: { hp: ["max-1", "max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C event-effect. 18 attrs in 18 abilities, healFraction 0.25 everywhere; Hungry Maws (5562 attr 1), Jaws of Carnage (5174 attr 0) and World-Eater (6103 attr 3) also pass flagBonus { BITING_MOVE, 0.5 }. Users: Soul Eater 5069, Scavenger 5083, Predator 5101, Looter 5102, Magma Eater 5198, Hunter's Horn 5195, Bloodlust 5342, Apex Predator 5399, Soul Devourer 5466, Ghost Frenzy 5700, Bandit 5702, Brain Food 5936, Gillie Suit 5986, Crushing Antlers 6024, Reaper's Scythe 20017 (attr positions in the engine's ability list; the L1 sweep covers all of them). Nothing is bound (no closure). flagBonus is a nested object, so it is one text setting with a codec: empty = none, 'biting=50' = { BITING_MOVE, 0.5 }. The bonus test reads the PRINTED property (allMoves[id].hasFlag), the same as the class. The direct-hit credit is shared by LifestealOnKoAbAttr and ScavengerLootAbAttr through the module function koLandedByDirectHit; it is not in the guard registry, so it is listed as an 'also requires' line and requested as a guard (R-B09-32). Rule to know, not a bug: the credit reads attacksReceived[0], the victim's LATEST received attack this turn (the engine unshifts new attacks, move-effect-phase.ts:989), so the holder is credited only when its own hit was the last attack the victim took before fainting.",
});
