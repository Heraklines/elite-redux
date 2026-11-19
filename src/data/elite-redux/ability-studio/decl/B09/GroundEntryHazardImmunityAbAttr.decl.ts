/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 3. "Ground types take no damage from Stealth Rock or Spikes" (Tectonize).
//
// Source: src/data/elite-redux/archetypes/ground-entry-hazard-immunity.ts, class GroundEntryHazardImmunityAbAttr (extends AbAttr,
// constructor `super(false)`). A marker: it has no canApply or apply of its own and is never dispatched. The effect is
// done by the hazard itself, src/data/arena-tag.ts DamagingTrapTag.activateTrap (line 953):
//   `(tagType === SPIKES || tagType === STEALTH_ROCK) && pokemon.isOfType(GROUND)
//      && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "GroundEntryHazardImmunityAbAttr")`  -> return false
// so the entry-hazard code reads the class by NAME. No heal (unlike StealthRockImmunityAbAttr), no other hazard (Toxic Spikes,
// Sticky Web and the ER hazards are untouched), no random draw, no state.
//
// Engine-query (spec 1.4): the holder's Ground type, the two named hazards and the name scan are all decided by the engine
// at the call site, so nothing can be recomposed from outside. Class agents do not touch call sites: the foundation routes
// them through abilityQuery (request R-B09-10). Counted apart in the coverage report.
import { GroundEntryHazardImmunityAbAttr } from "#data/elite-redux/archetypes/ground-entry-hazard-immunity";

export default defineDecl(GroundEntryHazardImmunityAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Ignore Stealth Rock and Spikes while I am a Ground type",
  summary: () =>
    "While I have this and I am a Ground type, I take no damage from Stealth Rock or Spikes when I enter. Other hazards still work.",
  synonyms: [
    "tectonize",
    "rock and spikes immunity",
    "hazard immunity",
    "stealth rock immune",
    "spikes immune",
    "ground hazard guard",
  ],
  examples: ["A Ground type that switches in without taking Stealth Rock or Spikes damage, like Tectonize"],
  params: [],
  noParamsReason:
    "A presence flag read by name from the entry-hazard code; there is nothing to configure. The Ground type test and the two hazards (Spikes, Stealth Rock) are fixed at the call site.",
  conditions: [],
  guards: [],
  feasibility: [
    "I must be a Ground type at the moment the hazard triggers; the hazard itself checks this",
    "Only Spikes and Stealth Rock are ignored, not Toxic Spikes, Sticky Web or other hazards",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The class is a presence marker that DamagingTrapTag reads by name; no moment is dispatched, so the twin compares whole battles instead (template while-active-flags).",
  probes: [{ name: "entry hazards against the holder", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, 1 attr: Tectonize (5046 attr 2). Read by DamagingTrapTag.activateTrap (src/data/arena-tag.ts:953) with `getAllActiveAbilityAttrs().some(a => a?.constructor?.name === ...)`; the class name is therefore load-bearing. The sibling classes EntryHazardImmunityAbAttr and GroundedEntryHazardImmunityAbAttr are read the same way at arena-tag.ts:891 and :896 (chunk 1 of this batch). BLOCKED on a library change: while.active lists its flag classes in `flagKeys` (vocabulary/when-registry.ts) and this class is not in the list, so the L0 check 'when dispatches ... none of which is the class or one of its ancestors' fails for it until the librarian adds GroundEntryHazardImmunityAbAttr to flagKeys (request R-B09-11). Oddity, not fixed: the ability text says Stealth Rock and Spikes only, and the code does the same; Tectonize on a non-Ground holder does nothing.",
});
