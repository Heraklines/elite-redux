/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "Count every Pokemon that faints while I am on the field" (the first half of Soul Harvest).
//
// Source: src/data/elite-redux/archetypes/stat-multiplier-per-faint.ts, FaintCountTriggerAbAttr (extends PostKnockOutAbAttr).
// Dispatched by faint-phase.ts:269 for every Pokemon on the field when ANY Pokemon faints, `victim` = the one that fainted.
// Clauses, in the original order:
//   canApply  `victim.id !== pokemon.id`   condition: the faint is not my own                    -> gate: not side.is { self }
//   apply     skipped when `simulated`; otherwise `pokemon.battleData.erSoulHarvestFaintCount = count + 1`   -> effect (counter)
// There is no constructor argument, no random draw and no guard. The counter is a plain field of the holder's per-battle data,
// so it resets with every battle; the only reader is PerFaintStatMultiplierAbAttr (its own declaration).
//
// Package for the effect only: the library has no "add one to a counter that lives for this battle" effect (it knows once-per
// and nth-use memory, which are yes/no, not a number a stat can grow with). The trigger (a faint) and the condition (not my own
// faint) are separate, swappable blocks; request R-B12-02 asks for the counter effect and R-B12-03 for the matching stat effect.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { FaintCountTriggerAbAttr } from "#data/elite-redux/archetypes/stat-multiplier-per-faint";

export default defineDecl(FaintCountTriggerAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.on-ko",
  label: "Count every other Pokemon that faints while I am out",
  summary: () =>
    "Each time a Pokemon other than me faints while I am on the field, my faint count for this battle goes up by 1. The count resets in the next battle.",
  synonyms: [
    "faint counter",
    "count faints",
    "soul harvest",
    "tally knock outs",
    "dead pokemon counter",
    "snowball counter",
  ],
  examples: ["Add one to my faint count whenever any other Pokemon faints, like Soul Harvest"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the +1 per faint and the place the count is kept (the holder's per-battle data) are fixed in the class.",
  conditions: [
    // The gate is one atom: the Pokemon that fainted is not me (`victim.id !== pokemon.id`, the same as `other` is not the holder).
    { slot: "gate", ctx: "params", lib: "side.is", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Nothing is counted when the game only previews the move"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a foe faints while I am out", axes: {} }],
  status: "decomposed",
  notes:
    "Package (effect only), justified: the library has no counter memory, only yes/no memory (time.once-per, time.nth-use), and the count is read by PerFaintStatMultiplierAbAttr from the same private field of the holder's battle data, so the pair works together. The trigger and the one condition are separate blocks. Tier B: the gate is the single clause `victim.id !== pokemon.id`, expressed as not(side.is self) (the id comparison and the object comparison agree because every Pokemon has a unique id). 1 attr: Soul Harvest (5589 attr 0). Oddities, not fixed: (a) PostKnockOutAbAttr reaches the holder for every faint on the field, so an ally's faint and a foe's faint both count, as the Soul Harvest text says; (b) the count is stored under the Soul Harvest name in the shared battle data, so a second ability using this class would share one counter; (c) apply writes the counter and does not draw a random number.",
});
