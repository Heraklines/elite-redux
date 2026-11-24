/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier (a cancel check), Tier B (the gate sits inside canApply). See ../PRECEDENTS.md.
//
// The ENGINE dispatches this key from the status tick (post-turn-status-effect-phase.ts:34 and :35, right after
// BlockNonDirectDamageAbAttr): `applyAbAttrs("BlockStatusDamageAbAttr", { pokemon, cancelled })`; when `cancelled` comes back
// true the poison or burn damage of that turn is skipped. canApply is now `guards && gate`, in the ORIGINAL clause order
// (there is no prepare step, no residual and no random draw):
//   1. guard  `!cancelled.value`   nothing blocked it yet (inherited rule of every cancel check)
//   2. gate   the holder has one of the listed statuses   `!!pokemon.status?.effect && effects.includes(status.effect)`
//                                                         <- staff may replace it
// apply (inherited) sets `cancelled.value = true`.
import { BlockStatusDamageAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(BlockStatusDamageAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "cancel.indirect-damage",
  label: "Block damage from chosen status conditions",
  summary: params =>
    `I take no damage from these status conditions: ${params.statuses}. Example: poisoned or badly poisoned and still no end-of-turn damage, like Poison Heal.`,
  synonyms: [
    "poison heal",
    "no poison damage",
    "no burn damage",
    "status damage immunity",
    "toxic boost",
    "marvel scale",
    "flare boost",
  ],
  examples: ["No damage from poison or toxic, like Poison Heal", "No damage from burn, like Flare Boost"],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "effects",
      control: "text",
      // The list is also the gate ("I have one of these statuses"), which staff edit through the gate block. This list
      // only feeds the class's own default gate, so editing it alone would not move a replaced gate.
      label: "Status conditions it blocks damage from (comma separated names)",
      editable: false,
      default: "POISON,TOXIC",
      codec: enumListCodec(StatusEffect, "status condition"),
      spread: true,
    },
  ],
  conditions: [
    // The gate: "I have one of these statuses" (any of status.has). Each user's binding repeats its own list (bindings.ts).
    { slot: "gate", ctx: "params", lib: "status.has", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Does nothing when the damage was already blocked by something earlier"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the holder has each of the three statuses at the end of the turn", axes: { status: ["POISON", "TOXIC", "BURN"] } }],
  status: "decomposed",
  notes:
    "Tier B. Users: Marvel Scale (63 attr 1, poison/toxic/burn), Poison Heal (90 attr 1, toxic/poison), Toxic Boost (137 attr 1, poison/toxic), Flare Boost (138 attr 1, burn), Rainbow Fish (5943 attr 2, poison/toxic/burn), Decay (6051 attr 2, poison/toxic). All six covered by a gate binding (any of status.has on the holder). The rest of the rule, `!cancelled.value`, is kept first as the class's `guards` to keep the original order. The `statuses` list is not editable on purpose (a list cannot be repeated inside the gate atoms): staff change the statuses through the gate block. The shared WHEN `cancel.indirect-damage` lists this key as dispatched at the same moment as BlockNonDirectDamageAbAttr, which is only true for the status tick; a WHEN of its own is requested (R-B05-14). The class never reads `simulated`.",
});
