import type {
  MoodyRuntimeCommand,
  MoodyRuntimeFieldEvent,
  MoodyRuntimeFieldState,
  MoodyRuntimeStatus,
} from "#data/elite-redux/moody/moody-runtime-field";
import { createMoodyRuntimeFieldState, resolveMoodyRuntimeField } from "#data/elite-redux/moody/moody-runtime-field";
import {
  consumeMoodyRuntimeActionTriggerIds,
  didMoodyDamageCrossHpFraction,
  MOODY_RUNTIME_COMMAND_KINDS,
  recordMoodyRuntimeActionTriggerIds,
} from "#data/elite-redux/moody/moody-runtime-field-adapter";
import {
  applyMoodyRuntimeDamageCommandValues,
  consumeMoodyRuntimePendingCommands,
  cureMoodyStatusImmediately,
  doesMoodyMoveRaiseUserStats,
  executeMoodyRuntimeCommands,
  getMoodyRuntimeSpeedMultiplier,
  getMoodyRuntimeTriggerLabels,
  getMoodyRuntimeTriggerResolutionKey,
  isLegalMoodyEntropyReplacement,
  isMoodyDreamTaggedMove,
  isMoodyRuntimeCommandOwnedByPassive,
  MOODY_RUNTIME_COMMAND_CONSUMERS,
  MOODY_RUNTIME_DEFERRED_COMMAND_HOOKS,
  MOODY_RUNTIME_EVENT_HOOKS,
  MOODY_RUNTIME_PASSIVE_OVERLAP,
  type MoodyRuntimeExecutionPort,
  resolveMoodyFaintLaneOrder,
  restoreMoodyPp,
  shouldMoodyRuntimeProcessFullHpHeal,
} from "#data/elite-redux/moody/moody-runtime-field-engine";
import { createMoodyModeState, resetMoodyModeState, restoreMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance, MoodyCurseInstance } from "#data/elite-redux/moody/moody-types";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#app/global-scene", () => ({ globalScene: {} }));

afterEach(() => resetMoodyModeState());

interface FakePokemon {
  id: number;
  hp: number;
  maxHp: number;
  pp: number;
  status?: MoodyRuntimeStatus;
  stages: Record<string, number>;
  extraHealthSegments?: number;
}

function fakePort(pokemon: FakePokemon[]): MoodyRuntimeExecutionPort<FakePokemon> {
  return {
    getPokemon: id => pokemon.find(candidate => candidate.id === id),
    id: target => target.id,
    resolveTargets: runtimeCommand => {
      const ids = runtimeCommand.targetIds ?? (runtimeCommand.subjectId == null ? [] : [runtimeCommand.subjectId]);
      return ids.map(id => pokemon.find(candidate => candidate.id === id)).filter(candidate => candidate != null);
    },
    side: () => "player",
    currentHp: target => target.hp,
    maxHp: target => target.maxHp,
    heal: (target, amount) => {
      target.hp = Math.min(target.maxHp, target.hp + amount);
    },
    damage: (target, amount, nonlethal) => {
      target.hp = Math.max(nonlethal ? 1 : 0, target.hp - amount);
    },
    restorePp: (target, amount) => {
      target.pp += amount;
    },
    consumePp: (target, amount) => {
      target.pp = Math.max(0, target.pp - amount);
    },
    applyStatus: (target, status) => {
      target.status = status;
    },
    cureStatus: target => {
      delete target.status;
    },
    clearNegativeStages: (target, amount) => {
      let remaining = amount;
      target.stages = Object.fromEntries(
        Object.entries(target.stages).map(([stat, value]) => {
          const recovered = Math.min(Math.max(0, -value), remaining);
          remaining -= recovered;
          return [stat, value + recovered];
        }),
      );
    },
    modifyStat: (target, stat, stages) => {
      target.stages[stat] = (target.stages[stat] ?? 0) + stages;
    },
    revive: (target, fraction, extraHealthSegments = 0, allStatStages = 0, clearStatusAndNegativeStages = false) => {
      if (target.hp === 0) {
        target.hp = Math.max(1, Math.floor(target.maxHp * fraction));
        target.extraHealthSegments = extraHealthSegments;
        for (const stat of ["attack", "defense", "special-attack", "special-defense", "speed"]) {
          target.stages[stat] = Math.max(target.stages[stat] ?? 0, allStatStages);
        }
        if (clearStatusAndNegativeStages) {
          delete target.status;
          target.stages = Object.fromEntries(
            Object.entries(target.stages).map(([stat, value]) => [stat, Math.max(0, value)]),
          );
        }
      }
    },
    setWeather: () => undefined,
    setTerrain: () => undefined,
    shortenStatus: () => undefined,
    shortenVolatile: () => undefined,
    clearVolatiles: () => undefined,
    applyDirectionalScreen: () => undefined,
    carryFieldState: () => undefined,
    grantTemporaryMove: () => undefined,
    grantTemporaryAbility: () => undefined,
    replaceMoveTemporarily: () => undefined,
    resetToxicCounter: () => undefined,
    setBoonDormancy: () => undefined,
  };
}

