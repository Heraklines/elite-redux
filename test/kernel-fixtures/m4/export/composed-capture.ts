/*
 * M4A composed wave-9-through-11 capture.
 *
 * This is the only causal M4 fixture. It drives one live GameManager from the
 * wave-9 command boundary through move learning, reward, wave 10, market,
 * Crossroads, Plains selection, and the first wave-11 command. Every input is
 * sent through InputsController.keyboardKeyDown/keyboardKeyUp; no logical
 * Button or phase helper is used as an action.
 */

import { Battle } from "#app/battle";
import Overrides from "#app/overrides";
import { erRollBiomeLength } from "#data/elite-redux/er-biome-structure";
import { buildDevScenario, type ScenarioSpec } from "#app/dev-tools/test-suite/scenario-spec";
import {
  captureOracleFrontier,
  captureOracleNextControl,
  captureOracleRngState,
} from "./oracle-frontier";
import { getGameMode } from "#app/game-mode";
import { getLevelTotalExp, GrowthRate } from "#data/exp";
import { getErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { GameModes } from "#enums/game-modes";
import { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { PokemonModifierType } from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { launchDetachedStarters } from "./starter-launch";
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
let diagnosticTape: RawTapeEntry[] = [];
let diagnosticTransitions: JsonValue[] = [];

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

function frontier(game: GameManager, battleHash: string, runHash: string): JsonObject {
  return captureOracleFrontier(game, battleHash, runHash, gap);
}

function nextControl(game: GameManager): JsonObject {
  return captureOracleNextControl(game, gap);
}

function press(game: GameManager, keyName: KeyName, tape: RawTapeEntry[], transitions: JsonValue[]): void {
  const info = KEY_INFO[keyName];
  const controller = (game.scene as AnyRecord).inputController as AnyRecord;
  if (typeof controller?.keyboardKeyDown !== "function" || typeof controller?.keyboardKeyUp !== "function") {
    gap("RAW_KEY_DRIVER_UNOBSERVABLE", "src/inputs-controller.ts:keyboardKeyDown/keyboardKeyUp", "production keyboard input driver is unavailable");
  }
  const event = { code: keyName, key: info.key, keyCode: info.keyCode, which: info.keyCode, repeat: false } as KeyboardEvent;
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

function installRngTrace(game: GameManager): RngCollector {
  const drawContext = (): JsonObject => {
    const stack = new Error().stack ?? "";
    const callsites: string[] = [];
    for (const line of stack.split("\n")) {
      const match = line.match(/((?:src|test)[\\/][^()\s]+?\.ts):\d+(?::\d+)?/u);
      if (match != null) {
        const site = match[1].replaceAll("\\", "/");
        if (!callsites.includes(site)) {
          callsites.push(site);
        }
      }
      if (callsites.length >= 4) {
        break;
      }
    }
    return {
      phase: String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? ""),
      queued_phases: (game.scene.phaseManager as AnyRecord).getQueuedPhaseNames?.() ?? [],
      ui_mode: String(game.scene.ui.getMode()),
      wave: Number(game.scene.currentBattle?.waveIndex ?? -1),
      diagnostic_callsites: callsites,
    };
  };
  // Wrap the whole RND object with a recording proxy. Per-method hooks miss
  // any consumer calling an unwrapped generator method (rotation, uuid,
  // timestamp, real, int, ...) and let it silently advance the shared stream.
  // sow()/state() are recorded as SWAP events: they replace or restore the
  // whole generator state and are causal evidence for every join frontier.
  const inner = Phaser.Math.RND as AnyRecord;
  const methods = ["integerInRange", "integer", "frac", "realInRange", "pick", "shuffle", "angle", "between", "normal", "weightedPick", "sign", "rotation", "uuid", "timestamp", "real", "int"] as const;
  const draws: JsonValue[] = [];
  const restores: (() => void)[] = [];
  let battleDrawInProgress = false;
  const recordDraw = (method: string, args: unknown[], invoke: () => unknown): unknown => {
    if (battleDrawInProgress) {
      return invoke();
    }
    const before = captureOracleRngState(inner.state(), `${method}.before`, gap);
    const result = invoke();
    const after = captureOracleRngState(inner.state(), `${method}.after`, gap);
    draws.push({
      sequence: draws.length,
      stream: "RUN",
      public_api: method.toUpperCase(),
      arguments: jsonValue(args, `${method}.arguments`),
      result: jsonValue(result, `${method}.result`),
      consumed: before.state_string !== after.state_string,
      before_state: before,
      after_state: after,
      context: drawContext(),
    });
    return result;
  };
  const recordSwap = (method: string, args: unknown[], invoke: () => unknown): unknown => {
    if (battleDrawInProgress) {
      return invoke();
    }
    const before = captureOracleRngState(inner.state(), `${method}.before`, gap);
    const result = invoke();
    const after = captureOracleRngState(inner.state(), `${method}.after`, gap);
    draws.push({
      sequence: draws.length,
      stream: "SWAP",
      public_api: method.toUpperCase(),
      arguments: jsonValue(args, `${method}.arguments`),
      result: jsonValue(result ?? null, `${method}.result`),
      consumed: false,
      before_state: before,
      after_state: after,
      context: drawContext(),
    });
    return result;
  };
  const proxy = new Proxy(inner, {
    get(target, property) {
      const name = String(property);
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") {
        return value;
      }
      if ((methods as readonly string[]).includes(name)) {
        return function (...args: unknown[]): unknown {
          return recordDraw(name, args, () => value.apply(target, args));
        };
      }
      if ((["sow", "state"] as const).includes(name as "sow" | "state")) {
        return function (...args: unknown[]): unknown {
          return recordSwap(name, args, () => value.apply(target, args));
        };
      }
      return value.bind(target);
    },
  }) as AnyRecord;
  (Phaser.Math as AnyRecord).RND = proxy;
  restores.push(() => {
    (Phaser.Math as AnyRecord).RND = inner;
  });

  const battlePrototype = Battle.prototype as AnyRecord;
  const originalBattleDraw = battlePrototype.randSeedInt;
  if (typeof originalBattleDraw !== "function") {
    gap("RNG_OBSERVATION_SEAM_MISSING", "src/battle.ts:Battle.randSeedInt", "battle RNG method is not callable");
  }
  battlePrototype.randSeedInt = function (this: AnyRecord, ...args: unknown[]): unknown {
    if (battleDrawInProgress) {
      return originalBattleDraw.apply(this, args);
    }
    const before = captureOracleRngState(this.battleSeedState ?? inner.state(), "battle.before", gap);
    battleDrawInProgress = true;
    let result: unknown;
    try {
      result = originalBattleDraw.apply(this, args);
    } finally {
      battleDrawInProgress = false;
    }
    const after = captureOracleRngState(this.battleSeedState ?? inner.state(), "battle.after", gap);
    draws.push({
      sequence: draws.length,
      stream: "BATTLE",
      public_api: "RAND_SEED_INT",
      arguments: jsonValue(args, "battle.arguments"),
      result: jsonValue(result, "battle.result"),
      consumed: before.state_string !== after.state_string,
      before_state: before,
      after_state: after,
      context: drawContext(),
    });
    return result;
  };
  restores.push(() => {
    battlePrototype.randSeedInt = originalBattleDraw;
  });

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
    party: [{ species: SpeciesId.NACLI, moves: [1, 52, 77, 78], nature: 0 }],
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
    launchDetachedStarters(new SelectStarterPhase(), starters);
    built.postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  // The boot-time biome-structure roll runs before the harness pins the run
  // seed, so re-issue the production addressed roll (battle-scene.ts:2497
  // semantics) against the pinned seed before any frontier is captured.
  erRollBiomeLength(game.scene.arena.biomeId, 1, game.scene.seed);
  return game;
}

async function driveBattleTo(game: GameManager, stop: readonly string[], tape: RawTapeEntry[], transitions: JsonValue[], context: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const phase = String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "");
    if (stop.includes(phase)) {
      return;
    }
    let handled = false;
    if (phase === "CommandPhase" || phase === "MovePhase" || phase === "SelectTargetPhase" || phase === "SwitchPhase") {
      press(game, "Space", tape, transitions);
      handled = true;
    }
    if (phase === "EnemyCommandPhase") {
      await game.move.selectEnemyMove(MoveId.SPLASH, BattlerIndex.PLAYER);
      transitions.push({
        kind: "SCRIPTED_ENEMY_COMMAND",
        move_id: MoveId.SPLASH,
        target: BattlerIndex.PLAYER,
      });
      handled = true;
    }
    if (!handled) {
      const boundary = await game.phaseInterceptor.toFirst([...new Set([...stop, "CommandPhase"])]);
      if (stop.includes(boundary)) {
        return;
      }
      if (boundary === "CommandPhase") {
        await game.phaseInterceptor.to("CommandPhase");
      }
    }
    await sleep();
  }
  const battle = game.scene.currentBattle as AnyRecord | undefined;
  gap(
    "LIVE_BATTLE_FRONTIER_UNOBSERVABLE",
    "src/phases/command-phase.ts:processInput",
    `${context} did not reach ${stop.join("|")}; phase=${String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "")}; mode=${String(game.scene.ui.getMode())}; enemy_hp=${String(battle?.enemyParty?.[0]?.hp ?? "missing")}`,
  );
}

