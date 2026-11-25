/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Ball Fetch (Tier C, marker). "After a battle, get back the balls I threw, for the ball kinds this ability lists".
//
// Source: ability-upgrades/attrs/meta-markers.ts (constructor: a NON-EMPTY list of PokeballType, de-duplicated into a Set;
// `erMetaKind` "ball-recovery"). Nothing is dispatched. The reader is `recoverUsedPokeballsAfterBattle()`
// (archetypes/ability-meta-consumers.ts:151): it walks the WHOLE player party (fainted and benched included, `includeFainted`),
// collects the recoverable kinds of every attr whose `getCondition()` is null or true, then for each kind moves the number of balls
// used this battle (`consumeUsedPokeballs`, which hands each physical ball out once) back into the bag.
import { BallRecoveryAbAttr } from "#data/elite-redux/ability-upgrades/attrs/meta-markers";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { PokeballType } from "#enums/pokeball";

export default defineDecl(BallRecoveryAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Get back used balls after a battle",
  summary: params =>
    `After a battle, the ${params.balls} I threw come back to my bag. Example: Pokeball, Great ball returns both kinds.`,
  synonyms: ["ball fetch", "recover pokeballs", "reuse balls", "free balls", "get balls back", "catch refund"],
  examples: ["After the fight, return the Poke Balls and Great Balls I used, like Ball Fetch"],
  params: [
    {
      id: "balls",
      ctorIndex: 0,
      path: "recoverableBalls",
      control: "text",
      label: "Ball kinds returned (comma separated, at least one)",
      editable: true,
      gateIndependent: true,
      default: "POKEBALL,GREAT_BALL",
      options: enumOptions(PokeballType),
      codec: enumListCodec(PokeballType, "ball kind"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The list must name at least one ball kind",
    "Each ball I used comes back only once, even when several party members have this",
    "It works from anywhere in the party, even if the holder has fainted or is benched",
  ],
  effect: { id: "effect.package", params: ["balls"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a plain battle with the marker on the holder", axes: {} }],
  l2StaticReason:
    "The marker is never dispatched; the battle-end phase reads it by name (recoverUsedPokeballsAfterBattle), which the quiet-turn scenarios never reach. B18/meta-markers.test.ts runs the live reader with used balls on the ledger, a benched holder and a plain party.",
  status: "decomposed",
  notes:
    "PACKAGE (marker), justified: no behaviour in the class (base no-ops, showAbility false); a list the battle-end phase asks for by name. The library has no effect that returns used balls, so the effect is the package and the request is R-B18-8 (effect 'Return used balls after a battle'). The ball list is the only setting and is typed (a codec over the ball enum, so staff see names, the class gets the enum numbers; the codec rejects an unknown name and the class rejects an empty list). An attr-level condition ANDed by staff is honoured by the reader (getCondition), so `if` is true. Unlike the other three markers it reads the party INCLUDING fainted members (getPostBattleAbilitySources). Users: Ball Fetch (237, attr 2), kinds Pokeball and Great ball.",
});
