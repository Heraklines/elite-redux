/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1 bindings (spec 2.1), keyed by (abilityId, attrIndex). `attrIndex` is the position in `ability.attrs`
// (read from the live game, not from the order of the `.attr()` lines). Every line below was read by hand from the
// class source and the live instance dump; the L1 differential then compares each Tier B gate and each closure with
// its library form over the state grid.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

type Site = readonly [abilityId: number, attrIndex: number, name: string];

function bindEach(spec: unknown, sites: readonly Site[], slot = "ctor:0"): void {
  for (const [abilityId, attrIndex] of sites) {
    bindCondition(abilityId, attrIndex, spec, slot);
  }
}

// The contact test every Tier B gate of this chunk starts with:
// `move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })`
const CONTACT = { id: "move.flag", flag: "MAKES_CONTACT" };

// =============================================================================================
// PostDefendContactDamageAbAttr (Tier B). Slot "gate": the contact test. The `!simulated` guard and the
// `!attacker.hasAbilityWithAttr("BlockNonDirectDamageAbAttr")` residual stay in the class.
// =============================================================================================
bindEach(
  CONTACT,
  [
    [24, 0, "Rough Skin"],
    [160, 0, "Iron Barbs"],
    [5289, 0, "Sharp Edges"],
    [5541, 0, "Poison Quills"],
    [5619, 3, "Dragonfruit"],
    [5956, 3, "Dragonfruit (second id)"],
    [5967, 0, "Prickly Armor"],
    [6112, 2, "In the Rough"],
    [20016, 0, "Samehada"],
  ],
  "gate",
);

// =============================================================================================
// PostDefendPerishSongAbAttr (Tier B). Slot "gate": the contact test; "attacker has no Perish Song countdown" is the residual.
// =============================================================================================
bindEach(CONTACT, [[253, 0, "Perish Body"]], "gate");

// =============================================================================================
// PostDefendWeatherChangeAbAttr (Tier A). Slot ctor:1, a PokemonDefendCondition (target, user, move).
// Sand Spit passes `move.category !== MoveCategory.STATUS`, which is the move.damaging atom.
// Cryo Proficiency (5223, attr 4) passes no closure: the optional slot is absent and needs no binding.
// =============================================================================================
bindEach({ id: "move.damaging" }, [[245, 0, "Sand Spit"]], "ctor:1");

// =============================================================================================
// PostDefendAbilitySwapAbAttr (Tier B). Slot "gate": the contact test; swappable and the Wandering Spirit pairing
// rule are the residual.
// =============================================================================================
bindEach(
  CONTACT,
  [
    [254, 0, "Wandering Spirit"],
    [5001, 0, "Wandering Spirit (ER twin)"],
  ],
  "gate",
);

// =============================================================================================
// PostDefendAbilityGiveAbAttr (Tier B). Slot "gate": the contact test; suppressable, "not itself a giver" and the
// Mummy family rule are the residual.
// =============================================================================================
bindEach(
  CONTACT,
  [
    [152, 1, "Mummy"],
    [268, 1, "Lingering Aroma"],
    [5377, 4, "Blood Stain"],
    [6084, 1, "Lingering Musk"],
  ],
  "gate",
);

// =============================================================================================
// PostDefendMoveDisableAbAttr (Tier B, RNG). Slot "gate", in the ORIGINAL clause order:
//   attacker.getTag(DISABLED) == null && contact && (chance === -1 || randBattleSeedInt(100) < chance)
// The chance atom stays LAST so a non-contact hit or an already disabled attacker draws no random number.
// =============================================================================================
bindEach(
  {
    all: [{ not: { id: "tag.has", who: "other", tag: "DISABLED" } }, CONTACT, { id: "rng.chance", pct: 30 }],
  },
  [[130, 0, "Cursed Body"]],
  "gate",
);

// =============================================================================================
// PostStatStageChangeStatStageChangeAbAttr (Tier A). Slot ctor:0, a PokemonStatStageChangeCondition
// (target, stats, stages) => boolean. All six users pass `stages < 0` (stage.just-changed, direction lowered), but no
// adapter turns a library IF into that signature yet (request B02-7), so each is a legacy closure with that reason.
// =============================================================================================
const STAT_CHANGE_REASON =
  "Closure `stages < 0` maps to stage.just-changed (direction lowered), but the slot has no adapter: the library only adapts attack, defend and holder closures, not the (target, stats, stages) signature of a stat-change condition (request B02-7 in requests/B02.md)";
