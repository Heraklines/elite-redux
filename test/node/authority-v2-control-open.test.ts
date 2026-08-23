/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  buildCommandOpenEntry,
  buildInteractionOpenEntry,
  buildReplacementOpenEntry,
  buildTrainerVictoryOpenEntry,
  type CoopCommandOpenMaterialV2,
  type CoopInteractionOpenMaterialV2,
  type CoopReplacementOpenMaterialV2,
  type CoopTrainerVictoryOpenMaterialV2,
  classifyReplacementOpenCursor,
  commandOpenControlAddressesClaim,
  commandOpenMaterialDigest,
  decodeCommandOpenEntry,
  decodeInteractionOpenEntry,
  decodeReplacementOpenEntry,
  decodeTrainerVictoryOpenEntry,
  interactionOpenMaterialDigest,
  replacementOpenMaterialDigest,
  trainerVictoryOpenMaterialDigest,
} from "#data/elite-redux/coop/authority-v2/adapters/control-open";
import { isValidAuthorityEntry } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlAllowsSuccessorEntry, successorWaitAllows } from "#data/elite-redux/coop/authority-v2/next-control";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const context: CoopFrameContextV2 = {
  sessionId: "session",
  runId: "run",
  sessionEpoch: 3,
  seatMapId: "seats",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

function state(overrides: Partial<CoopAuthoritativeBattleStateV1> = {}): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: 17,
    wave: 4,
    turn: 1,
    double: false,
    playerParty: [],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: 0,
    lockModifierTiers: false,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
    seed: "seed",
    waveSeed: "wave-seed",
    ...overrides,
  };
}

function command(overrides: Partial<Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>> = {}) {
  return {
    kind: "COMMAND_FRONTIER" as const,
    epoch: 3,
    wave: 4,
    turn: 1,
    commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
    ...overrides,
  };
}

function material(overrides: Partial<CoopCommandOpenMaterialV2> = {}): CoopCommandOpenMaterialV2 {
  return {
    kind: "command-open",
    wave: 4,
    turn: 1,
    authoritativeState: state(),
    entryPresentation: [],
    ...overrides,
  };
}

function crossroadsControl(
  overrides: Partial<Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }>> = {},
): Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }> {
  return {
    kind: "SHARED_INTERACTION",
    surfaceClass: "op:biome",
    operationId: "3:1:CROSSROADS_PICK:9600007",
    ownerSeatId: 1,
    epoch: 3,
    wave: 4,
    turn: 1,
    operationKind: "CROSSROADS_PICK",
    successor: {
      operationKinds: ["CROSSROADS_PICK"],
      operationIds: ["3:1:CROSSROADS_PICK:9600007"],
    },
    ...overrides,
  };
}

function interactionMaterial(overrides: Partial<CoopInteractionOpenMaterialV2> = {}): CoopInteractionOpenMaterialV2 {
  return {
    kind: "interaction-open",
    wave: 4,
    turn: 1,
    authoritativeState: state(),
    control: crossroadsControl(),
    projection: { kind: "crossroads", sourceWave: 4 },
    ...overrides,
  };
}

function replacementControl(
  overrides: Partial<Extract<CoopNextControl, { kind: "REPLACEMENT" }>> = {},
): Extract<CoopNextControl, { kind: "REPLACEMENT" }> {
  return {
    kind: "REPLACEMENT",
    operationId: "RC/e3/w4/t1/o1000000137/f1/s1",
    ownerSeatId: 1,
    epoch: 3,
    wave: 4,
    turn: 1,
    occurrence: 1_000_000_137,
    fieldIndex: 1,
    remaining: [],
    ...overrides,
  };
}

function replacementMaterial(overrides: Partial<CoopReplacementOpenMaterialV2> = {}): CoopReplacementOpenMaterialV2 {
  return {
    kind: "replacement-open",
    origin: "pre-encounter",
    wave: 4,
    turn: 1,
    authoritativeState: state(),
    control: replacementControl(),
    ...overrides,
  };
}

