/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "After a move hits me, change some of my stats" (Anger Point, Inflatable, Furnace, Super Hot Goo, Fortitude...).
//
// Source: src/data/elite-redux/archetypes/stat-trigger-on-event.ts, StatTriggerOnHitAbAttr (extends PostDefendAbAttr).
// Constructor: one options object `{ stats, filter? }`; `filter` is `{ types?, flags? }`: types are OR-ed, flags are OR-ed, and the
// two lists are AND-ed together. It throws for an empty list or a zero stage change.
// Clauses, in the original order (Tier B):
//   1. `hitResult >= HitResult.NO_EFFECT` -> false   GUARD, class method `guards`: the move hit and did damage (HitResult EFFECTIVE to
//      ONE_HIT_KO). This is the same "moment" test the library's trigger "After I am hit" carries (compile-composition MOMENT_GATES),
//      so it is not a block staff can drop. The library version also asks `damage > 0`; the class does not (see notes).
//   2. `filter === null` -> true                      GATE (replaceable), the rest of `canApply`
//   3. `opponent.getMoveType(move)` is one of `filter.types`   = move.type { effective }  (any of several: an `any` group)
//   4. `move.hasFlag(flag)` for one of `filter.flags`           = the PLAIN move flag (no atom: the library flag atom asks
//      doesFlagEffectApply, which also honours Long Reach / Punching Glove / substitutes)                     R-B12-04
// apply: skipped when `simulated`; one StatStageChangePhase per entry of `stats` (holder, selfTarget true). No random draw.
//
// `filter` is not an editable setting: it decides the shape of the gate, which staff change with the type and property blocks.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatTriggerOnHitAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { hitFilterCodec, NO_FILTER, statChangesCodec } from "./b12-chunk1-codecs";

const IN_PAYLOAD = { ctorIndex: 0 } as const;

export default defineDecl(StatTriggerOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change my stats when a move hits me",
  summary: params =>
    params.filter === NO_FILTER
      ? `After a damaging move hits me, my stats change: ${params.stats}. Example: Attack +1, like Anger Point.`
      : `After a damaging move hits me and it matches ${params.filter}, my stats change: ${params.stats}. Example: Fire or Flying moves raise Defense and Sp. Def by 1.`,
  synonyms: [
    "anger point",
    "inflatable",
    "furnace",
    "berserker rage",
    "boost when hit",
    "stat change when hit",
    "react to being hit",
    "weak armor",
    "stamina",
  ],
  examples: [
    "Raise Defense and Sp. Def by one stage when I am hit by a Flying or Fire move, like Inflatable",
    "Raise Speed by two stages when a Rock move hits me, like Furnace",
    "Lower my own Speed by one stage when a contact move hits me, like Super Hot Goo",
  ],
  params: [
    {
      id: "stats",
      ...IN_PAYLOAD,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: "Stat changes, like 'Defense +1, Sp. Def +1' (stages -6 to 6; the game stops at 6, so 12 acts like 6)",
      editable: true,
      gateIndependent: true,
      default: "Attack +1",
      codec: statChangesCodec,
    },
    {
      id: "filter",
      ...IN_PAYLOAD,
      ctorOption: "filter",
      path: "filter",
      control: "text",
      label: "Only moves of these types or properties, like 'Fire, Flying, Contact' (Any move = no limit)",
      // It decides the shape of the gate (clauses 2 to 4 above), so it is read-only here.
      editable: false,
      default: NO_FILTER,
      codec: hitFilterCodec,
    },
  ],
  conditions: [
    // The gate: nothing (no filter), an `any` group of move types, and/or a plain move property.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must have hit and done damage: a miss, a blocked move or a status move does not count",
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.stat-stage", params: ["stats"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Contact, Fire, Flying-capable, Rock, Water, Ice and a status move reach every filter of the users.
      name: "moves of the filtered types and properties",
      axes: { foeMove: ["TACKLE", "EMBER", "WATER_GUN", "ROCK_SLIDE", "ICE_BEAM", "AERIAL_ACE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request for one user. Tier B, 13 attrs. No filter (gate bound as the empty group): Anger Point (83 attr 1 Attack +1; the vanilla-rebalance patcher pushes it after construction), Berserker Rage (5211 Sp. Atk +1), Tipping Point (5218 Sp. Atk +1), Fortitude (5248 Sp. Def +1), Crowned Sword (5256 attr 3 Attack +1) and Petal Shield (5713 attr 1 Defense -1, the second half of its trade). Types: Inflatable (5028), Balloon Bomb (5318) and Balloon Blitz (5456) Flying or Fire, Defense +1 and Sp. Def +1; Furnace (5182) and Ice Plumes (5571) Rock, Speed +2; Cryo Architect (5488) Water or Ice, Attack +1 and Defense +1. Property: Super Hot Goo (5199 attr 1, Speed -1 on a contact move) reads the plain flag `move.hasFlag(MAKES_CONTACT)`, which differs from the library flag atom (doesFlagEffectApply ignores contact for Long Reach, Punching Glove and a substitute), so its gate is a legacy-closure until R-B12-04. The `guards` clause is the engine moment test (hitResult below NO_EFFECT); the library trigger also needs damage above 0, the class does not, so a zero-damage hit that is not NO_EFFECT still counts (a difference to remember if the guard is ever moved into the library). Oddities, not fixed: (a) Super Hot Goo's stat change is on the HOLDER (selfTarget true), so the ability lowers its own Speed, not the attacker's, which looks unintended for 'goo' (the dex text of the ability may say otherwise); (b) Petal Shield's -1 Defense on each hit belongs to the same family and drops the holder's own Defense.",
});
