/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 4. Tier A, event-effect on entry, no constructor closure, no random draw.
//
//   canApply   somebody on MY side is allowed in battle: `party.filter(p => p.isAllowedInBattle()).length > 0` where
//              `party` is the player field or the enemy field of the holder (effect-side feasibility: while the holder
//              stands on the field it is always true, so it never decides anything in practice)
//   apply      unless simulated, for every Pokemon on my side in speed order (me and my allies, `getAlliesGenerator`):
//              when it has one of the listed statuses, queue the "was cured" message, `resetStatus(false)`, `updateInfo()`
//
// The only constructor argument is the list of statuses (rest arguments), so it is one list param. There is no condition
// slot: nothing in the class is a rule staff would swap. The ability bar is NOT shown (`super(false)`), each cured
// Pokemon gets its own message instead.
import { PostSummonUserFieldRemoveStatusEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

const STATUS_NAMES = ["POISON", "TOXIC", "PARALYSIS", "SLEEP", "FREEZE", "BURN"];

export default defineDecl(PostSummonUserFieldRemoveStatusEffectAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Cure status problems on my side when I enter",
  summary: params =>
    `When I enter the battle, I and every ally on the field that has one of these status problems (${params.statuses}) are cured. Example: sleep is cured on my whole side.`,
  synonyms: [
    "sweet veil",
    "pastel veil",
    "cure team status",
    "cleanse allies",
    "wake up my team",
    "remove sleep from my side",
    "heal party status",
  ],
  examples: [
    "Wake up my whole side from sleep when I enter, like Sweet Veil",
    "Cure poison and bad poison on my side when I enter, like Pastel Veil",
  ],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "statusEffect",
      control: "text",
      label: "Status problems to cure (comma separated: Poison, Toxic, Paralysis, Sleep, Freeze, Burn)",
      editable: true,
      default: "SLEEP",
      options: STATUS_NAMES,
      codec: enumListCodec(StatusEffect as unknown as Readonly<Record<string, number>>, "status problem"),
      spread: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Somebody on my side must be able to fight (always true while I am on the field), otherwise nothing happens",
    "It does nothing in a preview",
    "It also works when I gain this ability in the middle of a battle, not only on entry",
    'The ability bar is not shown; every cured Pokemon gets its own "was cured" message, in speed order',
  ],
  effect: { id: "effect.cure-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    { name: "entry with no status", axes: {} },
    { name: "entry with each status", axes: { status: ["SLEEP", "POISON", "TOXIC", "PARALYSIS", "BURN", "FREEZE"] } },
  ],
  status: "decomposed",
  notes:
    "Tier A, 1 attr of 1 live ability, no closure: Sweet Veil (175 attr 1, the id shown as 'Sweet Veil (P)'), list [Sleep]. init-abilities.ts still lists Pastel Veil with [Poison, Toxic] at line 1930, but the live ability list has no such attr (Pastel Veil is rewritten by Elite Redux), so it is not a user today; the example keeps the rule for staff. The library effect `effect.cure-status` takes ONE status and a target (here 'holder-side'), this class takes a LIST of statuses and always cures the whole side, so the effect is declared with no mapped param until `effect.cure-status` accepts a list of statuses (requests/B03.md, same request as PostSummonHealStatusAbAttr). The `statuses` param is read only by apply, so it is fully editable. Quirks recorded, not fixed: `canApply` is true whenever the holder stands on the field, so the trigger never tests whether anybody actually has a listed status (the ability bar stays hidden, so players see nothing when nobody is cured); `getAlliesGenerator` is the whole side in speed order (includes me), while `canApply` filters `isAllowedInBattle` over the whole field list; the message is `getStatusEffectHealText` of each cured Pokemon.",
});
