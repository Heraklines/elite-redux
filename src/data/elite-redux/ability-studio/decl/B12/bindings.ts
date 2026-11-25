/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B12 (spec 2.1): the library form of every Tier B gate of the classes declared here, keyed by
// (abilityId, attrIndex, "gate"). Every line was read by hand from the live attr (the dump of its fields in the running game, not
// the source text: the vanilla-rebalance patcher pushes some attrs after construction) and mapped to the atom that reads the SAME
// engine value. The L1 differential then compares the class's own `gate` with the library form over the state grid.
//
// Reading guide: "attr N" is the position in `ability.attrs`. Ability ids are numbers because this file may be loaded before the
// ability list is.
//
// Classes of chunk 1 and what they bind:
//   FaintCountTriggerAbAttr            gate  not side.is { self }
//   StatTriggerOnKoAbAttr              gate  empty group (any faint) for Forsaken Heart; legacy for the nine "credited with the knock out" users
//   StatTriggerOnHitAbAttr             gate  empty group, an `any` of move.type, or legacy (plain contact flag)
//   StatTriggerOnStatLoweredAbAttr     gate  stage.just-changed { lowered }
//   StatTriggerOnAllyStatLoweredAbAttr gate  stage.just-changed { lowered }
//   StatusCascadeAbAttr                gate  status.has { other, Poison }
//   PerFaintStatMultiplierAbAttr, StatTriggerOnEntryAbAttr: nothing to bind (no closure, no gate)
// Classes of chunk 5 (the four weather classes): every gate is a legacy-closure until the weather atom exists (R-B12-39), see the end of the file.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

type Site = readonly [abilityId: number, attrIndex: number, name: string];

function bindEach(spec: unknown, sites: readonly Site[]): void {
  for (const [abilityId, attrIndex] of sites) {
    bindCondition(abilityId, attrIndex, spec, "gate");
  }
}

function legacyEach(reason: string, sites: readonly Site[]): void {
  for (const [abilityId, attrIndex] of sites) {
    bindLegacyClosure(abilityId, attrIndex, reason, "gate");
  }
}

// =============================================================================================
// FaintCountTriggerAbAttr (1 attr). `victim.id !== pokemon.id`: the faint is not my own.
// =============================================================================================
bindEach({ not: { id: "side.is", kind: "self" } }, [[5589, 0, "Soul Harvest"]]);

// =============================================================================================
// StatTriggerOnKoAbAttr (10 attrs).
// =============================================================================================

// `triggerOnAnyFaint` true: the gate is `true` before any other clause. An empty group is always true.
bindEach({ all: [] }, [[5472, 0, "Forsaken Heart"]]);

// `victim !== pokemon && victim.turnData?.attacksReceived?.[0]?.sourceId === pokemon.id`. The first half is
// not(side.is self); the second half ("I am credited with the knock out") has no atom: request R-B12-01.
legacyEach(
  "needs an atom for 'I am the Pokemon credited with the knock out' (victim.turnData.attacksReceived[0].sourceId === holder.id); request R-B12-01",
  [
    [5003, 0, "Chilling Neigh"],
    [5185, 0, "Adrenaline Rush"],
    [5217, 0, "Super Strain"],
    [5262, 0, "Hubris"],
    [5301, 1, "Haunting Frenzy"],
    [5400, 0, "Dragon's Ritual"],
    [5559, 0, "Breezy Neigh"],
    [5630, 1, "Hydra"],
    [20022, 0, "As One"],
  ],
);

// =============================================================================================
// StatTriggerOnHitAbAttr (13 attrs). The class `guards` (hit landed) stays in the class; the gate is the filter.
// =============================================================================================

// `filter === null`: no limit, the gate is always true.
bindEach({ all: [] }, [
  [83, 1, "Anger Point"],
  [5211, 0, "Berserker Rage"],
  [5218, 0, "Tipping Point"],
  [5248, 0, "Fortitude"],
  [5256, 3, "Crowned Sword"],
  [5713, 1, "Petal Shield (second attr)"],
]);

