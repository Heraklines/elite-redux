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
//   apply     `if (!simulated) opponent.addTag(CONFUSED, pokemon.randBattleSeedIntRange(2, 5), undefined, opponent.id)`
//             -> the EFFECT: confuse the target for 2 to 5 turns. ONE random draw, in `apply` (not in canApply), taken from
//             the HOLDER's seeded generator, and only when not simulated. The source id of the tag is the TARGET's own id.
// RNG order: apply: the confusion duration (2 to 5), drawn after every clause above and after the status landed.
// No closure, no binding.
import { ConfusionOnStatusEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STATUS_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { statusSetCodec, statusWords } from "./shared-codecs";

export default defineDecl(ConfusionOnStatusEffectAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-inflicting-status",
  label: "Confuse the foe after I give it a chosen status",
  summary: params =>
    `After I give a foe ${statusWords(params.statuses)}, that foe also becomes confused for 2 to 5 turns, if it can be confused.`,
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
      label: "Statuses that also cause confusion (comma separated, for example Poison, Toxic)",
      editable: true,
      default: "POISON,TOXIC",
      options: STATUS_OPTIONS,
      codec: statusSetCodec,
      spread: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The foe must still be standing",
    "The foe must be able to become confused (it is not already confused and nothing protects it)",
  ],
  // The statuses setting is the TRIGGER filter (which status just landed), not an effect setting. The effect (confuse the foe
  // for 2 to 5 turns, one draw from the holder, tag source = the foe itself) has no editable setting yet: the class hard-codes
  // the tag and the range. effect.apply-tag (target, tag) cannot express the range or the source, so the effect stays a
  // package until requests/B04.md section 7 (turns range + source choice on effect.apply-tag) is built.
  effect: { id: "effect.package", params: [] },
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
    "User: Poison Puppeteer (id 310, attr 0): Poison and Toxic. The effect is the library 'Apply a battle effect' (confusion) on the foe, but that library effect has no 'for 2 to 5 turns' setting and no 'source is the target' rule, and it is not implemented yet: requests/B04.md asks for a `turns` range on effect.apply-tag. Until then the confusion is described with the nearest effect and the class code keeps the exact behaviour (single source of behaviour). Dispatch happens for EVERY status the holder inflicts with a source Pokemon (a move, or any other source), not only moves; the class doc comment says 'directly poisons them with a move' (not fixed). `simulated` is not passed by the call site (always false). Status FAINT never reaches the class (the phase skips it).",
});
