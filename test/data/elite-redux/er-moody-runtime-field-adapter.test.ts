import {
  createMoodyRuntimeFieldState,
  type MoodyRuntimeCommand,
  type MoodyRuntimeFieldResult,
} from "#data/elite-redux/moody/moody-runtime-field";
import {
  attachMoodyRuntimeFieldSave,
  consumeMoodyRuntimeActionTriggerIds,
  deserializeMoodyRuntimeFieldState,
  didMoodyDamageCrossHpFraction,
  extractMoodyRuntimeFieldSave,
  MOODY_RUNTIME_COMMAND_KINDS,
  MOODY_RUNTIME_FIELD_HOOK_SITES,
  type MoodyLiveBattleSnapshot,
  type MoodyLivePokemonReader,
  MoodyRuntimeFieldEventAdapter,
  recordMoodyRuntimeActionTriggerIds,
  resetMoodyRuntimeFieldState,
  serializeMoodyRuntimeFieldState,
  snapshotMoodyRuntimePokemon,
  translateMoodyRuntimeCommand,
  translateMoodyRuntimeResult,
} from "#data/elite-redux/moody/moody-runtime-field-adapter";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { describe, expect, it } from "vitest";

interface LivePokemon {
  id: number;
  player: boolean;
  slot: number;
  hp: number;
  maxHp: number;
  fainted: boolean;
  status?: "burn" | "poison" | "toxic" | "paralysis" | "sleep" | "frostbite";
  grounded: boolean;
  moves: string[];
  eligibleMoves: string[];
  abilities: string[];
  types: string[];
}

const player: LivePokemon = {
  id: 101,
  player: true,
  slot: 0,
  hp: 80,
  maxHp: 100,
  fainted: false,
  status: "burn",
  grounded: true,
  moves: ["flamethrower", "protect"],
  eligibleMoves: ["flamethrower"],
  abilities: ["blaze"],
  types: ["fire"],
};

const { status: _playerStatus, ...playerWithoutStatus } = player;
const ally: LivePokemon = {
  ...playerWithoutStatus,
  id: 102,
  slot: 1,
  hp: 30,
};
const enemy: LivePokemon = {
  ...playerWithoutStatus,
  id: 201,
  player: false,
  moves: ["surf", "toxic"],
  eligibleMoves: ["surf"],
  abilities: ["torrent"],
  types: ["water"],
};

const reader: MoodyLivePokemonReader<LivePokemon> = {
  id: pokemon => pokemon.id,
  side: pokemon => (pokemon.player ? "player" : "enemy"),
  partySlot: pokemon => pokemon.slot,
  currentHp: pokemon => pokemon.hp,
  maxHp: pokemon => pokemon.maxHp,
  fainted: pokemon => pokemon.fainted,
  status: pokemon => pokemon.status,
  grounded: pokemon => pokemon.grounded,
  moveIds: pokemon => pokemon.moves,
  eligibleMoveIds: pokemon => pokemon.eligibleMoves,
  compatibleAbilityIds: pokemon => pokemon.abilities,
  types: pokemon => pokemon.types,
};

const battle: MoodyLiveBattleSnapshot<LivePokemon> = {
  battleId: "battle:100:4",
  waveIndex: 100,
  turn: 4,
  seed: 12345,
  isBoss: true,
  isTrainer: true,
  biomeId: 7,
  biomeEpoch: 3,
  playerParty: [player, ally],
  enemyParty: [enemy],
  playerActive: [player],
  enemyActive: [enemy],
};

function adapter(): MoodyRuntimeFieldEventAdapter<LivePokemon> {
  return new MoodyRuntimeFieldEventAdapter(battle, reader);
}