for (const [abilityId, attrIndex] of [
  [128, 0], // Defiant
  [172, 0], // Competitive
  [5312, 1], // Contempt
  [5617, 0], // Narcissist
  [5686, 3], // Lucha Libre
  [5725, 1], // Duality
] as const) {
  bindLegacyClosure(abilityId, attrIndex, STAT_CHANGE_REASON, "ctor:0");
}

// =============================================================================================
// B02 chunk 2.
// MoveTypeChangeAbAttr (Tier A). Slot ctor:1, a PokemonAttackCondition `(user, target, move)`. The frame's holder and
// move user are the user. Every line was read from the live closure source (init-abilities.ts, init-elite-redux-*.ts).
// The atom move.type is always used with `effective: false` here: `effective: true` asks `user.getMoveType(move)`,
// which dispatches MoveTypeChangeAbAttr itself and would recurse; the closures read the raw `move.type`.
// =============================================================================================

// `(_u, _t, move) => !!move && move.type === PokemonType.NORMAL`. The frame always has a move, so `!!move` is implied.
const RAW_NORMAL = { id: "move.type", type: "NORMAL", effective: false };
bindEach(
  RAW_NORMAL,
  [
    [200, 0, "Steelworker"],
    [5053, 0, "Hydrate"],
    [5123, 0, "Spectralize"],
    [5501, 0, "Deviate"],
    [5530, 1, "Stainless Steel"],
    [5689, 0, "Waterborne"],
    [5714, 1, "Mob Boss"],
    [5938, 0, "Weighted Scales"],
    [5955, 0, "Waterborne (second id)"],
    [5995, 1, "Crude Steel"],
    [6003, 1, "Stainless Steel (second id)"],
    [6028, 3, "Solar Panel"],
  ],
  "ctor:1",
);

// Two-Faced (5486) `fullBelly(user) && move.type === NORMAL`, fullBelly = `user.getFormKey() !== "hangry"`.
bindCondition(5486, 8, { all: [{ not: { id: "mon.in-form", who: "holder", key: "hangry" } }, RAW_NORMAL] }, "ctor:1");
// `hangry(user) && move.type === NORMAL`, hangry = `user.getFormKey() === "hangry"`.
bindCondition(5486, 10, { all: [{ id: "mon.in-form", who: "holder", key: "hangry" }, RAW_NORMAL] }, "ctor:1");

// `anyTypeMoveConversionCondition(user, target, move)` (init-abilities.ts:2380) = "the move may have its type changed
// by an ability": not one of the eight fixed-type moves (Weather Ball, Judgment, Revelation Dance, Multi Attack, Terrain
// Pulse, Natural Gift, Techno Blast, Hidden Power), and, for a Terastallized user, not Tera Blast and not Tera Starstorm
// of a Stellar Terapagos. The Terastallized, Tera type and species tests have no atom: request B02-14.
const ANY_TYPE_REASON =
  "The closure calls anyTypeMoveConversionCondition (the move may have its type changed by an ability: not Weather Ball, Judgment, Revelation Dance, Multi Attack, Terrain Pulse, Natural Gift, Techno Blast or Hidden Power, and for a Terastallized user not Tera Blast or Stellar Tera Starstorm of Terapagos); there is no atom for the Terastallized state, the Tera type or the species yet (request B02-14 in requests/B02.md)";
const NORMAL_AND_ANY_REASON = `Normal-type move AND anyTypeMoveConversionCondition. ${ANY_TYPE_REASON}`;
const SOUND_AND_NORMAL_AND_ANY_REASON = `Sound move (library atom move.flag SOUND_BASED) AND Normal-type move AND anyTypeMoveConversionCondition. ${ANY_TYPE_REASON}`;

