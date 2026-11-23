/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / calc-modifier (Tier A: the weather test is a constructor closure, the blocked statuses a rest list).
//
// Read by hand from archetypes/sand-cloak.ts and the parents in ab-attrs.ts. It extends
// ConditionalUserFieldStatusEffectImmunityAbAttr (WHEN "while the game checks my side's status immunity"). The constructor takes
// `(condition = () => sandActive(), ...immuneEffects)` and hands both to the parent; the dispatcher calls it with nothing, so
// the default is what ships.
//   sandActive = `arena.weather?.weatherType === SANDSTORM && !arena.weather.isEffectSuppressed()`
//   canApply (the parent's): `!cancelled && condition(target, source) && super.canApply`, where the base class says
//     "no effect list: block every status except FAINT; else block the listed ones".
//   apply: the CancelInteraction one, it only sets `cancelled`.
// The condition (slot ctor:0) and the blocked statuses (setting at ctor argument 1 onwards) are both handed in. No random draw.
// Nothing is read from `simulated`.
//
// The sandstorm test is NOT the library atom field.weather: that atom reads `arena.weatherType` and ignores suppression, this
// one also asks `isEffectSuppressed`. Until the suppression-aware atom exists (request R-B11-05 in requests/B11.md) the shipped
// closure is a legacy-closure binding: reusable as a whole, swappable by staff, counted as undecomposed.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SandStatusImmunityAbAttr } from "#data/elite-redux/archetypes/sand-cloak";
import { BLOCKED_STATUS_ALL, BLOCKED_STATUS_OPTIONS, blockedStatusCodec } from "./b11-chunk3-codecs";

export default defineDecl(SandStatusImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.status-immunity-field",
  label: "Block status conditions on my whole side",
  summary: params =>
    `While the condition holds (a sandstorm for the shipped abilities), neither I nor my allies can get ${params.blockedStatus === BLOCKED_STATUS_ALL ? "any status condition (burn, poison, sleep and so on)" : `the ${String(params.blockedStatus).toLowerCase()} status`}. Example: a foe's Will-O-Wisp fails in sand.`,
  synonyms: [
    "sand veil",
    "desert cloak",
    "dune veil",
    "status immunity in sand",
    "safe in a sandstorm",
    "team status guard",
    "flower veil",
  ],
  examples: ["My whole side is immune to status conditions while the sandstorm rages"],
  params: [
    {
      id: "blockedStatus",
      ctorIndex: 1,
      path: "immuneEffects",
      control: "select",
      label: "Which status condition to block (All = every one except fainting)",
      editable: true,
      default: BLOCKED_STATUS_ALL,
      options: BLOCKED_STATUS_OPTIONS,
      codec: blockedStatusCodec,
      spread: true,
    },
  ],
  conditions: [
    // The sandstorm test of the shipped abilities (a legacy closure for now, see the header). Staff swap it for any condition.
    { slot: "ctor:0", ctx: "holder", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Fainting is never blocked", "Works for me and for my allies, not for the foes"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a sandstorm, another weather and no weather", axes: { weather: ["SANDSTORM", "RAIN", "NONE"] } }],
  status: "decomposed",
  notes:
    "Tier A, justified in the header. Users: Desert Cloak and Dune Veil, always together with SandSecondaryEffectImmunityAbAttr (dispatcher: `ok([new SandStatusImmunityAbAttr(), new SandSecondaryEffectImmunityAbAttr()])`). Both are bound as a legacy closure (sandstorm and NOT suppressed, request R-B11-05), so the shared L1 differential and the L2 twin leave them out (an attr with a legacy binding cannot be rebuilt); chunk3.test.ts rebuilds the attr with the original closure handed in and drives it in a sandstorm, a suppressed sandstorm and other weather. The class never reads `simulated`, so a preview behaves like the real check. The module-level `sandActive` helper is shared with SandSecondaryEffectImmunityAbAttr.",
});
