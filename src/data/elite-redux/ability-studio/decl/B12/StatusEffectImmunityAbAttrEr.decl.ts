/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. "I cannot get these status conditions" (Juggernaut, Iron Giant, Sumo Guard, Blood Stigma, Hyper Cleanse, Rude Awakening).
//
// Source: src/data/elite-redux/archetypes/status-immunity.ts, StatusEffectImmunityAbAttrEr (extends the vanilla
// StatusEffectImmunityAbAttr, whose body is empty, which extends PreSetStatusEffectImmunityAbAttr, ab-attrs.ts:3946).
// Constructor: one options object `{ statuses }`; it throws for FAINT and for NONE, then calls `super(...statuses)`.
// Behaviour is entirely the parent's, so there is no clause of its own:
//   canApply  `!cancelled.value && ((immuneEffects.length === 0 && effect !== FAINT) || immuneEffects.includes(effect))`
//             1. `!cancelled.value`: the cancel-chain convention (nothing blocked it yet)       feasibility
//             2. which statuses are blocked (an EMPTY list means every status except FAINT)       the class's SETTING (not a gate)
//   apply     `cancelled.value = true`                                                          EFFECT "Block it" (ignores `simulated`)
// Dispatch: Pokemon.canSetStatus (pokemon.ts) asks the target's own ability with the status about to land, and the battler-tag
// path of freeze does the same. No random draw, no state. Tier A: the only input is the constructor list.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatusEffectImmunityAbAttrEr } from "#data/elite-redux/archetypes/status-immunity";
import { statusListCodec } from "./b12-chunk2-codecs";

export default defineDecl(StatusEffectImmunityAbAttrEr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.status-immunity",
  label: "Block chosen status conditions from landing on me",
  summary: params =>
    String(params.statuses).trim().length === 0
      ? "No status condition can land on me. Example: nothing ever poisons, burns, paralyses, freezes or puts me to sleep."
      : `${params.statuses} cannot land on me. Example: choose Paralysis and no foe can paralyse me.`,
  synonyms: [
    "immune to paralysis",
    "immune to status",
    "cannot be statused",
    "status immunity",
    "limber",
    "insomnia",
    "comatose",
    "never sleep",
  ],
  examples: ["Immune to paralysis, like Juggernaut", "Immune to every status condition, like Hyper Cleanse"],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      ctorOption: "statuses",
      path: "configuredStatuses",
      control: "text",
      label:
        "Status conditions I resist, comma separated: Poison, Bad poison, Paralysis, Sleep, Freeze, Burn (empty = all)",
      editable: true,
      default: "Paralysis",
      codec: statusListCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A status that another ability or effect already blocked is left alone",
    "Leaving the list empty blocks every status condition except fainting; fainting itself can never be blocked",
  ],
  effect: { id: "effect.negate", params: ["statuses"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "the foe paralyses me (Glare) and burns me (Will-O-Wisp)",
      axes: { foeMove: ["GLARE", "WILL_O_WISP"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, 6 attrs, nothing to bind (no closure): Juggernaut (5059 attr 1, Paralysis), Iron Giant (5386 attr 4, Paralysis), Sumo Guard (5637 attr 1, Paralysis), Rude Awakening (5440 attr 0, Sleep), Blood Stigma (5378 attr 0, every status) and Hyper Cleanse (5556 attr 0, every status). Rude Awakening carries an ATTR-LEVEL condition (`AbAttr.addCondition(p => p.battleData.rudeAwakeningTriggered)`, archetype-dispatcher.ts:5974): the sleep immunity only starts after the holder woke up once. It is not a constructor argument, so the declaration contract has no slot for it (same gap as B04's Shields Down, requests/B04.md); recomposeAttr copies it unchanged, so the rebuild behaves the same, and the library would need an atom 'I have already woken up once (my wake-up flag is set)' (request R-B12-12). Subclass of the vanilla class, which has its own declaration (B04): this one only adds the options-object constructor and the FAINT and NONE refusal. `apply` does not read `simulated` (it only flips the cancel flag). The status list is stored twice in the instance (`immuneEffects` in the parent and `configuredStatuses` here); the declaration reads the second. Oddity, not fixed: the empty list and an explicit list of all six statuses differ only for FAINT, which the empty form never blocks and the explicit form cannot contain.",
});
