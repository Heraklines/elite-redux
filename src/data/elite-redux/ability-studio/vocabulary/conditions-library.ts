/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The condition atoms added by the librarian pass (B19) after the batch
// agents asked for them (requests/B01.md to requests/B18.md, decisions in requests/LIBRARY-DECISIONS.md).
// Every formula was lifted from the source line the requesting agent cited and re-read there; the game-side
// predicate lives in evaluate/conditions.ts and calls the same engine functions the original closure called.

import type { ConditionBase } from "./conditions";
import { COMPARE_OPTIONS, HIT_SIDE_OPTIONS, HP_CROSSING_WHO_OPTIONS, STATUS_OPTIONS, WHO_OPTIONS } from "./enums";
import { booleanParam, numberParam, type ParamDef, selectParam, textParam } from "./params";

const MOVE_TS = "src/data/moves/move.ts";
const POKEMON_TS = "src/field/pokemon.ts";
const ARENA_TS = "src/field/arena.ts";
const WHO = (def = "holder"): ParamDef => selectParam("who", "Which Pokemon", WHO_OPTIONS, def);
const CMP = (): ParamDef => selectParam("cmp", "How to compare", COMPARE_OPTIONS, "gte");

export const LIBRARY_CONDITIONS: readonly ConditionBase[] = [
  // ---- Hits and damage ------------------------------------------------------------------
  {
    id: "hit.dealt-damage",
    group: "Move",
    label: "The hit took away more than 0 HP",
    requires: ["damage"],
    params: [],
    pure: true,
    formula: {
      expr: "damage > 0  (the raw damage the engine passed)",
      source:
        "src/data/elite-redux/abilities/newcomer-signature-mechanics.ts:263 and :377 (FoulHarvest, PorousCharge gates)",
    },
    synonyms: ["took damage", "damage was dealt", "real damage", "not zero damage"],
    examples: ["Only react when the hit really hurt, like Foul Harvest"],
  },
  {
    id: "hit.would-knock-out",
    group: "HP",
    label: "{who} would be knocked out by this hit",
    requires: ["damage"],
    whoParam: "who",
    params: [
      selectParam("who", "Whose HP", HP_CROSSING_WHO_OPTIONS, "holder"),
      booleanParam("ignoreOneHpMax", "A Pokemon with 1 max HP never counts (like Shedinja)", false),
    ],
    pure: true,
    formula: {
      expr: "plain: damage >= pokemon.hp ; ignoreOneHpMax: !(pokemon.getMaxHp() <= 1 || damage < pokemon.hp)  (written as the class writes it, so a NaN damage behaves the same)",
      source:
        "src/data/abilities/ab-attrs.ts:339 PreDefendFullHpEndureAbAttr.canApply clause 3; src/data/elite-redux/archetypes/pre-faint-revive.ts:171; PostFaintDetonateAbAttr gate",
    },
    synonyms: ["lethal hit", "would faint", "fatal damage", "ko hit", "sturdy check"],
    examples: ["Survive with 1 HP when the hit would knock me out, like Sturdy"],
  },
  {
    id: "hit.first-strike",
    group: "Move",
    label: "{who} is on the first strike of its move",
    requires: [],
    whoParam: "who",
    params: [selectParam("who", "Which Pokemon is using the move", HIT_SIDE_OPTIONS, "holder")],
    pure: true,
    formula: {
      expr: "pokemon.turnData.hitCount === pokemon.turnData.hitsLeft  (read before the phase lowers hitsLeft)",
      source: "src/phases/move-effect-phase.ts:296 (this.firstHit); requests B16 R-B16-18, B17 R24",
    },
    synonyms: ["first hit", "first strike", "opening hit", "first of several hits"],
    examples: ["Only on the first strike of a multi-hit move"],
  },
  {
    id: "move.is-attack-move",
    group: "Move",
    label: "The move is an attacking move",
    requires: ["move"],
    params: [],
    pure: true,
    formula: { expr: 'move.is("AttackMove")  (instanceof AttackMove)', source: `${MOVE_TS}:1866 (AttackMove)` },
    synonyms: ["attack", "damaging move class", "not a status move", "attacking move"],
    examples: ["Only block attacking moves, like Wonder Guard"],
  },
  {
    id: "move.targets-whole-side",
    group: "Move",
    label: "The move is aimed at a whole side of the field",
    requires: ["move"],
    params: [],
    pure: true,
    formula: {
      expr: "[MoveTarget.BOTH_SIDES, MoveTarget.ENEMY_SIDE, MoveTarget.USER_SIDE].includes(move.moveTarget)",
      source: "src/data/abilities/ab-attrs.ts TypeImmunityAbAttr.canApply clause 1; Good as Gold closure",
    },
    synonyms: ["field move", "side move", "hazard move", "screen move", "spikes"],
    examples: ["Let moves like Stealth Rock through"],
  },
  {
    id: "move.effective-priority",
    group: "Move",
    label: "The move's real priority is {cmp} {n}",
    requires: ["move", "moveUser"],
    params: [CMP(), numberParam("n", "Priority (0 = normal)", 0, -7, 7, 1, true)],
    pure: true,
    formula: {
      expr: "compare(move.getPriority(moveUser), cmp, n)  (simulated = true: includes Prankster, Gale Wings and the other priority abilities of the user)",
      source: `${MOVE_TS}:1442 Move.getPriority`,
    },
    synonyms: ["priority", "goes first", "prankster", "gale wings", "quick moves", "queenly majesty"],
    examples: ["Block moves with priority above 0, like Dazzling"],
  },
  {
    id: "move.has-flinch-effect",
    group: "Move",
    label: "The move can make the target flinch by itself",
    requires: ["move"],
    params: [],
    pure: true,
    formula: { expr: 'move.hasAttr("FlinchAttr")', source: `${MOVE_TS}:397 Move.hasAttr` },
    synonyms: ["flinch", "already flinches", "flinch move", "stench"],
    examples: ["Add a flinch chance only to moves that cannot flinch yet, like Stench"],
  },
  {
    id: "move.hits-substitute",
    group: "Move",
    label: "The move hits the target's Substitute",
    requires: ["move", "moveUser", "other"],
    params: [],
    pure: true,
    formula: {
      expr: "move.hitsSubstitute(user, target)  (the target is the defender of the frame)",
      source: `${MOVE_TS}:572 Move.hitsSubstitute`,
    },
    synonyms: ["substitute", "decoy", "hits the doll", "blocked by substitute"],
    examples: ["Skip the effect when the move only hit a Substitute"],
  },
  {
    id: "move.type-chart-effectiveness",
    group: "Move",
    label: "The type chart makes the move {cmp} {n}x against the target",
    requires: ["move", "moveUser", "other"],
    params: [CMP(), numberParam("n", "Effectiveness (1 = normal, 2 = super effective)", 1, 0, 8, 0.25)],
    pure: true,
    formula: {
      expr: "compare(defender.getAttackTypeEffectiveness(moveUser.getMoveType(move), { source: moveUser, move }), cmp, n)  (the chart only: no cached matchup, no status-move rule)",
      source: `${POKEMON_TS}:4293 getAttackTypeEffectiveness; src/data/elite-redux/archetypes/damage-reduction-generic.ts matchesFilter`,
    },
    synonyms: ["type matchup", "super effective", "not very effective", "resisted", "weakness", "thick skin"],
    examples: ["Take less damage from super effective moves, like Filter"],
  },
  {
    id: "move.type-multiplier",
    group: "Move",
    label: "The type matchup worked out so far is {cmp} {n}x",
    requires: ["typeMultiplier"],
    params: [CMP(), numberParam("n", "Effectiveness (1 = normal, 2 = super effective)", 2, 0, 8, 0.25)],
    pure: true,
    formula: {
      expr: "compare(typeMultiplier.value, cmp, n)  (the running number the engine hands to the hook; asking the chart again would call this very ability again)",
      source:
        "src/field/pokemon.ts:4204 (TypeMultiplierAbAttrParams.typeMultiplier); requests B01 R-B01-14, B08 R-B08-37",
    },
    synonyms: [
      "matchup so far",
      "type effectiveness",
      "super effective",
      "wonder guard",
      "anticipation",
      "weakness check",
    ],
    examples: ["Only block moves that are not super effective, like Wonder Guard"],
  },
  {
    id: "move.inflicts-status",
    group: "Move",
    label: "The move can inflict {status}",
    requires: ["move"],
    params: [selectParam("status", "Which status", STATUS_OPTIONS, "BURN")],
    pure: true,
    formula: {
      expr: 'move.getAttrs("StatusEffectAttr").some(a => a.effect === status) ; for FREEZE also move.getAttrs("AddBattlerTagAttr").some(a => a.tagType === BattlerTagType.ER_FROSTBITE)',
      source: "src/data/elite-redux/archetypes/status-chance-multiplier.ts StatusChanceMultiplierAbAttr.gate",
    },
    synonyms: ["burn move", "paralysis move", "can burn", "status chance", "pyromancy", "cryomancy"],
    examples: ["Boost the chance of burn moves, like Pyromancy"],
  },
  {
    id: "move.ability-can-change-type",
    group: "Move",
    label: "An ability is allowed to change this move's type",
    requires: ["move"],
    params: [],
    pure: true,
    formula: {
      expr: "!noAbilityTypeOverrideMoves.has(move.id)  (Weather Ball, Judgment, Revelation Dance, Multi-Attack, Terrain Pulse, Natural Gift, Techno Blast, Hidden Power)",
      source:
        "src/data/moves/invalid-moves.ts:253 noAbilityTypeOverrideMoves (the engine's own set, so the two cannot drift)",
    },
    synonyms: ["type can change", "normalize", "aerilate", "pixilate", "type conversion", "fixed type move"],
    examples: ["Turn Normal moves into Fairy moves, but leave Judgment alone"],
  },
  {
    id: "mon.is-first-ally",
    group: "Pokemon",
    label: "The other Pokemon is my partner on the field",
    requires: ["other"],
    params: [],
    pure: true,
    formula: { expr: "holder.getAlly() === other", source: `${POKEMON_TS}:5375 getAlly (getAllies()[0])` },
    synonyms: ["partner", "my ally", "teammate", "telepathy", "doubles partner"],
    examples: ["Ignore attacks from my partner, like Telepathy"],
  },

  // ---- Field ----------------------------------------------------------------------------
  {
    id: "field.weather-in-effect",
    group: "Field",
    label: "One of these weathers is on and not switched off",
    requires: ["holder"],
    params: [
      textParam("weathers", "Weathers (comma separated list)", "RAIN,HEAVY_RAIN"),
      booleanParam("reapAndSow", "Grassy Terrain counts as sun for a Reap and Sow Pokemon", false),
    ],
    pure: true,
    formula: {
      expr:
        "plain: w = arena.weather; !!w && !w.isEffectSuppressed() && weathers.includes(w.weatherType) ; "
        + "reapAndSow: exactly getWeatherCondition(...weathers)(holder)",
      source:
        "src/data/abilities/ab-attrs.ts:8493 getWeatherCondition; weather-stat-multiplier.ts isWeatherActive; weather-terrain-interaction.ts weatherListIsActive",
    },
    synonyms: ["raining", "sunny", "sandstorm", "hail", "cloud nine", "weather active", "rain dish"],
    examples: ["Heal at the end of every turn while it rains, unless Cloud Nine is out"],
  },
  {
    id: "field.weather-lasting",
    group: "Field",
    label: "A lasting weather is on (it never runs out)",
    requires: [],
    params: [],
    pure: true,
    formula: {
      expr: "arena.weather?.isImmutable() ?? false  (Harsh sunlight, Heavy rain, Strong winds)",
      source:
        "src/data/weather.ts Weather.isImmutable; src/data/abilities/ab-attrs.ts PostBiomeChangeWeatherChangeAbAttr",
    },
    synonyms: ["permanent weather", "primal weather", "desolate land", "primordial sea", "delta stream"],
    examples: ["Keep the weather change from replacing an extreme weather"],
  },
  {
    id: "field.weather-fog",
    group: "Field",
    label: "Fog or eerie fog is on",
    requires: [],
    params: [],
    pure: true,
    formula: {
      expr: "isFogWeather(arena.weather?.weatherType)  (FOG or EERIE_FOG)",
      source: "src/data/weather.ts:45 isFogWeather",
    },
    synonyms: ["foggy", "mist", "fog weather", "eerie fog", "dense fog"],
    examples: ["Boost power while the field is covered in fog"],
  },
  {
    id: "field.terrain-unhidden",
    group: "Field",
    label: "One of these terrains is really there, even if hidden",
    requires: [],
    params: [textParam("terrains", "Terrains (comma separated list)", "GRASSY")],
    pure: true,
    formula: {
      expr: "!!arena.terrain?.terrainType && terrains.includes(arena.terrain.terrainType)  (the raw terrain object)",
      source: `${ARENA_TS}:245 (arena.terrainType returns NONE while Clueless hides it; this reads arena.terrain directly)`,
    },
    synonyms: ["terrain", "grassy terrain", "electric terrain", "ignores clueless", "real terrain"],
    examples: ["Boost Grass moves on Grassy Terrain even when Clueless hides the terrain"],
  },
  {
    id: "field.terrain-just-set",
    group: "Field",
    label: "The terrain that was just set is one of these",
    requires: ["terrain"],
    params: [textParam("terrains", "Terrains (comma separated list)", "ELECTRIC")],
    pure: true,
    formula: {
      expr: "terrains.includes(frame.terrain)  (the terrain the trigger passed, not the arena's current one)",
      source: "src/data/abilities/ab-attrs.ts PostTerrainChangeAddBattlerTagAttr.gate",
    },
    synonyms: ["terrain changed", "new terrain", "terrain set", "quark drive", "terrain start"],
    examples: ["Gain a boost when Electric Terrain is set, like Quark Drive"],
  },

  // ---- Status and battle effects ----------------------------------------------------------
  {
    id: "status.has-any",
    group: "Status",
    label: "{who} has one of these status problems",
    requires: [],
    whoParam: "who",
    params: [WHO(), textParam("statuses", "Status problems (comma separated list, empty = any status problem)", "")],
    pure: true,
    formula: {
      expr: "pokemon.status != null && (list is empty || list.includes(pokemon.status.effect))",
      source: "src/data/abilities/ab-attrs.ts PostSummonHealStatusAbAttr.gate (15 users)",
    },
    synonyms: ["has a status", "any status", "poisoned or burned", "status problem", "limber", "insomnia"],
    examples: ["Cure paralysis or burn when I come in, like Limber"],
  },
  {
    id: "tag.has-any",
    group: "Status",
    label: "{who} is affected by one of these battle effects",
    requires: [],
    whoParam: "who",
    params: [WHO(), textParam("tags", "Battle effects (comma separated list)", "CONFUSED")],
    pure: true,
    formula: {
      expr: "tags.some(t => !!pokemon.getTag(BattlerTagType[t]))",
      source: "src/data/abilities/ab-attrs.ts PostSummonRemoveBattlerTagAbAttr.gate",
    },
    synonyms: ["confused or infatuated", "has an effect", "any of these effects", "own tempo", "oblivious"],
    examples: ["Remove confusion or infatuation when I come in, like Own Tempo"],
  },
  {
    id: "status.just-set",
    group: "Status",
    label: "The status I just got is one of these",
    requires: ["status"],
    params: [textParam("statuses", "Status problems (comma separated list)", "BURN,PARALYSIS,POISON,TOXIC")],
    pure: true,
    formula: {
      expr: "list.includes(frame.status)  (the status the trigger passed; status.has reads the current status instead)",
      source: "src/data/abilities/ab-attrs.ts SynchronizeStatusAbAttr.gate (new Set([BURN, PARALYSIS, POISON, TOXIC]))",
    },
    synonyms: ["just got burned", "new status", "status arrived", "synchronize", "got poisoned"],
    examples: ["Pass burn, paralysis and poison to the attacker, like Synchronize"],
  },

  // ---- Pokemon --------------------------------------------------------------------------
  {
    id: "mon.fainted",
    group: "Pokemon",
    label: "{who} has fainted",
    requires: [],
    whoParam: "who",
    params: [WHO("other")],
    pure: true,
    formula: { expr: "pokemon.isFainted()", source: `${POKEMON_TS} isFainted` },
    synonyms: ["knocked out", "dead", "down", "is fainted", "ko'd"],
    examples: ["Only if the other Pokemon already fainted"],
  },
  {
    id: "mon.level",
    group: "Pokemon",
    label: "{who}'s level is {cmp} {n}",
    requires: [],
    whoParam: "who",
    params: [WHO(), CMP(), numberParam("n", "Level (1-100)", 20, 1, 100, 1, true)],
    pure: true,
    formula: {
      expr: "compare(pokemon.level, cmp, n)",
      source: `${POKEMON_TS} level; init-abilities.ts Schooling closure`,
    },
    synonyms: ["level", "low level", "high level", "lv", "schooling"],
    examples: ["Stay in the small form below level 20, like Schooling"],
  },
  {
    id: "mon.form-number",
    group: "Pokemon",
    label: "{who}'s form number is {cmp} {n}",
    requires: [],
    whoParam: "who",
    params: [WHO(), CMP(), numberParam("n", "Form number (0 = base form)", 0, 0, 40, 1, true)],
    pure: true,
    formula: {
      expr: "compare(pokemon.formIndex, cmp, n)  (the form NUMBER; mon.in-form compares the form key text)",
      source: `${POKEMON_TS}:487 formIndex; init-abilities.ts Zen Mode, Shields Down, Schooling closures`,
    },
    synonyms: ["form", "form number", "which form", "base form", "shields down", "zen mode"],
    examples: ["Only while I am still in my base form"],
  },
  {
    id: "mon.terastallized",
    group: "Pokemon",
    label: "{who} is Terastallized",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: { expr: "pokemon.isTerastallized", source: `${POKEMON_TS}:542 isTerastallized` },
    synonyms: ["tera", "terastallized", "tera form", "crowned"],
    examples: ["Only while I am Terastallized"],
  },

  // ---- Party ----------------------------------------------------------------------------
  {
    id: "party.ally-active",
    group: "Party",
    label: "I have an ally that can still fight",
    requires: ["holder"],
    params: [],
    pure: true,
    formula: {
      expr: "!!pokemon.getAlly()?.isActive(true)  (allowed in battle and not fainted)",
      source: `${POKEMON_TS}:899 isActive; party.ally-exists only asks getAlly() !== undefined`,
    },
    synonyms: ["ally can fight", "partner alive", "ally standing", "costar", "teammate alive"],
    examples: ["Copy my ally's stat changes only while my ally is still fighting"],
  },
  {
    id: "party.multi-battle",
    group: "Party",
    label: "More than one Pokemon fights on each side",
    requires: [],
    params: [],
    pure: true,
    formula: {
      expr: "currentBattle.getBattlerCount() > 1  (party.doubles reads battle.double, false in a triple battle)",
      source: "src/battle.ts:292 getBattlerCount",
    },
    synonyms: ["double or triple battle", "multi battle", "more than one each side", "team battle"],
    examples: ["Only in battles with several Pokemon per side"],
  },
  {
    id: "party.bench-count",
    group: "Party",
    label: "{cmp} {n} healthy Pokemon of mine are waiting on the bench",
    requires: ["holder"],
    params: [CMP(), numberParam("n", "Number of Pokemon (0-5)", 1, 0, 5, 1, true)],
    pure: true,
    formula: {
      expr: "compare(party.filter(m => !m.isFainted() && !m.isOnField()).length, cmp, n)  (the holder's own party)",
      source: "src/data/elite-redux/abilities/newcomer-signature-mechanics.ts livingBenchCount (Fan Favorite)",
    },
    synonyms: ["benched", "reserves", "backup", "teammates waiting", "party members left"],
    examples: ["Get stronger for each healthy Pokemon waiting on the bench"],
  },

  // ---- Time and memory -------------------------------------------------------------------
  {
    id: "time.turn-count-multiple",
    group: "Time",
    label: "It is every {n}th turn I have been out",
    requires: [],
    params: [numberParam("n", "Every how many turns (1-10)", 2, 1, 10, 1, true)],
    pure: true,
    formula: {
      expr: "turn > 0 && turn % n === 0, turn = holder.tempSummonData?.turnCount ?? 0",
      source: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts SomniloquyPostTurnAbAttr.gate",
    },
    synonyms: ["every other turn", "every third turn", "every n turns", "periodic", "on a cycle"],
    examples: ["Do something every second turn I am out"],
  },
  {
    id: "time.switched-in-this-turn",
    group: "Time",
    label: "{who} switched in this turn",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: {
      expr: "pokemon.turnData.switchedInThisTurn  (not the same as time.first-turn, which is a turn counter)",
      source: "src/data/abilities/ab-attrs.ts SpeedBoostAbAttr.gate; src/data/pokemon/pokemon-data.ts:674",
    },
    synonyms: ["just switched in", "just arrived", "came in this turn", "fresh entry", "new arrival"],
    examples: ["Do not boost speed on the turn I switched in, like Speed Boost"],
  },
  {
    id: "time.failed-run-away",
    group: "Time",
    label: "{who} failed to run away this turn",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: {
      expr: "pokemon.turnData.failedRunAway",
      source: "src/data/abilities/ab-attrs.ts SpeedBoostAbAttr.gate; src/data/pokemon/pokemon-data.ts:666",
    },
    synonyms: ["could not flee", "failed to escape", "run failed", "flee failed"],
    examples: ["Do not boost speed after a failed escape attempt"],
  },
  {
    id: "time.last-move-result",
    group: "Time",
    label: "The result of {who}'s last move is {result}",
    requires: [],
    whoParam: "who",
    params: [
      WHO(),
      selectParam("result", "How the move went", ["SUCCESS", "FAIL", "MISS", "OTHER"], "SUCCESS"),
      booleanParam("negate", "Answer yes when the result is anything but this one", false),
    ],
    pure: true,
    formula: {
      expr: "r = pokemon.getLastXMoves(1)[0]?.result ; negate ? r !== MoveResult[result] : r === MoveResult[result]",
      source: "src/field/pokemon.ts getLastXMoves; src/enums/move-result.ts; request B17 R17",
    },
    synonyms: ["last move worked", "last move missed", "last move failed", "previous move result"],
    examples: ["Only if my last move did not fail"],
  },
  {
    id: "time.last-move-was-follow-up",
    group: "Time",
    label: "{who}'s last move was a free follow-up from an ability",
    requires: [],
    whoParam: "who",
    params: [WHO()],
    pure: true,
    formula: {
      expr: "pokemon.getLastXMoves(1)[0]?.useMode === MoveUseMode.INDIRECT",
      source: "src/enums/move-use-mode.ts INDIRECT; request B17 R17",
    },
    synonyms: ["echo move", "scripted move", "extra move", "bonus move", "follow up"],
    examples: ["Skip when the last move was only an extra move from an ability"],
  },
  {
    id: "time.marker-set",
    group: "Time",
    label: "A marker called {key} is set on {who}",
    requires: [],
    whoParam: "who",
    params: [
      WHO(),
      selectParam("scope", "How long the marker lasts", ["battle", "switch-in", "turn"], "battle"),
      textParam("key", "Marker name", "marker"),
      selectParam("match", "Match the name", ["exact", "prefix"], "exact"),
    ],
    pure: true,
    formula: {
      expr:
        "data = scope battle ? pokemon.battleData : switch-in ? pokemon.summonData : pokemon.turnData ; "
        + "exact: data.erAbilityProvenance.includes(key) ; prefix: data.erAbilityProvenance.some(v => v.startsWith(key)). Never writes.",
      source:
        "src/data/pokemon/pokemon-data.ts:322, :533, :686 erAbilityProvenance; fakemon-pitch-mechanics.ts:630, :664",
    },
    synonyms: ["marker", "flag", "memory", "already marked", "remembered", "tagged"],
    examples: ["Only if my entry marker is not set yet"],
  },

  // ---- Chance ---------------------------------------------------------------------------
  {
    id: "rng.chance-float",
    group: "Chance",
    label: "{pct}% chance, rolled as a decimal number",
    requires: [],
    params: [numberParam("pct", "Chance (%)", 50, 1, 100, 1, true)],
    pure: false,
    formula: {
      expr: "pass = randSeedFloat() (ONE draw from the global stream, always, even at 100) ; pct / 100 >= pass",
      source: "src/data/abilities/ab-attrs.ts PostTurnRestoreBerryAbAttr.canApply (procChance(pokemon) >= pass)",
    },
    synonyms: ["random decimal roll", "chance roll", "percent chance", "luck", "harvest chance"],
    examples: ["50% chance to bring a berry back each turn"],
  },
];
