/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1 bindings: the library form of every constructor closure of the classes in this chunk, keyed by (abilityId, attrIndex).
// "attr N" is the position in `ability.attrs`, so Bodhisattva (a composite of Hand Barnacles and Brain Over Brawn) has the two Brain Over Brawn attrs at 2 and 3.
//
// Every line was read by hand from the live attr (closure source dumped from the real instance) and mapped to the atom that calls the SAME predicate.
// BadSplice, Swirlify, Rapier, the two Borrowed Time halves and Chivalry have no closure, so they need no binding.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// BrainOverBrawnTypeAbAttr, ctor:1, the closure `(_pokemon, _target, move) => move.type === PokemonType.FIGHTING`.
// move.type with `effective: false` is the move's own printed type (`move.type`); the default `true` asks getMoveType, which would dispatch the type attr again.
const NATIVE_FIGHTING_MOVE = { id: "move.type", type: "FIGHTING", effective: false };
bindCondition(6076, 2, NATIVE_FIGHTING_MOVE, "ctor:1"); // Bodhisattva, type conversion
bindCondition(6080, 0, NATIVE_FIGHTING_MOVE, "ctor:1"); // Brain Over Brawn, type conversion

// BrainOverBrawnPowerAbAttr, ctor:0, the same closure (the x1.2 power rider).
bindCondition(6076, 3, NATIVE_FIGHTING_MOVE, "ctor:0"); // Bodhisattva, power rider
bindCondition(6080, 1, NATIVE_FIGHTING_MOVE, "ctor:0"); // Brain Over Brawn, power rider

// =============================================================================================
// B15 chunk 2. Tier B gates (slot "gate"), keyed by (abilityId, attrIndex). The other classes of this chunk have no constructor closure.
// =============================================================================================

// GenesisSupernovaAbAttr, gate, in the ORIGINAL clause order:
//   source.getBattlerIndex() === pokemon.getBattlerIndex() && source.getMoveType(move.getMove()) === PokemonType.PSYCHIC
// side.is{self}: the Pokemon that used the move (frame.other for this WHEN) is the holder. move.type with effective true asks
// moveUser.getMoveType(move), the same call as the class (moveUser is the user of the move for event.after-any-move).
bindCondition(
  5937, // Genesis Supernova
  0,
  {
    all: [
      { id: "side.is", kind: "self" },
      { id: "move.type", type: "PSYCHIC", effective: true },
    ],
  },
  "gate",
);

// DandelionBurstAbAttr, gate: the crossing clause only (the fainted check and the once-per memory are guards() in the class, the living-foe test is the residual):
//   pokemon.hp <= max * 0.5 && pokemon.hp + damage > max * 0.5
// hp.crossed-below with floor-half: t = floor(max * ratio); hp <= t && hp + damage > t. For integer hp this is the same truth value as the float test.
bindCondition(5907, 0, { id: "hp.crossed-below", who: "holder", ratio: 0.5, rounding: "floor-half" }, "gate"); // Dandelion Burst

// CrosscutSecondStrikeAbAttr and CrosscutPowerAbAttr, gate. The clause "the move has the slicing or the pulse flag" is `move.hasFlag(...)` on the move's PRINTED flags.
// The library atom move.flag calls Move.doesFlagEffectApply, which also answers true for flags that an ability injects (Rapier and the other flag
// injectors), so it is a different predicate and is not used. Request R-B15-6 asks for a printed-flag atom.
const CROSSCUT_LEGACY_REASON =
  "The gate tests the move's printed slicing or pulse flag (move.hasFlag); the library atom move.flag uses doesFlagEffectApply, which counts ability-injected flags too. Needs a printed-flag atom (R-B15-6).";
bindLegacyClosure(5908, 0, CROSSCUT_LEGACY_REASON, "gate"); // Crosscut, second strike
bindLegacyClosure(5908, 1, CROSSCUT_LEGACY_REASON, "gate"); // Crosscut, power rider

// =============================================================================================
// B15 chunk 3. Tier B gates (slot "gate"), keyed by (abilityId, attrIndex). The other classes of this chunk (Hydrapex, Last Host, Library,
// Life Preserver, Mycelial Network, Omniform) have no constructor closure and no gate, so they need no binding.
// =============================================================================================