// `filter.types = [FLYING, FIRE]`: `opponent.getMoveType(move)` is one of them (no flags list). move.type asks
// `moveUser.getMoveType(move)` and the moveUser of "after I am hit" is the attacker, the same Pokemon.
bindEach(
  {
    any: [
      { id: "move.type", type: "FLYING", effective: true },
      { id: "move.type", type: "FIRE", effective: true },
    ],
  },
  [
    [5028, 0, "Inflatable"],
    [5318, 0, "Balloon Bomb"],
    [5456, 0, "Balloon Blitz"],
  ],
);

// `filter.types = [ROCK]`
bindEach({ id: "move.type", type: "ROCK", effective: true }, [
  [5182, 0, "Furnace"],
  [5571, 0, "Ice Plumes"],
]);

// `filter.types = [WATER, ICE]`
bindEach(
  {
    any: [
      { id: "move.type", type: "WATER", effective: true },
      { id: "move.type", type: "ICE", effective: true },
    ],
  },
  [[5488, 0, "Cryo Architect"]],
);

// `filter.flags = [MAKES_CONTACT]`: `move.hasFlag(MAKES_CONTACT)`, the plain flag. The library move.flag atom asks
// doesFlagEffectApply, which is false for an attacker with Long Reach, for Punching Glove and for a substitute.
legacyEach(
  "reads the plain move flag move.hasFlag(MAKES_CONTACT); the library move.flag atom asks doesFlagEffectApply (Long Reach, Punching Glove, substitutes), a different answer; request R-B12-04",
  [[5199, 1, "Super Hot Goo"]],
);

// =============================================================================================
// StatTriggerOnStatLoweredAbAttr (13 attrs) and StatTriggerOnAllyStatLoweredAbAttr (6 attrs).
// Gate: `stages < 0` = stage.just-changed { lowered }. The residual `!selfTarget` stays in the class (R-B12-05).
// =============================================================================================
const LOWERED = { id: "stage.just-changed", direction: "lowered" };

bindEach(LOWERED, [
  // scope "self": +2 Speed, once per drop
  [50, 1, "Run Away"],
  [155, 4, "Rattled"],
  [193, 2, "Wimp Out"],
  [194, 2, "Emergency Exit"],
  [5165, 2, "Coward"],
  [5210, 1, "Dust Cloud"],
  [5282, 2, "Tactical Retreat"],
  // scope "side": once for each stat lowered
  [5145, 0, "King's Wrath"],
  [5146, 0, "Queen's Mourning"],
  [5664, 0, "Fire Ruler"],
  [5671, 0, "Emperor's Wrath (Attack and Defense)"],
  [5671, 2, "Emperor's Wrath (Sp. Atk and Sp. Def)"],
  [5939, 0, "Knight's Honor"],
  // the ally halves
  [5145, 1, "King's Wrath (ally half)"],
  [5146, 1, "Queen's Mourning (ally half)"],
  [5664, 1, "Fire Ruler (ally half)"],
  [5671, 1, "Emperor's Wrath (ally half, Attack and Defense)"],
  [5671, 3, "Emperor's Wrath (ally half, Sp. Atk and Sp. Def)"],
  [5939, 1, "Knight's Honor (ally half)"],
]);

// =============================================================================================
// StatusCascadeAbAttr (1 attr). `opponent.status?.effect === trigger` with trigger POISON.
// =============================================================================================
bindEach({ id: "status.has", who: "other", status: "POISON" }, [[5451, 0, "Neurotoxin"]]);

// =============================================================================================
// CHUNK 2. Classes of this chunk and what they bind:
//   StatusChanceMultiplierAbAttr            gate  legacy (no atom for "the move inflicts a status"; R-B12-11)
//   SuperEffectiveMultiplierBoostAbAttr     gate  move.effectiveness { gte 2 }
//   TimeLimitedEffectivenessFloorAbAttr     gate  time.turn-count { lte turns }, or legacy when a window must be open (R-B12-16)
//   ActivateOncePerBattleEntryWindowAbAttr  gate  legacy (the library once-per writes before this class's apply; R-B12-15)
//   StatusEffectImmunityAbAttrEr, IntimidateImmunityAbAttrEr, TargetHighestStatDropAbAttr: nothing to bind (no closure, no gate)
//   StatusMoveTypeImmunityBypassAbAttr: parked (decl/B12/pending), nothing to bind
// =============================================================================================

