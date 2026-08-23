import { globalScene, initGlobalScene } from "#app/global-scene";
import {
  advanceMoodyFormationTimedResources,
  buildMoodyFormationMoveMetadata,
  createEmptyMoodyFormationEngineState,
  createMoodyFormationCommandHandlers,
  dispatchMoodyFormationGameEvent,
  getMoodyFormationEngineState,
  getMoodyFormationHudSnapshot,
  MOODY_FORMATION_COMMAND_KINDS,
  MOODY_FORMATION_HOOK_EVENTS,
  type MoodyFormationEnginePort,
  notifyMoodyFormationEnemyStatIncrease,
  notifyMoodyFormationEntry,
  notifyMoodyFormationFaint,
  notifyMoodyFormationMoveResolved,
  notifyMoodyFormationSwitch,
  selectMoodyFormationAdjacentPokemonId,
  selectMoodyFormationBorrowedSecondaryId,
  selectMoodyFormationRepertoireRewards,
} from "#data/elite-redux/moody/moody-formation-game-adapter";
import type {
  MoodyFormationCommand,
  MoodyFormationEffect,
  MoodyFormationEvent,
  MoodyFormationPokemonSnapshot,
} from "#data/elite-redux/moody/moody-runtime-formation";
import {
  createMoodyFormationRuntimeState,
  resolveMoodyFormationEffect,
} from "#data/elite-redux/moody/moody-runtime-formation";
import { executeMoodyFormationCommand } from "#data/elite-redux/moody/moody-runtime-formation-adapter";
import {
  createMoodyModeState,
  getMoodyModeSaveData,
  initializeMoodyModeState,
  resetMoodyModeState,
  restoreMoodyModeState,
  setMoodyFormationEngineSaveData,
} from "#data/elite-redux/moody/moody-state";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { TurnMove } from "#types/turn-move";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sceneMock = {
  currentBattle: {
    waveIndex: 1,
    battleSeed: "formation-adapter-test",
    turn: 1,
    battleType: 0,
  },
  arena: { biomeId: 1 },
  getPlayerParty: vi.fn(() => []),
  getEnemyParty: vi.fn(() => []),
  getPlayerField: vi.fn(() => []),
  getEnemyField: vi.fn(() => []),
  getPokemonById: vi.fn((_id: number): Pokemon | undefined => undefined),
  phaseManager: {
    unshiftNew: vi.fn(),
    unshiftPhase: vi.fn(),
    queueMessage: vi.fn(),
  },
  ui: {
    pushMoodyTrigger: vi.fn(),
  },
};

const pokemon: MoodyFormationPokemonSnapshot = {
  pokemonId: 7,
  partySlot: 0,
  currentHp: 50,
  maxHp: 100,
  conscious: true,
  positiveStages: {},
  negativeStages: { defense: -1 },
  highestOffensiveStat: "attack",
  highestNonHpStat: "attack",
  highestDefensiveStat: "defense",
  mostDepletedMoveId: 10,
  allPpFull: false,
};

const party = { slots: [pokemon, null, null, null, null, null] } as const;

function livePokemon(
  id: number,
  options: {
    fainted?: boolean;
    moves?: readonly Move[];
    random?: number;
  } = {},
): Pokemon {
  const moves = options.moves ?? [];
  return {
    id,
    hp: options.fainted ? 0 : 100,
    stats: [100, 100, 100, 100, 100, 100, 0, 0],
    status: undefined,
    turnData: { attacksReceived: [] },
    isPlayer: () => true,
    isFainted: () => options.fainted === true,
    isActive: () => options.fainted !== true,
    getMaxHp: () => 100,
    getStatStage: () => 0,
    getTag: () => undefined,
    findAndRemoveTags: () => 0,
    getMoveset: () =>
      moves.map(move => ({ moveId: move.id, ppUsed: 0, getMovePp: () => move.pp, getMove: () => move })),
    getMoveHistory: () => [],
    getAllies: () => [],
    getTypes: () => [],
    getMoveType: () => 0,
    randBattleSeedInt: (range: number) => Math.min(options.random ?? 0, Math.max(0, range - 1)),
    getBattlerIndex: () => 0,
  } as unknown as Pokemon;
}