describe("Moody live snapshot adapter", () => {
  it("captures every mutable Pokemon value into a detached deterministic snapshot", () => {
    const snapshot = snapshotMoodyRuntimePokemon(player, reader);
    expect(snapshot).toEqual({
      id: 101,
      side: "player",
      partySlot: 0,
      currentHp: 80,
      maxHp: 100,
      fainted: false,
      status: "burn",
      grounded: true,
      moveCount: 2,
      moveIds: ["flamethrower", "protect"],
      eligibleMoveIds: ["flamethrower"],
      compatibleAbilityIds: ["blaze"],
      types: ["fire"],
    });
    player.moves.push("temporary-test-move");
    expect(snapshot.moveIds).toEqual(["flamethrower", "protect"]);
    player.moves.pop();
  });

  it("constructs every reducer event kind from live references", () => {
    const fieldAdapter = adapter();
    const move = {
      user: player,
      target: enemy,
      moveId: "flamethrower",
      moveType: "fire",
      category: "special" as const,
      damaging: true,
      actionId: "action:1",
    };
    const events = [
      fieldAdapter.battleStart(player),
      fieldAdapter.battleEnd({ won: true, enteredPokemonIds: [player.id] }),
      fieldAdapter.entry({
        pokemon: player,
        activePokemon: [player],
        isReentry: false,
      }),
      fieldAdapter.beforeMove({ ...move, legalBestType: "grass" }),
      fieldAdapter.moveResolved({
        ...move,
        landed: true,
        dealtDirectDamage: true,
      }),
      fieldAdapter.beforeDamage({
        source: enemy,
        target: player,
        amount: 30,
        direct: true,
      }),
      fieldAdapter.afterDamage({
        source: enemy,
        target: player,
        amount: 30,
        direct: true,
        barrierAbsorbed: 5,
        hpAfter: 50,
        crossedQuarterHp: false,
      }),
      fieldAdapter.heal({
        target: player,
        amount: 20,
        effectiveAmount: 10,
        benchedAllies: [ally],
      }),
      fieldAdapter.statusAttempt({
        source: enemy,
        target: player,
        status: "poison",
      }),
      fieldAdapter.statusApplied(player, "poison"),
      fieldAdapter.statusCured(player, "burn", [ally]),
      fieldAdapter.volatileAttempt(player, "confusion"),
      fieldAdapter.volatileApplied(player, "confusion"),
      fieldAdapter.weatherTransition({
        previous: "rain",
        next: "clear",
        naturalOrReplacement: true,
        activePokemon: player,
      }),
      fieldAdapter.barrierEnded(player, true, "frostbound"),
      fieldAdapter.turnStart([player, enemy]),
      fieldAdapter.turnEnd([player, enemy]),
      fieldAdapter.actionResolved({
        actor: player,
        target: enemy,
        actionId: "action:1",
        boonTriggerCount: 2,
        removableNegativeCount: 1,
      }),
      fieldAdapter.faint({
        pokemon: player,
        otherConsciousAllies: [ally],
        activeEnemy: enemy,
      }),
      fieldAdapter.ko(player, enemy),
      fieldAdapter.switchAttempt(player, true),
      fieldAdapter.leadSelection(player),
      fieldAdapter.battleWon({ side: "player", alliedFaints: 0 }),
      fieldAdapter.biomeTransition({ [player.id]: ["ice-beam"] }),
      fieldAdapter.encounterGenerate({
        baseRosterSize: 6,
        noFaintWinStreak: 5,
      }),
      fieldAdapter.boonDraft(["offer:a", "offer:b", "offer:c"]),
    ];

    expect(events.map(event => event.kind)).toEqual([
      "battle-start",
      "battle-end",
      "entry",
      "before-move",
      "move-resolved",
      "before-damage",
      "after-damage",
      "heal",
      "status-attempt",
      "status-applied",
      "status-cured",
      "volatile-attempt",
      "volatile-applied",
      "weather-transition",
      "barrier-ended",
      "turn-start",
      "turn-end",
      "action-resolved",
      "faint",
      "ko",
      "switch-attempt",
      "lead-selection",
      "battle-won",
      "biome-transition",
      "encounter-generate",
      "boon-draft",
    ]);
    expect(events.every(event => event.battleId === battle.battleId && event.seed === battle.seed)).toBe(true);
  });

  it("emits entry facts for every battler already active at battle opening", () => {
    const entries = adapter().initialEntries({
      weatherOptions: ["clear", "rain"],
      terrainOptions: ["none", "grassy"],
    });

    expect(entries).toHaveLength(2);
    expect(entries).toEqual([
      expect.objectContaining({
        kind: "entry",
        pokemon: expect.objectContaining({ id: player.id, side: "player" }),
        activePokemonIds: [player.id],
        isReentry: false,
        weatherOptions: ["clear", "rain"],
        terrainOptions: ["none", "grassy"],
      }),
      expect.objectContaining({
        kind: "entry",
        pokemon: expect.objectContaining({ id: enemy.id, side: "enemy" }),
        activePokemonIds: [enemy.id],
        isReentry: false,
      }),
    ]);
  });

  it("preserves the derived field facts required by Emergency Shell, Offensive Guard, and Lucid Dreamer", () => {
    const fieldAdapter = adapter();
    const move = {
      user: player,
      target: enemy,
      moveId: "dream-eater",
      moveType: "psychic",
      category: "special" as const,
      damaging: true,
      raisesStats: true,
      actionId: "action:traits",
    };

    expect(fieldAdapter.beforeMove({ ...move, asleep: true, dreamTagged: true })).toEqual(
      expect.objectContaining({ raisesStats: true, asleep: true, dreamTagged: true }),
    );
    expect(
      fieldAdapter.afterDamage({
        source: enemy,
        target: player,
        amount: 60,
        direct: true,
        barrierAbsorbed: 0,
        hpAfter: 20,
        crossedQuarterHp: true,
      }),
    ).toEqual(expect.objectContaining({ crossedQuarterHp: true }));
  });
});