function trainerVictoryMaterial(
  overrides: Partial<CoopTrainerVictoryOpenMaterialV2> = {},
): CoopTrainerVictoryOpenMaterialV2 {
  return {
    kind: "trainer-victory-open",
    wave: 4,
    turn: 2,
    authoritativeState: state({ wave: 4, turn: 2 }),
    trainerVictory: {
      sourceWave: 4,
      trainerType: 11,
      moneyMultiplier: 1.5,
      modifierRewardTypeIds: ["VOUCHER"],
      isBoss: false,
      hasCharSprite: true,
      victoryBgm: "victory_trainer",
      trainerSpriteKey: "ace_trainer",
      trainerName: "Ace Ada",
      trainerDialogueName: "Ada",
      victoryMessages: ["A clean victory."],
      biomeId: 3,
      isErGhost: false,
    },
    ...overrides,
  };
}

describe("authority-v2 explicit command-open boundary", () => {
  it("addresses only the exact parked command consumer without naming presentation phases", () => {
    const frontier = command({
      wave: 12,
      turn: 4,
      commands: [
        { ownerSeatId: 0, pokemonId: 101, fieldIndex: 0 },
        { ownerSeatId: 1, pokemonId: 202, fieldIndex: 1 },
      ],
    });
    expect(
      commandOpenControlAddressesClaim(frontier, {
        epoch: 3,
        wave: 12,
        turn: 4,
        fieldIndex: 1,
        pokemonId: 202,
      }),
    ).toBe(true);
    expect(
      commandOpenControlAddressesClaim(frontier, {
        epoch: 3,
        wave: 12,
        turn: 3,
        fieldIndex: 1,
        pokemonId: 202,
      }),
    ).toBe(false);
    expect(
      commandOpenControlAddressesClaim(frontier, {
        epoch: 3,
        wave: 12,
        turn: 4,
        fieldIndex: 0,
        pokemonId: 999,
      }),
    ).toBe(false);
    expect(
      commandOpenControlAddressesClaim(frontier, {
        epoch: 3,
        wave: 12,
        turn: 4,
        fieldIndex: 0,
        pokemonId: 999,
        authorityTarget: { ownerSeatId: 1, pokemonId: 202, fieldIndex: 1 },
      }),
    ).toBe(true);
  });

  it("carries and fingerprints the complete post-entry-effects state", () => {
    const built = buildCommandOpenEntry({
      context,
      operationId: "control-open-w4-t1",
      material: material(),
      command: command(),
    });
    const committed = { ...built, revision: 5 } satisfies CoopAuthorityEntry;

    expect(built.kind).toBe("CONTROL_COMMIT");
    expect(built.material.digest).toBe(commandOpenMaterialDigest(material()));
    expect(built.nextControl).toEqual(command());
    expect(decodeCommandOpenEntry(committed)).toEqual(material());
  });

  it("binds the complete entry presentation into the immutable command-open digest", () => {
    const presentation = [
      {
        k: "showAbility" as const,
        bi: 2,
        pokemonId: 42,
        partySlot: 0,
        abilityId: 7,
        passive: false,
        passiveSlot: 0,
        actor: { side: "enemy" as const, pokemonId: 42 },
      },
    ];
    const built = buildCommandOpenEntry({
      context,
      operationId: "control-open-entry-presentation",
      material: material({ entryPresentation: presentation }),
      command: command(),
    });
    const committed = { ...built, revision: 5 } satisfies CoopAuthorityEntry;
    expect(decodeCommandOpenEntry(committed)?.entryPresentation).toEqual(presentation);

    const tampered = structuredClone(committed);
    (tampered.material.payload as { entryPresentation: unknown[] }).entryPresentation = [];
    expect(decodeCommandOpenEntry(tampered)).toBeNull();
  });

  it("rejects tick-zero placeholders and incomplete state arrays", () => {
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "tick-zero",
        material: material({ authoritativeState: state({ tick: 0 }) }),
        command: command(),
      }),
    ).toThrow(/complete post-entry-effects/u);
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "missing-field",
        material: material({
          authoritativeState: { ...state(), field: undefined } as unknown as CoopAuthoritativeBattleStateV1,
        }),
        command: command(),
      }),
    ).toThrow(/complete post-entry-effects/u);
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "missing-presentation",
        material: { ...material(), entryPresentation: undefined } as unknown as CoopCommandOpenMaterialV2,
        command: command(),
      }),
    ).toThrow(/complete post-entry-effects/u);
  });

  it("rejects a frontier derived for any other epoch, wave, or turn", () => {
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "wrong-wave",
        material: material(),
        command: command({ wave: 3 }),
      }),
    ).toThrow(/does not match/u);
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "wrong-turn",
        material: material(),
        command: command({ turn: 2 }),
      }),
    ).toThrow(/does not match/u);
    expect(() =>
      buildCommandOpenEntry({
        context,
        operationId: "wrong-epoch",
        material: material(),
        command: command({ epoch: 2 }),
      }),
    ).toThrow(/does not match/u);
  });

  it("rejects material tampering at decode even under the original digest", () => {
    const built = buildCommandOpenEntry({
      context,
      operationId: "tamper",
      material: material(),
      command: command(),
    });
    const tampered: CoopAuthorityEntry = {
      ...built,
      revision: 2,
      material: {
        ...built.material,
        payload: material({ authoritativeState: state({ money: 999 }) }),
      },
    };
    expect(decodeCommandOpenEntry(tampered)).toBeNull();
  });

  it("opens one exact recoverable Crossroads control from complete immutable state", () => {
    const open = interactionMaterial();
    const built = buildInteractionOpenEntry({
      context,
      operationId: "V2/CONTROL/INTERACTION/3:1:CROSSROADS_PICK:9600007",
      material: open,
    });
    const committed = { ...built, revision: 6 } satisfies CoopAuthorityEntry;

    expect(built.kind).toBe("CONTROL_COMMIT");
    expect(built.material.digest).toBe(interactionOpenMaterialDigest(open));
    expect(built.nextControl).toEqual(crossroadsControl());
    expect(isValidAuthorityEntry(committed)).toBe(true);
    expect(
      controlAllowsSuccessorEntry(
        {
          kind: "AWAIT_SUCCESSOR",
          afterOperationId: "reward-terminal",
          epoch: context.sessionEpoch,
          wave: open.wave,
          turn: open.turn,
          allowedKinds: ["CONTROL_COMMIT"],
          allowNextWaveStart: false,
          expectedOperationId: null,
        },
        "reward-terminal",
        committed,
      ),
    ).toBe(true);
    expect(decodeInteractionOpenEntry(committed)).toEqual(open);
  });

  it("admits same-turn interaction-open control from a broad interaction-result wait", () => {
    const open = interactionMaterial();
    const committed = {
      ...buildInteractionOpenEntry({
        context,
        operationId: "V2/CONTROL/INTERACTION/3:1:CROSSROADS_PICK:9600007",
        material: open,
      }),
      revision: 6,
    } satisfies CoopAuthorityEntry;
    const predecessor = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "reward-terminal",
      epoch: context.sessionEpoch,
      wave: open.wave,
      turn: open.turn,
      allowedKinds: ["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"] as const,
      allowNextWaveStart: true,
      expectedOperationId: null,
    };

    expect(controlAllowsSuccessorEntry(predecessor, "reward-terminal", committed)).toBe(true);
    expect(
      controlAllowsSuccessorEntry(predecessor, "reward-terminal", {
        ...committed,
        material: {
          ...committed.material,
          payload: {
            ...open,
            kind: "command-open",
          },
        },
      }),
    ).toBe(false);
  });

  it("orders both renderers through trainer victory before the later settled wave entry", () => {
    const operationId = "V2/CONTROL/TRAINER_VICTORY/e3/w4/t2/trainer11";
    const successor = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: operationId,
      epoch: context.sessionEpoch,
      wave: 4,
      turn: 2,
      allowedKinds: ["WAVE_ADVANCE", "TERMINAL_COMMIT"] as const,
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
    const open = trainerVictoryMaterial();
    const committed = {
      ...buildTrainerVictoryOpenEntry({ context, operationId, material: open, successor }),
      revision: 6,
    } satisfies CoopAuthorityEntry;
    const resolvingTurnWait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "TURN/e3/w4/t1",
      epoch: context.sessionEpoch,
      wave: 4,
      turn: 2,
      allowedKinds: ["CONTROL_COMMIT", "WAVE_ADVANCE"] as const,
      allowedControlAddresses: [
        { materialKind: "replacement-open" as const, wave: 4, turn: 2, operationId: null },
        { materialKind: "trainer-victory-open" as const, wave: 4, turn: 2, operationId: null },
      ],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };

    expect(committed.material.digest).toBe(trainerVictoryOpenMaterialDigest(open));
    expect(committed.nextControl).toEqual(successor);
    expect(isValidAuthorityEntry(committed)).toBe(true);
    expect(controlAllowsSuccessorEntry(resolvingTurnWait, resolvingTurnWait.afterOperationId, committed)).toBe(true);
    expect(
      controlAllowsSuccessorEntry(
        {
          ...resolvingTurnWait,
          allowedControlAddresses: [resolvingTurnWait.allowedControlAddresses[0]],
        },
        resolvingTurnWait.afterOperationId,
        committed,
      ),
    ).toBe(false);
    expect(decodeTrainerVictoryOpenEntry(committed)).toEqual(open);
    expect(
      decodeTrainerVictoryOpenEntry({
        ...committed,
        material: {
          ...committed.material,
          payload: trainerVictoryMaterial({
            trainerVictory: { ...open.trainerVictory, sourceWave: 5 },
          }),
        },
      }),
    ).toBeNull();
  });

  it("rejects a Crossroads control whose recovery capsule or exact result address drifts", () => {
    expect(() =>
      buildInteractionOpenEntry({
        context,
        operationId: "wrong-source-wave",
        material: interactionMaterial({ projection: { kind: "crossroads", sourceWave: 3 } }),
      }),
    ).toThrow(/complete state and recoverable projection/u);
    expect(() =>
      buildInteractionOpenEntry({
        context,
        operationId: "wrong-result-address",
        material: interactionMaterial({
          control: crossroadsControl({
            successor: {
              operationKinds: ["CROSSROADS_PICK"],
              operationIds: ["3:1:CROSSROADS_PICK:other"],
            },
          }),
        }),
      }),
    ).toThrow(/complete state and recoverable projection/u);
  });

  it("opens one exact delayed replacement at the next-wave pre-encounter boundary", () => {
    const open = replacementMaterial();
    const committed = {
      ...buildReplacementOpenEntry({
        context,
        operationId: `V2/CONTROL/REPLACEMENT/${open.control.operationId}`,
        material: open,
      }),
      revision: 7,
    } satisfies CoopAuthorityEntry;
    const predecessor = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "wave-3-reward-terminal",
      epoch: context.sessionEpoch,
      wave: 3,
      turn: 2,
      allowedKinds: ["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"] as const,
      allowNextWaveStart: true,
      expectedOperationId: null,
    };

    expect(committed.material.digest).toBe(replacementOpenMaterialDigest(open));
    expect(committed.nextControl).toEqual(open.control);
    expect(isValidAuthorityEntry(committed)).toBe(true);
    expect(controlAllowsSuccessorEntry(predecessor, predecessor.afterOperationId, committed)).toBe(true);
    expect(decodeReplacementOpenEntry(committed)).toEqual(open);
  });

  it("keeps a pre-encounter replacement open to either the real battle or a Mystery presentation", () => {
    const wait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "RC/e3/w4/t1/o1000000137/f1/s1",
      epoch: context.sessionEpoch,
      wave: 4,
      turn: 1,
      allowedKinds: ["INTERACTION_COMMIT", "CONTROL_COMMIT"] as const,
      allowedInteractionAddresses: [
        { surfaceClass: "op:me" as const, operationKind: "ME_PRESENT" as const, wave: 4, turn: 0 },
      ],
      allowedControlAddresses: [
        { materialKind: "replacement-open" as const, wave: 4, turn: 1, operationId: null },
        { materialKind: "command-open" as const, wave: 4, turn: 1, operationId: null },
      ],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
    const mysteryPresentation = {
      kind: "OPERATION_ENVELOPE_V1",
      surfaceClass: "op:me",
      envelope: {
        sessionEpoch: context.sessionEpoch,
        wave: 4,
        turn: 0,
        pendingOperation: { kind: "ME_PRESENT" },
      },
    };

    expect(
      successorWaitAllows(
        wait,
        wait.afterOperationId,
        "INTERACTION_COMMIT",
        "3:4:ME_PRESENT:1",
        context.sessionEpoch,
        mysteryPresentation,
      ),
    ).toBe(true);
    expect(
      successorWaitAllows(
        wait,
        wait.afterOperationId,
        "INTERACTION_COMMIT",
        "3:4:ME_TERMINAL:1",
        context.sessionEpoch,
        {
          ...mysteryPresentation,
          envelope: { ...mysteryPresentation.envelope, pendingOperation: { kind: "ME_TERMINAL" } },
        },
      ),
    ).toBe(false);
  });

  it("rejects replacement-open material whose control drifts from its complete state address", () => {
    expect(() =>
      buildReplacementOpenEntry({
        context,
        operationId: "wrong-replacement-wave",
        material: replacementMaterial({ control: replacementControl({ wave: 5 }) }),
      }),
    ).toThrow(/complete state and exact replacement control/u);

    const built = buildReplacementOpenEntry({
      context,
      operationId: "tampered-replacement",
      material: replacementMaterial(),
    });
    const tampered = {
      ...built,
      revision: 8,
      material: { ...built.material, payload: replacementMaterial({ authoritativeState: state({ money: 999 }) }) },
    } satisfies CoopAuthorityEntry;
    expect(decodeReplacementOpenEntry(tampered)).toBeNull();
  });

  it("admits the real same-wave picker only when a staged wave wait names that exact alternative", () => {
    const open = replacementMaterial({
      origin: "settled-wave",
      turn: 2,
      authoritativeState: state({ turn: 2 }),
      control: replacementControl({
        turn: 2,
        operationId: "RC/e3/w4/t2/o1000000137/f1/s1",
      }),
    });
    const committed = {
      ...buildReplacementOpenEntry({
        context,
        operationId: `V2/CONTROL/REPLACEMENT/${open.control.operationId}`,
        material: open,
      }),
      revision: 9,
    } satisfies CoopAuthorityEntry;
    const stagedWaveWait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "TURN/e3/w4/t1",
      epoch: context.sessionEpoch,
      wave: 4,
      turn: 2,
      allowedKinds: ["CONTROL_COMMIT", "WAVE_ADVANCE"] as const,
      allowedControlAddresses: [{ materialKind: "replacement-open" as const, wave: 4, turn: 2, operationId: null }],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
    const wrongAddressWait = {
      ...stagedWaveWait,
      allowedControlAddresses: [{ materialKind: "replacement-open" as const, wave: 4, turn: 1, operationId: null }],
    };

    expect(controlAllowsSuccessorEntry(stagedWaveWait, stagedWaveWait.afterOperationId, committed)).toBe(true);
    expect(controlAllowsSuccessorEntry(wrongAddressWait, wrongAddressWait.afterOperationId, committed)).toBe(false);
  });

  it("admits an exact turn-resolve picker before the first command frontier exists", () => {
    const open = replacementMaterial({
      origin: "turn-resolve",
      turn: 1,
      authoritativeState: state({ turn: 1 }),
      control: replacementControl({ turn: 1 }),
    });
    const committed = {
      ...buildReplacementOpenEntry({
        context,
        operationId: `V2/CONTROL/REPLACEMENT/${open.control.operationId}`,
        material: open,
      }),
      revision: 10,
    } satisfies CoopAuthorityEntry;
    const battleEntryWait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "wave-3-reward-terminal",
      epoch: context.sessionEpoch,
      wave: 4,
      turn: 1,
      allowedKinds: ["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"] as const,
      allowNextWaveStart: false,
      expectedOperationId: null,
    };

    expect(controlAllowsSuccessorEntry(battleEntryWait, battleEntryWait.afterOperationId, committed)).toBe(true);
    expect(decodeReplacementOpenEntry(committed)?.origin).toBe("turn-resolve");
  });

  it("keeps a settled-wave replacement chain open only to its next picker or wave commit", () => {
    const wait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "RC/e3/w4/t2/o1000000137/f1/s1",
      epoch: context.sessionEpoch,
      wave: 4,
      turn: 2,
      allowedKinds: ["CONTROL_COMMIT", "WAVE_ADVANCE"] as const,
      allowedControlAddresses: [{ materialKind: "replacement-open" as const, wave: 4, turn: 2, operationId: null }],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
    const nextPicker = replacementMaterial({
      origin: "settled-wave",
      turn: 2,
      authoritativeState: state({ turn: 2 }),
      control: replacementControl({
        ownerSeatId: 0,
        fieldIndex: 0,
        turn: 2,
        occurrence: 1_000_000_136,
        operationId: "RC/e3/w4/t2/o1000000136/f0/s0",
      }),
    });
    const nextPickerEntry = {
      ...buildReplacementOpenEntry({
        context,
        operationId: `V2/CONTROL/REPLACEMENT/${nextPicker.control.operationId}`,
        material: nextPicker,
      }),
      revision: 10,
    } satisfies CoopAuthorityEntry;

    expect(controlAllowsSuccessorEntry(wait, wait.afterOperationId, nextPickerEntry)).toBe(true);
    expect(
      successorWaitAllows(
        wait,
        wait.afterOperationId,
        "CONTROL_COMMIT",
        "wrong-command",
        context.sessionEpoch,
        material({ authoritativeState: state({ turn: 2 }), turn: 2 }),
      ),
    ).toBe(false);
  });
});