// PostTurnHurtNonTypedAbAttr, gate, the weather clause: `requiredWeathers === null || requiredWeathers.includes(globalScene.arena.weatherType)`.
// field.weather is `arena.weatherType === WeatherType[weather]`, the same cached value; a list of weathers is any[...]. Without a weather list the clause is always true, spelled { all: [] }.
// The target loop (at least one valid, non-spared target) is the residual and stays in the class.
const NO_WEATHER_NEEDED = { all: [] };
bindCondition(5314, 0, NO_WEATHER_NEEDED, "gate"); // Parasitic Spores
bindCondition(5367, 0, NO_WEATHER_NEEDED, "gate"); // Funeral Pyre
bindCondition(5427, 2, NO_WEATHER_NEEDED, "gate"); // Trash Heap
bindCondition(5476, 0, NO_WEATHER_NEEDED, "gate"); // Flame Coat
bindCondition(5575, 0, NO_WEATHER_NEEDED, "gate"); // Winter Throne
bindCondition(5945, 0, NO_WEATHER_NEEDED, "gate"); // Decomposer
bindCondition(
  5643, // Christmas Nightmare: requiredWeathers [HAIL, SNOW]
  0,
  {
    any: [
      { id: "field.weather", weather: "HAIL" },
      { id: "field.weather", weather: "SNOW" },
    ],
  },
  "gate",
);