// Normalize: the condition alone.
bindLegacyClosure(96, 0, ANY_TYPE_REASON, "ctor:1");
// Normal-type AND convertible: the "-ate" family and its ER copies.
for (const [abilityId, attrIndex] of [
  [174, 0], // Refrigerate
  [182, 0], // Pixilate
  [184, 0], // Aerilate
  [206, 0], // Galvanize
  [5152, 1], // Atomic Burst
  [5954, 0], // Pixilate (second id)
  [6019, 0], // Fluttering Spirit
  [20005, 2], // Thunder Gods Vessel
  [20006, 2], // Malicious Empathy
  [20007, 0], // Fae Heart
] as const) {
  bindLegacyClosure(abilityId, attrIndex, NORMAL_AND_ANY_REASON, "ctor:1");
}
// Liquid Voice and Siren's Song: `move.doesFlagEffectApply({ flag: SOUND_BASED, user }) && normalTypeMoveConversionCondition`.
for (const [abilityId, attrIndex] of [
  [204, 0], // Liquid Voice
  [20015, 1], // Siren's Song
] as const) {
  bindLegacyClosure(abilityId, attrIndex, SOUND_AND_NORMAL_AND_ANY_REASON, "ctor:1");
}

// =============================================================================================
// AllAttacksMultiHitAbAttr (Tier B). Slot "gate": `hitCount.value === 1` is `not move.multi-hit` (hits.count > 1; the
// count starts at 1 and is only raised). The canBeMultiStrikeEnhanced eligibility test is the residual.
// =============================================================================================
bindEach({ not: { id: "move.multi-hit" } }, [[5695, 0, "Unrelenting"]], "gate");

// =============================================================================================
// B02 chunk 3.
// Every closure below was read from the live attr (a throwaway dump of `String(closure)` for every site of the
// eight classes) and from the source line named in its comment. A binding is only claimed when the library atom calls
// the SAME engine predicate; the rest are legacy-closure with the missing atom named (requests B02-18 to B02-27).
// `attack` closures are `(user, target, move)`: the frame's holder and move user are the user, `other` is the target.
// =============================================================================================

function legacyEach(reason: string, sites: readonly Site[], slot = "ctor:0"): void {
  for (const [abilityId, attrIndex] of sites) {
    bindLegacyClosure(abilityId, attrIndex, reason, slot);
  }
}

// ---- MoveDamageBoostAbAttr (Tier A). Slot ctor:1, a PokemonAttackCondition. ----------------------------------------
// `(user, target, move) => (target?.getMoveEffectiveness(user, move) ?? 1) <= .5` (Tinted Lens, Sepia Lens, Drake Of Rage).
// A missing target answers 1 in the closure (not <= 0.5, so false) and false in the atom (no defender).
bindEach(
  { id: "move.effectiveness", cmp: "lte", n: 0.5 },
  [
    [110, 0, "Tinted Lens"],
    [5506, 0, "Sepia Lens"],
    [5512, 0, "Drake Of Rage"],
  ],
  "ctor:1",
);
// Parental Bond: `user.turnData.hitCount > 1 && user.turnData.hitsLeft === 1 && move.canBeMultiStrikeEnhanced(user, true, target)`.
bindLegacyClosure(
  185,
  1,
  "Closure: the move is on its extra strike (turnData.hitCount > 1 and hitsLeft === 1) AND the move can take extra strikes (canBeMultiStrikeEnhanced). The attack frame has no hit counters and no atom reads turnData.hitCount / hitsLeft or the strike-eligibility rule (request B02-18 in requests/B02.md)",
  "ctor:1",
);

// ---- AddMoveFlagAbAttr (Tier A). Slot ctor:1, a PokemonAttackCondition built from the options filter (user, move). ----
// `user.getMoveType(move) === DRAGON / NORMAL`: the move type after ability changes, the move.type atom with effective true.
bindEach({ id: "move.type", type: "DRAGON", effective: true }, [[5307, 2, "Brawling Wyvern"]], "ctor:1");
bindEach(
  { id: "move.type", type: "NORMAL", effective: true },
  [
    [5513, 0, "Reverberate"],
    [5514, 0, "Mixed Martial Arts"],
    [6089, 2, "Kyokushin"],
  ],
  "ctor:1",
);
// Junshi Sanda: `move.hasFlag(PUNCHING)` and `move.hasFlag(KICKING)`. move.flag asks doesFlagEffectApply, which only differs from
// hasFlag for contact, ignore-abilities, ignore-protect and the two injected flags (dance, sound) and the horn/slicing pair injected by RapierFlagInjectionAbAttr (barbaracle-mechanics.ts); punching and kicking are none of them.
bindEach({ id: "move.flag", flag: "PUNCHING_MOVE" }, [[5470, 0, "JunshiSanda (punching moves also kick)"]], "ctor:1");
bindEach({ id: "move.flag", flag: "KICKING_MOVE" }, [[5470, 1, "JunshiSanda (kicking moves also punch)"]], "ctor:1");
// Gunman: `move.category === STATUS`.
bindEach({ id: "move.category", category: "STATUS" }, [[5481, 1, "Gunman (status moves count as pulse)"]], "ctor:1");

