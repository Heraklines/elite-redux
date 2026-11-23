/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "When the terrain becomes Toxic Terrain while I am on the field, I get a status condition (poison)" (Toxic Boost, the terrain half).
//
// Source: src/data/elite-redux/archetypes/toxic-terrain-self-poison.ts, ToxicTerrainSelfPoisonOnTerrainChangeAbAttr (extends PostTerrainChangeAbAttr).
// Dispatched once per Pokemon on the field after `arena.trySetTerrain` set the new terrain (applyAbAttrs("PostTerrainChangeAbAttr",
// { pokemon, terrain })). Constructor: `(status = Poison)`, optional, added in chunk 3.
// Clauses, in the original order (Tier B):
//   canApply  the terrain that just began is Toxic Terrain  GATE (replaceable), the whole old canApply
//   apply 1   `simulated` -> nothing                          respects the preview flag
//   apply 2   (old) Toxic Terrain is the terrain on the field: a SECOND test of the same fact. It is dropped in chunk 3; the event's own
//             terrain IS the terrain on the field at that moment (see notes), so the gate is the only terrain test and can be replaced
//   apply 3   the holder has fainted or already has a status FEASIBILITY (stays in the class)
//   apply 4   `pokemon.trySetStatus(status, pokemon)`        EFFECT
// No random draw, no state.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STATUS_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { ToxicTerrainSelfPoisonOnTerrainChangeAbAttr } from "#data/elite-redux/archetypes/toxic-terrain-self-poison";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(ToxicTerrainSelfPoisonOnTerrainChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.terrain-changed",
  label: "Give myself a status condition when the terrain changes",
  summary: params =>
    `The moment the terrain changes I get ${params.status}, even if I am flying. Example: Poison when the terrain becomes Toxic Terrain, like Toxic Boost. Nothing happens if I already have a status.`,
  synonyms: [
    "toxic boost",
    "poison myself",
    "self poison",
    "toxic terrain",
    "poisoned by terrain",
    "status when terrain changes",
    "self inflicted status",
  ],
  examples: [
    "Poison myself when the terrain becomes Toxic Terrain, like Toxic Boost",
    "Paralyze myself when the terrain changes (change the status and the terrain test)",
  ],
  params: [
    {
      id: "status",
      ctorIndex: 0,
      path: "status",
      control: "select",
      label: "Status condition I get (Toxic = badly poisoned)",
      editable: true,
      gateIndependent: true,
      default: "POISON",
      options: STATUS_OPTIONS,
      codec: enumCodec(StatusEffect, "status"),
    },
  ],
  conditions: [
    // The gate: "the terrain that just began is Toxic Terrain" (the event's own terrain). Same request as the entry class (R-B12-20):
    // the atom has to read the terrain object, and for this trigger the event's terrain equals it.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Nothing happens if I have fainted or already have a status condition",
    "A Pokemon that cannot get the status (for example a Poison or Steel type for poison) stays unaffected",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.inflict-status", params: ["status"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "terrain changing to toxic and to other terrains", axes: {} }],
  l2StaticReason:
    "The only user's gate is a legacy-closure (no atom for 'the terrain that began is Toxic'), so the shared L2 has no rebuilt attr to twin. B12's own test (B12/chunk3.test.ts) sets every terrain in a real battle and compares the class with the old formula.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request for the gate of the one user: Toxic Boost (137 attr 3, status Poison). The old apply tested 'Toxic Terrain is on the field' a second time through a helper; the event's terrain equals the terrain on the field at the moment of dispatch (arena.trySetTerrain sets it just before the loop that dispatches), so that second test never changed an outcome and was dropped to make the gate honestly replaceable. The only case where they could differ is an earlier ability in the same dispatch loop changing the terrain again (none of the terrain, seed or tag handlers does). The status became an optional constructor argument (default Poison). Request R-B12-20 for the atom. Oddities, not fixed: (a) the terrain test uses the terrain the event reports, which Clueless does not hide, while the terrain's chip damage does ignore a Clueless field; (b) a holder that is already poisoned (or has any status) is left alone and the poison is not renewed.",
});
