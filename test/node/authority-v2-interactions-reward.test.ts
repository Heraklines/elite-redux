/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-pure tests for co-op authority-v2 Interactions lane 1 (reward / market /
// biome adapter). These pin the ENGINE-FREE interaction transactions that replace
// the legacy reward-shop / market / biome-crossroads carriers:
//   - builder validation: each surface builds a well-formed INTERACTION_COMMIT the
//     foundation validator accepts, and rejects malformed material / successor;
//   - applier adoption + digest defense: a committed entry decodes + installs; a
//     tampered digest is refused before install; a foreign-surface entry is refused;
//   - watcher-close semantics: a committed entry closes the non-owner's open watcher
//     through the ordered apply (adopt), with no side channel;
//   - zero-leak: the owner window + the log's delivery lease leave ZERO scheduler
//     timers once the entry retires.
// No Phaser / globalScene / legacy netcode is imported.
// =============================================================================

import {
  armInteractionOwnerWindow,
  biomeOperationId,
  buildBiomeInteractionEntry,
  buildMarketInteractionEntry,
  buildRewardInteractionEntry,
  type CoopBiomeInteractionMaterialV2,
  type CoopInteractionWindowAddress,
  type CoopMarketInteractionMaterialV2,
  type CoopRewardApplierSurface,
  type CoopRewardInteractionMaterialV2,
  checkInteractionParity,
  decodeBiomeInteractionMaterial,
  decodeMarketInteractionMaterial,
  decodeRewardInteractionMaterial,
  digestOfInteractionMaterial,
  INTERACTION_COMMIT_KIND,
  interactionShadowsAgree,
  isValidBiomeInteractionMaterial,
  isValidMarketInteractionMaterial,
  isValidRewardInteractionMaterial,
  makeBiomeInteractionApplier,
  makeMarketInteractionApplier,
  makeRewardInteractionApplier,
  marketOperationId,
  type OpenInteractionWatcher,
  rewardOperationId,
  shadowOfInteractionEntry,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-reward";
import { isValidAuthorityEntry } from "#data/elite-redux/coop/authority-v2/authority-entry";
import { AuthorityLog, type CoopAuthorityWire } from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import {
  type CoopSchedulerClock,
  type CoopSchedulerImpl,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRAME: CoopFrameContextV2 = {
  sessionId: "session-A",
  runId: "run-A",
  sessionEpoch: 1,
  seatMapId: "seatmap-A",
  membershipRevision: 1,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

function windowAddress(over: Partial<CoopInteractionWindowAddress> = {}): CoopInteractionWindowAddress {
  return { epoch: 1, wave: 5, ownerSeatId: 1, actionOrdinal: 0, ...over };
}

function rewardMaterial(over: Partial<CoopRewardInteractionMaterialV2> = {}): CoopRewardInteractionMaterialV2 {
  return {
    kind: "reward",
    wave: 5,
    ownerSeatId: 1,
    choice: over.choice ?? { kind: "pick", optionIndex: 2, subPicks: [0] },
    terminal: over.terminal ?? true,
    ...over,
  };
}

function marketMaterial(over: Partial<CoopMarketInteractionMaterialV2> = {}): CoopMarketInteractionMaterialV2 {
  return {
    kind: "market",
    wave: 5,
    ownerSeatId: 1,
    action: over.action ?? { kind: "buy", slot: 3, outcome: { kind: "applied", moneyAfter: 1200, targetPartySlot: 0 } },
    terminal: over.terminal ?? false,
    ...over,
  };
}

function biomeMaterial(over: Partial<CoopBiomeInteractionMaterialV2> = {}): CoopBiomeInteractionMaterialV2 {
  return {
    kind: "biome",
    wave: 5,
    ownerSeatId: 1,
    selection: over.selection ?? { kind: "biome-pick", sourceBiomeId: 3, biomeId: 9, nodeIndex: 1, nextWave: 6 },
    ...over,
  };
}

/** A COMMAND successor into the next wave (the common interaction successor). */
function commandSuccessor(over: { wave?: number; turn?: number; ownerSeatId?: number; pokemonId?: number } = {}) {
  return {
    kind: "COMMAND" as const,
    epoch: 1,
    wave: over.wave ?? 6,
    turn: over.turn ?? 1,
    ownerSeatId: over.ownerSeatId ?? 0,
    pokemonId: over.pokemonId ?? 42,
  };
}

/**
 * A deterministic scheduler clock driving the REAL CoopSchedulerImpl (so active-time
 * pause/resume is exercised for real). Mirrors the replacement test's ManualClock.
 */
class ManualClock implements CoopSchedulerClock {
  private wall = 0;
  private seq = 0;
  private readonly timers = new Map<number, { fireAt: number; cb: () => void }>();

  now(): number {
    return this.wall;
  }

  setTimer(callback: () => void, delayMs: number): number {
    const id = ++this.seq;
    this.timers.set(id, { fireAt: this.wall + Math.max(0, delayMs), cb: callback });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    this.wall += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.fireAt <= this.wall) {
        this.timers.delete(id);
        timer.cb();
      }
    }
  }
}

const STUB_CTX = {} as CoopRuntimeContext;

// ---------------------------------------------------------------------------
// operationId scheme
// ---------------------------------------------------------------------------

describe("interaction operationId scheme", () => {
  it("mints disjoint, deterministic ids per surface + window action", () => {
    const a = windowAddress();
    expect(rewardOperationId(a)).toBe("IREW/e1/w5/s1/a0");
    expect(marketOperationId(a)).toBe("IMKT/e1/w5/s1/a0");
    expect(biomeOperationId({ epoch: 1, wave: 5, ownerSeatId: 1, selection: "biome-pick" })).toBe("IBIO/e1/w5/s1/kb");
    expect(biomeOperationId({ epoch: 1, wave: 5, ownerSeatId: 1, selection: "crossroads-pick" })).toBe(
      "IBIO/e1/w5/s1/kx",
    );
    // A shop is a stream: distinct action ordinals => distinct identities.
    expect(rewardOperationId(windowAddress({ actionOrdinal: 1 }))).not.toBe(rewardOperationId(a));
  });
});

// ---------------------------------------------------------------------------
// (1) builder validation
// ---------------------------------------------------------------------------

describe("reward builder + material validation", () => {
  it("accepts pick / skip / leave material and rejects malformed", () => {
    expect(isValidRewardInteractionMaterial(rewardMaterial())).toBe(true);
    expect(isValidRewardInteractionMaterial(rewardMaterial({ choice: { kind: "skip" } }))).toBe(true);
    expect(isValidRewardInteractionMaterial(rewardMaterial({ choice: { kind: "leave" } }))).toBe(true);
    // A hole / bad discriminant is not complete material.
    expect(isValidRewardInteractionMaterial({ ...rewardMaterial(), choice: { kind: "pick" } })).toBe(false);
    expect(isValidRewardInteractionMaterial({ ...rewardMaterial(), choice: { kind: "nope" } })).toBe(false);
    expect(isValidRewardInteractionMaterial({ ...rewardMaterial(), terminal: "yes" })).toBe(false);
    expect(
      isValidRewardInteractionMaterial(rewardMaterial({ choice: { kind: "pick", optionIndex: -1, subPicks: [] } })),
    ).toBe(false);
  });

  it("builds a REWARD INTERACTION_COMMIT the foundation validator accepts", () => {
    const built = buildRewardInteractionEntry({
      context: FRAME,
      address: windowAddress(),
      material: rewardMaterial(),
      successor: commandSuccessor(),
    });
    expect(built.kind).toBe(INTERACTION_COMMIT_KIND);
    expect(built.operationId).toBe(rewardOperationId(windowAddress()));
    expect(built.material.digest).toBe(digestOfInteractionMaterial(rewardMaterial()));
    expect(built.nextControl).toEqual(commandSuccessor());
    expect(isValidAuthorityEntry({ ...built, revision: 7 })).toBe(true);
  });

  it("throws on malformed material, missing operationId, and a bad successor", () => {
    expect(() =>
      buildRewardInteractionEntry({
        context: FRAME,
        material: { ...rewardMaterial(), choice: { kind: "pick" } } as unknown as CoopRewardInteractionMaterialV2,
        address: windowAddress(),
        successor: null,
      }),
    ).toThrow();
    // No operationId and no address => no wire-safe identity.
    expect(() =>
      buildRewardInteractionEntry({ context: FRAME, material: rewardMaterial(), successor: null }),
    ).toThrow();
    // A TERMINAL successor is never an interaction's job.
    expect(() =>
      buildRewardInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: rewardMaterial(),
        successor: { kind: "TERMINAL", terminalId: "t" } as never,
      }),
    ).toThrow();
    // A structurally malformed COMMAND successor (pokemonId must be positive).
    expect(() =>
      buildRewardInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: rewardMaterial(),
        successor: commandSuccessor({ pokemonId: 0 }),
      }),
    ).toThrow();
  });

  it("states a REWARD-chain successor for a non-terminal continuation pick", () => {
    const built = buildRewardInteractionEntry({
      context: FRAME,
      address: windowAddress({ actionOrdinal: 0 }),
      material: rewardMaterial({ choice: { kind: "pick", optionIndex: 1, subPicks: [] }, terminal: false }),
      successor: {
        kind: "REWARD",
        operationId: rewardOperationId(windowAddress({ actionOrdinal: 1 })),
        ownerSeatId: 1,
      },
    });
    expect(built.nextControl).toMatchObject({ kind: "REWARD", ownerSeatId: 1 });
  });
});

