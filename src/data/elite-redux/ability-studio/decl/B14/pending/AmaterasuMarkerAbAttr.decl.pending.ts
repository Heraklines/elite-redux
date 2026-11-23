/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-3.1, same
// shape as R-B14-2.3 and R-B12-13); then rename this file to AmaterasuMarkerAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "A burn I inflict can not be cured for the rest of the battle."
//
// Source: bernerd-roster-mechanics.ts `export class AmaterasuMarkerAbAttr extends AbAttr {}`: an empty class, a presence marker.
// Nothing dispatches it. Two places read it, both by class NAME, both in src/field/pokemon.ts:
//   trySetStatus (:7890)   after a status was set: if it is BURN and the SOURCE of the burn has the marker, remember the burner:
//                          `waveData.amaterasuBurnSourceId = source.id`
//   resetStatus (:8034)    when the current status is BURN and that id is set, return without curing anything. waveData is reset at
//                          the next encounter, so ordinary between-battle cleanup still works.
// The cure paths found (berries, cure moves, heal phases, party heal) all go through resetStatus, so none of them works.
// No constructor, no closure, no random draw. The check is by class name: it must never be renamed.
import { AmaterasuMarkerAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AmaterasuMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Make burns I cause impossible to cure this battle",
  summary: () =>
    "While I have this, a burn I inflict cannot be healed for the rest of the battle, even if I faint or switch out. Example: cure moves and berries do nothing to it.",
  synonyms: [
    "unhealable burn",
    "permanent burn",
    "burn cannot be cured",
    "lasting burn",
    "amaterasu",
    "black flames",
    "no cure",
  ],
  examples: ["Foes I burn stay burned until the battle ends, whatever they use to cure it"],
  params: [],
  noParamsReason:
    "A presence marker read when a burn is set and when a status is cured; the only choice (burn) and the rule (until the battle ends) are in the engine code, so nothing in the class can be tuned.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only burns are made permanent; every other status can still be cured",
    "It lasts until the next battle starts, not forever",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks in the default battle and the battles must match. The burn memory itself is driven by B14/chunk3.test.ts.",
  probes: [{ name: "the holder attacks a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (2): Amaterasu (6106) attr 0 and Blaze Release (6108) attr 3 (after TypeConversionAbAttr, StabAddAbAttr and AteConditionalStatusAbAttr). Oddity, not fixed: waveData.amaterasuBurnSourceId is never cleared inside a battle, so if the burned Pokemon faints, is revived (status cleared by a path that checks FAINT rather than BURN) and is later burned by an ordinary Pokemon in the same wave, that new burn is also uncurable.",
});
