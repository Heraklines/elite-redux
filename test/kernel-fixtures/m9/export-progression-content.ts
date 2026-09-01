import { EVOLVE_MOVE, RELEARN_MOVE } from "#app/constants";
import { pokemonEvolutions, EvolutionItem, EvoCondKey } from "#balance/pokemon-evolutions";
import { speciesTmMoves } from "#balance/tms";
import { allSpecies } from "#data/data-lists";
import { getLevelTotalExp, GrowthRate } from "#data/exp";
import { getNatureStatMultiplier } from "#data/nature";
import { getPokeballCatchMultiplier } from "#data/pokeball";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { EFFECTIVE_STATS, Stat } from "#enums/stat";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test } from "vitest";

const ORACLE_SHA = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const OUTPUT = process.env.M9_PROGRESSION_CONTENT_OUTPUT;
const SEED = "m9-progression-content-v2";

let game: Phaser.Game | null = null;
let manager: GameManager | null = null;

afterAll(() => {
  manager = null;
  game?.destroy(true);
  game = null;
});

function numericEnumValues(values: Record<string, string | number>): number[] {
  return Object.values(values).filter((value): value is number => typeof value === "number").toSorted((a, b) => a - b);
}

function gcd(left: number, right: number): number {
  while (right !== 0) {
    [left, right] = [right, left % right];
  }
  return Math.abs(left);
}

function rational(value: number): { numerator: number; denominator: number } {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid positive multiplier ${value}`);
  }
  const text = value.toString();
  const digits = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
  const denominator = 10 ** digits;
  const numerator = Math.round(value * denominator);
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function growthRates() {
  return numericEnumValues(GrowthRate).map(id => ({
    id,
    experience_by_level: Array.from({ length: 100 }, (_, index) => getLevelTotalExp(index + 1, id)),
  }));
}

function natures() {
  return numericEnumValues(Nature).map(id => {
    const increased = EFFECTIVE_STATS.find(stat => getNatureStatMultiplier(id, stat) > 1) ?? null;
    const decreased = EFFECTIVE_STATS.find(stat => getNatureStatMultiplier(id, stat) < 1) ?? null;
    return { id, increased_stat: increased, decreased_stat: decreased };
  });
}

function captureBalls() {
  return numericEnumValues(PokeballType).map(type => {
    const multiplier = getPokeballCatchMultiplier(type);
    const guaranteed = multiplier < 0;
    const ratio = guaranteed ? { numerator: 1, denominator: 1 } : rational(multiplier);
    return {
      item_id: type + 1,
      registry_key: PokeballType[type],
      catch_multiplier_numerator: ratio.numerator,
      catch_multiplier_denominator: ratio.denominator,
      guaranteed,
    };
  });
}

type SpeciesForm = (typeof allSpecies)[number];

function tmMoves(speciesId: number, form: SpeciesForm): number[] {
  const moves = speciesTmMoves[speciesId] ?? [];
  const selected = moves.flatMap(entry => {
    if (!Array.isArray(entry)) {
      return [entry];
    }
    const [qualifier, move] = entry;
    if (typeof qualifier === "string") {
      return form.formKey === qualifier ? [move] : [];
    }
    return form.speciesId === qualifier ? [move] : [];
  });
  return [...new Set(selected.filter(move => Number.isSafeInteger(move) && move > 0))].toSorted((a, b) => a - b);
}

function speciesDefinitions() {
  return allSpecies
    .filter(species => species != null && Number.isSafeInteger(species.speciesId) && species.speciesId > 0)
    .flatMap(species => [species, ...species.forms].map((form, formIndex) => {
      const levelMoves = form
        .getLevelMoves()
        .filter(([level, moveId]) => Number.isSafeInteger(level) && Number.isSafeInteger(moveId) && moveId > 0)
        .map(([level, moveId]) => ({ level, move_id: moveId }));
      return {
        species_id: species.speciesId,
        form_index: formIndex,
        form_key: form.formKey ?? null,
        growth_rate: species.growthRate,
        base_friendship: species.baseFriendship,
        catch_rate: species.catchRate,
        level_moves: levelMoves,
        reminder_moves: [...new Set(levelMoves.filter(entry => entry.level === RELEARN_MOVE).map(entry => entry.move_id))]
          .toSorted((a, b) => a - b),
        evolution_moves: [...new Set(levelMoves.filter(entry => entry.level === EVOLVE_MOVE).map(entry => entry.move_id))]
          .toSorted((a, b) => a - b),
        tm_moves: tmMoves(species.speciesId, form),
      };
    }))
    .toSorted((left, right) => left.species_id - right.species_id || left.form_index - right.form_index);
}

function formIndex(speciesById: Map<number, SpeciesForm>, speciesId: number, formKey: string | null): number {
  if (formKey == null || formKey.length === 0) {
    return 0;
  }
  const species = speciesById.get(speciesId);
  if (species == null) {
    throw new Error(`evolution references unknown species ${speciesId}`);
  }
  if (species.formKey === formKey) {
    return 0;
  }
  const index = species.forms.findIndex(form => form.formKey === formKey);
  if (index < 0) {
    throw new Error(`evolution references unknown form ${speciesId}/${formKey}`);
  }
  return index + 1;
}

function evolutionDefinitions() {
  const speciesById = new Map(allSpecies.filter(Boolean).map(species => [species.speciesId, species]));
  let id = 1;
  return Object.entries(pokemonEvolutions)
    .map(([source, evolutions]) => [Number(source), evolutions] as const)
    .toSorted(([left], [right]) => left - right)
    .flatMap(([sourceSpecies, evolutions]) => evolutions.map(evolution => ({
      id: id++,
      source_species: sourceSpecies,
      source_form: evolution.preFormKey == null ? null : formIndex(speciesById, sourceSpecies, evolution.preFormKey),
      source_form_key: evolution.preFormKey,
      target_species: evolution.speciesId,
      target_form: formIndex(speciesById, evolution.speciesId, evolution.evoFormKey),
      target_form_key: evolution.evoFormKey,
      minimum_level: evolution.level,
      evolution_item: evolution.item ?? EvolutionItem.NONE,
      evolution_item_key: EvolutionItem[evolution.item ?? EvolutionItem.NONE],
      conditions: evolution.condition?.data ?? [],
    })));
}

test("export complete pinned progression definitions", async () => {
  if (OUTPUT == null) {
    throw new Error("M9_PROGRESSION_CONTENT_OUTPUT is required");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  expect(head).toBe(ORACLE_SHA);
  expect(Object.keys(EvoCondKey)).toHaveLength(15);

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
    special_learnset_levels: { relearn: RELEARN_MOVE, evolution: EVOLVE_MOVE },
    stat_names: Object.fromEntries(EFFECTIVE_STATS.map(stat => [stat, Stat[stat]])),
    evolution_condition_keys: EvoCondKey,
    growth_rates: growthRates(),
    natures: natures(),
    capture_balls: captureBalls(),
    species: speciesDefinitions(),
    evolutions: evolutionDefinitions(),
  };
  writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`, "utf8");
});
