/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "I ignore the entry hazards that only hurt grounded Pokemon" (Electrodynamics).
//
// Source: src/data/elite-redux/archetypes/entry-hazard-immunity.ts, class GroundedEntryHazardImmunityAbAttr (extends AbAttr,
// constructor `super(false)`). A marker: no canApply, no apply, never dispatched. The effect is done by the hazard itself,
// src/data/arena-tag.ts EntryHazardTag.apply (line 894-899):
//   `this.groundedOnly && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "GroundedEntryHazardImmunityAbAttr")`
//   -> return false
// `groundedOnly` is true for every hazard except Stealth Rock (arena-tag.ts:850 default true, :1092 Stealth Rock false), i.e. Spikes,
// Toxic Spikes, Sticky Web, Hot Coals, Creeping Thorns and the ER entry traps. The test is on the HAZARD, not on the holder: a
// holder that is not grounded is ignored anyway by the later `isGrounded()` test, and a grounded holder is protected by this marker.
// No random draw, no state, `simulated` is not read.
//
// Engine-query (spec 1.4): the name scan is decided by the engine at the call site, so nothing can be recomposed from outside.
// The foundation routes it through abilityQuery (request R-B09-10).
import { GroundedEntryHazardImmunityAbAttr } from "#data/elite-redux/archetypes/entry-hazard-immunity";

export default defineDecl(GroundedEntryHazardImmunityAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Ignore the entry hazards that only hurt grounded Pokemon",
  summary: () =>
    "While I have this, Spikes, Toxic Spikes, Sticky Web and the other hazards that only affect grounded Pokemon do nothing to me. Stealth Rock still hurts.",
  synonyms: [
    "electrodynamics",
    "grounded hazard immunity",
    "ignore spikes",
    "toxic spikes immune",
    "sticky web immune",
    "ground hazard guard",
    "hazard immunity",
  ],
  examples: [
    "Switch in without taking Spikes or Toxic Spikes effects, but still take Stealth Rock, like Electrodynamics",
  ],
  params: [],
  noParamsReason:
    "A presence flag read by name from the entry-hazard code; there is nothing to configure. Which hazards count as grounded-only is fixed by each hazard.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only hazards that affect grounded Pokemon only are ignored; Stealth Rock is not",
    "Only works at the moment a hazard would act on me as I enter",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The class is a presence marker that EntryHazardTag.apply reads by name; no moment is dispatched, so the twin compares whole battles instead (template while-active-flags).",
  probes: [{ name: "entry hazards against the holder", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, 1 attr: Electrodynamics (6062 attr 3, built by abilities/fakemon-pitch-raichu.ts:322; the same ability also has an AttackTypeImmunityAbAttr for Ground at attr 2). Read by EntryHazardTag.apply (src/data/arena-tag.ts:894-899) with a constructor-name scan, so the class name is load-bearing. BLOCKED on a one-line library change: add GroundedEntryHazardImmunityAbAttr to the `flagKeys` of WHEN while.active (request R-B09-24). Note: the marker is tested before the real grounding test (`isGrounded()`), which makes no difference to the outcome (both return false).",
});
