/*
 * M4A test-only biome and encounter capture.
 *
 * This helper deliberately keeps the exporter ABI small.  It does not publish an
 * envelope, copy an M3 fixture, or implement encounter mechanics; every value in
 * the returned object is observed from the pinned TypeScript source (the one
 * exception is the explicit, test-owned seed and command script, both of which
 * are passed through the real source before they are recorded).
 */

import { globalScene } from "#app/global-scene";
import { getGameMode } from "#app/game-mode";
import { allBiomes } from "#data/data-lists";
import {
  erBiomeOverstayAnchor,
  erIsBiomeEnd,
  erMarkBiomeStay,
  erShouldRaiseCrossroads,
  getErBiomeLength,
  getErBiomeStartWave,
  getErLeaveBiomeNow,
  planErBiomeStructure,
  resetErBiomeStructure,
  restoreErBiomeStructure,
  setErLeaveBiomeNow,
} from "#data/elite-redux/er-biome-structure";
import {
  getErPrevBiome,
  resetErRouting,
  rollErNextBiomeNodes,
} from "#data/elite-redux/er-biome-routing";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { buildDevScenario } from "#app/dev-tools/test-suite/scenario-spec";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";

export class M4CaptureGap extends Error {
  readonly code: string;
  readonly sourceSeam: string;

  constructor(code: string, sourceSeam: string, detail: string) {
    super(`M4_CAPTURE_GAP:${code}:${sourceSeam}: ${detail}`);
    this.name = "M4CaptureGap";
    this.code = code;
    this.sourceSeam = sourceSeam;
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type AnyRecord = Record<string, any>;
type RngState = {
  state_string: string;
  s0_bits: string;
  s1_bits: string;
  s2_bits: string;
  carry: number;
};
type RngDraw = {
  sequence: number;
  public_api: string;
  arguments: JsonValue[];
  result: JsonValue;
  consumed: boolean;
  before_state: RngState;
  after_state: RngState;
};
type RngStateChange = {
  kind: "SEED_RESET" | "STATE_SET";
  sequence: number;
  before: RngState;
  after: RngState;
};

type RngCapture = {
  readonly draws: RngDraw[];
  readonly stateChanges: RngStateChange[];
  readonly before: RngState;
  after: RngState;
};

const RUN_SEED = "m4a-town-15";
const STRUCTURE_SOURCE = "src/data/elite-redux/er-biome-structure.ts:planErBiomeStructure";
const ROUTE_SOURCE = "src/data/elite-redux/er-biome-routing.ts:rollErNextBiomeNodes";
const ENCOUNTER_SOURCE = "src/phases/encounter-phase.ts:runEncounter";
const SAFE_U53_MAX = 9_007_199_254_740_991;

let activeRngCapture: {
  capture: RngCapture;
  generator: AnyRecord | null;
  stream: "structure" | "route" | "encounter";
  depth: number;
  nextSequence: number;
} | null = null;

function gap(code: string, sourceSeam: string, detail: string): never {
  throw new M4CaptureGap(code, sourceSeam, detail);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > SAFE_U53_MAX) {
    throw new Error(`NONFINITE_CAPTURE_VALUE:${path}`);
  }
  return value;
}

function json(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return finite(value, path);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => json(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as AnyRecord).sort()) {
      const entry = (value as AnyRecord)[key];
      if (entry === undefined || typeof entry === "function") {
        continue;
      }
      result[key] = json(entry, `${path}.${key}`);
    }
    return result;
  }
  throw new Error(`UNSERIALIZABLE_CAPTURE_VALUE:${path}`);
}

function f64Bits(value: number): string {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, false);
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseRngState(state: string): RngState {
  const parts = state.split(",");
  if (parts.length !== 5 || parts[0] !== "!rnd") {
    throw new Error(`RNG_STATE_UNOBSERVABLE:${state}`);
  }
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (
    !Number.isSafeInteger(carry)
    || carry < 0
    || carry > 0xffffffff
    || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)
  ) {
    throw new Error(`RNG_STATE_UNOBSERVABLE:${state}`);
  }
  return {
    state_string: state,
    s0_bits: f64Bits(values[0]),
    s1_bits: f64Bits(values[1]),
    s2_bits: f64Bits(values[2]),
    carry,
  };
}

