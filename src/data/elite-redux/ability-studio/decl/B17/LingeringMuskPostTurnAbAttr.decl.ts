/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 / Lingering Musk, second half. Read by hand: bernerd-roster-mechanics.ts `LingeringMuskPostTurnAbAttr` (base
// PostTurnAbAttr, ab-attrs.ts, dispatched once per Pokemon at the end of every turn).
//
// Clause by clause, in the order they run (canApply = gate, nothing else; the base canApply is not consulted):
//   1. condition  tempSummonData.lingeringMuskFaint is set (the marker the survival half left)      -> `gate`
//   2. effect     apply: unless simulated, pokemon.damageAndUpdate(pokemon.hp, { result: INDIRECT }) (all remaining HP)
// No random draw, no guard, no feasibility. The marker is per switch-in (tempSummonData), never cleared by this attr;
// the Pokemon faints, so it does not need to be.
//
// Package for the effect only: "lose all remaining HP" has no library effect (request R4); the WHEN (end of turn) and
// the condition (the marker) are separate. The marker has no library atom either (request R3), so the gate binding is a
// written legacy-closure until the librarian adds it.
import { LingeringMuskPostTurnAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LingeringMuskPostTurnAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.end-of-turn",
  label: "Make myself faint",
  summary: () =>
    "I lose all of my remaining HP and faint. As built, it only happens when I survived a knockout hit earlier.",
  synonyms: ["lingering musk", "faint", "knock myself out", "self knockout", "delayed knockout", "die at end of turn"],
  examples: ["Faint at the end of the turn after surviving a knockout hit"],
  params: [],
  noParamsReason:
    "It always removes all of the holder's remaining HP (damage equal to current HP), so there is no number, type, stat or status to set.",
  conditions: [
    // The gate is the whole rule: "I carry the faint-later marker". No atom reads that marker yet (request R3).
    {
      slot: "gate",
      ctx: "params",
      lib: "request R3: the marker left by a survived knockout",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "two quiet turns, no marker", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B (gate/residual split, canApply = gate only, base canApply was never called) with a PACKAGE effect. Written reason for the package: the effect is a single damageAndUpdate(pokemon.hp, INDIRECT) call, but no library effect 'lose all my remaining HP / faint' exists (request R4 in requests/B17.md); it cannot be expressed with inflict, heal or recoil blocks, whose amounts are shares of damage or max HP, not 'all current HP', and a recoil block needs the damage slot, which an end-of-turn trigger does not have. The gate (the marker) is legacy-closure pending request R3: bindLegacyClosure for Lingering Musk (6084, attr 3, slot gate). Marker written by LingeringMuskEndureAbAttr (tempSummonData.lingeringMuskFaint). Users: Lingering Musk (6084, attr 3) only. No game bug found in this half (the Endure half has a suspected simulated-preview bug, see its notes).",
});
