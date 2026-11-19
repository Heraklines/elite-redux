/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The shared condition library (spec section 1.3).
// Each atom is plain data; the game-side predicate lives in evaluate/conditions.ts and calls the
// SAME engine predicate the original lambda used (isFullHp(), doesFlagEffectApply(), ...).

import {
  ARENA_SIDE_OPTIONS,
  CATEGORY_OPTIONS,
  COMPARE_OPTIONS,
  HP_ROUNDING_OPTIONS,
  ITEM_KIND_OPTIONS,
  MOVE_FLAG_OPTIONS,
  ONCE_PER_SCOPES,
  SIDE_KIND_OPTIONS,
  STAT_OPTIONS,
  STATUS_OPTIONS,
  TARGET_KIND_OPTIONS,
  TERRAIN_OPTIONS,
  TYPE_OPTIONS,
  WEATHER_OPTIONS,
  WHO_OPTIONS,
} from "./enums";
import {
  booleanParam,
  numberParam,
  type ParamDef,
  type ParamValues,
  selectParam,
  sliderParam,
  textParam,
} from "./params";
import type { SlotId } from "./slots";

export interface ConditionFormula {
  /** The exact expression, as plain text. */
  readonly expr: string;
  /** Where it was lifted from (file and line, or the engine function it calls). */
  readonly source: string;
}

export interface ConditionDef {
  readonly id: string;
  readonly group: string;
  /** Plain-language label template; `{param}` markers are filled from the params. */
  readonly label: string;
  /** Slots that must always be provided. */
  readonly requires: readonly SlotId[];
  /** When set, the param with this id names an extra required slot (`holder`, `other` or `ally`). */
  readonly whoParam?: string;
  readonly params: readonly ParamDef[];
  /** False only for atoms that draw random numbers. */
  readonly pure: boolean;
  readonly formula: ConditionFormula;
  readonly synonyms: readonly string[];
  readonly examples: readonly string[];
  /** True for the two escape hatches that cannot be authored in the editor. */
  readonly escapeHatch?: boolean;
}

const WHO = (def = "holder"): ParamDef => selectParam("who", "Whose", WHO_OPTIONS, def);
const CMP = (): ParamDef => selectParam("cmp", "Comparison", COMPARE_OPTIONS, "gte");
const ROUNDING = (): ParamDef => selectParam("rounding", "HP rounding", HP_ROUNDING_OPTIONS, "exact");

const ENGINE = "src/field/pokemon.ts";
const MOVE_TS = "src/data/moves/move.ts";
const ARENA = "src/field/arena.ts";