function rngState(rng: AnyRecord): RngState {
  const state = rng.state as (() => string) | undefined;
  if (typeof state !== "function") {
    throw new Error("RNG_STATE_UNOBSERVABLE:state is not callable");
  }
  return parseRngState(state.call(rng));
}

function rngValue(value: unknown, path: string): JsonValue {
  if (value === undefined) {
    return null;
  }
  return json(value, path);
}

function installRngCapture(stream: "structure" | "route" | "encounter"): RngCapture {
  if (activeRngCapture != null) {
    throw new Error("RNG_CAPTURE_NESTED");
  }
  const randomClass = Phaser.Math.RandomDataGenerator as unknown as { prototype?: AnyRecord };
  const prototype = randomClass.prototype;
  if (prototype == null) {
    gap("OBSERVATION_SEAM_MISSING", "Phaser.Math.RandomDataGenerator.prototype", "constructor prototype is unavailable");
  }
  const methodNames = ["integerInRange", "integer", "frac", "realInRange", "pick", "shuffle", "weightedPick", "sign"];
  const restore: (() => void)[] = [];
  const capture: RngCapture = {
    draws: [],
    stateChanges: [],
    before: rngState(Phaser.Math.RND as unknown as AnyRecord),
    after: rngState(Phaser.Math.RND as unknown as AnyRecord),
  };
  const context = { capture, generator: null, stream, depth: 0, nextSequence: 0 };
  activeRngCapture = context;
  for (const methodName of methodNames) {
    const original = prototype[methodName] as ((...args: any[]) => any) | undefined;
    if (typeof original !== "function") {
      continue;
    }
    prototype[methodName] = function (this: AnyRecord, ...args: any[]): any {
      if (activeRngCapture !== context) {
        return original.apply(this, args);
      }
      if (stream !== "encounter" && context.generator != null && context.generator !== this) {
        return original.apply(this, args);
      }
      if (context.generator == null && stream !== "encounter") {
        context.generator = this;
      }
      const outer = context.depth === 0;
      const before = outer ? rngState(this) : null;
      context.depth++;
      let result: any;
      try {
        result = original.apply(this, args);
      } finally {
        context.depth--;
      }
      if (outer && before != null) {
        const after = rngState(this);
        capture.draws.push({
          sequence: context.nextSequence++,
          public_api: methodName.toUpperCase(),
          arguments: args.map((arg, index) => json(arg, `${stream}/${methodName}/${index}`)) as JsonValue[],
          result: rngValue(result, `${stream}/${methodName}/result`),
          consumed: before.state_string !== after.state_string,
          before_state: before,
          after_state: after,
        });
      }
      return result;
    };
    restore.push(() => {
      prototype[methodName] = original;
    });
  }
  (context as AnyRecord).restore = () => {
    activeRngCapture = null;
    for (const restoreMethod of restore.reverse()) {
      restoreMethod();
    }
  };
  return capture;
}

function finishRngCapture(capture: RngCapture): RngCapture {
  const context = activeRngCapture as (typeof activeRngCapture) & { restore?: () => void };
  if (context == null || context.capture !== capture) {
    throw new Error("RNG_CAPTURE_FRONTIER_MISMATCH");
  }
  capture.after = rngState(Phaser.Math.RND as unknown as AnyRecord);
  context.restore?.();
  return capture;
}

function withRngCapture<T>(stream: "structure" | "route" | "encounter", run: () => T): { value: T; rng: RngCapture } {
  const capture = installRngCapture(stream);
  try {
    const value = run();
    return { value, rng: finishRngCapture(capture) };
  } catch (error) {
    try {
      finishRngCapture(capture);
    } catch {
      activeRngCapture = null;
    }
    throw error;
  }
}

async function withAsyncRngCapture<T>(
  stream: "encounter",
  run: () => Promise<T>,
): Promise<{ value: T; rng: RngCapture }> {
  const capture = installRngCapture(stream);
  try {
    const value = await run();
    return { value, rng: finishRngCapture(capture) };
  } catch (error) {
    try {
      finishRngCapture(capture);
    } catch {
      activeRngCapture = null;
    }
    throw error;
  }
}

