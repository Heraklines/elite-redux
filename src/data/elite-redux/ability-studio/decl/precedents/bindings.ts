/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of the golden precedents (spec 2.1): the library form of every constructor closure (slot
// "ctor:N") and every Tier B gate (slot "gate") of the precedent classes, keyed by (abilityId, attrIndex).
//
// Every line was read by hand from the live attr (closure source, multiplier, chance, threshold) and mapped to the
// atom that calls the SAME engine predicate. The L1 differential then evaluates the original closure and the library
// form over the state grid and fails on any difference; a binding is only a claim until that test passes.
//
// Reading guide for the names below: "attr N" is the position in `ability.attrs`, so Fluffy (218) has two bindings,
// one per ReceivedMoveDamageMultiplierAbAttr.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

type Site = readonly [abilityId: number, attrIndex: number, name: string];

function bindEach(spec: unknown, sites: readonly Site[], slot = "ctor:0"): void {
  for (const [abilityId, attrIndex] of sites) {
    bindCondition(abilityId, attrIndex, spec, slot);
  }
}

// =============================================================================================
// ReceivedMoveDamageMultiplierAbAttr (64 attrs). Slot ctor:0, a PokemonDefendCondition (target, user, move).
// The "holder" of every frame is the target; "other" and the move user are the attacker.
// =============================================================================================

// `() => true`: no condition. An empty ALL group is always true.
bindEach({ all: [] }, [
  [4, 1, "Battle Armor"],
  [75, 1, "Shell Armor"],
  [5176, 2, "Prismatic Fur"],
  [5460, 1, "Faraday Cage"],
  [5667, 1, "Toxic Shell"],
  [5669, 2, "Voltron"],
  [5698, 1, "Shattered Armor"],
  [5703, 2, "Fortress"],
  [5716, 4, "Droideka"],
  [5958, 2, "Voltron (second id)"],
  [6098, 1, "Exosuit"],
  [20004, 2, "Exo Armor"],
  [20005, 1, "Thunder Gods Vessel"],
  [20006, 1, "Malicious Empathy"],
  [20021, 2, "Spin To Win"],
]);

// `target.isFullHp()` (Multiscale, the golden "half damage at full HP" recipe)
bindEach({ id: "hp.full", who: "holder" }, [
  [136, 0, "Multiscale"],
  [231, 0, "Shadow Shield"],
  [5480, 0, "Blight Scale"],
  [5523, 2, "Ominous Shroud"],
  [5938, 4, "Weighted Scales"],
  [5961, 0, "Ominous Shroud (second id)"],
  [20016, 1, "Samehada"],
]);

// `target.getMoveEffectiveness(user, move) >= 2` (the "takes less from super effective hits" family)
bindEach({ id: "move.effectiveness", cmp: "gte", n: 2 }, [
  [111, 0, "Filter"],
  [116, 0, "Solid Rock"],
  [232, 0, "Prism Armor"],
  [5229, 0, "Refrigerator"],
  [5703, 0, "Fortress"],
  [5995, 0, "Crude Steel"],
]);

// `move.category === PHYSICAL` / `=== SPECIAL`
bindEach({ id: "move.category", category: "PHYSICAL" }, [
  [169, 0, "Fur Coat"],
  [5317, 0, "Apple Enlightenment"],
]);
bindEach({ id: "move.category", category: "SPECIAL" }, [
  [142, 2, "Overcoat"],
  [246, 0, "Ice Scales"],
]);

// `move.doesFlagEffectApply({ flag: MAKES_CONTACT, user, target })`
bindEach({ id: "move.flag", flag: "MAKES_CONTACT" }, [
  [218, 0, "Fluffy"],
  [5647, 2, "Massive Pelt"],
  [5946, 0, "Adaptive Fur"],
  [6001, 0, "Fluffy (second id)"],
  [6069, 0, "Paper Talisman"],
]);
// `!move.doesFlagEffectApply({ flag: MAKES_CONTACT, user, target })`
bindEach({ not: { id: "move.flag", flag: "MAKES_CONTACT" } }, [[6041, 0, "Electrified"]]);

// `move.doesFlagEffectApply({ flag: SOUND_BASED, user })`
bindEach({ id: "move.flag", flag: "SOUND_BASED" }, [
  [244, 1, "Punk Rock"],
  [5253, 3, "Bass Boosted"],
  [5428, 4, "Sludgy Mix"],
]);

// `user.getMoveType(move) === FIRE` (take double damage from Fire) and the Electric twin
bindEach({ id: "move.type", type: "FIRE", effective: true }, [
  [218, 1, "Fluffy"],
  [5647, 3, "Massive Pelt"],
  [5946, 1, "Adaptive Fur"],
  [6001, 1, "Fluffy (second id)"],
  [6069, 1, "Paper Talisman"],
]);
bindEach({ id: "move.type", type: "ELECTRIC", effective: true }, [[6041, 1, "Electrified"]]);

// Heavy Metal / Superheavy: `moveType === GHOST || moveType === DARK || move.doesFlagEffectApply({ flag: SOUND_BASED, user })`
bindEach(
  {
    any: [
      { id: "move.type", type: "GHOST", effective: true },
      { id: "move.type", type: "DARK", effective: true },
      { id: "move.flag", flag: "SOUND_BASED" },
    ],
  },
  [
    [134, 1, "Heavy Metal"],
    [5549, 6, "Superheavy"],
  ],
);

// Astral Project: `[PSYCHIC, DARK].includes(user.getMoveType(move))`
bindEach(
  {
    any: [
      { id: "move.type", type: "PSYCHIC", effective: true },
      { id: "move.type", type: "DARK", effective: true },
    ],
  },
  [[6018, 1, "Astral Project"]],
);

// `attacker.isOfType(X)`: the attacker is of a type
bindEach({ id: "mon.has-type", who: "other", type: "DRAGON" }, [[5051, 1, "Dragonslayer"]]);
bindEach({ id: "mon.has-type", who: "other", type: "FAIRY" }, [[5178, 1, "Fae Hunter"]]);
bindEach({ id: "mon.has-type", who: "other", type: "GRASS" }, [[5181, 1, "Lumberjack"]]);
bindEach({ id: "mon.has-type", who: "other", type: "DARK" }, [[5255, 1, "Monster Hunter"]]);
bindEach({ id: "mon.has-type", who: "other", type: "FIRE" }, [[5505, 1, "Firefighter"]]);
bindEach({ id: "mon.has-type", who: "other", type: "STEEL" }, [[6042, 1, "Power Grinder"]]);

// Rivalry / Empress: both have a gender and the genders differ
bindEach({ id: "mon.opposite-gender" }, [
  [79, 1, "Rivalry"],
  [5625, 2, "Empress"],
]);

// Stall, Breakwater, Haste Makes Waste: `!(target.turnData?.acted ?? false)` (I have not moved yet this turn)
bindEach({ not: { id: "time.acted", who: "holder" } }, [
  [100, 0, "Stall"],
  [5442, 1, "Breakwater"],
  [5561, 0, "Haste Makes Waste"],
]);

// No library form yet (each needs an atom the librarian has not added); reusable as a whole, counted as undecomposed.
bindLegacyClosure(
  5356,
  2,
  "Sugar Rush: holderHasUpcycle(holder) || isErFoodPokemon(attacker) read ER food/upcycle state that has no atom yet (request: party.food-pokemon / mon.has-upcycle)",
);
bindLegacyClosure(
  5518,
  0,
  "Madness Enhancement: the ER_ENRAGE tag OR any fog weather (isFogWeather covers more than one weather type); needs an any-fog field.weather atom",
);
bindLegacyClosure(
  6047,
  3,
  "Oracle: oracleGuardActive(target) is a bespoke state machine of the Oracle ability, not a game rule staff could recombine",
);

// =============================================================================================
// AttackTypeImmunityAbAttr. Slot ctor:1, an AbAttrCondition (pokemon) => boolean, present on 5 of 21 attrs.
// =============================================================================================

// Levitate's closure: `!pokemon.getTag(GroundedTag) && !globalScene.arena.hasActiveGravity()`
// (GroundedTag is the class of BattlerTagType.IGNORE_FLYING)
bindEach(
  { all: [{ not: { id: "tag.has", who: "holder", tag: "IGNORE_FLYING" } }, { not: { id: "field.gravity" } }] },
  [
    [26, 0, "Levitate"],
    [5313, 0, "Aerialist"],
    [5391, 1, "Imposing Wings"],
    [5960, 0, "Spectacle"],
    [6013, 1, "Free Spirit"],
  ],
  "ctor:1",
);

// =============================================================================================
// PostDamageForceSwitchAbAttr (Tier B). Slot "gate": hp.crossed-below with the user's own hpRatio (exact rounding).
// =============================================================================================
bindEach(
  { id: "hp.crossed-below", who: "holder", ratio: 0.5, rounding: "exact" },
  [
    [193, 0, "Wimp Out"],
    [194, 0, "Emergency Exit"],
  ],
  "gate",
);

// =============================================================================================
// PostDefendContactApplyStatusEffectAbAttr (Tier B). Slot "gate", in the ORIGINAL clause order:
//   move.doesFlagEffectApply(MAKES_CONTACT) && !attacker.status && randBattleSeedInt(100) < chance
// The chance atom stays LAST so a non-contact hit or a statused attacker draws no random number.
// =============================================================================================
const contactGate = (pct: number): unknown => ({
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    { id: "status.has", who: "other", status: "NONE" },
    { id: "rng.chance", pct },
  ],
});
bindEach(
  contactGate(30),
  [
    [9, 0, "Static (display name static.name)"],
    [38, 0, "Poison Point"],
    [49, 0, "Flame Body"],
    [5358, 0, "White Noise"],
    [5479, 0, "Venom Crown"],
    [5480, 1, "Blight Scale"],
    [5541, 1, "Poison Quills"],
    [5667, 2, "Toxic Shell"],
    [5733, 2, "Smoldering Wood"],
  ],
  "gate",
);

