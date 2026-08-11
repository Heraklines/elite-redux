import type {
  MoodyFormationCommand,
  MoodyFormationEffect,
  MoodyFormationEvent,
  MoodyFormationPokemonSnapshot,
} from "#data/elite-redux/moody/moody-runtime-formation";
import {
  buildMoodyFormationPartySnapshot,
  createMoodyFormationRuntimeSession,
  dispatchMoodyFormationEvent,
  executeMoodyFormationCommand,
  hydrateMoodyFormationRuntimeSession,
  MOODY_FORMATION_COMMAND_EXECUTION_MAP,
  MOODY_FORMATION_HOOK_MAP,
  MOODY_FORMATION_PERSISTENCE_CONTRACT,
  MOODY_FORMATION_SAVE_VERSION,
  type MoodyFormationCommandHandlers,
  type MoodyFormationCommandPort,
  type MoodyFormationRuntimeSession,
  resetMoodyFormationRuntimeSession,
  serializeMoodyFormationRuntimeSession,
} from "#data/elite-redux/moody/moody-runtime-formation-adapter";
import { describe, expect, it } from "vitest";

const pokemon: MoodyFormationPokemonSnapshot = {
  pokemonId: 10,
  partySlot: 0,
  currentHp: 75,
  maxHp: 100,
  conscious: true,
  positiveStages: { attack: 2 },
  negativeStages: { speed: -1 },
  highestOffensiveStat: "attack",
  highestNonHpStat: "attack",
  highestDefensiveStat: "defense",
  mostDepletedMoveId: 42,
  allPpFull: false,
};

const party = buildMoodyFormationPartySnapshot([pokemon]);

function effect(instanceId: string, boonId: MoodyFormationEffect["boonId"]): MoodyFormationEffect {
  return {
    instanceId,
    boonId,
    rank: 1,
    target: {
      pokemonIds: [pokemon.pokemonId],
      partySlots: [pokemon.partySlot],
      moveIds: [42],
      itemStackIds: ["berry:10"],
      elementalType: "fire",
      moveTag: "punch",
    },
  };
}

function recordingPort(options: { failAt?: number } = {}): {
  port: MoodyFormationCommandPort;
  preflighted: MoodyFormationCommand[];
  executed: MoodyFormationCommand[];
} {
  const preflighted: MoodyFormationCommand[] = [];
  const executed: MoodyFormationCommand[] = [];
  const handlers = Object.fromEntries(
    COMMAND_KINDS.map(kind => [kind, (command: MoodyFormationCommand) => executed.push(command)]),
  ) as unknown as MoodyFormationCommandHandlers;
  return {
    preflighted,
    executed,
    port: {
      preflight(command) {
        const index = preflighted.push(command) - 1;
        return index === options.failAt ? { ok: false, reason: "test rejection" } : { ok: true };
      },
      handlers,
    },
  };
}

const COMMAND_SAMPLES = [
  { kind: "modify-action", source: "crowned-vanguard", pokemonId: 10, damageMultiplier: 1.2 },
  { kind: "heal", source: "hungry-seat", pokemonId: 10, maxHpFraction: 0.1 },
  { kind: "barrier", source: "bastion-seat", pokemonId: 10, maxHpFraction: 0.1 },
  { kind: "restore-pp", source: "deep-reservoir", pokemonId: 10, moveId: 42, amount: 1 },
  { kind: "stat-stage", source: "relay-seat", pokemonId: 10, stat: "attack", stages: 1 },
  { kind: "clear-negative-stage", source: "twin-sigil", pokemonId: 10, count: 1 },
  { kind: "clear-volatile", source: "sanctuary-seat", pokemonId: 10, count: "all" },
  { kind: "clear-status", source: "sanctuary-seat", pokemonId: 10 },
  { kind: "forced-switch-immunity", source: "hold-the-line", pokemonId: 10, duration: "while-active" },
  { kind: "echo", source: "echo-seat", pokemonId: 10, powerFraction: 0.25 },
  { kind: "negate", source: "sanctuary-seat", event: "status" },
  { kind: "survive", source: "survivor-s-pride", pokemonId: 10, hp: 1 },
  { kind: "experience-multiplier", source: "quiet-mentor", pokemonId: 10, multiplier: 1.2 },
  {
    kind: "max-hp-and-damage",
    source: "empty-throne",
    pokemonId: 10,
    maxHpMultiplier: 1.1,
    damageMultiplier: 1.1,
    speedMultiplier: 1,
    preserveCurrentHp: true,
  },
  {
    kind: "copy-secondary",
    source: "relay-seat",
    pokemonId: 10,
    secondaryId: "burn",
    uses: 1,
    guaranteed: true,
  },
  { kind: "status-resistance", source: "mithridatism", pokemonId: 10, status: "burn", tier: 1 },
  {
    kind: "amplify-item",
    source: "heirloom-bearer",
    pokemonId: 10,
    itemStackId: "berry:10",
    multiplier: 2,
    protected: true,
    adapter: "magnitude",
    repeatActivation: false,
  },
  { kind: "max-pp", source: "deep-reservoir", pokemonId: 10, flatDelta: 2, allMoves: true },
  {
    kind: "repertoire-reward",
    source: "full-repertoire",
    pokemonId: 10,
    reward: "heal",
    magnitudeMultiplier: 1,
  },
  {
    kind: "choice-required",
    source: "final-draft",
    choice: "final-draft",
    options: ["climax", "precision"],
    chooseCount: 1,
  },
  { kind: "disable-move", source: "final-draft", pokemonId: 10, moveId: 42, duration: "battle" },
  { kind: "mark", source: "turntable", name: "tempo", value: 1, pokemonId: 10 },
] as const satisfies readonly MoodyFormationCommand[];