function stateView(): AnyRecord {
  return {
    current_start_wave: finite(getErBiomeStartWave(), "biome/start_wave"),
    current_length: getErBiomeLength() == null ? null : finite(getErBiomeLength(), "biome/length"),
    leave_biome_now: getErLeaveBiomeNow(),
    overstay_anchor_wave:
      erBiomeOverstayAnchor() == null ? null : finite(erBiomeOverstayAnchor() as number, "biome/overstay_anchor"),
  };
}

function rngView(rng: RngCapture): AnyRecord {
  return {
    before: rng.before,
    draws: rng.draws,
    state_changes: rng.stateChanges,
    after: rng.after,
    next_sequence: rng.draws.length,
  };
}

function requireGlobalRoutingSeams(): void {
  const scene = globalScene as AnyRecord | undefined;
  if (scene == null || typeof scene.findModifiers !== "function") {
    gap(
      "ROUTE_SOURCE_UNOBSERVABLE",
      ROUTE_SOURCE,
      "the live global scene does not expose the modifier-owned visibility seam",
    );
  }
  if (!allBiomes.has(BiomeId.TOWN) || !allBiomes.has(BiomeId.PLAINS)) {
    gap("CONTENT_REGISTRY_UNINITIALIZED", "src/init/init.ts:initializeGame", "Town and Plains biome records are absent");
  }
}

function captureStructureAndRoute(): AnyRecord {
  resetErBiomeStructure();
  resetErRouting();
  const before = stateView();
  const structureCapture = withRngCapture("structure", () => planErBiomeStructure(1, RUN_SEED));
  const plan = structureCapture.value;
  if (plan.length !== 25 || plan.startWave !== 1) {
    gap(
      "STRUCTURE_VECTOR_MISMATCH",
      STRUCTURE_SOURCE,
      `explicit seed ${RUN_SEED} did not produce the required Town startWave=1 length=25 vector`,
    );
  }
  restoreErBiomeStructure(plan.length, plan.startWave, null);
  const structureAfter = stateView();

  const sourceWave = 10;
  const crossroadsOptions = [
    { index: 0, id: "stay", label: "Stay" },
    { index: 1, id: "leave", label: "Leave" },
  ];
  restoreErBiomeStructure(25, 1, null);
  if (!erShouldRaiseCrossroads(sourceWave)) {
    gap("CROSSROADS_VECTOR_MISMATCH", "src/data/elite-redux/er-biome-structure.ts:erShouldRaiseCrossroads", "wave 10 is not offered");
  }
  erMarkBiomeStay(sourceWave);
  const stayAfter = stateView();
  if (stayAfter.overstay_anchor_wave !== sourceWave || stayAfter.leave_biome_now !== false) {
    gap("CROSSROADS_STAY_UNOBSERVABLE", "src/data/elite-redux/er-biome-structure.ts:erMarkBiomeStay", "Stay did not arm the first overstay anchor");
  }
  restoreErBiomeStructure(25, 1, null);
  setErLeaveBiomeNow();
  const leaveAfter = stateView();
  if (leaveAfter.leave_biome_now !== true || erIsBiomeEnd(sourceWave) !== true) {
    gap("CROSSROADS_LEAVE_UNOBSERVABLE", "src/data/elite-redux/er-biome-structure.ts:setErLeaveBiomeNow", "Leave did not force the next boundary");
  }

  requireGlobalRoutingSeams();
  const routeCapture = withRngCapture("route", () => rollErNextBiomeNodes(BiomeId.TOWN, null, RUN_SEED, 11));
  const nodes = routeCapture.value;
  const selectedIndex = nodes.findIndex(node => node.biome === BiomeId.PLAINS);
  if (selectedIndex < 0) {
    gap("ROUTE_VECTOR_MISMATCH", ROUTE_SOURCE, "authority-addressed Town options did not contain Plains(1)");
  }
  const orderedNodes = nodes.map((node, index) => ({
    node_index: index,
    route_node_id: index,
    biome_id: finite(node.biome, `route/nodes/${index}/biome`),
    revealed: node.revealed,
    source: node.source ?? "base",
  }));
  const routeAfter = {
    selected_biome_id: 1,
    selected_node_index: selectedIndex,
    pending_route_nodes: orderedNodes,
  };
  return {
    fixture_id: "biomes/town-crossroads-route-v1",
    run_seed: RUN_SEED,
    structure_before: before,
    structure_draws: structureCapture.rng.draws,
    structure_after: structureAfter,
    crossroads: {
      source_wave: sourceWave,
      options: crossroadsOptions,
      stay_after: stayAfter,
      leave_after: leaveAfter,
    },
    route: {
      entry_wave: 11,
      rng_before:
        routeCapture.rng.draws.length === 0
          ? routeCapture.rng.before
          : routeCapture.rng.draws[0].before_state,
      rng_draws: routeCapture.rng.draws,
      rng_after:
        routeCapture.rng.draws.length === 0
          ? routeCapture.rng.after
          : routeCapture.rng.draws[routeCapture.rng.draws.length - 1].after_state,
      ordered_nodes: orderedNodes,
      selected: {
        node_index: selectedIndex,
        route_node_id: selectedIndex,
        biome_id: 1,
      },
      after: routeAfter,
    },
  };
}

