/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Node-pure contract for Authority V2 cutover surface 2. The real shadow harness pair exercises the same
// ordered authority log/frame/receipt path as production without importing Phaser runtime mechanics.

import type { BattleScene } from "#app/battle-scene";
import type {
  ReplacementAuthorityCarrier,
  ReplacementProposal,
  ReplacementSourceAddress,
} from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import type { CoopNextControl, CoopReplacementControlAddress } from "#data/elite-redux/coop/authority-v2/contract";
import {
  activeCoopReplacementAuthorityMode,
  CoopV2ReplacementCutover,
  clearActiveCoopV2ReplacementCutover,
  getActiveCoopV2ReplacementCutover,
  isCoopV2ReplacementCutoverActive,
  isCoopV2ReplacementEnabled,
  resolveCoopReplacementAuthorityMode,
  setActiveCoopV2ReplacementCutover,
  suppressesLegacyFaintOperationAuthority,
  suppressesLegacyReplacementAckProgression,
  suppressesLegacyReplacementRequest,
  suppressesLegacyReplacementResend,
} from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import type { CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { encodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import {
  CoopAuthorityV2Shadow,
  type CoopV2ShadowIdentity,
  clearCoopV2ShadowInbound,
  registerCoopV2ShadowInbound,
  routeCoopV2InboundFrame,
} from "#data/elite-redux/coop/authority-v2/shadow";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

class FakeClock implements CoopSchedulerClock {
  private readonly nowMs = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { readonly at: number; readonly callback: () => void }>();

  now(): number {
    return this.nowMs;
  }

  setTimer(callback: () => void, delayMs: number): CoopTimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + Math.max(0, delayMs), callback });
    return id;
  }

  clearTimer(handle: CoopTimerHandle): void {
    this.timers.delete(handle as number);
  }
}

const STUB_SCENE = {} as unknown as BattleScene;
const STUB_TRANSPORT = {} as unknown as CoopTransport;
const SESSION = {
  sessionId: "replacement-cutover-session",
  runId: "replacement-cutover-run",
  epoch: 7,
  authoritySeatId: 0,
  membershipRevision: 1,
  seatMapId: "replacement-cutover-map",
};

function identity(localSeatId: number): CoopV2ShadowIdentity {
  return {
    runtimeId: `${SESSION.sessionId}:seat${localSeatId}`,
    sessionId: SESSION.sessionId,
    runId: SESSION.runId,
    epoch: SESSION.epoch,
    localSeatId,
    authoritySeatId: SESSION.authoritySeatId,
    membershipRevision: SESSION.membershipRevision,
    seatMapId: SESSION.seatMapId,
    connectionGeneration: 0,
    peerBindings: [{ seatId: localSeatId === 0 ? 1 : 0, connectionGeneration: 0 }],
  };
}

function routeInto(harness: CoopAuthorityV2Shadow, frame: CoopFrameV2): void {
  registerCoopV2ShadowInbound(valid => harness.handleInboundFrame(valid));
  try {
    routeCoopV2InboundFrame(encodeFrameV2(frame));
  } finally {
    clearCoopV2ShadowInbound();
  }
}

