/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "I am immune to every entry hazard when I enter" (Shield Dust, the ER 2.65 clause).
//
// Source: src/data/elite-redux/archetypes/entry-hazard-immunity.ts, class EntryHazardImmunityAbAttr (extends AbAttr, constructor
// `super(false)`). A marker: no canApply, no apply, never dispatched. The effect is done by the hazard itself,
// src/data/arena-tag.ts EntryHazardTag.apply (line 891):
//   `pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "EntryHazardImmunityAbAttr")` -> return false
// It is checked right after `canAffect(pokemon)` and BEFORE the grounded test and the Heavy-Duty Boots test, so it stops every
// EntryHazardTag subclass (Spikes, Stealth Rock, Toxic Spikes, Sticky Web, Hot Coals, Creeping Thorns and the ER hazards), grounded
// or not. No random draw, no state, `simulated` is not read.
//
// Engine-query (spec 1.4), same shape as GroundEntryHazardImmunityAbAttr (chunk 3): the name scan is decided by the engine at the
// call site, so nothing can be recomposed from outside. The foundation routes it through abilityQuery (request R-B09-10).
import { EntryHazardImmunityAbAttr } from "#data/elite-redux/archetypes/entry-hazard-immunity";

export default defineDecl(EntryHazardImmunityAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Ignore every entry hazard when I enter",
  summary: () =>
    "While I have this, I take no effect from any entry hazard when I enter: Spikes, Stealth Rock, Toxic Spikes, Sticky Web and the others.",
  synonyms: [
    "shield dust",
    "hazard immunity",
    "ignore spikes",
    "no hazard damage",
    "stealth rock immune",
    "heavy duty boots",
    "toxic spikes immune",
    "sticky web immune",
  ],
  examples: ["Switch in without taking Spikes, Stealth Rock or Toxic Spikes effects, like Shield Dust"],
  params: [],
  noParamsReason:
    "A presence flag read by name from the entry-hazard code; there is nothing to configure. It covers every entry hazard, with no type or grounding test and no list of hazards.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only works at the moment a hazard would act on me as I enter; hazards laid while I am already out are not affected",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The class is a presence marker that EntryHazardTag.apply reads by name; no moment is dispatched, so the twin compares whole battles instead (template while-active-flags).",
  probes: [{ name: "entry hazards against the holder", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, 1 attr: Shield Dust (19 attr 2, pushed by init-elite-redux-vanilla-rebalance.ts:1236). Read by EntryHazardTag.apply (src/data/arena-tag.ts:891) with a constructor-name scan, so the class name is load-bearing. Sister marker GroundedEntryHazardImmunityAbAttr is read at :896 and the chunk 3 class GroundEntryHazardImmunityAbAttr at :953. BLOCKED on a one-line library change: the WHEN while.active lists its flag classes in `flagKeys` (vocabulary/when-registry.ts) and this class is not in the list, so L0 reports that the WHEN does not dispatch the class until the librarian adds EntryHazardImmunityAbAttr (request R-B09-24; the same line was added for the chunk 3 sibling by its review commit). Suspected game bug, not fixed: ImprisonTag also extends EntryHazardTag and inherits this apply, so the immunity may also stop Imprison from catching a switch-in; not verified in a battle. The ability text 'immune to entry hazards' matches the code.",
});