// PpReductionOnContactAbAttr, gate, the contact clause: `contactRequired && !move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })` -> false.
// move.flag calls the same Move.doesFlagEffectApply with moveUser = the attacker and the holder as target. The "hit connected" clause (hitResult < NO_EFFECT) is guards() in the class and the
// "attacker has the move" clause is the residual.
bindCondition(5247, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate"); // Spiteful

// =============================================================================================
// B15 chunk 4. Gates (slot "gate") and one constructor closure (slot "ctor:0"), keyed by (abilityId, attrIndex). QuickeningGraceAbAttr has no
// closure and no gate (presence marker read by an engine seam), so it needs no binding.
// =============================================================================================

// SetArenaTagOnHitAbAttr, gate, the contact clause: `!contactRequired || move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })`.
// move.flag calls the same Move.doesFlagEffectApply with moveUser = the attacker and the holder as target. A user without the contact requirement is the always-true gate { all: [] }.
// The "hit connected" clause (hitResult < NO_EFFECT) is guards() in the class.
const CONTACT_ONLY = { id: "move.flag", flag: "MAKES_CONTACT" };
bindCondition(5137, 0, CONTACT_ONLY, "gate"); // Scrapyard, Spikes
bindCondition(5138, 0, CONTACT_ONLY, "gate"); // Loose Quills, Spikes
bindCondition(5141, 0, CONTACT_ONLY, "gate"); // Loose Rocks, Stealth Rock
bindCondition(5607, 0, { all: [] }, "gate"); // Drop Blocks, Spikes on any damaging hit (contactRequired false)
bindCondition(5611, 0, CONTACT_ONLY, "gate"); // Loose Thorns, Creeping Thorns
bindCondition(5698, 2, CONTACT_ONLY, "gate"); // Shattered Armor, Spikes (attr 2: Block Crit and the damage reduction come first)

// PuppetStringsAbAttr, gate, in the ORIGINAL order of the three design clauses (the safety rules are guards() and the once-per-switch-in test is the residual):
//   A. the default attackCondition: move.category !== STATUS                      -> move.damaging
//   C. holder.getMoveType(move) === PokemonType.PSYCHIC                           -> move.type PSYCHIC, effective (moveUser.getMoveType(move); moveUser is the holder for this WHEN)
//   D. target.status?.effect is POISON or TOXIC                                    -> status.has on the other Pokemon (the target), either of the two
bindCondition(
  5901, // Puppet Strings
  0,
  {
    all: [
      { id: "move.damaging" },
      { id: "move.type", type: "PSYCHIC", effective: true },
      {
        any: [
          { id: "status.has", who: "other", status: "POISON" },
          { id: "status.has", who: "other", status: "TOXIC" },
        ],
      },
    ],
  },
  "gate",
);

// PressureVesselAbAttr, gate: `stat === Stat.DEF || stat === Stat.SPDEF`. No atom reads the stat slot (R-B15-28).
bindLegacyClosure(
  5914, // Pressure Vessel
  0,
  "The gate tests which stat is being calculated (Defense or Sp. Def); no library atom reads the stat slot yet. Needs 'The stat being calculated is {stat}' (R-B15-28).",
  "gate",
);

// RainPumpAbAttr, gate: isRainingNow() = arena.weather exists, !weather.isEffectSuppressed(), weatherType is RAIN or HEAVY_RAIN.
// field.weather reads arena.weatherType, which ignores suppression (Cloud Nine, Air Lock), so it is a different predicate.
bindLegacyClosure(
  5915, // Rain Pump
  0,
  "The gate also asks weather.isEffectSuppressed() before reading the type; the library atom field.weather ignores suppression, so it is not the same predicate. Needs a 'weather is being cancelled' atom (R-B15-32).",
  "gate",
);

// RelativityDefenseReductionAbAttr, ctor:0, the closure `(holder, attacker, _move) => pokemonActedBefore(attacker, holder)`.
bindLegacyClosure(
  5911, // Relativity, the damage reduction (attr 1; attr 0 is the offence marker)
  1,
  "The closure reads the per-turn move order list (getLastTurnOrder) to see whether the attacker moved before the holder; time.acted reads one Pokemon's acted flag, which is a different predicate. Needs 'moved before' (R-B15-36).",
  "ctor:0",
);

// RelativityAbAttr, gate: pokemonActedBefore(source, target), the per-turn move order list (getLastTurnOrder). The library atom time.acted reads one Pokemon's acted flag, not the order list.
bindLegacyClosure(
  5911, // Relativity, the stat substitution (attr 0)
  0,
  "The gate tests whether the holder moved before the target by the per-turn move order list (getLastTurnOrder); time.acted reads one Pokemon's acted flag, a different predicate. Needs 'moved before' (R-B15-36).",
  "gate",
);

// RendezvousAbAttr, gate: allyHitTargetThisTurn(partner, target), the turn attack ledger. No library atom reads that ledger (R-B15-37).
bindLegacyClosure(
  5919, // Rendezvous
  0,
  "The gate tests whether my linked ally already hit this target this turn, read from the turn attack ledger; no library atom reads that ledger yet. Needs 'My linked ally already hit this target this turn' (R-B15-37).",
  "gate",
);

// =============================================================================================
// B15 chunk 5. Tier B gates (slot "gate"), keyed by (abilityId, attrIndex). The other classes of this chunk (Shattered Psyche, Silken Decree, Soulmate, Tangled Seed) have no closure.
// =============================================================================================

// SetTerrainOnHitAbAttr, gate, the contact clause: `!contactRequired || move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })`.
// Both live users have contactRequired false, so the clause is the always-true gate { all: [] }. The "hit connected" clause (hitResult < NO_EFFECT) is guards() in the class.
bindCondition(5599, 0, { all: [] }, "gate"); // Power Leak, Electric Terrain on any damaging hit
bindCondition(5655, 0, { all: [] }, "gate"); // Brain Overload, Psychic Terrain on any damaging hit

// StatBoostOnFlagAttackAbAttr, gate, in the ORIGINAL order: A. the default attackCondition move.category !== STATUS -> move.damaging,
// B. move.doesFlagEffectApply({ flag, user: holder, target: other }) -> move.flag (the same call; for after-my-hit the moveUser is the holder and the target is the other Pokemon).
// No guard and no residual in this class.
const damagingMoveWithProperty = (flag: string): unknown => ({
  all: [{ id: "move.damaging" }, { id: "move.flag", flag }],
});
bindCondition(5027, 0, damagingMoveWithProperty("BITING_MOVE"), "gate"); // Growing Tooth, Attack +1
bindCondition(5129, 0, damagingMoveWithProperty("HORN_BASED"), "gate"); // Hardened Sheath, Attack +1
bindCondition(5709, 1, damagingMoveWithProperty("RECKLESS_MOVE"), "gate"); // Daredevil (attr 1; attr 0 is another class), Attack +1

// StatDebuffOnFlagAttackAbAttr, gate, in the ORIGINAL order of the replaceable clauses (the two safety rules, hit connected and first strike only, are guards() and run first;
// all the reads in front of the draw are pure, so moving them changes no answer):
//   A. the default attackCondition move.category !== STATUS                         -> move.damaging
//   D. move.doesFlagEffectApply({ flag, user: holder, target: other })              -> move.flag
//   E. chance >= 100 || holder.randBattleSeedInt(100) < chance                      -> rng.chance pct, LAST (no draw when pct is 100, the same as the class)
const damagingMoveWithPropertyAndChance = (flag: string, pct: number): unknown => ({
  all: [{ id: "move.damaging" }, { id: "move.flag", flag }, { id: "rng.chance", pct }],
});
bindCondition(5347, 0, damagingMoveWithPropertyAndChance("HAMMER_BASED", 100), "gate"); // Denting Blows, Defense -1
bindCondition(5623, 0, damagingMoveWithPropertyAndChance("SLICING_MOVE", 100), "gate"); // Chainsaw, Defense -1
bindCondition(5677, 1, damagingMoveWithPropertyAndChance("BITING_MOVE", 50), "gate"); // Crushing Jaw (attr 1), Defense -1, 50% chance
bindCondition(6043, 0, damagingMoveWithPropertyAndChance("DRILL_BASED", 100), "gate"); // Augur, Defense -1
bindCondition(6105, 0, damagingMoveWithPropertyAndChance("ARROW_BASED", 100), "gate"); // Crossbow, Defense -1

// StatChangeOnCategoryAttackAbAttr, gate, in the ORIGINAL order: A. the default attackCondition -> move.damaging, B. move.category === category -> move.category.
bindCondition(
  5425, // Whiplash, Physical moves lower the target's Defense
  0,
  { all: [{ id: "move.damaging" }, { id: "move.category", category: "PHYSICAL" }] },
  "gate",
);
