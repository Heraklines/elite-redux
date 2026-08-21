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
  erPendingNodesReady,
  getErPendingNodes,
  getErPrevBiome,
  getErRoutingState,
  resetErRouting,
  rollErNextBiomeNodes,
} from "#data/elite-redux/er-biome-routing";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { captureOracleFrontier, captureOracleNextControl } from "./oracle-frontier";
import { buildDevScenario, type ScenarioSpec } from "#app/dev-tools/test-suite/scenario-spec";
import { BattleScene } from "#app/battle-scene";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
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
const BATTLE_CONTENT_HASH = process.env.M4_ORACLE_BATTLE_CONTENT_HASH ?? "";
const RUN_CONTENT_HASH = process.env.M4_ORACLE_RUN_CONTENT_HASH ?? "";

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

function observeSource<T>(code: string, sourceSeam: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap(code, sourceSeam, error instanceof Error ? error.message : String(error));
  }
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
  const target = stream === "encounter" ? (Phaser.Math.RND as unknown as AnyRecord) : prototype;
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
    const original = target[methodName] as ((...args: any[]) => any) | undefined;
    if (typeof original !== "function") {
      continue;
    }
    target[methodName] = function (this: AnyRecord, ...args: any[]): any {
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
      target[methodName] = original;
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
function sharedRngDraws(stream: string, capture: RngCapture, sequenceOffset: number): AnyRecord[] {
  return capture.draws.map(draw => ({
    ...draw,
    sequence: draw.sequence + sequenceOffset,
    stream,
  }));
}

function frontier(game: GameManager): AnyRecord {
  return captureOracleFrontier(game, BATTLE_CONTENT_HASH, RUN_CONTENT_HASH, gap);
}

function nextControl(game: GameManager): AnyRecord {
  return captureOracleNextControl(game, gap);
}

function requireGlobalRoutingSeams(game: GameManager): void {
  const scene = globalScene as AnyRecord | undefined;
  if (scene == null || game.scene !== scene) {
    gap(
      "ROUTE_SOURCE_UNOBSERVABLE",
      ROUTE_SOURCE,
      "the route helper did not receive the live GameManager scene used by global routing",
    );
  }
  if (typeof scene.findModifiers !== "function" || !Array.isArray(scene.modifiers)) {
    gap(
      "ROUTE_SOURCE_UNOBSERVABLE",
      ROUTE_SOURCE,
      "the live global scene does not expose initialized player modifiers for route visibility",
    );
  }
  if (typeof scene.getPlayerParty !== "function" || !Array.isArray(scene.getPlayerParty())) {
    gap(
      "ROUTE_SOURCE_UNOBSERVABLE",
      ROUTE_SOURCE,
      "the live global scene does not expose an initialized player party for route visibility",
    );
  }
  if (!allBiomes.has(BiomeId.TOWN) || !allBiomes.has(BiomeId.PLAINS)) {
    gap("CONTENT_REGISTRY_UNINITIALIZED", "src/init/init.ts:initializeGame", "Town and Plains biome records are absent");
  }
}

function captureStructureAndRoute(game: GameManager): AnyRecord {
  resetErBiomeStructure();
  resetErRouting();
  const initial = frontier(game);
  const structureBefore = stateView();
  const structureCapture = observeSource("STRUCTURE_CALLBACK_UNOBSERVABLE", STRUCTURE_SOURCE, () =>
    withRngCapture("structure", () => planErBiomeStructure(1, RUN_SEED)),
  );
  const plan = structureCapture.value;
  const routeBefore = {
    previous_biome_id: getErPrevBiome(),
    routing_state: getErRoutingState() ?? null,
    pending_nodes: getErPendingNodes(),
    pending_nodes_ready: erPendingNodesReady(),
  };
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
  const crossroadsBefore = stateView();
  if (!erShouldRaiseCrossroads(sourceWave)) {
    gap("CROSSROADS_VECTOR_MISMATCH", "src/data/elite-redux/er-biome-structure.ts:erShouldRaiseCrossroads", "wave 10 is not offered");
  }
  erMarkBiomeStay(sourceWave);
  const stayAfter = stateView();
  if (stayAfter.overstay_anchor_wave !== sourceWave || stayAfter.leave_biome_now !== false) {
    gap("CROSSROADS_STAY_UNOBSERVABLE", "src/data/elite-redux/er-biome-structure.ts:erMarkBiomeStay", "Stay did not arm the first overstay anchor");
  }
  restoreErBiomeStructure(25, 1, null);
  const leaveBefore = stateView();
  setErLeaveBiomeNow();
  const leaveAfter = stateView();
  if (leaveAfter.leave_biome_now !== true || erIsBiomeEnd(sourceWave) !== true) {
    gap("CROSSROADS_LEAVE_UNOBSERVABLE", "src/data/elite-redux/er-biome-structure.ts:setErLeaveBiomeNow", "Leave did not force the next boundary");
  }

  observeSource("ROUTE_CONTEXT_UNOBSERVABLE", ROUTE_SOURCE, () => requireGlobalRoutingSeams(game));
  const routeCapture = observeSource("ROUTE_CALLBACK_UNOBSERVABLE", ROUTE_SOURCE, () =>
    withRngCapture("route", () => rollErNextBiomeNodes(BiomeId.TOWN, null, RUN_SEED, 11)),
  );
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
  const routeStateAfter = {
    previous_biome_id: getErPrevBiome(),
    routing_state: getErRoutingState() ?? null,
    pending_nodes: getErPendingNodes(),
    pending_nodes_ready: erPendingNodesReady(),
  };
  const final = frontier(game);
  const structureDraws = sharedRngDraws("structure", structureCapture.rng, 0);
  const routeDraws = sharedRngDraws("route", routeCapture.rng, structureDraws.length);
  const rngDraws = [...structureDraws, ...routeDraws];
  const crossroadsDecision = {
    kind: "CROSSROADS_OPTIONS",
    source: "src/data/elite-redux/er-biome-structure.ts:erShouldRaiseCrossroads",
    source_wave: sourceWave,
    options: crossroadsOptions,
  };
  return {
    fixture_id: "biomes/town-crossroads-route-v1",
    run_seed: RUN_SEED,
    initial,
    decisions: [
      {
        kind: "STRUCTURE_PLAN",
        source: STRUCTURE_SOURCE,
        seed: RUN_SEED,
        start_wave: plan.startWave,
        length: plan.length,
      },
      crossroadsDecision,
      {
        kind: "CROSSROADS_STAY_PROBE",
        source: "src/data/elite-redux/er-biome-structure.ts:erMarkBiomeStay",
        source_wave: sourceWave,
        before: crossroadsBefore,
        after: stayAfter,
      },
      {
        kind: "CROSSROADS_LEAVE_PROBE",
        source: "src/data/elite-redux/er-biome-structure.ts:setErLeaveBiomeNow",
        source_wave: sourceWave,
        before: leaveBefore,
        after: leaveAfter,
      },
      {
        kind: "ROUTE_SELECTION",
        source: ROUTE_SOURCE,
        entry_wave: 11,
        selected: routeAfter,
      },
    ],
    rng_draws: rngDraws,
    ordered_transitions: [
      {
        sequence: 0,
        kind: "BIOME_STRUCTURE",
        source: STRUCTURE_SOURCE,
        before: structureBefore,
        after: structureAfter,
      },
      {
        sequence: 1,
        kind: "CROSSROADS_STAY",
        source: "src/data/elite-redux/er-biome-structure.ts:erMarkBiomeStay",
        before: crossroadsBefore,
        after: stayAfter,
      },
      {
        sequence: 2,
        kind: "CROSSROADS_LEAVE",
        source: "src/data/elite-redux/er-biome-structure.ts:setErLeaveBiomeNow",
        before: leaveBefore,
        after: leaveAfter,
      },
      {
        sequence: 3,
        kind: "ROUTE_OPTIONS",
        source: ROUTE_SOURCE,
        entry_wave: 11,
        nodes: orderedNodes,
      },
      {
        sequence: 4,
        kind: "ROUTE_SELECTION",
        source: ROUTE_SOURCE,
        selected: routeAfter,
      },
    ],
    mutations: [
      {
        kind: "BIOME_STRUCTURE_STATE",
        source: STRUCTURE_SOURCE,
        before: structureBefore,
        after: structureAfter,
      },
      {
        kind: "CROSSROADS_STATE",
        source: "src/data/elite-redux/er-biome-structure.ts:erMarkBiomeStay",
        before: crossroadsBefore,
        after: stayAfter,
      },
      {
        kind: "CROSSROADS_STATE",
        source: "src/data/elite-redux/er-biome-structure.ts:setErLeaveBiomeNow",
        before: leaveBefore,
        after: leaveAfter,
      },
      {
        kind: "ROUTE_STATE",
        source: ROUTE_SOURCE,
        before: routeBefore,
        after: routeStateAfter,
      },
    ],
    presentation: [
      crossroadsDecision,
      {
        kind: "ROUTE_PRESENTATION",
        source: "src/ui/handlers/er-map-picker-ui-handler.ts:nodes",
        entry_wave: 11,
        nodes: orderedNodes,
        selected: routeAfter,
      },
    ],
    final,
    next_control: nextControl(game),
    structure_before: structureBefore,
    structure_draws: structureCapture.rng.draws,
    structure_after: structureAfter,
    rng_capture: {
      structure: rngView(structureCapture.rng),
      route: rngView(routeCapture.rng),
    },
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
}

async function createHeadlessGame(): Promise<{ phaserGame: Phaser.Game; game: GameManager }> {
  const PhaserGame = Phaser.Game;
  if (typeof PhaserGame !== "function") {
    gap("OBSERVATION_SEAM_MISSING", "Phaser.Game", "headless game constructor is unavailable");
  }
  // A random Phaser config seed leaks into every `config.seed[0]` fallback
  // (e.g. game-data loadSession) and makes boot-time biome-structure rolls
  // process-dependent. Pin it so fresh processes stay byte-identical.
  const phaserGame = new PhaserGame({ type: Phaser.HEADLESS, seed: ["m4-oracle-anchor"] });
  const boot = Promise.withResolvers<void>();
  setTimeout(boot.resolve, 0);
  await boot.promise;
  return { phaserGame, game: new GameManager(phaserGame) };
}

export async function captureBiome(): Promise<Record<string, JsonValue>> {
  const { phaserGame, game } = await createHeadlessGame();
  const originalBattleSeed = BattleScene.prototype.randBattleSeedInt;
  try {
    resetErBiomeStructure();
    resetErRouting();
    const scenarioSpec = {
      v: 1,
      name: "M4A captured Town wave 10",
      notes: "Explicit test vector; not a natural single-seed segment.",
      party: [{ species: 7, moves: [33, 39, 55, 110], abilitySlot: 0, nature: 0 }],
      run: { seed: RUN_SEED, wave: 10, biome: BiomeId.TOWN, level: 10, difficulty: "ace" },
    } satisfies ScenarioSpec;
    const built = buildDevScenario(scenarioSpec);
    const ui = game.scene.ui as AnyRecord;
    ui.shouldSkipDialogue = () => true;
    await game.runToTitle();
    const starters = built.scenario.setup();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      const starterPhase = new SelectStarterPhase();
      game.override
        .seed(RUN_SEED)
        .startingWave(10)
        .startingBiome(BiomeId.TOWN);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      starterPhase.initBattle(starters, true);
      built.postLaunch();
    });
    await game.phaseInterceptor.to("CommandPhase", false);
    const battle = game.scene.currentBattle as AnyRecord | undefined;
    if (battle == null || battle.waveIndex !== 10 || game.scene.arena.biomeId !== BiomeId.TOWN) {
      gap("BIOME_VECTOR_MISMATCH", ENCOUNTER_SOURCE, "live Classic launch did not materialize wave 10 in Town");
    }
    return json(captureStructureAndRoute(game), "biome") as Record<string, JsonValue>;
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap(
      "BIOME_CALLBACK_UNOBSERVABLE",
      STRUCTURE_SOURCE,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    releaseGame(game);
    if (originalBattleSeed !== undefined) {
      BattleScene.prototype.randBattleSeedInt = originalBattleSeed;
    }
    try {
      phaserGame.destroy(true);
    } catch {
      // The browser harness may already own and dispose its Phaser instance.
    }
  }
}

export async function captureEncounter(): Promise<Record<string, JsonValue>> {
  const { phaserGame, game } = await createHeadlessGame();
  const originalBattleSeed = BattleScene.prototype.randBattleSeedInt;
  let encounterInitial: AnyRecord | null = null;
  try {
    const scenarioSpec = {
      v: 1,
      name: "M4A captured Plains wave 11",
      notes: "Explicit test vector; not a natural single-seed segment.",
      party: [{ species: 7, moves: [33, 39, 55, 110], abilitySlot: 0, nature: 0 }],
      run: { seed: RUN_SEED, wave: 11, biome: BiomeId.PLAINS, level: 10, difficulty: "ace" },
    } satisfies ScenarioSpec;
    const built = buildDevScenario(scenarioSpec);
    const ui = game.scene.ui as AnyRecord;
    ui.shouldSkipDialogue = () => true;
    await game.runToTitle();
    const starters = built.scenario.setup();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      const starterPhase = new SelectStarterPhase();
      const scenarioSeed = RUN_SEED;
      // Match the production launch frontier through the supported harness controls:
      // pin the run seed before the requested Plains arena is materialized, then set wave and biome.
      game.override
        .seed(scenarioSeed)
        .startingWave(11)
        .startingBiome(BiomeId.PLAINS);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      starterPhase.initBattle(starters, true);
      built.postLaunch();
    });

    await game.phaseInterceptor.to("EncounterPhase", false);
    encounterInitial = frontier(game);
    const captured = await withAsyncRngCapture("encounter", async () => {
      await game.phaseInterceptor.to("CommandPhase", false);
      const battle = game.scene.currentBattle as AnyRecord | undefined;
      if (battle == null) {
        gap("ENCOUNTER_SOURCE_UNOBSERVABLE", ENCOUNTER_SOURCE, "EncounterPhase completed without a live Battle");
      }
      if (battle.waveIndex !== 11 || game.scene.arena.biomeId !== BiomeId.PLAINS) {
        gap(
          "ENCOUNTER_VECTOR_MISMATCH",
          ENCOUNTER_SOURCE,
          `live EncounterPhase materialized wave ${String(battle.waveIndex)} in biome ${String(game.scene.arena.biomeId)}`,
        );
      }
      const players = game.scene.getPlayerParty() as Pokemon[];
      const enemies = game.scene.getEnemyParty() as Pokemon[];
      const playerField = game.scene.getPlayerField(false) as Pokemon[];
      const enemyField = game.scene.getEnemyField(false) as Pokemon[];
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
        biome_id: finite(game.scene.arena.biomeId, "encounter/biome"),
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
        enemy_leads: enemyField.map((mon, index) => ({
          stable_index: index,
          battler_index: mon.getBattlerIndex(),
          pokemon: pokemonView(mon, "enemy", index),
        })),
        player_leads: playerField.map((mon, index) => ({
          stable_index: index,
          battler_index: mon.getBattlerIndex(),
          pokemon: pokemonView(mon, "player", index),
        })),
        field: fieldView(game, battle),
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
    if (encounterInitial == null) {
      gap("ENCOUNTER_FRONTIER_UNOBSERVABLE", ENCOUNTER_SOURCE, "the live EncounterPhase launch frontier was not captured");
    }
    const encounterFinal = frontier(game);
    const encounterRngDraws = sharedRngDraws("encounter", captured.rng, 0);
    const scriptedDecision = {
      kind: "SCRIPTED_COMMAND",
      source: "test/kernel-fixtures/m4/export/biome-encounter-capture.ts:explicit-command-input",
      policy: captured.value.scripted_policy,
    };
    const encounter = {
      ...captured.value,
      fixture_id: "encounters/plains-wave-11-captured-v1",
      initial: encounterInitial,
      decisions: [
        {
          kind: "ENCOUNTER_GENERATION",
          source: ENCOUNTER_SOURCE,
          wave: captured.value.wave,
          biome_id: captured.value.biome_id,
        },
        scriptedDecision,
      ],
      rng_before: captured.rng.before,
      rng_draws: encounterRngDraws,
      rng_after: captured.rng.after,
      rng_capture: rngView(captured.rng),
      ordered_transitions: [
        {
          sequence: 0,
          kind: "CONTROL_TRANSITION",
          source: "src/phases/encounter-phase.ts:EncounterPhase.start",
          from: encounterInitial.canonical.runtime.phase,
          to: encounterFinal.canonical.runtime.phase,
        },
        {
          sequence: 1,
          kind: "BATTLE_MATERIALIZED",
          source: ENCOUNTER_SOURCE,
          wave: captured.value.wave,
          biome_id: captured.value.biome_id,
          battle_seed: captured.value.battle_seed,
        },
        {
          sequence: 2,
          kind: "COMMAND_POLICY_READY",
          source: "src/phases/command-phase.ts:handleCommand",
          policy: captured.value.scripted_policy,
        },
      ],
      mutations: [
        {
          kind: "CANONICAL_STATE",
          source: "src/system/game-data.ts:GameData.getSessionSaveData",
          before: encounterInitial.canonical,
          after: encounterFinal.canonical,
        },
        {
          kind: "RUN_RNG_FRONTIER",
          source: "Phaser.Math.RND",
          before: encounterInitial.rng.run,
          after: encounterFinal.rng.run,
        },
        {
          kind: "BATTLE_RNG_FRONTIER",
          source: "src/battle-scene.ts:battleSeedState",
          before: encounterInitial.rng.battle,
          after: encounterFinal.rng.battle,
        },
        {
          kind: "FIELD_MATERIALIZATION",
          source: "src/phases/encounter-phase.ts:runEncounter",
          after: captured.value.field,
        },
      ],
      presentation: [
        {
          kind: "BATTLE_PRESENTATION",
          source: "src/phases/encounter-phase.ts:runEncounter",
          format: captured.value.format,
          field: captured.value.field,
          enemy_leads: captured.value.enemy_leads,
          player_leads: captured.value.player_leads,
        },
        scriptedDecision,
      ],
      final: encounterFinal,
      next_control: nextControl(game),
    };
    return json(encounter, "encounter") as Record<string, JsonValue>;
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap(
      "ENCOUNTER_CALLBACK_UNOBSERVABLE",
      ENCOUNTER_SOURCE,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  } finally {
    releaseGame(game);
    if (originalBattleSeed !== undefined) {
      BattleScene.prototype.randBattleSeedInt = originalBattleSeed;
    }
    try {
      phaserGame.destroy(true);
    } catch {
      // The browser harness may already own and dispose its Phaser instance.
    }
  }
}