// ---- LowHpMoveTypePowerBoostAbAttr (Tier A). Slot ctor:2, an AbAttrCondition (pokemon). ------------------------------
// `pokemon.getHpRatio() <= 0.33`; getHpRatio() rounds hp / maxHp to two decimals, so hp.at-most (hp * 100 <= maxHp * pct) is a
// different test (33.4% is low here, not there). No atom has that rounding yet.
legacyEach(
  "Closure `pokemon.getHpRatio() <= 0.33`: getHpRatio() rounds the ratio to two decimals (Math.round(hp / maxHp * 100) / 100), which the library HP atoms do not do (hp.at-most uses hp * 100 <= maxHp * pct); an HP atom with that rounding is request B02-21 in requests/B02.md",
  [
    [65, 0, "Overgrow"],
    [66, 0, "Blaze"],
    [67, 0, "Torrent"],
    [68, 0, "Swarm"],
    [5672, 0, "Lepidopteran"],
  ],
  "ctor:2",
);

// ---- MovePowerBoostAbAttr (Tier A). Slot ctor:0, a PokemonAttackCondition. ------------------------------------------
// `() => true`: no condition (Blood Price, Dreamscape, Subversion). An empty ALL group is always true.
bindEach({ all: [] }, [
  [5264, 0, "Blood Price"],
  [5560, 3, "Dreamscape"],
  [6081, 2, "Subversion"],
]);
// `move.category !== STATUS` (Hustle).
bindEach({ id: "move.damaging" }, [[55, 0, "Hustle"]]);
// `move.category === PHYSICAL`.
bindEach({ id: "move.category", category: "PHYSICAL" }, [
  [203, 1, "Long Reach"],
  [5354, 0, "Venoblaze Pincers"],
]);
// Toxic Boost `move.category === PHYSICAL && (user.status?.effect === POISON || user.status?.effect === TOXIC)`.
bindEach(
  {
    all: [
      { id: "move.category", category: "PHYSICAL" },
      {
        any: [
          { id: "status.has", who: "holder", status: "POISON" },
          { id: "status.has", who: "holder", status: "TOXIC" },
        ],
      },
    ],
  },
  [[137, 0, "Toxic Boost"]],
);
// Flare Boost `move.category === SPECIAL && user.status?.effect === BURN`.
bindEach(
  {
    all: [
      { id: "move.category", category: "SPECIAL" },
      { id: "status.has", who: "holder", status: "BURN" },
    ],
  },
  [[138, 0, "Flare Boost"]],
);
// Normalize `move?.type === NORMAL`: the raw printed type (effective: false), like the MoveTypeChange bindings above.
bindEach({ id: "move.type", type: "NORMAL", effective: false }, [[96, 1, "Normalize (1.1x)"]]);
// Two-Faced: `fullBelly(user) && move.type === NORMAL` (fullBelly = `user.getFormKey() !== "hangry"`).
bindEach(
  {
    all: [
      { not: { id: "mon.in-form", who: "holder", key: "hangry" } },
      { id: "move.type", type: "NORMAL", effective: false },
    ],
  },
  [[5486, 9, "Two-Faced"]],
);
// Sound moves: `move.doesFlagEffectApply({ flag: SOUND_BASED, user })`, the very call the atom makes (the target only matters for contact).
bindEach({ id: "move.flag", flag: "SOUND_BASED" }, [
  [204, 1, "Liquid Voice"],
  [244, 0, "Punk Rock"],
  [5253, 2, "Bass Boosted"],
  [5428, 3, "Sludgy Mix"],
  [20015, 2, "Siren's Song"],
]);
// Printed move flags read with `move.hasFlag(F)`. For F other than contact, ignore-abilities, ignore-protect, dance and sound,
// doesFlagEffectApply(F) is `hasFlag(F)` (the only flag injectors in the game inject dance and sound, and horn/slicing through RapierFlagInjectionAbAttr; no bound atom reads horn or slicing), so the atom is the same test.
bindEach({ id: "move.flag", flag: "RECKLESS_MOVE" }, [
  [120, 0, "Reckless"],
  [5459, 1, "Brute Force"],
  [5708, 0, "Current Crash (reckless part)"],
]);
bindEach({ id: "move.flag", flag: "BITING_MOVE" }, [
  [173, 0, "Strong Jaw"],
  [5249, 0, "Devourer"],
  [5319, 0, "Flaming Maw"],
  [5409, 0, "Shocking Maw"],
  [5562, 0, "Hungry Maws"],
  [5677, 0, "Crushing Jaw"],
  [6103, 0, "World-Eater"],
]);
bindEach({ id: "move.flag", flag: "PULSE_MOVE" }, [
  [178, 0, "Mega Launcher"],
  [5132, 0, "Iron Barrage"],
  [5387, 0, "Master Hand"],
  [5478, 0, "Super Scope"],
  [5481, 0, "Gunman (pulse part)"],
  [5555, 0, "Gnashing Cannon"],
  [5679, 3, "Nihil Blaster (pulse part)"],
]);
bindEach({ id: "move.flag", flag: "THROW_BASED" }, [
  [276, 1, "Rocky Payload (throwing part)"],
  [6027, 1, "Dirty Snowball (throwing part)"],
]);
// Higher Rank `(move?.priority ?? 0) > 0`.
bindEach({ id: "move.priority", cmp: "gt", n: 0 }, [[5366, 0, "Higher Rank"]]);
// `(target?.getMoveEffectiveness(user, move) ?? 1) >= 2` (Neuroforce, Calculative's second boost).
bindEach({ id: "move.effectiveness", cmp: "gte", n: 2 }, [
  [233, 0, "Neuroforce"],
  [5494, 2, "Calculative (super effective part)"],
]);
// Seaweed and Old Mariner `!!target && target.isOfType(FIRE) && user.getMoveType(move) === GRASS` (the holder's own Grass-type
// test is the attr-level condition `holder.isOfType(GRASS)`, carried by addCondition).
bindEach(
  {
    all: [
      { id: "mon.has-type", who: "other", type: "FIRE" },
      { id: "move.type", type: "GRASS", effective: true },
    ],
  },
  [
    [5080, 0, "Seaweed"],
    [5324, 0, "Old Mariner"],
  ],
);
// `!!target && target.isOfType(WATER)` (and `target.getTypes().includes(WATER)`: isOfType calls getTypes with the same defaults).
bindEach({ id: "mon.has-type", who: "other", type: "WATER" }, [
  [5126, 0, "Thundercall"],
  [5127, 1, "Marine Apex"],
  [5708, 1, "Current Crash (water part)"],
  [20005, 6, "Thunder Gods Vessel (water part)"],
  [20006, 6, "Malicious Empathy (water part)"],
]);
bindEach({ id: "mon.has-type", who: "other", type: "STEEL" }, [[6042, 0, "Power Grinder"]]);
// A named move: `move.id === TACKLE / POISON_STING / ELECTROWEB / BUG_BITE` (Angel's Wrath, one attr per move).
bindEach({ id: "move.is-move", moveId: "TACKLE" }, [[5175, 2, "Angel's Wrath (Tackle)"]]);
bindEach({ id: "move.is-move", moveId: "POISON_STING" }, [[5175, 3, "Angel's Wrath (Poison Sting)"]]);
bindEach({ id: "move.is-move", moveId: "ELECTROWEB" }, [[5175, 4, "Angel's Wrath (Electroweb)"]]);
bindEach({ id: "move.is-move", moveId: "BUG_BITE" }, [[5175, 5, "Angel's Wrath (Bug Bite)"]]);
bindEach(
  {
    any: [
      { id: "move.is-move", moveId: "HIDDEN_POWER" },
      { id: "move.is-move", moveId: "SECRET_POWER" },
    ],
  },
  [[5477, 1, "Unown Power"]],
);
bindEach({ id: "move.is-move", moveId: "WATER_SHURIKEN" }, [[5659, 0, "Giant Shuriken"]]);
bindEach({ id: "move.is-move", moveId: "FLYING_PRESS" }, [[5663, 0, "Wrestle Showman"]]);
// Fog: `isFogWeather(arena.weather?.weatherType)` = FOG or EERIE_FOG, read from the weather object the atom also reads
// (arena.weatherType is `weather?.weatherType ?? NONE`; neither looks at weather suppression).
const FOG = {
  any: [
    { id: "field.weather", weather: "FOG" },
    { id: "field.weather", weather: "EERIE_FOG" },
  ],
};
bindEach(FOG, [[5646, 0, "Echolocation"]]);
bindEach({ all: [FOG, { id: "move.type", type: "GHOST", effective: true }] }, [
  [5523, 0, "Ominous Shroud"],
  [5961, 1, "Ominous Shroud (second id)"],
  [5666, 0, "Foggy Eye"],
]);
// Relentless `target != null && target.status != null && target.status.effect !== 0` (a status object always has an effect,
// the game never keeps one with NONE), the atom status.has ANY on the target.
bindEach({ id: "status.has", who: "other", status: "ANY" }, [[5473, 2, "Relentless"]]);

