/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  buildCommandOpenEntry,
  buildInteractionOpenEntry,
  type CoopCommandOpenMaterialV2,
  type CoopInteractionOpenMaterialV2,
  commandOpenMaterialDigest,
  decodeCommandOpenEntry,
  decodeInteractionOpenEntry,
  interactionOpenMaterialDigest,
} from "#data/elite-redux/coop/authority-v2/adapters/control-open";
import { isValidAuthorityEntry } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlAllowsSuccessorEntry } from "#data/elite-redux/coop/authority-v2/next-control";
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

describe("authority-v2 explicit command-open boundary", () => {
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
});
