import { allMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounters";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test } from "vitest";

const ORACLE_SHA = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const OUTPUT = process.env.M9_SCENARIO_CONTENT_OUTPUT;
const SEED = "m9-scenario-content-v2";
const CALLBACK_NAMES = [
  "onInit",
  "onVisualsStart",
  "onTurnStart",
  "onRewards",
  "doEncounterExp",
  "doEncounterRewards",
  "doContinueEncounter",
  "onGameOver",
] as const;
const OPTION_CALLBACK_NAMES = ["onPreOptionPhase", "onOptionPhase", "onPostOptionPhase"] as const;

let game: Phaser.Game | null = null;
let manager: GameManager | null = null;

afterAll(() => {
  manager = null;
  game?.destroy(true);
  game = null;
});

function callbackEvidence(value: unknown) {
  if (typeof value !== "function") {
    return null;
  }
  const source = Function.prototype.toString.call(value).replaceAll("\r\n", "\n");
  return {
    sha256: createHash("sha256").update(source).digest("hex"),
    async: source.startsWith("async") || source.includes("async "),
    source_length: source.length,
    starts_nested_battle: /\b(?:startBattle|initBattle|startFight|battlePhase)\b/.test(source),
  };
}

function serializableRequirement(value: unknown, seen = new Set<object>()): unknown {
  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`requirement contains non-finite number ${value}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(entry => serializableRequirement(entry, seen));
  }
  if (typeof value !== "object") {
    return undefined;
  }
  if (seen.has(value)) {
    throw new Error("requirement graph contains a cycle");
  }
  seen.add(value);
  const fields = Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => typeof field !== "function" && field !== undefined)
      .map(([key, field]) => [key, serializableRequirement(field, seen)])
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
  seen.delete(value);
  return { kind: value.constructor.name, fields };
}

function scenarioDefinitions() {
  const biomesByEncounter = new Map<number, number[]>();
  for (const [biome, encounters] of mysteryEncountersByBiome) {
    for (const encounter of encounters) {
      const biomes = biomesByEncounter.get(encounter) ?? [];
      biomes.push(biome);
      biomesByEncounter.set(encounter, biomes);
    }
  }
  return Object.entries(allMysteryEncounters)
    .map(([id, encounter]) => ({ id: Number(id), encounter }))
    .toSorted((left, right) => left.id - right.id)
    .map(({ id, encounter }) => ({
      id,
      key: MysteryEncounterType[id],
      localization_key: encounter.localizationKey,
      tier: encounter.encounterTier,
      biome_ids: [...new Set(biomesByEncounter.get(id) ?? [])].toSorted((a, b) => a - b),
      disallowed_game_modes: [...(encounter.disallowedGameModes ?? [])].toSorted((a, b) => a - b),
      disallowed_challenges: [...(encounter.disallowedChallenges ?? [])].toSorted((a, b) => a - b),
      flags: {
        hide_battle_intro_message: encounter.hideBattleIntroMessage,
        auto_hide_intro_visuals: encounter.autoHideIntroVisuals,
        enter_intro_visuals_from_right: encounter.enterIntroVisualsFromRight,
        catch_allowed: encounter.catchAllowed,
        flee_allowed: encounter.fleeAllowed,
        continuous_encounter: encounter.continuousEncounter,
        max_allowed_encounters: encounter.maxAllowedEncounters,
        has_battle_animations_without_targets: encounter.hasBattleAnimationsWithoutTargets,
        skip_enemy_battle_turns: encounter.skipEnemyBattleTurns,
        skip_to_fight_input: encounter.skipToFightInput,
        prevent_game_stats_updates: encounter.preventGameStatsUpdates,
      },
      requirements: encounter.requirements.map(requirement => serializableRequirement(requirement)),
      primary_pokemon_requirements: encounter.primaryPokemonRequirements.map(requirement => serializableRequirement(requirement)),
      secondary_pokemon_requirements: encounter.secondaryPokemonRequirements.map(requirement => serializableRequirement(requirement)),
      exclude_primary_from_support_requirements: encounter.excludePrimaryFromSupportRequirements,
      callbacks: Object.fromEntries(
        CALLBACK_NAMES.map(name => [name, callbackEvidence(encounter[name])]).filter(([, value]) => value != null),
      ),
      options: encounter.options.map((option, index) => ({
        option_index: index,
        option_mode: option.optionMode,
        has_dex_progress: option.hasDexProgress,
        exclude_primary_from_secondary_requirements: option.excludePrimaryFromSecondaryRequirements,
        requirements: option.requirements.map(requirement => serializableRequirement(requirement)),
        primary_pokemon_requirements: option.primaryPokemonRequirements.map(requirement => serializableRequirement(requirement)),
        secondary_pokemon_requirements: option.secondaryPokemonRequirements.map(requirement => serializableRequirement(requirement)),
        callbacks: Object.fromEntries(
          OPTION_CALLBACK_NAMES.map(name => [name, callbackEvidence(option[name])]).filter(([, value]) => value != null),
        ),
      })),
    }));
}

test("export complete pinned scenario definitions", async () => {
  if (OUTPUT == null) {
    throw new Error("M9_SCENARIO_CONTENT_OUTPUT is required");
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

  const scenarios = scenarioDefinitions();
  expect(scenarios.length).toBeGreaterThan(80);
  writeFileSync(
    OUTPUT,
    `${JSON.stringify({ schema_version: 2, oracle_sha: ORACLE_SHA, scenarios })}\n`,
    "utf8",
  );
});