const EMPTY_STATE: MoodyRuntimeFieldState = { numbers: {}, values: {}, lists: {} };

it("keeps pre-battle stat reads inert before currentBattle exists", () => {
  expect(getMoodyRuntimeSpeedMultiplier({ id: 99 } as Pokemon)).toBe(1);
});

const PLAYER = {
  id: 1,
  side: "player" as const,
  partySlot: 0,
  currentHp: 1,
  maxHp: 100,
  status: "toxic" as const,
  moveCount: 4,
  moveIds: [String(MoveId.TACKLE)],
};
const { status: _playerStatus, ...playerWithoutStatus } = PLAYER;
const ENEMY = { ...playerWithoutStatus, id: 2, side: "enemy" as const, currentHp: 100 };
const EVENT_BASE = { battleId: "semantic", waveIndex: 60, turn: 3, seed: 42 } as const;

function runtimeBoon(boonId: string, rank: 1 | 2 | 3 = 1, evolutionId?: string): MoodyBoonInstance {
  return {
    instanceId: `${boonId}:live`,
    boonId,
    rank,
    ...(evolutionId == null ? {} : { evolutionId }),
    acquiredAtWave: 1,
    target: { pokemonIds: [PLAYER.id], partySlots: [PLAYER.partySlot] },
  };
}

function runtimeCurse(curseId: string): MoodyCurseInstance {
  return { curseId, acquiredAtWave: 1 };
}

function command(
  kind: MoodyRuntimeCommand["kind"],
  extra: Omit<MoodyRuntimeCommand, "kind" | "effectId"> = {},
): MoodyRuntimeCommand {
  return { kind, effectId: "aftercare", ...extra };
}