describe("market builder + atomic outcome validation", () => {
  it("accepts an applied buy, a rolled-back buy, and a leave; rejects malformed", () => {
    expect(isValidMarketInteractionMaterial(marketMaterial())).toBe(true);
    expect(
      isValidMarketInteractionMaterial(
        marketMaterial({
          action: { kind: "buy", slot: 0, outcome: { kind: "rolled-back", reason: "insufficient-funds" } },
        }),
      ),
    ).toBe(true);
    expect(isValidMarketInteractionMaterial(marketMaterial({ action: { kind: "leave" }, terminal: true }))).toBe(true);
    // applied buy: moneyAfter required, targetPartySlot may be null.
    expect(
      isValidMarketInteractionMaterial(
        marketMaterial({
          action: { kind: "buy", slot: 1, outcome: { kind: "applied", moneyAfter: 0, targetPartySlot: null } },
        }),
      ),
    ).toBe(true);
    // Bad rollback reason / missing moneyAfter / negative slot are refused.
    expect(
      isValidMarketInteractionMaterial(
        marketMaterial({ action: { kind: "buy", slot: 1, outcome: { kind: "rolled-back", reason: "nope" } as never } }),
      ),
    ).toBe(false);
    expect(
      isValidMarketInteractionMaterial(
        marketMaterial({
          action: { kind: "buy", slot: -1, outcome: { kind: "applied", moneyAfter: 1, targetPartySlot: 0 } },
        }),
      ),
    ).toBe(false);
  });

  it("builds a MARKET INTERACTION_COMMIT the foundation validator accepts", () => {
    const built = buildMarketInteractionEntry({
      context: FRAME,
      address: windowAddress(),
      material: marketMaterial(),
      successor: null,
    });
    expect(built.kind).toBe(INTERACTION_COMMIT_KIND);
    expect(built.operationId).toBe(marketOperationId(windowAddress()));
    expect(built.nextControl).toBeNull();
    expect(isValidAuthorityEntry({ ...built, revision: 3 })).toBe(true);
  });
});

