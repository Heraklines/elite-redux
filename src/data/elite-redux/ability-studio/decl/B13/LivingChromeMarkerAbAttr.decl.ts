/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Living Chrome, part 1 of 2 (Tier C, engine-query). "Each time I change shape I remember the types I just left (at most a few times per wave)."
//
// Source: abilities/newcomer-signature-mechanics.ts, LivingChromeMarkerAbAttr (extends AbAttr directly; apply is empty).
// The class is a MARKER that the engine looks for by name: recordLivingChromeTransformation(pokemon, previousTypes, previousFormIndex)
// is called by both changeForm implementations of field/pokemon.ts (lines 7306 and 9551), BEFORE the form index changes, and its rule is,
// in order:
//   the Pokemon carries this marker (otherwise nothing happens)
//   -> wave = current wave; count = memories already made THIS wave (0 when the last memory is from another wave)
//   -> if count >= the limit, stop (no memory, no message)
//   -> write the shape memory { wave, count + 1, types = the previous types without duplicates, first two, flat = the Pokemon is an
//      Eevee that was leaving form 0, expires = this turn } and queue "<name> retained a Shape Memory!"
// No RNG. The limit was the literal 3, now constructor argument 0 (default 3); the rule reads it from the holder's marker attr. The
// damage cut that uses the memory is LivingChromeReductionAbAttr (chunk 5, attr 1).
import { LivingChromeMarkerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LivingChromeMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Remember the types I leave behind when I change shape",
  summary: params =>
    `While I have this, each time I change shape I remember the types I just left, up to ${params.maxMemoriesPerWave} times per wave, so my other part of this ability can cut damage from them.`,
  synonyms: [
    "remember old types",
    "shape memory",
    "keep my old typing",
    "change form and remember",
    "adaptive memory",
    "living chrome",
  ],
  examples: ["Each time I change form I remember the types I just left, like Living Chrome"],
  params: [
    {
      id: "maxMemoriesPerWave",
      ctorIndex: 0,
      path: "maxMemoriesPerWave",
      control: "number",
      label: "Most shape memories I can make in one wave (times)",
      editable: true,
      gateIndependent: true,
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only a real change of shape counts (a form change of this Pokemon); nothing is remembered otherwise",
    "The memory lasts only for the turn it was made and only counts in the same wave",
    "Only my first two previous types are remembered, and an Eevee leaving its base form remembers every type instead",
    "On its own this part does not reduce any damage; the damage cut is the second part of this ability",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The flag is consulted by name from the form-change code, which is not a dispatched moment; B13/chunk6.test.ts proves the rule by calling recordLivingChromeTransformation with and without the marker and past the limit.",
  probes: [{ name: "a damaging hit with no change of shape", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "ENGINE-QUERY, justified: the class is a flag; the rule (write a shape memory on every change of form, at most N per wave) lives in recordLivingChromeTransformation, called by name from both changeForm implementations (field/pokemon.ts:7306 and :9551), so a rebuilt attr cannot carry it. Its trigger ('I changed form') is not dispatched, so no WHEN block can wrap it: requested as R-B13-54 (a dispatched WHEN 'When I change shape' with slots holder, previous types and previous form, plus the effect 'Remember the types I just left'); the dispatch key list of while.active needs this class (R-B13-19; the same minimal flag-key entry the earlier chunks made was added). The limit 3 was a literal; it is now constructor argument 0 (default 3) and the function reads it from the holder's marker attr. The 'two types, deduplicated' and 'Eevee flat' rules stay in the function. Users: Living Chrome (5980, attr 0); the ability passes no arguments, so it is fully covered. ODDITIES (not fixed): (1) the memory is written BEFORE the form index changes and even if the form change then fails; (2) the memory slot is a single WeakMap entry, so a second change in the same turn overwrites the first (the ability text says it does not stack); (3) the limit counter resets when the wave changes, not when the Pokemon switches out; (4) the 'Eevee flat' memory is made only when the Pokemon is an Eevee species leaving form 0, so a Pokemon of another species never gets the flat 0.75 cut.",
});