describe("Moody live field fact derivation", () => {
  it("fires the quarter-HP crossing only when damage moves from at-or-above 25% to below it", () => {
    expect(didMoodyDamageCrossHpFraction({ hpBefore: 26, hpAfter: 24, maxHp: 100 })).toBe(true);
    expect(didMoodyDamageCrossHpFraction({ hpBefore: 25, hpAfter: 24, maxHp: 100 })).toBe(true);
    expect(didMoodyDamageCrossHpFraction({ hpBefore: 26, hpAfter: 25, maxHp: 100 })).toBe(false);
    expect(didMoodyDamageCrossHpFraction({ hpBefore: 24, hpAfter: 10, maxHp: 100 })).toBe(false);
  });

  it("aggregates unique boon triggers across lanes without resolving any effect twice", () => {
    const field = recordMoodyRuntimeActionTriggerIds(createMoodyRuntimeFieldState(), battle.battleId, player.id, [
      "prismatic-opening",
      "elemental-dividend",
    ]);
    const withPassiveAndFormation = recordMoodyRuntimeActionTriggerIds(field, battle.battleId, player.id, [
      "prismatic-opening",
      "tag-combo",
    ]);
    const consumed = consumeMoodyRuntimeActionTriggerIds(withPassiveAndFormation, battle.battleId, player.id);

    expect(consumed.effectIds).toEqual(["prismatic-opening", "elemental-dividend", "tag-combo"]);
    expect(consumed.state.lists).toEqual({});
    expect(consumeMoodyRuntimeActionTriggerIds(consumed.state, battle.battleId, player.id).effectIds).toEqual([]);
  });
});

describe("Moody executable operation translation", () => {
  it("translates the machine-listed command union exhaustively", () => {
    const operations = MOODY_RUNTIME_COMMAND_KINDS.map(kind =>
      translateMoodyRuntimeCommand({
        kind,
        effectId: "prismatic-opening",
        subjectId: player.id,
      }),
    );
    expect(operations).toHaveLength(MOODY_RUNTIME_COMMAND_KINDS.length);
    expect(operations.every(operation => operation.kind !== "persist-state")).toBe(true);
    expect(new Set(operations.flatMap(operation => ("command" in operation ? [operation.command.kind] : [])))).toEqual(
      new Set(MOODY_RUNTIME_COMMAND_KINDS),
    );
  });

  it("appends one atomic persistence operation after translated commands", () => {
    const command: MoodyRuntimeCommand = {
      kind: "heal",
      effectId: "eye-of-the-storm",
      subjectId: player.id,
      fraction: 0.3,
    };
    const result: MoodyRuntimeFieldResult = {
      state: { numbers: { counter: 1 }, values: {}, lists: {} },
      deltas: [{ op: "set-number", key: "counter", value: 1 }],
      commands: [command],
      triggeredEffectIds: ["eye-of-the-storm"],
    };
    const operations = translateMoodyRuntimeResult(result);
    expect(operations.map(operation => operation.kind)).toEqual(["vital", "persist-state"]);
    expect(operations[1]).toEqual(
      expect.objectContaining({
        kind: "persist-state",
        state: result.state,
        deltas: result.deltas,
      }),
    );
  });
});