describe("biome builder + destination validation", () => {
  it("accepts a biome pick and a crossroads pick; enforces nextWave === wave + 1", () => {
    expect(isValidBiomeInteractionMaterial(biomeMaterial())).toBe(true);
    expect(
      isValidBiomeInteractionMaterial(biomeMaterial({ selection: { kind: "crossroads-pick", optionIndex: 1 } })),
    ).toBe(true);
    // Deterministic single-node transition: nodeIndex -1 is legal.
    expect(
      isValidBiomeInteractionMaterial(
        biomeMaterial({ selection: { kind: "biome-pick", sourceBiomeId: 3, biomeId: 9, nodeIndex: -1, nextWave: 6 } }),
      ),
    ).toBe(true);
    // nextWave must be wave + 1.
    expect(
      isValidBiomeInteractionMaterial(
        biomeMaterial({ selection: { kind: "biome-pick", sourceBiomeId: 3, biomeId: 9, nodeIndex: 1, nextWave: 8 } }),
      ),
    ).toBe(false);
    // crossroads optionIndex is exactly 0 or 1.
    expect(
      isValidBiomeInteractionMaterial(
        biomeMaterial({ selection: { kind: "crossroads-pick", optionIndex: 2 as never } }),
      ),
    ).toBe(false);
  });

  it("builds a biome pick with a COMMAND successor and a crossroads-Leave with a BIOME chain", () => {
    const pick = buildBiomeInteractionEntry({
      context: FRAME,
      address: { epoch: 1, wave: 5, ownerSeatId: 1, selection: "biome-pick" },
      material: biomeMaterial(),
      successor: commandSuccessor(),
    });
    expect(pick.kind).toBe(INTERACTION_COMMIT_KIND);
    expect(pick.operationId).toBe("IBIO/e1/w5/s1/kb");
    expect(pick.nextControl).toMatchObject({ kind: "COMMAND", wave: 6 });

    // Crossroads LEAVE (optionIndex 1) chains to another BIOME interaction (legacy: unshift SelectBiomePhase).
    const leave = buildBiomeInteractionEntry({
      context: FRAME,
      address: { epoch: 1, wave: 5, ownerSeatId: 1, selection: "crossroads-pick" },
      material: biomeMaterial({ selection: { kind: "crossroads-pick", optionIndex: 1 } }),
      successor: { kind: "BIOME", operationId: "IBIO/e1/w5/s1/kb", ownerSeatId: 1 },
    });
    expect(leave.operationId).toBe("IBIO/e1/w5/s1/kx");
    expect(leave.nextControl).toMatchObject({ kind: "BIOME", ownerSeatId: 1 });
  });
});

