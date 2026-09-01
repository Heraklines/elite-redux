import { getGameMode } from "#app/game-mode";
import { ER_TRAINER_REGISTRY } from "#data/elite-redux/init-elite-redux-trainers";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerType } from "#enums/trainer-type";
import { GameModes } from "#enums/game-modes";
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
const OUTPUT = process.env.M9_AI_CONTENT_OUTPUT;
const SEED = "m9-ai-content-v2";

let game: Phaser.Game | null = null;
let manager: GameManager | null = null;

afterAll(() => {
  manager = null;
  game?.destroy(true);
  game = null;
});

function functionEvidence(value: unknown) {
  if (typeof value !== "function") {
    return null;
  }
  const source = Function.prototype.toString.call(value).replaceAll("\r\n", "\n");
  return {
    sha256: createHash("sha256").update(source).digest("hex"),
    async: source.startsWith("async") || source.includes("async "),
    source_length: source.length,
  };
}

function ratio(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid trainer multiplier ${value}`);
  }
  const text = value.toString();
  const digits = text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
  let denominator = 10 ** digits;
  let numerator = Math.round(value * denominator);
  let left = numerator;
  let right = denominator;
  while (right !== 0) {
    [left, right] = [right, left % right];
  }
  numerator /= left;
  denominator /= left;
  return { numerator, denominator };
}

function trainerProfiles() {
  return Object.entries(trainerConfigs)
    .map(([id, config]) => {
      const ai = config.trainerAI as unknown as {
        teraMode: number;
        teraLogic: Array<number | [number, () => boolean]>;
      };
      const instantTera = (ai.teraLogic ?? []).map(entry => {
        if (typeof entry === "number") {
          return { slot: entry, condition: null };
        }
        return { slot: entry[0], condition: functionEvidence(entry[1]) };
      });
      return {
        trainer_type: Number(id),
        key: config.getKey(),
        enum_key: TrainerType[Number(id)],
        has_genders: config.hasGenders,
        has_double: config.hasDouble,
        double_only: config.doubleOnly,
        is_boss: config.isBoss,
        has_static_party: config.hasStaticParty,
        use_same_seed_for_all_members: config.useSameSeedForAllMembers,
        allow_egg_moves: config.allowEggMoves,
        money_multiplier: ratio(config.moneyMultiplier),
        specialty_type: config.specialtyType ?? null,
        tera_mode: ai.teraMode,
        instant_tera: instantTera,
        party_template_count: config.partyTemplates.length,
        party_member_slots: Object.keys(config.partyMemberFuncs).map(Number).toSorted((a, b) => a - b),
        ai_callbacks: config.genAIFuncs.map(functionEvidence).filter(callback => callback != null),
      };
    })
    .toSorted((left, right) => left.trainer_type - right.trainer_type);
}

function registeredTrainerProfiles() {
  const member = (pokemon: (typeof ER_TRAINER_REGISTRY)[number]["party"][number]) => ({
    species_id: pokemon.speciesId,
    level: pokemon.level,
    ability_slot: pokemon.abilitySlot,
    ivs: [...pokemon.ivs],
    evs: [...pokemon.evs],
    item_id: pokemon.itemId,
    nature: pokemon.nature,
    moves: [...pokemon.moves],
    hidden_power_type: pokemon.hpType,
  });
  return ER_TRAINER_REGISTRY.map(trainer => ({
    stable_key: trainer.stableKey,
    source_id: trainer.id,
    trainer_type: trainer.trainerType,
    trainer_class_name: trainer.trainerClassName,
    double_battle: trainer.isDouble,
    map_id: trainer.map,
    default_party: trainer.party.map(member),
    insane_party: trainer.insaneParty?.map(member) ?? null,
    hell_party: trainer.hellParty?.map(member) ?? null,
  })).toSorted((left, right) => left.stable_key.localeCompare(right.stable_key));
}

function modePolicies() {
  return Object.values(GameModes)
    .filter((value): value is GameModes => typeof value === "number")
    .map(id => {
      const mode = getGameMode(id);
      return {
        mode_id: id,
        key: GameModes[id],
        cooperative: Boolean(mode.isCoop),
        challenge: Boolean(mode.isChallenge),
        starting_level: mode.getStartingLevel(),
        starting_money: mode.getStartingMoney(),
        starting_biome: mode.getStartingBiome(),
      };
    })
    .toSorted((left, right) => left.mode_id - right.mode_id);
}

test("export complete pinned AI definitions", async () => {
  if (OUTPUT == null) {
    throw new Error("M9_AI_CONTENT_OUTPUT is required");
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

  const trainers = trainerProfiles();
  const registeredTrainers = registeredTrainerProfiles();
  expect(trainers.length).toBeGreaterThan(250);
  expect(registeredTrainers.length).toBeGreaterThan(800);
  writeFileSync(
    OUTPUT,
    `${JSON.stringify({
      schema_version: 2,
      oracle_sha: ORACLE_SHA,
      trainer_profiles: trainers,
      registered_trainers: registeredTrainers,
      modes: modePolicies(),
    })}\n`,
    "utf8",
  );
});
