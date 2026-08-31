import { getGameMode } from "#app/game-mode";
import { speciesStarterCosts } from "#balance/starters";
import { allAbilities, allMoves } from "#data/data-lists";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test } from "vitest";

const ORACLE_SHA = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const OUTPUT = process.env.M9_BOOTSTRAP_ORACLE_OUTPUT;
const SEED = "m9-real-starter-v1";

let game: Phaser.Game | null = null;
let manager: GameManager | null = null;

afterAll(() => {
  manager?.promptHandler.clearPrompts();
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  game?.destroy(true);
});

function pokemon(mon: PlayerPokemon) {
  return {
    id: mon.id,
    species_id: mon.species.speciesId,
    form_index: mon.formIndex,
    level: mon.level,
    experience: mon.exp,
    ability_index: mon.abilityIndex,
    ability_id: mon.getAbility().id,
    passive_ability_ids: [...mon.species.getPassiveAbilities(mon.formIndex)],
    passive_enabled: mon.hasPassive(),
    ivs: [...mon.ivs],
    nature: mon.getNature(),
    gender: mon.gender,
    friendship: mon.friendship,
    shiny: mon.shiny,
    variant: mon.variant,
    pause_evolutions: mon.pauseEvolutions,
    tera_type: mon.teraType,
    tera_type_name: enumName(PokemonType, mon.teraType, `pokemon ${mon.id} tera type`),
    types: mon.getTypes(false),
    type_names: mon.getTypes(false).map(type => enumName(PokemonType, type, `pokemon ${mon.id} type`)),
    stats: [...mon.stats],
    hp: mon.hp,
    max_hp: mon.getMaxHp(),
    moves: mon.getMoveset().map(move => ({
      move_id: move.moveId,
      pp_used: move.ppUsed,
      max_pp: move.getMovePp(),
    })),
  };
}

function enumName(values: Record<string, string | number>, value: number, label: string) {
  const name = values[value];
  if (typeof name !== "string") {
    throw new Error(`${label} enum value ${value} is unobservable`);
  }
  return name;
}

function moveDefinition(id: number) {
  const move = allMoves[id];
  if (move == null || move.id !== id) {
    throw new Error(`reachable move ${id} is absent after pinned initialization`);
  }
  const flagMap: ReadonlyArray<readonly [MoveFlags, string]> = [
    [MoveFlags.MAKES_CONTACT, "CONTACT"],
    [MoveFlags.BITING_MOVE, "BITING"],
    [MoveFlags.POWDER_MOVE, "POWDER"],
    [MoveFlags.IGNORE_SUBSTITUTE, "IGNORE_SUBSTITUTE"],
    [MoveFlags.REFLECTABLE, "REFLECTABLE"],
  ];
  return {
    id,
    name: move.name,
    category: enumName(MoveCategory, move.category, `move ${id} category`),
    move_type: enumName(PokemonType, move.type, `move ${id} type`),
    power: move.power < 0 ? { kind: "NONE" } : { kind: "VALUE", value: move.power },
    accuracy: move.accuracy < 0 ? { kind: "ALWAYS_HITS" } : { kind: "PERCENT", value: move.accuracy },
    base_pp: move.pp,
    effect_chance: move.chance < 0 ? { kind: "NONE" } : { kind: "PERCENT", value: move.chance },
    priority: move.priority,
    target: enumName(MoveTarget, move.moveTarget, `move ${id} target`),
    flags: flagMap.filter(([flag]) => move.hasFlag(flag)).map(([, name]) => name),
  };
}

function speciesDefinition(mon: PlayerPokemon) {
  const species = mon.species;
  return {
    species_id: species.speciesId,
    form_index: mon.formIndex,
    base_stats: [...species.baseStats],
    types: [species.type1, species.type2],
    type_names: [
      enumName(PokemonType, species.type1, `species ${species.speciesId} primary type`),
      enumName(PokemonType, species.type2, `species ${species.speciesId} secondary type`),
    ],
    weight: species.weight,
    weight_hectograms: Math.round(species.weight * 10),
    selected_active_ability_id: mon.getAbility().id,
    active_ability_ids: [species.ability1, species.ability2, species.abilityHidden],
    passive_ability_ids: [...species.getPassiveAbilities(mon.formIndex)],
    passive_enabled: mon.hasPassive(),
  };
}

