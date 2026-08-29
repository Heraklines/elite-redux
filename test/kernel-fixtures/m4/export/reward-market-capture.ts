import { BattleScene } from "#app/battle-scene";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { BattleStyle } from "#enums/battle-style";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { modifierTypes } from "#data/data-lists";
import { erRollBiomeLength } from "#data/elite-redux/er-biome-structure";
import { BiomeShopPhase } from "#phases/biome-shop-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { PokemonModifierType } from "#modifiers/modifier-type";
import { serializeRewardOptions } from "#data/elite-redux/coop/coop-reward-options";
import Phaser from "phaser";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { ModifierSelectUiHandler } from "#ui/handlers/modifier-select-ui-handler";
import { BiomeShopUiHandler } from "#ui/handlers/biome-shop-ui-handler";
import { captureOracleFrontier, captureOracleNextControl } from "./oracle-frontier";

/** Test-only typed gap. The main exporter deliberately duck-types this error. */
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

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type RecordValue = Record<string, JsonValue>;
type AnyRecord = Record<string, any>;

type Surface = "reward" | "market";
interface SurfaceCapture {
  initial?: RecordValue;
  final?: RecordValue;
  decisions: RecordValue[];
  rngDraws: RecordValue[];
  orderedTransitions: RecordValue[];
  mutations: RecordValue[];
  presentation: RecordValue[];
  rawKeyTape: RecordValue[];
  generationBefore?: RecordValue;
  generationAfter?: RecordValue;
  leaveRequested?: boolean;
  round: number;
}

interface CaptureContext {
  game: GameManager;
  surface: Surface;
  reward?: SurfaceCapture;
  market?: SurfaceCapture;
}

let activeCapture: CaptureContext | null = null;
let installed = false;
const restoreHooks: (() => void)[] = [];
let productionRandBattleSeedInt: AnyRecord["randBattleSeedInt"] | null = null;
let phaserGame: Phaser.Game | null = null;
let observedRewardPhase: SelectModifierPhase | null = null;
let observedMarketPhase: BiomeShopPhase | null = null;
let observedRewardOptions: AnyRecord[] = [];
let observedMarketOptions: AnyRecord[] = [];
let observedMarketQuantities: AnyRecord[] = [];

const SEED_PREFIX = "m4a-reward-market-capture";
const MAX_SEED_ATTEMPTS = 48;
const MONEY = 1_000_000;
const BATTLE_CONTENT_HASH = process.env.M4_ORACLE_BATTLE_CONTENT_HASH ?? "";
const RUN_CONTENT_HASH = process.env.M4_ORACLE_RUN_CONTENT_HASH ?? "";

function gap(code: string, sourceSeam: string, message: string): never {
  throw new M4CaptureGap(code, sourceSeam, message);
}

function frontier(game: GameManager): RecordValue {
  return captureOracleFrontier(game, BATTLE_CONTENT_HASH, RUN_CONTENT_HASH, gap) as RecordValue;
}

