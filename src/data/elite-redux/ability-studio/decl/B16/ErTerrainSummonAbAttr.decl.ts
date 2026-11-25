/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier A, event-effect). "When I enter the battle, set the terrain and make it last a set number of turns."
//
// Source: init-elite-redux-vanilla-rebalance.ts, ErTerrainSummonAbAttr (extends PostSummonTerrainChangeAbAttr), put in place of the vanilla
// attr by patchTerrainSummoner (`new ErTerrainSummonAbAttr(terrainType, turns)`; every user passes 8 turns). Constructor `(terrain, turns)`:
// terrain is argument 0 (parent, private field `terrainType`), turns argument 1 (`erTurns`). Clauses:
//   canApply  the parent's, not overridden: `arena.canSetTerrain(terrainType)` = the stored terrain differs from the requested one
//             (effect-side feasibility, kept in the class, as in the parent's declaration of B03)
//   apply     (skipped when `simulated`) 1. super.apply: `arena.trySetTerrain(terrainType, false, holder)`  (base 5 turns, plus extender)
//             2. then, if ANY terrain is active and has turns left (no check that it is the terrain I set, unlike the weather half), its
//                `turnsLeft` is overwritten with `erFieldTurnsWithItems(holder, erTurns)` = erTurns plus the Terrain Extender style item.
//                `maxDuration` is not written (terrains have none).
// No random draw, no state.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { ErTerrainSummonAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { TerrainType } from "#data/terrain";

export default defineDecl(ErTerrainSummonAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Set the terrain for a set number of turns when I enter",
  summary: params =>
    `When I enter the battle, I set the terrain to ${params.terrain} for ${params.turns} turns (a terrain-extending item adds more). Example: 8 = the terrain lasts 8 turns.`,
  synonyms: [
    "psychic surge",
    "grassy surge",
    "misty surge",
    "hadron engine",
    "summon terrain",
    "timed terrain",
    "long terrain",
    "terrain setter",
  ],
  examples: ["Set Grassy Terrain for 8 turns when I enter the battle, like Grassy Surge"],
  params: [
    {
      id: "terrain",
      ctorIndex: 0,
      path: "terrainType",
      control: "select",
      label: "Which terrain (None clears it)",
      editable: true,
      default: "PSYCHIC",
      options: enumOptions(TerrainType),
      codec: enumCodec(TerrainType, "terrain"),
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "erTurns",
      control: "number",
      label: "How many turns the terrain lasts (an extending item adds more)",
      editable: true,
      integer: true,
      min: 1,
      max: 20,
      step: 1,
      default: 8,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The terrain must differ from the one that is already set",
    "The field may still refuse the new terrain (a protected Toxic terrain is not overwritten by an ordinary one)",
    "The new length is written to whatever terrain is active afterwards, if it has turns left",
    "Nothing happens while the game only previews the entry",
  ],
  effect: { id: "effect.set-terrain", params: ["terrain", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, fully decomposed: trigger (on entry), no IF (the one canApply clause is effect-side feasibility, like the parent declaration of B03), one effect (set the terrain) with two typed params. effect.set-terrain has no length setting: R-B16-19 in requests/B16.md (it replaces the 5-turn base and keeps the extender). Five users, all 8 turns, none with a closure so nothing to bind: Psychic Surge (227, Psychic, attr 0), Misty Surge (228, Misty, attr 0), Grassy Surge (229, Grassy, attr 0), Hadron Engine (289, Electric, attr 0), Psychic Supremacy (20000, Psychic, attr 2). patchTerrainSummoner replaces the vanilla attr in place, so the class sits at the position the vanilla attr had. SUSPECTED GAME INCONSISTENCY, not fixed: Electric Surge is not patched to 8 turns (only Hadron Engine is), see the B03 declaration. Oddity: unlike the weather half, the length is written to ANY active terrain with turns left, even one this ability did not set (a protected terrain that refused the new one still gets its turns overwritten).",
});