function abilityDefinition(id: number) {
  const ability = allAbilities.find(candidate => candidate?.id === id);
  if (ability == null) {
    throw new Error(`reachable ability ${id} is absent after pinned initialization`);
  }
  return { id, name: ability.name };
}
test("export pinned natural Bulbasaur starter and first encounter", async () => {
  if (OUTPUT == null) {
    throw new Error("M9_BOOTSTRAP_ORACLE_OUTPUT is required");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  expect(head).toBe(ORACLE_SHA);

  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: [SEED] });
  // Phaser's headless scene registration publishes on the next platform task; it exposes no readiness promise.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  manager = new GameManager(game);
  manager.override.disableShinies = false;
  manager.override.normalizeIVs = false;
  manager.override.normalizeNatures = false;
  manager.override
    .shiny(null)
    .enemyShiny(null)
    .playerIVs(null)
    .enemyIVs(null)
    .nature(null)
    .enemyNature(null)
    .battleStyle(BattleStyle.SET)
    .startingBiome(BiomeId.TOWN)
    .startingWave(1)
    .seed(SEED);

  const rng = Phaser.Math.RND;
  rng.sow([SEED]);
  const originalIntegerInRange = rng.integerInRange.bind(rng);
  const draws: Array<{
    sequence: number;
    min: number;
    max: number;
    result: number;
    before_state: string;
    after_state: string;
    callsite: string;
  }> = [];
  rng.integerInRange = (min: number, max: number) => {
    const beforeState = rng.state();
    const result = originalIntegerInRange(min, max);
    const stack =
      new Error("M9 bootstrap RNG callsite").stack
        ?.split("\n")
        .map(line => line.trim())
        .find(line => line.includes("/src/")) ?? "UNOBSERVED";
    draws.push({
      sequence: draws.length,
      min,
      max,
      result,
      before_state: beforeState,
      after_state: rng.state(),
      callsite: stack,
    });
    return result;
  };

  const beforeState = rng.state();
  try {
    await manager.classicMode.startBattle(SpeciesId.BULBASAUR);
  } finally {
    rng.integerInRange = originalIntegerInRange;
  }
  const afterState = rng.state();
  const player = manager.scene.getPlayerParty()[0];
  const enemy = manager.scene.getEnemyParty()[0];
  expect(player).toBeDefined();
  expect(enemy).toBeDefined();
  if (player == null || enemy == null) {
    throw new Error("pinned starter encounter did not construct both parties");
  }

  const species = player.species;
  const mode = getGameMode(GameModes.CLASSIC);
  const levelMoves = species.getLevelMoves().map(([level, moveId]) => ({ level, move_id: moveId }));
  const reachablePokemon = [player, enemy];
  const reachableMoveIds = [
    ...new Set(reachablePokemon.flatMap(mon => mon.getMoveset().map(move => move.moveId))),
  ].toSorted((left, right) => left - right);
  const reachableAbilityIds = [
    ...new Set(
      reachablePokemon.flatMap(mon => [
        mon.getAbility().id,
        ...(mon.hasPassive() ? mon.species.getPassiveAbilities(mon.formIndex) : []),
      ]),
    ),
  ].toSorted((left, right) => left - right);
  const battle = manager.scene.currentBattle;
  const output = {
    schema_version: 1,
    oracle_sha: ORACLE_SHA,
    seed: SEED,
    sources: [
      "src/data/balance/starters.ts:speciesStarterCosts",
      "src/data/balance/pokemon-level-moves.ts:pokemonSpeciesLevelMoves/pokemonFormLevelMoves",
      "src/data/pokemon-species.ts:PokemonSpecies",
      "src/data/elite-redux/init-elite-redux-species.ts",
      "src/data/elite-redux/init-elite-redux-movesets.ts",
      "src/ai/ai-moveset-gen.ts:generateMoveset",
      "src/field/pokemon.ts:PlayerPokemon",
      "src/data/moves/pokemon-move.ts:PokemonMove",
      "src/game-mode.ts:GameMode",
      "src/battle.ts:Battle.battleSeed/captureDeterministicRngState",
    ],
    mode: {
      mode_id: GameModes.CLASSIC,
      starting_level: mode.getStartingLevel(),
      starting_money: mode.getStartingMoney(),
      starting_biome_id: mode.getStartingBiome(),
    },
    starter: {
      species_id: SpeciesId.BULBASAUR,
      form_index: species.formIndex,
      starter_cost: speciesStarterCosts[SpeciesId.BULBASAUR],
      base_stats: [...species.baseStats],
      types: [species.type1, species.type2],
      active_ability_ids: [species.ability1, species.ability2, species.abilityHidden],
      passive_ability_ids: [...species.getPassiveAbilities(species.formIndex)],
      level_moves: levelMoves,
    },
    constructed_player: pokemon(player),
    generated_enemy: pokemon(enemy),
    battle: {
      wave_index: battle.waveIndex,
      turn: battle.turn,
      battle_seed: battle.battleSeed,
      rng_state: battle.captureDeterministicRngState(),
    },
    reachable_species: reachablePokemon
      .map(speciesDefinition)
      .toSorted((left, right) => left.species_id - right.species_id),
    reachable_moves: reachableMoveIds.map(moveDefinition),
    reachable_abilities: reachableAbilityIds.map(abilityDefinition),
    rng: {
      stream: "PHASER_GLOBAL_RUN",
      before_state: beforeState,
      after_state: afterState,
      draws,
    },
  };
  writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`, "utf8");
});
