/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, event-effect on entry, no constructor closure.
//
//   canApply   holder.canAddTag(tagType)       "this battle effect can be put on me right now" (effect-side feasibility)
//   apply      unless simulated: holder.addTag(tagType, turnCount)
//
// The three constructor arguments are all params: which battle effect (`tagType`), for how many turns (`turnCount`, 0 =
// no time limit) and whether the ability flyout shows (`showAbility`, Truant hides it). `canApply` is feasibility
// (the game refuses the effect when it cannot be added, for example a Pokemon that already has it) and stays in the class.
//
// Four users carry an attr-level condition (AbAttr.addCondition, set outside the constructor): Protosynthesis (the
// right weather is active, with one ER terrain case), Quark Drive (a terrain is active), Supreme Overlord (a teammate has fainted) and Madness
// Enhancement (fog is active). They decide whether the entry effect fires at all, and they are exactly the "IF" blocks
// players want to swap. The rebuild carries them over unchanged; no binding slot exists for them, so each is a
// request (requests/B03.md) and is listed in the notes as not covered by a binding.
import { PostSummonAddBattlerTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { stringEnumCodec } from "./codecs";

export default defineDecl(PostSummonAddBattlerTagAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Put a battle effect on myself when I enter",
  summary: params =>
    `When I enter the battle, I get the ${params.tagType} effect for ${params.turnCount} turn(s) (0 = no time limit). Example: Slow Start lasts 5 turns.`,
  synonyms: [
    "slow start",
    "truant",
    "self effect on entry",
    "apply volatile to self",
    "protosynthesis",
    "quark drive",
    "start with a status effect",
  ],
  examples: ["Start every battle with Slow Start for 5 turns", "Get the Truant effect when I enter the battle"],
  params: [
    {
      id: "tagType",
      ctorIndex: 0,
      path: "tagType",
      control: "select",
      label: "Battle effect to put on me",
      editable: true,
      default: "SLOW_START",
      options: enumOptions(BattlerTagType),
      codec: stringEnumCodec(BattlerTagType as unknown as Readonly<Record<string, string>>, "battle effect"),
    },
    {
      id: "turnCount",
      ctorIndex: 1,
      path: "turnCount",
      control: "number",
      min: 0,
      max: 999,
      step: 1,
      integer: true,
      label: "Number of turns it lasts (0 = no time limit)",
      editable: true,
      default: 5,
    },
    {
      id: "showAbility",
      ctorIndex: 2,
      path: "showAbility",
      control: "boolean",
      label: "Show my ability name when it triggers",
      editable: true,
      default: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["The battle effect must be one that can be put on me right now", "It does nothing in a preview"],
  effect: { id: "effect.apply-tag", params: ["tagType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 10 attrs of 10 abilities, no constructor closure: Truant (54: TRUANT, 1 turn, ability flyout hidden), Slow Start (112: SLOW_START, 5), Protosynthesis (281: PROTOSYNTHESIS, 0, attr-level condition), Quark Drive (282: QUARK_DRIVE, 0, attr-level condition), Supreme Overlord (293: SUPREME_OVERLORD, 0, attr-level condition), Generator (5208) and Energized (5402): CHARGED, 0, Berserk DNA (5258 attr 1: ER_ENRAGE, 1), Blood Stain (5377 attr 0: ER_BLEED, 99) and Madness Enhancement (5518 attr 2: ER_ENRAGE, 1, attr-level condition: fog). NOT covered by a binding: the four attr-level conditions (weather or terrain tests, 'a teammate has fainted' read from the arena/battle counters, fog), because bindings only exist for constructor closures and gates; they ride along on the rebuild and are requested as a new binding slot plus atoms (requests/B03.md). The effect block `effect.apply-tag` has no turn count and a Pokemon target while the class always targets the holder with a turn count; the block should gain the turn count.",
});
