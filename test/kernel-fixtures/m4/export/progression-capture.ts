import { BattleScene } from "#app/battle-scene";
import { Battle } from "#app/battle";
import { buildDevScenario, type ScenarioSpec } from "#app/dev-tools/test-suite/scenario-spec";
import { getLevelTotalExp, GrowthRate } from "#data/exp";
import { getGameMode } from "#app/game-mode";
import Overrides from "#app/overrides";
import { erRollBiomeLength } from "#data/elite-redux/er-biome-structure";
import { PhaseManager } from "#app/phase-manager";
import { ExpNotification } from "#enums/exp-notification";
import { GameModes } from "#enums/game-modes";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { Button } from "#enums/buttons";
import {
  captureOracleFrontier,
  captureOracleNextControl,
  type JsonObject,
  type JsonValue,
} from "./oracle-frontier";
import Phaser from "phaser";
import { vi } from "vitest";
type AnyRecord = Record<string, any>;

type CaptureTrace = {
  readonly applyPartyExp: AnyRecord[];
  readonly addExp: AnyRecord[];
  readonly levelUp: AnyRecord[];
  readonly moveBatch: AnyRecord[];
  readonly setMove: AnyRecord[];
  readonly menuInputs: AnyRecord[];
  readonly phaseTransitions: AnyRecord[];
  readonly rngDraws: AnyRecord[];
};

/** A source seam that the test-only exporter could not drive or observe. */
export class M4CaptureGap extends Error {
  public readonly code: string;
  public readonly sourceSeam: string;

  constructor(code: string, sourceSeam: string, detail: string) {
    super(`${code} at ${sourceSeam}: ${detail}`);
    this.name = "M4CaptureGap";
    this.code = code;
    this.sourceSeam = sourceSeam;
  }
}

const SPECIES_ID = 932;
const INITIAL_LEVEL = 16;
const FINAL_LEVEL = 17;
const LEVEL_CAP_OVERRIDE = 17;
const INITIAL_MOVES = [1, 52, 77, 78] as const;
const RAW_CANDIDATES = [34] as const;
const LEARNED_MOVE = 34;
const LEARNED_SLOT = 0;

function gap(code: string, sourceSeam: string, detail: string): never {
  throw new M4CaptureGap(code, sourceSeam, detail);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    gap("NON_FINITE_LIVE_VALUE", sourceFor(path), `${path} is not a finite number`);
  }
  return value;
}

function sourceFor(path: string): string {
  if (path.includes("applyPartyExp")) {
    return "src/battle-scene.ts:applyPartyExp";
  }
  if (path.includes("addExp")) {
    return "src/field/pokemon.ts:addExp";
  }
  if (path.includes("candidate") || path.includes("move")) {
    return "src/phases/level-up-phase.ts -> src/phases/learn-move-batch-phase.ts";
  }
  return "test/kernel-fixtures/m4/export/progression-capture.ts:live snapshot";
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    gap("LIVE_VALUE_MISSING", sourceFor(path), `${path} is not an array`);
  }
  return value;
}

function requireExactNumbers(value: unknown, expected: readonly number[], path: string): number[] {
  const values = requireArray(value, path).map((entry, index) => finite(entry, `${path}[${index}]`));
  if (values.length !== expected.length || values.some((entry, index) => entry !== expected[index])) {
    gap("LIVE_VECTOR_MISMATCH", sourceFor(path), `${path}=${JSON.stringify(values)} expected ${JSON.stringify(expected)}`);
  }
  return values;
}

function jsonSafe(value: unknown, path = "$"): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value as JsonValue;
  }
  if (typeof value === "number") {
    finite(value, path);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => jsonSafe(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const output: JsonObject = {};
    for (const key of Object.keys(value)) {
      const entry = (value as AnyRecord)[key];
      if (entry === undefined) {
        gap("UNDEFINED_LIVE_VALUE", sourceFor(path), `${path}.${key} is undefined`);
      }
      output[key] = jsonSafe(entry, `${path}.${key}`);
    }
    return output;
  }
  gap("UNSUPPORTED_LIVE_VALUE", sourceFor(path), `${path} has unsupported type ${typeof value}`);
}