// ---- MovePowerBoostAbAttr: closures that stay legacy-closure, each with the exact atom that is missing. --------------
const CONTACT_RAW_REASON =
  "Closure reads the printed flag with move.hasFlag(MAKES_CONTACT). The atom move.flag asks doesFlagEffectApply, which for contact also says no for Long Reach, Punching Glove, a hit on a substitute and Manifest; an atom for the printed flag is request B02-22 in requests/B02.md";
legacyEach(CONTACT_RAW_REASON, [
  [145, 0, "Big Pecks"],
  [181, 0, "Tough Claws"],
  [5122, 1, "Nosferatu"],
  [5399, 0, "Apex Predator"],
  [5621, 0, "Lead Claws"],
  [5633, 0, "Ice Picks"],
  [5704, 0, "Bird of Prey"],
  [5726, 0, "Reaper's Embarce"],
]);
legacyEach(
  `Physical move that does not make contact: \`category === PHYSICAL && !move.hasFlag(MAKES_CONTACT)\`. ${CONTACT_RAW_REASON}`,
  [
    [5550, 0, "World Serpent"],
    [5933, 2, "First Serpent"],
  ],
);
const GRANTED_REASON =
  "Closure `move.hasFlag(F) || AddMoveFlagAbAttr.userGrantsFlag(user, move, F)`: the move has the property printed OR one of my abilities grants it (Brawling Wyvern, Junshi Sanda, ...). No atom reads the granted properties (request B02-23 in requests/B02.md)";
