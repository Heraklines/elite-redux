/*
 * M4A composed wave-9-through-11 capture.
 *
 * This is the only causal M4 fixture. It drives one live GameManager from the
 * wave-9 command boundary through move learning, reward, wave 10, market,
 * Crossroads, Plains selection, and the first wave-11 command. Every input is
 * sent through InputsController.keyboardKeyDown/keyboardKeyUp; no logical
 * Button or phase helper is used as an action.
 */

import { getGameMode } from "#app/game-mode";
import { getLevelTotalExp, GrowthRate } from "#data/exp";
import { GameModes } from "#enums/game-modes";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import Phaser from "phaser";
import { vi } from "vitest";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
type AnyRecord = Record<string, any>;
type KeyName = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Enter" | "Space" | "Escape" | "Backspace" | "KeyA" | "KeyB" | "KeyC" | "KeyD" | "KeyE" | "KeyF" | "KeyN" | "KeyR" | "KeyT";
type SegmentId = "progression" | "reward" | "market" | "biome" | "encounter";

type RawTapeEntry = {
  sequence: number;
  event: JsonObject;
};

type Segment = {
  id: SegmentId;
  initial: JsonObject;
  final: JsonObject;
  decisions: JsonValue[];
  rng_draws: JsonValue[];
  ordered_transitions: JsonValue[];
  mutations: JsonValue[];
  presentation: JsonValue[];
  next_control: JsonObject;
  raw_key_tape: JsonValue[];
};

export class M4CaptureGap extends Error {
  public readonly code: string;
  public readonly sourceSeam: string;

  constructor(code: string, sourceSeam: string, message: string) {
    super(message);
    this.name = "M4CaptureGap";
    this.code = code;
    this.sourceSeam = sourceSeam;
  }
}

const VECTOR = "run-segments/classic-composed-wave-9-through-11-v1";
const SEED = "m4-composed-wave-9-through-11-address";
const BATTLE_HASH_RE = /^blake3-v1:[0-9a-f]{64}$/u;
const KEY_INFO: Record<KeyName, { keyCode: number; printable: boolean; rustKind: string; key: string }> = {
  ArrowUp: { keyCode: 38, printable: false, rustKind: "ARROW_UP", key: "ArrowUp" },
  ArrowDown: { keyCode: 40, printable: false, rustKind: "ARROW_DOWN", key: "ArrowDown" },
  ArrowLeft: { keyCode: 37, printable: false, rustKind: "ARROW_LEFT", key: "ArrowLeft" },
  ArrowRight: { keyCode: 39, printable: false, rustKind: "ARROW_RIGHT", key: "ArrowRight" },
  Enter: { keyCode: 13, printable: false, rustKind: "ENTER", key: "Enter" },
  Space: { keyCode: 32, printable: true, rustKind: "SPACE", key: " ", },
  Escape: { keyCode: 27, printable: false, rustKind: "ESCAPE", key: "Escape" },
  Backspace: { keyCode: 8, printable: false, rustKind: "BACKSPACE", key: "Backspace" },
  KeyA: { keyCode: 65, printable: true, rustKind: "KEY_A", key: "a" },
  KeyB: { keyCode: 66, printable: true, rustKind: "KEY_B", key: "b" },
  KeyC: { keyCode: 67, printable: true, rustKind: "KEY_C", key: "c" },
  KeyD: { keyCode: 68, printable: true, rustKind: "KEY_D", key: "d" },
  KeyE: { keyCode: 69, printable: true, rustKind: "KEY_E", key: "e" },
  KeyF: { keyCode: 70, printable: true, rustKind: "KEY_F", key: "f" },
  KeyN: { keyCode: 78, printable: true, rustKind: "KEY_N", key: "n" },
  KeyR: { keyCode: 82, printable: true, rustKind: "KEY_R", key: "r" },
  KeyT: { keyCode: 84, printable: true, rustKind: "KEY_T", key: "t" },
};

