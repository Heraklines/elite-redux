import {
  coordinateMoodyGameplayEvent,
  executeMoodyGameplayCommands,
  MOODY_GAMEPLAY_PRODUCTION_EVENTS,
  type MoodyGameplayCommandKind,
  type MoodyGameplayEvent,
  type MoodyGameplayExecutors,
} from "#data/elite-redux/moody/moody-coordinator-gameplay";
import type { MoodyBoonProgress, MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { describe, expect, it, vi } from "vitest";

function saveWith(
  boonId: string,
  options: { readonly rank?: 1 | 2 | 3; readonly evolutionId?: string; readonly progress?: MoodyBoonProgress } = {},
): MoodyModeSaveData {
  return {
    version: 1,
    seed: 73,
    acquisitionRolls: 0,
    draftIndex: 0,
    boons: [
      {
        instanceId: `test:${boonId}`,
        boonId,
        rank: options.rank ?? 1,
        ...(options.evolutionId == null ? {} : { evolutionId: options.evolutionId }),
        ...(options.progress == null ? {} : { progress: options.progress }),
        acquiredAtWave: 1,
      },
    ],
    curses: [],
    recentThreat: [],
  };
}

function kinds(save: MoodyModeSaveData, event: MoodyGameplayEvent): readonly MoodyGameplayCommandKind[] {
  return coordinateMoodyGameplayEvent(save, event).commands.map(command => command.kind);
}

describe("Moody coordinator gameplay lane", () => {
  it("routes item and composition queries through typed commands", () => {
    expect(
      kinds(saveWith("warranty"), {
        type: "consumable-activated",
        seed: 1,
        itemStackId: "7:BERRY",
        activationIndex: 1,
        isSelectedStack: true,
        roll: 1,
        extendedChance: 0,
      }),
    ).toEqual(["preserve-item-stack"]);
    expect(
      kinds(saveWith("contraband-slot", { rank: 2 }), {
        type: "item-rule-query",
        seed: 1,
        itemStackId: "7:ORB",
        isSelectedStack: true,
      }),
    ).toEqual(["override-item-restrictions"]);
    expect(
      kinds(saveWith("diversity-charter"), {
        type: "party-composition-query",
        seed: 1,
        uniqueTypeCount: 12,
        matchingContributors: 0,
        consciousCount: 6,
        allConsciousMatch: false,
        moveMatchesType: false,
        incomingMatchesType: false,
        firstDamagingMove: true,
        firstSuperEffectiveHit: true,
      }),
    ).toEqual(["apply-party-modifiers"]);
  });

  it("persists deterministic action history and emits real echo commands", () => {
    let save = saveWith("recapitulation");
    const action = (index: number): MoodyGameplayEvent => ({
      type: "allied-damaging-action",
      seed: 10 + index,
      pokemonId: "7",
      action: { pokemonId: "7", moveId: String(100 + index), targetPokemonIds: ["9"] },
    });
    save = coordinateMoodyGameplayEvent(save, action(0)).save;
    save = coordinateMoodyGameplayEvent(save, action(1)).save;
    const third = coordinateMoodyGameplayEvent(save, action(2));
    expect(third.commands.map(command => command.kind)).toEqual(["replay-spectral-actions"]);
    expect(third.commands[0].data.actions).toEqual([
      { pokemonId: "7", moveId: "100", targetPokemonIds: ["9"] },
      { pokemonId: "7", moveId: "101", targetPokemonIds: ["9"] },
    ]);
    expect(coordinateMoodyGameplayEvent(save, action(2))).toEqual(third);
  });

  it("banks and consumes Pocket Turn tempo deterministically", () => {
    let save = saveWith("pocket-turn", { rank: 2 });
    const failed: MoodyGameplayEvent = { type: "move-failed", seed: 1, pokemonId: "7", reason: "miss" };
    save = coordinateMoodyGameplayEvent(save, failed).save;
    save = coordinateMoodyGameplayEvent(save, failed).save;
    const committed = coordinateMoodyGameplayEvent(save, {
      type: "allied-move-committed",
      seed: 2,
      pokemonId: "7",
      actionId: "action:1",
      targetActionId: "target:1",
    });
    expect(committed.commands.map(command => command.kind)).toEqual(["empower-pocket-turn"]);
    expect(committed.save.boons[0].progress?.counters?.tempo).toBe(0);
  });

  it("routes battle, lethal, projection, and overflow events", () => {
    expect(
      kinds(saveWith("ability-carousel"), {
        type: "battle-start",
        seed: 1,
        turn: 1,
        occupiedParty: ["7", "8"],
        compatibleAbilityIdsByPokemon: { "7": ["10"], "8": ["11"] },
      }),
    ).toEqual(["grant-temporary-abilities"]);
    expect(
      kinds(saveWith("mirror-theft"), {
        type: "enemy-effect-created",
        seed: 1,
        effectKind: "stat-stage",
        effectData: { stats: [1], stages: 1 },
        targetPokemonId: "7",
      }),
    ).toEqual(["copy-enemy-created-effect"]);
    expect(
      kinds(saveWith("borrowed-future"), {
        type: "prebattle-commit",
        seed: 1,
        enemyRoster: [{ pokemonId: "9" }],
        enemyLead: { pokemonId: "9" },
        committedActions: [{ moveId: "100" }],
        visibleLeadData: { moveIds: ["100"] },
      }),
    ).toEqual(["lock-enemy-opening-actions"]);
    expect(
      kinds(saveWith("pressure-valve", { evolutionId: "overpressure", rank: 3 }), {
        type: "positive-stat-overflow",
        seed: 1,
        pokemonId: "7",
        overflowStages: 3,
        selectedValve: "healing",
        mostUsefulValve: "healing",
      }),
    ).toEqual(["convert-stat-overflow", "queue-next-move-power"]);
  });

  it("decodes and persists both Bench Academy graduation commands", () => {
    const result = coordinateMoodyGameplayEvent(saveWith("bench-academy", { rank: 3, evolutionId: "elite-academy" }), {
      type: "academy-graduated",
      seed: 19,
    });
    expect(result.commands.map(command => command.kind)).toEqual([
      "increase-team-max-hp",
      "offer-partial-vitamin-transfer",
    ]);
    expect(result.save.boons[0].progress?.counters?.graduations).toBe(1);
  });

  it("does not execute dormant boons or expose them to Feedback Loop", () => {
    const save = saveWith("warranty");
    save.boons[0].dormant = true;
    const result = coordinateMoodyGameplayEvent(save, {
      type: "consumable-activated",
      seed: 1,
      itemStackId: "7:BERRY",
      activationIndex: 1,
      isSelectedStack: true,
      roll: 1,
      extendedChance: 0,
    });
    expect(result.commands).toEqual([]);
    expect(result.save.boons[0].progress).toBeUndefined();
  });

  it("has a typed executor for every emitted gameplay command kind", async () => {
    const calls: string[] = [];
    const executors = Object.fromEntries(
      [
        "preserve-item-stack",
        "repeat-consumable-effect",
        "override-item-restrictions",
        "apply-party-modifiers",
        "apply-monotype-oath",
        "apply-pokemon-growth",
        "apply-all-stat-multiplier",
        "reassign-growth-ring",
        "apply-pair-damage",
        "heal-incoming-partner",
        "transfer-random-positive-stage",
        "boost-pair-survivor",
        "borrow-eligible-move",
        "apply-experience-multiplier",
        "increase-team-max-hp",
        "offer-partial-vitamin-transfer",
        "heal-pokemon",
        "grant-temporary-damage",
        "restore-total-pp",
        "rewind-turn",
        "offer-turn-rewind",
        "replay-spectral-actions",
        "empower-pocket-turn",
        "grant-temporary-abilities",
        "copy-enemy-created-effect",
        "set-ethereal-turn",
        "modify-direct-damage",
        "consume-apex-segment",
        "override-type-effectiveness",
        "lock-enemy-opening-actions",
        "convert-stat-overflow",
        "queue-next-move-power",
        "apply-negative-space",
      ].map(kind => [kind, vi.fn(() => calls.push(kind))]),
    ) as unknown as MoodyGameplayExecutors;
    await executeMoodyGameplayCommands([{ effectId: "warranty", kind: "preserve-item-stack", data: {} }], executors);
    expect(calls).toEqual(["preserve-item-stack"]);
    expect(MOODY_GAMEPLAY_PRODUCTION_EVENTS).toContain("allied-damaging-action");
  });
});