legacyEach(GRANTED_REASON, [
  [89, 0, "Iron Fist"],
  [292, 0, "Sharpness"],
  [5200, 0, "Nika (punching part)"],
  [5385, 0, "Atomic Punch"],
  [5718, 0, "Icicle Fist"],
]);
legacyEach(
  "Closure `move.power <= 60 && !move.hasAttr(VariablePowerAttr)`: the first part is the atom move.power, but no atom says that the move's power is fixed (does not change with a formula, weight, speed...); request B02-24 in requests/B02.md",
  [
    [101, 0, "Technician"],
    [5191, 0, "Ninja's Blade"],
    [5702, 2, "Bandit"],
  ],
);
legacyEach(
  "Closure `move.chance >= 1`: the move has an extra effect with a chance of at least 1% (Sheer Force). The atom move.has-effect-chance tests `move.chance >= 0`, which also accepts a 0 chance; an atom with the 'above 0' test is request B02-25 in requests/B02.md",
  [[125, 0, "Sheer Force"]],
);
legacyEach(
  "Closure asks whether an ally has the paired ability through abilityQuery(ally, MINUS_PAIRING / PLUS_PAIRING) over user.getAllies(); the atom party.ally-ability tests hasAbility of the one ally, not the engine query over every ally (request B02-26 in requests/B02.md)",
  [
    [57, 0, "Plus"],
    [58, 0, "Minus"],
  ],
);
legacyEach(
  "Closure `user.gender !== GENDERLESS && target?.gender !== GENDERLESS && user.gender === target?.gender` (same gender); the library only has the opposite-gender atom (mon.opposite-gender); a same-gender atom is request B02-27 in requests/B02.md",
  [
    [79, 0, "Rivalry"],
    [5625, 1, "Empress"],
  ],
);
legacyEach(
  "Closure `!!user && user.summonData.illusion != null`: no atom says that I am disguised by an illusion (request B02-28 in requests/B02.md)",
  [[149, 3, "Illusion"]],
);
legacyEach(
  "Closure `!phaseManager.hasPhaseOfType(MovePhase, phase => phase.pokemon.id !== user.id)`: nobody else still has a move waiting this turn, i.e. I move last; the atom time.acted tests the turn data of one Pokemon, not the move queue (request B02-29 in requests/B02.md)",
  [
    [148, 0, "Analytic"],
    [5494, 0, "Calculative (moving last part)"],
    [5515, 1, "Strategic Pause"],
    [5561, 1, "Haste Makes Waste"],
  ],
);
legacyEach(
  "Closure `target?.turnData.switchedInThisTurn`: the target came in this turn; no atom reads switchedInThisTurn (request B02-30 in requests/B02.md)",
  [
    [198, 0, "Stakeout"],
    [5429, 0, "Overwatch"],
  ],
);
legacyEach(
  "Closure `move.id === TERRAIN_PULSE && target !== null && !user.isOfType(resolveRequestedMoveType(user, target, move, user.getMoveType(move)))`: the requested-type resolver and 'the move's type is not one of my types' have no atom (request B02-31 in requests/B02.md)",
  [[250, 2, "Mimicry"]],
);
legacyEach(
  "Closure reads hasCommandAbilityProvenance(user, 'quick-draw:proc' / 'quick-claw:proc') and, for Quick Draw and Minigun, abilityQuery(target, QUICK_DRAW_TARGET); no atom reads the command-ability provenance (request B02-32 in requests/B02.md)",
  [
    [259, 1, "Quick Draw"],
    [5996, 1, "Minigun"],
    [5481, 2, "Gunman (quick draw part)"],
  ],
);
legacyEach(
  "Closure `move.type === F && user.getHpRatio() < 1 / 3`: the printed type (atom move.type, effective false) AND an HP test on getHpRatio(), which rounds to two decimals; the HP atoms do not round that way (request B02-21 in requests/B02.md)",
  [
    [5014, 1, "Vengeance"],
    [5037, 1, "Earthbound"],
    [5283, 2, "Vengeful Spirit"],
  ],
);
legacyEach(
  "Closure `move.type === NORMAL && anyTypeMoveConversionCondition(user, target, move)`: the move may have its type changed by an ability; there is no atom for the Terastallized state, Tera Blast and the fixed-type moves (request B02-14 in requests/B02.md)",
  [
    [174, 1, "Refrigerate"],
    [182, 1, "Pixilate"],
    [184, 1, "Aerilate"],
    [206, 1, "Galvanize"],
    [5152, 2, "Atomic Burst"],
    [5954, 1, "Pixilate (second id)"],
    [6019, 1, "Fluttering Spirit"],
    [20005, 3, "Thunder Gods Vessel (convert part)"],
    [20006, 3, "Malicious Empathy (convert part)"],
    [20007, 1, "Fae Heart"],
  ],
);
legacyEach(
  "Closure `user.isOfType(user.getMoveType(move))`: the move's type is one of my own types (same-type bonus); no atom compares the move type with my types (request B02-33 in requests/B02.md)",
  [[5403, 0, "Color Spectrum"]],
);
legacyEach(
  "Closure reads holderHasUpcycle / holderHasUpcyclePoisonBoost / isErFoodPokemon (upcycle and food-type rules); no atom exists for them (request B02-34 in requests/B02.md)",
  [
    [5356, 0, "Sugar Rush (boost)"],
    [5356, 1, "Sugar Rush (poison boost)"],
  ],
);
legacyEach(
  "Closure reads the weather object and its suppression (`weather.isEffectSuppressed()`) and tests Sun or Harsh Sun with a Water move; field.weather ignores suppression, so it is not the same test (request B02-35 in requests/B02.md)",
  [[5200, 1, "Nika (sun and water part)"]],
);
legacyEach(
  "Closure `move.type === GRASS && arena.terrain?.terrainType === GRASSY`: reads the terrain object directly, while field.terrain asks arena.terrainType, which a Clueless-style field suppression sets to None; an atom for the raw terrain is request B02-36 in requests/B02.md",
  [[5310, 0, "Flourish"]],
);

