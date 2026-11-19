/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / while-active flag WITH ONE PARAM (the move property). See ../PRECEDENTS.md.
//
// No behaviour in the class; `getMoveTargets` (move-utils.ts:88) asks `userGrantsSpreadTargeting(user, move)`:
//   !move.hasAttr("MultiHitAttr") && user.hasAbilityWithAttr(..) && user.getAbilityAttrs(..).some(a => move.hasFlag(a.flag))
// and then promotes a NEAR_OTHER or NEAR_ENEMY target to ALL_NEAR_ENEMIES. The condition "the move has the property" is
// the plain `move.hasFlag(flag)` (NOT doesFlagEffectApply), which is why it is the param `flag` and not a binding.
import { SpreadTargetByFlagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";

export default defineDecl(SpreadTargetByFlagAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Make single-target moves with a property hit both foes",
  summary: params =>
    `My single-target moves with the ${params.flag} property hit both foes. Multi-hit moves never spread. Example: with Sound, Sing hits both foes.`,
  synonyms: [
    "hit both foes",
    "spread move",
    "double target",
    "all opponents",
    "artillery",
    "amplifier",
    "sweeping edge",
  ],
  examples: [
    "Single-target sound moves hit both foes, like Amplifier",
    "Slicing moves hit both foes, like Sweeping Edge",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      path: "flag",
      control: "select",
      label: "Move property that makes the move hit both foes",
      editable: true,
      default: "SOUND_BASED",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only single-target moves that aim at a foe (or at any other Pokemon) are promoted; moves that already hit several targets, or only the user, are unchanged",
    "Moves that hit several times (multi-hit moves) never spread",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a single-target move with the property, one without it, and a multi-hit move", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The target choice (getMoveTargets) is driven directly in test/tests/elite-redux/decomp/B05/flag-sites.test.ts in a double battle for the original and the rebuilt attr.",
  status: "decomposed",
  notes:
    "While-active flag with one param, Tier C. The param is the move property the engine compares with move.hasFlag. Users (flag): Artillery (attr 1, PULSE_MOVE), Super Scope (attr 2, PULSE_MOVE), Amplifier (attr 1, SOUND_BASED), Bass Boosted (attr 1, SOUND_BASED), Wind Chimes (attr 1, SOUND_BASED), Siren's Song (attr 4, SOUND_BASED), Sweeping Edge (attr 1, SLICING_MOVE), Blademaster (attr 1, SLICING_MOVE); all covered by the param with no binding. Several holders stack: getAbilityAttrs returns every attr, so two spread flags with different properties both count. The promotion is in getMoveTargets, not in a dispatched hook, so the 'the move has the property' test is the param, not an IF block; a real IF + DO split needs a target-selection hook (requests/B05.md, R-B05-6). Observation (not fixed): the promotion checks only the move's target kind and flag, so it also applies to status moves that aim at one Pokemon, not just damaging ones.",
});