function installBoon(
  boonId: string,
  targetPokemonIds: readonly number[],
  evolutionId?: string,
  rank: 1 | 2 | 3 = 1,
): void {
  const state = createMoodyModeState(`live-${boonId}`);
  state.boons.push({
    instanceId: `${boonId}:live`,
    boonId,
    rank,
    ...(evolutionId == null ? {} : { evolutionId }),
    target: { pokemonIds: [...targetPokemonIds] },
    acquiredAtWave: 1,
  });
  expect(restoreMoodyModeState(state)).toBe(true);
}

function stubLiveParty(playerParty: readonly Pokemon[]): void {
  initGlobalScene(sceneMock as never);
  sceneMock.getPlayerParty.mockReturnValue(playerParty as never[]);
  sceneMock.getEnemyParty.mockReturnValue([]);
  sceneMock.getPokemonById.mockImplementation(id => playerParty.find(member => member.id === id) as never);
  sceneMock.getPlayerField.mockImplementation(() => playerParty.filter(member => member.isActive()) as never[]);
  sceneMock.phaseManager.unshiftNew.mockImplementation(() => undefined);
}

function commandFixtures(): readonly MoodyFormationCommand[] {
  const source = "bastion-seat" as const;
  return [
    { kind: "modify-action", source, pokemonId: 7, damageMultiplier: 1.2 },
    { kind: "heal", source, pokemonId: 7, maxHpFraction: 0.2 },
    { kind: "barrier", source, pokemonId: 7, maxHpFraction: 0.2 },
    { kind: "restore-pp", source, pokemonId: 7, moveId: 10, amount: 2 },
    { kind: "stat-stage", source, pokemonId: 7, stat: "attack", stages: 1 },
    { kind: "clear-negative-stage", source, pokemonId: 7, count: 1 },
    { kind: "clear-volatile", source, pokemonId: 7, count: "all" },
    { kind: "clear-status", source, pokemonId: 7 },
    { kind: "forced-switch-immunity", source, pokemonId: 7, duration: "battle" },
    { kind: "echo", source, pokemonId: 7, powerFraction: 0.25 },
    { kind: "negate", source, event: "status" },
    { kind: "survive", source, pokemonId: 7, hp: 1 },
    { kind: "experience-multiplier", source, pokemonId: 7, multiplier: 1.5 },
    {
      kind: "max-hp-and-damage",
      source,
      pokemonId: 7,
      maxHpMultiplier: 1.2,
      damageMultiplier: 1.2,
      speedMultiplier: 0.8,
      preserveCurrentHp: true,
    },
    { kind: "copy-secondary", source, pokemonId: 7, secondaryId: "flinch", uses: 1, guaranteed: true },
    { kind: "status-resistance", source, pokemonId: 7, status: "burn", tier: 2 },
    {
      kind: "amplify-item",
      source,
      pokemonId: 7,
      itemStackId: "LEFTOVERS",
      multiplier: 2,
      protected: true,
      adapter: "magnitude",
      repeatActivation: false,
    },
    { kind: "max-pp", source, pokemonId: 7, moveId: 10, flatDelta: 2, allMoves: false },
    { kind: "repertoire-reward", source, pokemonId: 7, reward: "next-priority", magnitudeMultiplier: 1 },
    { kind: "choice-required", source, choice: "final-draft", options: ["climax"], chooseCount: 1 },
    { kind: "disable-move", source, pokemonId: 7, moveId: 10, duration: "battle" },
    { kind: "mark", source, pokemonId: 7, name: "test", value: true },
  ];
}

function fakePort() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (..._values: unknown[]) => {
      calls.push(name);
    };
  const port: MoodyFormationEnginePort = {
    getMaxHp: () => 100,
    heal: record("heal"),
    restorePp: record("restore-pp"),
    queueStatStage: record("stat-stage"),
    clearNegativeStages: record("clear-negative-stage"),
    clearVolatiles: record("clear-volatile"),
    clearStatus: record("clear-status"),
    queueEcho: record("echo"),
    presentSurvive: record("survive"),
    payMaxHpCost: record("max-hp-cost"),
    setMaxPp: record("max-pp"),
    announceChoice: record("choice-required"),
  };
  return { calls, port };
}