function moveSnapshot(pokemon: Pokemon): JsonValue[] {
  return pokemon.getMoveset(true).map(move => ({
    move_id: finite(move.moveId, "moves.move_id"),
    pp_used: finite(move.ppUsed, "moves.pp_used"),
    pp_up: finite(move.ppUp, "moves.pp_up"),
  }));
}

function statusSnapshot(pokemon: Pokemon): JsonValue {
  if (pokemon.status == null) {
    return null;
  }
  return {
    effect: finite(pokemon.status.effect, "status.effect"),
    toxic_turn_count: finite(pokemon.status.toxicTurnCount, "status.toxic_turn_count"),
    sleep_turns_remaining: pokemon.status.sleepTurnsRemaining == null ? null : finite(pokemon.status.sleepTurnsRemaining, "status.sleep_turns_remaining"),
  };
}

function pokemonSnapshot(pokemon: Pokemon, partySlot: number): JsonObject {
  const stats = requireArray(pokemon.stats, "pokemon.stats").map((entry, index) =>
    finite(entry, `pokemon.stats[${index}]`),
  );
  const ivs = requireArray(pokemon.ivs, "pokemon.ivs").map((entry, index) => finite(entry, `pokemon.ivs[${index}]`));
  if (stats.length !== 6 || ivs.length !== 6) {
    gap("LIVE_PROGRESSION_STATS_INCOMPLETE", "src/field/pokemon.ts:Pokemon constructor/calculateStats", "stats and IVs must have six live entries");
  }
  const nature = finite(pokemon.nature, "pokemon.nature");
  const effectiveNature = finite(pokemon.getNature(), "pokemon.getNature");
  const owner = Object.hasOwn(pokemon, "coopOwner") ? ((pokemon as AnyRecord).coopOwner ?? null) : null;
  return {
    id: finite(pokemon.id, "pokemon.id"),
    party_slot: partySlot,
    owner,
    species_id: finite(pokemon.species.speciesId, "pokemon.species.speciesId"),
    form_index: finite(pokemon.formIndex, "pokemon.formIndex"),
    level: finite(pokemon.level, "pokemon.level"),
    experience: finite(pokemon.exp, "pokemon.exp"),
    level_experience: finite(pokemon.levelExp, "pokemon.levelExp"),
    growth_rate: finite(pokemon.species.growthRate, "pokemon.species.growthRate"),
    ivs,
    nature,
    effective_nature: effectiveNature,
    friendship: finite(pokemon.friendship, "pokemon.friendship"),
    stats,
    hp: finite(pokemon.hp, "pokemon.hp"),
    max_hp: finite(pokemon.getMaxHp(), "pokemon.maxHp"),
    status: statusSnapshot(pokemon),
    stat_stages: requireArray(pokemon.getStatStages(), "pokemon.stat_stages").map((entry, index) =>
      finite(entry, `pokemon.stat_stages[${index}]`),
    ),
    pause_evolutions: pokemon.pauseEvolutions,
    moves: moveSnapshot(pokemon),
  };
}

function readPartySnapshot(game: GameManager, pokemon: Pokemon): JsonObject {
  const party = game.scene.getPlayerParty();
  const partySlot = party.indexOf(pokemon as (typeof party)[number]);
  if (partySlot < 0) {
    gap("PLAYER_POKEMON_NOT_IN_PARTY", "src/field/pokemon.ts:PlayerPokemon", "progression target is not in the live player party");
  }
  return pokemonSnapshot(pokemon, partySlot);
}

type RngCollector = {
  readonly draws: AnyRecord[];
  readonly restore: () => void;
};

