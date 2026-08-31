import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import { getTypeDamageMultiplier } from "#data/type";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveTarget } from "#enums/move-target";
import { MAX_POKEMON_TYPE, PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test } from "vitest";

const ORACLE_SHA = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const OUTPUT = process.env.M9_COMPLETE_CONTENT_OUTPUT;
const SEED = "m9-complete-content-v1";

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

function enumName(values: Record<string, string | number>, value: number, label: string): string {
  const name = values[value];
  if (typeof name !== "string") {
    throw new Error(`${label} enum value ${value} is unobservable`);
  }
  return name;
}

const flagMap: ReadonlyArray<readonly [MoveFlags, string]> = [
  [MoveFlags.MAKES_CONTACT, "CONTACT"],
  [MoveFlags.IGNORE_PROTECT, "IGNORE_PROTECT"],
  [MoveFlags.SOUND_BASED, "SOUND_BASED"],
  [MoveFlags.HIDE_USER, "HIDE_USER"],
  [MoveFlags.HIDE_TARGET, "HIDE_TARGET"],
  [MoveFlags.BITING_MOVE, "BITING"],
  [MoveFlags.PULSE_MOVE, "PULSE"],
  [MoveFlags.PUNCHING_MOVE, "PUNCHING"],
  [MoveFlags.SLICING_MOVE, "SLICING"],
  [MoveFlags.RECKLESS_MOVE, "RECKLESS"],
  [MoveFlags.BALLBOMB_MOVE, "BALL_BOMB"],
  [MoveFlags.POWDER_MOVE, "POWDER"],
  [MoveFlags.DANCE_MOVE, "DANCE"],
  [MoveFlags.WIND_MOVE, "WIND"],
  [MoveFlags.TRIAGE_MOVE, "TRIAGE"],
  [MoveFlags.IGNORE_ABILITIES, "IGNORE_ABILITIES"],
  [MoveFlags.CHECK_ALL_HITS, "CHECK_ALL_HITS"],
  [MoveFlags.IGNORE_SUBSTITUTE, "IGNORE_SUBSTITUTE"],
  [MoveFlags.REFLECTABLE, "REFLECTABLE"],
  [MoveFlags.GRAVITY, "GRAVITY"],
  [MoveFlags.AIR_BASED, "AIR_BASED"],
  [MoveFlags.ARROW_BASED, "ARROW_BASED"],
  [MoveFlags.BONE_BASED, "BONE_BASED"],
  [MoveFlags.DRILL_BASED, "DRILL_BASED"],
  [MoveFlags.FIELD_BASED, "FIELD_BASED"],
  [MoveFlags.HAMMER_BASED, "HAMMER_BASED"],
  [MoveFlags.HORN_BASED, "HORN_BASED"],
  [MoveFlags.KICKING_MOVE, "KICKING"],
  [MoveFlags.LUNAR_MOVE, "LUNAR"],
  [MoveFlags.THROW_BASED, "THROW_BASED"],
  [MoveFlags.WEATHER_BASED, "WEATHER_BASED"],
];

function formDefinition(form: (typeof allSpecies)[number], formIndex: number, fallbackType: PokemonType) {
  const types = [form.type1, form.type2]
    .filter((value): value is PokemonType => value != null && value !== PokemonType.UNKNOWN)
    .map(value => enumName(PokemonType, value, "species type"));
  return {
    form_index: formIndex,
    base_stats: [...form.baseStats],
    type_names: types.length === 0 ? [enumName(PokemonType, fallbackType, "fallback species type")] : types,
    weight_hectograms: Math.round(form.weight * 10),
    active_ability_ids: [form.ability1, form.ability2, form.abilityHidden],
  };
}

function speciesDefinitions() {
  return allSpecies
    .filter(species => species != null && Number.isSafeInteger(species.speciesId) && species.speciesId > 0)
    .map(species => {
      const forms = [formDefinition(species, 0, species.type1)];
      species.forms.forEach((form, index) => forms.push(formDefinition(form, index + 1, species.type1)));
      return {
        species_id: species.speciesId,
        canonical_form_index: 0,
        passive_ability_ids: [...species.getPassiveAbilities(0)],
        level_moves: species.getLevelMoves().map(([level, moveId]) => ({ level, move_id: moveId })),
        forms,
      };
    })
    .toSorted((left, right) => left.species_id - right.species_id);
}

function moveDefinitions() {
  return allMoves
    .filter(move => move != null && Number.isSafeInteger(move.id) && move.id > 0)
    .map(move => ({
      id: move.id,
      name: move.name,
      category: enumName(MoveCategory, move.category, `move ${move.id} category`),
      move_type: enumName(PokemonType, move.type, `move ${move.id} type`),
      power: move.power < 0 ? { kind: "NONE" } : { kind: "VALUE", value: move.power },
      accuracy: move.accuracy < 0 ? { kind: "ALWAYS_HITS" } : { kind: "PERCENT", value: move.accuracy },
      base_pp: move.pp,
      effect_chance: move.chance < 0 ? { kind: "NONE" } : { kind: "PERCENT", value: move.chance },
      priority: move.priority,
      target: enumName(MoveTarget, move.moveTarget, `move ${move.id} target`),
      flags: flagMap.filter(([flag]) => move.hasFlag(flag)).map(([, name]) => name),
    }))
    .toSorted((left, right) => left.id - right.id);
}

function abilityDefinitions() {
  return allAbilities
    .filter(ability => ability != null && Number.isSafeInteger(ability.id) && ability.id >= 0)
    .map(ability => ({ id: ability.id, name: ability.name }))
    .toSorted((left, right) => left.id - right.id);
}

function typeChart() {
  const entries: Array<{ attack: string; defense: string; multiplier: string }> = [];
  for (let attack = PokemonType.NORMAL; attack <= MAX_POKEMON_TYPE; attack += 1) {
    for (let defense = PokemonType.NORMAL; defense <= MAX_POKEMON_TYPE; defense += 1) {
      const multiplier = getTypeDamageMultiplier(attack, defense);
      if (multiplier === 1) {
        continue;
      }
      entries.push({
        attack: enumName(PokemonType, attack, "attack type"),
        defense: enumName(PokemonType, defense, "defense type"),
        multiplier: multiplier === 0 ? "ZERO" : multiplier === 0.5 ? "HALF" : "TWO",
      });
    }
  }
  return entries;
}

test("export complete pinned battle definitions", async () => {
  if (OUTPUT == null) {
    throw new Error("M9_COMPLETE_CONTENT_OUTPUT is required");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  expect(head).toBe(ORACLE_SHA);
  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: [SEED] });
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
  await manager.classicMode.startBattle(SpeciesId.BULBASAUR);

  const output = {
    schema_version: 1,
    oracle_sha: ORACLE_SHA,
    species: speciesDefinitions(),
    moves: moveDefinitions(),
    abilities: abilityDefinitions(),
    type_chart: typeChart(),
  };
  writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`, "utf8");
});
