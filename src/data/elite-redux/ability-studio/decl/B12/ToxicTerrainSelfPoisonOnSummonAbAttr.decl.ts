/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "When I enter the battle during Toxic Terrain, I get a status condition (poison)" (Toxic Boost, the entry half).
//
// Source: src/data/elite-redux/archetypes/toxic-terrain-self-poison.ts, ToxicTerrainSelfPoisonOnSummonAbAttr (extends PostSummonAbAttr).
// Constructor: `(status = Poison)`, an optional argument added in chunk 3 (before, Poison was fixed in the code). Dispatched from the
// switch-in phase (applyAbAttrs("PostSummonAbAttr")); `super()` keeps the ability banner on and the effect on when the ability is
// gained in the middle of a battle.
// Clauses, in the original order (Tier B, the gate is read INSIDE `apply`, see below):
//   canApply  none (the base class answers true)            so the ability banner is queued on EVERY entry, toxic or not
//   apply 1   `simulated` -> nothing                         respects the preview flag
//   apply 2   Toxic Terrain is the terrain set on the field  GATE (replaceable). It reads the terrain object itself
//             (`arena.terrain?.terrainType`), NOT `arena.terrainType`, which Clueless turns into "no terrain"
//   apply 3   the holder has fainted or already has a status FEASIBILITY (stays in the class)
//   apply 4   `pokemon.trySetStatus(status, pokemon)`        EFFECT; type immunities (Poison, Steel) still decide inside it
// No random draw, no state. The gate is evaluated from `apply` and not from `canApply` on purpose: moving it into `canApply` would
// stop the banner on entries without Toxic Terrain, which is a visible change, and this change must not alter the game.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STATUS_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { ToxicTerrainSelfPoisonOnSummonAbAttr } from "#data/elite-redux/archetypes/toxic-terrain-self-poison";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(ToxicTerrainSelfPoisonOnSummonAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Give myself a status condition when I enter the battle",
  summary: params =>
    `As soon as I enter the battle I get ${params.status}, even if I am flying. Example: Poison while Toxic Terrain is active, like Toxic Boost. Nothing happens if I already have a status.`,
  synonyms: [
    "toxic boost",
    "poison myself",
    "self poison",
    "toxic terrain",
    "start poisoned",
    "self inflicted status on entry",
    "status on switch in",
  ],
  examples: [
    "Poison myself when I enter while Toxic Terrain is active, like Toxic Boost",
    "Burn myself when I enter the battle (change the status setting)",
  ],
  params: [
    {
      id: "status",
      ctorIndex: 0,
      path: "status",
      control: "select",
      label: "Status condition I get (Toxic = badly poisoned)",
      editable: true,
      // Only the effect reads it; the gate (is the terrain toxic) never repeats it.
      gateIndependent: true,
      default: "POISON",
      options: STATUS_OPTIONS,
      codec: enumCodec(StatusEffect, "status"),
    },
  ],
  conditions: [
    // The gate: "Toxic Terrain is set on the field", read from the terrain object itself. The library atom field.terrain reads
    // arena.terrainType, which Clueless turns into "no terrain", so it is not the same test: request R-B12-20.
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
  probes: [{ name: "entering with and without Toxic Terrain", axes: {} }],
  l2StaticReason:
    "The only user's gate is a legacy-closure (no atom for 'Toxic Terrain is set, even under Clueless'), so the shared L2 has no rebuilt attr to twin. B12's own test (B12/chunk3.test.ts) drives the class in a real battle with and without Toxic Terrain.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request for the gate of the one user: Toxic Boost (137 attr 2, status Poison). The class is split for chunk 3 into a replaceable `gate` (Toxic Terrain is set on the field, evaluated INSIDE apply so the banner still shows on every entry) and the effect; the status became an optional constructor argument (default Poison, so the shipped behaviour is unchanged). The gate has no atom that reads the same value (field.terrain asks arena.terrainType, which Clueless turns into NONE): request R-B12-20. Oddities, not fixed: (a) the ability banner shows on EVERY entry of a Toxic Boost holder, also without Toxic Terrain (the old code did the same; the test is in apply, after the banner), which looks unintended; (b) because the terrain object is read raw, a Toxic Boost holder entering while Clueless suppresses the terrain is still poisoned, while its Toxic Terrain chip damage would not apply (the dex says 'regardless of grounding', so this may be intended).",
});