function gap(code: string, sourceSeam: string, message: string): never {
  throw new M4CaptureGap(code, sourceSeam, message);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    gap("LIVE_VALUE_UNOBSERVABLE", "test/kernel-fixtures/m4/export/composed-capture.ts", `${path} is not finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function jsonValue(value: unknown, path = "$", dropUndefined = false): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return finite(value, path);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => jsonValue(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const output: JsonObject = {};
    for (const key of Object.keys(value as AnyRecord).sort()) {
      const entry = (value as AnyRecord)[key];
      if (entry === undefined && dropUndefined) {
        continue;
      }
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
        gap("LIVE_VALUE_UNOBSERVABLE", "GameData.getSessionSaveData", `${path}.${key} is not JSON-compatible`);
      }
      output[key] = jsonValue(entry, `${path}.${key}`, dropUndefined);
    }
    return output;
  }
  gap("LIVE_VALUE_UNOBSERVABLE", "test/kernel-fixtures/m4/export/composed-capture.ts", `${path} has unsupported type`);
}

function stateFromString(state: unknown, path: string): JsonObject {
  if (typeof state !== "string") {
    gap("RNG_STATE_UNOBSERVABLE", "Phaser.Math.RandomDataGenerator.state", `${path} is absent`);
  }
  const parts = state.split(",");
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (parts.length !== 5 || parts[0] !== "!rnd" || !Number.isSafeInteger(carry) || carry < 0 || carry > 0xffffffff || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)) {
    gap("RNG_STATE_UNOBSERVABLE", "Phaser.Math.RandomDataGenerator.state", `${path} is malformed`);
  }
  const bits = values.map(value => {
    const bytes = new ArrayBuffer(8);
    new DataView(bytes).setFloat64(0, value, false);
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  });
  return { state_string: state, s0_bits: bits[0], s1_bits: bits[1], s2_bits: bits[2], carry };
}

function rngFrontier(game: GameManager): JsonObject {
  const scene = game.scene as AnyRecord;
  const battle = scene.currentBattle as AnyRecord | undefined;
  if (battle == null) {
    gap("RNG_FRONTIER_UNOBSERVABLE", "src/battle-scene.ts:currentBattle", "current battle is absent at a composed frontier");
  }
  const saved = battle.battleSeedState;
  return {
    run: stateFromString(Phaser.Math.RND.state(), "run"),
    seed_offset: scene.rngOffset === 0 && scene.rngSeedOverride === ""
      ? null
      : { wave_seed: String(scene.rngSeedOverride || scene.waveSeed || scene.seed), offset: finite(scene.rngOffset, "scene.rngOffset") },
    battle: {
      battle_seed: String(battle.battleSeed),
      turn: finite(battle.turn, "battle.turn"),
      saved_substream: saved == null ? null : stateFromString(saved, "battle.saved_substream"),
    },
  };
}

function queuedPhases(game: GameManager): string[] {
  const manager = game.scene.phaseManager as AnyRecord;
  if (typeof manager.getQueuedPhaseNames !== "function") {
    gap("CONTROL_TRANSITION_UNOBSERVABLE", "src/app/phase-manager.ts:getQueuedPhaseNames", "phase queue cannot be observed");
  }
  const queued = manager.getQueuedPhaseNames.call(manager);
  if (!Array.isArray(queued) || queued.some((name: unknown) => typeof name !== "string" || name.length === 0)) {
    gap("CONTROL_TRANSITION_UNOBSERVABLE", "src/app/phase-manager.ts:getQueuedPhaseNames", "phase queue is not a string array");
  }
  return queued;
}

function canonicalState(game: GameManager): JsonObject {
  const gameData = (game.scene as AnyRecord).gameData as AnyRecord;
  if (typeof gameData?.getSessionSaveData !== "function") {
    gap("CANONICAL_STATE_UNOBSERVABLE", "src/system/game-data.ts:GameData.getSessionSaveData", "complete session serializer is unavailable");
  }
  let saveData: unknown;
  const dateNow = Date.now;
  Date.now = () => 0;
  try {
    saveData = gameData.getSessionSaveData.call(gameData);
  } catch (error) {
    gap("CANONICAL_STATE_UNOBSERVABLE", "src/system/game-data.ts:GameData.getSessionSaveData", error instanceof Error ? error.message : String(error));
  } finally {
    Date.now = dateNow;
  }
  const scene = game.scene as AnyRecord;
  const battle = scene.currentBattle as AnyRecord | undefined;
  return {
    schema_version: 2,
    kind: "GAME_STATE_V2",
    save_data: jsonValue(JSON.parse(JSON.stringify(saveData)), "save_data"),
    runtime: {
      seed: String(scene.seed),
      wave_seed: String(scene.waveSeed),
      rng_seed_override: String(scene.rngSeedOverride ?? ""),
      rng_offset: finite(scene.rngOffset, "runtime.rng_offset"),
      wave: finite(battle?.waveIndex, "runtime.wave"),
      turn: finite(battle?.turn, "runtime.turn"),
      battle_type: finite(battle?.battleType, "runtime.battle_type"),
      battle_seed: String(battle?.battleSeed ?? ""),
      biome: finite((scene.arena as AnyRecord)?.biomeId, "runtime.biome"),
      phase: String(scene.phaseManager.getCurrentPhase()?.phaseName ?? ""),
      queued_phases: queuedPhases(game),
      ui_mode: String(scene.ui.getMode()),
      lock_modifier_tiers: Boolean(scene.lockModifierTiers),
      reroll: Boolean(scene.reroll),
    },
  };
}

function frontier(game: GameManager, battleHash: string, runHash: string): JsonObject {
  if (!BATTLE_HASH_RE.test(battleHash) || !BATTLE_HASH_RE.test(runHash)) {
    gap("CONTENT_HASH_UNOBSERVABLE", "src/init/init.ts:initializeGame", "exact content hashes were not passed by the exporter");
  }
  return { canonical: canonicalState(game), battle_content_hash: battleHash, run_content_hash: runHash, rng: rngFrontier(game) };
}

function nextControl(game: GameManager): JsonObject {
  const phase = game.scene.phaseManager.getCurrentPhase()?.phaseName;
  if (typeof phase !== "string" || phase.length === 0) {
    gap("CONTROL_TRANSITION_UNOBSERVABLE", "src/app/phase-manager.ts:getCurrentPhase", "current successor phase is absent");
  }
  return { kind: "LIVE_SUCCESSOR", phase, queued_phases: queuedPhases(game) };
}

function press(game: GameManager, keyName: KeyName, tape: RawTapeEntry[], transitions: JsonValue[]): void {
  const info = KEY_INFO[keyName];
  const controller = (game.scene as AnyRecord).inputController as AnyRecord;
  if (typeof controller?.keyboardKeyDown !== "function" || typeof controller?.keyboardKeyUp !== "function") {
    gap("RAW_KEY_DRIVER_UNOBSERVABLE", "src/inputs-controller.ts:keyboardKeyDown/keyboardKeyUp", "production keyboard input driver is unavailable");
  }
  const event = { code: info.key, key: info.key, keyCode: info.keyCode, which: info.keyCode, repeat: false } as KeyboardEvent;
  const phaseBefore = String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "");
  const modeBefore = String(game.scene.ui.getMode());
  controller.keyboardKeyDown(event);
  tape.push({ sequence: tape.length, event: { kind: "KEY_DOWN", data: { code: { kind: info.rustKind }, printable: info.printable, browser_repeat: false, focus: "GAME" } } });
  controller.keyboardKeyUp(event);
  tape.push({ sequence: tape.length, event: { kind: "KEY_UP", data: { code: { kind: info.rustKind } } } });
  transitions.push({ kind: "RAW_PHYSICAL_KEY", key: info.rustKind, phase_before: phaseBefore, phase_after: String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? ""), mode_before: modeBefore, mode_after: String(game.scene.ui.getMode()), sequence: tape.length - 2 });
}

function sleep(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}


async function waitForInputPhase(game: GameManager, names: readonly string[], context: string): Promise<void> {
  const started = Date.now();
  while (!names.includes(String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? ""))) {
    if (Date.now() - started > 30_000) {
      gap("LIVE_CONTROL_TIMEOUT", "src/app/phase-manager.ts:currentPhase", `${context} did not reach ${names.join("|")}`);
    }
    await sleep();
  }
}
async function waitForLiveCondition(game: GameManager, predicate: () => boolean, context: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 30_000) {
      gap("LIVE_CONTROL_TIMEOUT", "test/kernel-fixtures/m4/export/composed-capture.ts:live successor", `${context} did not become observable`);
    }
    await sleep();
  }
}

type RngCollector = {
  draws: JsonValue[];
  restore: () => void;
};

function installRngTrace(): RngCollector {
  const random = Phaser.Math.RND as AnyRecord;
  const methods = ["integerInRange", "integer", "frac", "realInRange", "pick", "shuffle", "angle", "between", "normal", "weightedPick", "sign"] as const;
  const draws: JsonValue[] = [];
  const restores: (() => void)[] = [];
  for (const method of methods) {
    const original = random[method];
    if (typeof original !== "function") {
      gap("RNG_OBSERVATION_SEAM_MISSING", `Phaser.Math.RND.${method}`, "RNG method is not callable");
    }
    random[method] = function (this: AnyRecord, ...args: unknown[]): unknown {
      const before = stateFromString(random.state(), `${method}.before`);
      const result = original.apply(this, args);
      const after = stateFromString(random.state(), `${method}.after`);
      draws.push({
        sequence: draws.length,
        public_api: method.toUpperCase(),
        arguments: jsonValue(args, `${method}.arguments`),
        result: jsonValue(result, `${method}.result`),
        consumed: before.state_string !== after.state_string,
        before_state: before,
        after_state: after,
      });
      return result;
    };
    restores.push(() => {
      random[method] = original;
    });
  }
  return {
    draws,
    restore: () => {
      for (const restore of restores.reverse()) {
        restore();
      }
    },
  };
}

async function launch(phaserGame: Phaser.Game): Promise<GameManager> {
  const spec: ScenarioSpec = {
    v: 1,
    name: "M4 composed wave 9 through 11",
    notes: "Explicit composed fixture address; not a natural single-seed claim.",
    run: { wave: 9, biome: BiomeId.TOWN, level: 16, money: 1000000, seed: SEED, difficulty: "ace" },
    enemy: { kind: "wild", wild: { species: SpeciesId.PIDGEY, moves: [MoveId.SPLASH] } },
    items: { modifiers: [{ name: "LOCK_CAPSULE" }] },
    start: { enemyHpPct: 1 },
  };
  const game = new GameManager(phaserGame);
  game.override.criticalHits(null);
  game.override.mysteryEncounterChance(0);
  vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
  const built = buildDevScenario(spec);
  await game.runToTitle();
  game.override.startingBiome(BiomeId.TOWN);
  const starters = built.scenario.setup();
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    game.scene.setSeed(SEED);
    game.scene.resetSeed();
    new SelectStarterPhase().initBattle(starters, true);
    built.postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
  return game;
}

async function driveBattleTo(game: GameManager, stop: readonly string[], tape: RawTapeEntry[], transitions: JsonValue[], context: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const phase = String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "");
    if (stop.includes(phase)) {
      return;
    }
    if (phase === "CommandPhase" || phase === "MovePhase" || phase === "SelectTargetPhase" || phase === "SwitchPhase") {
      press(game, "Space", tape, transitions);
      press(game, "Space", tape, transitions);
    }
    await sleep();
  }
  gap("LIVE_BATTLE_FRONTIER_UNOBSERVABLE", "src/phases/command-phase.ts:processInput", `${context} did not reach ${stop.join("|")}`);
}

async function driveMoveLearn(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  await waitForInputPhase(game, ["LearnMoveBatchPhase"], "wave-9 move learning");
  for (let count = 0; count < 8 && String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "") === "LearnMoveBatchPhase"; count += 1) {
    press(game, count === 0 ? "Space" : "Enter", tape, transitions);
    await sleep();
  }
}

async function driveReward(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  await waitForInputPhase(game, ["SelectModifierPhase"], "wave-9 regular reward");
  const initialHandler = game.scene.ui.getHandler() as AnyRecord;
  if (initialHandler?.awaitingActionInput !== true) {
    gap("REWARD_UI_UNOBSERVABLE", "src/ui/handlers/modifier-select-ui-handler.ts:awaitingActionInput", "regular reward handler is not actionable");
  }
  // The production reward layout enters on the reward row. DOWN/DOWN reaches
  // the Lock Capsule target through the Reroll row; ACTION must toggle lock.
  press(game, "ArrowDown", tape, transitions);
  press(game, "ArrowDown", tape, transitions);
  press(game, "Space", tape, transitions);
  await waitForLiveCondition(game, () => game.scene.lockModifierTiers === true, "regular reward lock toggle");

  const lockedHandler = game.scene.ui.getHandler() as AnyRecord;
  let cursor = Number(lockedHandler?.cursor);
  let rowCursor = Number(lockedHandler?.rowCursor);
  if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(rowCursor)) {
    gap("REWARD_UI_CURSOR_UNOBSERVABLE", "src/ui/handlers/modifier-select-ui-handler.ts:cursor/rowCursor", "lock successor cursor is not an integer");
  }
  if (rowCursor !== 0) {
    gap("REWARD_UI_CURSOR_UNOBSERVABLE", "src/ui/handlers/modifier-select-ui-handler.ts:rowCursor", "lock successor did not remain on the reroll row");
  }
  for (let attempt = 0; cursor !== 0 && attempt < 8; attempt += 1) {
    press(game, "ArrowLeft", tape, transitions);
    cursor = Number((game.scene.ui.getHandler() as AnyRecord)?.cursor);
  }
  if (cursor !== 0) {
    gap("REWARD_UI_CURSOR_UNOBSERVABLE", "src/ui/handlers/modifier-select-ui-handler.ts:setCursor", "lock successor did not navigate to reward cursor 0");
  }

  const beforeRerollPhase = game.scene.phaseManager.getCurrentPhase();
  const beforeOptions = JSON.stringify((beforeRerollPhase as AnyRecord)?.typeOptions ?? []);
  press(game, "Space", tape, transitions);
  await waitForLiveCondition(
    game,
    () => {
      const phase = game.scene.phaseManager.getCurrentPhase() as AnyRecord;
      return phase !== beforeRerollPhase || JSON.stringify(phase?.typeOptions ?? []) !== beforeOptions;
    },
    "regular reward reroll successor",
  );

  const rerollHandler = game.scene.ui.getHandler() as AnyRecord;
  rowCursor = Number(rerollHandler?.rowCursor);
  cursor = Number(rerollHandler?.cursor);
  if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(rowCursor)) {
    gap("REWARD_UI_CURSOR_UNOBSERVABLE", "src/ui/handlers/modifier-select-ui-handler.ts:cursor/rowCursor", "reroll successor cursor is not an integer");
  }
  for (let attempt = 0; rowCursor !== 1 && attempt < 8; attempt += 1) {
    press(game, rowCursor < 1 ? "ArrowUp" : "ArrowDown", tape, transitions);
    rowCursor = Number((game.scene.ui.getHandler() as AnyRecord)?.rowCursor);
  }
  for (let attempt = 0; cursor !== 0 && attempt < 8; attempt += 1) {
    press(game, "ArrowLeft", tape, transitions);
    cursor = Number((game.scene.ui.getHandler() as AnyRecord)?.cursor);
  }
  if (rowCursor !== 1 || cursor !== 0) {
    gap("REWARD_UI_CURSOR_UNOBSERVABLE", "src/ui/handlers/modifier-select-ui-handler.ts:setRowCursor/setCursor", "rerolled reward did not reach observed reward cursor 0");
  }
  press(game, "Space", tape, transitions);
  for (let attempt = 0; attempt < 6 && String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "") !== "CommandPhase"; attempt += 1) {
    await sleep();
    if (String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "") !== "CommandPhase") {
      press(game, "Space", tape, transitions);
    }
  }
  await waitForInputPhase(game, ["CommandPhase"], "wave-10 command after regular reward");
}
async function driveMarket(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  await waitForInputPhase(game, ["BiomeShopPhase"], "wave-10 Town market");
  press(game, "Space", tape, transitions);
  press(game, "ArrowRight", tape, transitions);
  press(game, "Space", tape, transitions);
  press(game, "Escape", tape, transitions);
  press(game, "Space", tape, transitions);
  await waitForInputPhase(game, ["ErCrossroadsPhase"], "wave-10 Crossroads");
}

async function driveBiome(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  await waitForInputPhase(game, ["ErCrossroadsPhase"], "Crossroads stay/leave");
  press(game, "ArrowDown", tape, transitions);
  press(game, "Space", tape, transitions);
  await waitForInputPhase(game, ["SelectBiomePhase"], "Plains biome selection");
  const handler = game.scene.ui.getHandler() as AnyRecord;
  const nodes = handler?.nodes;
  const selectable = handler?.selectable;
  if (!Array.isArray(nodes) || !Array.isArray(selectable)) {
    gap("BIOME_ROUTE_OPTIONS_UNOBSERVABLE", "src/ui/handlers/er-map-picker-ui-handler.ts:nodes", "live route options are unavailable");
  }
  const nodeIndex = nodes.findIndex((node: AnyRecord) => node?.revealed === true && node.biome === BiomeId.PLAINS);
  const targetCursor = selectable.indexOf(nodeIndex);
  let cursor = Number(handler.cursor);
  if (!Number.isSafeInteger(cursor) || targetCursor < 0) {
    gap("PLAINS_ROUTE_UNOBSERVABLE", "src/data/elite-redux/er-biome-routing.ts:rollErNextBiomeNodes", "the live revealed route has no Plains choice");
  }
  while (cursor < targetCursor) {
    press(game, "ArrowDown", tape, transitions);
    cursor = Number(handler.cursor);
  }
  while (cursor > targetCursor) {
    press(game, "ArrowUp", tape, transitions);
    cursor = Number(handler.cursor);
  }
  if (cursor !== targetCursor) {
    gap("BIOME_CURSOR_UNOBSERVABLE", "src/ui/handlers/er-map-picker-ui-handler.ts:cursor", "physical navigation did not reach the live Plains route");
  }
  press(game, "Space", tape, transitions);
  await waitForInputPhase(game, ["EncounterPhase"], "wave-11 pre-generation frontier");
}
function segment(
  id: SegmentId,
  initial: JsonObject,
  final: JsonObject,
  tape: RawTapeEntry[],
  transitions: JsonValue[],
  rngDraws: JsonValue[],
  game: GameManager,
): Segment {
  const controlBySegment: Record<SegmentId, string> = {
    progression: "MOVE_LEARN",
    reward: "REWARD_SHOP",
    market: "BIOME_MARKET",
    biome: "BIOME_SELECT",
    encounter: "BATTLE",
  };
  return {
    id,
    initial,
    final,
    decisions: transitions,
    rng_draws: rngDraws,
    ordered_transitions: [
      { kind: "CONTROL_TRANSITION", control: controlBySegment[id], phase: String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? ""), mode: String(game.scene.ui.getMode()) },
      ...transitions,
    ],
    mutations: [{ kind: "STATE_FRONTIER", before: initial.canonical, after: final.canonical }],
    presentation: [{ phase: String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? ""), mode: String(game.scene.ui.getMode()) }],
    next_control: nextControl(game),
    raw_key_tape: tape,
  };
}

export async function captureComposedSegment(): Promise<JsonObject> {
  const battleHash = process.env.M4_ORACLE_BATTLE_CONTENT_HASH ?? "";
  const runHash = process.env.M4_ORACLE_RUN_CONTENT_HASH ?? "";
  if (!BATTLE_HASH_RE.test(battleHash) || !BATTLE_HASH_RE.test(runHash)) {
    gap("CONTENT_HASH_UNOBSERVABLE", "scripts/export-kernel-m4-oracle.mjs:contentHashes", "the composed helper requires exact hashes from the content capture");
  }
  if (process.env.M4_ORACLE_COMPOSED_FIXTURE_ID !== VECTOR) {
    gap("EXPORT_CONFIGURATION", "scripts/export-kernel-m4-oracle.mjs:runPass", "composed fixture address is not pinned");
  }
  let phaserGame: Phaser.Game | undefined;
  let rngTrace: RngCollector | undefined;
  try {
    rngTrace = installRngTrace();
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    const game = await launch(phaserGame);
    const target = game.scene.getPlayerParty()[0] as AnyRecord | undefined;
    if (target == null || target.species?.speciesId !== SpeciesId.NACLI) {
      gap("COMPOSED_PARTY_UNOBSERVABLE", "src/field/pokemon.ts:PlayerPokemon", "the live composed party does not contain Nacli");
    }
    const levelThreshold = getLevelTotalExp(17, GrowthRate.MEDIUM_SLOW);
    if (!Number.isSafeInteger(levelThreshold) || levelThreshold <= 0) {
      gap("COMPOSED_EXP_UNOBSERVABLE", "src/data/exp.ts:getLevelTotalExp", "level-17 Medium Slow threshold is unavailable");
    }
    target.exp = levelThreshold - 1;
    if (target.exp !== levelThreshold - 1) {
      gap("COMPOSED_EXP_SETUP_FAILED", "src/field/pokemon.ts:Pokemon.exp", "the explicit composed wave-9 frontier could not pin pre-level-up EXP");
    }
    const tape: RawTapeEntry[] = [];
    const transitions: JsonValue[] = [];
    const segments: Segment[] = [];
    let rngCursor = 0;
    const takeRngDraws = (): JsonValue[] => {
      const draws = rngTrace?.draws ?? [];
      const output = draws.slice(rngCursor);
      rngCursor = draws.length;
      return output;
    };

    const progressionInitial = frontier(game, battleHash, runHash);
    await driveBattleTo(game, ["LearnMoveBatchPhase", "SelectModifierPhase"], tape, transitions, "wave-9 battle");
    await driveMoveLearn(game, tape, transitions);
    const progressionFinal = frontier(game, battleHash, runHash);
    segments.push(segment("progression", progressionInitial, progressionFinal, tape.splice(0), transitions.splice(0), takeRngDraws(), game));

    const rewardInitial = frontier(game, battleHash, runHash);
    await driveReward(game, tape, transitions);
    const rewardFinal = frontier(game, battleHash, runHash);
    segments.push(segment("reward", rewardInitial, rewardFinal, tape.splice(0), transitions.splice(0), takeRngDraws(), game));

    const marketInitial = frontier(game, battleHash, runHash);
    await driveBattleTo(game, ["BiomeShopPhase"], tape, transitions, "wave-10 battle");
    await driveMarket(game, tape, transitions);
    const marketFinal = frontier(game, battleHash, runHash);
    segments.push(segment("market", marketInitial, marketFinal, tape.splice(0), transitions.splice(0), takeRngDraws(), game));

    const biomeInitial = frontier(game, battleHash, runHash);
    await driveBiome(game, tape, transitions);
    const biomeFinal = frontier(game, battleHash, runHash);
    segments.push(segment("biome", biomeInitial, biomeFinal, tape.splice(0), transitions.splice(0), takeRngDraws(), game));

    const encounterInitial = frontier(game, battleHash, runHash);
    await waitForInputPhase(game, ["CommandPhase"], "wave-11 encounter");
    const encounterFinal = frontier(game, battleHash, runHash);
    segments.push(segment("encounter", encounterInitial, encounterFinal, tape.splice(0), transitions.splice(0), takeRngDraws(), game));

    const allTape = segments
      .flatMap(entry => entry.raw_key_tape as RawTapeEntry[])
      .map((entry, sequence) => ({ sequence, event: entry.event }));
    const allTransitions = segments.flatMap(entry => entry.ordered_transitions);
    const allRngDraws = rngTrace?.draws ?? [];
    if (allRngDraws.length === 0) {
      gap("RNG_DRAW_UNOBSERVABLE", "Phaser.Math.RND", "live composed run produced no observed RNG draws");
    }
    return {
      artifact_id: "run-segment-composed-v1",
      schema_version: 1,
      kind: "oracle-composed",
      fixture_id: VECTOR,
      fixture_address: { seed: SEED, wave_start: 9, wave_end: 11, biome: BiomeId.TOWN, selected_biome: BiomeId.PLAINS },
      natural_single_seed_claim: false,
      control_order: ["BATTLE", "MOVE_LEARN", "REWARD_SHOP", "BATTLE", "BIOME_MARKET", "CROSSROADS", "BIOME_SELECT", "BATTLE"],
      initial: segments[0].initial,
      segments,
      final: segments[segments.length - 1].final,
      decisions: allTransitions,
      rng_draws: allRngDraws,
      ordered_transitions: allTransitions,
      mutations: segments.flatMap(entry => entry.mutations),
      presentation: segments.flatMap(entry => entry.presentation),
      next_control: nextControl(game),
      raw_key_tape: allTape,
      content_identity: { battle_content_hash: battleHash, run_content_hash: runHash },
    };
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap("COMPOSED_LIVE_SCENARIO_FAILED", "test/kernel-fixtures/m4/export/composed-capture.ts:GameManager", error instanceof Error ? error.message : String(error));
  } finally {
    rngTrace?.restore();
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
    phaserGame?.destroy(true);
  }
}