function buildDuo(): { host: CoopAuthorityV2Shadow; guest: CoopAuthorityV2Shadow; dispose(): void } {
  const clock = new FakeClock();
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;
  host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    scheduler: createCoopScheduler(clock),
    send: frame => routeInto(guest, frame),
  });
  guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    scheduler: createCoopScheduler(clock),
    send: frame => routeInto(host, frame),
  });
  return {
    host,
    guest,
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

function source(overrides: Partial<ReplacementSourceAddress> = {}): ReplacementSourceAddress {
  return {
    epoch: SESSION.epoch,
    wave: 8,
    turn: 4,
    occurrence: 0,
    fieldIndex: 0,
    ...overrides,
  };
}

function proposal(overrides: Partial<ReplacementProposal> = {}): ReplacementProposal {
  return {
    sourceAddress: source(overrides.sourceAddress),
    ownerSeatId: overrides.ownerSeatId ?? 0,
    selected: overrides.selected === undefined ? { partySlot: 2, speciesId: 25 } : overrides.selected,
  };
}

function carrier(): ReplacementAuthorityCarrier {
  return {
    checkpoint: { tick: 90, field: [{ hp: 51 }, { hp: 73 }] },
    checksum: "replacement-carrier-checksum",
    preimage: '{"wave":8,"turn":5}',
    fullField: [
      { side: "player", fieldIndex: 0, pokemonId: 101 },
      { side: "player", fieldIndex: 1, pokemonId: 202 },
    ],
    authoritativeState: { version: 1, tick: 91, wave: 8, turn: 5 },
    epoch: SESSION.epoch,
    wave: 8,
    turn: 5,
  };
}

function stage(cutover: CoopV2ReplacementCutover, value: ReplacementProposal): boolean {
  return cutover.stageHostReplacement({
    proposal: value,
    resolution: "owner-pick",
    legacyImage: { proposal: value, resolution: "owner-pick" },
    legacyDigest: "legacy-replacement",
  });
}

function replacementAddress(value: ReplacementProposal): CoopReplacementControlAddress {
  return {
    operationId:
      `RC/e${value.sourceAddress.epoch}/w${value.sourceAddress.wave}/t${value.sourceAddress.turn}`
      + `/o${value.sourceAddress.occurrence}/f${value.sourceAddress.fieldIndex}/s${value.ownerSeatId}`,
    ownerSeatId: value.ownerSeatId,
    ...value.sourceAddress,
  };
}

function replacementControl(
  value: ReplacementProposal,
  remaining: readonly ReplacementProposal[] = [],
): Extract<CoopNextControl, { kind: "REPLACEMENT" }> {
  return {
    kind: "REPLACEMENT",
    ...replacementAddress(value),
    remaining: remaining.map(replacementAddress),
  };
}

afterEach(() => {
  clearActiveCoopV2ReplacementCutover();
  clearCoopV2ShadowInbound();
});

describe("authority-v2 replacement cutover mode", () => {
  it("fails closed unless every prerequisite is present and suppresses legacy loops only in v2", () => {
    expect(resolveCoopReplacementAuthorityMode({ buildEnabled: true, negotiated: true, harnessPresent: true })).toBe(
      "v2",
    );
    for (const inputs of [
      { buildEnabled: false, negotiated: true, harnessPresent: true },
      { buildEnabled: true, negotiated: false, harnessPresent: true },
      { buildEnabled: true, negotiated: true, harnessPresent: false },
    ]) {
      expect(resolveCoopReplacementAuthorityMode(inputs)).toBe("legacy");
    }
    for (const suppress of [
      suppressesLegacyFaintOperationAuthority,
      suppressesLegacyReplacementResend,
      suppressesLegacyReplacementRequest,
      suppressesLegacyReplacementAckProgression,
    ]) {
      expect(suppress("v2")).toBe(true);
      expect(suppress("legacy")).toBe(false);
    }
    expect(isCoopV2ReplacementEnabled()).toBe(false);
  });

  it("keeps the active selector match-scoped", () => {
    const duo = buildDuo();
    const active = new CoopV2ReplacementCutover(duo.host);
    const other = new CoopV2ReplacementCutover(duo.guest);
    setActiveCoopV2ReplacementCutover(active);
    expect(getActiveCoopV2ReplacementCutover()).toBe(active);
    expect(isCoopV2ReplacementCutoverActive()).toBe(true);
    expect(activeCoopReplacementAuthorityMode()).toBe("v2");
    clearActiveCoopV2ReplacementCutover(other);
    expect(getActiveCoopV2ReplacementCutover()).toBe(active);
    clearActiveCoopV2ReplacementCutover(active);
    expect(activeCoopReplacementAuthorityMode()).toBe("legacy");
    active.dispose();
    other.dispose();
    duo.dispose();
  });
});

describe("authority-v2 replacement staged transaction", () => {
  it("does not commit before the post-summon carrier and rejects a conflicting answer for one window", () => {
    const duo = buildDuo();
    const cutover = new CoopV2ReplacementCutover(duo.host);
    const pick = proposal();
    expect(stage(cutover, pick)).toBe(true);
    expect(stage(cutover, pick)).toBe(true);
    expect(cutover.pendingCount).toBe(1);
    expect(duo.host.diagnostics().committed).toBe(0);

    expect(
      cutover.stageHostReplacement({
        proposal: { ...pick, selected: { partySlot: 3, speciesId: 133 } },
        resolution: "fallback-auto",
        legacyDigest: "conflict",
      }),
    ).toBe(false);
    expect(cutover.pendingCount).toBe(1);
    cutover.dispose();
    duo.dispose();
  });

  it("commits a complete N+1 carrier and states the exact post-summon command address", () => {
    const duo = buildDuo();
    const cutover = new CoopV2ReplacementCutover(duo.host);
    expect(stage(cutover, proposal())).toBe(true);
    const result = cutover.commitStagedHostReplacements({
      authorityCarrier: carrier(),
      activeControl: replacementControl(proposal()),
      commands: [{ ownerSeatId: 0, pokemonId: 101, fieldIndex: 0 }],
    });
    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") {
      throw new Error("expected committed replacement batch");
    }
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].nextControl).toEqual({
      kind: "COMMAND_FRONTIER",
      epoch: SESSION.epoch,
      wave: 8,
      turn: 5,
      commands: [{ ownerSeatId: 0, pokemonId: 101, fieldIndex: 0 }],
    });
    expect(result.entries[0].material.payload).toMatchObject({
      authorityCarrier: {
        epoch: SESSION.epoch,
        wave: 8,
        turn: 5,
        checksum: "replacement-carrier-checksum",
      },
    });
    expect(cutover.pendingCount).toBe(0);
    expect(duo.host.diagnostics().retained).toBe(0);
    expect(duo.host.diagnostics().pendingTimers).toBe(0);
    cutover.dispose();
    duo.dispose();
  });

  it("commits only the active same-boundary faint and installs the next exact picker", () => {
    const duo = buildDuo();
    const cutover = new CoopV2ReplacementCutover(duo.host);
    const second = proposal({
      sourceAddress: source({ occurrence: 9, fieldIndex: 1 }),
      ownerSeatId: 1,
      selected: { partySlot: 3, speciesId: 133 },
    });
    const first = proposal({ sourceAddress: source({ occurrence: 2, fieldIndex: 0 }) });
    expect(stage(cutover, second)).toBe(true);
    expect(stage(cutover, first)).toBe(true);

    const result = cutover.commitStagedHostReplacements({
      authorityCarrier: carrier(),
      activeControl: replacementControl(first, [second]),
      commands: [
        { ownerSeatId: 0, pokemonId: 101, fieldIndex: 0 },
        { ownerSeatId: 1, pokemonId: 202, fieldIndex: 1 },
      ],
    });
    expect(result.kind).toBe("committed");
    if (result.kind !== "committed") {
      throw new Error("expected committed replacement batch");
    }
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].material.payload).toEqual(
      expect.objectContaining({ sourceAddress: expect.objectContaining({ occurrence: 2, fieldIndex: 0 }) }),
    );
    expect(result.entries[0].nextControl).toEqual({
      kind: "REPLACEMENT",
      operationId: replacementAddress(second).operationId,
      ownerSeatId: 1,
      epoch: SESSION.epoch,
      wave: 8,
      turn: 4,
      occurrence: 9,
      fieldIndex: 1,
      remaining: [],
    });
    expect(cutover.pendingCount, "the later seat cannot be consumed before its control becomes active").toBe(1);
    expect(duo.host.diagnostics().retained).toBe(0);
    expect(duo.host.diagnostics().pendingTimers).toBe(0);
    cutover.dispose();
    duo.dispose();
  });

  it("fails cleanly when the staged answer does not match the active replacement head", () => {
    const duo = buildDuo();
    const cutover = new CoopV2ReplacementCutover(duo.host);
    expect(stage(cutover, proposal())).toBe(true);
    expect(
      stage(
        cutover,
        proposal({
          sourceAddress: source({ occurrence: 1, fieldIndex: 1 }),
          ownerSeatId: 1,
          selected: { partySlot: 3, speciesId: 133 },
        }),
      ),
    ).toBe(true);
    const missing = proposal({ sourceAddress: source({ occurrence: 7, fieldIndex: 0 }) });
    const result = cutover.commitStagedHostReplacements({
      authorityCarrier: carrier(),
      activeControl: replacementControl(missing),
      commands: [{ ownerSeatId: 0, pokemonId: 101, fieldIndex: 0 }],
    });
    expect(result.kind).toBe("no-pending");
    expect(cutover.pendingCount).toBe(2);
    cutover.dispose();
    expect(cutover.pendingCount).toBe(0);
    duo.dispose();
  });
});