// StatusChanceMultiplierAbAttr (6 attrs). The gate is `move.getAttrs("StatusEffectAttr").some(a => a.effect === status)`, plus for
// FREEZE the frostbite battler-tag effect. Every user needs it and the library has no such atom.
legacyEach(
  "needs an atom for 'the move inflicts <status>' (a StatusEffectAttr of that status, for freeze also the frostbite tag effect); request R-B12-11",
  [
    [5008, 0, "Pyromancy"],
    [5187, 0, "Cryomancy"],
    [5564, 0, "Thermomancy (burn)"],
    [5564, 1, "Thermomancy (freeze)"],
    [5665, 2, "Chandelier"],
    [5682, 0, "Cryostasis"],
  ],
);

// SuperEffectiveMultiplierBoostAbAttr (5 attrs). `target.getMoveEffectiveness(user, move) >= 2` is the atom move.effectiveness
// (defender = the other Pokemon when the move user is the holder).
bindEach({ id: "move.effectiveness", cmp: "gte", n: 2 }, [
  [5224, 1, "Arcane Force"],
  [5294, 0, "Winged King"],
  [5295, 0, "Iron Serpent"],
  [5936, 1, "Brain Food"],
  [20000, 1, "Psychic Supremacy"],
]);

// TimeLimitedEffectivenessFloorAbAttr (2 attrs). Soothsayer has no window: the gate is `turnCount <= 3`. `n` is rewritten from the
// `turns` setting (gateParams), 3 is only its shipped value.
bindEach({ id: "time.turn-count", cmp: "lte", n: 3 }, [[5474, 0, "Soothsayer"]]);
legacyEach(
  "needs an atom for 'my named entry window is open' (tempSummonData.abilityEntryWindows.has(key)) next to the turn count; request R-B12-16",
  [[108, 2, "Forewarn (two-turn Soothsayer upgrade)"]],
);

// ActivateOncePerBattleEntryWindowAbAttr (1 attr). `!waveData.entryEffectsFired.has(key)` is time.once-per { wave, key }, but that atom
// writes the key BEFORE this class's apply runs and the apply returns early on a present key, so the window would never open (proved
// in test B12/chunk2.test.ts). Needs the library effect that opens the window or an atom whose write waits; request R-B12-15.
legacyEach(
  "time.once-per {wave} would write the key before this class's apply runs, and apply then returns early without opening the window; needs the window effect or a deferred-write memory; request R-B12-15",
  [[108, 1, "Forewarn (opens the window)"]],
);

// =============================================================================================
// Chunk 3. Every gate below was read from the live attr (the dump of its fields in the running game) and mapped to the atom that reads the SAME
// engine value. Classes of chunk 3 and what they bind:
//   ToxicTerrainSelfPoisonOnSummonAbAttr / OnTerrainChangeAbAttr  gate  legacy: 'Toxic Terrain is set' read from the terrain object (R-B12-20)
//   TrapDurationModifierAbAttr          gate  any[ move.is-move ... ] (the trapping moves, or the configured subset)
//   TypeConversionAbAttr                gate  move.type { effective: false } for a type source, legacy for a property source (R-B12-04)
//   TypeConversionPowerBoostAbAttr      gate  the same filter as the conversion next to it
//   TypeDamageBoostAbAttr               gate  move.type { effective: true }
//   TypeRecoilAbAttr                    gate  all[ move.damaging, move.type { effective: true } ]
//   TurnDecayDamageMultiplierAbAttr     nothing to bind (the parent's 'always true' closure is built inside the constructor)
// =============================================================================================

const typeIs = (type: string, effective: boolean): unknown => ({ id: "move.type", type, effective });

// ---------------------------------------------------------------------------------------------
// ToxicTerrainSelfPoisonOnSummonAbAttr (1 attr) and ToxicTerrainSelfPoisonOnTerrainChangeAbAttr (1 attr): Toxic Boost.
// ---------------------------------------------------------------------------------------------
legacyEach(
  "needs an atom for 'Toxic Terrain is set on the field' read from the terrain object (arena.terrain?.terrainType === TOXIC; field.terrain reads arena.terrainType, which Clueless turns into NONE); request R-B12-20",
  [
    [137, 2, "Toxic Boost (on entry)"],
    [137, 3, "Toxic Boost (terrain change)"],
  ],
);

