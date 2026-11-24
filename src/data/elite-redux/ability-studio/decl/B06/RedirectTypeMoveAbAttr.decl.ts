/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 4, Tier A calc-modifier with a one-piece effect. See ../PRECEDENTS.md.
//
// "While the game picks who a move targets, draw single-target moves of one type to me" (Lightning Rod, Storm Drain and ER kin). The
// constructor takes one number (the type), no closure. The class and its base RedirectMoveAbAttr.canApply, in the ORIGINAL order:
//   1. `canRedirect(moveId, user, holder)`: the move must target ONE other Pokemon (target kind NEAR_OTHER or OTHER) AND the move's type
//      must be the setting. The type is `getTriggeredMoveTypes(holder, user, move)`, which is the type the user would really use
//      (`user.getMoveType(move)`, so Normalize, Pixilate and friends count) PLUS the types any of the holder's active ability attrs add.
//   2. a triple-battle adjacency test (skipped in single and double battles, for Flying moves and pulse moves): the holder must stand next to
//      the user.
//   3. `targetIndex.value !== holder's battler index`: nothing to do when the move already aims at me.
//   apply: `targetIndex.value = holder's battler index`.
// move-phase.ts asks every Pokemon except the user, in speed order, so the LAST redirector in that order wins; center-of-attention moves
// (Follow Me, Rage Powder) override it and a user with the no-redirect flag ignores it (BlockRedirectAbAttr).
import { RedirectTypeMoveAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(RedirectTypeMoveAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.redirect-move",
  label: "Draw single-target moves of one type to me",
  summary: params =>
    `When a foe or ally aims a single-target ${params.type} move at someone else, the move goes to me instead. Example: Lightning Rod draws Electric moves.`,
  synonyms: [
    "lightning rod",
    "storm drain",
    "redirect attacks",
    "draw in moves",
    "attract moves",
    "magnet for a type",
    "take the hit for my team",
  ],
  examples: ["Draw every Electric move to me, like Lightning Rod", "Draw Water moves to me"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "type",
      control: "select",
      label: "Type of move that is drawn to me",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves that aim at one other Pokemon can be drawn in (not moves that hit everyone, a whole side or only the user)",
    "In a triple battle I must stand next to the user, unless the move is Flying or a pulse move",
    "Nothing happens when the move already aims at me",
    "Center-of-attention moves such as Follow Me override it, and a user whose ability ignores redirection is not redirected",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a move of the type and a move of another type", axes: { foeMove: ["THUNDERBOLT", "TACKLE"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: no library effect rewrites a move's target (request R-B06-22: effect.redirect-move-to-me with a type setting, and a condition atom 'the move is single-target'); the type test is the class's own setting (`type`), so it is a param, not an IF. The type check also counts types that the holder's other active abilities add (getTriggeredMoveTypes), which no atom reproduces. Users (9 attrs, none with a closure): Lightning Rod (31, attr 0, Electric), Storm Drain (114, attr 0, Water), Poison Absorb (5082, attr 0, Poison), Ice Dew (5116, attr 0, Ice), Reservoir (5450, attr 1, Water), Heat Sink (5566, attr 0, Fire), Capacitor Bank (5925, attr 2, Electric), Alluring Skull (5965, attr 0, Ghost), Low Tide (6071, attr 0, Water). The same class is also built by the type-resist-or-absorb archetype (archetype-dispatcher.ts) and the pitch mechanics file. The class never reads `simulated`. Oddity, not fixed: the move-phase TODO says redirection should also happen for type-changing moves; today the type used is the user's effective type at the time the target is picked.",
});
