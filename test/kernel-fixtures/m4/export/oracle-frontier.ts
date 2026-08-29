import type { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
type AnyRecord = Record<string, any>;
export type FrontierFailure = (code: string, sourceSeam: string, message: string) => never;

const CONTENT_HASH_RE = /^blake3-v1:[0-9a-f]{64}$/u;

function finite(value: unknown, path: string, fail: FrontierFailure): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("LIVE_VALUE_UNOBSERVABLE", "test/kernel-fixtures/m4/export/oracle-frontier.ts", `${path} is not finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function jsonValue(value: unknown, path: string, fail: FrontierFailure): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return finite(value, path, fail);
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${path}[${index}]`, fail));
  if (typeof value === "object") {
    const output: JsonObject = {};
    for (const key of Object.keys(value as AnyRecord).sort()) {
      const entry = (value as AnyRecord)[key];
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
        fail("LIVE_VALUE_UNOBSERVABLE", "src/system/game-data.ts:GameData.getSessionSaveData", `${path}.${key} is not JSON-compatible`);
      }
      output[key] = jsonValue(entry, `${path}.${key}`, fail);
    }
    return output;
  }
  fail("LIVE_VALUE_UNOBSERVABLE", "test/kernel-fixtures/m4/export/oracle-frontier.ts", `${path} has unsupported type`);
}

function stripPresentationOnlyPokemonState(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) stripPresentationOnlyPokemonState(entry);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as AnyRecord;
  const custom = record.customPokemonData;
  if (custom != null && typeof custom === "object" && !Array.isArray(custom)) {
    delete custom.erShinyLab;
    delete custom.erShinyLabName;
  }
  for (const entry of Object.values(record)) stripPresentationOnlyPokemonState(entry);
}

function rngState(state: unknown, path: string, fail: FrontierFailure): JsonObject {
  if (typeof state !== "string") fail("RNG_STATE_UNOBSERVABLE", "Phaser.Math.RandomDataGenerator.state", `${path} is absent`);
  const parts = state.split(",");
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (parts.length !== 5 || parts[0] !== "!rnd" || !Number.isSafeInteger(carry) || carry < 0 || carry > 0xffffffff || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)) {
    fail("RNG_STATE_UNOBSERVABLE", "Phaser.Math.RandomDataGenerator.state", `${path} is malformed`);
  }
  const bits = values.map(value => {
    const bytes = new ArrayBuffer(8);
    new DataView(bytes).setFloat64(0, value, false);
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  });
  return { state_string: state, s0_bits: bits[0], s1_bits: bits[1], s2_bits: bits[2], carry };
}

export function captureOracleRngState(
  state: unknown,
  path: string,
  fail: FrontierFailure,
): JsonObject {
  return rngState(state, path, fail);
}

function queuedPhases(game: GameManager, fail: FrontierFailure): string[] {
  const manager = game.scene.phaseManager as AnyRecord;
  if (typeof manager.getQueuedPhaseNames !== "function") {
    fail("CONTROL_TRANSITION_UNOBSERVABLE", "src/app/phase-manager.ts:getQueuedPhaseNames", "phase queue cannot be observed");
  }
  const queued = manager.getQueuedPhaseNames.call(manager);
  if (!Array.isArray(queued) || queued.some((name: unknown) => typeof name !== "string" || name.length === 0)) {
    fail("CONTROL_TRANSITION_UNOBSERVABLE", "src/app/phase-manager.ts:getQueuedPhaseNames", "phase queue is not a string array");
  }
  return queued;
}