// ---------------------------------------------------------------------------------------------
// TrapDurationModifierAbAttr (3 attrs). `TRAPPING_MOVES.has(move.id) && (moveIds === undefined || moveIds.includes(move.id))`.
// ---------------------------------------------------------------------------------------------
const TRAPPING_MOVE_NAMES = [
  "BIND",
  "WRAP",
  "FIRE_SPIN",
  "WHIRLPOOL",
  "SAND_TOMB",
  "MAGMA_STORM",
  "INFESTATION",
  "CLAMP",
  "THUNDER_CAGE",
  "SNAP_TRAP",
];
// No subset: every trapping move.
bindEach({ any: TRAPPING_MOVE_NAMES.map(moveId => ({ id: "move.is-move", moveId })) }, [
  [5519, 0, "Tentalock"],
  [5649, 1, "Tangled Tails"],
]);
// moveIds [FIRE_SPIN]: the trapping moves that are also in the subset, which is Fire Spin alone.
bindEach({ any: [{ id: "move.is-move", moveId: "FIRE_SPIN" }] }, [[5420, 1, "Wildfire"]]);

// ---------------------------------------------------------------------------------------------
// TypeConversionAbAttr (39 attrs): `matchesSource(source, user, move)`. A type source reads `move.type === source.type` (the move's base type,
// the atom with effective false). A property source reads `move.hasFlag(flag)` (the plain bit) AND, when named, the base type.
// ---------------------------------------------------------------------------------------------
const SOURCE_FLAG_REASON =
  "the source is a move property (move.hasFlag on the plain flag bit, not doesFlagEffectApply, which also counts abilities that grant a property); needs the atom move.has-built-in-flag, request R-B12-04";

// Source type Normal.
bindEach(typeIs("NORMAL", false), [
  [5017, 0, "Immolate"],
  [5038, 0, "Fighting Spirit"],
  [5046, 0, "Tectonize"],
  [5063, 0, "Intoxicate"],
  [5104, 1, "Solar Flare"],
  [5118, 0, "Pollinate"],
  [5124, 0, "Spectral Shroud"],
  [5140, 0, "Mineralize"],
  [5149, 0, "Draconize"],
  [5190, 0, "Emanate"],
  [5219, 0, "Enlightened"],
  [5237, 0, "Fertilize"],
  [5351, 2, "Unicorn"],
  [5404, 2, "Steel Beetle"],
  [5428, 0, "Sludgy Mix"],
  [5457, 1, "Twinkle Toes"],
  [5463, 2, "Qigong"],
  [5542, 0, "Draconic Might"],
  [5552, 0, "Komodo"],
  [5557, 0, "Molten Coat"],
  [5619, 0, "Dragonfruit"],
  [5621, 1, "Lead Claws"],
  [5730, 1, "Warrior's Spear"],
  [5940, 0, "Brainpower"],
  [5956, 0, "Dragonfruit (second id)"],
  [5957, 0, "Komodo (second id)"],
  [6036, 2, "Nucleus"],
  [6108, 0, "Blaze Release"],
  [20008, 3, "Heartless Style"],
]);
// Other source types.
bindEach(typeIs("ROCK", false), [
  [5018, 0, "Crystallize"],
  [6111, 0, "Bejeweled"],
]);
bindEach(typeIs("STEEL", false), [[5363, 0, "Superconductor"]]);
bindEach(typeIs("FLYING", false), [[5639, 0, "Cosmic Wings"]]);
// Property sources (Sound moves that are Normal; Drill moves that are Normal).
legacyEach(SOURCE_FLAG_REASON, [
  [5012, 0, "Sand Song"],
  [5268, 0, "Banshee"],
  [5328, 0, "Snow Song"],
  [5361, 0, "Power Metal"],
  [5959, 0, "Grievous Spear"],
  [5964, 0, "Grim Jab"],
]);

