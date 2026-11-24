/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier C (one effect, no condition, nothing to gate). See ../PRECEDENTS.md.
//
// The end-of-turn hook (`PostTurnAbAttr`, WHEN "at the end of every turn"). The class has no `canApply` of its own (the inherited
// one answers true), no getCondition and no gate. `apply`, in order:
//   1. `simulated` -> nothing happens (before any random draw)
//   2. ONE random draw picks the berry: `pokemon.randBattleSeedInt(11)` cast to a BerryType when there is no pool (every berry),
//      or `pool[pokemon.randBattleSeedInt(pool.length)]` when a pool is set
//   3. queue a CommonAnimPhase (USE_ITEM) on the holder
//   4. `getBerryEffectFunc(berry)(pokemon)`: the same function a held berry calls. No berry is held or used up.
// The constructor is `(berryPool?)`; an empty list is stored as "no pool". The draw happens in `apply`, never in `canApply`.
import { PostTurnRandomBerryEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { BerryType } from "#enums/berry-type";

const berryList = enumListCodec(BerryType, "berry");

/** The list codec, plus: a class with no pool at all (`undefined`) reads back as the empty list, which means "every berry". */
const berryPoolCodec: ParamCodec = {
  toCtor: value => berryList.toCtor(value),
  fromInstance: raw => (raw === undefined ? "" : berryList.fromInstance(raw)),
};

export default defineDecl(PostTurnRandomBerryEffectAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Trigger a random berry's effect every turn",
  summary: params =>
    `At the end of every turn I get the effect of one berry picked at random from this list: ${params.berries === "" ? "every berry" : params.berries}. No berry is needed and none is used up.`,
  synonyms: [
    "craving",
    "random berry",
    "free berry",
    "eat a berry every turn",
    "berry effect each turn",
    "berry roulette",
  ],
  examples: ["Get a random berry effect at the end of every turn, like Craving"],
  params: [
    {
      id: "berries",
      ctorIndex: 0,
      path: "berryPool",
      control: "text",
      label: "Berries it can pick from (comma separated names, empty = every berry)",
      editable: true,
      default: "SITRUS,LIECHI,GANLON,SALAC,PETAYA,APICOT,LANSAT,STARF",
      codec: berryPoolCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Nothing happens during a simulated check"],
  // Why this is a package and cannot be split further: the effect is "pick one berry at random, show the item animation, run that
  // berry's own effect". The berry effects (heal a quarter of max HP, raise one stat, cure a status, add a critical hit boost,
  // restore PP, a random stat by two stages) are the game's berry table, shared with held berries, and no library effect block
  // runs "a random one of these" (R-B05-30). The moment (end of turn) and the berry list are separate settings.
  effect: { id: "effect.package", params: ["berries"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: ["apply: one draw randBattleSeedInt(pool size, or 11 for every berry) picks the berry"],
    state: "none",
    simulated: "respects",
  },
  probes: [
    { name: "the holder sits through the end of the turn at full and at half HP", axes: { hp: ["max", "50%"] } },
  ],
  status: "decomposed",
  notes:
    "Tier C package, justified in the comment above: no condition to separate (no canApply, no getCondition, no ability-level condition), the trigger is the end-of-turn WHEN and the berry list is a typed setting, so staff can AND any IF on top of it. One user: Craving (5591 attr 0), pool in this order: SITRUS, LIECHI, GANLON, SALAC, PETAYA, APICOT, LANSAT, STARF (the order is part of the behaviour: the draw is an index into it; the pool comes from archetype-dispatcher.ts case 890). The list codec keeps the order. Off-list berries (Lum, Enigma, Leppa) can never fire for Craving. The class draws once in apply; a berry may draw again inside its own effect (Starf picks a random stat with randSeedInt), and Ripen-style DoubleBerryEffectAbAttr doubles the heal or the stages. Observation, not fixed: with no pool the draw uses BERRY_COUNT = 11 (every BerryType, Lum, Enigma and Leppa included), a legacy path no ability uses today. Lansat adds the critical-hit boost tag without a duration check and Leppa needs a move that is missing PP, so some berry picks do nothing visible.",
});
