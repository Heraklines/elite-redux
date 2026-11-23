/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / engine-query (Tier C, a presence flag read by name). Status decomposed.
//
// Read by hand from archetypes/post-defend-suppress-opponent-damage-boost.ts. Despite the name the class extends only AbAttr: it has no
// canApply, no apply and is never dispatched. Constructor takes nothing, `super(false)` (no banner). The engine looks for it BY NAME:
//   suppressesOpponentDamageBoosts(pokemon) = pokemon.getAllActiveAbilityAttrs().some(attr => attr.constructor.name === the class name)
// and uses the answer in two places:
//   (a) Pokemon.getAttackDamage (src/field/pokemon.ts, around line 6283): when the TARGET has the flag, and neither side's abilities are
//       ignored, the damage is also computed a second time as if the attacker and its ally had no abilities (a "ceiling"), and the real
//       damage is capped at that ceiling (damage = min(damage, ceiling)).
//   (b) MoveEffectPhase (src/phases/move-effect-phase.ts, around line 247): when the TARGET has the flag and the move does not ignore
//       abilities (Mold Breaker), the hit count is resolved with the multi-hit suppression on: MultiHitAttr gets the flag, only
//       AddSecondStrikeAbAttr and ErMultiHeadedAbAttr are still applied (bypassesOpponentMultiHitSuppression), and AllAttacksMultiHitAbAttr
//       is skipped.
//
// Nothing is configurable and no clause lives in the class, so there is nothing to bind. The engine-query routing belongs to the
// foundation's `abilityQuery` sweep; class agents never touch the call sites. The trigger is "while the ability is active"
// (`while.active`), whose flagKeys now list this class (added in the chunk 4 fix round, request R-B10-c4-10 done).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostDefendSuppressOpponentDamageBoostAbAttr } from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";

export default defineDecl(PostDefendSuppressOpponentDamageBoostAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Shut off foes' damage boosts and extra hits against me",
  summary: () =>
    "Foes cannot boost the damage they deal me above what the move does without their own abilities, and most extra-hit abilities stop working on me. Moves that ignore abilities get past this.",
  synonyms: [
    "fort knox",
    "wonder skin",
    "stainless steel",
    "block damage boosts",
    "no multi hit against me",
    "ignore the foe's damage boosting ability",
    "anti boost shield",
  ],
  examples: [
    "Foes' damage boosting abilities do nothing to me, like Fort Knox",
    "A foe with an ability that adds hits only hits me once",
  ],
  params: [],
  noParamsReason:
    "A presence flag read by name in the damage calculation and in the hit-count step; the cap (the damage without the foe's own abilities) and the list of extra-hit abilities that still work are fixed in the engine, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "A foe's move that ignores abilities (such as with Mold Breaker) is not affected",
    "Extra-hit abilities that add a second strike (Parental Bond style) and multi-headed abilities still work",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The flag is consulted by the damage calculation and the hit-count step, which are not dispatched moments; the twin compares whole battles of the users instead.",
  probes: [{ name: "a foe hits the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Engine-query (counted apart; the foundation owns the abilityQuery routing). Users (7 attrs, 6 abilities, Stainless Steel exists under two ids): Wonder Skin attr 0, Fort Knox attr 0, Prim and Proper attr 0, Wonder Scale attr 1, Stainless Steel attr 0 (ids 5530 and 6003) and Mystic Fortification attr 1 (saved editor ability 20014, after BlockNonDirectDamageAbAttr). None carries a constructor argument or a closure, nothing to bind. The class name is listed in the flagKeys of the WHEN while.active (request R-B10-c4-10, done). The reader checks the CLASS NAME (`attr.constructor.name`), so the class must keep its name. Oddities, NOT fixed: the class name says PostDefend but it extends AbAttr and is never dispatched; the class comment says the damage is divided by 1.3 and multi-hit damage halved, but the engine code caps the damage at the no-ability value and skips the extra-hit abilities (the comment is stale).",
});