// ---------------------------------------------------------------------------------------------
// TypeConversionPowerBoostAbAttr (10 attrs): the same `matchesSource` filter, boosting power.
// ---------------------------------------------------------------------------------------------
bindEach(typeIs("ROCK", false), [
  [5018, 1, "Crystallize"],
  [6111, 1, "Bejeweled"],
]);
bindEach(typeIs("STEEL", false), [[5363, 1, "Superconductor"]]);
bindEach(typeIs("NORMAL", false), [[5124, 1, "Spectral Shroud"]]);
legacyEach(SOURCE_FLAG_REASON, [
  [5012, 1, "Sand Song"],
  [5268, 1, "Banshee"],
  [5328, 1, "Snow Song"],
  [5361, 1, "Power Metal"],
  [5959, 1, "Grievous Spear"],
  [5964, 1, "Grim Jab"],
]);

// ---------------------------------------------------------------------------------------------
// TypeDamageBoostAbAttr (63 attrs): `typeBoostApplies`, the move's type after other abilities changed it (`user.getMoveType(move) === type`);
// no user sets `weathers`, so the weather clause is not part of any gate. The type is moved by the declaration's gateParams.
// ---------------------------------------------------------------------------------------------
bindEach(typeIs("ICE", true), [
  [174, 2, "Refrigerate"],
  [5016, 0, "Antarctic Bird"],
  [5465, 1, "Deep Freeze"],
  [5642, 0, "Devious Present"],
]);
bindEach(typeIs("FAIRY", true), [
  [182, 2, "Pixilate"],
  [5954, 2, "Pixilate (second id)"],
  [20007, 2, "Fae Heart"],
]);
bindEach(typeIs("FLYING", true), [
  [184, 2, "Aerilate"],
  [184, 3, "Aerilate (second boost)"],
  [5016, 1, "Antarctic Bird"],
  [5097, 0, "Flock"],
  [5313, 2, "Aerialist"],
  [5391, 3, "Imposing Wings"],
  [5544, 3, "Fey Flight"],
  [6019, 2, "Fluttering Spirit"],
  [6019, 3, "Fluttering Spirit (second boost)"],
]);
bindEach(typeIs("STEEL", true), [
  [200, 3, "Steelworker"],
  [5385, 1, "Atomic Punch"],
  [5530, 2, "Stainless Steel"],
  [5584, 1, "Warmonger"],
  [5938, 3, "Weighted Scales"],
  [5995, 4, "Crude Steel"],
  [6003, 2, "Stainless Steel (second id)"],
  [6028, 6, "Solar Panel"],
]);
bindEach(typeIs("ELECTRIC", true), [
  [206, 2, "Galvanize"],
  [5019, 0, "Electrocytes"],
  [5060, 0, "Short Circuit"],
  [5074, 0, "Electric Burst"],
  [5152, 3, "Atomic Burst"],
  [5159, 0, "Hydro Circuit"],
  [5197, 1, "Plasma Lamp"],
  [5486, 4, "Two-Faced"],
  [5948, 0, "Short Circuit (second id)"],
  [20005, 4, "Thunder Gods Vessel"],
  [20006, 4, "Malicious Empathy"],
]);
bindEach(typeIs("WATER", true), [
  [5016, 2, "Antarctic Bird"],
  [5154, 0, "Riptide"],
  [5416, 0, "Aquatic Dweller"],
  [5465, 0, "Deep Freeze"],
  [5536, 0, "Atlantic Ruler"],
  [5717, 1, "3 > 1"],
]);
bindEach(typeIs("DARK", true), [
  [5044, 0, "Nocturnal"],
  [5458, 0, "Doom Blast"],
  [5486, 5, "Two-Faced"],
  [5726, 1, "Reaper's Embarce"],
  [5727, 0, "Foul Energy"],
]);
bindEach(typeIs("PSYCHIC", true), [
  [5081, 0, "Psychic Mind"],
  [5724, 0, "Overwhelming Mind"],
]);
bindEach(typeIs("GRASS", true), [
  [5155, 0, "Forest Rage"],
  [5733, 0, "Smoldering Wood"],
]);
bindEach(typeIs("FIRE", true), [
  [5153, 0, "Hellblaze"],
  [5168, 0, "Infernal Rage"],
  [5197, 0, "Plasma Lamp"],
  [5241, 0, "Combustion"],
]);
bindEach(typeIs("GHOST", true), [[5189, 0, "Purgatory"]]);
bindEach(typeIs("FIGHTING", true), [
  [5239, 0, "Fighter"],
  [5471, 0, "Gladiator"],
  [5584, 2, "Warmonger"],
]);
bindEach(typeIs("GROUND", true), [[5167, 1, "Dune Terror"]]);
bindEach(typeIs("ROCK", true), [
  [5321, 0, "Rockhard Will"],
  [5500, 0, "We Will Rock You"],
  [5582, 0, "Stonecutter"],
  [5584, 0, "Warmonger"],
]);

