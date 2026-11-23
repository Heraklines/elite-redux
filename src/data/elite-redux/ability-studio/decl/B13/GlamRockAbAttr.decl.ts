/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Glam Rock (Tier B, package effect). "At the end of each turn, eat one layer of an entry hazard on my side and raise Defense and Sp. Def."
//
// Source: abilities/newcomer-signature-mechanics.ts, GlamRockAbAttr (PostTurnAbAttr; the constructor now takes
// layersRemoved and stages, defaults = the old literals 1 and 1).
//   canApply, ONE clause, now the gate: any of the eight hazards (Spikes, Toxic Spikes, Stealth Rock, Sticky Web, Hot
//     Coals, Foamy Web, Creeping Thorns, Infestation trap) is on MY side of the field
//     -> library atoms any( field.arena-tag X on holder-side, ... ), eight of them, in the class's own HAZARDS order
//   apply, in order:
//     1. simulated: stop
//     2. pick the FIRST hazard of HAZARDS (that fixed order) that is on my side; none: stop
//     3. layers > layersRemoved: layers -= layersRemoved, otherwise the tag is removed
//     4. notifyHazardRemovedBy(holder): if the holder has Sediment Bloom's marker, plant a Sediment Bloom on the foes' side
//     5. message "... Glam Rock consumed an entry hazard!"
//     6. queue +stages for Defense and Sp. Def on the holder
// No RNG. The gate reads the same arena call (getTagOnSide) as the library atom.
import { GlamRockAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(GlamRockAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.end-of-turn",
  label: "Eat a layer of a hazard on my side and raise my defences",
  summary: params =>
    `At the end of the turn, if an entry hazard is on my side, one hazard loses ${params.layersRemoved} layer (or disappears) and my Defense and Sp. Def rise by ${params.stages} stage.`,
  synonyms: [
    "clear hazards",
    "eat spikes",
    "hazard to defence",
    "stealth rock eater",
    "hazard removal boost",
    "glam rock",
  ],
  examples: ["At turn end, remove one layer of Spikes on my side and gain +1 Defense and Sp. Def"],
  params: [
    {
      id: "layersRemoved",
      ctorIndex: 0,
      path: "layersRemoved",
      control: "number",
      label: "Layers removed from the hazard each turn",
      editable: true,
      gateIndependent: true,
      default: 1,
      min: 1,
      max: 3,
      step: 1,
      integer: true,
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      label: "Stages gained by Defense and Sp. Def (1-6)",
      editable: true,
      gateIndependent: true,
      default: 1,
      min: 1,
      max: 6,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The one clause of canApply: at least one entry hazard on my side (eight library atoms, see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hazard that is eaten is chosen by the class in a fixed order (Spikes, Toxic Spikes, Stealth Rock, Sticky Web, Hot Coals, Foamy Web, Creeping Thorns, Infestation trap), whatever the condition says",
    "If I also carry the Sediment Bloom mark, eating a hazard plants a Sediment Bloom on the foes' side",
  ],
  effect: { id: "effect.package", params: ["layersRemoved", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // No hazard is on the field in the grid, so the gate is false; the hazard cases are in B13/glam-rock.test.ts.
      name: "turn end with no hazard on my side",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (end of turn) and the hazard-on-my-side condition are separate and bound to eight library atoms. Why the effect cannot be split with today's blocks: it removes ONE layer from the first hazard of a fixed list (a field edit with layers), tells Sediment Bloom about it, and raises TWO stats in a single queued change; the library has no 'remove hazard layers' effect (requested as R-B13-18, which also asks effect.stat-stage to accept a list of stats). Review of the numbers: the layers (1) and the stages (1) were literals, now trailing constructor arguments with the old values as defaults; the layers semantic 'layers > n ? layers -= n : remove' equals the old 'layers > 1 ? layers-- : remove' for n = 1. Users: Glam Rock (5975, attr 1; attr 0 is ForceSwitchOutImmunityAbAttr, the 'cannot be forced out' half, which is another batch's class). ODDITIES (not fixed): (1) the gate and the effect each list the hazards separately; a staff gate that names only one hazard still lets apply eat the first hazard on the field, which may be another one. (2) The effect does nothing when simulated and has no other clause. (3) The Infestation trap is an ER hazard tag, not a vanilla one.",
});