function statusView(mon: Pokemon): AnyRecord {
  const status = mon.status;
  return {
    effect: status?.effect ?? 0,
    toxic_turn_count: status?.toxicTurnCount ?? 0,
    sleep_turns_remaining: status?.sleepTurnsRemaining ?? null,
  };
}

function abilityView(mon: Pokemon): AnyRecord[] {
  const passives = [...mon.getPassiveAbilities().slice(0, 3)];
  while (passives.length < 3) {
    passives.push(null);
  }
  const abilities = [mon.getAbility(), ...passives];
  return abilities.map((ability, slot) => ({
    slot,
    id: ability?.id ?? null,
    name: ability?.name ?? null,
    passive: slot > 0,
    present: ability != null,
    suppressed: ability == null ? false : !mon.canApplyAbility(slot > 0, Math.max(0, slot - 1), true),
    source_identity: slot === 0 ? "active" : `passive-${slot - 1}`,
  }));
}

function pokemonView(mon: Pokemon, owner: "player" | "enemy", fieldIndex: number): AnyRecord {
  const form = mon.getSpeciesForm();
  const moves = mon.getMoveset().map((move, slot) => ({
    slot,
    id: finite(move.moveId, `pokemon/${owner}/${fieldIndex}/moves/${slot}/id`),
    pp_used: finite(move.ppUsed, `pokemon/${owner}/${fieldIndex}/moves/${slot}/pp_used`),
    pp_max: finite(move.getMovePp(), `pokemon/${owner}/${fieldIndex}/moves/${slot}/pp_max`),
  }));
  const types = mon.getTypes(false, false, true).map((type, index) => finite(type, `pokemon/${owner}/${fieldIndex}/types/${index}`));
  const effectiveTypes = mon.getTypes(false, false, false).map((type, index) =>
    finite(type, `pokemon/${owner}/${fieldIndex}/effective_types/${index}`),
  );
  return {
    species_id: finite(mon.species.speciesId, `pokemon/${owner}/${fieldIndex}/species`),
    species_key: mon.species.name,
    form_index: finite(mon.formIndex, `pokemon/${owner}/${fieldIndex}/form`),
    form_key: form.formKey,
    level: finite(mon.level, `pokemon/${owner}/${fieldIndex}/level`),
    types,
    effective_types: effectiveTypes,
    stats: mon.stats.map((stat, index) => finite(stat, `pokemon/${owner}/${fieldIndex}/stats/${index}`)),
    hp: finite(mon.hp, `pokemon/${owner}/${fieldIndex}/hp`),
    max_hp: finite(mon.getMaxHp(), `pokemon/${owner}/${fieldIndex}/max_hp`),
    status: statusView(mon),
    stages: mon.getStatStages().map((stage, index) => finite(stage, `pokemon/${owner}/${fieldIndex}/stages/${index}`)),
    moves,
    ability_slots: abilityView(mon),
    ability_suppressions: abilityView(mon).map(slot => ({ slot: slot.slot, suppressed: slot.suppressed })),
    ivs: mon.ivs.map((iv, index) => finite(iv, `pokemon/${owner}/${fieldIndex}/ivs/${index}`)),
    nature: finite(mon.nature, `pokemon/${owner}/${fieldIndex}/nature`),
    effective_nature: finite(mon.getNature(), `pokemon/${owner}/${fieldIndex}/effective_nature`),
    owner: {
      side: owner,
      field_index: fieldIndex,
      battler_index: finite(mon.getBattlerIndex(), `pokemon/${owner}/${fieldIndex}/battler_index`),
      coop_owner: (mon as AnyRecord).coopOwner ?? null,
      trainer_slot: owner === "enemy" ? finite((mon as AnyRecord).trainerSlot ?? 0, `pokemon/${owner}/${fieldIndex}/trainer_slot`) : null,
    },
    fainted: mon.isFainted(),
  };
}

