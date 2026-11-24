/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 4 of 4: instance bindings of the PARKED class AiMovegenMoveStatsAbAttr (43 closures, slot ctor:0). Keyed by
// (abilityId, attrIndex). Written by hand from the live dump of
// the attrs (the source of every closure was printed; nothing here is generated).
//
// This file is NOT named `bindings.ts`, so the registry does not load it: a binding for a class without a live declaration would be an L0
// error ("bound, but X has no declaration"). When the librarian has added the WHEN of request R-B07-15 and the two declarations are renamed
// to `*.decl.ts` (see their headers), move these lines into decl/B07/bindings.ts.
//
// Why every line is a legacy closure: the signature is `(params) => void` over `{ pokemon, move, powerMult, accMult, instantCharge,
// maxMultiHit }`. It is not a yes/no condition at all: each closure is a CONDITION (a move category, type, flag, priority or id) fused to an
// EFFECT (a rating number). build-attr.ts has no context for it and the library has no AI-rating effect (R-B07-15). Each reason carries the
// exact formula and the library form that replaces it.
import { bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// MoveCategory: PHYSICAL 0, SPECIAL 1, STATUS 2. PokemonType: FIRE 9, WATER 10, DRAGON 15, FLYING 2.

// ---------------------------------------------------------------------------------------------------------------------
// Accuracy only: `accMult.value *= factor` for every move (no condition).
// ---------------------------------------------------------------------------------------------------------------------
bindLegacyClosure(
  14,
  1,
  "Compound Eyes: `accMult.value *= 1.3` for every move. Library form once R-B07-15 exists: the AI-accuracy effect with factor 1.3, no condition.",
); // Compound Eyes
bindLegacyClosure(
  162,
  2,
  "Victory Star: `accMult.value *= 1.1` for every move. Library form once R-B07-15 exists: the AI-accuracy effect with factor 1.1, no condition.",
); // Victory Star
bindLegacyClosure(
  219,
  2,
  "Dazzling: `accMult.value *= 1.2` for every move. Library form once R-B07-15 exists: the AI-accuracy effect with factor 1.2, no condition.",
); // Dazzling
bindLegacyClosure(
  5686,
  2,
  "Lucha Libre: `accMult.value *= 1.2` for every move. Library form once R-B07-15 exists: the AI-accuracy effect with factor 1.2, no condition.",
); // Lucha Libre
bindLegacyClosure(
  20019,
  4,
  "Radiant Jewel (composed ability): `accMult.value *= 1.2` for every move. Library form once R-B07-15 exists: the AI-accuracy effect with factor 1.2, no condition.",
); // Radiant Jewel
bindLegacyClosure(
  55,
  2,
  "Hustle: `if (move.category !== STATUS) accMult.value *= 0.9`. Library form once R-B07-15 exists: the AI-accuracy effect with factor 0.9 under NOT (the atom move.category STATUS).",
); // Hustle

// ---------------------------------------------------------------------------------------------------------------------
// Power by move category: `if (move.category === X) powerMult.value *= factor`.
// ---------------------------------------------------------------------------------------------------------------------
bindLegacyClosure(
  37,
  1,
  "Huge Power: `if (move.category === PHYSICAL) powerMult.value *= 2`. Library form once R-B07-15 exists: the AI-power effect, factor 2, under the atom move.category PHYSICAL.",
); // Huge Power
bindLegacyClosure(
  74,
  1,
  "Pure Power: `if (move.category === SPECIAL) powerMult.value *= 2`. Library form once R-B07-15 exists: the AI-power effect, factor 2, under the atom move.category SPECIAL.",
); // Pure Power
bindLegacyClosure(
  255,
  1,
  "Gorilla Tactics: `if (move.category === PHYSICAL) powerMult.value *= 1.5`. Library form once R-B07-15 exists: the AI-power effect, factor 1.5, under move.category PHYSICAL.",
); // Gorilla Tactics
bindLegacyClosure(
  285,
  1,
  "Sword of Ruin: `if (move.category === PHYSICAL) powerMult.value *= 1.25`. Library form once R-B07-15 exists: the AI-power effect, factor 1.25, under move.category PHYSICAL.",
); // Sword of Ruin
bindLegacyClosure(
  5392,
  2,
  "Sword of Damnation: `if (move.category === PHYSICAL) powerMult.value *= 1.25`. Library form once R-B07-15 exists: the AI-power effect, factor 1.25, under move.category PHYSICAL.",
); // Sword of Damnation
bindLegacyClosure(
  6023,
  1,
  "Sword's Nature: `if (move.category === PHYSICAL) powerMult.value *= 1.25`. Library form once R-B07-15 exists: the AI-power effect, factor 1.25, under move.category PHYSICAL.",
); // Sword's Nature
bindLegacyClosure(
  287,
  1,
  "Beads of Ruin: `if (move.category === SPECIAL) powerMult.value *= 1.25`. Library form once R-B07-15 exists: the AI-power effect, factor 1.25, under move.category SPECIAL.",
); // Beads of Ruin
bindLegacyClosure(
  289,
  2,
  "Hadron Engine: `if (move.category === SPECIAL) powerMult.value *= 4 / 3`. Library form once R-B07-15 exists: the AI-power effect, factor 4/3 (1.3333), under move.category SPECIAL.",
); // Hadron Engine

// Intrepid Sword and Crowned Sword: a physical move that does NOT use the Defense stat (DefAtkAttr is Body Press).
bindLegacyClosure(
  234,
  1,
  "Intrepid Sword: `if (move.category === PHYSICAL && !move.hasAttr(\"DefAtkAttr\")) powerMult.value *= 1.5`. Library form once R-B07-15 exists: factor 1.5 under (move.category PHYSICAL and not the move flag/attr 'attacks with Defense'); that attr test has no atom yet either.",
); // Intrepid Sword
bindLegacyClosure(
  5256,
  1,
  'Crowned Sword: `if (move.category === PHYSICAL && !move.hasAttr("DefAtkAttr")) powerMult.value *= 1.5`. Same library form as Intrepid Sword (R-B07-15).',
); // Crowned Sword
// Dauntless Shield and Crowned Shield: only the Defense-attacking move (Body Press).
bindLegacyClosure(
  235,
  1,
  "Dauntless Shield: `if (move.hasAttr(\"DefAtkAttr\")) powerMult.value *= 1.5`. Library form once R-B07-15 exists: factor 1.5 under the move attr 'attacks with Defense' (no atom for a move attr yet).",
); // Dauntless Shield
bindLegacyClosure(
  5257,
  1,
  'Crowned Shield: `if (move.hasAttr("DefAtkAttr")) powerMult.value *= 1.5`. Same library form as Dauntless Shield (R-B07-15).',
); // Crowned Shield

// ---------------------------------------------------------------------------------------------------------------------
// Power for a move of lower priority: `if (move.priority < 0) powerMult.value *= 1.3`.
// ---------------------------------------------------------------------------------------------------------------------
bindLegacyClosure(
  148,
  1,
  "Analytic: `if (move.priority < 0) powerMult.value *= 1.3`. Library form once R-B07-15 exists: the AI-power effect, factor 1.3, under the atom move.priority below 0.",
); // Analytic
bindLegacyClosure(
  5494,
  1,
  "Calculative: `if (move.priority < 0) powerMult.value *= 1.3`. Library form once R-B07-15 exists: factor 1.3 under move.priority below 0.",
); // Calculative
bindLegacyClosure(
  5561,
  2,
  "Haste Makes Waste: `if (move.priority < 0) powerMult.value *= 1.3`. Library form once R-B07-15 exists: factor 1.3 under move.priority below 0.",
); // Haste Makes Waste

// ---------------------------------------------------------------------------------------------------------------------
// Power for a move that always crits: `if (move.hasAttr("CritOnlyAttr")) powerMult.value *= 1.5`.
// ---------------------------------------------------------------------------------------------------------------------
bindLegacyClosure(
  97,
  1,
  "Sniper: `if (move.hasAttr(\"CritOnlyAttr\")) powerMult.value *= 1.5`. Library form once R-B07-15 exists: factor 1.5 under the move attr 'always a critical hit' (no atom for a move attr yet).",
); // Sniper
bindLegacyClosure(
  5507,
  1,
  'Super Sniper: `if (move.hasAttr("CritOnlyAttr")) powerMult.value *= 1.5`. Same library form as Sniper (R-B07-15).',
); // Super Sniper
bindLegacyClosure(
  6107,
  1,
  'Fourth Degree: `if (move.hasAttr("CritOnlyAttr")) powerMult.value *= 1.5`. Same library form as Sniper (R-B07-15).',
); // Fourth Degree
bindLegacyClosure(
  6109,
  3,
  'Kagutsuchi: `if (move.hasAttr("CritOnlyAttr")) powerMult.value *= 1.5`. Same library form as Sniper (R-B07-15).',
); // Kagutsuchi

// ---------------------------------------------------------------------------------------------------------------------
// Maximum multi-hit: `maxMultiHit.value = true` for every move (the AI assumes the best hit count).
// ---------------------------------------------------------------------------------------------------------------------
bindLegacyClosure(
  92,
  1,
  "Skill Link: `maxMultiHit.value = true` for every move. Library form once R-B07-15 exists: the effect 'the AI assumes my multi-hit moves hit the maximum number of times', no condition.",
); // Skill Link
bindLegacyClosure(
  5191,
  2,
  "Ninja's Blade: `maxMultiHit.value = true` for every move. Same library form as Skill Link (R-B07-15).",
); // Ninja's Blade

// ---------------------------------------------------------------------------------------------------------------------
// One-off rules.
// ---------------------------------------------------------------------------------------------------------------------
bindLegacyClosure(
  6,
  1,
  "Damp: `if (move.hasCondition(failIfDampCondition)) powerMult.value = 0` (the self-destruct moves rated as useless). Library form once R-B07-15 exists: the AI-power effect, SET to 0, under a move rule 'fails while a Damp holder is on the field' (no atom).",
); // Damp
bindLegacyClosure(
  185,
  2,
  "Parental Bond: `if (move.canBeMultiStrikeEnhanced(pokemon, false, null)) powerMult.value *= 1.25`. Library form once R-B07-15 exists: factor 1.25 under a move rule 'can be hit a second time by a double-strike ability' (no atom).",
); // Parental Bond
bindLegacyClosure(
  228,
  2,
  "Misty Surge: `if (move.type === DRAGON) powerMult.value *= 0.5`, THEN `if (levitate float || pokemon.isOfType(FLYING)) return`, THEN `if (move.id === MISTY_EXPLOSION) *= 1.5 else if (move.id === TERRAIN_PULSE) *= 1.5`. Library form once R-B07-15 exists: three rated rules, the last two under the atoms mon.grounded (the same engine query as the closure) and move.is-move.",
); // Misty Surge

// ---------------------------------------------------------------------------------------------------------------------
// Weather families. The shared helpers read: Weather Ball (id 311), moves with the accuracy attrs of Thunder, Hurricane and Blizzard, the
// anti-sunlight attr, and charging moves whose charge attr skips in a weather.
// ---------------------------------------------------------------------------------------------------------------------
const RAIN_REASON =
  'drizzleAiMovegenEffect: `if (move.id === WEATHER_BALL) { powerMult *= 3; return } switch (move.type) { FIRE: powerMult *= 0.5; WATER: powerMult *= 1.5 } if (move.hasAttr("ThunderAccuracyAttr") || move.hasAttr("StormAccuracyAttr")) accMult = Infinity; if (move.hasAttr("AntiSunlightPowerDecreaseAttr")) powerMult *= 0.5`. Library form once R-B07-15 exists: four rated rules (Weather Ball x3 and stop; Fire x0.5 and Water x1.5; moves that never miss in rain; the anti-sunlight move x0.5).';
bindLegacyClosure(2, 2, `Drizzle: ${RAIN_REASON}`); // Drizzle
bindLegacyClosure(5232, 2, `Seaborne: ${RAIN_REASON}`); // Seaborne
bindLegacyClosure(5568, 2, `Supercell: ${RAIN_REASON}`); // Supercell
bindLegacyClosure(
  189,
  3,
  `Primordial Sea: \`if (move.type === FIRE) powerMult *= 0 else <drizzleAiMovegenEffect>\`. ${RAIN_REASON}`,
); // Primordial Sea

const SUN_REASON =
  'droughtAiMovegenEffect: `if (move.id === WEATHER_BALL) { powerMult *= 3; return } if (move.id === HYDRO_STEAM || move.type === FIRE) powerMult *= 1.5 else if (move.type === WATER) powerMult *= 0.5; if (move.hasAttr("ThunderAccuracyAttr")) accMult *= 0.5; if (move.isChargingMove() && move.getChargeAttrs("WeatherInstantChargeAttr").some(a => a.weatherTypes.includes(SUNNY))) instantCharge = true`. Library form once R-B07-15 exists: four rated rules (Weather Ball x3 and stop; Hydro Steam or Fire x1.5 and Water x0.5; Thunder accuracy x0.5; a move that charges instantly in sun).';
bindLegacyClosure(70, 2, `Drought: ${SUN_REASON}`); // Drought
bindLegacyClosure(6028, 2, `Solar Panel: ${SUN_REASON}`); // Solar Panel
bindLegacyClosure(
  288,
  3,
  `Orichalcum Pulse: \`<droughtAiMovegenEffect>; if (move.category === PHYSICAL) powerMult *= 4 / 3\`. ${SUN_REASON}`,
); // Orichalcum Pulse
const HARSH_SUN_REASON = `\`if (move.type === WATER) powerMult *= 0 else <droughtAiMovegenEffect>\`. ${SUN_REASON}`;
bindLegacyClosure(190, 3, `Desolate Land: ${HARSH_SUN_REASON}`); // Desolate Land
bindLegacyClosure(5447, 3, `Desolate Sun: ${HARSH_SUN_REASON}`); // Desolate Sun
bindLegacyClosure(5570, 3, `Fire Aspect: ${HARSH_SUN_REASON}`); // Fire Aspect
bindLegacyClosure(5572, 3, `Blistering Sun: ${HARSH_SUN_REASON}`); // Blistering Sun

const SNOW_REASON =
  'Snow closure: `if (move.id === WEATHER_BALL) { powerMult *= 2; return } if (move.hasAttr("BlizzardAccuracyAttr")) accMult = Infinity; if (move.hasAttr("AntiSunlightPowerDecreaseAttr")) powerMult *= 0.5; if (move.isChargingMove() && move.getChargeAttrs("WeatherInstantChargeAttr").some(a => a.weatherTypes.includes(SNOW))) instantCharge = true`. Library form once R-B07-15 exists: four rated rules (Weather Ball x2 and stop; Blizzard-style moves never miss; the anti-sunlight move x0.5; a move that charges instantly in snow).';
bindLegacyClosure(117, 2, `Snow Warning: ${SNOW_REASON}`); // Snow Warning
bindLegacyClosure(5632, 2, `Sundae: ${SNOW_REASON}`); // Sundae