const COMMAND_KINDS = COMMAND_SAMPLES.map(command => command.kind);

const EVENT_TYPES = [
  "battle-start",
  "battle-end",
  "wave-start",
  "biome-start",
  "turn-start",
  "turn-complete",
  "entry",
  "switch",
  "exit",
  "move-attempt",
  "move-resolved",
  "damage-received",
  "lethal-check",
  "knockout",
  "fainted",
  "final-conscious",
  "status-directed",
  "stat-drop-directed",
  "status-cured",
  "enemy-stat-increase",
  "item-activation",
  "opponent-move",
  "evaluate",
] as const satisfies readonly MoodyFormationEvent["type"][];

describe("Moody formation runtime adapter", () => {
  it("dispatches active effects in stable acquisition order", () => {
    const original = createMoodyFormationRuntimeSession([
      effect("later", "empty-throne"),
      effect("earlier", "empty-throne"),
    ]);
    const reversed: MoodyFormationRuntimeSession = {
      ...original,
      bindings: [
        { ...original.bindings[1], acquisitionOrder: 0 },
        { ...original.bindings[0], acquisitionOrder: 1 },
      ],
    };
    const recorder = recordingPort();
    const result = dispatchMoodyFormationEvent(reversed, { type: "evaluate", pokemon, party, turn: 1 }, recorder.port);

    expect(result.commands.map(command => command.effectInstanceId)).toEqual(["earlier", "later"]);
    expect(recorder.executed).toHaveLength(2);
    expect(reversed.bindings[0].state).toEqual({ counters: {}, flags: {}, values: {}, lists: {} });
  });

  it("preflights the complete batch before executing any command", () => {
    const session = createMoodyFormationRuntimeSession([effect("one", "empty-throne"), effect("two", "empty-throne")]);
    const recorder = recordingPort({ failAt: 1 });

    expect(() =>
      dispatchMoodyFormationEvent(session, { type: "evaluate", pokemon, party, turn: 1 }, recorder.port),
    ).toThrow("failed preflight: test rejection");
    expect(recorder.preflighted).toHaveLength(2);
    expect(recorder.executed).toHaveLength(0);
    expect(session.sequence).toBe(0);
  });

  it("does not resolve inactive bindings", () => {
    const session = createMoodyFormationRuntimeSession([effect("inactive", "empty-throne")]);
    session.bindings[0].active = false;
    const recorder = recordingPort();
    const result = dispatchMoodyFormationEvent(session, { type: "evaluate", pokemon, party, turn: 1 }, recorder.port);

    expect(result.commands).toEqual([]);
    expect(result.traces[0]).toMatchObject({ effectInstanceId: "inactive", triggered: false });
  });

  it("rejects duplicate effect instance identities", () => {
    expect(() =>
      createMoodyFormationRuntimeSession([effect("same", "scar-reader"), effect("same", "echo-seat")]),
    ).toThrow("Duplicate Moody formation effect instance");
  });

  it("routes every command kind through its required handler", () => {
    const recorder = recordingPort();
    for (const [commandIndex, command] of COMMAND_SAMPLES.entries()) {
      executeMoodyFormationCommand(recorder.port, command, {
        sequence: 4,
        commandIndex,
        effectInstanceId: `effect-${commandIndex}`,
        event: { type: "turn-start", turn: 2 },
      });
    }

    expect(recorder.executed).toEqual(COMMAND_SAMPLES);
    expect(new Set(COMMAND_KINDS).size).toBe(COMMAND_SAMPLES.length);
  });

  it("round-trips live counters through JSON and produces the same next result", () => {
    const event: Extract<MoodyFormationEvent, { type: "damage-received" }> = {
      type: "damage-received",
      target: pokemon,
      sourcePokemonId: 99,
      moveType: "fire",
      direct: true,
    };
    const recorder = recordingPort();
    const first = dispatchMoodyFormationEvent(
      createMoodyFormationRuntimeSession([effect("scar", "scar-reader")]),
      event,
      recorder.port,
    );
    expect(first.commands).toEqual([]);

    const saved = serializeMoodyFormationRuntimeSession(first.session);
    const reloaded = hydrateMoodyFormationRuntimeSession(JSON.parse(JSON.stringify(saved)));
    const uninterrupted = dispatchMoodyFormationEvent(first.session, event, recordingPort().port);
    const afterReload = dispatchMoodyFormationEvent(reloaded, event, recordingPort().port);

    expect(afterReload).toEqual(uninterrupted);
    expect(afterReload.commands[0].command).toMatchObject({
      kind: "modify-action",
      incomingDamageMultiplier: 0.75,
    });
    expect(saved.version).toBe(MOODY_FORMATION_SAVE_VERSION);
    expect(MOODY_FORMATION_PERSISTENCE_CONTRACT.field).toBe("formationRuntime");
  });

  it("applies only the documented blanket reset cadences", () => {
    const session = createMoodyFormationRuntimeSession([effect("scar", "scar-reader")]);
    const withState: MoodyFormationRuntimeSession = {
      ...session,
      sequence: 8,
      bindings: session.bindings.map(binding => ({
        ...binding,
        state: {
          counters: { "battle.turn": 3, lifetime: 7 },
          flags: { "battle.used": true, retained: true },
          values: { "battle.type": "fire", inherited: "water" },
          lists: { "battle.moves": ["1"], archive: ["2"] },
        },
      })),
    };

    const battleReset = resetMoodyFormationRuntimeSession(withState, "battle");
    expect(battleReset.bindings[0].state).toEqual({
      counters: { lifetime: 7 },
      flags: { retained: true },
      values: { inherited: "water" },
      lists: { archive: ["2"] },
    });
    for (const boundary of ["turn", "wave", "biome"] as const) {
      expect(resetMoodyFormationRuntimeSession(withState, boundary)).toEqual(
        serializeMoodyFormationRuntimeSession(withState),
      );
    }
    expect(resetMoodyFormationRuntimeSession(withState, "run")).toMatchObject({
      sequence: 0,
      bindings: [{ state: { counters: {}, flags: {}, values: {}, lists: {} } }],
    });
  });

  it("builds stable sparse party snapshots without sharing stage records", () => {
    const source = { ...pokemon, partySlot: 2, positiveStages: { attack: 1 } };
    const snapshot = buildMoodyFormationPartySnapshot([source], 4);
    source.positiveStages.attack = 6;

    expect(snapshot.slots).toEqual([null, null, { ...pokemon, partySlot: 2, positiveStages: { attack: 1 } }, null]);
    expect(() => buildMoodyFormationPartySnapshot([source, { ...source, pokemonId: 11 }], 4)).toThrow(
      "Duplicate Moody formation party slot",
    );
  });

  it("publishes hooks for every event and command kind", () => {
    const mappedEvents = new Set(MOODY_FORMATION_HOOK_MAP.flatMap(hook => hook.events));
    const mappedCommands = new Set(MOODY_FORMATION_HOOK_MAP.flatMap(hook => hook.commands));
    expect([...mappedEvents].sort()).toEqual([...EVENT_TYPES].sort());
    expect([...mappedCommands].sort()).toEqual([...COMMAND_KINDS].sort());
    expect(MOODY_FORMATION_COMMAND_EXECUTION_MAP.map(entry => entry.kind).sort()).toEqual([...COMMAND_KINDS].sort());
    expect(new Set(MOODY_FORMATION_COMMAND_EXECUTION_MAP.map(entry => entry.kind)).size).toBe(COMMAND_KINDS.length);
    expect(new Set(MOODY_FORMATION_HOOK_MAP.map(hook => hook.id)).size).toBe(MOODY_FORMATION_HOOK_MAP.length);
    for (const hook of MOODY_FORMATION_HOOK_MAP) {
      expect(hook.file).toMatch(/^src\//);
      expect(hook.symbol.length).toBeGreaterThan(0);
      expect(hook.anchor.length).toBeGreaterThan(0);
    }
  });
});
