/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, one list setting, no closure (Poison Puppeteer).
//
// Dispatch: obtain-status-effect-phase.ts:70, after the target actually received the status (`pokemon.doSetStatus`, animation
// and message done, `statusEffect !== FAINT`), and only when a source Pokemon exists. The frame is
// `{ pokemon: sourcePokemon (the holder, who inflicted it), opponent: the target, effect }`.
//
// Clause classification (ConfusionOnStatusEffectAbAttr), in the original order:
//   canApply  `effects.has(effect) && !opponent.isFainted() && opponent.canAddTag(CONFUSED)`
//             1. `effects.has(effect)`: the status that just landed is one of the listed ones -> the class's SETTING
//                (constructor rest argument). A library atom "the status that was just inflicted is {status}" would let
//                staff say it as an IF; requested (requests/B04.md). Until then it is the `statuses` setting.
//             2. `!opponent.isFainted()`: the target is still alive -> GUARD (confusing a fainted Pokemon is a bug, not a
//                design choice). The guard registry's `not-fainted` is about the HOLDER; this is about the target, so a new
//                guard is requested (`target-not-fainted`) and the line stays as feasibility in the class.
//             3. `opponent.canAddTag(CONFUSED)`: the target can be confused (not already confused, no Own Tempo-style
//                immunity, no Misty Terrain...) -> FEASIBILITY (effect-side precondition), stays in the class.
//   apply     `if (!simulated) opponent.addTag(this.tag, pokemon.randBattleSeedIntRange(this.turnsMin, this.turnsMax), undefined, opponent.id)`
//             (tag, turnsMin and turnsMax are constructor settings, defaults CONFUSED, 2 and 5; the constructor keeps the rest
//             argument form `(...statuses, { tag?, turnsMin?, turnsMax? })`)
//             -> the EFFECT: confuse the target for 2 to 5 turns. ONE random draw, in `apply` (not in canApply), taken from
//             the HOLDER's seeded generator, and only when not simulated. The source id of the tag is the TARGET's own id.
// RNG order: apply: the confusion duration (2 to 5), drawn after every clause above and after the status landed.
// No closure, no binding.
import { ConfusionOnStatusEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { battleEffectCodec, STATUS_CHOICES, statusSetCodec, statusWords, TAG_CHOICES } from "./shared-codecs";

export default defineDecl(ConfusionOnStatusEffectAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-inflicting-status",
  label: "Confuse the foe after I give it a chosen status",
  summary: params =>
    `After I give a foe ${statusWords(params.statuses)}, that foe also gets ${String(params.tag)} for ${params.turnsMin} to ${params.turnsMax} turns, if it can.`,
  synonyms: [
    "poison puppeteer",
    "confuse after poisoning",
    "poison and confuse",
    "status and confusion",
    "bonus confusion",
    "dazed by status",
  ],
  examples: ["Foes I poison are also confused, like Poison Puppeteer"],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "effects",
      control: "text",
      label: "Statuses that also trigger it (comma separated, for example Poison, Bad poison)",
      editable: true,
      default: "Poison, Bad poison",
      options: STATUS_CHOICES,
      codec: statusSetCodec,
      spread: true,
    },
    {
      id: "tag",
      ctorIndex: 1,
      ctorOption: "tag",
      path: "tag",
      control: "select",
      label: "Battle effect the foe also gets",
      editable: true,
      default: "Confusion",
      options: TAG_CHOICES,
      codec: battleEffectCodec,
    },
    {
      id: "turnsMin",
      ctorIndex: 1,
      ctorOption: "turnsMin",
      path: "turnsMin",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Shortest time it lasts (turns)",
      editable: true,
      default: 2,
    },
    {
      id: "turnsMax",
      ctorIndex: 1,
      ctorOption: "turnsMax",
      path: "turnsMax",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Longest time it lasts (turns)",
      editable: true,
      default: 5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The foe must still be standing",
    "The foe must be able to become confused (it is not already confused and nothing protects it)",
  ],
  // The statuses setting is the TRIGGER filter (which status just landed). The effect settings are the battle effect, the
  // shortest and the longest duration (defaults Confusion, 2 and 5); the class draws ONE number in apply from the holder.
  // The tag source (the foe itself) is fixed by the class, so the effect stays a package that carries those three settings
  // until effect.apply-tag has a source choice (requests/B04.md section 7).
  effect: { id: "effect.package", params: ["tag", "turnsMin", "turnsMax"] },
  reusableAlone: { when: true, if: true, do: true },
  l2StaticReason:
    "No L2 template makes the holder inflict a status on a foe, so the shared twin never evaluates this attr. The proof is the real Toxic battle in b04-chunk2.test.ts (holder poisons a foe, original against rebuilt shadow, same 2-to-5 draw).",
  flags: {
    rng: "apply",
    rngOrder: ["apply: how many turns the confusion lasts (2 to 5), only when not simulated, after the status landed"],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "I poison the foe while it is at full HP, and while it is at half HP",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "User: Poison Puppeteer (id 310, attr 0): Poison and Toxic, defaults Confusion for 2 to 5 turns (settings, the single draw is unchanged). The effect is a package because the library 'Apply a battle effect' has no turns range and no 'source is the target' rule (requests/B04.md asks for both); the three settings are editable now. Dispatch happens for EVERY status the holder inflicts with a source Pokemon (a move, or any other source), not only moves; the class doc comment says 'directly poisons them with a move' (not fixed). `simulated` is not passed by the call site (always false). Status FAINT never reaches the class (the phase skips it).",
});
