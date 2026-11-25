/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Cracked Vessel, part 2 of 2 (Tier C, package). "When I come back in, I get my reduced type list back."
//
// Source: abilities/newcomer-signature-mechanics.ts, CrackedVesselRestoreTypesAbAttr (PostSummonAbAttr; no constructor).
//   canApply   CRACKED_TYPES.has(holder)       (I lost a type earlier this battle; the list is written by tryCrackedVessel)
//   apply      holder.summonData.types = [...CRACKED_TYPES.get(holder)!]; holder.updateInfo()    (ignores `simulated`)
// No RNG, no constructor arguments, no condition. The memory is written by tryCrackedVessel (called by name from
// Pokemon.damageAndUpdate, field/pokemon.ts:6663), the once-per-wave survive-at-1-HP part of the ability: it keeps the types
// except the last one, sets Eerie Fog for 4 turns and badly poisons every adjacent battler.
import { CrackedVesselRestoreTypesAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CrackedVesselRestoreTypesAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Get my reduced type list back when I enter",
  summary: () =>
    "When I enter the battle after losing a type earlier, I come in with the shorter type list I had left instead of my full types.",
  synonyms: [
    "keep lost type",
    "remember lost type",
    "restore broken types",
    "permanent type loss",
    "cracked vessel",
    "type stays removed",
  ],
  examples: ["If I lost my last type earlier, I come back with the reduced types, like Cracked Vessel"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments and no number: it gives the Pokemon back the shorter list of types it remembered when the vessel cracked. There is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only a Pokemon whose vessel already cracked earlier in the battle has types to get back; otherwise nothing happens",
    "The restored list is exactly the one remembered when the vessel cracked (the types except the last one, or Unknown when none are left); it cannot be changed from here",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The memory is written by a lethal hit from full HP; B13/chunk5.test.ts stores a type list through tryCrackedVessel and drives the entry.",
  probes: [{ name: "entry with nothing remembered", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect copies a private per-Pokemon list of types back onto the summon data, and the one clause of canApply ('a list was remembered') is the effect's own precondition (apply dereferences the list with `!`, so dropping the clause would crash): it is feasibility, not a condition a rule could change, and the library has no memory-read block for a list of types (requested as R-B13-52 `effect.restore-remembered-types` plus the matching memory write). The trigger is a normal switch-in WHEN. Users: Cracked Vessel (5992, attr 1; attr 0 is the marker CrackedVesselMarkerAbAttr, chunk 6). ODDITIES (not fixed): (1) apply ignores `simulated`; no engine path simulates PostSummon today; (2) the memory is a WeakMap entry keyed by the Pokemon and never cleared, so the shorter list is restored on every later entry in the same battle (the ability text says 'permanently removes its last type'); (3) summonData.types is replaced by a copy, so a type change made in between (Soak, Forest's Curse) is overwritten on entry.",
});