// =============================================================================================
// BerserkOnThresholdAbAttr (Tier B, memory). Slot "gate": the whole rule in the original order.
// =============================================================================================
bindEach(
  {
    all: [
      { id: "time.once-per", scope: "wave", key: "berserk-on-threshold" },
      { id: "move.damaging" },
      { id: "side.is", kind: "foe" },
      { id: "hp.crossed-below", who: "holder", ratio: 0.5, rounding: "floor-half" },
    ],
  },
  [
    [201, 0, "Berserk"],
    [5365, 3, "Unlocked Potential"],
    [5693, 0, "Going Berserk"],
  ],
  "gate",
);

// =============================================================================================
// HpThresholdFormChangeAbAttr (Tier B, branches). Slot "gate": the original XOR spelled out as the two edges.
//   low-HP form  (Ape Shift):   hp <= line XOR in-form   =  any[ all[low, not in-form], all[not low, in-form] ]
//   high-HP form (Locust Swarm): hp <= line XNOR in-form =  any[ all[not low, not in-form], all[low, in-form] ]
// `low` is the class's own ratio test `hp / maxHp <= hpThreshold`, here hp.at-most with whole-number percent.
// =============================================================================================
bindCondition(
  5436,
  0,
  {
    any: [
      {
        all: [
          { id: "hp.at-most", who: "holder", pct: 50, rounding: "exact" },
          { not: { id: "mon.in-form", who: "holder", key: "transformed" } },
        ],
      },
      {
        all: [
          { not: { id: "hp.at-most", who: "holder", pct: 50, rounding: "exact" } },
          { id: "mon.in-form", who: "holder", key: "transformed" },
        ],
      },
    ],
  },
  "gate",
);
bindCondition(
  5585,
  0,
  {
    any: [
      {
        all: [
          { not: { id: "hp.at-most", who: "holder", pct: 25, rounding: "exact" } },
          { not: { id: "mon.in-form", who: "holder", key: "hivemind" } },
        ],
      },
      {
        all: [
          { id: "hp.at-most", who: "holder", pct: 25, rounding: "exact" },
          { id: "mon.in-form", who: "holder", key: "hivemind" },
        ],
      },
    ],
  },
  "gate",
);