function eventForCommand(command: MoodyFormationCommand): MoodyFormationEvent {
  if (command.kind === "negate") {
    return { type: "status-directed", target: pokemon, status: "burn", volatile: false };
  }
  if (command.kind === "echo" || command.kind === "choice-required") {
    return {
      type: "move-attempt",
      user: pokemon,
      targetPokemonId: 8,
      moveId: 10,
      moveType: "1",
      category: "physical",
      moveTags: [],
      damaging: true,
      echoEligible: true,
      priority: 0,
      ppBefore: 5,
      maxPp: 10,
      useNumber: 1,
      consecutiveUse: 1,
      isStab: true,
    };
  }
  return { type: "turn-start", turn: 1 };
}

function stateWithoutCounts(value: ReturnType<typeof createEmptyMoodyFormationEngineState>) {
  const clone = structuredClone(value);
  clone.commandCounts = Object.fromEntries(
    MOODY_FORMATION_COMMAND_KINDS.map(kind => [kind, 0]),
  ) as typeof clone.commandCounts;
  return clone;
}

describe("Moody formation live command executor", () => {
  beforeEach(() => {
    initGlobalScene(sceneMock as never);
    sceneMock.getPlayerParty.mockReturnValue([]);
    sceneMock.getEnemyParty.mockReturnValue([]);
    sceneMock.getPlayerField.mockReturnValue([]);
    sceneMock.getEnemyField.mockReturnValue([]);
    sceneMock.getPokemonById.mockReturnValue(undefined);
  });

  afterEach(() => {
    resetMoodyModeState();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("has a behaviorful handler for every command kind", () => {
    const fixtures = commandFixtures();
    expect(fixtures.map(command => command.kind)).toEqual(MOODY_FORMATION_COMMAND_KINDS);

    for (const command of fixtures) {
      const engine = createEmptyMoodyFormationEngineState();
      const before = stateWithoutCounts(engine);
      const { calls, port } = fakePort();
      executeMoodyFormationCommand(
        { preflight: () => ({ ok: true }), handlers: createMoodyFormationCommandHandlers(engine, port) },
        command,
        { sequence: 1, commandIndex: 0, effectInstanceId: "test", event: eventForCommand(command) },
      );
      expect(engine.commandCounts[command.kind], `${command.kind} was not routed`).toBe(1);
      const stateChanged = JSON.stringify(stateWithoutCounts(engine)) !== JSON.stringify(before);
      expect(stateChanged || calls.length > 0, `${command.kind} executed as a no-op`).toBe(true);
    }
  });

  it("derives mechanical move tags so School Founder affects a tagged sibling move", () => {
    const user = { getMoveHistory: () => [] } as unknown as Pokemon;
    const siblingMove = {
      id: 11,
      hasFlag: (flag: MoveFlags) => flag === MoveFlags.PUNCHING_MOVE,
      hasAttr: () => false,
    } as unknown as Move;
    const metadata = buildMoodyFormationMoveMetadata(user, siblingMove);
    const schoolFounder: MoodyFormationEffect = {
      instanceId: "signature-school-founder",
      boonId: "signature-technique",
      rank: 3,
      evolutionId: "school-founder",
      target: { moveIds: [10], moveTag: "punch" },
    };
    const result = resolveMoodyFormationEffect(schoolFounder, createMoodyFormationRuntimeState(), {
      type: "move-attempt",
      user: pokemon,
      moveId: 11,
      moveType: "fighting",
      category: "physical",
      moveTags: metadata.moveTags,
      damaging: true,
      echoEligible: true,
      priority: 0,
      ppBefore: 5,
      maxPp: 10,
      useNumber: metadata.useNumber,
      consecutiveUse: metadata.consecutiveUse,
      isStab: false,
    });

    expect(metadata.moveTags).toContain("punch");
    expect(result.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-action", pokemonId: 7, damageMultiplier: 1.15 }),
    );
  });

  it("derives a four-use Refrain chain and emits its escalated power and PP cost", () => {
    const history: TurnMove[] = Array.from({ length: 3 }, () => ({
      move: MoveId.POUND,
      targets: [],
      useMode: MoveUseMode.NORMAL,
      result: MoveResult.SUCCESS,
    }));
    const user = { getMoveHistory: () => history } as unknown as Pokemon;
    const move = {
      id: MoveId.POUND,
      hasFlag: () => false,
      hasAttr: () => false,
    } as unknown as Move;
    const metadata = buildMoodyFormationMoveMetadata(user, move);
    const refrain: MoodyFormationEffect = {
      instanceId: "refrain-live-chain",
      boonId: "refrain",
      rank: 1,
      target: { moveIds: [MoveId.POUND] },
    };
    const result = resolveMoodyFormationEffect(refrain, createMoodyFormationRuntimeState(), {
      type: "move-attempt",
      user: pokemon,
      moveId: MoveId.POUND,
      moveType: "normal",
      category: "physical",
      moveTags: metadata.moveTags,
      damaging: true,
      echoEligible: true,
      priority: 0,
      ppBefore: 5,
      maxPp: 10,
      useNumber: metadata.useNumber,
      consecutiveUse: metadata.consecutiveUse,
      isStab: true,
    });

    expect(metadata).toMatchObject({ useNumber: 4, consecutiveUse: 4 });
    expect(result.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-action", pokemonId: 7, damageMultiplier: 1.75, ppCost: 4 }),
    );
  });

  it("dispatches and persists every hook-map event", () => {
    initializeMoodyModeState("all-live-hooks");
    const events: readonly MoodyFormationEvent[] = [
      { type: "battle-start", battleId: "b", wave: 1, biome: 1, party },
      { type: "battle-end", battleId: "b" },
      { type: "wave-start", wave: 1, seed: 1, party },
      { type: "biome-start", biome: 1 },
      { type: "turn-start", turn: 1 },
      { type: "turn-complete", turn: 1, pokemonId: 7, partySlot: 0, active: true },
      {
        type: "entry",
        pokemon,
        firstEntryThisBattle: true,
        afterAllyFainted: false,
        allyDamagedEarlierThisTurn: false,
      },
      { type: "switch", voluntary: true, outgoing: pokemon, incoming: pokemon, allyDamagedEarlierThisTurn: false },
      { type: "exit", pokemonId: 7, partySlot: 0 },
      {
        type: "move-attempt",
        user: pokemon,
        moveId: 10,
        moveType: "1",
        category: "physical",
        moveTags: [],
        damaging: true,
        echoEligible: true,
        priority: 0,
        ppBefore: 5,
        maxPp: 10,
        useNumber: 1,
        consecutiveUse: 1,
        isStab: true,
      },
      {
        type: "move-resolved",
        user: pokemon,
        moveId: 10,
        moveSlot: 0,
        moveType: "1",
        category: "physical",
        damaging: true,
        outcome: "hit",
      },
      { type: "damage-received", target: pokemon, moveType: "1", direct: true },
      { type: "lethal-check", target: pokemon, hpBeforeFraction: 0.5, bossBattle: false, biome: 1 },
      {
        type: "knockout",
        attacker: pokemon,
        defeatedPokemonId: 8,
        defeatedTypes: ["1"],
        elite: false,
        boss: false,
        bossSegmentBreak: false,
        tenWaveSegment: 0,
      },
      { type: "fainted", pokemon, party },
      { type: "final-conscious", pokemon },
      { type: "status-directed", target: pokemon, status: "burn", volatile: false },
      { type: "stat-drop-directed", target: pokemon, stat: "attack", stages: -1 },
      { type: "status-cured", pokemon, status: "burn" },
      { type: "enemy-stat-increase", stat: "attack", stages: 1 },
      { type: "item-activation", pokemonId: 7, itemStackId: "LEFTOVERS", adapter: "magnitude" },
      { type: "opponent-move", moveId: 10, userPokemonId: 8 },
      { type: "evaluate", pokemon, party, turn: 1 },
    ];
    expect(events.map(event => event.type)).toEqual(MOODY_FORMATION_HOOK_EVENTS);
    for (const event of events) {
      dispatchMoodyFormationGameEvent(event, fakePort().port);
    }
    const engine = getMoodyFormationEngineState();
    for (const type of MOODY_FORMATION_HOOK_EVENTS) {
      expect(engine.hookCounts[type], `${type} was uncalled`).toBe(1);
    }

    const saved = getMoodyModeSaveData();
    resetMoodyModeState();
    expect(restoreMoodyModeState(saved)).toBe(true);
    expect(getMoodyFormationEngineState().hookCounts).toEqual(engine.hookCounts);
  });

  it("excludes passive-owned query commands from the live action store", () => {
    const engine = createEmptyMoodyFormationEngineState();
    const { port } = fakePort();
    const handlers = createMoodyFormationCommandHandlers(engine, port);
    handlers["modify-action"](
      { kind: "modify-action", source: "scar-reader", pokemonId: 7, incomingDamageMultiplier: 0.75 },
      {
        sequence: 1,
        commandIndex: 0,
        effectInstanceId: "scar",
        event: { type: "damage-received", target: pokemon, moveType: "1", direct: true },
      },
    );
    expect(engine.pendingActions["7"]).toBeUndefined();
    expect(engine.marks["passive-owned:scar-reader:7"]).toBe(true);
    expect(engine.commandCounts["modify-action"]).toBe(1);

    handlers.mark(
      { kind: "mark", source: "chosen-one", name: "outgoingDamageMultiplier", value: 1.2 },
      {
        sequence: 2,
        commandIndex: 0,
        effectInstanceId: "chosen",
        event: { type: "evaluate", pokemon, party, turn: 1 },
      },
    );
    expect(engine.marks["7:outgoingDamageMultiplier"]).toBeUndefined();
    expect(engine.marks["passive-owned:chosen-one:outgoingDamageMultiplier"]).toBe(true);
  });

  it("builds reachable random payloads for Tag Combo, Full Repertoire, and Shared Inspiration", () => {
    const secondaryMove = {
      id: 10,
      pp: 10,
      power: 60,
      category: MoveCategory.PHYSICAL,
      hasAttr: (attr: string) => attr === "FlinchAttr",
      getAttrs: () => [],
    } as unknown as Move;
    const outgoing = livePokemon(7, { moves: [secondaryMove] });
    const adjacent = livePokemon(8);
    const distant = livePokemon(9);

    expect(selectMoodyFormationBorrowedSecondaryId(outgoing)).toBe("move:10:flinch");
    expect(selectMoodyFormationRepertoireRewards(outgoing)).toHaveLength(8);
    expect(new Set(selectMoodyFormationRepertoireRewards(outgoing)).size).toBe(8);
    expect(selectMoodyFormationAdjacentPokemonId(outgoing, [outgoing, adjacent, distant])).toBe(adjacent.id);
  });

  it("routes all four production payloads through the live notification entry points", () => {
    const secondaryMove = {
      id: 10,
      pp: 10,
      power: 60,
      priority: 0,
      category: MoveCategory.PHYSICAL,
      hasAttr: (attr: string) => attr === "FlinchAttr",
      getAttrs: () => [],
    } as unknown as Move;
    const fainted = livePokemon(6, { fainted: true });
    const lead = livePokemon(7, { moves: [secondaryMove], random: 999 });
    const partner = livePokemon(8);
    const liveParty = [lead, partner, fainted];
    stubLiveParty(liveParty);

    installBoon("tag-combo", [lead.id, partner.id], "relay-chemistry", 3);
    notifyMoodyFormationSwitch(lead, partner, true);
    expect(getMoodyFormationEngineState().copiedSecondaries[String(partner.id)]).toMatchObject({
      secondaryId: "move:10:flinch",
      uses: 2,
    });

    installBoon("full-repertoire", [lead.id]);
    notifyMoodyFormationMoveResolved(lead, secondaryMove, "hit");
    expect(getMoodyFormationEngineState().commandCounts["repertoire-reward"]).toBe(1);

    installBoon("copycat-heart", [lead.id], "shared-inspiration", 3);
    const stageSpy = vi.mocked(globalScene.phaseManager.unshiftNew);
    notifyMoodyFormationEnemyStatIncrease("attack", 2);
    expect(stageSpy).toHaveBeenCalledWith("StatStageChangePhase", 0, true, expect.any(Array), 2);
    expect(stageSpy).toHaveBeenCalledTimes(2);

    installBoon("revenge-entry", [partner.id]);
    notifyMoodyFormationFaint(fainted);
    notifyMoodyFormationEntry(partner);
    expect(stageSpy).toHaveBeenCalledWith("StatStageChangePhase", 0, true, expect.any(Array), 1);
  });

  it("emits one exact live trigger label per successful effect and event", () => {
    const target = livePokemon(7);
    stubLiveParty([target]);
    installBoon("revenge-entry", [target.id], "protective-revenge", 3);
    const triggerSpy = vi.spyOn(globalScene.ui, "pushMoodyTrigger").mockImplementation(() => {});

    notifyMoodyFormationEntry(target, true);

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith(
      "Revenge Entry: +1 Speed, +30% barrier, volatile conditions cleared, +1 Attack",
      expect.objectContaining({ effectId: "revenge-entry", kind: "boon", side: "player" }),
    );
  });

  it("grants Bastion Seat on the first entry even when the Pokemon has prior move history", () => {
    const target = livePokemon(7) as Pokemon & { getMoveHistory: () => TurnMove[] };
    target.getMoveHistory = () => {
      throw new Error("entry detection must not use cross-battle move history");
    };
    stubLiveParty([target]);
    const state = createMoodyModeState("live-bastion-seat");
    state.boons.push({
      instanceId: "bastion-seat:live",
      boonId: "bastion-seat",
      rank: 1,
      target: { partySlots: [0] },
      acquiredAtWave: 1,
    });
    expect(restoreMoodyModeState(state)).toBe(true);

    notifyMoodyFormationEntry(target);
    expect(getMoodyFormationEngineState().barriers[String(target.id)]).toBe(20);

    notifyMoodyFormationEntry(target);
    expect(getMoodyFormationEngineState().barriers[String(target.id)]).toBe(20);
  });

  it("reverses each temporary stat-stage resource exactly once when its duration expires", () => {
    const engine = createEmptyMoodyFormationEngineState();
    const statStageCalls: [number, string, number][] = [];
    const { port } = fakePort();
    port.queueStatStage = (pokemonId, stat, stages) => statStageCalls.push([pokemonId, stat, stages]);
    const handlers = createMoodyFormationCommandHandlers(engine, port);
    handlers["stat-stage"](
      { kind: "stat-stage", source: "quiet-mentor", pokemonId: 7, stat: "speed", stages: 1, durationTurns: 2 },
      {
        sequence: 4,
        commandIndex: 0,
        effectInstanceId: "mentor-a",
        event: { type: "battle-start", battleId: "b", wave: 1, biome: 1, party },
      },
    );
    handlers["stat-stage"](
      { kind: "stat-stage", source: "quiet-mentor", pokemonId: 7, stat: "speed", stages: 1, durationTurns: 2 },
      {
        sequence: 4,
        commandIndex: 1,
        effectInstanceId: "mentor-b",
        event: { type: "battle-start", battleId: "b", wave: 1, biome: 1, party },
      },
    );

    expect(Object.keys(engine.timedMarks)).toHaveLength(2);
    advanceMoodyFormationTimedResources(engine, 7, port);
    expect(statStageCalls).toEqual([
      [7, "speed", 1],
      [7, "speed", 1],
    ]);
    advanceMoodyFormationTimedResources(engine, 7, port);
    expect(statStageCalls).toEqual([
      [7, "speed", 1],
      [7, "speed", 1],
      [7, "speed", -1],
      [7, "speed", -1],
    ]);
    expect(engine.timedMarks).toEqual({});
    expect(engine.marks).toEqual({});
    advanceMoodyFormationTimedResources(engine, 7, port);
    expect(statStageCalls).toHaveLength(4);
  });

  it("projects defensive active-player barrier and mark values for the HUD", () => {
    initializeMoodyModeState("hud-snapshot");
    const active = livePokemon(7);
    const benched = livePokemon(8);
    stubLiveParty([active, benched]);
    vi.mocked(globalScene.getPlayerField).mockReturnValue([active] as never);
    const engine = createEmptyMoodyFormationEngineState();
    engine.barriers["7"] = 64;
    engine.marks["7:revengeDamageMultiplier"] = 1.2;
    engine.marks["once:opening:pokemon:7"] = true;
    engine.marks["8:hidden"] = true;
    setMoodyFormationEngineSaveData({ version: 1, stateJson: JSON.stringify(engine) });

    const snapshot = getMoodyFormationHudSnapshot();
    expect(snapshot).toEqual({
      activePlayer: [
        {
          pokemonId: 7,
          barrier: 64,
          marks: { "7:revengeDamageMultiplier": 1.2, "once:opening:pokemon:7": true },
        },
      ],
    });
    (snapshot.activePlayer[0]!.marks as Record<string, unknown>)["7:revengeDamageMultiplier"] = 99;
    expect(getMoodyFormationHudSnapshot().activePlayer[0]!.marks["7:revengeDamageMultiplier"]).toBe(1.2);
  });
});
