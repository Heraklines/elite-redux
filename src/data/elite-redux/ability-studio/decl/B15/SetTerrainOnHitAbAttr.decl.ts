/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Tier B. "When a damaging move hits me (any move, for both users), the terrain changes to the one I carry."
//
// Source: src/data/elite-redux/abilities/set-arena-effect-on-hit.ts, class SetTerrainOnHitAbAttr (extends PostDefendAbAttr; constructor takes ONE options object
// { terrain, contactRequired = false }, showAbility stays true). Sibling of SetArenaTagOnHitAbAttr (chunk 4). canApply, now guards && gate && residual in the ORIGINAL
// clause order (no random draw in canApply):
//   1. guards    hitResult < HitResult.NO_EFFECT                                                        -> GUARD (the hit connected: not a miss, a block or an immunity)
//   2. gate      !contactRequired || move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })  -> CONDITION (the contact clause)
//   3. residual  none (the class always answers true after the gate)
// apply (effect), not when simulated: globalScene.arena.trySetTerrain(terrain, false, holder). force = false, so the arena's own priority rules apply; it silently does nothing
// when that terrain is already active. No message of its own beyond the arena's, no random draw.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); guards and gate are the two clauses above verbatim. `gateOverride` is declared for the compiler.
// contactRequired changes the SHAPE of the gate (an always-true gate when false), so it is not an editable setting: staff add or remove the contact condition block instead.
import { SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TerrainType } from "#data/terrain";

const TERRAIN_CHOICES = ["MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"];

export default defineDecl(SetTerrainOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Set a terrain when I am hit",
  summary: params =>
    `When a damaging move hits me${params.contactRequired === true ? " and makes contact" : ""}, the terrain becomes ${params.terrain} Terrain (unless it already is). Example: Electric Terrain after every hit I take.`,
  synonyms: [
    "terrain when hit",
    "electric terrain when hit",
    "psychic terrain when hit",
    "change the terrain when attacked",
    "react with a terrain",
    "surge when hit",
    "power leak",
    "brain overload",
  ],
  examples: [
    "Any damaging hit on me sets Electric Terrain, like Power Leak",
    "Getting hit sets Psychic Terrain, like Brain Overload",
  ],
  params: [
    {
      id: "terrain",
      ctorIndex: 0,
      ctorOption: "terrain",
      path: "terrain",
      control: "select",
      label: "Terrain to set",
      editable: true,
      gateIndependent: true,
      default: "ELECTRIC",
      options: TERRAIN_CHOICES,
      codec: enumCodec(TerrainType, "terrain"),
    },
    {
      id: "contactRequired",
      ctorIndex: 0,
      ctorOption: "contactRequired",
      path: "contactRequired",
      control: "boolean",
      label: "Only when the move makes contact",
      // Changes the shape of the gate; staff add or remove the contact condition block instead.
      editable: false,
      default: false,
    },
  ],
  conditions: [
    // The gate is the contact clause (move.flag MAKES_CONTACT), always true when contact is not required.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must have connected: a miss, a block or an immunity does nothing",
    "A terrain that is already active is left alone, and the field's own terrain priority rules decide",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.set-terrain", params: ["terrain"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A contact move and a non-contact move: the contact clause decides (both users bind the always-true gate).
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, event effect with the library effect effect.set-terrain (implemented), not a package. 2 attrs in 2 abilities, each bound individually: Power Leak (5599 attr 0, Electric Terrain) and Brain Overload (5655 attr 0, Psychic Terrain); both have contactRequired false, so both bind the always-true gate and any damaging hit sets the terrain. The 'the hit connected' clause (hitResult < NO_EFFECT) stays in the class as a safety rule (guards): the guard registry has no id for it, so it is listed as feasibility and requested as R-B15-26 (same guard as Scrapyard-style hazards and Spiteful). The contact clause is bound to the library atom move.flag MAKES_CONTACT (the same Move.doesFlagEffectApply with the attacker as user and me as target) for a user that needs contact. The effect is trySetTerrain(terrain, false, holder): the library effect.set-terrain is the same call shape for the PostSummon moment; its use after a hit (source = me) is covered by the same effect, nothing to request except that the L2 twin shows the order. Suspected oddity, NOT fixed: the attr applies after EVERY damaging hit even when that terrain is already active (a silent no-op in the arena), so the ability flyout is shown each time (showAbility is true); that matches the ability text 'sets the terrain when hit'.",
});