async function driveMoveLearn(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  if (game.scene.phaseManager.getCurrentPhase()?.phaseName !== "LearnMoveBatchPhase") {
    gap(
      "MOVE_LEARN_CONTROL_UNOBSERVABLE",
      "src/phases/learn-move-batch-phase.ts:LearnMoveBatchPhase",
      "move-learning phase is not the current stop-before boundary",
    );
  }
  game.onNextPrompt("LearnMoveBatchPhase", UiMode.LEARN_MOVE_BATCH, () => {
    // The prompt callback only schedules the physical browser events. The live
    // handler owns both state transitions: offered move -> overwrite slot 0.
    press(game, "Space", tape, transitions);
    press(game, "Space", tape, transitions);
  });
  await game.phaseInterceptor.to("SelectModifierPhase");
}

async function driveReward(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  await waitForInputPhase(game, ["SelectModifierPhase"], "wave-9 regular reward");
  await waitForLiveCondition(
    game,
    () => (game.scene.ui.getHandler() as AnyRecord)?.awaitingActionInput === true,
    "wave-9 reward input readiness",
  );
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
  await game.phaseInterceptor.to("SelectModifierPhase");
  await waitForLiveCondition(
    game,
    () => {
      const handler = game.scene.ui.getHandler() as AnyRecord;
      return (
        handler?.awaitingActionInput === true
        && Number.isSafeInteger(handler.cursor)
        && Number.isSafeInteger(handler.rowCursor)
      );
    },
    "rerolled reward input readiness",
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
  await sleep();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const phaseName = String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? "");
    if (phaseName === "CommandPhase") {
      break;
    }
    if (phaseName === "ErAbilityCapsulePhase") {
      if (game.scene.ui.getMode() !== UiMode.OPTION_SELECT) {
        const capsule = game.scene.phaseManager.getCurrentPhase();
        game.scene.phaseManager.prepareCurrentPhaseForStart();
        capsule?.start();
        await waitForLiveCondition(
          game,
          () => game.scene.ui.getMode() === UiMode.OPTION_SELECT,
          "ability capsule choice readiness",
        );
      }
      press(game, "Space", tape, transitions);
      await sleep();
      continue;
    }
    const mode = game.scene.ui.getMode();
    if (mode !== UiMode.PARTY && mode !== UiMode.MESSAGE && mode !== UiMode.OPTION_SELECT) {
      await sleep();
      continue;
    }
    press(game, "Space", tape, transitions);
    await sleep();
  }
  await game.phaseInterceptor.to("CommandPhase");
}
async function driveMarket(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  await waitForInputPhase(game, ["SelectModifierPhase"], "wave-10 Town market");
  await game.phaseInterceptor.to("SelectModifierPhase");
  await waitForLiveCondition(
    game,
    () => game.scene.ui.getMode() === UiMode.BIOME_SHOP,
    "wave-10 market input readiness",
  );
  if (game.scene.ui.getMode() !== UiMode.BIOME_SHOP) {
    gap(
      "MARKET_CONTROL_UNOBSERVABLE",
      "src/phases/biome-shop-phase.ts:BiomeShopPhase",
      `wave-10 SelectModifierPhase opened UI mode ${String(game.scene.ui.getMode())}`,
    );
  }
  const phase = game.scene.phaseManager.getCurrentPhase() as AnyRecord;
  const options = phase.shopOptions;
  const quantities = phase.qtys;
  const handler = game.scene.ui.getHandler() as AnyRecord;
  if (!Array.isArray(options) || !Array.isArray(quantities) || typeof handler?.getStock !== "function") {
    gap(
      "MARKET_STOCK_UNOBSERVABLE",
      "src/phases/biome-shop-phase.ts:BiomeShopPhase.buildStock",
      "live Town stock cannot be navigated",
    );
  }
  const target = options.findIndex(
    (option: AnyRecord, index: number) =>
      option?.type != null
      && !(option.type instanceof PokemonModifierType)
      && Number(quantities[index]) > 0,
  );
  let cursor = Number(handler.cursor);
  if (target < 0 || !Number.isSafeInteger(cursor)) {
    gap(
      "MARKET_DIRECT_OPTION_UNOBSERVABLE",
      "src/phases/biome-shop-phase.ts:BiomeShopPhase.shopOptions",
      "Town stock has no direct purchase target",
    );
  }
  while (Math.floor(cursor / 4) < Math.floor(target / 4)) {
    press(game, "ArrowDown", tape, transitions);
    cursor = Number(handler.cursor);
  }
  while (Math.floor(cursor / 4) > Math.floor(target / 4)) {
    press(game, "ArrowUp", tape, transitions);
    cursor = Number(handler.cursor);
  }
  while (cursor % 4 < target % 4) {
    press(game, "ArrowRight", tape, transitions);
    cursor = Number(handler.cursor);
  }
  while (cursor % 4 > target % 4) {
    press(game, "ArrowLeft", tape, transitions);
    cursor = Number(handler.cursor);
  }
  if (cursor !== target) {
    gap(
      "MARKET_CURSOR_UNOBSERVABLE",
      "src/ui/handlers/biome-shop-ui-handler.ts:cursor",
      `physical market cursor ${cursor} did not reach ${target}`,
    );
  }
  const stockBefore = Number(handler.getStock(target));
  press(game, "Space", tape, transitions);
  await waitForLiveCondition(
    game,
    () => Number(handler.getStock(target)) < stockBefore,
    "wave-10 market purchase",
  );
  press(game, "Backspace", tape, transitions);
  await waitForLiveCondition(
    game,
    () => game.scene.ui.getMode() === UiMode.CONFIRM,
    "wave-10 market leave confirmation",
  );
  const crossroadsArrival = game.phaseInterceptor.to("ErCrossroadsPhase", false);
  await sleep();
  press(game, "Space", tape, transitions);
  await crossroadsArrival;
}

