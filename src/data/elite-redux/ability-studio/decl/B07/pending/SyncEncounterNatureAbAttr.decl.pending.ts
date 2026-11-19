/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / event effect (Synchronize's nature half). PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick
// it up yet. Reason: no WHEN claims the dispatch key. `vocabulary/dispatch-keys.ts` lists SyncEncounterNatureAbAttr in
// UNEXPOSED_DISPATCH_KEYS ("Wild encounter generation ... Not a moment inside a battle"), so the L0 rule "the WHEN's
// dispatch key is the class or an ancestor" cannot be met, and a batch may not invent a WHEN (spec 6, step 3). The
// request is requests/B07.md, R-B07-5 (the WHEN `event.wild-pokemon-created`, plus the effect `effect.copy-nature`).
//
// To finish: once the librarian has added that WHEN (dispatch key SyncEncounterNatureAbAttr, provides holder and other),
// removed the key from UNEXPOSED_DISPATCH_KEYS and added a scenario template that reaches it (or accepted the
// l2StaticReason below), rename this file to SyncEncounterNatureAbAttr.decl.ts, set `when` to the final id and run
// L0 / L1 / L2 for the class.
//
// Clause classification (read from the source, in the original order):
//   canApply  none of its own (AbAttr default: true; `showAbility` is false, `super(false)`).
//   apply     `target.setNature(pokemon.getNature())`  -> the effect. No chance roll in the class (vanilla gen 5+ has 50%,
//             this game copies every time), no closure, no random draw.
// Dispatch (encounter-phase.ts, wild encounters only): for each generated wild Pokemon, for each of the player's front
// party members in REVERSE order, `applyAbAttrs("SyncEncounterNatureAbAttr", { pokemon: playerPokemon, target: enemy })`.
// Reverse order means the FIRST party member's Synchronize is applied last and wins when several hold it.
import { SyncEncounterNatureAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SyncEncounterNatureAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.wild-pokemon-created",
  label: "Give wild Pokemon my nature",
  summary: () =>
    "Every wild Pokemon that appears gets the same nature as me. Example: with an Adamant lead, wild Pokemon are Adamant too. If several party members have it, the first in the party wins.",
  synonyms: ["synchronize", "copy nature", "same nature", "match nature", "wild nature", "nature sync"],
  examples: ["Wild Pokemon get my nature, like Synchronize"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: the wild Pokemon always gets the holder's own nature. The class has no constructor argument (`super(false)` only).",
  conditions: [],
  guards: [],
  feasibility: ["Only happens for wild Pokemon created for an encounter, and only for the front of the player's party"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a wild Pokemon is created while the holder leads", axes: {} }],
  l2StaticReason:
    "The dispatch lives in the wild encounter generation (EncounterPhase), before any battle exists, so no scenario template of the battle twin can reach it. It is driven directly with a fresh target Pokemon in test/tests/elite-redux/decomp/B07/flag-sites.test.ts.",
  status: "decomposed",
  notes:
    "Event effect, Tier C, parked until the WHEN exists (R-B07-5). Read only by encounter-phase.ts. User: Synchronize (28, attr 0); its second attr SynchronizeStatusAbAttr (status copy) is another class. Observation (not fixed): the nature of the first party member wins because the loop runs in reverse; the class itself has no 50% roll.",
});
