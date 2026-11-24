/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / while-active flag. See ../PRECEDENTS.md.
//
// No behaviour in the class. `StealthRockTag.activateTrap` (arena-tag.ts) asks
// `pokemon.hasAbilityWithAttr("StealthRockImmunityAbAttr")` first:
//   yes -> if not simulated and the holder is not at full HP, queue a heal of toDmgValue(maxHp / 4); return false
//          (so the base trap, and therefore the damage, never runs)
//   no  -> super.activateTrap
// The heal amount (1/4 of max HP) is a literal in the hazard, not a setting of this flag.
import { StealthRockImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(StealthRockImmunityAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Absorb Stealth Rock instead of taking damage",
  summary: () =>
    "When I switch in on a side with Stealth Rock, I take no damage and heal 1/4 of my max HP unless I am already full. Example: 200 max HP heals 50.",
  synonyms: [
    "stealth rock immunity",
    "rock hazard immunity",
    "heal from stealth rock",
    "no entry hazard damage",
    "mountaineer",
    "ice plumes",
    "free climb",
  ],
  examples: ["Take no Stealth Rock damage and heal from it, like Mountaineer"],
  params: [],
  noParamsReason:
    "A pure presence flag: the Stealth Rock hazard only asks whether the Pokemon has it, and the 1/4 heal is a fixed number inside the hazard itself, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "The heal only happens when I am not at full HP, and the rocks stay on the field",
    "Other entry hazards (Spikes, Toxic Spikes) are not affected by this",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "switching into Stealth Rock below and at full HP", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The engine site (StealthRockTag.activateTrap) is driven directly in test/tests/elite-redux/decomp/B05/flag-sites.test.ts at full HP and below it.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C. Read only by StealthRockTag.activateTrap (arena-tag.ts:1115). Users: Mountaineer (attr 1, with a Rock-type immunity attr), Ice Plumes (attr 3, with a Rock absorb-and-heal attr) and Free Climb (attr 4). Nothing to bind. The ER archetype 'ground-entry-hazard-immunity' is a different class that is scanned by name and is not this one. Suspected cosmetic bug (not fixed): the heal message is built with abilityName empty, so the line has a blank where the ability name should be.",
});