describe("replacement-open cursor ownership", () => {
  it("advances only the exact same-wave TurnEnd edge and otherwise requires the signed destination shell", () => {
    const settled = { origin: "settled-wave" as const, wave: 4, turn: 2 };
    expect(classifyReplacementOpenCursor(settled, 4, 1)).toBe("advance-one");
    expect(classifyReplacementOpenCursor(settled, 4, 2)).toBe("ready");
    expect(classifyReplacementOpenCursor(settled, 4, 3)).toBe("invalid");
    expect(classifyReplacementOpenCursor(settled, 3, 1)).toBe("invalid");

    const preEncounter = { origin: "pre-encounter" as const, wave: 5, turn: 1 };
    expect(classifyReplacementOpenCursor(preEncounter, 4, 2)).toBe("await-destination");
    expect(classifyReplacementOpenCursor(preEncounter, 5, 1)).toBe("ready");
    expect(classifyReplacementOpenCursor(preEncounter, 5, 2)).toBe("invalid");
    expect(classifyReplacementOpenCursor(preEncounter, 3, 2)).toBe("invalid");

    const turnResolve = { origin: "turn-resolve" as const, wave: 5, turn: 1 };
    expect(classifyReplacementOpenCursor(turnResolve, 5, 1)).toBe("ready");
    expect(classifyReplacementOpenCursor(turnResolve, 4, 1)).toBe("invalid");
    expect(classifyReplacementOpenCursor(turnResolve, 5, 2)).toBe("invalid");
  });
});
