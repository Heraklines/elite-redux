/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A calc-modifier, one list setting, no closure (Limber, Insomnia, Immunity, Magma Armor, Water Veil, Vital
// Spirit, Steadfast, Superheavy, Comatose, Dreamscape, Honk Shoo, Purifying Salt, Shields Down, Water Bubble, Thermal
// Exchange, ...).
//
// The class body is EMPTY: `class StatusEffectImmunityAbAttr extends PreSetStatusEffectImmunityAbAttr {}`. Behaviour is the
// parent's (PreSetStatusEffectImmunityAbAttr, ab-attrs.ts:3946):
//   constructor(...immuneEffects)  the listed statuses; an EMPTY list means "every status except FAINT".
//   canApply   `!cancelled.value && ((immuneEffects.length === 0 && effect !== FAINT) || immuneEffects.includes(effect))`
//              1. `!cancelled.value`: the engine's cancel-chain convention -> not a staff rule.
//              2. `(empty && effect !== FAINT) || includes(effect)`: WHICH statuses are blocked -> the class's SETTING
//                 (constructor rest argument 0). FAINT is never blocked by the "every status" form (the KO status must
//                 always land); it is part of the meaning of "every status".
//   apply      `cancelled.value = true` -> the EFFECT (library "Block it"). Does not read `simulated`.
//   getTriggerMessage: "<holder>'s <ability> prevents <status>" (a named status) or "... prevents status problems" (every).
// Dispatch: pokemon.ts:7757 inside canSetStatus (the target's OWN ability), also battler-tags.ts:4315 (the Freeze check of a
// tag path). Both with the holder's own Pokemon.
// No RNG, no closure, no binding. One user carries an attr-level condition (see notes).
import { StatusEffectImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STATUS_CHOICES, statusListCodec, statusWords } from "./shared-codecs";

export default defineDecl(StatusEffectImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.status-immunity",
  label: "Be immune to chosen status conditions",
  summary: params => `I cannot get ${statusWords(params.statuses)}. Example: choose Burn and burns never land on me.`,
  synonyms: [
    "immune to burn",
    "immune to poison",
    "immune to sleep",
    "immune to paralysis",
    "limber",
    "insomnia",
    "status immunity",
    "cannot be statused",
  ],
  examples: ["Immune to paralysis, like Limber", "Immune to every status condition, like Comatose"],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "immuneEffects",
      control: "text",
      label: "Status conditions I am immune to (comma separated; leave empty for every status)",
      editable: true,
      default: "Burn",
      options: STATUS_CHOICES,
      codec: statusListCodec,
      spread: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A status that another ability or effect already blocked is left alone",
    "Leaving the list empty blocks every status condition except fainting",
  ],
  effect: { id: "effect.negate", params: ["statuses"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the foe paralyses me (Glare) and burns me (Will-O-Wisp)",
      axes: { foeMove: ["GLARE", "WILL_O_WISP"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (live dump, 21 attrs): Limber (attr 0, Paralysis), Insomnia (attr 0, Sleep), Immunity (attr 0, Poison+Toxic), Magma Armor (attr 0, Freeze), Water Veil (attr 0, Burn; also id 5947), Vital Spirit (attr 0, Sleep), Steadfast (attr 1, Paralysis), Water Bubble (attr 2, Burn), Thermal Exchange (attr 1, Burn), Purifying Salt (attr 0, every), Comatose (attr 0, all six), Dreamscape (attr 0, all six), Honk Shoo (attr 0, all six), Shields Down (attr 3, every status, with an attr-level condition `p.formIndex < 7`), Purifying Waters (attr 1, Burn), Flame Bubble (attr 2, Burn), Superheavy (attr 1, Paralysis), Thermal Entropy (attr 1, Burn), Brainpower (attr 3, Sleep), Phoenix Foliage (attr 0, Paralysis). Two spellings of the same idea exist: the empty list (Purifying Salt, Shields Down) and the explicit list of all six (Comatose, Dreamscape, Honk Shoo); they differ only for the status FAINT (the explicit list never contains it) and for any future status. Shields Down: the attr-level condition `formIndex < 7` (Minior in its meteor forms) is added with conditionalAttr, not a constructor argument; it maps onto a library 'form number' condition that does not exist yet (mon.form-index, already requested in chunk 1) and the declaration contract has no slot for attr-level conditions (requests/B04.md); the rebuild copies it unchanged. The ER rebalance (init-elite-redux-vanilla-rebalance.ts:2947) strips instances of this class from one ability: the live dump already reflects that. The L1 grid only varies the holder's own status, so the cancel check for each distinct list is proven by L2 and by b04-chunk2.test.ts (a direct canApply and apply run over every status for original and rebuild).",
});