describe("Moody live field engine", () => {
  it("keeps full-HP healing events alive only for applicable overflow mechanics", () => {
    const state = createMoodyModeState("full-hp-overflow");
    state.boons = [runtimeBoon("overflow-ward")];
    expect(restoreMoodyModeState(state)).toBe(true);

    const target = { id: PLAYER.id, isPlayer: () => true } as Pokemon;
    const other = { id: PLAYER.id + 99, isPlayer: () => true } as Pokemon;
    expect(shouldMoodyRuntimeProcessFullHpHeal(target)).toBe(true);
    expect(shouldMoodyRuntimeProcessFullHpHeal(other)).toBe(false);

    state.boons[0].rank = 3;
    state.boons[0].evolutionId = "overflow-doctrine";
    expect(restoreMoodyModeState(state)).toBe(true);
    expect(shouldMoodyRuntimeProcessFullHpHeal(other)).toBe(true);
  });

  it("builds exact live trigger labels and one dedupe key for every resolution in an action", () => {
    expect(
      getMoodyRuntimeTriggerLabels(
        {
          boons: [runtimeBoon("guarded-setup", 2, "offensive-guard")],
          curses: [runtimeCurse("feedback-loop")],
        },
        ["guarded-setup", "guarded-setup", "feedback-loop"],
      ),
    ).toEqual(["Offensive Guard II", "Feedback Loop"]);

    const beforeMove = {
      ...EVENT_BASE,
      kind: "before-move" as const,
      user: PLAYER,
      moveId: String(MoveId.CALM_MIND),
      moveType: "psychic",
      category: "status" as const,
      damaging: false,
      actionId: "action:shared",
    };
    const moveResolved = {
      ...beforeMove,
      kind: "move-resolved" as const,
      landed: true,
      dealtDirectDamage: false,
    };
    const damage = {
      ...EVENT_BASE,
      kind: "after-damage" as const,
      source: PLAYER,
      target: ENEMY,
      direct: true,
      amount: 10,
      barrierAbsorbed: 0,
      hpAfter: 90,
    };

    expect(getMoodyRuntimeTriggerResolutionKey(beforeMove)).toBe(getMoodyRuntimeTriggerResolutionKey(moveResolved));
    expect(getMoodyRuntimeTriggerResolutionKey(damage, "action:shared")).toBe(
      getMoodyRuntimeTriggerResolutionKey(beforeMove),
    );
  });

  it("derives the live move facts consumed by Offensive Guard and Lucid Dreamer", () => {
    const raisingMove = {
      id: MoveId.CALM_MIND,
      getAttrs: () => [
        { selfTarget: true, getLevels: () => 1 },
        { selfTarget: false, getLevels: () => 2 },
      ],
    } as unknown as Move;
    const hostileDrop = {
      id: MoveId.GROWL,
      getAttrs: () => [{ selfTarget: false, getLevels: () => -1 }],
    } as unknown as Move;

    expect(doesMoodyMoveRaiseUserStats(PLAYER as unknown as Pokemon, raisingMove)).toBe(true);
    expect(doesMoodyMoveRaiseUserStats(PLAYER as unknown as Pokemon, hostileDrop)).toBe(false);
    expect(isMoodyDreamTaggedMove({ id: MoveId.DREAM_EATER } as Move)).toBe(true);
    expect(isMoodyDreamTaggedMove({ id: ErMoveId.DREAM_INVERSION } as unknown as Move)).toBe(true);
    expect(isMoodyDreamTaggedMove({ id: MoveId.TACKLE } as Move)).toBe(false);

    const offensiveGuard = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [runtimeBoon("guarded-setup", 1, "offensive-guard")],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...EVENT_BASE,
        kind: "before-move",
        user: PLAYER,
        moveId: String(raisingMove.id),
        moveType: "psychic",
        category: "status",
        damaging: false,
        raisesStats: doesMoodyMoveRaiseUserStats(PLAYER as unknown as Pokemon, raisingMove),
        actionId: "action:offensive-guard",
      },
    });
    expect(offensiveGuard.commands).toContainEqual(
      expect.objectContaining({ kind: "queue-next-move-power", multiplier: 1.2 }),
    );

    const lucidDreamer = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [runtimeBoon("insomniac-dreams", 1, "lucid-dreamer")],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...EVENT_BASE,
        kind: "before-move",
        user: PLAYER,
        moveId: String(ErMoveId.DREAM_INVERSION),
        moveType: "normal",
        category: "special",
        damaging: true,
        asleep: true,
        dreamTagged: isMoodyDreamTaggedMove({ id: ErMoveId.DREAM_INVERSION } as unknown as Move),
        actionId: "action:lucid-dreamer",
      },
    });
    expect(lucidDreamer.commands).toContainEqual(expect.objectContaining({ kind: "allow-move-while-asleep" }));
    expect(lucidDreamer.commands).toContainEqual(expect.objectContaining({ kind: "modify-damage", multiplier: 0.5 }));
  });

  it("turns the derived quarter-HP crossing into Emergency Shell's production commands", () => {
    const crossedQuarterHp = didMoodyDamageCrossHpFraction({ hpBefore: 80, hpAfter: 20, maxHp: 100 });
    const reduced = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [runtimeBoon("emergency-shell")],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...EVENT_BASE,
        kind: "after-damage",
        source: ENEMY,
        target: { ...PLAYER, currentHp: 20 },
        direct: true,
        amount: 60,
        barrierAbsorbed: 0,
        hpAfter: 20,
        crossedQuarterHp,
      },
    });

    expect(reduced.commands).toContainEqual(expect.objectContaining({ kind: "clear-negative-stages" }));
    expect(reduced.commands).toContainEqual(expect.objectContaining({ kind: "apply-barrier", fraction: 0.2 }));
  });

  it("feeds deduplicated cross-lane trigger totals to Feedback Loop once", () => {
    const field = recordMoodyRuntimeActionTriggerIds(createMoodyRuntimeFieldState(), EVENT_BASE.battleId, PLAYER.id, [
      "prismatic-opening",
      "elemental-dividend",
    ]);
    const allLanes = recordMoodyRuntimeActionTriggerIds(field, EVENT_BASE.battleId, PLAYER.id, [
      "prismatic-opening",
      "tag-combo",
    ]);
    const aggregate = consumeMoodyRuntimeActionTriggerIds(allLanes, EVENT_BASE.battleId, PLAYER.id);
    const reduced = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [runtimeCurse("feedback-loop")],
      state: aggregate.state,
      event: {
        ...EVENT_BASE,
        kind: "action-resolved",
        actor: PLAYER,
        actionId: "action:aggregate",
        boonTriggerCount: aggregate.effectIds.length,
        removableNegativeCount: 0,
      },
    });

    expect(aggregate.effectIds).toEqual(["prismatic-opening", "elemental-dividend", "tag-combo"]);
    expect(reduced.commands).toEqual([
      expect.objectContaining({ kind: "nonlethal-damage", fraction: 0.1, subjectId: PLAYER.id }),
    ]);
  });

  it("registers exactly one consumer for every command and one hook for every event", () => {
    expect(Object.keys(MOODY_RUNTIME_COMMAND_CONSUMERS).toSorted()).toEqual(
      [...MOODY_RUNTIME_COMMAND_KINDS].toSorted(),
    );
    const eventKinds: MoodyRuntimeFieldEvent["kind"][] = [
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
    ];
    expect(Object.keys(MOODY_RUNTIME_EVENT_HOOKS).toSorted()).toEqual(eventKinds.toSorted());
    expect(Object.keys(MOODY_RUNTIME_DEFERRED_COMMAND_HOOKS).toSorted()).toEqual(
      [
        "modify-damage",
        "cap-damage",
        "split-damage",
        "set-move-type",
        "ignore-weather-penalty",
        "treat-as-weather-boosted",
        "modify-priority",
        "modify-speed",
        "ignore-burn-attack-penalty",
        "modify-burn-damage",
        "allow-move-while-asleep",
        "request-weather-choice",
        "request-terrain-choice",
        "modify-field-strength",
        "guarantee-secondary-effect",
        "increase-secondary-chance",
        "ignore-defense-fraction",
        "request-temporary-move-choice",
        "execute-committed-move",
        "invalidate-lead",
        "hide-enemy-information",
        "set-enemy-roster-size",
        "set-counter-weight",
        "apply-enemy-stat-multiplier",
        "conceal-boon-offer",
        "queue-next-move-power",
      ].toSorted(),
    );
  });

  it("executes representative live HP, PP, status, stat, revive, and barrier operations", () => {
    const pokemon: FakePokemon[] = [
      { id: 1, hp: 40, maxHp: 100, pp: 5, status: "burn", stages: { attack: -2 } },
      { id: 2, hp: 0, maxHp: 80, pp: 3, stages: {} },
    ];
    const result = executeMoodyRuntimeCommands(
      [
        command("heal", { subjectId: 1, amount: 20 }),
        command("restore-pp", { subjectId: 1, amount: 2 }),
        command("cure-status", { subjectId: 1 }),
        command("clear-negative-stages", { subjectId: 1 }),
        command("modify-stat", { subjectId: 1, value: "speed", amount: 1 }),
        command("revive", { subjectId: 2, fraction: 0.25 }),
        command("apply-barrier", { subjectId: 1, fraction: 0.3 }),
        command("prevent-status", { subjectId: 1 }),
      ],
      EMPTY_STATE,
      "battle-a",
      fakePort(pokemon),
    );
    expect(pokemon[0]).toMatchObject({ hp: 60, pp: 7, stages: { attack: 0, speed: 1 } });
    expect(pokemon[0].status).toBeUndefined();
    expect(pokemon[1].hp).toBe(20);
    expect(result.state.numbers["battle-a:runtime-barrier:pokemon:1:amount"]).toBe(30);
    expect(result.preventedStatusPokemonIds.has(1)).toBe(true);
  });

  it("executes battle-end cures immediately instead of queuing a disposable phase", () => {
    const resetStatus = vi.fn();
    cureMoodyStatusImmediately({ resetStatus } as unknown as Pick<Pokemon, "resetStatus">);
    expect(resetStatus).toHaveBeenCalledExactlyOnceWith(false, false, false, false);
  });

  it("allocates total PP restoration to the most depleted moves", () => {
    const moves = [
      { ppUsed: 8, getMovePp: () => 10 },
      { ppUsed: 3, getMovePp: () => 5 },
      { ppUsed: 1, getMovePp: () => 20 },
    ];
    restoreMoodyPp(moves, 5, "most-depleted");
    expect(moves.map(move => move.ppUsed)).toEqual([3, 3, 1]);
  });

  it("splits Communion healing and enforces barrier caps and Reservoir decay floors", () => {
    const pokemon: FakePokemon[] = [
      { id: 1, hp: 20, maxHp: 100, pp: 0, stages: {} },
      { id: 2, hp: 30, maxHp: 100, pp: 0, stages: {} },
    ];
    const port = fakePort(pokemon);
    const healed = executeMoodyRuntimeCommands(
      [command("heal", { targetIds: [1, 2], amount: 40, data: { distributeEvenly: true } })],
      EMPTY_STATE,
      "battle-distribution",
      port,
    );
    expect(pokemon.map(target => target.hp)).toEqual([40, 50]);

    const capped = executeMoodyRuntimeCommands(
      [command("apply-barrier", { subjectId: 1, amount: 80, data: { capMaxHpFraction: 0.6 } })],
      healed.state,
      "battle-distribution",
      port,
    );
    expect(capped.state.numbers["battle-distribution:runtime-barrier:pokemon:1:amount"]).toBe(60);

    const decayed = executeMoodyRuntimeCommands(
      [command("decay-barrier", { subjectId: 1, fraction: 0.1, data: { onlyAboveMaxHpFraction: 0.4 } })],
      capped.state,
      "battle-distribution",
      port,
    );
    expect(decayed.state.numbers["battle-distribution:runtime-barrier:pokemon:1:amount"]).toBe(50);
  });

  it("converts Compound Elements overflow into healing and then next-move power", () => {
    const pokemon: FakePokemon[] = [{ id: 1, hp: 90, maxHp: 100, pp: 0, stages: {} }];
    const port = fakePort(pokemon);
    const existing = executeMoodyRuntimeCommands(
      [command("apply-barrier", { subjectId: 1, amount: 90 })],
      EMPTY_STATE,
      "battle-compound",
      port,
    );
    const converted = executeMoodyRuntimeCommands(
      [command("apply-barrier", { subjectId: 1, amount: 40, data: { overflowToHealingAndPower: true } })],
      existing.state,
      "battle-compound",
      port,
    );
    expect(pokemon[0].hp).toBe(100);
    expect(converted.state.numbers["battle-compound:runtime-barrier:pokemon:1:amount"]).toBe(100);
    expect(converted.state.numbers["battle-compound:runtime-action:pokemon:1:next-power"]).toBe(1.2);
  });

  it("records Safe Preparation's one-status block on its live barrier", () => {
    const pokemon: FakePokemon[] = [{ id: 1, hp: 100, maxHp: 100, pp: 0, stages: {} }];
    const result = executeMoodyRuntimeCommands(
      [command("apply-barrier", { subjectId: 1, amount: 20, data: { blocksNextStatus: true } })],
      EMPTY_STATE,
      "battle-safe-preparation",
      fakePort(pokemon),
    );
    expect(result.state.numbers["battle-safe-preparation:runtime-barrier:pokemon:1:blocks-next-status"]).toBe(1);
  });

  it("uses current HP for Oathbound and lets Debt Restructuring barriers absorb collection", () => {
    const pokemon: FakePokemon[] = [{ id: 1, hp: 40, maxHp: 100, pp: 0, stages: {} }];
    const port = fakePort(pokemon);
    executeMoodyRuntimeCommands(
      [command("nonlethal-damage", { subjectId: 1, fraction: 0.2, data: { basis: "current-hp" } })],
      EMPTY_STATE,
      "battle-debt",
      port,
    );
    expect(pokemon[0].hp).toBe(32);

    const barrier = executeMoodyRuntimeCommands(
      [command("apply-barrier", { subjectId: 1, amount: 20 })],
      EMPTY_STATE,
      "battle-debt",
      port,
    );
    const collected = executeMoodyRuntimeCommands(
      [command("collect-damage-debt", { subjectId: 1, amount: 30, data: { barriersMayAbsorb: true } })],
      barrier.state,
      "battle-debt",
      port,
    );
    expect(pokemon[0].hp).toBe(22);
    expect(collected.state.numbers["battle-debt:runtime-barrier:pokemon:1:amount"]).toBe(0);
  });

  it("honors revival cleanup flags for Phoenix Clause and Blood Moon", () => {
    const pokemon: FakePokemon[] = [
      { id: 1, hp: 0, maxHp: 100, pp: 0, status: "burn", stages: { attack: -2, speed: 1 } },
    ];
    executeMoodyRuntimeCommands(
      [command("revive", { subjectId: 1, fraction: 0.4, data: { clearStatusAndNegativeStages: true } })],
      EMPTY_STATE,
      "battle-revive",
      fakePort(pokemon),
    );
    expect(pokemon[0]).toMatchObject({ hp: 40, stages: { attack: 0, speed: 1 } });
    expect(pokemon[0].status).toBeUndefined();
  });

  it("excludes passive-owned pairs and does not exclude Deferred Pain after ownership transfer", () => {
    for (const [effectId, kinds] of Object.entries(MOODY_RUNTIME_PASSIVE_OVERLAP)) {
      for (const kind of kinds) {
        expect(isMoodyRuntimeCommandOwnedByPassive({ kind, effectId } as MoodyRuntimeCommand)).toBe(true);
      }
    }
    expect(isMoodyRuntimeCommandOwnedByPassive({ kind: "split-damage", effectId: "deferred-pain" })).toBe(false);
    expect(isMoodyRuntimeCommandOwnedByPassive({ kind: "modify-damage", effectId: "exposed-flank" })).toBe(false);
    expect(
      applyMoodyRuntimeDamageCommandValues(100, 100, [
        { kind: "modify-damage", effectId: "exposed-flank", multiplier: 1.15 },
      ]),
    ).toBeCloseTo(115);
  });

  it("persists deferred commands to their registered consumer and consumes them once", () => {
    const deferred = command("request-weather-choice", { subjectId: 1, options: ["sun", "rain"] });
    const execution = executeMoodyRuntimeCommands([deferred], EMPTY_STATE, "battle-b", fakePort([]));
    expect(execution.deferredCommands).toEqual([deferred]);
    const consumed = consumeMoodyRuntimePendingCommands(execution.state, "battle-b", "weather-choice", 1);
    expect(consumed.commands).toEqual([deferred]);
    expect(consumeMoodyRuntimePendingCommands(consumed.state, "battle-b", "weather-choice", 1).commands).toEqual([]);
  });

  it("never reports a resolution modifier as executed when its exact hook still owns it", () => {
    const modifier = command("ignore-defense-fraction", { subjectId: 1, fraction: 0.25 });
    const execution = executeMoodyRuntimeCommands([modifier], EMPTY_STATE, "battle-c", fakePort([]));
    expect(execution.executedCommands).not.toContain(modifier);
    expect(execution.deferredCommands).toEqual([modifier]);
    expect(consumeMoodyRuntimePendingCommands(execution.state, "battle-c", "damage-calculation").commands).toEqual([
      modifier,
    ]);
  });

  it("observes every faint lane before selecting the first terminal intervention", () => {
    const order: string[] = [];
    const result = resolveMoodyFaintLaneOrder({
      field: () => {
        order.push("field-observation");
        return {
          finalize: () => undefined,
          intervene: () => {
            order.push("field-posthumous");
            return true;
          },
        };
      },
      formation: () => order.push("formation-counter"),
      coordinator: () => {
        order.push("meta-progression");
        return true;
      },
    });
    expect(order).toEqual(["field-observation", "formation-counter", "meta-progression"]);
    expect(result).toBe("coordinator");
  });

  it("applies Toxic Bloom's nonlethal poison cap through the live damage consumer", () => {
    const reduced = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [runtimeBoon("toxic-bloom")],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: { ...EVENT_BASE, kind: "before-damage", target: PLAYER, amount: 30, direct: false, poisonDamage: true },
    });
    expect(reduced.commands).toContainEqual(expect.objectContaining({ kind: "cap-damage", amount: 0 }));
    expect(applyMoodyRuntimeDamageCommandValues(30, PLAYER.maxHp, reduced.commands)).toBe(0);
  });

  it("feeds real effectiveness into super-effective curse branches", () => {
    const effective = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [runtimeCurse("brittle-weakness")],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...EVENT_BASE,
        kind: "before-damage",
        source: ENEMY,
        target: { ...PLAYER, currentHp: 80 },
        amount: 40,
        direct: true,
        superEffective: true,
      },
    });
    expect(effective.commands).toContainEqual(expect.objectContaining({ kind: "modify-damage" }));
  });

  it("passes Purge Pulse's real removable severity into removal and burst damage", () => {
    const reduced = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [runtimeBoon("purge-pulse", 3, "contaminant-burst")],
      curses: [],
      state: { numbers: { "semantic:purge-pulse:actions": 3 }, values: {}, lists: {} },
      event: {
        ...EVENT_BASE,
        kind: "action-resolved",
        actor: PLAYER,
        target: ENEMY,
        actionId: "action:4",
        boonTriggerCount: 0,
        removableNegativeCount: 5,
      },
    });
    expect(reduced.commands).toContainEqual(
      expect.objectContaining({ kind: "typeless-damage", amount: 5, targetIds: [ENEMY.id] }),
    );
  });

  it("only fires Weather Wake for an outgoing weather ending or being replaced", () => {
    const event = {
      ...EVENT_BASE,
      kind: "weather-transition" as const,
      previous: "rain" as const,
      next: "clear" as const,
      activePokemon: PLAYER,
    };
    const resolve = (naturalOrReplacement: boolean) =>
      resolveMoodyRuntimeField({
        ownerSide: "player",
        boons: [runtimeBoon("weather-wake")],
        curses: [],
        state: createMoodyRuntimeFieldState(),
        event: { ...event, naturalOrReplacement },
      });
    expect(resolve(false).commands).toEqual([]);
    expect(resolve(true).commands).toContainEqual(expect.objectContaining({ kind: "heal" }));
  });

  it("turns an ER Frostbite status fact into the Frostbound barrier operation", () => {
    const reduced = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [runtimeBoon("frostbound-time")],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: { ...EVENT_BASE, kind: "status-applied", target: { ...PLAYER, status: "frostbite" }, status: "frostbite" },
    });
    const pokemon: FakePokemon[] = [{ id: PLAYER.id, hp: 80, maxHp: 100, pp: 4, stages: {} }];
    const executed = executeMoodyRuntimeCommands(
      reduced.commands,
      reduced.state,
      EVENT_BASE.battleId,
      fakePort(pokemon),
    );
    expect(executed.state.numbers[`${EVENT_BASE.battleId}:runtime-barrier:pokemon:${PLAYER.id}:amount`]).toBe(25);
  });

  it("executes Public Enemy's complete Second Act payload", () => {
    const boss: FakePokemon = { id: 99, hp: 0, maxHp: 240, pp: 4, stages: { attack: -2 } };
    executeMoodyRuntimeCommands(
      [
        {
          kind: "revive",
          effectId: "public-enemy",
          targetIds: [boss.id],
          fraction: 1,
          data: { healthSegments: 1, allStats: 1 },
        },
      ],
      EMPTY_STATE,
      EVENT_BASE.battleId,
      fakePort([boss]),
    );
    expect(boss.hp).toBe(240);
    expect(boss.extraHealthSegments).toBe(1);
    expect(Object.values(boss.stages).every(stage => stage >= 1)).toBe(true);
  });

  it("keeps Entropy replacements in category and approximate power while rejecting structural moves", () => {
    const move = (id: MoveId, category: MoveCategory, power: number, attrs: readonly string[] = []): Move =>
      ({ id, category, power, name: MoveId[id], hasAttr: (attr: string) => attrs.includes(attr) }) as unknown as Move;
    const tackle = move(MoveId.TACKLE, MoveCategory.PHYSICAL, 40);
    expect(isLegalMoodyEntropyReplacement(tackle, move(MoveId.QUICK_ATTACK, MoveCategory.PHYSICAL, 40))).toBe(true);
    expect(isLegalMoodyEntropyReplacement(tackle, move(MoveId.HYDRO_PUMP, MoveCategory.SPECIAL, 110))).toBe(false);
    expect(
      isLegalMoodyEntropyReplacement(tackle, move(MoveId.GUILLOTINE, MoveCategory.PHYSICAL, 0, ["OneHitKOAttr"])),
    ).toBe(false);
    expect(isLegalMoodyEntropyReplacement(tackle, move(MoveId.PROTECT, MoveCategory.STATUS, 0))).toBe(false);
  });

  it("observes Time Loop, formation, and Public Enemy before allowing one terminal intervention", () => {
    const order: string[] = [];
    const result = resolveMoodyFaintLaneOrder({
      field: () => {
        order.push("time-loop-observed");
        return {
          finalize: () => undefined,
          intervene: () => {
            order.push("time-loop-terminal");
            return true;
          },
        };
      },
      formation: () => order.push("formation-counter"),
      coordinator: () => {
        order.push("public-enemy-observed-and-terminal");
        return true;
      },
    });
    expect(order).toEqual(["time-loop-observed", "formation-counter", "public-enemy-observed-and-terminal"]);
    expect(result).toBe("coordinator");
  });

  it("runs the deferred field terminal only when no earlier terminal lane claimed the faint", () => {
    const order: string[] = [];
    const result = resolveMoodyFaintLaneOrder({
      field: () => ({
        finalize: () => undefined,
        intervene: () => {
          order.push("field-terminal");
          return true;
        },
      }),
      formation: () => order.push("formation-observed"),
      coordinator: () => {
        order.push("coordinator-observed");
        return false;
      },
    });
    expect(order).toEqual(["formation-observed", "coordinator-observed", "field-terminal"]);
    expect(result).toBe("field");
  });
});