// ---------------------------------------------------------------------------------------------
// TypeRecoilAbAttr (5 attrs): `super.canApply` (the move is not a Status move) and then `user.getMoveType(move) === type`, in that order.
// ---------------------------------------------------------------------------------------------
const recoilGate = (type: string): unknown => ({ all: [{ id: "move.damaging" }, typeIs(type, true)] });
bindEach(recoilGate("ELECTRIC"), [
  [5074, 1, "Electric Burst"],
  [5486, 6, "Two-Faced"],
]);
bindEach(recoilGate("FIRE"), [[5168, 1, "Infernal Rage"]]);
bindEach(recoilGate("DARK"), [
  [5458, 1, "Doom Blast"],
  [5486, 7, "Two-Faced"],
]);

// =============================================================================================
// Chunk 4: the type-gated archetype classes. Every gate is read from the live attr (the dump showed the fields), in the original clause order.
//
//   OffensiveTypeMultiplierAbAttr          gate  mon.has-type { other }: `opponent.isOfType(type)` (the other Pokemon of "while the game calculates a move's power" is the foe)
//   TypeFilteredEffectChanceMultiplierAbAttr gate move.type { effective }   (legacy until R-B12-30)
//   TypeGatedStatTriggerOnAttackAbAttr     gate  move.type { effective }: `pokemon.getMoveType(move) === type`
//   TypedImmunityWithArenaTagAbAttr        gate  move.damaging                (legacy until R-B12-30)
//   UserFieldFlagImmunityAbAttr            gate  move.flag { flag }: `move.doesFlagEffectApply({ flag, user: attacker, target: pokemon })`
//   WakeStatBoostAbAttr                    gate  legacy (the flag atom, R-B12-33)
//   WeatherBasedMoveBlockAbAttr            gate  any of 15 move.is-move
//   TypeImmunityHighestAttackStatStageAbAttr: nothing to bind (no closure, no gate)
// =============================================================================================
const defenderIs = (type: string): unknown => ({ id: "mon.has-type", who: "other", type });
bindEach(defenderIs("DRAGON"), [[5051, 0, "Dragonslayer"]]);
bindEach(defenderIs("FAIRY"), [[5178, 0, "Fae Hunter"]]);
bindEach(defenderIs("GRASS"), [
  [5181, 0, "Lumberjack"],
  [5729, 1, "King of the Jungle"],
]);
bindEach(defenderIs("DARK"), [[5255, 0, "Monster Hunter"]]);
bindEach(defenderIs("FIRE"), [[5505, 0, "Firefighter"]]);

legacyEach(
  "Corrupted Mind: the gate is move.type { PSYCHIC, effective } but the effect-chance moment gives the library no move user (WHEN_MOVE_USER has no entry for calc.effect-chance), so the atom reads false; needs that entry (request R-B12-30)",
  [[5475, 1, "Corrupted Mind"]],
);

bindEach({ id: "move.type", type: "FIGHTING", effective: true }, [
  [5142, 0, "Spinning Top"],
  [20021, 0, "Spin To Win"],
]);

legacyEach(
  "Evaporate: the gate is move.damaging (the attack-move test), but the type-immunity moment gives the library no move user (WHEN_MOVE_USER has no entry for calc.move-immunity), so the atom reads false for every move; needs that entry (request R-B12-30)",
  [[5180, 0, "Evaporate"]],
);

