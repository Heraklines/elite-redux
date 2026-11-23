/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B05 (chunks 1 and 2 of 4), keyed by (abilityId, attrIndex). Written by hand from the live attrs.
//
// Chunk 1: only SetMoveAccuracyAbAttr has a gate; the seven other classes are presence flags (no closure, no gate), so they need
// no binding. Chunk 2 (further down): condition closures and gates of the crit, block and priority classes.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// SetMoveAccuracyAbAttr (Tier B). Slot "gate": the original first clause `moveIds.includes(move.id)`.
// All three users list exactly one move, so the gate is the single atom "the move is X". The other two clauses
// (`accuracy !== -1`, `accuracy < value`) are the residual and stay in the class.
// =============================================================================================
bindCondition(5065, 0, { id: "move.is-move", moveId: "HYPNOSIS" }, "gate"); // Hypnotist, [HYPNOSIS], 90
bindCondition(5103, 2, { id: "move.is-move", moveId: "HYPNOSIS" }, "gate"); // Lunar Eclipse, [HYPNOSIS], 90
bindCondition(5487, 0, { id: "move.is-move", moveId: "SING" }, "gate"); // Lullaby, [SING], 90

// =============================================================================================
// Chunk 2 of 4. Written by hand from the live attrs (the dump printed every closure and field).
// =============================================================================================

// ---------------------------------------------------------------------------------------------
// ConditionalCritAbAttr (Tier A). Slot ctor:0, a PokemonAttackCondition (user, target, move); the holder is the user, "other"
// is the target. Unlisted users: none (all 16 attrs below).
// ---------------------------------------------------------------------------------------------

// `user.tempSummonData.waveTurnCount === 1`
bindCondition(5171, 0, { id: "time.first-turn" }); // Ambush
bindCondition(5270, 0, { id: "time.first-turn" }); // Showdown Mode
bindCondition(5482, 0, { id: "time.first-turn" }); // Hunter's Mark
bindCondition(20002, 0, { id: "time.first-turn" }); // Ultra Recon Hunter

// `move.id === MoveId.SPACIAL_REND` (460)
bindCondition(5230, 1, { id: "move.is-move", moveId: "SPACIAL_REND" }); // Heaven Asunder

// `target.getMoveEffectiveness(user, move) > 1` (the three spellings of the null check, `target != null`, `!!target` and
// `target != null && user != null`, make no difference: the engine always passes both)
const SUPER_EFFECTIVE = { id: "move.effectiveness", cmp: "gt", n: 1 };
bindCondition(5078, 1, SUPER_EFFECTIVE); // Fatal Precision
bindCondition(5078, 3, SUPER_EFFECTIVE); // Fatal Precision (second copy of the same rule)
bindCondition(5388, 2, SUPER_EFFECTIVE); // Final Blow
bindCondition(5622, 2, SUPER_EFFECTIVE); // Flawless Precision
bindCondition(20008, 8, SUPER_EFFECTIVE); // Heartless Style
bindCondition(20008, 10, SUPER_EFFECTIVE); // Heartless Style (second copy of the same rule)

// the target is poisoned (1), badly poisoned (2) or paralysed (3), OR has the ER_BLEED tag, OR its Speed stage is below 0:
// `target.status?.effect in {1,2,3} || target.getTag("ER_BLEED") != null || target.getStatStage(Stat.SPD) < 0`; no target = false.
const FOE_IS_HURT = {
  any: [
    { id: "status.has", who: "other", status: "POISON" },
    { id: "status.has", who: "other", status: "TOXIC" },
    { id: "status.has", who: "other", status: "PARALYSIS" },
    { id: "tag.has", who: "other", tag: "ER_BLEED" },
    { id: "stage.compare", who: "other", stat: "SPD", cmp: "lt", n: 0 },
  ],
};
bindCondition(196, 0, FOE_IS_HURT); // Merciless
bindCondition(5419, 0, FOE_IS_HURT); // Depravity
bindCondition(5473, 1, FOE_IS_HURT); // Relentless

bindLegacyClosure(
  5436,
  1,
  "Ape Shift: pokemon.getHpRatio() < .5 uses the HP ratio ROUNDED to two decimals (true below 49.5% HP); hp.at-most/at-least compare exact integers, so no existing atom gives the same answer (request R-B05-12)",
); // Ape Shift