function fieldView(game: GameManager, battle: AnyRecord): AnyRecord {
  const arrangement = battle.arrangement as AnyRecord;
  const playerField = game.scene.getPlayerField(false) as Pokemon[];
  const enemyField = game.scene.getEnemyField(false) as Pokemon[];
  const indices = arrangement.activeIndices() as number[];
  const adjacency: AnyRecord[] = [];
  for (const from of indices) {
    const fromId = arrangement.locate(from);
    for (const to of indices) {
      const toId = arrangement.locate(to);
      adjacency.push({ from, to, adjacent: arrangement.isAdjacent(fromId, toId) });
    }
  }
  return {
    biome_id: finite(game.scene.arena.biomeId, "field/biome"),
    weather: game.scene.arena.weather == null ? null : {
      type: finite(game.scene.arena.weather.weatherType, "field/weather/type"),
      turns_left: finite(game.scene.arena.weather.turnsLeft, "field/weather/turns_left"),
    },
    terrain: game.scene.arena.terrain == null ? null : {
      type: finite(game.scene.arena.terrain.terrainType, "field/terrain/type"),
      turns_left: finite(game.scene.arena.terrain.turnsLeft, "field/terrain/turns_left"),
    },
    format_id: battle.format.id,
    sides: battle.format.sides.map((side: AnyRecord) => ({
      kind: finite(side.kind, "field/sides/kind"),
      capacity: finite(side.capacity, "field/sides/capacity"),
      base_index: finite(side.baseIndex, "field/sides/base_index"),
      mirrored: !!side.mirrored,
      team: side.team ?? null,
    })),
    player_capacity: finite(arrangement.playerCapacity, "field/player_capacity"),
    enemy_capacity: finite(arrangement.enemyCapacity, "field/enemy_capacity"),
    enemy_offset: finite(arrangement.enemyOffset, "field/enemy_offset"),
    active_indices: indices,
    player_indices: playerField.map(mon => finite(mon.getBattlerIndex(), "field/player_index")),
    enemy_indices: enemyField.map(mon => finite(mon.getBattlerIndex(), "field/enemy_index")),
    adjacency,
  };
}

function battleRngView(battle: AnyRecord): AnyRecord {
  const saved = battle.battleSeedState as string | null | undefined;
  return {
    battle_seed: battle.battleSeed,
    turn: finite(battle.turn, "encounter/battle_rng/turn"),
    saved_substream: saved == null ? null : parseRngState(saved),
    run_state: rngState(Phaser.Math.RND as unknown as AnyRecord),
  };
}

