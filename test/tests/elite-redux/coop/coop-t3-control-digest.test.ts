/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { coopSnapshotControlDigest } from "#data/elite-redux/coop/coop-runtime";
import type { CoopFullBattleSnapshot } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

type DigestInput = Pick<
  CoopFullBattleSnapshot,
  "checksum" | "sessionEpoch" | "membership" | "activeControl" | "journalHighWater"
>;

function control(): DigestInput {
  return {
    checksum: "authoritative-data-checksum",
    sessionEpoch: 4,
    membership: {
      version: 1,
      revision: 3,
      authoritySeat: 0,
      connectionGeneration: 2,
      state: "active",
      members: [
        { seatId: 0, role: "host", present: true },
        { seatId: 1, role: "guest", present: true },
      ],
    },
    activeControl: {
      version: 1,
      phaseName: "ColosseumChoicePhase",
      interactionCounter: 17,
      activeMysteryEncounter: {
        version: 1,
        interactionCounter: 17,
        revision: 8,
        round: 3,
        nextPickStep: 1,
        nextSubPickStep: 2,
        terminal: "pending",
        colosseum: {
          expectedRound: 2,
          boardRound: 2,
          decision: { round: 2, index: 0, operationId: "4:1:COLO_PICK:175" },
        },
      },
      awaitedInteractions: [],
      barriers: { localArrived: [], partnerArrived: [], awaiting: [] },
      pendingCommands: [],
    },
    journalHighWater: { "op:global": 18 },
  };
}

describe("T3 atomic control digest", () => {
  it("is stable across the actual JSON wire round-trip", () => {
    const original = control();
    const decoded = JSON.parse(JSON.stringify(original)) as DigestInput;
    expect(coopSnapshotControlDigest(decoded)).toBe(coopSnapshotControlDigest(original));
  });

  it("treats explicit undefined exactly like the omitted JSON property", () => {
    const explicit = control();
    explicit.activeControl!.activeMysteryEncounter = undefined;
    const omitted = control();
    delete omitted.activeControl!.activeMysteryEncounter;
    expect(coopSnapshotControlDigest(explicit)).toBe(coopSnapshotControlDigest(omitted));
  });

  it("detects tampering of Mystery ordinals and Colosseum decision control", () => {
    const original = control();
    const digest = coopSnapshotControlDigest(original);
    const ordinalTamper = structuredClone(original);
    ordinalTamper.activeControl!.activeMysteryEncounter!.nextSubPickStep = 3;
    expect(coopSnapshotControlDigest(ordinalTamper)).not.toBe(digest);

    const decisionTamper = structuredClone(original);
    decisionTamper.activeControl!.activeMysteryEncounter!.colosseum!.decision!.index = 1;
    expect(coopSnapshotControlDigest(decisionTamper)).not.toBe(digest);
  });

  it("binds every pending command to its epoch, wave, and Pokemon identity", () => {
    const original = control();
    original.activeControl!.pendingCommands = [
      {
        fieldIndex: 1,
        turn: 4,
        moveSlots: [0, 2],
        owner: "guest",
        address: { epoch: 4, wave: 20, pokemonId: 8080 },
      },
    ];
    const digest = coopSnapshotControlDigest(original);
    for (const [part, value] of [
      ["epoch", 5],
      ["wave", 21],
      ["pokemonId", 8081],
    ] as const) {
      const tampered = structuredClone(original);
      tampered.activeControl!.pendingCommands[0].address![part] = value;
      expect(coopSnapshotControlDigest(tampered), part).not.toBe(digest);
    }
  });
});