// =============================================================================================
// B02 chunk 4.
// StatMultiplierAbAttr (Tier A). Slot ctor:2, an optional PokemonAttackCondition `(user, target, move)`; only 7 of the 62 attrs
// have one. The frame's holder and move user are the user. Every closure was read from the live attr (init-abilities.ts,
// init-elite-redux-vanilla-rebalance.ts:1373, archetype-dispatcher.ts:4943, :6427, :6442, ability-upgrades).
// =============================================================================================
// Hustle `(_user, _target, move) => move.category !== MoveCategory.STATUS` (accuracy x0.9, rebalance `attacksOnly`).
bindCondition(55, 1, { id: "move.damaging" }, "ctor:2");
// Plasma Lamp `(_user, _target, move) => move.type === FIRE || move.type === ELECTRIC`: the PRINTED move type, so `effective: false`.
bindCondition(
  5197,
  2,
  {
    any: [
      { id: "move.type", type: "FIRE", effective: false },
      { id: "move.type", type: "ELECTRIC", effective: false },
    ],
  },
  "ctor:2",
);
// Determination `p => (p.status != null && p.status.effect !== NONE) || !!p.getTag(ER_FROSTBITE)`. A status object always has an
// effect (the game never keeps one with NONE), so the first part is `status.has ANY` on the user.
bindCondition(
  5236,
  0,
  {
    any: [
      { id: "status.has", who: "holder", status: "ANY" },
      { id: "tag.has", who: "holder", tag: "ER_FROSTBITE" },
    ],
  },
  "ctor:2",
);
// Rage Point `pokemon => pokemon.status !== null && pokemon.status?.effect !== NONE` (ATK and SPATK attrs).
bindCondition(5406, 0, { id: "status.has", who: "holder", status: "ANY" }, "ctor:2");
bindCondition(5406, 1, { id: "status.has", who: "holder", status: "ANY" }, "ctor:2");
// Propeller Tail `getWeatherCondition(RAIN, HEAVY_RAIN)`: `!arena.weather?.isEffectSuppressed() && weatherType in [RAIN, HEAVY_RAIN]`
// (its Sun and Grassy branch cannot be reached with a rain list). field.weather ignores suppression.
bindLegacyClosure(
  239,
  1,
  "Closure `getWeatherCondition(RAIN, HEAVY_RAIN)` reads the weather object and its suppression (`weather.isEffectSuppressed()`); field.weather ignores suppression, so it is not the same test (request B02-35 in requests/B02.md)",
  "ctor:2",
);
// Jungle Fever `globalSceneTerrainIs(GRASSY)` = `arena.terrain?.terrainType === GRASSY` (the raw terrain object).
bindLegacyClosure(
  5728,
  0,
  "Closure `arena.terrain?.terrainType === GRASSY` reads the terrain object directly, while field.terrain asks arena.terrainType, which a Clueless-style field suppression sets to None; an atom for the raw terrain is request B02-36 in requests/B02.md",
  "ctor:2",
);