function canonicalState(game: GameManager, fail: FrontierFailure): JsonObject {
  const gameData = (game.scene as AnyRecord).gameData as AnyRecord;
  if (typeof gameData?.getSessionSaveData !== "function") {
    fail("CANONICAL_STATE_UNOBSERVABLE", "src/system/game-data.ts:GameData.getSessionSaveData", "complete session serializer is unavailable");
  }
  let saveData: unknown;
  const dateNow = Date.now;
  Date.now = () => 0;
  try {
    saveData = gameData.getSessionSaveData.call(gameData);
  } catch (error) {
    fail("CANONICAL_STATE_UNOBSERVABLE", "src/system/game-data.ts:GameData.getSessionSaveData", error instanceof Error ? error.message : String(error));
  } finally {
    Date.now = dateNow;
  }
  const scene = game.scene as AnyRecord;
  const battle = scene.currentBattle as AnyRecord | undefined;
  const canonicalSaveData = JSON.parse(JSON.stringify(saveData)) as AnyRecord;
  // Carried Shiny Lab looks are renderer-only and may be rolled after the
  // mechanical encounter frontier. Exclude only those per-Pokémon cosmetic
  // fields; persistent Shiny Lab save progression remains observable.
  stripPresentationOnlyPokemonState(canonicalSaveData);
  delete canonicalSaveData.playTime;
  delete canonicalSaveData.timestamp;
  return {
    schema_version: 2,
    kind: "GAME_STATE_V2",
    save_data: jsonValue(canonicalSaveData, "save_data", fail),
    runtime: {
      seed: String(scene.seed),
      wave_seed: String(scene.waveSeed),
      rng_seed_override: String(scene.rngSeedOverride ?? ""),
      rng_offset: finite(scene.rngOffset, "runtime.rng_offset", fail),
      wave: battle == null ? null : finite(battle.waveIndex, "runtime.wave", fail),
      turn: battle == null ? null : finite(battle.turn, "runtime.turn", fail),
      battle_type: battle == null ? null : finite(battle.battleType, "runtime.battle_type", fail),
      battle_seed: battle == null ? null : String(battle.battleSeed),
      biome: finite((scene.arena as AnyRecord)?.biomeId, "runtime.biome", fail),
      phase: String(scene.phaseManager.getCurrentPhase()?.phaseName ?? ""),
      queued_phases: queuedPhases(game, fail),
      ui_mode: String(scene.ui.getMode()),
      lock_modifier_tiers: Boolean(scene.lockModifierTiers),
      reroll: Boolean(scene.reroll),
    },
  };
}

export function captureOracleFrontier(
  game: GameManager,
  battleContentHash: string,
  runContentHash: string,
  fail: FrontierFailure,
): JsonObject {
  if (!CONTENT_HASH_RE.test(battleContentHash) || !CONTENT_HASH_RE.test(runContentHash)) {
    fail("CONTENT_HASH_UNOBSERVABLE", "scripts/export-kernel-m4-oracle.mjs:contentHashes", "exact content hashes were not passed by the exporter");
  }
  const scene = game.scene as AnyRecord;
  const battle = scene.currentBattle as AnyRecord | undefined;
  const saved = battle?.battleSeedState;
  return {
    canonical: canonicalState(game, fail),
    battle_content_hash: battleContentHash,
    run_content_hash: runContentHash,
    rng: {
      run: rngState(Phaser.Math.RND.state(), "run", fail),
      seed_offset: scene.rngOffset === 0 && scene.rngSeedOverride === ""
        ? null
        : { wave_seed: String(scene.rngSeedOverride || scene.waveSeed || scene.seed), offset: finite(scene.rngOffset, "scene.rngOffset", fail) },
      battle: battle == null
        ? null
        : {
            battle_seed: String(battle.battleSeed),
            turn: finite(battle.turn, "battle.turn", fail),
            saved_substream: saved == null ? null : rngState(saved, "battle.saved_substream", fail),
          },
    },
  };
}

export function captureOracleNextControl(game: GameManager, fail: FrontierFailure): JsonObject {
  const phase = game.scene.phaseManager.getCurrentPhase()?.phaseName;
  if (typeof phase !== "string" || phase.length === 0) {
    fail("CONTROL_TRANSITION_UNOBSERVABLE", "src/app/phase-manager.ts:getCurrentPhase", "current successor phase is absent");
  }
  return { kind: "LIVE_SUCCESSOR", phase, queued_phases: queuedPhases(game, fail) };
}