async function driveBiome(game: GameManager, tape: RawTapeEntry[], transitions: JsonValue[]): Promise<void> {
  if (game.scene.phaseManager.getCurrentPhase()?.phaseName !== "ErCrossroadsPhase") {
    gap(
      "CROSSROADS_CONTROL_UNOBSERVABLE",
      "src/phases/er-crossroads-phase.ts:ErCrossroadsPhase",
      "Crossroads is not the current stop-before boundary",
    );
  }
  game.onNextPrompt("ErCrossroadsPhase", UiMode.OPTION_SELECT, () => {
    press(game, "ArrowDown", tape, transitions);
    press(game, "Space", tape, transitions);
  });
  await game.phaseInterceptor.to("SelectBiomePhase", false);

  const encounterArrival = game.phaseInterceptor.toFirst([
    "NextEncounterPhase",
    "NewBiomeEncounterPhase",
    "CommandPhase",
  ]);
  await waitForLiveCondition(
    game,
    () => game.scene.ui.getMode() === UiMode.ER_MAP,
    "wave-10 route input readiness",
  );
  const nodes = getErPendingNodes();
  if (!Array.isArray(nodes)) {
    gap("BIOME_ROUTE_OPTIONS_UNOBSERVABLE", "src/data/elite-redux/er-biome-routing.ts:getErPendingNodes", "live route options are unavailable");
  }
  const selectable = nodes
    .map((node: AnyRecord, index: number) => (node?.revealed === true ? index : -1))
    .filter((index: number) => index >= 0);
  const nodeIndex = nodes.findIndex(
    (node: AnyRecord) => node?.revealed === true && node.biome === BiomeId.PLAINS,
  );
  const targetCursor = selectable.indexOf(nodeIndex);
  if (targetCursor < 0) {
    gap("PLAINS_ROUTE_UNOBSERVABLE", "src/data/elite-redux/er-biome-routing.ts:rollErNextBiomeNodes", "the live revealed route has no Plains choice");
  }
  for (let cursor = 0; cursor < targetCursor; cursor += 1) {
    press(game, "ArrowDown", tape, transitions);
  }
  press(game, "Space", tape, transitions);
  const encounterBoundary = await encounterArrival;
  if (encounterBoundary === "CommandPhase") {
    gap(
      "ENCOUNTER_PREPARED_FRONTIER_UNOBSERVABLE",
      "src/phases/new-biome-encounter-phase.ts:NewBiomeEncounterPhase",
      "wave-11 encounter completed before its prepared frontier was observed",
    );
  }
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
  const overrides = Overrides as unknown as { LEVEL_CAP_OVERRIDE: number };
  const priorLevelCapOverride = overrides.LEVEL_CAP_OVERRIDE;
  // Solo-mode Egg construction seeds its property block with an unseeded
  // randomString(24) (src/data/egg.ts:263, "byte-for-byte unchanged" solo
  // behavior). The composed journey grants a wave-9 achievement egg, so the
  // ambient Math.random must be pinned for fresh processes to agree. This is
  // test-only ambient control, in the same class as the frozen locale/TZ.
  const priorRandom = Math.random;
  let ambientState = 0x4d349341;
  Math.random = () => {
    ambientState = (ambientState + 0x6d2b79f5) | 0;
    let t = ambientState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const restoreAmbient = (): void => {
    Math.random = priorRandom;
  };
  try {
    overrides.LEVEL_CAP_OVERRIDE = 17;
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS, seed: ["m4-oracle-anchor"] });
    const game = await launch(phaserGame);
    rngTrace = installRngTrace(game);
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
    diagnosticTape = tape;
    diagnosticTransitions = transitions;
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
    await driveBattleTo(game, ["SelectModifierPhase"], tape, transitions, "wave-10 battle");
    await driveMarket(game, tape, transitions);
    const marketFinal = frontier(game, battleHash, runHash);
    segments.push(segment("market", marketInitial, marketFinal, tape.splice(0), transitions.splice(0), takeRngDraws(), game));

    const biomeInitial = frontier(game, battleHash, runHash);
    await driveBiome(game, tape, transitions);
    const biomeFinal = frontier(game, battleHash, runHash);
    segments.push(segment("biome", biomeInitial, biomeFinal, tape.splice(0), transitions.splice(0), takeRngDraws(), game));

    const encounterInitial = frontier(game, battleHash, runHash);
    await game.phaseInterceptor.to("CommandPhase");
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
    gap(
      "COMPOSED_LIVE_SCENARIO_FAILED",
      "test/kernel-fixtures/m4/export/composed-capture.ts:GameManager",
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}; recent_tape=${JSON.stringify(diagnosticTape.slice(-12))}; recent_transitions=${JSON.stringify(diagnosticTransitions.slice(-12))}`,
    );
  } finally {
    restoreAmbient();
    rngTrace?.restore();
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
    phaserGame?.destroy(true);
  }
}