async function captureLiveEncounter(): Promise<AnyRecord> {
  const PhaserGame = Phaser.Game;
  if (typeof PhaserGame !== "function") {
    gap("OBSERVATION_SEAM_MISSING", "Phaser.Game", "headless game constructor is unavailable");
  }
  resetErBiomeStructure();
  resetErRouting();
  const phaserGame = new PhaserGame({ type: Phaser.HEADLESS });
  const originalBattleSeed = (Object.getPrototypeOf(globalScene) as AnyRecord).randBattleSeedInt;
  let game: GameManager | null = null;
  try {
    const scenarioSpec = {
      name: "M4A captured Plains wave 11",
      notes: "Explicit test vector; not a natural single-seed segment.",
      party: [{ species: 7, moves: [33, 39, 55, 110], abilitySlot: 0, nature: 0 }],
      run: { seed: RUN_SEED, wave: 11, biome: BiomeId.PLAINS, level: 10, difficulty: "ace" },
    } as any;
    const built = buildDevScenario(scenarioSpec);
    game = new GameManager(phaserGame);
    const ui = game.scene.ui as AnyRecord;
    ui.shouldSkipDialogue = () => true;
    await game.runToTitle();
    const starters = built.scenario.setup();
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.phaseManager.pushNew("EncounterPhase", false);
    game.scene.setSeed(RUN_SEED);
    game.scene.resetSeed();
    new SelectStarterPhase().initBattle(starters, true);
    built.postLaunch();

    const captured = await withAsyncRngCapture("encounter", async () => {
      await game!.phaseInterceptor.to("CommandPhase", false);
      const battle = game!.scene.currentBattle as AnyRecord | undefined;
      if (battle == null) {
        gap("ENCOUNTER_SOURCE_UNOBSERVABLE", ENCOUNTER_SOURCE, "EncounterPhase completed without a live Battle");
      }
      if (battle.waveIndex !== 11 || game!.scene.arena.biomeId !== BiomeId.PLAINS) {
        gap("ENCOUNTER_VECTOR_MISMATCH", ENCOUNTER_SOURCE, "live EncounterPhase did not materialize wave 11 in Plains");
      }
      const players = game!.scene.getPlayerParty() as Pokemon[];
      const enemies = game!.scene.getEnemyParty() as Pokemon[];
      const playerField = game!.scene.getPlayerField(false) as Pokemon[];
      const enemyField = game!.scene.getEnemyField(false) as Pokemon[];
      if (players.length === 0 || enemies.length === 0 || playerField.length === 0 || enemyField.length === 0) {
        gap("ENCOUNTER_SOURCE_UNOBSERVABLE", ENCOUNTER_SOURCE, "post-initialization field did not expose both sides");
      }
      const scriptedMove = playerField[0].getMoveset()[0];
      if (scriptedMove == null) {
        gap("SCRIPTED_COMMAND_UNOBSERVABLE", "src/phases/command-phase.ts:handleCommand", "player lead has no executable move");
      }
      return {
        fixture_id: "encounters/plains-wave-11-captured-v1",
        wave: finite(battle.waveIndex, "encounter/wave"),
        biome_id: finite(game!.scene.arena.biomeId, "encounter/biome"),
        battle_seed: battle.battleSeed,
        battle_rng: battleRngView(battle),
        format: {
          id: battle.format.id,
          sides: battle.format.sides.map((side: AnyRecord) => ({
            kind: finite(side.kind, "encounter/format/kind"),
            capacity: finite(side.capacity, "encounter/format/capacity"),
            base_index: finite(side.baseIndex, "encounter/format/base_index"),
            mirrored: !!side.mirrored,
            team: side.team ?? null,
          })),
        },
        enemy_party: enemies.map((mon, index) => pokemonView(mon, "enemy", index)),
        enemy_leads: enemyField.map((mon, index) => ({ stable_index: index, battler_index: mon.getBattlerIndex(), pokemon: pokemonView(mon, "enemy", index) })),
        player_leads: playerField.map((mon, index) => ({ stable_index: index, battler_index: mon.getBattlerIndex(), pokemon: pokemonView(mon, "player", index) })),
        field: fieldView(game!, battle),
        scripted_policy: {
          kind: "SCRIPTED_ONLY",
          source: "test/kernel-fixtures/m4/export/biome-encounter-capture.ts:explicit-command-input",
          commands: [{
            side: "player",
            field_index: 0,
            battler_index: finite(playerField[0].getBattlerIndex(), "encounter/scripted/battler_index"),
            command: "FIGHT",
            move_slot: 0,
            move_id: finite(scriptedMove.moveId, "encounter/scripted/move_id"),
            target: finite(enemyField[0].getBattlerIndex(), "encounter/scripted/target"),
          }],
        },
      };
    });
    return { ...captured.value, rng_before: captured.rng.before, rng_draws: captured.rng.draws, rng_after: captured.rng.after };
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap(
      "ENCOUNTER_CALLBACK_UNOBSERVABLE",
      ENCOUNTER_SOURCE,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (game != null) {
      const proto = Object.getPrototypeOf(globalScene) as AnyRecord;
      if (originalBattleSeed !== undefined) {
        proto.randBattleSeedInt = originalBattleSeed;
      }
    }
    try {
      phaserGame.destroy(true);
    } catch {
      // The browser harness may already own and dispose its Phaser instance.
    }
  }
}

export async function captureBiomeEncounter(): Promise<Record<string, JsonValue>> {
  const biome = captureStructureAndRoute();
  const encounter = await captureLiveEncounter();
  return { biome: json(biome, "biome") as JsonValue, encounter: json(encounter, "encounter") as JsonValue };
}