// ---------------------------------------------------------------------------------------------
// BlockStatusDamageAbAttr (Tier B). Slot "gate": `!!pokemon.status?.effect && effects.includes(status.effect)`. `!cancelled.value`
// stays in the class as its first clause (guards). The lists are POISON = 1, TOXIC = 2, BURN = 6 read from the live attrs.
// ---------------------------------------------------------------------------------------------
const POISONED_OR_TOXIC = {
  any: [
    { id: "status.has", who: "holder", status: "POISON" },
    { id: "status.has", who: "holder", status: "TOXIC" },
  ],
};
const POISONED_TOXIC_OR_BURNED = {
  any: [
    { id: "status.has", who: "holder", status: "POISON" },
    { id: "status.has", who: "holder", status: "TOXIC" },
    { id: "status.has", who: "holder", status: "BURN" },
  ],
};
const BURNED = { id: "status.has", who: "holder", status: "BURN" };
bindCondition(63, 1, POISONED_TOXIC_OR_BURNED, "gate"); // Marvel Scale, [POISON, TOXIC, BURN]
bindCondition(90, 1, POISONED_OR_TOXIC, "gate"); // Poison Heal, [TOXIC, POISON]
bindCondition(137, 1, POISONED_OR_TOXIC, "gate"); // Toxic Boost, [POISON, TOXIC]
bindCondition(138, 1, BURNED, "gate"); // Flare Boost, [BURN]
bindCondition(5943, 2, POISONED_TOXIC_OR_BURNED, "gate"); // Rainbow Fish, [POISON, TOXIC, BURN]
bindCondition(6051, 2, POISONED_OR_TOXIC, "gate"); // Decay, [POISON, TOXIC]

// ---------------------------------------------------------------------------------------------
// ChangeMovePriorityAbAttr and ChangeMovePriorityInBracketAbAttr (Tier B). Slot "gate": `moveFunc(pokemon, move)`, the holder is
// the user of the move.
// ---------------------------------------------------------------------------------------------
const STATUS_MOVE = { id: "move.category", category: "STATUS" };
bindCondition(158, 0, STATUS_MOVE, "gate"); // Prankster: move.category === STATUS, +1
bindCondition(298, 0, STATUS_MOVE, "gate"); // Mycelium Might (in bracket): move.category === STATUS, LAST
bindCondition(
  177,
  0,
  {
    all: [
      { id: "hp.full", who: "holder" },
      { id: "move.type", type: "FLYING", effective: true },
    ],
  },
  "gate",
); // Gale Wings: pokemon.isFullHp() && pokemon.getMoveType(move) === FLYING, +1
bindCondition(205, 0, { id: "move.flag", flag: "TRIAGE_MOVE" }, "gate"); // Triage: move.hasFlag(TRIAGE_MOVE), +3
bindCondition(6083, 4, { id: "move.is-move", moveId: "FOCUS_PUNCH" }, "gate"); // Monk: move.id === 264, +3
bindLegacyClosure(
  290,
  0,
  "Opportunist: true when ANY opponent has getHpRatio() <= .5 (rounded ratio), inside a try/catch; no atom reads the list of opponents or the rounded ratio (request R-B05-12)",
  "gate",
); // Opportunist
bindLegacyClosure(
  6015,
  2,
  "Penta-Punch: the rule is move.id === ErMoveId.FIVE_STAR_FURY (5156), an Elite Redux move id; move.is-move only names MoveId members (request R-B05-13)",
  "gate",
); // Penta-Punch

// =============================================================================================
// Chunk 3 of 4. Written by hand from the live attrs (the dump printed every field).
// SuppressWeatherEffectAbAttr and FriskAbAttr have no closure and no gate (their settings are constructor values), so they need no binding. The Tier B classes below each have ONE gate.
// =============================================================================================

// The form test, kept as its own IF piece: `pokemon.formIndex === formIndex` (the class setting, 1 for every user).
const inFormNumber = (formIndex: number) => ({ id: "mon.in-form-number", who: "holder", formIndex });

// Ice Face (IceFaceFormChangeAbAttr, form 1): in form 1 AND the new weather is hail or snow
// (`pokemon.formIndex === formIndex && (weather === WeatherType.HAIL || weather === WeatherType.SNOW)`).
bindCondition(
  248,
  3,
  {
    all: [
      inFormNumber(1),
      {
        any: [
          { id: "field.weather", weather: "HAIL" },
          { id: "field.weather", weather: "SNOW" },
        ],
      },
    ],
  },
  "gate",
);

// The weather is fog or eerie fog: `isFogWeather(weather)` = `weather === FOG || weather === EERIE_FOG`. The attr is told the NEW weather
// (arena.ts:537) and the arena has already stored it, so `arena.weatherType` (the atom) is the same value.
// Each fog class also needs the holder in its busted form (form 1 for all users), a separate IF piece.
const IS_FOG = {
  all: [
    inFormNumber(1),
    {
      any: [
        { id: "field.weather", weather: "FOG" },
        { id: "field.weather", weather: "EERIE_FOG" },
      ],
    },
  ],
};
bindCondition(209, 5, IS_FOG, "gate"); // Disguise, when fog is set (FogRestoreDisguiseFormChangeAbAttr)
bindCondition(5396, 5, IS_FOG, "gate"); // Patchwork, when fog is set
bindCondition(5396, 7, IS_FOG, "gate"); // Patchwork, when fog is set (second copy of the pair)
bindCondition(209, 6, IS_FOG, "gate"); // Disguise, on entry in fog (PostSummonFogRestoreDisguiseAbAttr)
bindCondition(5396, 6, IS_FOG, "gate"); // Patchwork, on entry in fog
bindCondition(5396, 8, IS_FOG, "gate"); // Patchwork, on entry in fog (second copy of the pair)

