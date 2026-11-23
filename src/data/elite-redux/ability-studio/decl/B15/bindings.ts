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
