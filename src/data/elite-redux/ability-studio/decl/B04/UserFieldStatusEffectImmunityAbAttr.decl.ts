/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A calc-modifier, one list setting, no closure (Sweet Veil (P)).
//
// Dispatch: pokemon.ts:7763 inside canSetStatus: after the target's OWN ability pass, `for (const pokemon of
// this.getAlliesGenerator())` asks every ALLY of the target (never the target itself) with
// `{ pokemon: ally, effect, cancelled, target, source }`. So the holder protects its partner, not itself.
//
// Clause classification (UserFieldStatusEffectImmunityAbAttr extends CancelInteractionAbAttr), in the original order:
//   canApply  `(!cancelled.value && immuneEffects.length === 0 && effect !== FAINT) || immuneEffects.includes(effect)`
//             - WHICH statuses are blocked -> the class's SETTING (constructor rest argument 0). Empty list = every status
//               except FAINT (part of the meaning of "every status").
//             - `!cancelled.value` belongs ONLY to the left side of the `||` (a precedence slip in the source, see notes).
//   apply     inherited `cancelled.value = true` -> the EFFECT (library "Block it"). Does not read `simulated`.
// No RNG, no closure, no binding.
import { UserFieldStatusEffectImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STATUS_CHOICES, statusListCodec, statusWords } from "./shared-codecs";

export default defineDecl(UserFieldStatusEffectImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.status-immunity-field",
  label: "Protect my partner from chosen status conditions",
  summary: params =>
    `My partner (not me) cannot get ${statusWords(params.statuses)} while I am on the field. Example: choose Sleep and my partner never falls asleep.`,
  synonyms: [
    "sweet veil",
    "pastel veil",
    "ally status immunity",
    "partner cannot sleep",
    "team status protection",
    "protect ally from status",
  ],
  examples: ["My ally cannot fall asleep, like Sweet Veil"],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "immuneEffects",
      control: "text",
      label: "Status conditions my partner is immune to (comma separated; leave empty for every status)",
      editable: true,
      default: "Sleep",
      options: STATUS_CHOICES,
      codec: statusListCodec,
      spread: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only my partner is protected, never myself (my own immunity is a separate block)",
    "Leaving the list empty protects against every status condition except fainting",
  ],
  effect: { id: "effect.negate", params: ["statuses"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The ally-protects-ally path needs a double battle in which the holder's partner is hit by a status move; no L2 scenario template does that for this trigger. b04-chunk2.test.ts proves it with a double battle (original against rebuild).",
  probes: [
    {
      name: "the foe paralyses (Glare) and burns (Will-O-Wisp) the Pokemon next to me",
      axes: { foeMove: ["GLARE", "WILL_O_WISP"] },
    },
  ],
  status: "decomposed",
  notes:
    "User (live dump): Sweet Veil (P) (id 175, attr 0, Sleep). The vanilla Pastel Veil (Poison and Toxic) is built with the same class in init-abilities.ts but is rewritten by the Elite Redux layer, so it does not appear in the live dump. Subclass ConditionalUserFieldStatusEffectImmunityAbAttr (Flower Veil, Jungle's Guard) is a separate declaration in chunk 3. Source slip (not fixed): canApply is `(A && B && C) || includes`, so `cancelled` is ignored when the status is on the list; harmless today because the result only sets `cancelled` to true again, but a status on the list is reported as blockable even after another effect already blocked it (it can matter only for the trigger message).",
});
