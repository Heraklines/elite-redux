/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / while-active flag. See ../PRECEDENTS.md.
//
// No behaviour in the class. `Arena.isFieldEffectSuppressed()` (arena.ts:230) is true while any ACTIVE field Pokemon
// has this flag and its ability is not suppressed (`!p.summonData.abilitySuppressed`). It is read at the terrain
// getter, the Trick Room / Inverse Room apply hooks and `Arena.hasActiveGravity()`. The tags themselves stay set and
// work again once the holder leaves, like Cloud Nine does for weather (a separate class).
import { SuppressFieldEffectsAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SuppressFieldEffectsAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Switch off terrain, rooms and gravity",
  summary: () =>
    "While I am on the field, terrains, Trick Room, Inverse Room and Gravity have no effect. They stay set and work again when I leave. Example: Trick Room stops reversing speed.",
  synonyms: [
    "negate terrain",
    "no trick room",
    "no gravity",
    "field effects off",
    "cloud nine for terrain",
    "clueless",
    "ignore rooms",
  ],
  examples: ["Terrain and Trick Room do nothing while I am out, like Clueless"],
  params: [],
  noParamsReason:
    "A pure presence flag: Arena.isFieldEffectSuppressed only asks whether an active Pokemon has it, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Weather is switched off by a separate block (the Cloud Nine kind); this one never touches weather",
    "It stops working while the holder's own ability is suppressed (Neutralizing Gas, Gastro Acid style effects)",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a terrain and Gravity while the holder is out", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The engine query Arena.isFieldEffectSuppressed and hasActiveGravity are driven directly in test/tests/elite-redux/decomp/B05/flag-sites.test.ts.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C. Read only by Arena.isFieldEffectSuppressed (arena.ts:230), which looks at getField(true) (every active mon, foes included, so a FOE's Clueless also switches the effects off for the whole field). User: Clueless (attr 1, next to SuppressWeatherEffectAbAttr). Nothing to bind. The 'terrain getter, Room hooks and Gravity read sites' that consume the query are engine code; the class cannot be split further without routing those sites through a dispatched hook (requests/B05.md, R-B05-3).",
});