// The new weather is one of the listed ones: `weatherTypes.includes(weather)` with [SUNNY, HARSH_SUN].
bindCondition(
  281,
  1,
  {
    any: [
      { id: "field.weather", weather: "SUNNY" },
      { id: "field.weather", weather: "HARSH_SUN" },
    ],
  },
  "gate",
); // Protosynthesis (PostWeatherChangeAddBattlerTagAbAttr)

// The weather is one of the listed ones: `weatherTypes.length === 0 || weatherTypes.includes(weather.weatherType)`
// (BlockWeatherDamageAttr, Tier B). `!weather || cancelled.value` stays in the class as its guard. The weather the phase passes is the
// arena weather, which field.weather reads. Overcoat (142 attr 0) lists no weather (= every weather) and is bound to any of all 13 weathers.
const SANDSTORM = { id: "field.weather", weather: "SANDSTORM" };
const HAIL = { id: "field.weather", weather: "HAIL" };
const SNOW = { id: "field.weather", weather: "SNOW" };
const HAIL_OR_SNOW = { any: [HAIL, SNOW] };
bindCondition(8, 1, SANDSTORM, "gate"); // Sand Veil
bindCondition(146, 1, SANDSTORM, "gate"); // Sand Rush
bindCondition(159, 0, SANDSTORM, "gate"); // Sand Force
bindCondition(5311, 2, SANDSTORM, "gate"); // Desert Spirit
bindCondition(5445, 2, SANDSTORM, "gate"); // Sand Bender
bindCondition(5506, 3, SANDSTORM, "gate"); // Sepia Lens
bindCondition(5601, 0, SANDSTORM, "gate"); // Sand Fiend
bindCondition(115, 0, HAIL, "gate"); // Ice Body
bindCondition(5953, 0, HAIL, "gate"); // Ice Body (second ability with the same rule)
bindCondition(5086, 1, HAIL, "gate"); // North Wind
bindCondition(5573, 2, HAIL, "gate"); // Molten Core
bindCondition(5632, 3, HAIL, "gate"); // Sundae
bindCondition(202, 1, HAIL_OR_SNOW, "gate"); // Slush Rush
bindCondition(5007, 1, HAIL_OR_SNOW, "gate"); // Whiteout
bindCondition(5021, 1, HAIL_OR_SNOW, "gate"); // Christmas Spirit
bindCondition(5348, 1, HAIL_OR_SNOW, "gate"); // Ice Cold Hunter
bindCondition(5526, 1, HAIL_OR_SNOW, "gate"); // Glacial Ghost
bindCondition(5563, 1, HAIL_OR_SNOW, "gate"); // Thermal Slide
bindCondition(5633, 2, HAIL_OR_SNOW, "gate"); // Ice Picks
bindCondition(5539, 1, { any: [SANDSTORM, HAIL, SNOW] }, "gate"); // Guardian Coat
// Overcoat (142 attr 0): an EMPTY list, "every weather". Spelled out as "the weather is any of the 13 kinds", which is always true (the arena
// weather is always one of them), so the gate says in plain words that no weather is excluded.
bindCondition(
  142,
  0,
  {
    any: [
      { id: "field.weather", weather: "NONE" },
      { id: "field.weather", weather: "SUNNY" },
      { id: "field.weather", weather: "RAIN" },
      { id: "field.weather", weather: "SANDSTORM" },
      { id: "field.weather", weather: "HAIL" },
      { id: "field.weather", weather: "SNOW" },
      { id: "field.weather", weather: "FOG" },
      { id: "field.weather", weather: "HEAVY_RAIN" },
      { id: "field.weather", weather: "HARSH_SUN" },
      { id: "field.weather", weather: "STRONG_WINDS" },
      { id: "field.weather", weather: "TEMPEST_STORM" },
      { id: "field.weather", weather: "SNOWY_WRATH" },
      { id: "field.weather", weather: "EERIE_FOG" },
    ],
  },
  "gate",
); // Overcoat

// The weather sends me back to my normal form (PostWeatherChangeFormChangeAbAttr, Tier B). The class reads the ARENA weather as
// `weatherType && list.includes(weatherType)`, so with no weather (or a 0 id) it is false: NONE, which sits in both live lists, can never
// match and is left out here. The gate only picks the branch; the species guard stays in the class.
bindCondition(
  59,
  2,
  {
    any: [
      { id: "field.weather", weather: "SANDSTORM" },
      { id: "field.weather", weather: "STRONG_WINDS" },
    ],
  },
  "gate",
); // Forecast, live list NONE, SANDSTORM, STRONG_WINDS
bindCondition(
  122,
  2,
  {
    any: [
      { id: "field.weather", weather: "SANDSTORM" },
      { id: "field.weather", weather: "STRONG_WINDS" },
      { id: "field.weather", weather: "FOG" },
      { id: "field.weather", weather: "HAIL" },
      { id: "field.weather", weather: "HEAVY_RAIN" },
      { id: "field.weather", weather: "SNOW" },
      { id: "field.weather", weather: "RAIN" },
    ],
  },
  "gate",
); // Flower Gift, live list NONE, SANDSTORM, STRONG_WINDS, FOG, HAIL, HEAVY_RAIN, SNOW, RAIN