function f64Bits(value: number): string {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, false);
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function rngState(value: unknown, path: string): JsonObject {
  if (typeof value !== "string") {
    gap("RNG_STATE_UNOBSERVABLE", "Phaser.Math.RandomDataGenerator.state", `${path} is not a string`);
  }
  const parts = value.split(",");
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (
    parts.length !== 5
    || parts[0] !== "!rnd"
    || !Number.isSafeInteger(carry)
    || carry < 0
    || carry > 0xffffffff
    || values.some(entry => !Number.isFinite(entry) || entry < 0 || entry >= 1)
  ) {
    gap("RNG_STATE_UNOBSERVABLE", "Phaser.Math.RandomDataGenerator.state", `${path} is malformed`);
  }
  return {
    state_string: value,
    s0_bits: f64Bits(values[0]),
    s1_bits: f64Bits(values[1]),
    s2_bits: f64Bits(values[2]),
    carry,
  };
}

function installRngTrace(): RngCollector {
  const random = Phaser.Math.RND as unknown as AnyRecord;
  const methods = [
    "integerInRange",
    "integer",
    "frac",
    "realInRange",
    "pick",
    "shuffle",
    "angle",
    "between",
    "normal",
    "weightedPick",
    "sign",
  ] as const;
  const restores: (() => void)[] = [];
  const draws: AnyRecord[] = [];
  let battleDrawInProgress = false;

  for (const method of methods) {
    const original = random[method];
    if (typeof original !== "function") {
      gap("RNG_OBSERVATION_SEAM_MISSING", `Phaser.Math.RND.${method}`, "RNG method is not callable");
    }
    random[method] = function (this: AnyRecord, ...args: unknown[]): unknown {
      if (battleDrawInProgress) {
        return original.apply(this, args);
      }
      const before = rngState(random.state(), `${method}.before`);
      const result = original.apply(this, args);
      const after = rngState(random.state(), `${method}.after`);
      draws.push({
        sequence: draws.length,
        stream: "RUN",
        public_api: method.toUpperCase(),
        arguments: jsonSafe(args, `${method}.arguments`),
        result: jsonSafe(result, `${method}.result`),
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

  const battleProto = Battle.prototype as unknown as AnyRecord;
  const originalBattleRand = battleProto.randSeedInt;
  if (typeof originalBattleRand !== "function") {
    gap("RNG_OBSERVATION_SEAM_MISSING", "src/battle.ts:Battle.randSeedInt", "battle RNG method is not callable");
  }
  battleProto.randSeedInt = function (this: AnyRecord, ...args: unknown[]): unknown {
    if (battleDrawInProgress) {
      return originalBattleRand.apply(this, args);
    }
    const battleState = this.battleSeedState ?? random.state();
    const before = rngState(battleState, "battle.before");
    battleDrawInProgress = true;
    let result: unknown;
    try {
      result = originalBattleRand.apply(this, args);
    } finally {
      battleDrawInProgress = false;
    }
    const after = rngState(this.battleSeedState ?? random.state(), "battle.after");
    draws.push({
      sequence: draws.length,
      stream: "BATTLE",
      public_api: "RAND_SEED_INT",
      arguments: jsonSafe(args, "battle.arguments"),
      result: jsonSafe(result, "battle.result"),
      consumed: before.state_string !== after.state_string,
      before_state: before,
      after_state: after,
    });
    return result;
  };
  restores.push(() => {
    battleProto.randSeedInt = originalBattleRand;
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

function installTrace(game: GameManager, trace: CaptureTrace): () => void {
  const battleSceneProto = BattleScene.prototype as AnyRecord;
  const pokemonProto = Pokemon.prototype as AnyRecord;
  const phaseManagerProto = PhaseManager.prototype as AnyRecord;
  const originalApply = battleSceneProto.applyPartyExp;
  const originalAddExp = pokemonProto.addExp;
  const originalSetMove = pokemonProto.setMove;
  const originalPushNew = phaseManagerProto.pushNew;
  const originalUnshiftNew = phaseManagerProto.unshiftNew;
  if (
    typeof originalApply !== "function"
    || typeof originalAddExp !== "function"
    || typeof originalSetMove !== "function"
    || typeof originalPushNew !== "function"
    || typeof originalUnshiftNew !== "function"
  ) {
    gap("PROGRESSION_SEAM_MISSING", "src/battle-scene.ts:applyPartyExp -> src/phases/exp-phase.ts", "one or more live observation methods are unavailable");
  }

  battleSceneProto.applyPartyExp = function (this: BattleScene, ...args: unknown[]): unknown {
    const participantIds = args[3] instanceof Set ? [...(args[3] as Set<unknown>)] : [...this.currentBattle.playerParticipantIds];
    const before = this.getPlayerParty().map((entry, index) => pokemonSnapshot(entry, index));
    const result = originalApply.apply(this, args);
    const after = this.getPlayerParty().map((entry, index) => pokemonSnapshot(entry, index));
    trace.applyPartyExp.push({
      exp_value: finite(args[0], "applyPartyExp.expValue"),
      pokemon_defeated: args[1] === true,
      use_wave_index_multiplier: args[2] === true,
      participant_ids: participantIds.map((entry, index) => finite(entry, `applyPartyExp.participantIds[${index}]`)),
      before,
      after,
    });
    return result;
  };

  pokemonProto.addExp = function (this: Pokemon, ...args: unknown[]): unknown {
    const before = { level: finite(this.level, "addExp.before.level"), experience: finite(this.exp, "addExp.before.exp") };
    const result = originalAddExp.apply(this, args);
    const after = { level: finite(this.level, "addExp.after.level"), experience: finite(this.exp, "addExp.after.exp") };
    trace.addExp.push({
      pokemon_id: finite(this.id, "addExp.pokemonId"),
      exp: finite(args[0], "addExp.exp"),
      ignore_level_cap: args[1] === true,
      before,
      after,
    });
    return result;
  };

  pokemonProto.setMove = function (this: Pokemon, ...args: unknown[]): unknown {
    const moveIndex = finite(args[0], "setMove.moveIndex");
    const moveId = finite(args[1], "setMove.moveId");
    const before = this.getMoveset(true).map(move => move.moveId);
    const result = originalSetMove.apply(this, args);
    const after = this.getMoveset(true).map(move => move.moveId);
    trace.setMove.push({
      pokemon_id: finite(this.id, "setMove.pokemonId"),
      move_index: moveIndex,
      move_id: moveId,
      before,
      after,
    });
    return result;
  };

  phaseManagerProto.pushNew = function (this: PhaseManager, phaseName: string, ...args: unknown[]): unknown {
    trace.phaseTransitions.push({ sequence: trace.phaseTransitions.length, operation: "PUSH", phase: phaseName });
    return originalPushNew.apply(this, [phaseName, ...args]);
  };

  phaseManagerProto.unshiftNew = function (this: PhaseManager, phaseName: string, ...args: unknown[]): unknown {
    trace.phaseTransitions.push({ sequence: trace.phaseTransitions.length, operation: "UNSHIFT", phase: phaseName });
    if (phaseName === "LevelUpPhase") {
      trace.levelUp.push({ phase: phaseName, args });
    } else if (phaseName === "LearnMoveBatchPhase") {
      trace.moveBatch.push({ phase: phaseName, args });
    }
    return originalUnshiftNew.apply(this, [phaseName, ...args]);
  };

  return () => {
    battleSceneProto.applyPartyExp = originalApply;
    pokemonProto.addExp = originalAddExp;
    pokemonProto.setMove = originalSetMove;
    phaseManagerProto.pushNew = originalPushNew;
    phaseManagerProto.unshiftNew = originalUnshiftNew;
  };
}

async function launchProgressionScenario(phaserGame: Phaser.Game): Promise<GameManager> {
  const spec: ScenarioSpec = {
    v: 1,
    name: "M4 progression Nacli level 16 to 17",
    run: { wave: 9, level: INITIAL_LEVEL, money: 1000, seed: "m4-progression-nacli-16-17" },
    party: [{ species: SPECIES_ID, moves: [...INITIAL_MOVES] }],
    enemy: { kind: "wild", wild: { species: 52, moves: [33, 39, 45, 77] } },
  };
  const game = new GameManager(phaserGame);
  const { scenario, postLaunch } = buildDevScenario(spec);
  game.override.criticalHits(null);
  vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
  const starters = scenario.setup();
  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const starterPhase = new SelectStarterPhase();
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    const scenarioSeed = spec.run?.seed?.trim();
    if (scenarioSeed) {
      game.scene.setSeed(scenarioSeed);
      game.scene.resetSeed();
    }
    starterPhase.initBattle(starters, true);
    postLaunch();
  });
  await game.phaseInterceptor.to("EncounterPhase");
  await game.phaseInterceptor.to("CommandPhase");
  scenario.onBattleStart?.();
  // The boot-time biome-structure roll runs before the harness pins the run
  // seed, so re-issue the production addressed roll (battle-scene.ts:2497
  // semantics) against the pinned seed before any frontier is captured.
  erRollBiomeLength(game.scene.arena.biomeId, 1, game.scene.seed);
  game.scene.expParty = ExpNotification.SKIP;
  return game;
}

function assertScenarioState(game: GameManager): Pokemon {
  const battle = game.scene.currentBattle as AnyRecord | undefined;
  const pokemon = game.scene.getPlayerParty()[0];
  if (!battle || battle.waveIndex !== 9 || battle.battleType !== 0) {
    gap("LIVE_SOURCE_BATTLE_UNAVAILABLE", "src/app/dev-tools/test-suite/scenario-spec.ts -> src/phases/encounter-phase.ts", "the live setup did not produce a Classic wild wave-9 battle");
  }
  if (!pokemon) {
    gap("LIVE_PLAYER_PARTY_UNAVAILABLE", "src/phases/select-starter-phase.ts:initBattle", "the live player party is empty");
  }
  if (pokemon.species.speciesId !== SPECIES_ID || pokemon.level !== INITIAL_LEVEL) {
    gap("LIVE_PROGRESSION_TARGET_MISMATCH", "src/phases/select-starter-phase.ts:initBattle", `expected Nacli level ${INITIAL_LEVEL}`);
  }
  if (pokemon.species.growthRate !== 3) {
    gap("LIVE_GROWTH_RATE_MISMATCH", "src/data/pokemon-species.ts:Nacli", `expected Medium Slow growth rate 3, got ${pokemon.species.growthRate}`);
  }
  requireExactNumbers(pokemon.getMoveset(true).map(move => move.moveId), INITIAL_MOVES, "initial moves");
  return pokemon;
}

function captureMenuInput(trace: CaptureTrace, game: GameManager, button: Button): void {
  trace.menuInputs.push({
    button,
    phase: game.scene.phaseManager.getCurrentPhase().phaseName,
    mode: game.scene.ui.getMode(),
  });
  (game.scene.ui.getHandler() as AnyRecord).processInput(button);
}

export async function captureProgression(): Promise<Record<string, JsonValue>> {
  let phaserGame: Phaser.Game | undefined;
  let game: GameManager | undefined;
  let restoreTrace: (() => void) | undefined;
  let rngTrace: RngCollector | undefined;
  let priorBattleRng: BattleScene["randBattleSeedInt"] | undefined;
  const trace: CaptureTrace = {
    applyPartyExp: [],
    addExp: [],
    levelUp: [],
    moveBatch: [],
    setMove: [],
    menuInputs: [],
    phaseTransitions: [],
    rngDraws: [],
  };
  const overrides = Overrides as unknown as { LEVEL_CAP_OVERRIDE: number };
  const priorCap = overrides.LEVEL_CAP_OVERRIDE;
  try {
    priorBattleRng = BattleScene.prototype.randBattleSeedInt;
    rngTrace = installRngTrace();
    overrides.LEVEL_CAP_OVERRIDE = LEVEL_CAP_OVERRIDE;
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS, seed: ["m4-oracle-anchor"] });
    const boot = Promise.withResolvers<void>();
    setTimeout(boot.resolve, 0);
    await boot.promise;
    game = await launchProgressionScenario(phaserGame);
    const pokemon = assertScenarioState(game);
    const levelThreshold = getLevelTotalExp(FINAL_LEVEL, GrowthRate.MEDIUM_SLOW);
    if (!Number.isSafeInteger(levelThreshold) || levelThreshold <= 0) {
      gap("LIVE_EXP_THRESHOLD_UNOBSERVABLE", "src/data/exp.ts:getLevelTotalExp", `invalid level-${FINAL_LEVEL} Medium Slow threshold ${levelThreshold}`);
    }
    pokemon.exp = levelThreshold - 1;
    if (pokemon.exp !== levelThreshold - 1) {
      gap("LIVE_INITIAL_EXP_SETUP_FAILED", "src/field/pokemon.ts:exp", "the canonical progression setup could not pin the pre-threshold EXP");
    }
    const seededInitialExp = pokemon.exp;
    const pokemonAfterExpSetup = assertScenarioState(game);
    if (pokemonAfterExpSetup !== pokemon) {
      gap("LIVE_PROGRESSION_TARGET_CHANGED", "src/field/pokemon.ts:PlayerPokemon", "the canonical EXP setup replaced the live progression target");
    }
    // Nacli does not evolve at level 17; preserve the live source value rather than forcing a pause.
    pokemon.pauseEvolutions = false;
    const before = readPartySnapshot(game, pokemon);
    const moneyBefore = finite(game.scene.money, "money.before");
    const battle = game.scene.currentBattle;
    const enemy = battle.enemyParty[0];
    if (!enemy) {
      gap("LIVE_ENEMY_UNAVAILABLE", "src/battle.ts:enemyParty", "wave-9 source battle has no live enemy");
    }
    const participantIds = [...battle.playerParticipantIds];
    if (!participantIds.includes(pokemon.id)) {
      gap("PARTICIPATION_TARGET_MISSING", "src/battle.ts:playerParticipantIds", "the live target was not admitted as a battle participant");
    }
    const enemyExpValue = finite(enemy.getExpValue(), "enemy.getExpValue");
    // launchProgressionScenario leaves the production command surface open. Re-observe that exact live
    // CommandPhase before starting the transaction, then install source observation hooks.
    await game.phaseInterceptor.to("CommandPhase", false);
    restoreTrace = installTrace(game, trace);
    const battleHash = process.env.M4_ORACLE_BATTLE_CONTENT_HASH ?? "";
    const runHash = process.env.M4_ORACLE_RUN_CONTENT_HASH ?? "";
    const initialFrontier = captureOracleFrontier(game, battleHash, runHash, gap);
    const rngStart = rngTrace?.draws.length ?? 0;
    const initialMode = String(game.scene.ui.getMode());
    // Match the proven M3 exporter: select the move for the live PLAYER battler through MoveHelper, and
    // suppress its optional target callback because this single-target source battle has no target phase.
    game.move.select(MoveId.POUND, BattlerIndex.PLAYER, null);
    await game.phaseInterceptor.to("TurnStartPhase", false);
    // Queue the progression prompt only after the command callbacks have been admitted and the turn-start
    // boundary is live. This preserves production phase ordering and avoids a parked CommandPhase.
    game.onNextPrompt("LearnMoveBatchPhase", UiMode.LEARN_MOVE_BATCH, () => {
      captureMenuInput(trace, game!, Button.ACTION);
      captureMenuInput(trace, game!, Button.ACTION);
      captureMenuInput(trace, game!, Button.CANCEL);
    });
    await game.killPokemon(enemy);
    game.doSelectModifier();
    await game.phaseInterceptor.to("BattleEndPhase");
    const finalFrontier = captureOracleFrontier(game, battleHash, runHash, gap);
    const nextControl = captureOracleNextControl(game, gap);
    const transactionRngDraws = rngTrace?.draws.slice(rngStart) ?? [];
    trace.rngDraws.push(...transactionRngDraws);
    const after = readPartySnapshot(game, pokemon);
    const battleAfter = game.scene.currentBattle;
    const moneyAfter = finite(game.scene.money, "money.after");
    const candidateArgs = trace.moveBatch[0]?.args;
    const candidateIds = candidateArgs?.[1];
    requireExactNumbers(candidateIds, RAW_CANDIDATES, "LearnMoveBatchPhase.candidateMoveIds");
    if (trace.levelUp.length !== 1) {
      gap("LEVEL_UP_PHASE_UNOBSERVED", "src/phases/level-up-phase.ts:LevelUpPhase.end", `expected one LevelUpPhase, observed ${trace.levelUp.length}`);
    }
    if (trace.applyPartyExp.length !== 1) {
      gap("EXP_SETTLEMENT_UNOBSERVED", "src/battle-scene.ts:applyPartyExp", `expected one source-battle award, observed ${trace.applyPartyExp.length}`);
    }
    const addExp = trace.addExp.filter(entry => entry.pokemon_id === pokemon.id);
    if (addExp.length !== 1) {
      gap("EXP_PHASE_UNOBSERVED", "src/phases/exp-phase.ts:Pokemon.addExp", `expected one target addExp, observed ${addExp.length}`);
    }
    if (trace.setMove.length !== 1 || trace.setMove[0]?.move_index !== LEARNED_SLOT || trace.setMove[0]?.move_id !== LEARNED_MOVE) {
      gap("MOVE_REPLACEMENT_UNOBSERVED", "src/field/pokemon.ts:setMove", "the live batch panel did not replace Body Slam into slot 0");
    }
    const afterMoves = after.moves;
    if (!Array.isArray(afterMoves)) {
      gap("LIVE_VALUE_MISSING", "src/field/pokemon.ts:Pokemon.moveset", "final move snapshot is not an array");
    }
    requireExactNumbers(afterMoves.map(entry => (entry as AnyRecord).move_id), [LEARNED_MOVE, 52, 77, 78], "after moves");
    if (before.level !== INITIAL_LEVEL || after.level !== FINAL_LEVEL) {
      gap("LEVEL_TRANSITION_MISMATCH", "src/field/pokemon.ts:addExp -> src/phases/level-up-phase.ts", `expected ${INITIAL_LEVEL}->${FINAL_LEVEL}, observed ${before.level}->${after.level}`);
    }
    return jsonSafe({
      artifact_id: "progression/nacli-medium-slow-level-17-v1",
      oracle_input: {
        mode: "CLASSIC",
        battle_kind: "WILD",
        species_id: SPECIES_ID,
        wave: finite(battle.waveIndex, "battle.waveIndex"),
        level_cap_override: LEVEL_CAP_OVERRIDE,
        cap_source: "Overrides.LEVEL_CAP_OVERRIDE",
        growth_rate: 3,
        growth_rate_name: "MEDIUM_SLOW",
        level_threshold: levelThreshold,
        seeded_initial_experience: seededInitialExp,
        threshold_formula: "getLevelTotalExp(17, GrowthRate.MEDIUM_SLOW)",
        initial_moves_source: "explicit composed fixture state, not natural learnset",
        pause_evolutions: false,
      },
      initial: initialFrontier,
      initial_observation: {
        canonical: before,
        money: moneyBefore,
        participant_ids: participantIds.map((entry, index) => finite(entry, `participant_ids[${index}]`)),
        threshold_before_level: levelThreshold,
        seeded_experience: seededInitialExp,
      },
      decisions: [
        { kind: "SELECT_MOVE", source: "MoveHelper.select", move_id: MoveId.POUND, battler: BattlerIndex.PLAYER },
        {
          kind: "DEFEAT_ENEMY",
          source: "GameManager.killPokemon",
          enemy_id: finite(enemy.id, "enemy.id"),
          enemy_species_id: finite(enemy.species.speciesId, "enemy.species.speciesId"),
        },
        { kind: "SELECT_MODIFIER", source: "GameManager.doSelectModifier" },
        {
          kind: "LEARN_MOVE",
          source: "LearnMoveBatchPhase",
          candidate_move_ids: candidateIds,
          move_id: LEARNED_MOVE,
          slot: LEARNED_SLOT,
        },
        ...trace.menuInputs.map(input => ({
          kind: "LOGICAL_BUTTON",
          button: input.button,
          phase: input.phase,
          mode: input.mode,
        })),
      ],
      rng_draws: trace.rngDraws,
      ordered_transitions: [
        {
          kind: "CONTROL_TRANSITION",
          control: "MOVE_LEARN",
          phase: "CommandPhase",
          mode: initialMode,
        },
        ...trace.phaseTransitions,
      ],
      mutations: [
        {
          kind: "STATE_FRONTIER",
          before: initialFrontier.canonical,
          after: finalFrontier.canonical,
        },
        { kind: "EXP_SETTLEMENT", observation: trace.applyPartyExp[0] },
        { kind: "EXP_GAIN", observation: addExp[0] },
        { kind: "MOVE_REPLACEMENT", observation: trace.setMove[0] },
      ],
      presentation: [
        { kind: "LEVEL_UP", observations: trace.levelUp },
        { kind: "LEARN_MOVE_BATCH", observations: trace.moveBatch },
        { kind: "LOGICAL_MENU", inputs: trace.menuInputs },
        {
          kind: "FINAL_CONTROL",
          phase: nextControl.phase,
          queued_phases: nextControl.queued_phases,
        },
      ],
      final: finalFrontier,
      next_control: nextControl,
      final_observation: {
        canonical: after,
        money: moneyAfter,
      },
      settlement: {
        source_enemy: {
          id: finite(enemy.id, "enemy.id"),
          species_id: finite(enemy.species.speciesId, "enemy.species.speciesId"),
          level: finite(enemy.level, "enemy.level"),
          exp_value: enemyExpValue,
          fainted: enemy.isFainted(),
        },
        apply_party_exp: trace.applyPartyExp[0],
        exp_phase: addExp[0],
        defeated_enemy_count: finite(battleAfter.enemyFaints, "battle.enemyFaints"),
        money: { before: moneyBefore, after: moneyAfter, delta: moneyAfter - moneyBefore },
      },
      progression: {
        last_level: INITIAL_LEVEL,
        level: FINAL_LEVEL,
        raw_candidates: candidateIds,
        learnable_candidates: candidateIds,
        menu_inputs: trace.menuInputs,
        assignments: [{ move_id: LEARNED_MOVE, slot: LEARNED_SLOT }],
        replacement_slot: LEARNED_SLOT,
      },
      observations: {
        level_up: trace.levelUp,
        move_batch: trace.moveBatch,
        set_move: trace.setMove,
        add_exp: trace.addExp,
        phase_transitions: trace.phaseTransitions,
        rng_instrumented_methods: [
          "integerInRange",
          "integer",
          "frac",
          "realInRange",
          "pick",
          "shuffle",
          "angle",
          "between",
          "normal",
          "weightedPick",
          "sign",
        ],
        rng_transaction_draw_count: trace.rngDraws.length,
      },
    }) as Record<string, JsonValue>;
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new M4CaptureGap(
      "LIVE_PROGRESSION_SETUP_FAILED",
      "test/kernel-fixtures/m4/export/progression-capture.ts:captureProgression",
      detail,
    );
  } finally {
    rngTrace?.restore();
    restoreTrace?.();
    if (priorBattleRng != null) {
      BattleScene.prototype.randBattleSeedInt = priorBattleRng;
    }
    overrides.LEVEL_CAP_OVERRIDE = priorCap;
    if (game) {
      game.promptHandler.clearPrompts();
    }
    if (PromptHandler.runInterval != null) {
      clearInterval(PromptHandler.runInterval);
      PromptHandler.runInterval = undefined;
    }
    phaserGame?.destroy(true);
  }
}
