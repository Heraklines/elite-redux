/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. Tier C event-effect. "When I enter the battle, my slot on the field is marked for the rest of the battle."
//
// Source: fakemon-pitch-raichu.ts ElectrodynamicsPositionAbAttr (extends PostSummonAbAttr, dispatched as PostSummonAbAttr when I enter).
//   canApply  inherited (PostSummonAbAttr, always true): no condition, no guard.
//   apply     `if (!simulated) installElectrodynamicsPosition(pokemon)`:
//               resetBattleLocalState(); then, when `positionalTagManager.canAddTag(ELECTRODYNAMICS_POSITION, slot)`,
//               `addTag({ tagType: ELECTRODYNAMICS_POSITION, turnCount: 0, targetIndex: slot })`.
//             The tag does nothing by itself (it never triggers). The engine reads it through isElectrodynamicsPosition(pokemon), which is true
//             for whoever stands in that slot while the tag exists:
//               - Pokemon.isGrounded() is false there (so Ground moves score 0: Pokemon.getAttackTypeEffectiveness, and the grounding tests),
//               - the occupant counts as standing in Electric Terrain for the terrain benefits (isRaichuTerrainGrounded, the Electric Terrain
//                 sleep immunity of an Electrodynamics holder, the terrain power rider of the same ability).
// No random draw. The mark is added once per slot (a second add is refused by canAddTag). resetBattleLocalState() also clears the marks
// when a new battle begins. Nothing here is a number, a type or a status, so there is nothing to tune.
import { ElectrodynamicsPositionAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ElectrodynamicsPositionAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Mark my battle slot as charged for the rest of the battle",
  summary: () =>
    "When I enter, my slot is marked for the rest of the battle. Whoever stands there is off the ground (Ground moves cannot hit it) and gets Electric Terrain benefits there.",
  synonyms: [
    "electrodynamics",
    "charged slot",
    "permanent electric terrain on my side",
    "float my slot",
    "ground immunity for the slot",
    "slot effect",
    "magnetic field",
    "electric terrain position",
  ],
  examples: ["When I enter, my battle slot becomes charged: Ground moves cannot hit whoever stands there"],
  params: [],
  noParamsReason:
    "The mark is a fixed built-in flag on the battle slot: which slot it marks (mine) and for how long (the rest of the battle) are not settings of the class, and the benefits it gives are code in the engine readers, not numbers in the class.",
  conditions: [],
  guards: [],
  feasibility: [
    "Does nothing while the game is only previewing the entry",
    "A slot that is already marked is not marked twice",
    "The mark stays after I leave: whoever takes the slot keeps its benefits until the battle ends",
  ],
  // Package, reason in notes: the library has no effect that puts a mark on a battle slot.
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I enter the field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C package for the effect only; the trigger (when I enter) is the library WHEN and any condition can be ANDed on top (reusableAlone.if is true). Users (1): Electrodynamics (6062) attr 1; its other attrs (ElectrodynamicsTerrainPowerAbAttr at 0, AttackTypeImmunityAbAttr GROUND at 2, GroundedEntryHazardImmunityAbAttr at 3, ElectrodynamicsGalvanizeAbAttr at 4 and ElectrodynamicsGalvanizePowerAbAttr at 5) belong to other chunks and batches. Package, reason: the effect adds a PositionalTag of a type that exists only for this ability (ELECTRODYNAMICS_POSITION, never triggers; PositionalTagManager.activateAllTags skips it, so it is permanent) and the engine reads its presence by slot in several places (pokemon.ts and the Raichu helpers); there is no 'mark my slot' effect in the library, and what the mark DOES is engine code that asks the tag, not a number the class holds. Request R-B14-4.7 asks for an effect that marks a battle slot with a named, lasting mark. The guard `not simulated` is inside apply (the class skips previews); it is listed as feasibility because the library guard is only requested. Oddities, not fixed: (1) the mark outlives the holder, so after a switch the new occupant is floated and charged although it never had the ability, which the code comment calls 'positions retain'; (2) isElectrodynamicsPosition also calls resetBattleLocalState(), which cleans module memory when the battle changed, so merely asking can clear marks of an old battle; (3) simulated entries are ignored, so a preview never shows the mark.",
});
