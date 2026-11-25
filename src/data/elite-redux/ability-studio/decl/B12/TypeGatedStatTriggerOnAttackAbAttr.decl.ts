/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "After I use a move of one type, change my stats (and maybe clear the hazards on my side)" (Spinning Top, Spin To Win).
//
// Source: src/data/elite-redux/archetypes/type-gated-stat-trigger-on-attack.ts, TypeGatedStatTriggerOnAttackAbAttr (extends PostAttackAbAttr).
// Constructor: one options object `{ type, stats, clearHazards? }`; `super(undefined, false)` keeps the parent's default attack condition (damaging
// move), which the class never consults (its canApply does not call the parent), and hides the ability banner. Dispatched after a hit
// (applyAbAttrs("PostAttackAbAttr") in MoveEffectPhase.applyOnTargetEffects, once per target and per hit). Clauses, in the original order (Tier B):
//   canApply  the move's type AFTER other abilities changed it (`pokemon.getMoveType(move)`) is `type`      GATE (replaceable), the whole old canApply
//   apply 1   `simulated` -> nothing                                                                          respects the preview flag
//   apply 2   one StatStageChangePhase per entry of `stats` (holder, selfTarget true), in the order given     EFFECT (stat change)
//   apply 3   when `clearHazards`: remove Spikes, Toxic Spikes, Stealth Rock and Sticky Web from MY side      EFFECT (hazard clearing, no library block yet)
// No random draw, no state.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeGatedStatTriggerOnAttackAbAttr } from "#data/elite-redux/archetypes/type-gated-stat-trigger-on-attack";
import { hazardSwitchCodec, statChangesInOptionsCodec, typeInOptionsCodec } from "./b12-chunk4-codecs";

// The class keeps its three settings in one private options object; each codec reads its own key back from it.
const IN_OPTIONS = { ctorIndex: 0, path: "opts" } as const;

export default defineDecl(TypeGatedStatTriggerOnAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change my stats after using a move of one type",
  summary: params =>
    `After I use a ${params.type} move, my stats change: ${params.stats}. It can also clear the hazards on my side. Example: Fighting, Speed +1 and clear hazards, like Spinning Top.`,
  synonyms: [
    "stat boost after a type of move",
    "speed boost after fighting move",
    "clear hazards after attacking",
    "rapid spin effect",
    "spinning top",
    "spin to win",
    "type triggered boost",
  ],
  examples: [
    "After a Fighting move, raise my Speed by one stage and clear the hazards on my side, like Spinning Top",
    "After a Water move, raise my Sp. Atk by one stage",
  ],
  params: [
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "type",
      control: "select",
      label: "Move type that sets it off",
      editable: true,
      default: "FIGHTING",
      options: TYPE_OPTIONS,
      codec: typeInOptionsCodec("type"),
    },
    {
      id: "stats",
      ...IN_OPTIONS,
      ctorOption: "stats",
      control: "text",
      label: "Stat changes, like 'Speed +1, Defense -1' (stages -6 to 6)",
      editable: true,
      // Only the effect reads it; the gate (the move type) never repeats it.
      gateIndependent: true,
      default: "Speed +1",
      codec: statChangesInOptionsCodec,
    },
    {
      id: "clearHazards",
      ...IN_OPTIONS,
      ctorOption: "clearHazards",
      control: "boolean",
      label: "Also clear Spikes, Toxic Spikes, Stealth Rock and Sticky Web from my side",
      editable: true,
      gateIndependent: true,
      default: false,
      codec: hazardSwitchCodec,
    },
  ],
  // The type setting is the same value as the gate's type: moving the setting moves the compiled gate's type.
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [
    // The gate: the move's type after other abilities changed it is the type (move.type { effective: true }).
    { slot: "gate", ctx: "params", lib: "move.type", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
    "Only hazards on my own side are cleared",
  ],
  // The stat change is the library effect; clearing hazards has no library block (R-B12-31), so it stays a typed switch of the same block.
  effect: { id: "effect.stat-stage", params: ["stats", "clearHazards"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Moves of the type and of other types reach both sides of the gate; B12's own test drives the type-changed moves.
      name: "fighting and other moves of the holder",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 2 attrs, every gate bound to move.type { effective: true } (FIGHTING): Spinning Top (5142 attr 0) and Spin To Win (20021 attr 0, a saved editor ability), both Speed +1 and clearHazards. The old canApply was the type test alone; it is the gate method now. The effect is the stat change plus an optional hazard clear: the stat part is the library effect (effect.stat-stage, one phase per listed stat, in the listed order), the hazard part has no library block (request R-B12-31) and stays a switch of this block. Oddities, not fixed: (a) the class overrides canApply WITHOUT calling the parent, so the parent's default 'damaging move' test is never applied: the class accepts a STATUS move of the configured type too (B12/chunk4.test.ts proves it with a Fighting status move), which the dex text 'Fighting moves' may or may not intend; (b) it runs once per hit and per target, so a multi-hit or spread move changes the stats several times; (c) the hazards removed are exactly Spikes, Toxic Spikes, Stealth Rock and Sticky Web (other hazards such as Foamy Web or Creeping Thorns stay); (d) the ability banner is hidden; (e) a stage number the game cannot reach (above 6) is clamped by the stat phase.",
});
