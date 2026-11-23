/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ErMultiHeadedAbAttr } from "#data/elite-redux/archetypes/multi-headed";
// B09 chunk 5. "My attacks hit once for each of my heads" (Multi-Headed, Hydra, 3 > 1, Hand Barnacles, Bodhisattva, Strong-Headed).
//
// Source: src/data/elite-redux/archetypes/multi-headed.ts, class ErMultiHeadedAbAttr (extends AddSecondStrikeAbAttr, which extends
// PreAttackAbAttr; the user passes `false` for showAbility). Dispatched once per move when the first hit starts
// (`applyAbAttrs("AddSecondStrikeAbAttr")`, move-effect-phase.ts:259, params { pokemon, move, hitCount, opponent }).
// canApply is INHERITED, unchanged: `move.canBeMultiStrikeEnhanced(pokemon, true, opponent)` (not a charging move, not a spread move
// with several targets, not a status move, not a native multi-hit move, not Fling, Uproar, Rollout, Ice Ball or Endeavor ...).
// apply: `hitCount.value += Math.max(0, getErHeadCount(pokemon) - 1)`. The head count is read from the holder's SPECIES at the moment
// of the hit: three heads for the species the ER ROM flags three-headed (Dugtrio, Magneton, Dodrio, Exeggutor, Combee, Magnezone,
// Probopass, Klang, Klinklang, Hydreigon, Barbaracle, the ER customs with three heads, and Mawile and Shuckle ONLY in their Mega
// form), two heads for the species flagged two-headed, and TWO for every species the ROM does not flag at all (the default of
// `BASE_HEAD_COUNT.get(id) ?? 2`). So a holder always hits at least twice. No random draw, no state, nothing reads `simulated`.
// Constructor: (showAbility) only; the head count is not a setting, it comes from the species table.
// The damage falloff of the later heads (2 heads: 100% + 25%; 3 heads: 100% + 20% + 15%) is applied elsewhere, in Pokemon.getBaseDamage.
// Other code finds this attr by NAME and must keep finding it: barbaracle-mechanics.ts:129 and
// post-defend-suppress-opponent-damage-boost.ts:45 test `constructor.name === "ErMultiHeadedAbAttr"`.
//
// Tier C: the count is a lookup of the species, which a person cannot rebuild from blocks, so the piece is atomic and the only
// honest setting is none (written reason below). Extra IFs can only be ANDed in on top.
export default defineDecl(ErMultiHeadedAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Make my attacks hit once for each of my heads",
  summary: () =>
    "My single-target attacks hit once per head: 2 hits for a two-headed Pokemon, 3 for a three-headed one. A Pokemon with no head count in the game data hits twice. Later heads hit weaker.",
  synonyms: [
    "multi headed",
    "multi-headed",
    "hydra",
    "hit twice",
    "hit three times",
    "one hit per head",
    "extra heads",
    "double hit",
    "triple hit",
    "parental bond",
  ],
  examples: [
    "Each head attacks: three hits for a three-headed Pokemon, like Multi-Headed",
    "My attacks hit once for each head I have, like Hydra",
  ],
  params: [],
  noParamsReason:
    "The number of hits is the number of heads of the holder's species, looked up in the game's species table at the time of the hit (two heads when the species is not listed). It is not a setting of the ability, so there is nothing to configure; to hit a fixed number of times use the block that adds extra hits.",
  conditions: [],
  guards: [],
  feasibility: [
    "The move must be one a multi-hit ability can add hits to: not a status move, a charging move (unless I skip the charge), a move aimed at several foes, a move that already hits many times, or Fling, Uproar, Rollout, Ice Ball and Endeavor",
    "Mawile and Shuckle have three heads only while in their Mega form; in their normal form they hit as two-headed or the default",
  ],
  effect: { id: "effect.hit-n-times", params: [] },
  fixedCtorArgs: { 0: false },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my attack at full HP and one HP below full (the hit count does not read HP; B09/chunk5.test.ts covers the head count of every kind of species)",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, 6 attrs in 6 abilities, none needs a binding (no closure): Multi-Headed (5085), Hydra (5630), Hand Barnacles (5668), 3 > 1 (5717), Bodhisattva (6076), Strong-Headed (6087), all attr 0. Reproduced exactly, not fixed: a species the ROM flags neither two- nor three-headed gets TWO hits (the default 2), so the harness holder (a plain Normal species) hits twice; the count is read from the live species every hit, and a Mega form of Mawile or Shuckle gets 3 via MEGA_HEAD_COUNT. The inherited canApply is the same as HitMultiplierAbAttr's guards (a sibling in chunk 3); if B01-B07 give AddSecondStrikeAbAttr guards or a gate, this class inherits it. Request R-B09-36 asks for the effect 'Hit once per head' (effect.hit-n-times sets a fixed count, this one adds heads - 1).",
});