describe("Moody runtime save contract", () => {
  const moodSave: MoodyModeSaveData = {
    version: 1,
    seed: 42,
    acquisitionRolls: 4,
    draftIndex: 2,
    boons: [],
    curses: [],
    recentThreat: [],
  };

  it("round-trips sorted counters, flags, values, and lists through MoodyModeSaveData", () => {
    const runtimeState = {
      numbers: { "persistent:z": 2, "battle:100:4:a": 1 },
      values: { "persistent:flag": true, "persistent:value": "rain" },
      lists: { "persistent:list": ["poison", "burn"] },
    };
    const saved = serializeMoodyRuntimeFieldState(runtimeState, {
      battleId: battle.battleId,
      waveIndex: battle.waveIndex,
      turn: battle.turn,
      segmentIndex: 10,
      biomeId: battle.biomeId,
      biomeEpoch: battle.biomeEpoch,
    });
    const attached = attachMoodyRuntimeFieldSave(moodSave, saved);
    const extracted = extractMoodyRuntimeFieldSave(attached);

    expect(extracted?.numbers.map(([key]) => key)).toEqual(["battle:100:4:a", "persistent:z"]);
    expect(deserializeMoodyRuntimeFieldState(extracted)).toEqual(runtimeState);
    expect(moodSave).not.toHaveProperty("fieldRuntime");
  });

  it("prunes state at battle, segment, biome, and run reset cadences", () => {
    const runtimeState = {
      numbers: {
        "battle:old:counter": 1,
        "battle:new:counter": 2,
        "boss:battle:old:used": 1,
        "segment:9:used": 1,
        "segment:10:used": 2,
        "biome:2:used": 1,
        "biome:3:used": 2,
        "persistent:debt": 40,
      },
      values: {},
      lists: {},
    };

    const battleReset = resetMoodyRuntimeFieldState(runtimeState, {
      kind: "battle-start",
      battleId: "battle:new",
      waveIndex: 100,
      segmentIndex: 10,
      biomeEpoch: 3,
    });
    expect(Object.keys(battleReset.numbers)).toEqual([
      "battle:new:counter",
      "segment:10:used",
      "biome:3:used",
      "persistent:debt",
    ]);

    const segmentReset = resetMoodyRuntimeFieldState(runtimeState, {
      kind: "segment-start",
      segmentIndex: 10,
      biomeEpoch: 3,
    });
    expect(Object.keys(segmentReset.numbers)).toEqual(["segment:10:used", "biome:3:used", "persistent:debt"]);

    const biomeReset = resetMoodyRuntimeFieldState(runtimeState, {
      kind: "biome-transition",
      biomeEpoch: 3,
      segmentIndex: 10,
    });
    expect(Object.keys(biomeReset.numbers)).toEqual(["segment:10:used", "biome:3:used", "persistent:debt"]);
    expect(resetMoodyRuntimeFieldState(runtimeState, { kind: "run-end" })).toEqual(createMoodyRuntimeFieldState());
  });
});

describe("Moody parent hook manifest", () => {
  it("names every reducer event exactly once or more through concrete existing symbols", () => {
    const hookedKinds = new Set(MOODY_RUNTIME_FIELD_HOOK_SITES.flatMap(site => site.events));
    expect(hookedKinds).toEqual(
      new Set([
        "battle-start",
        "battle-end",
        "entry",
        "before-move",
        "move-resolved",
        "before-damage",
        "after-damage",
        "heal",
        "status-attempt",
        "status-applied",
        "status-cured",
        "volatile-attempt",
        "volatile-applied",
        "weather-transition",
        "barrier-ended",
        "turn-start",
        "turn-end",
        "action-resolved",
        "faint",
        "ko",
        "switch-attempt",
        "lead-selection",
        "battle-won",
        "biome-transition",
        "encounter-generate",
        "boon-draft",
      ]),
    );
    expect(MOODY_RUNTIME_FIELD_HOOK_SITES.every(site => site.path.startsWith("src/") && site.anchor.length > 0)).toBe(
      true,
    );
  });
});