bindEach({ id: "move.flag", flag: "SOUND_BASED" }, [[5302, 0, "Noise Cancel"]]);

legacyEach(
  "Rude Awakening wake-up boost: the gate reads battleData.rudeAwakeningTriggered, which the library once-per atom (its own WeakMap) neither reads nor writes; needs an atom that reads this named battle flag (request R-B12-33)",
  [[5440, 1, "Rude Awakening"]],
);

// The 15 weather-based moves of the class (a curated copy of the dex list), in the class's own order.
const WEATHER_MOVES = [
  "WEATHER_BALL",
  "SOLAR_BEAM",
  "SOLAR_BLADE",
  "HURRICANE",
  "THUNDER",
  "BLIZZARD",
  "SILVER_WIND",
  "WILDBOLT_STORM",
  "BLEAKWIND_STORM",
  "SANDSEAR_STORM",
  "SPRINGTIDE_STORM",
  "SHEER_COLD",
  "FIRE_PLEDGE",
  "WATER_PLEDGE",
  "GRASS_PLEDGE",
];
bindEach({ any: WEATHER_MOVES.map(moveId => ({ id: "move.is-move", moveId })) }, [
  [5092, 0, "Weather Control"],
  [5540, 1, "Neutralizing Fog"],
]);

// =============================================================================================
// Chunk 5: the four weather classes. Every gate is a legacy-closure today: the weather test is "one of the listed weathers is on AND
// the weather's effects are not switched off (Cloud Nine / Air Lock)", and the library's `field.weather` is `arena.weatherType === X`,
// which has no suppression test and takes one weather. Binding it would change behaviour under Cloud Nine (request R-B12-39).
// Nothing here is bound to a lookalike: a legacy-closure keeps the class's own gate running unchanged.
//   WeatherStatMultiplierAbAttr   5 attrs  gate legacy (the stat test is the class's own `guards`)
//   WeatherTypeBoostAbAttr        2 attrs  gate legacy (the move-type half maps to `move.type { effective }`, the weather half does not)
//   WeatherDamageReductionAbAttr  2 attrs  gate legacy
//   WeatherGroundAirborneAbAttr   1 attr   gate legacy (Desert Spirit 5311 attr 1)
// =============================================================================================
const WEATHER_GATE_REASON =
  "needs an atom for 'one of these weathers is on and its effects are not switched off' (arena.weather?.isEffectSuppressed() is false and arena.weatherType is in the list); field.weather takes one weather and has no suppression test; request R-B12-39";

legacyEach(WEATHER_GATE_REASON, [
  [5563, 0, "Thermal Slide (Speed x1.5 in Sun, Extremely harsh sunlight, Hail, Snow)"],
  [5331, 0, "Ethereal Rush (Speed x1.5 in Fog, Eerie fog)"],
  [5503, 0, "Rite Of Spring (Speed x1.5 in Sun, Extremely harsh sunlight)"],
  [5359, 0, "Smokey Maneuvers (Evasion x4/3 in Fog, Eerie fog)"],
  [5719, 0, "Abominable Monster (Sp. Def x1.5 in Hail, Snow)"],
]);

legacyEach(
  `${WEATHER_GATE_REASON}; the move-type half of this gate is move.type { effective: true } and the final binding is all [move.type, weather atom]`,
  [
    [5296, 0, "Catastrophe attr 0 (Rock moves x1.5 in Hail, Snow)"],
    [5296, 1, "Catastrophe attr 1 (Ice moves x1.5 in a Sandstorm)"],
  ],
);

legacyEach(WEATHER_GATE_REASON, [
  [5021, 0, "Christmas Spirit (x0.5 damage taken in Hail, Snow)"],
  [5167, 0, "Dune Terror (x0.65 damage taken in a Sandstorm)"],
]);

// WeatherGroundAirborneAbAttr (1 attr, declaration activated by the merge captain): the same weather gate as the four classes above.
legacyEach(WEATHER_GATE_REASON, [[5311, 1, "Desert Spirit (my Ground moves hit airborne Pokemon in a Sandstorm)"]]);