export const CONDITION_REGISTRY: readonly ConditionDef[] = [
  // ---- HP -------------------------------------------------------------------------------
  {
    id: "hp.full",
    group: "HP",
    label: "{who} is at full HP",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: { expr: "pokemon.isFullHp()", source: `${ENGINE}:2403 (isFullHp, hp >= getMaxHp())` },
    synonyms: ["full health", "max hp", "untouched", "undamaged"],
    examples: ["Halve damage at full HP"],
  },
  {
    id: "hp.at-most",
    group: "HP",
    label: "{who} has at most {pct}% HP",
    requires: [],
    whoParam: "who",
    params: [WHO(), sliderParam("pct", "HP percent", 50, 1, 100, 1, true), ROUNDING()],
    pure: true,
    formula: {
      expr: "exact: hp * 100 <= maxHp * pct ; floor-half: hp <= floor(maxHp * pct / 100)",
      source: `${ENGINE}:2408 (getMaxHp); integer math, no float ratio`,
    },
    synonyms: ["low hp", "below half", "hurt", "weakened"],
    examples: ["Boost power when at most 33% HP"],
  },
  {
    id: "hp.at-least",
    group: "HP",
    label: "{who} has at least {pct}% HP",
    requires: [],
    whoParam: "who",
    params: [WHO(), sliderParam("pct", "HP percent", 50, 1, 100, 1, true), ROUNDING()],
    pure: true,
    formula: {
      expr: "exact: hp * 100 >= maxHp * pct ; floor-half: hp >= floor(maxHp * pct / 100)",
      source: `${ENGINE}:2408 (getMaxHp); integer math, no float ratio`,
    },
    synonyms: ["high hp", "healthy", "above half"],
    examples: ["Resist hits while above 75% HP"],
  },
  {
    id: "hp.between",
    group: "HP",
    label: "{who} has between {minPct}% and {maxPct}% HP",
    requires: [],
    whoParam: "who",
    params: [
      WHO(),
      sliderParam("minPct", "Lowest HP percent", 25, 0, 100, 1, true),
      sliderParam("maxPct", "Highest HP percent", 75, 0, 100, 1, true),
      ROUNDING(),
    ],
    pure: true,
    formula: {
      expr: "at-least(minPct) && at-most(maxPct), same rounding for both",
      source: `${ENGINE}:2408 (getMaxHp); integer math`,
    },
    synonyms: ["mid hp", "hp range", "hp window"],
    examples: ["Heal only while between 10% and 50% HP"],
  },
  {
    id: "hp.crossed-below",
    group: "HP",
    label: "{who} just dropped below {ratio} of max HP",
    requires: ["damage"],
    whoParam: "who",
    params: [
      selectParam("who", "Whose", ["holder", "other"]),
      sliderParam("ratio", "Max HP ratio", 0.5, 0.01, 0.99, 0.01),
      ROUNDING(),
    ],
    pure: true,
    formula: {
      expr:
        "exact: hp + damage >= maxHp * ratio && hp - calculateShellBellRecovery(pokemon) < maxHp * ratio ; "
        + "floor-half: t = floor(maxHp * ratio); hp <= t && hp + damage > t",
      source:
        "src/data/abilities/ab-attrs.ts hpCrossedBelow (moved from PostDamageForceSwitchAbAttr.canApply); "
        + "floor-half form from archetypes/berserk-on-threshold.ts. The Shell Bell term belongs to the exact form.",
    },
    synonyms: ["dropped below", "fell under", "crossed threshold", "wimp out", "emergency exit"],
    examples: ["Switch out when HP drops below 35%"],
  },

  // ---- Move -----------------------------------------------------------------------------
  {
    id: "move.type",
    group: "Move",
    label: "The move is {type} type",
    requires: ["move", "moveUser"],
    params: [
      selectParam("type", "Type", TYPE_OPTIONS, "FIRE"),
      booleanParam("effective", "Use the type after ability changes", true),
    ],
    pure: true,
    formula: {
      expr: "moveUser.getMoveType(move) === PokemonType[type]  (effective=false: move.type)",
      source: "src/data/elite-redux/ability-studio/rule-ab-attrs.ts matchesAbilityStudioMoveFilter",
    },
    synonyms: ["fire move", "water move", "move element", "attack type"],
    examples: ["Boost Fire-type moves"],
  },
  {
    id: "move.category",
    group: "Move",
    label: "The move is {category}",
    requires: ["move"],
    params: [selectParam("category", "Category", CATEGORY_OPTIONS, "PHYSICAL")],
    pure: true,
    formula: { expr: "move.category === MoveCategory[category]", source: `${MOVE_TS} (Move.category)` },
    synonyms: ["physical", "special", "status move", "attack category"],
    examples: ["Resist special moves"],
  },
  {
    id: "move.flag",
    group: "Move",
    label: "The move has the {flag} property",
    requires: ["move", "moveUser"],
    params: [selectParam("flag", "Move property", MOVE_FLAG_OPTIONS, "MAKES_CONTACT")],
    pure: true,
    formula: {
      expr: "move.doesFlagEffectApply({ flag: MoveFlags[flag], user: moveUser, target })",
      source: `${MOVE_TS}:986 (doesFlagEffectApply, so contact-ignoring abilities and substitutes count)`,
    },
    synonyms: ["contact", "sound move", "punching move", "biting move", "move flag"],
    examples: ["Trigger only on contact moves"],
  },
  {
    id: "move.power",
    group: "Move",
    label: "The move's power is {cmp} {n}",
    requires: ["move"],
    params: [CMP(), numberParam("n", "Power", 60, 0, 400, 1, true)],
    pure: true,
    formula: { expr: "compare(move.power, cmp, n)", source: `${MOVE_TS} (Move.power)` },
    synonyms: ["base power", "weak move", "strong move", "bp"],
    examples: ["Boost moves with 60 power or less"],
  },
  {
    id: "move.damaging",
    group: "Move",
    label: "The move deals damage",
    requires: ["move"],
    params: [],
    pure: true,
    formula: { expr: "move.category is not STATUS", source: "rule-ab-attrs.ts matchesAbilityStudioMoveFilter" },
    synonyms: ["attacking move", "not a status move", "damage move"],
    examples: ["Only react to damaging moves"],
  },
  {
    id: "move.target-kind",
    group: "Move",
    label: "The move targets {kind}",
    requires: ["move"],
    params: [selectParam("kind", "Target", TARGET_KIND_OPTIONS, "single")],
    pure: true,
    formula: {
      expr: "single: OTHER|NEAR_OTHER|RANDOM_NEAR_ENEMY ; all-foes: ALL_NEAR_ENEMIES|ENEMY_SIDE ; all-others: ALL_NEAR_OTHERS|ALL_OTHERS ; user-or-ally: USER|NEAR_ALLY|USER_AND_ALLIES ; field: BOTH_SIDES|USER_SIDE",
      source: "src/enums/move-target.ts",
    },
    synonyms: ["spread move", "single target", "multi target"],
    examples: ["Only single-target moves"],
  },
  {
    id: "move.priority",
    group: "Move",
    label: "The move's priority is {cmp} {n}",
    requires: ["move"],
    params: [CMP(), numberParam("n", "Priority", 0, -7, 7, 1, true)],
    pure: true,
    formula: { expr: "compare(move.priority, cmp, n)", source: `${MOVE_TS}:231 (Move.priority)` },
    synonyms: ["priority move", "quick attack", "go first"],
    examples: ["Block priority moves"],
  },
  {
    id: "move.multi-hit",
    group: "Move",
    label: "The move hits more than once",
    requires: ["hits"],
    params: [],
    pure: true,
    formula: { expr: "hits.count > 1", source: "src/phases/move-effect-phase.ts hit counters" },
    synonyms: ["multi strike", "double hit", "multiple hits"],
    examples: ["Only for multi-hit moves"],
  },
  {
    id: "move.hit-index",
    group: "Move",
    label: "This is hit number {cmp} {n}",
    requires: ["hits"],
    params: [CMP(), numberParam("n", "Hit number", 1, 1, 10, 1, true)],
    pure: true,
    formula: {
      expr: "compare(hits.index, cmp, n)  (hits.index is 1-based)",
      source: "src/phases/move-effect-phase.ts hit counters",
    },
    synonyms: ["first hit", "second hit", "nth strike"],
    examples: ["Only on the first hit"],
  },
  {
    id: "move.last-hit",
    group: "Move",
    label: "This is the final hit of the move",
    requires: ["hits"],
    params: [],
    pure: true,
    formula: {
      expr: "hits.index >= hits.count",
      source: "src/phases/move-effect-phase.ts hit counters (turnData.hitsLeft)",
    },
    synonyms: ["last strike", "final hit", "after the last hit"],
    examples: ["Trigger after the final hit of a multi-hit move"],
  },
  {
    id: "move.effectiveness",
    group: "Move",
    label: "The move's effectiveness is {cmp} {n}x",
    requires: ["move", "moveUser", "other"],
    params: [CMP(), numberParam("n", "Multiplier", 2, 0, 16, 0.25)],
    pure: true,
    formula: {
      expr: "compare(target.getMoveEffectiveness(moveUser, move), cmp, n)",
      source: `${ENGINE}:4138 (getMoveEffectiveness)`,
    },
    synonyms: ["super effective", "not very effective", "resisted", "type advantage"],
    examples: ["Take less damage from super effective moves (Filter)"],
  },
  {
    id: "move.has-effect-chance",
    group: "Move",
    label: "The move has a secondary effect chance",
    requires: ["move"],
    params: [],
    pure: true,
    formula: {
      expr: "move.chance >= 0",
      source: "ab-attrs.ts:7437 PostDamageForceSwitchAbAttr (move.chance >= 0 Sheer Force test)",
    },
    synonyms: ["secondary effect", "sheer force move", "extra effect"],
    examples: ["Boost moves that have an extra effect"],
  },
  {
    id: "move.is-move",
    group: "Move",
    label: "The move is {moveId}",
    requires: ["move"],
    params: [textParam("moveId", "Move id (enum name)", "SPLASH")],
    pure: true,
    formula: { expr: "move.id === MoveId[moveId]", source: "src/enums/move-id.ts" },
    synonyms: ["specific move", "this move", "named move"],
    examples: ["Only when the move is Earthquake"],
  },

  // ---- Field ----------------------------------------------------------------------------
  {
    id: "field.weather",
    group: "Field",
    label: "The weather is {weather}",
    requires: [],
    params: [selectParam("weather", "Weather", WEATHER_OPTIONS, "SUNNY")],
    pure: true,
    formula: {
      expr: "arena.weatherType === WeatherType[weather]",
      source: `${ARENA}:219 (weatherType, suppression aware)`,
    },
    synonyms: ["rain", "sun", "sandstorm", "hail", "snow", "weather active"],
    examples: ["Boost Speed in rain"],
  },
  {
    id: "field.terrain",
    group: "Field",
    label: "The terrain is {terrain}",
    requires: [],
    params: [selectParam("terrain", "Terrain", TERRAIN_OPTIONS, "ELECTRIC")],
    pure: true,
    formula: { expr: "arena.terrainType === TerrainType[terrain]", source: `${ARENA}:245 (terrainType)` },
    synonyms: ["electric terrain", "grassy terrain", "misty terrain", "psychic terrain"],
    examples: ["Heal in Grassy Terrain"],
  },
  {
    id: "field.arena-tag",
    group: "Field",
    label: "{tag} is active on {side}",
    requires: [],
    params: [
      textParam("tag", "Field effect (ArenaTagType name)", "REFLECT"),
      selectParam("side", "Side", ARENA_SIDE_OPTIONS, "holder-side"),
    ],
    pure: true,
    formula: { expr: "arena.getTagOnSide(ArenaTagType[tag], side)", source: `${ARENA} getTagOnSide` },
    synonyms: ["screens", "hazards", "reflect", "light screen", "spikes", "tailwind"],
    examples: ["Boost damage while Tailwind is up"],
  },
  {
    id: "field.gravity",
    group: "Field",
    label: "Gravity is active",
    requires: [],
    params: [],
    pure: true,
    formula: {
      expr: "arena.hasActiveGravity()",
      source: `${ARENA}:241 (hasActiveGravity: the tag is set and not suppressed)`,
    },
    synonyms: ["gravity", "grounded field"],
    examples: ["Only while Gravity is up"],
  },
  {
    id: "field.trick-room",
    group: "Field",
    label: "Trick Room is active",
    requires: [],
    params: [],
    pure: true,
    formula: { expr: "arena.getTag(TRICK_ROOM) !== undefined", source: `${ARENA} getTag` },
    synonyms: ["trick room", "reversed speed"],
    examples: ["Boost Speed under Trick Room"],
  },

  // ---- Status and tags -----------------------------------------------------------------
  {
    id: "status.has",
    group: "Status",
    label: "{who} has {status}",
    requires: [],
    whoParam: "who",
    params: [WHO(), selectParam("status", "Status", ["ANY", "NONE", ...STATUS_OPTIONS], "ANY")],
    pure: true,
    formula: {
      expr: "ANY: pokemon.status != null ; NONE: pokemon.status == null ; else pokemon.status?.effect === StatusEffect[status]",
      source: "rule-ab-attrs.ts matchesStatus",
    },
    synonyms: ["burned", "poisoned", "asleep", "paralyzed", "frozen", "no status"],
    examples: ["Boost power while burned (Guts)"],
  },
  {
    id: "status.confused",
    group: "Status",
    label: "{who} is confused",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: { expr: "pokemon.getTag(CONFUSED) !== undefined", source: `${ENGINE}:6941 (getTag)` },
    synonyms: ["confusion", "dazed", "befuddled"],
    examples: ["Boost power while confused"],
  },
  {
    id: "tag.has",
    group: "Status",
    label: "{who} is affected by {tag}",
    requires: [],
    whoParam: "who",
    params: [WHO(), textParam("tag", "Battle effect (BattlerTagType name)", "TAUNT")],
    pure: true,
    formula: { expr: "pokemon.getTag(BattlerTagType[tag]) !== undefined", source: `${ENGINE}:6941 (getTag)` },
    synonyms: ["taunted", "flinching", "leech seed", "volatile status", "battle effect"],
    examples: ["React when the foe is taunted"],
  },

  // ---- Stat stages ---------------------------------------------------------------------
  {
    id: "stage.compare",
    group: "Stat stages",
    label: "{who}'s {stat} stage is {cmp} {n}",
    requires: [],
    whoParam: "who",
    params: [
      WHO(),
      selectParam("stat", "Stat", ["ANY", ...STAT_OPTIONS], "ATK"),
      CMP(),
      numberParam("n", "Stage", 0, -6, 6, 1, true),
    ],
    pure: true,
    formula: {
      expr: "compare(pokemon.getStatStage(Stat[stat]), cmp, n)  (ANY: some stat matches)",
      source: `${ENGINE}:2034 (getStatStage)`,
    },
    synonyms: ["boosted", "lowered", "stat stage", "stat boost"],
    examples: ["Trigger when Attack is at +2 or more"],
  },
  {
    id: "stage.just-changed",
    group: "Stat stages",
    label: "The stat just changed",
    requires: ["stat", "stages"],
    params: [selectParam("direction", "Direction", ["any", "raised", "lowered"], "any")],
    pure: true,
    formula: {
      expr: "any: stages !== 0 ; raised: stages > 0 ; lowered: stages < 0",
      source: "stat-stage-change-phase.ts:357",
    },
    synonyms: ["stat changed", "just boosted", "just dropped"],
    examples: ["React to a stat drop"],
  },

  // ---- Time and memory -----------------------------------------------------------------
  {
    id: "time.first-turn",
    group: "Time",
    label: "It is my first turn out",
    requires: [],
    params: [],
    pure: true,
    formula: {
      expr: "holder.tempSummonData.waveTurnCount <= 1",
      source: "src/data/moves/move-condition.ts:57 (the Fake Out first-turn test: waveTurnCount === 1)",
    },
    synonyms: ["first turn", "just arrived", "fake out", "turn one"],
    examples: ["Only on the first turn after entering"],
  },
  {
    id: "time.turn-count",
    group: "Time",
    label: "I have been out for {cmp} {n} turns",
    requires: [],
    params: [CMP(), numberParam("n", "Turns", 3, 1, 99, 1, true)],
    pure: true,
    formula: {
      expr: "compare(holder.tempSummonData.turnCount, cmp, n)",
      source: "src/data/pokemon/pokemon-data.ts:503",
    },
    synonyms: ["turns out", "time on field", "slow start"],
    examples: ["Stop working after 5 turns"],
  },
  {
    id: "time.last-move",
    group: "Time",
    label: "{who}'s last move was {moveId}",
    requires: [],
    whoParam: "who",
    params: [WHO(), textParam("moveId", "Move id (enum name)", "SPLASH")],
    pure: true,
    formula: { expr: "pokemon.getLastXMoves()[0]?.move === MoveId[moveId]", source: `${ENGINE}:7249 (getLastXMoves)` },
    synonyms: ["previous move", "last used", "just used"],
    examples: ["Boost after using the same move twice"],
  },
  {
    id: "time.acted",
    group: "Time",
    label: "{who} has already moved this turn",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: {
      expr: "pokemon.turnData?.acted ?? false",
      source: "src/data/pokemon/pokemon-data.ts PokemonTurnData.acted (Stall, Breakwater, Haste Makes Waste)",
    },
    synonyms: ["already moved", "moved this turn", "acted", "went first"],
    examples: ["Take less damage until I have moved this turn"],
  },
  {
    id: "time.once-per",
    group: "Time",
    label: "Only once per {scope}",
    requires: [],
    params: [selectParam("scope", "Scope", ONCE_PER_SCOPES, "battle"), textParam("key", "Memory key", "once")],
    pure: true,
    formula: {
      expr: "wave: holder.waveData.entryEffectsFired.has(key) ? false : (add(key), true) ; other scopes: WeakMap<battleData>(key) === scope marker ? false : (mark, true) ; marks only when not simulated and only when the rule applies",
      source:
        "the wave scope IS the per-wave memory the ER archetypes use (berserk-on-threshold, self-switch-on-stat-lower, entry-effect); other scopes are keyed by (pokemon.battleData, key), never static fields",
    },
    synonyms: ["once", "one time", "once per battle", "once per turn", "single use"],
    examples: ["Only the first time per battle"],
  },
  {
    id: "time.nth-use",
    group: "Time",
    label: "On the {n}th time this triggers",
    requires: [],
    params: [numberParam("n", "Count", 2, 1, 99, 1, true), textParam("key", "Memory key", "uses")],
    pure: true,
    formula: { expr: "++counter(battleData, key) === n", source: "state keyed by (pokemon.battleData, key)" },
    synonyms: ["every other", "third time", "counter", "nth"],
    examples: ["Fire on the third use"],
  },

  // ---- Items ---------------------------------------------------------------------------
  {
    id: "item.holds",
    group: "Items",
    label: "{who} holds {kind} item",
    requires: [],
    whoParam: "who",
    params: [WHO(), selectParam("kind", "Item kind", ITEM_KIND_OPTIONS, "any")],
    pure: true,
    formula: {
      expr: "any: pokemon.getHeldItems().length > 0 ; berry: some BerryModifier",
      source: `${ENGINE} getHeldItems`,
    },
    synonyms: ["has item", "holding", "berry held", "item equipped"],
    examples: ["Boost power while holding an item"],
  },
  {
    id: "item.none",
    group: "Items",
    label: "{who} holds no item",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: { expr: "pokemon.getHeldItems().length === 0", source: `${ENGINE} getHeldItems` },
    synonyms: ["no item", "itemless", "unburden", "empty hands"],
    examples: ["Boost Speed when the item is gone"],
  },
  {
    id: "item.lost",
    group: "Items",
    label: "{who} lost an item this battle",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: {
      expr: "pokemon.battleData.lostItems.length > 0 || pokemon.battleData.berriesEaten.length > 0",
      source: "src/data/pokemon/pokemon-data.ts PokemonBattleData.lostItems / berriesEaten ledgers",
    },
    synonyms: ["item gone", "lost item", "used item"],
    examples: ["Boost Speed after the item is lost"],
  },

  // ---- Party and side ------------------------------------------------------------------
  {
    id: "side.is",
    group: "Party",
    label: "The other Pokemon is {kind}",
    requires: ["other"],
    params: [selectParam("kind", "Relation", SIDE_KIND_OPTIONS, "foe")],
    pure: true,
    formula: {
      expr: "ally: other.isPlayer() === holder.isPlayer() && other !== holder ; foe: other.isPlayer() !== holder.isPlayer() ; self: other === holder",
      source: `${ENGINE} isPlayer`,
    },
    synonyms: ["opponent", "teammate", "enemy", "foe or ally"],
    examples: ["Only react to opponents"],
  },
  {
    id: "side.is-player",
    group: "Party",
    label: "{who} is on the player's side",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: { expr: "pokemon.isPlayer()", source: `${ENGINE}:1044 (isPlayer)` },
    synonyms: ["player side", "my team", "not enemy"],
    examples: ["Only for player Pokemon"],
  },
  {
    id: "party.ally-exists",
    group: "Party",
    label: "I have an ally on the field",
    requires: [],
    params: [],
    pure: true,
    formula: { expr: "holder.getAlly() !== undefined", source: `${ENGINE}:5368 (getAlly)` },
    synonyms: ["has partner", "doubles partner", "ally present"],
    examples: ["Boost power when an ally is present"],
  },
  {
    id: "party.ally-ability",
    group: "Party",
    label: "My ally has the ability {ability}",
    requires: [],
    params: [textParam("ability", "Ability id (enum name)", "PLUS")],
    pure: true,
    formula: { expr: "holder.getAlly()?.hasAbility(AbilityId[ability])", source: `${ENGINE}:3848 (hasAbility)` },
    synonyms: ["partner ability", "plus minus", "ally has ability"],
    examples: ["Boost Sp. Atk while the ally has Minus"],
  },
  {
    id: "party.count",
    group: "Party",
    label: "I have {cmp} {n} Pokemon left",
    requires: [],
    params: [CMP(), numberParam("n", "Pokemon", 1, 0, 6, 1, true)],
    pure: true,
    formula: {
      expr: "compare(party.filter(not fainted).length, cmp, n)",
      source: "src/battle-scene.ts getPlayerParty / getEnemyParty",
    },
    synonyms: ["party size", "pokemon left", "team size"],
    examples: ["Boost power with 2 or fewer Pokemon left"],
  },
  {
    id: "party.fainted-count",
    group: "Party",
    label: "{cmp} {n} of my party have fainted",
    requires: [],
    params: [CMP(), numberParam("n", "Pokemon", 1, 0, 6, 1, true)],
    pure: true,
    formula: {
      expr: "compare(party.filter(fainted).length, cmp, n)",
      source: "src/battle-scene.ts getPlayerParty / getEnemyParty",
    },
    synonyms: ["fainted allies", "supreme overlord", "rage fist", "dead teammates"],
    examples: ["Boost power for each fainted teammate"],
  },
  {
    id: "party.last-pokemon",
    group: "Party",
    label: "I am the last Pokemon standing",
    requires: [],
    params: [],
    pure: true,
    formula: {
      expr: "party.filter(not fainted).length === 1",
      source: "src/battle-scene.ts getPlayerParty / getEnemyParty",
    },
    synonyms: ["last mon", "final pokemon", "last stand"],
    examples: ["Boost everything when it is the last Pokemon"],
  },
  {
    id: "party.doubles",
    group: "Party",
    label: "It is a double battle",
    requires: [],
    params: [],
    pure: true,
    formula: { expr: "currentBattle.double", source: "src/battle.ts:227 (double view of the format)" },
    synonyms: ["double battle", "doubles", "two on two"],
    examples: ["Only in double battles"],
  },

  // ---- Type and ability ----------------------------------------------------------------
  {
    id: "mon.has-type",
    group: "Pokemon",
    label: "{who} is {type} type",
    requires: [],
    whoParam: "who",
    params: [WHO(), selectParam("type", "Type", TYPE_OPTIONS, "WATER")],
    pure: true,
    formula: { expr: "pokemon.isOfType(PokemonType[type])", source: `${ENGINE}:2875 (isOfType)` },
    synonyms: ["is fire type", "type check", "dual type"],
    examples: ["Only against Ghost types"],
  },
  {
    id: "mon.opposite-gender",
    group: "Pokemon",
    label: "The other Pokemon is of the opposite gender",
    requires: ["other"],
    params: [],
    pure: true,
    formula: {
      expr: "holder.gender !== GENDERLESS && other.gender !== GENDERLESS && holder.gender !== other.gender",
      source: "src/enums/gender.ts (Rivalry, Empress)",
    },
    synonyms: ["opposite sex", "different gender", "male versus female"],
    examples: ["Take less damage from the opposite gender"],
  },
  {
    id: "mon.grounded",
    group: "Pokemon",
    label: "{who} is on the ground",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: { expr: "pokemon.isGrounded()", source: `${ENGINE}:3999 (isGrounded)` },
    synonyms: ["grounded", "not flying", "not levitating", "touching ground"],
    examples: ["Only affects grounded targets"],
  },
  {
    id: "mon.has-ability",
    group: "Pokemon",
    label: "{who} has the ability {ability}",
    requires: [],
    whoParam: "who",
    params: [WHO(), textParam("ability", "Ability id (enum name)", "LEVITATE")],
    pure: true,
    formula: { expr: "pokemon.hasAbility(AbilityId[ability])", source: `${ENGINE}:3848 (hasAbility)` },
    synonyms: ["has ability", "ability check", "owns ability"],
    examples: ["Only against Pokemon with Levitate"],
  },
  {
    id: "mon.ability-ignorable",
    group: "Pokemon",
    label: "My ability can be ignored by Mold Breaker style effects",
    requires: [],
    params: [],
    pure: true,
    formula: { expr: "holder.getAbility().ignorable", source: "src/data/abilities/ability.ts:124 (ignorable)" },
    synonyms: ["mold breaker", "ability ignored", "breakable ability"],
    examples: ["Only while my ability is breakable"],
  },
  {
    id: "mon.in-form",
    group: "Pokemon",
    label: "{who} is in the {key} form",
    requires: [],
    whoParam: "who",
    params: [WHO(), textParam("key", "Form key", "")],
    pure: true,
    formula: { expr: "pokemon.getFormKey() === key", source: `${ENGINE} getFormKey` },
    synonyms: ["form", "current form", "transformed", "ape form"],
    examples: ["Only while in the battle form"],
  },
  {
    id: "mon.can-change-form",
    group: "Pokemon",
    label: "{who} can change to the {key} form",
    requires: [],
    whoParam: "who",
    params: [WHO(), textParam("key", "Form key", "")],
    pure: true,
    formula: {
      expr: "pokemon has a registered form change edge to key",
      source: "src/data/pokemon-forms.ts pokemonFormChanges",
    },
    synonyms: ["can transform", "form available", "has form change"],
    examples: ["Only if the form change is wired"],
  },

  // ---- RNG -----------------------------------------------------------------------------
  {
    id: "rng.chance",
    group: "Chance",
    label: "{pct}% chance",
    requires: [],
    params: [sliderParam("pct", "Chance percent", 30, 1, 100, 1, true)],
    pure: false,
    formula: {
      expr: "simulated || pct >= 100 || holder.randBattleSeedInt(100) < pct  (evaluated at the position of the original draw)",
      source: "compile-ability-blueprint chance handling; runtime-components.ts carrier.canApply",
    },
    synonyms: ["random", "percent chance", "luck", "sometimes"],
    examples: ["30% chance to paralyze on contact"],
  },

  // ---- Logic and escape hatches --------------------------------------------------------
  {
    id: "escape.legacy-closure",
    group: "Advanced",
    label: "A built-in rule (works as one piece)",
    requires: [],
    params: [textParam("note", "Note", "")],
    pure: true,
    formula: {
      expr: "the original constructor closure, reused as a whole",
      source: "bindings (opaque, reusable, not editable)",
    },
    synonyms: ["built in rule", "opaque condition", "legacy"],
    examples: ["Keeps an original closure that has no library equivalent yet"],
    escapeHatch: true,
  },
  {
    id: "escape.engine-guard",
    group: "Advanced",
    label: "Safety rule {name}",
    requires: [],
    params: [textParam("name", "Guard name", "")],
    pure: true,
    formula: { expr: "guard registry entry (never removable)", source: "vocabulary/guards.ts" },
    synonyms: ["safety rule", "guard", "locked rule"],
    examples: ["The not-already-forced-out rule of Wimp Out"],
    escapeHatch: true,
  },
];

/** The three group operators of an IF tree. They are not blocks; they have no registry entry. */
export const CONDITION_GROUP_OPERATORS = ["all", "any", "not"] as const;

const BY_ID: ReadonlyMap<string, ConditionDef> = new Map(CONDITION_REGISTRY.map(def => [def.id, def]));

export function getCondition(id: string): ConditionDef | undefined {
  return BY_ID.get(id);
}

/** The slots a condition atom needs for a given set of param values. */
export function conditionRequires(def: ConditionDef, values: ParamValues): SlotId[] {
  const slots = new Set<SlotId>(def.requires);
  if (def.whoParam !== undefined) {
    const who = values[def.whoParam] ?? def.params.find(param => param.id === def.whoParam)?.default;
    if (who === "holder" || who === "other" || who === "ally") {
      slots.add(who);
    }
  }
  return [...slots];
}
