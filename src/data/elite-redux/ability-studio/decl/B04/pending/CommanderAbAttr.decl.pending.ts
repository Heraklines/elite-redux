/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier C package (Commander). PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick
// it up yet. Reason: the class has no trigger in WHEN_REGISTRY. CommanderAbAttr extends AbAttr directly (not
// PostSummonAbAttr) and the engine dispatches it by its own name, for every ALLY of a Pokemon that just entered
// (phases/post-summon-phase.ts:63) or was revived (modifier/modifier.ts:2064). vocabulary/dispatch-keys.ts lists the key
// in UNEXPOSED_DISPATCH_KEYS, so no WHEN claims it and the L0 rule "the WHEN's dispatch key is the class or an ancestor"
// cannot be met. Inventing a WHEN is not allowed for a batch (spec 6 step 3); the request is requests/B04.md
// ("event.ally-entered").
//
// To finish: once the librarian has added the WHEN `event.ally-entered` (dispatch key CommanderAbAttr, provides holder
// and ally, and removed CommanderAbAttr from UNEXPOSED_DISPATCH_KEYS), rename this file to CommanderAbAttr.decl.ts,
// change the import-free `when` below if the id differs, and run L0 / L1 / L2 for the class.
//
// Clause classification (CommanderAbAttr, in the original order):
//   canApply  1. `globalScene.currentBattle.getBattlerCount() > 1`  -> FEASIBILITY (there is somebody beside me: doubles
//                or triples; the old `double` flag was dead in triples).
//             2. `findCommandableDondozo(pokemon) != null`  -> FEASIBILITY (an adjacent ALLY that is active, is a
//                Dondozo, is not fainted and does not already carry the COMMANDED tag). The species check is the
//                whole point of the ability, so the block is a package, not a condition staff can swap.
//   apply     (not when simulated) lapse my semi-invulnerable tags; play the jump animation; give the Dondozo the
//             COMMANDED tag (its onAdd raises Atk, Def, Sp. Atk, Sp. Def and Speed by 2); remove my queued MovePhase.
//             The four steps share one search result and one tag, so splitting them would invent behaviour.
// No RNG. No closure, so no binding.
import { CommanderAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CommanderAbAttr, {
  tier: "C",
  kind: "package",
  // PENDING: not in WHEN_REGISTRY yet (requests/B04.md, "event.ally-entered").
  when: "event.ally-entered",
  label: "Jump into an ally Dondozo's mouth and power it up",
  summary: () =>
    "When an ally Dondozo is next to me (doubles or triples), I jump into its mouth: it gets +2 in every stat, my next move is cancelled and attacks aimed at me miss.",
  synonyms: ["commander", "tatsugiri", "dondozo", "ride an ally", "hide in ally", "jump in mouth"],
  examples: ["Hide inside my Dondozo partner and boost all its stats, like Commander"],
  params: [],
  noParamsReason:
    "The mechanic has no tunable numbers: the partner species (Dondozo), the +2 boost to five stats and the cancelled move are fixed by the class and the COMMANDED tag.",
  conditions: [],
  guards: [],
  feasibility: [
    "The battle must have more than one Pokemon on my side (doubles or triples)",
    "An adjacent ally must be an active Dondozo that has not fainted and is not already being commanded",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "enter next to a Dondozo", axes: {} }],
  status: "decomposed",
  notes:
    "PARKED (legacy-closure-pending-request): needs the WHEN event.ally-entered, see the header and requests/B04.md. Package, justified: the effect is four coupled steps around one found Dondozo and one tag (animation, tag, queued-move removal, tag lapse). Single user: Commander (attr 0). Engine coupling untouched: pokemon.ts hasAbilityWithAttr('CommanderAbAttr') (sprite hiding) and the COMMANDER_HOSTING engine query. SUSPECTED GAME BUG (not fixed): pokemon.ts:8127 hides the Commander sprite only when `currentBattle.double`, while canApply uses getBattlerCount() > 1 (comment says `double` is dead in triples), so in a triple battle the Commander gets the tag but its sprite is not hidden on load-in.",
});