// ---------------------------------------------------------------------------
// (2) applier adoption + digest defense
// ---------------------------------------------------------------------------

describe("applier adoption + digest defense", () => {
  function committedReward(): CoopAuthorityEntry {
    return {
      ...buildRewardInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: rewardMaterial(),
        successor: commandSuccessor(),
      }),
      revision: 11,
    };
  }

  it("decodes + installs a well-formed reward entry", () => {
    const install = vi.fn((_image: CoopRewardInteractionMaterialV2) => true);
    const applier = makeRewardInteractionApplier({ openWatcherFor: () => null, installReward: install });
    expect(applier(STUB_CTX, committedReward())).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install.mock.calls[0][0]).toMatchObject({ kind: "reward", choice: { kind: "pick", optionIndex: 2 } });
  });

  it("refuses a tampered entry (digest mismatch) before install", () => {
    const entry = committedReward();
    const tampered: CoopAuthorityEntry = { ...entry, material: { ...entry.material, digest: "reward:deadbeef" } };
    const install = vi.fn(() => true);
    expect(
      makeRewardInteractionApplier({ openWatcherFor: () => null, installReward: install })(STUB_CTX, tampered),
    ).toBe(false);
    expect(install).not.toHaveBeenCalled();
    expect(decodeRewardInteractionMaterial(tampered)).toBeNull();
  });

  it("refuses a foreign-surface entry (market payload through the reward applier)", () => {
    const marketEntry: CoopAuthorityEntry = {
      ...buildMarketInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: marketMaterial(),
        successor: null,
      }),
      revision: 12,
    };
    const install = vi.fn(() => true);
    expect(
      makeRewardInteractionApplier({ openWatcherFor: () => null, installReward: install })(STUB_CTX, marketEntry),
    ).toBe(false);
    expect(install).not.toHaveBeenCalled();
    // ...and the market applier accepts its own.
    const marketInstall = vi.fn(() => true);
    expect(
      makeMarketInteractionApplier({ openWatcherFor: () => null, installMarket: marketInstall })(STUB_CTX, marketEntry),
    ).toBe(true);
    expect(decodeMarketInteractionMaterial(marketEntry)).not.toBeNull();
  });

  it("propagates an install false (materialApplied withheld)", () => {
    const applier = makeRewardInteractionApplier({ openWatcherFor: () => null, installReward: () => false });
    expect(applier(STUB_CTX, committedReward())).toBe(false);
  });

  it("adopts a rolled-back market buy and a biome destination through their appliers", () => {
    const rolled: CoopAuthorityEntry = {
      ...buildMarketInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: marketMaterial({
          action: { kind: "buy", slot: 2, outcome: { kind: "rolled-back", reason: "insufficient-funds" } },
        }),
        successor: null,
      }),
      revision: 13,
    };
    const marketInstall = vi.fn((_image: CoopMarketInteractionMaterialV2) => true);
    expect(
      makeMarketInteractionApplier({ openWatcherFor: () => null, installMarket: marketInstall })(STUB_CTX, rolled),
    ).toBe(true);
    expect(marketInstall.mock.calls[0][0].action).toMatchObject({ kind: "buy", outcome: { kind: "rolled-back" } });

    const biomeEntry: CoopAuthorityEntry = {
      ...buildBiomeInteractionEntry({
        context: FRAME,
        address: { epoch: 1, wave: 5, ownerSeatId: 1, selection: "biome-pick" },
        material: biomeMaterial(),
        successor: commandSuccessor(),
      }),
      revision: 14,
    };
    const biomeInstall = vi.fn((_image: CoopBiomeInteractionMaterialV2) => true);
    expect(
      makeBiomeInteractionApplier({ openWatcherFor: () => null, installBiome: biomeInstall })(STUB_CTX, biomeEntry),
    ).toBe(true);
    expect(biomeInstall.mock.calls[0][0].selection).toMatchObject({ kind: "biome-pick", biomeId: 9 });
    expect(decodeBiomeInteractionMaterial(biomeEntry)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) watcher-close semantics (owner pick closes the non-owner's mirror)
// ---------------------------------------------------------------------------

describe("watcher-close semantics", () => {
  function committedReward(): CoopAuthorityEntry {
    return {
      ...buildRewardInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: rewardMaterial({ choice: { kind: "leave" }, terminal: true }),
        successor: commandSuccessor(),
      }),
      revision: 21,
    };
  }

  it("closes the open watcher for the entry's operationId and adopts the committed image (no side channel)", () => {
    const adopt = vi.fn();
    const install = vi.fn(() => true);
    const entry = committedReward();
    const watcher: OpenInteractionWatcher<CoopRewardInteractionMaterialV2> = { operationId: entry.operationId, adopt };
    const surface: CoopRewardApplierSurface = {
      openWatcherFor: op => (op === entry.operationId ? watcher : null),
      installReward: install,
    };
    expect(makeRewardInteractionApplier(surface)(STUB_CTX, entry)).toBe(true);
    // The committed entry closed the watcher (adopt fired with the image), THEN installed.
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt.mock.calls[0][0]).toMatchObject({ choice: { kind: "leave" } });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("installs without a watcher close when no local mirror is open for the operationId", () => {
    const install = vi.fn(() => true);
    const surface: CoopRewardApplierSurface = { openWatcherFor: () => null, installReward: install };
    expect(makeRewardInteractionApplier(surface)(STUB_CTX, committedReward())).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// shadow parity seam
// ---------------------------------------------------------------------------

describe("shadow parity seam", () => {
  it("re-derives an identical descriptor from a rebuilt entry (parity holds)", () => {
    const input = {
      context: FRAME,
      address: windowAddress(),
      material: rewardMaterial(),
      successor: commandSuccessor(),
    };
    const a = shadowOfInteractionEntry(buildRewardInteractionEntry(input));
    const b = shadowOfInteractionEntry(buildRewardInteractionEntry(input));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(interactionShadowsAgree(a!, b!)).toBe(true);
    expect(a!.surface).toBe("reward");
  });

  it("disagrees when the resolved choice differs (a real divergence surfaces with a reason)", () => {
    const base = shadowOfInteractionEntry(
      buildRewardInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: rewardMaterial(),
        successor: commandSuccessor(),
      }),
    );
    const drifted = shadowOfInteractionEntry(
      buildRewardInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: rewardMaterial({ choice: { kind: "pick", optionIndex: 3, subPicks: [] } }),
        successor: commandSuccessor(),
      }),
    );
    expect(interactionShadowsAgree(base!, drifted!)).toBe(false);
    const verdict = checkInteractionParity(base!, drifted!);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("materialDigest");
    }
  });

  it("returns null for a foreign entry kind and distinguishes surfaces", () => {
    const turn: CoopAuthorityEntry = {
      context: FRAME,
      revision: 1,
      operationId: "op-turn",
      kind: "TURN_COMMIT",
      material: { digest: "d", payload: {} },
      nextControl: null,
      subsumes: [],
    };
    expect(shadowOfInteractionEntry(turn)).toBeNull();

    const marketShadow = shadowOfInteractionEntry(
      buildMarketInteractionEntry({
        context: FRAME,
        address: windowAddress(),
        material: marketMaterial(),
        successor: null,
      }),
    );
    const biomeShadow = shadowOfInteractionEntry(
      buildBiomeInteractionEntry({
        context: FRAME,
        address: { epoch: 1, wave: 5, ownerSeatId: 1, selection: "biome-pick" },
        material: biomeMaterial(),
        successor: commandSuccessor(),
      }),
    );
    expect(marketShadow!.surface).toBe("market");
    expect(biomeShadow!.surface).toBe("biome");
    expect(interactionShadowsAgree(marketShadow!, biomeShadow!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (4) zero-leak - owner window + log delivery lease leave zero timers on retire
// ---------------------------------------------------------------------------

describe("owner window + zero timers after retire", () => {
  let clock: ManualClock;
  let scheduler: CoopSchedulerImpl;

  beforeEach(() => {
    clock = new ManualClock();
    scheduler = createCoopScheduler(clock);
  });

  function receipt(
    entry: CoopAuthorityEntry,
    stage: CoopAuthorityReceipt["stage"],
    controlId?: string,
  ): CoopAuthorityReceipt {
    return {
      context: entry.context,
      revision: entry.revision,
      operationId: entry.operationId,
      stage,
      ...(controlId == null ? {} : { controlId }),
    };
  }

  it("fires the owner-window fallback only after 60s of humanInput active time (a pause does not burn it)", () => {
    let fallbacks = 0;
    const cancel = armInteractionOwnerWindow(
      { scheduler } as unknown as CoopRuntimeContext,
      rewardOperationId(windowAddress()),
      () => {
        fallbacks++;
      },
    );
    clock.advance(30_000);
    expect(fallbacks).toBe(0);
    scheduler.pauseClass("humanInput", "hidden");
    clock.advance(100_000);
    expect(fallbacks).toBe(0);
    scheduler.resumeClass("humanInput", "hidden");
    clock.advance(29_999);
    expect(fallbacks).toBe(0);
    clock.advance(1);
    expect(fallbacks).toBe(1);
    cancel();
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("cancels the owner window when the owner resolves first (no fallback)", () => {
    let fallbacks = 0;
    const cancel = armInteractionOwnerWindow(
      { scheduler } as unknown as CoopRuntimeContext,
      rewardOperationId(windowAddress()),
      () => {
        fallbacks++;
      },
    );
    clock.advance(10_000);
    cancel();
    clock.advance(120_000);
    expect(fallbacks).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("leaves zero scheduler timers once the committed entry retires and the window is cancelled", () => {
    const sent: CoopAuthorityWire[] = [];
    const log = new AuthorityLog({ localContext: FRAME, scheduler, send: wire => sent.push(wire) });

    const entry = log.commit(
      buildBiomeInteractionEntry({
        context: FRAME,
        address: { epoch: 1, wave: 5, ownerSeatId: 1, selection: "biome-pick" },
        material: biomeMaterial(),
        successor: commandSuccessor(),
      }),
    );

    const cancelWindow = armInteractionOwnerWindow(
      { scheduler } as unknown as CoopRuntimeContext,
      entry.operationId,
      () => {},
    );
    expect(scheduler.pendingTimerCount).toBeGreaterThan(0);

    // Owner resolved -> cancel the window.
    cancelWindow();

    // Drive the replica receipts to retirement (nextControl != null -> controlInstalled required).
    const controlId = entry.nextControl == null ? undefined : controlIdOf(entry.nextControl);
    expect(log.acceptReceipt(receipt(entry, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(entry, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(entry, "controlInstalled", controlId))).toBe(true);

    expect(log.retained()).toHaveLength(0);
    expect(log.diagnostics().activeDeliveryTimers).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });
});