// ---- PostAttackApplyStatusEffectAbAttr (Tier B). Slot "gate": [the move deals damage, chance]. The class default attack
// condition is `move.category !== STATUS` (= move.damaging). The Shield Dust and "not myself" tests are guards in the class, the
// status pick and `canSetStatus` are the residual. contactRequired is false for both users, so no contact atom.
for (const [abilityId, attrIndex] of [
  [302, 0], // Toxic Chain (TOXIC)
  [5552, 3], // Komodo (POISON)
] as const) {
  bindCondition(abilityId, attrIndex, { all: [{ id: "move.damaging" }, { id: "rng.chance", pct: 30 }] }, "gate");
}

// ---- PostAttackContactApplyStatusEffectAbAttr (Tier B). Slot "gate": [damaging, contact, chance], contactRequired is true. ----
for (const [abilityId, attrIndex] of [
  [9, 2], // Static
  [38, 1], // Poison Point
  [49, 2], // Flame Body
  [143, 0], // Poison Touch
  [5358, 2], // White Noise
  [5479, 1], // Venom Crown
  [5480, 2], // Blight Scale
  [5541, 2], // Poison Quills
  [5667, 3], // Toxic Shell
  [5733, 4], // Smoldering Wood
] as const) {
  bindCondition(
    abilityId,
    attrIndex,
    { all: [{ id: "move.damaging" }, { id: "move.flag", flag: "MAKES_CONTACT" }, { id: "rng.chance", pct: 30 }] },
    "gate",
  );
}