function nextControl(game: GameManager): RecordValue {
  return captureOracleNextControl(game, gap) as RecordValue;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    gap("NON_FINITE_CAPTURE", sourceFor(path), `${path} is not a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function sourceFor(path: string): string {
  if (path.startsWith("reward")) {
    return "src/phases/select-modifier-phase.ts:SelectModifierPhase";
  }
  if (path.startsWith("market")) {
    return "src/phases/biome-shop-phase.ts:BiomeShopPhase";
  }
  return "test/kernel-fixtures/m4/export/reward-market-capture.ts";
}

function jsonValue(value: unknown, path = "$"): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return finiteNumber(value, path);
  }
  if (Array.isArray(value)) {
    return Array.from(value, (child, index) =>
      child === undefined ? null : jsonValue(child, `${path}[${index}]`),
    );
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as AnyRecord)[key];
      if (child === undefined || typeof child === "function" || typeof child === "symbol") {
        gap("NON_JSON_CAPTURE", sourceFor(path), `${path}.${key} is not JSON-compatible`);
      }
      out[key] = jsonValue(child, `${path}.${key}`);
    }
    return out;
  }
  gap("NON_JSON_CAPTURE", sourceFor(path), `${path} is not JSON-compatible`);
}

function f64Bits(value: number): string {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, false);
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function rngStateFromString(state: string): RecordValue {
  const parts = state.split(",");
  if (parts.length !== 5 || parts[0] !== "!rnd") {
    gap("RNG_STATE_UNOBSERVABLE", "phaser/src/math/random-data-generator/RandomDataGenerator.js:state", `invalid Phaser state ${state}`);
  }
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (
    !Number.isInteger(carry)
    || carry < 0
    || carry > 0xffffffff
    || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)
  ) {
    gap("RNG_STATE_UNOBSERVABLE", "phaser/src/math/random-data-generator/RandomDataGenerator.js:state", `invalid Phaser state ${state}`);
  }
  return {
    state_string: state,
    s0_bits: f64Bits(values[0]),
    s1_bits: f64Bits(values[1]),
    s2_bits: f64Bits(values[2]),
    carry,
  };
}

function rngState(rng: Phaser.Math.RandomDataGenerator): RecordValue {
  return rngStateFromString(rng.state());
}

function sceneRng(game: GameManager): RecordValue {
  const scene = game.scene as AnyRecord;
  const battle = scene.currentBattle as AnyRecord | undefined;
  const saved = battle?.battleSeedState;
  return {
    run: rngState(Phaser.Math.RND),
    seed_offset:
      scene.rngOffset === 0 && scene.rngSeedOverride === ""
        ? null
        : {
            wave_seed: String(scene.rngSeedOverride || scene.waveSeed || scene.seed),
            offset: finiteNumber(scene.rngOffset, "scene.rngOffset"),
          },
    battle:
      battle == null
        ? null
        : {
            battle_seed: String(battle.battleSeed),
            turn: finiteNumber(battle.turn, "battle.turn"),
            saved_substream: typeof saved === "string" ? rngStateFromString(saved) : null,
          },
  };
}

function optionGraph(options: unknown, path: string): JsonValue[] {
  if (!Array.isArray(options)) {
    gap("OPTION_GRAPH_UNOBSERVABLE", sourceFor(path), `${path} is not an array`);
  }
  // This is the exact engine wire graph, including generator pregen arguments. It is
  // intentionally obtained from the production serializer rather than rebuilding IDs.
  return serializeRewardOptions(options as any).map((option, index) => jsonValue(option, `${path}[${index}]`));
}

function modifierGraph(game: GameManager): JsonValue[] {
  const scene = game.scene as AnyRecord;
  if (!Array.isArray(scene.modifiers)) {
    gap("MODIFIER_STATE_UNOBSERVABLE", "src/battle-scene.ts:BattleScene.modifiers", "live modifier array is absent");
  }
  return scene.modifiers.map((modifier: AnyRecord, index: number) => ({
    index,
    id: String(modifier.type?.id ?? ""),
    tier: modifier.type?.getOrInferTier?.() ?? null,
    stacks: finiteNumber(modifier.stackCount ?? 0, `modifiers[${index}].stackCount`),
    virtual: Boolean(modifier.virtual),
  }));
}

function partyGraph(game: GameManager): JsonValue[] {
  return game.scene.getPlayerParty().map((pokemon, index) => {
    const mon = pokemon as AnyRecord;
    return {
      index,
      id: finiteNumber(mon.id, `party[${index}].id`),
      species_id: finiteNumber(mon.species?.speciesId, `party[${index}].species_id`),
      level: finiteNumber(mon.level, `party[${index}].level`),
      exp: finiteNumber(mon.exp, `party[${index}].exp`),
      hp: finiteNumber(mon.hp, `party[${index}].hp`),
      max_hp: finiteNumber(mon.getMaxHp?.(), `party[${index}].max_hp`),
      fainted: Boolean(mon.isFainted?.()),
      moves: mon.getMoveset?.().map((move: AnyRecord) => ({ move_id: finiteNumber(move.moveId, "move_id"), pp_used: finiteNumber(move.ppUsed, "pp_used") })) ?? [],
    };
  });
}

function phaseGraph(game: GameManager, phase: AnyRecord, surface: Surface, options: unknown, quantities?: unknown): RecordValue {
  const battle = game.scene.currentBattle as AnyRecord | undefined;
  return {
    surface,
    phase: String(phase.phaseName ?? phase.constructor?.name ?? ""),
    wave: finiteNumber(battle?.waveIndex, `${surface}.wave`),
    turn: finiteNumber(battle?.turn, `${surface}.turn`),
    biome: finiteNumber((game.scene.arena as AnyRecord)?.biomeId, `${surface}.biome`),
    money: finiteNumber(game.scene.money, `${surface}.money`),
    lock_modifier_tiers: Boolean(game.scene.lockModifierTiers),
    reroll: Boolean(game.scene.reroll),
    options: optionGraph(options, `${surface}.options`),
    ...(quantities === undefined ? {} : { quantities: jsonValue(quantities, `${surface}.quantities`) }),
    modifiers: modifierGraph(game),
    party: partyGraph(game),
  };
}

function emptySurface(): SurfaceCapture {
  return {
    decisions: [],
    rngDraws: [],
    orderedTransitions: [],
    mutations: [],
    presentation: [],
    rawKeyTape: [],
    round: 0,
  };
}

function ensureSurface(context: CaptureContext, surface: Surface): SurfaceCapture {
  const current = context[surface] ?? (context[surface] = emptySurface());
  return current;
}

function activeSurface(surface: Surface): SurfaceCapture | null {
  if (activeCapture?.surface !== surface) {
    return null;
  }
  return ensureSurface(activeCapture, surface);
}

function captureMarketStart(
  context: CaptureContext,
  phaseValue: BiomeShopPhase,
  generationBefore: RecordValue | null,
): void {
  const surface = ensureSurface(context, "market");
  if (observedMarketPhase === phaseValue && surface.initial != null) {
    return;
  }
  const phase = phaseValue as AnyRecord;
  const options = phase.shopOptions;
  const quantities = phase.qtys;
  if (!Array.isArray(options) || !Array.isArray(quantities)) {
    gap(
      "MARKET_STOCK_UNOBSERVABLE",
      "src/phases/biome-shop-phase.ts:BiomeShopPhase.buildStock",
      "shopOptions/qtys were not initialized",
    );
  }
  observedMarketPhase = phaseValue;
  observedMarketOptions = options;
  observedMarketQuantities = quantities;
  surface.round += 1;
  const after = phaseGraph(context.game, phase, "market", options, quantities);
  surface.generationBefore = generationBefore ?? undefined;
  surface.generationAfter = after;
  surface.initial = { canonical: after, rng: sceneRng(context.game) };
  surface.orderedTransitions.push({
    sequence: surface.orderedTransitions.length,
    event: "START",
    phase: "BiomeShopPhase",
    round: surface.round,
  });
  surface.presentation.push({
    mode: String(context.game.scene.ui.getMode()),
    phase: "BiomeShopPhase",
    displayed_index: 0,
    stock: jsonValue(quantities),
  });
}

function installObservationHooks(): void {
  if (installed) {
    return;
  }
  installed = true;
  productionRandBattleSeedInt = BattleScene.prototype.randBattleSeedInt as AnyRecord["randBattleSeedInt"];

  const rng = Phaser.Math.RND as AnyRecord;
  const methods = ["integerInRange", "integer", "frac", "realInRange", "pick", "shuffle"] as const;
  let rngDrawInProgress = false;
  for (const methodName of methods) {
    const original = rng[methodName];
    if (typeof original !== "function") {
      gap("OBSERVATION_SEAM_MISSING", `phaser/src/math/random-data-generator/RandomDataGenerator.js:${methodName}`, `RND.${methodName} is not callable`);
    }
    rng[methodName] = function (this: AnyRecord, ...args: unknown[]): unknown {
      const context = activeCapture;
      if (context == null || rngDrawInProgress) {
        return original.apply(this, args);
      }
      const trace = ensureSurface(context, context.surface);
      const before = sceneRng(context.game);
      rngDrawInProgress = true;
      let result: unknown;
      try {
        result = original.apply(this, args);
      } finally {
        rngDrawInProgress = false;
      }
      const after = sceneRng(context.game);
      const stack = new Error().stack ?? "";
      const callsite = stack.split(/\r?\n/u).find(line => line.includes("src/"))?.trim() ?? "unknown";
      const draw: RecordValue = {
        sequence: trace.rngDraws.length,
        stream: "RUN",
        public_api: methodName === "integerInRange" ? "INTEGER_IN_RANGE" : methodName.toUpperCase(),
        callsite,
        before,
        after,
      };
      if (methodName === "integerInRange") {
        const minimum = finiteNumber(args[0], "rng.minimum");
        const maximum = finiteNumber(args[1], "rng.maximum");
        draw.minimum = minimum;
        draw.cardinality = maximum - minimum + 1;
        draw.result = finiteNumber(result, "rng.result");
      } else if (methodName === "pick") {
        const values = args[0] as ArrayLike<unknown>;
        if (values == null || !Number.isSafeInteger(values.length) || values.length <= 0) {
          gap("RNG_DRAW_UNOBSERVABLE", "src/utils/common.ts:randSeedInt", "pick input is not a non-empty array-like value");
        }
        const index = Array.from(values as ArrayLike<unknown>).indexOf(result);
        if (index < 0) {
          gap("RNG_DRAW_UNOBSERVABLE", "src/utils/common.ts:randSeedInt", "pick result is absent from its input");
        }
        draw.minimum = 0;
        draw.cardinality = values.length;
        draw.result = index;
      } else if (typeof result === "number") {
        draw.result = finiteNumber(result, "rng.result");
      } else {
        draw.result = jsonValue(result, "rng.result");
      }
      trace.rngDraws.push(draw);
      return result;
    };
    restoreHooks.push(() => {
      rng[methodName] = original;
    });
  }

  const originalRewardStart = SelectModifierPhase.prototype.start;
  (SelectModifierPhase.prototype as AnyRecord).start = function (this: SelectModifierPhase): unknown {
    const surface = this instanceof BiomeShopPhase ? null : activeSurface("reward");
    const context = activeCapture;
    const before = surface == null || context == null ? null : phaseGraph(context.game, this as AnyRecord, "reward", []);
    const result = originalRewardStart.call(this);
    if (surface != null && context != null) {
      observedRewardPhase = this;
      const options = (this as AnyRecord).typeOptions;
      if (!Array.isArray(options)) {
        gap("REWARD_OPTIONS_UNOBSERVABLE", "src/phases/select-modifier-phase.ts:SelectModifierPhase.start", "typeOptions was not initialized");
      }
      observedRewardOptions = options;
      surface.round += 1;
      const after = phaseGraph(context.game, this as AnyRecord, "reward", options);
      surface.generationBefore = before ?? undefined;
      surface.generationAfter = after;
      if (surface.round === 1) {
        surface.initial = { canonical: after, rng: sceneRng(context.game) };
      } else {
        surface.decisions.push({ kind: "REROLL_OPEN", round: surface.round, canonical: after, rng: sceneRng(context.game) });
      }
      surface.orderedTransitions.push({ sequence: surface.orderedTransitions.length, event: "START", phase: "SelectModifierPhase", round: surface.round });
      surface.presentation.push({ mode: String(context.game.scene.ui.getMode()), phase: "SelectModifierPhase", round: surface.round });
    }
    return result;
  };
  restoreHooks.push(() => {
    SelectModifierPhase.prototype.start = originalRewardStart;
  });

  const originalMarketStart = BiomeShopPhase.prototype.start;
  (BiomeShopPhase.prototype as AnyRecord).start = function (this: BiomeShopPhase): unknown {
    const context = activeCapture;
    const before =
      context == null || activeSurface("market") == null
        ? null
        : phaseGraph(context.game, this as AnyRecord, "market", [], []);
    const result = originalMarketStart.call(this);
    if (context != null && activeSurface("market") != null) {
      captureMarketStart(context, this, before);
    }
    return result;
  };
  restoreHooks.push(() => {
    BiomeShopPhase.prototype.start = originalMarketStart;
  });
  const phasePrototype = SelectModifierPhase.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const originalApplyModifier = phasePrototype.applyModifier;
  if (typeof originalApplyModifier !== "function") {
    gap("OBSERVATION_SEAM_MISSING", "src/phases/select-modifier-phase.ts:applyModifier", "SelectModifierPhase.applyModifier is not callable");
  }
  phasePrototype.applyModifier = function (this: SelectModifierPhase, modifier: AnyRecord, cost = -1, playSound = false): boolean {
    const context = activeCapture;
    const surface = context == null ? null : this instanceof BiomeShopPhase ? activeSurface("market") : activeSurface("reward");
    const before = context == null || surface == null ? null : phaseGraph(
      context.game,
      this as AnyRecord,
      this instanceof BiomeShopPhase ? "market" : "reward",
      this instanceof BiomeShopPhase ? (this as AnyRecord).shopOptions : (this as AnyRecord).typeOptions ?? [],
      this instanceof BiomeShopPhase ? (this as AnyRecord).qtys : undefined,
    );
    const result = originalApplyModifier.call(this, modifier, cost, playSound) as boolean;
    if (context != null && surface != null) {
      const phase = this as AnyRecord;
      const options = this instanceof BiomeShopPhase ? phase.shopOptions : phase.typeOptions;
      const quantities = this instanceof BiomeShopPhase ? phase.qtys : undefined;
      const after = phaseGraph(context.game, phase, this instanceof BiomeShopPhase ? "market" : "reward", options ?? [], quantities);
      const kind = this instanceof BiomeShopPhase ? "PURCHASE" : "TARGETED_REWARD";
      surface.mutations.push({ sequence: surface.mutations.length, kind, accepted: Boolean(result), before, after });
      surface.decisions.push({
        kind,
        accepted: Boolean(result),
        cost: finiteNumber(cost, `${kind}.cost`),
        modifier_id: String(modifier?.type?.id ?? ""),
        modifier_constructor: String(modifier?.constructor?.name ?? ""),
        target_party_id: modifier?.pokemonId == null ? null : finiteNumber(modifier.pokemonId, `${kind}.target_party_id`),
        post_money: finiteNumber(context.game.scene.money, `${kind}.post_money`),
        ...(this instanceof BiomeShopPhase ? { remaining_stock: jsonValue(quantities) } : {}),
      });
      if (this instanceof BiomeShopPhase) {
        surface.presentation.push({ mode: String(context.game.scene.ui.getMode()), phase: "BiomeShopPhase", displayed_index: finiteNumber((context.game.scene.ui.getHandler() as AnyRecord)?.cursor ?? -1, "market.displayed_index"), stock: jsonValue(quantities) });
      } else if (cost === -1) {
        surface.final = { canonical: after, rng: sceneRng(context.game) };
      }
    }
    return result;
  };
  restoreHooks.push(() => {
    phasePrototype.applyModifier = originalApplyModifier;
  });

  const originalMarketEnd = (BiomeShopPhase.prototype as unknown as Record<string, (...args: unknown[]) => unknown>).end;
  const marketPrototype = BiomeShopPhase.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  if (typeof originalMarketEnd !== "function") {
    gap("OBSERVATION_SEAM_MISSING", "src/phases/biome-shop-phase.ts:BiomeShopPhase.end", "BiomeShopPhase.end is not callable");
  }
  marketPrototype.end = function (this: BiomeShopPhase): unknown {
    const context = activeCapture;
    const surface = activeSurface("market");
    const result = originalMarketEnd.call(this);
    if (context != null && surface != null && surface.leaveRequested) {
      const phase = this as AnyRecord;
      surface.final = {
        canonical: phaseGraph(context.game, phase, "market", phase.shopOptions ?? [], phase.qtys ?? []),
        rng: sceneRng(context.game),
      };
      surface.orderedTransitions.push({ sequence: surface.orderedTransitions.length, event: "END", phase: "BiomeShopPhase", reason: "LEAVE" });
    }
    return result;
  };
  restoreHooks.push(() => {
    marketPrototype.end = originalMarketEnd;
  });

}
function restoreObservationHooks(): void {
  for (const restore of restoreHooks.splice(0).reverse()) {
    restore();
  }
  installed = false;
  observedRewardPhase = null;
  observedMarketPhase = null;
  observedRewardOptions = [];
  observedMarketOptions = [];
  observedMarketQuantities = [];
}

async function waitUntil(
  predicate: () => boolean,
  vector: string,
  sourceSeam: string,
  timeoutMs = 20_000,
  diagnostics?: () => RecordValue,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      const state = diagnostics == null ? "" : `; state=${JSON.stringify(diagnostics())}`;
      gap("LIVE_CALLBACK_UNOBSERVABLE", sourceSeam, `${vector} did not reach its live callback frontier${state}`);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function ensurePhaserGame(): Phaser.Game {
  if (phaserGame == null) {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS, seed: ["m4-oracle-anchor"] });
  }
  return phaserGame;
}

async function launchGame(wave: number, seed: string): Promise<GameManager> {
  const gameInstance = ensurePhaserGame();
  const boot = Promise.withResolvers<void>();
  setTimeout(boot.resolve, 0);
  await boot.promise;
  const manager = new GameManager(gameInstance);
  if (productionRandBattleSeedInt == null) {
    productionRandBattleSeedInt = BattleScene.prototype.randBattleSeedInt as AnyRecord["randBattleSeedInt"];
  }
  if (productionRandBattleSeedInt == null) {
    gap("OBSERVATION_SEAM_MISSING", "src/battle-scene.ts:BattleScene.randBattleSeedInt", "production battle RNG method was not captured");
  }
  (BattleScene.prototype as AnyRecord).randBattleSeedInt = productionRandBattleSeedInt;
  manager.override
    .battleStyle(BattleStyle.SET)
    .moveset(MoveId.SPLASH)
    .enemyMoveset(MoveId.SPLASH)
    .startingBiome(BiomeId.TOWN)
    .startingWave(wave)
    .seed(`${SEED_PREFIX}-${seed}`);
  await manager.classicMode.startBattle(SpeciesId.SQUIRTLE);
  manager.scene.money = MONEY;
  // The boot-time biome-structure roll runs before the harness pins the run
  // seed, so re-issue the production addressed roll (battle-scene.ts:2497
  // semantics) against the pinned seed before any frontier is captured.
  erRollBiomeLength(BiomeId.TOWN, 1, manager.scene.seed);
  manager.scene.reroll = false;
  return manager;
}

function releaseGame(game: GameManager | null): void {
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  if (game == null) {
    return;
  }
  game.promptHandler.clearPrompts();
  game.scene.phaseManager.clearAllPhases();
  const ui = game.scene.ui as AnyRecord;
  const handler = typeof ui.getHandler === "function" ? (ui.getHandler() as AnyRecord | undefined) : undefined;
  if (typeof handler?.clear === "function") {
    handler.clear();
  }
  if (typeof ui.resetModeChain === "function") {
    ui.resetModeChain();
  }
  const setModeInternal = ui.setModeInternal;
  if (typeof setModeInternal?.mockRestore === "function") {
    setModeInternal.mockRestore();
  }
}

function addLockCapsule(game: GameManager): void {
  const factory = (modifierTypes as AnyRecord).LOCK_CAPSULE;
  if (typeof factory !== "function") {
    gap("CONTENT_REGISTRY_UNINITIALIZED", "src/data/data-lists.ts:modifierTypes", "LOCK_CAPSULE factory is not registered");
  }
  const type = factory().withIdFromFunc(factory);
  const modifier = type?.newModifier?.();
  if (modifier == null || modifier.type?.id !== "LOCK_CAPSULE") {
    gap("LOCK_CAPSULE_UNOBSERVABLE", "src/modifier/modifier-type.ts:modifierTypes.LOCK_CAPSULE", "live Lock Capsule modifier could not be constructed");
  }
  if (!game.scene.addModifier(modifier, true, false)) {
    gap("LOCK_CAPSULE_UNOBSERVABLE", "src/battle-scene.ts:BattleScene.addModifier", "live Lock Capsule acquisition was rejected");
  }
  const found = game.scene.findModifier((candidate: AnyRecord) => candidate.type?.id === "LOCK_CAPSULE");
  if (found == null) {
    gap("LOCK_CAPSULE_UNOBSERVABLE", "src/battle-scene.ts:BattleScene.findModifier", "Lock Capsule is absent after live acquisition");
  }
}

function driveKey(game: GameManager, button: Button, key: string, surface: Surface): boolean {
  const trace = activeSurface(surface);
  if (trace == null) {
    gap("RAW_KEY_TAPE_UNOBSERVABLE", "src/ui/ui.ts:Ui.processInput", `no active ${surface} trace for ${key}`);
  }
  const modeBefore = String(game.scene.ui.getMode());
  const result = game.scene.ui.processInput(button);
  const handler = game.scene.ui.getHandler() as AnyRecord | null;
  const handlerState: RecordValue = {};
  if (surface === "reward" && handler instanceof ModifierSelectUiHandler) {
    const cursor = (handler as AnyRecord).cursor;
    const rowCursor = (handler as AnyRecord).rowCursor;
    if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(rowCursor)) {
      gap(
        "REWARD_UI_CURSOR_UNOBSERVABLE",
        "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
        `handler cursor state after ${key} is not an integer`,
      );
    }
    handlerState.cursor = cursor;
    handlerState.row_cursor = rowCursor;
  } else if (surface === "market" && handler instanceof BiomeShopUiHandler) {
    const cursor = (handler as AnyRecord).cursor;
    if (!Number.isSafeInteger(cursor)) {
      gap(
        "MARKET_UI_CURSOR_UNOBSERVABLE",
        "src/ui/handlers/biome-shop-ui-handler.ts:processInput",
        `handler cursor after ${key} is not an integer`,
      );
    }
    handlerState.cursor = cursor;
  }
  const accepted = Boolean(result);
  trace.rawKeyTape.push({
    sequence: trace.rawKeyTape.length,
    key,
    mode_before: modeBefore,
    mode_after: String(game.scene.ui.getMode()),
    accepted,
    ...(Object.keys(handlerState).length === 0 ? {} : { handler: handlerState }),
  });
  return accepted;
}

type ModifierCursorState = {
  rowCursor: number;
  cursor: number;
};

function rewardCursorState(game: GameManager, vector: string): ModifierCursorState {
  const handler = game.scene.ui.getHandler();
  if (!(handler instanceof ModifierSelectUiHandler)) {
    gap(
      "REWARD_UI_CURSOR_UNOBSERVABLE",
      "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
      `${vector} did not expose ModifierSelectUiHandler`,
    );
  }
  const cursor = (handler as AnyRecord).cursor;
  const rowCursor = (handler as AnyRecord).rowCursor;
  if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(rowCursor)) {
    gap(
      "REWARD_UI_CURSOR_UNOBSERVABLE",
      "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
      `${vector} handler cursor state is not an integer`,
    );
  }
  return { rowCursor, cursor };
}

function driveRewardNavigation(game: GameManager, button: Button, key: string, vector: string): ModifierCursorState {
  const surface = activeSurface("reward");
  if (surface == null) {
    gap("REWARD_TRACE_UNOBSERVABLE", "test/kernel-fixtures/m4/export/reward-market-capture.ts:driveReward", "reward trace is absent");
  }
  driveKey(game, button, key, "reward");
  const state = rewardCursorState(game, vector);
  surface.presentation.push({
    mode: String(game.scene.ui.getMode()),
    phase: "ModifierSelectUiHandler",
    input: key,
    row_cursor: state.rowCursor,
    cursor: state.cursor,
  });
  return state;
}

async function awaitModifierInput(game: GameManager): Promise<ModifierSelectUiHandler> {
  await waitUntil(
    () => game.scene.ui.getMode() === UiMode.MODIFIER_SELECT && Boolean((game.scene.ui.getHandler() as AnyRecord)?.awaitingActionInput),
    "regular reward UI",
    "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
  );
  return game.scene.ui.getHandler() as ModifierSelectUiHandler;
}

async function awaitMarketInput(game: GameManager): Promise<BiomeShopUiHandler> {
  await waitUntil(
    () => game.scene.ui.getMode() === UiMode.BIOME_SHOP && (game.scene.ui.getHandler() as AnyRecord)?.active === true,
    "Town market UI",
    "src/ui/handlers/biome-shop-ui-handler.ts:processInput",
  );
  return game.scene.ui.getHandler() as BiomeShopUiHandler;
}

async function awaitRewardPhase(_game: GameManager): Promise<SelectModifierPhase> {
  await waitUntil(
    () => observedRewardPhase != null && activeCapture?.reward?.initial != null,
    "wave-9 reward generation",
    "src/phases/select-modifier-phase.ts:start",
  );
  if (observedRewardPhase == null) {
    gap(
      "REWARD_PHASE_UNOBSERVABLE",
      "src/phases/select-modifier-phase.ts:start",
      "observed reward phase disappeared",
    );
  }
  return observedRewardPhase;
}

async function awaitMarketPhase(_game: GameManager): Promise<BiomeShopPhase> {
  await waitUntil(
    () => observedMarketPhase != null && activeCapture?.market?.initial != null,
    "wave-10 Town market generation",
    "src/phases/biome-shop-phase.ts:start",
  );
  if (observedMarketPhase == null) {
    gap(
      "MARKET_PHASE_UNOBSERVABLE",
      "src/phases/biome-shop-phase.ts:start",
      "observed market phase disappeared",
    );
  }
  return observedMarketPhase;
}

function phaseOptions(_phase: AnyRecord, market: boolean): AnyRecord[] {
  const options = market ? observedMarketOptions : observedRewardOptions;
  if (options.length === 0) {
    gap(
      "OPTION_GRAPH_UNOBSERVABLE",
      market
        ? "src/phases/biome-shop-phase.ts:BiomeShopPhase.shopOptions"
        : "src/phases/select-modifier-phase.ts:SelectModifierPhase.typeOptions",
      "phase option graph is absent",
    );
  }
  return options;
}

function findTargetedReward(phase: SelectModifierPhase): number {
  const options = phaseOptions(phase as AnyRecord, false);
  return options.findIndex(option => option?.type instanceof PokemonModifierType);
}

function findDirectMarketOption(phase: BiomeShopPhase): number {
  const options = phaseOptions(phase as AnyRecord, true);
  const quantities = observedMarketQuantities;
  return options.findIndex((option, index) => option?.type != null && !(option.type instanceof PokemonModifierType) && Number(quantities[index]) > 0);
}

async function driveReward(game: GameManager): Promise<void> {
  const surface = activeSurface("reward");
  if (surface == null) {
    gap("REWARD_TRACE_UNOBSERVABLE", "test/kernel-fixtures/m4/export/reward-market-capture.ts:driveReward", "reward trace is absent");
  }
  const phase = awaitRewardPhase(game);
  const initialOptions = phaseOptions(phase as AnyRecord, false);
  const initialGraph = optionGraph(initialOptions, "reward.initial.options");
  surface.decisions.push({ kind: "INITIAL_OPTIONS", count: initialGraph.length, options: initialGraph });
  await awaitModifierInput(game);
  const initialCursor = rewardCursorState(game, "initial reward presentation");
  surface.presentation.push({
    mode: String(game.scene.ui.getMode()),
    phase: "ModifierSelectUiHandler",
    input: "INITIAL",
    row_cursor: initialCursor.rowCursor,
    cursor: initialCursor.cursor,
  });
  if (initialCursor.rowCursor !== 1 || initialCursor.cursor !== 0) {
    gap(
      "REWARD_UI_CURSOR_UNEXPECTED",
      "src/ui/handlers/modifier-select-ui-handler.ts:setRowCursor",
      `reward opened at row ${String(initialCursor.rowCursor)} cursor ${String(initialCursor.cursor)}, expected rewards row cursor 0`,
    );
  }
  const lockBefore = Boolean(game.scene.lockModifierTiers);
  if (lockBefore) {
    gap("REWARD_LOCK_STATE_UNEXPECTED", "src/battle-scene.ts:BattleScene.lockModifierTiers", "lockModifierTiers was already true before the UI lock action");
  }

  const rewardRowCursor = driveRewardNavigation(game, Button.DOWN, "DOWN", "move from rewards row to action row");
  if (rewardRowCursor.rowCursor !== 0 || rewardRowCursor.cursor !== 0) {
    gap(
      "REWARD_UI_CURSOR_UNEXPECTED",
      "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
      `first DOWN reached row ${String(rewardRowCursor.rowCursor)} cursor ${String(rewardRowCursor.cursor)}, expected action row cursor 0`,
    );
  }
  const lockCursor = driveRewardNavigation(game, Button.DOWN, "DOWN", "move from reroll to lock action");
  if (lockCursor.rowCursor !== 0 || lockCursor.cursor !== 3) {
    gap(
      "REWARD_UI_CURSOR_UNEXPECTED",
      "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
      `second DOWN reached row ${String(lockCursor.rowCursor)} cursor ${String(lockCursor.cursor)}, expected lock cursor 3`,
    );
  }
  driveKey(game, Button.ACTION, "ACTION", "reward");
  await waitUntil(() => game.scene.lockModifierTiers === true, "Lock Capsule toggle", "src/phases/select-modifier-phase.ts:toggleRerollLock");
  surface.decisions.push({ kind: "LOCK_TOGGLE", before: lockBefore, after: Boolean(game.scene.lockModifierTiers), cursor: lockCursor.cursor, row_cursor: lockCursor.rowCursor, rng: sceneRng(game), lock_modifier_present: true });

  await awaitModifierInput(game);
  let rerollCursor = rewardCursorState(game, "after lock toggle");
  if (rerollCursor.rowCursor !== 0 || rerollCursor.cursor !== 3) {
    gap(
      "REWARD_UI_CURSOR_UNEXPECTED",
      "src/ui/handlers/modifier-select-ui-handler.ts:setCursor",
      `lock action left row ${String(rerollCursor.rowCursor)} cursor ${String(rerollCursor.cursor)}, expected lock cursor 3`,
    );
  }
  for (let navigation = 0; navigation < 4 && rerollCursor.cursor !== 0; navigation++) {
    if (rerollCursor.rowCursor !== 0) {
      gap(
        "REWARD_UI_CURSOR_UNEXPECTED",
        "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
        `reroll navigation left action row at row ${String(rerollCursor.rowCursor)}`,
      );
    }
    rerollCursor = driveRewardNavigation(game, Button.RIGHT, "RIGHT", `move to reroll action ${String(navigation + 1)}`);
  }
  if (rerollCursor.rowCursor !== 0 || rerollCursor.cursor !== 0) {
    gap(
      "REWARD_UI_CURSOR_UNEXPECTED",
      "src/ui/handlers/modifier-select-ui-handler.ts:processInput",
      `reroll navigation ended at row ${String(rerollCursor.rowCursor)} cursor ${String(rerollCursor.cursor)}, expected reroll cursor 0`,
    );
  }
  surface.decisions.push({ kind: "REROLL_NAVIGATION", row_cursor: rerollCursor.rowCursor, cursor: rerollCursor.cursor });
  const oldPhase = phase;
  const oldPhaseName = String(oldPhase.phaseName ?? oldPhase.constructor?.name ?? "");
  const oldMode = String(game.scene.ui.getMode());
  const oldMoney = game.scene.money;
  const rerollAccepted = driveKey(game, Button.ACTION, "ACTION", "reward");
  const rerollState = (): RecordValue => {
    const currentPhase = game.scene.phaseManager.getCurrentPhase() as AnyRecord | null;
    const currentMoney = (game.scene as AnyRecord).money;
    return {
      accepted: rerollAccepted,
      old_phase: oldPhaseName,
      new_phase: String(currentPhase?.phaseName ?? currentPhase?.constructor?.name ?? ""),
      distinct_phase_object: currentPhase != null && currentPhase !== oldPhase,
      mode_before: oldMode,
      mode_now: String(game.scene.ui.getMode()),
      reroll: Boolean(game.scene.reroll),
      money_before: typeof oldMoney === "number" && Number.isFinite(oldMoney) ? oldMoney : null,
      money_now: typeof currentMoney === "number" && Number.isFinite(currentMoney) ? currentMoney : null,
      surface_round: surface.round,
    };
  };
  // SelectModifierPhase.rerollModifiers queues its successor, then its UiMode.MESSAGE continuation
  // calls super.end(). The PhaseInterceptor intentionally replaces the manager's private start head,
  // so let that public end/queue continuation settle before asking the interceptor to run the queued
  // successor. This exercises the real UI and phase-manager path without calling either private action.
  await waitUntil(
    () => game.scene.phaseManager.getCurrentPhase() !== oldPhase,
    "queued reward reroll successor",
    "src/app/phase-manager.ts:PhaseManager.shiftPhase",
    20_000,
    rerollState,
  );
  await game.phaseInterceptor.to("SelectModifierPhase");
  await waitUntil(
    () => surface.round >= 2 && game.scene.reroll === false,
    "one reward reroll",
    "src/phases/select-modifier-phase.ts:rerollModifiers",
    20_000,
    rerollState,
  );
  const rerolled = awaitRewardPhase(game);
  if (rerolled === oldPhase) {
    gap("REWARD_REROLL_SUCCESSOR_UNOBSERVABLE", "src/phases/select-modifier-phase.ts:rerollModifiers", "reroll did not start a successor SelectModifierPhase");
  }
  const targetIndex = findTargetedReward(rerolled);
  if (targetIndex < 0) {
    gap("REWARD_TARGET_OPTION_UNOBSERVABLE", "src/phases/select-modifier-phase.ts:getModifierTypeOptions", "the live reroll contained no PokemonModifierType target option");
  }
  const rerolledOptions = phaseOptions(rerolled as AnyRecord, false);
  surface.decisions.push({ kind: "REROLL", round: 1, options: optionGraph(rerolledOptions, "reward.rerolled.options"), target_index: targetIndex });
  const rerollHandler = await awaitModifierInput(game);
  const currentCursor = Number((rerollHandler as AnyRecord).cursor ?? 0);
  if (!Number.isSafeInteger(currentCursor)) {
    gap("REWARD_UI_CURSOR_UNOBSERVABLE", "src/ui/handlers/modifier-select-ui-handler.ts:setCursor", "reroll reward cursor is not an integer");
  }
  for (let cursor = currentCursor; cursor < targetIndex; cursor++) {
    driveKey(game, Button.RIGHT, "RIGHT", "reward");
  }
  for (let cursor = currentCursor; cursor > targetIndex; cursor--) {
    driveKey(game, Button.LEFT, "LEFT", "reward");
  }
  game.doSelectPartyPokemon(0, "SelectModifierPhase");
  driveKey(game, Button.ACTION, "ACTION", "reward");
  await waitUntil(() => surface.final != null, "targeted reward application", "src/phases/select-modifier-phase.ts:applyModifier");
  surface.presentation.push({ mode: String(game.scene.ui.getMode()), phase: String(game.scene.phaseManager.getCurrentPhase()?.phaseName ?? ""), selected_index: targetIndex });
}

async function driveMarket(game: GameManager): Promise<void> {
  const surface = activeSurface("market");
  if (surface == null) {
    gap("MARKET_TRACE_UNOBSERVABLE", "test/kernel-fixtures/m4/export/reward-market-capture.ts:driveMarket", "market trace is absent");
  }
  const phase = awaitMarketPhase(game);
  if (game.scene.arena.biomeId !== BiomeId.TOWN) {
    gap("MARKET_BIOME_UNOBSERVABLE", "src/phases/biome-shop-phase.ts:buildStock", `market opened in biome ${String(game.scene.arena.biomeId)}, not Town`);
  }
  const options = phaseOptions(phase as AnyRecord, true);
  const quantities = [...observedMarketQuantities];
  if (quantities.length === 0) {
    gap(
      "MARKET_STOCK_UNOBSERVABLE",
      "src/phases/biome-shop-phase.ts:BiomeShopPhase.buildStock",
      "captured market quantities are empty",
    );
  }
  surface.decisions.push({ kind: "MARKET_STOCK", biome: BiomeId.TOWN, options: optionGraph(options, "market.stock.options"), quantities: jsonValue(quantities, "market.stock.quantities") });
  const index = findDirectMarketOption(phase);
  if (index < 0) {
    gap("MARKET_DIRECT_OPTION_UNOBSERVABLE", "src/modifier/modifier-type.ts:getPlayerShopModifierTypeOptionsForWave", "Town stock contained no supported direct purchase");
  }
  const handler = await awaitMarketInput(game);
  const cursor = Number((handler as AnyRecord).cursor ?? 0);
  if (!Number.isSafeInteger(cursor)) {
    gap("MARKET_UI_CURSOR_UNOBSERVABLE", "src/ui/handlers/biome-shop-ui-handler.ts:setCursor", "market displayed index is not an integer");
  }
  const key = (button: Button): string => {
    switch (button) {
      case Button.DOWN:
        return "DOWN";
      case Button.UP:
        return "UP";
      case Button.RIGHT:
        return "RIGHT";
      default:
        return "LEFT";
    }
  };
  let current = cursor;
  while (Math.floor(current / 4) < Math.floor(index / 4)) {
    driveKey(game, Button.DOWN, "DOWN", "market");
    current = Number((handler as AnyRecord).cursor ?? current);
  }
  while (Math.floor(current / 4) > Math.floor(index / 4)) {
    driveKey(game, Button.UP, "UP", "market");
    current = Number((handler as AnyRecord).cursor ?? current);
  }
  while (current % 4 < index % 4) {
    driveKey(game, Button.RIGHT, "RIGHT", "market");
    current = Number((handler as AnyRecord).cursor ?? current);
  }
  while (current % 4 > index % 4) {
    driveKey(game, Button.LEFT, "LEFT", "market");
    current = Number((handler as AnyRecord).cursor ?? current);
  }
  const displayedIndex = Number((handler as AnyRecord).cursor ?? -1);
  if (displayedIndex !== index) {
    gap("MARKET_DISPLAYED_INDEX_UNOBSERVABLE", "src/ui/handlers/biome-shop-ui-handler.ts:moveCursorTo", `displayed index ${String(displayedIndex)} does not equal selected index ${String(index)}`);
  }
  surface.decisions.push({
    kind: "PURCHASE_INTENT",
    displayed_index: displayedIndex,
    modifier_id: String(options[index]?.type?.id ?? ""),
    rounded_price: finiteNumber(options[index]?.cost, "market.purchase.rounded_price"),
    quantity_before: finiteNumber(quantities[index], "market.purchase.quantity_before"),
  });
  const moneyBeforePurchase = finiteNumber(game.scene.money, "market.purchase.money_before");
  const purchaseAccepted = driveKey(game, Button.ACTION, "ACTION", "market");
  if (!purchaseAccepted) {
    gap(
      "MARKET_PURCHASE_REJECTED",
      "src/phases/biome-shop-phase.ts:onSelect",
      `public market action rejected slot ${index}`,
    );
  }
  await waitUntil(
    () =>
      Number(handler.getStock(index)) < Number(quantities[index])
      && Number(game.scene.money) < moneyBeforePurchase,
    "market purchase",
    "src/phases/biome-shop-phase.ts:applyModifier",
    20_000,
    () => ({
      accepted: purchaseAccepted,
      displayed_index: Number((handler as AnyRecord).cursor ?? -1),
      mode: String(game.scene.ui.getMode()),
      quantity_before: Number(quantities[index]),
      quantity_now: Number(handler.getStock(index)),
      money_before: moneyBeforePurchase,
      money_now: Number(game.scene.money),
    }),
  );
  const liveQuantities = options.map((_, stockIndex) =>
    finiteNumber(handler.getStock(stockIndex), `market.stock.remaining[${stockIndex}]`),
  );
  surface.decisions.push({ kind: "PURCHASE_COMMITTED", displayed_index: displayedIndex, remaining: jsonValue(liveQuantities) });
  const afterPurchase = await awaitMarketInput(game);
  surface.presentation.push({ mode: String(game.scene.ui.getMode()), phase: "BiomeShopPhase", displayed_index: Number((afterPurchase as AnyRecord).cursor ?? -1), stock: jsonValue(liveQuantities) });

  surface.leaveRequested = true;
  driveKey(game, Button.CANCEL, "CANCEL", "market");
  await waitUntil(() => game.scene.ui.getMode() === UiMode.CONFIRM, "market leave confirmation", "src/phases/biome-shop-phase.ts:confirmLeave");
  driveKey(game, Button.ACTION, "ACTION", "market");
  await waitUntil(() => surface.final != null, "market leave", "src/phases/biome-shop-phase.ts:confirmLeave");
  surface.decisions.push({ kind: "LEAVE", confirmed: true, remaining: jsonValue(liveQuantities), money: finiteNumber(game.scene.money, "market.leave.money") });
}

function validateSurface(surface: SurfaceCapture | undefined, vector: string): RecordValue {
  if (surface == null || surface.initial == null || surface.final == null) {
    gap("CAPTURE_FRONTIER_INCOMPLETE", "test/kernel-fixtures/m4/export/reward-market-capture.ts", `${vector} did not produce initial and final live evidence`);
  }
  const canonicalFinal = surface.final.canonical;
  if (canonicalFinal == null || typeof canonicalFinal !== "object" || Array.isArray(canonicalFinal)) {
    gap("CAPTURE_FRONTIER_INCOMPLETE", "test/kernel-fixtures/m4/export/reward-market-capture.ts", `${vector} final canonical graph is not an object`);
  }
  return {
    initial: jsonValue(surface.initial, `${vector}.initial`) as RecordValue,
    decisions: jsonValue(surface.decisions, `${vector}.decisions`) as JsonValue[],
    rng_draws: jsonValue(surface.rngDraws, `${vector}.rng_draws`) as JsonValue[],
    ordered_transitions: jsonValue(surface.orderedTransitions, `${vector}.ordered_transitions`) as JsonValue[],
    mutations: jsonValue(surface.mutations, `${vector}.mutations`) as JsonValue[],
    presentation: jsonValue(surface.presentation, `${vector}.presentation`) as JsonValue[],
    final: jsonValue(surface.final, `${vector}.final`) as RecordValue,
    next_control: { kind: "OBSERVED", phase: String((canonicalFinal as RecordValue).phase ?? "") },
    raw_key_tape: jsonValue(surface.rawKeyTape, `${vector}.raw_key_tape`) as JsonValue[],
  };
}

async function captureReward(seed: string): Promise<RecordValue> {
  let game: GameManager | null = null;
  try {
    game = await launchGame(9, seed);
    const liveGame = game;
    installObservationHooks();
    addLockCapsule(liveGame);
    const context: CaptureContext = { game: liveGame, surface: "reward", reward: emptySurface() };
    activeCapture = context;
    liveGame.move.select(MoveId.SPLASH);
    await liveGame.doKillOpponents();
    await liveGame.phaseInterceptor.to("SelectModifierPhase");
    const initialFrontier = frontier(liveGame);
    await driveReward(liveGame);
    const evidence = validateSurface(context.reward, "rewards/regular-reroll-lock-v1");
    return {
      ...evidence,
      initial: initialFrontier,
      initial_observation: evidence.initial,
      final: frontier(liveGame),
      final_observation: evidence.final,
      next_control: nextControl(liveGame),
    };
  } finally {
    activeCapture = null;
    releaseGame(game);
  }
}

async function captureMarket(seed: string): Promise<RecordValue> {
  let game: GameManager | null = null;
  try {
    game = await launchGame(10, seed);
    const liveGame = game;
    const context: CaptureContext = { game: liveGame, surface: "market", market: emptySurface() };
    activeCapture = context;
    liveGame.move.select(MoveId.SPLASH);
    await liveGame.doKillOpponents();
    // BiomeShopPhase intentionally inherits phaseName "SelectModifierPhase".
    // Drive the public phase boundary by that production identity, then prove
    // the concrete subclass before observing its generated stock.
    await liveGame.phaseInterceptor.to("SelectModifierPhase");
    const marketPhase = liveGame.scene.phaseManager.getCurrentPhase();
    if (!(marketPhase instanceof BiomeShopPhase)) {
      gap(
        "MARKET_PHASE_UNOBSERVABLE",
        "src/phases/biome-shop-phase.ts:BiomeShopPhase",
        "current production phase is not BiomeShopPhase",
      );
    }
    captureMarketStart(context, marketPhase, null);
    const initialFrontier = frontier(liveGame);
    await driveMarket(liveGame);
    const evidence = validateSurface(context.market, "markets/town-wave-10-v1");
    return {
      ...evidence,
      initial: initialFrontier,
      initial_observation: evidence.initial,
      final: frontier(liveGame),
      final_observation: evidence.final,
      next_control: nextControl(liveGame),
    };
  } finally {
    activeCapture = null;
    releaseGame(game);
  }
}

/** Capture regular wave-9 reward and Town wave-10 market from real production phases. */
export async function captureRewardMarket(): Promise<Record<string, JsonValue>> {
  try {
    let reward: RecordValue | null = null;
    let rewardGap: M4CaptureGap | null = null;
    for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS && reward == null; attempt++) {
      try {
        reward = await captureReward(String(attempt));
      } catch (error) {
        if (error instanceof M4CaptureGap && error.code === "REWARD_TARGET_OPTION_UNOBSERVABLE") {
          rewardGap = error;
          continue;
        }
        throw error;
      }
    }
    if (reward == null) {
      gap(
        rewardGap?.code ?? "REWARD_TARGET_OPTION_UNOBSERVABLE",
        rewardGap?.sourceSeam ?? "src/phases/select-modifier-phase.ts:getModifierTypeOptions",
        rewardGap?.message ?? "no deterministic live wave-9 seed produced a targeted reroll reward",
      );
    }
    const market = await captureMarket(String(0));
    return { reward, market };
  } finally {
    restoreObservationHooks();
    releaseGame(null);
    phaserGame?.destroy(true);
    phaserGame = null;
  }
}
