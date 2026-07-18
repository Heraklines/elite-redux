/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Interactions lane 3 node-pure tests (learn-move / ability /
// bargain / colosseum / stormglass).
//
// The interactions-learn adapter's import graph is engine/DOM-free (TYPE-only
// contract import + the pure next-control / authority-entry / replica helpers), so
// it runs in the node-pure project in milliseconds. These pin the lane's
// load-bearing behaviours:
//   - owner-seat-addressed builder validation per surface (all five),
//   - the ER batch level-up panel typed as ONE decision set per party slot,
//   - the replica applier ADOPTS the verified typed material (never derives),
//   - Colosseum adopt-or-restore including a FAILURE-path restore + a throw-path
//     restore (the before-image rollback contract),
//   - digest defense (a tampered redelivery is refused; malformed material rejected),
//   - shadow parity (authority statement == what a shadow derivation produces), and
//   - zero-leak teardown through the foundation log (dispose leaves no timers).
// =============================================================================

import {
  type AbilityPickMaterial,
  type BargainChoiceMaterial,
  buildAbilityPickInteractionEntry,
  buildBargainInteractionEntry,
  buildColosseumBoardInteractionEntry,
  buildLearnMoveBatchInteractionEntry,
  buildLearnMoveInteractionEntry,
  buildStormglassInteractionEntry,
  COOP_INTERACTION_COLOSSEUM_MAX_ROUND,
  type ColosseumBoardMaterial,
  type ColosseumDecisionMaterial,
  type CoopColosseumBoardTransaction,
  CoopInteractionBuildError,
  type CoopInteractionSink,
  createColosseumBoardApplier,
  createInteractionApplier,
  decodeInteractionMaterial,
  INTERACTION_COMMIT_KIND,
  interactionMaterialDigest,
  interactionShadowsAgree,
  type LearnMoveBatchDecisionMaterial,
  type LearnMoveDecisionMaterial,
  type LearnMovePromptMaterial,
  type StormglassChoiceMaterial,
  shadowOfInteractionEntry,
  validateInteractionMaterial,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-learn";
import {
  AuthorityLog,
  type AuthorityLogOptions,
  type CoopAuthorityWire,
} from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import { applyEntry, type ReplicaReceiptSink } from "#data/elite-redux/coop/authority-v2/replica";
import { beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test doubles (engine-free)
// ---------------------------------------------------------------------------

interface FakeTimer {
  readonly id: number;
  readonly ownerId: string;
  readonly callback: () => void;
}

/** A deterministic CoopScheduler mirroring the wave/turn test doubles. */
class FakeScheduler implements CoopScheduler {
  private seq = 0;
  readonly timers = new Map<number, FakeTimer>();

  now(_timeClass: CoopTimeClass): number {
    return 0;
  }

  schedule(owner: CoopTimerOwner, _delayMs: number, _timeClass: CoopTimeClass, callback: () => void): () => void {
    const id = ++this.seq;
    this.timers.set(id, { id, ownerId: owner.ownerId, callback });
    return () => {
      this.timers.delete(id);
    };
  }

  cancelOwner(ownerId: string): void {
    for (const [id, timer] of this.timers) {
      if (timer.ownerId === ownerId) {
        this.timers.delete(id);
      }
    }
  }

  liveCount(): number {
    return this.timers.size;
  }
}

function frameContext(overrides: Partial<CoopFrameContextV2> = {}): CoopFrameContextV2 {
  return {
    sessionId: "session-A",
    runId: "run-A",
    sessionEpoch: 1,
    seatMapId: "seatmap-A",
    membershipRevision: 1,
    senderSeatId: 0,
    authoritySeatId: 0,
    connectionGeneration: 1,
    ...overrides,
  };
}

function makeLog(scheduler: FakeScheduler, sent: CoopAuthorityWire[], over: Partial<AuthorityLogOptions> = {}) {
  return new AuthorityLog({
    localContext: frameContext(),
    scheduler,
    send: wire => sent.push(wire),
    ...over,
  });
}

function ctxWithSeat(localSeatId: number): CoopRuntimeContext {
  return { localSeatId } as unknown as CoopRuntimeContext;
}

function recordingSink(): { sink: ReplicaReceiptSink; stages: string[] } {
  const receipts: Array<{ stage: string }> = [];
  return {
    sink: { emit: r => receipts.push({ stage: r.stage }) },
    get stages() {
      return receipts.map(r => r.stage);
    },
  };
}

function fixedProjector(result: CoopControlInstallResult): CoopControlProjector {
  return { project: () => result };
}

function receipt(entry: CoopAuthorityEntry, stage: "admitted" | "materialApplied" | "controlInstalled") {
  return { context: entry.context, revision: entry.revision, operationId: entry.operationId, stage };
}

const base = { context: frameContext(), ownerSeatId: 1 } as const;

// ---------------------------------------------------------------------------
// Owner-seat-addressed builder validation - per surface
// ---------------------------------------------------------------------------

describe("owner-seat-addressed builders - per surface", () => {
  it("learn-move (single) prompt + decision carry the typed image and a deterministic digest", () => {
    const prompt = buildLearnMoveInteractionEntry({
      ...base,
      operationId: "lm-prompt-s2",
      choice: { phase: "prompt", partySlot: 2, moveId: 33, maxMoveCount: 4 },
    });
    expect(prompt.kind).toBe(INTERACTION_COMMIT_KIND);
    expect(prompt.nextControl).toBeNull();
    expect(prompt.material.payload).toEqual({
      surface: "learn-move/prompt",
      ownerSeatId: 1,
      partySlot: 2,
      moveId: 33,
      maxMoveCount: 4,
    } satisfies LearnMovePromptMaterial);
    expect(prompt.material.digest).toBe(interactionMaterialDigest(prompt.material.payload as LearnMovePromptMaterial));

    const decision = buildLearnMoveInteractionEntry({
      ...base,
      operationId: "lm-decision-s2",
      choice: { phase: "decision", partySlot: 2, moveId: 33, forgetSlot: 1, maxMoveCount: 4 },
    });
    expect(decision.material.payload).toEqual({
      surface: "learn-move/decision",
      ownerSeatId: 1,
      partySlot: 2,
      moveId: 33,
      forgetSlot: 1,
      maxMoveCount: 4,
    } satisfies LearnMoveDecisionMaterial);
  });

  it("ability-picker / bargain / stormglass builders address the owner seat with typed material", () => {
    const ability = buildAbilityPickInteractionEntry({ ...base, operationId: "ab-1", data: [3, 0, 118] });
    expect(ability.material.payload).toEqual({
      surface: "ability-pick",
      ownerSeatId: 1,
      data: [3, 0, 118],
    } satisfies AbilityPickMaterial);

    const bargain = buildBargainInteractionEntry({
      ...base,
      operationId: "bg-1",
      choiceIndex: 2,
      outcome: { k: "meResync", blob: [1, 2, 3] },
    });
    expect(bargain.material.payload).toEqual({
      surface: "bargain",
      ownerSeatId: 1,
      choiceIndex: 2,
      outcome: { k: "meResync", blob: [1, 2, 3] },
    } satisfies BargainChoiceMaterial);

    const stormglass = buildStormglassInteractionEntry({ ...base, operationId: "sg-1", weatherIndex: 3, weather: 12 });
    expect(stormglass.material.payload).toEqual({
      surface: "stormglass",
      ownerSeatId: 1,
      weatherIndex: 3,
      weather: 12,
    } satisfies StormglassChoiceMaterial);
  });

  it("carries an optional stated successor control (validated) and defaults it to null", () => {
    const successor: CoopNextControl = { kind: "REWARD", operationId: "op-reward", ownerSeatId: 1 };
    const withSuccessor = buildStormglassInteractionEntry({
      ...base,
      operationId: "sg-succ",
      weatherIndex: 0,
      weather: 0,
      successor,
    });
    expect(withSuccessor.nextControl).toEqual(successor);
    expect(controlIdOf(withSuccessor.nextControl as NonNullable<CoopNextControl>)).toBe(controlIdOf(successor));
  });

  it("throws (fail loud) on a malformed choice, operationId, or successor", () => {
    // party slot out of range.
    expect(() =>
      buildLearnMoveInteractionEntry({
        ...base,
        operationId: "lm-bad",
        choice: { phase: "prompt", partySlot: 6, moveId: 1, maxMoveCount: 4 },
      }),
    ).toThrow(CoopInteractionBuildError);
    // non-positive moveId.
    expect(() =>
      buildLearnMoveInteractionEntry({
        ...base,
        operationId: "lm-bad2",
        choice: { phase: "decision", partySlot: 0, moveId: 0, forgetSlot: 0, maxMoveCount: 4 },
      }),
    ).toThrow(CoopInteractionBuildError);
    // blank operationId.
    expect(() => buildStormglassInteractionEntry({ ...base, operationId: "", weatherIndex: 0, weather: 0 })).toThrow(
      CoopInteractionBuildError,
    );
    // weatherIndex out of range.
    expect(() =>
      buildStormglassInteractionEntry({ ...base, operationId: "sg-bad", weatherIndex: 5, weather: 0 }),
    ).toThrow(CoopInteractionBuildError);
    // malformed successor control.
    expect(() =>
      buildStormglassInteractionEntry({
        ...base,
        operationId: "sg-bad-succ",
        weatherIndex: 0,
        weather: 0,
        successor: { kind: "COMMAND", epoch: 0, wave: 1, turn: 1, ownerSeatId: 0, pokemonId: 1 },
      }),
    ).toThrow(CoopInteractionBuildError);
    // a subsumes with a non-positive revision is a build error.
    expect(() =>
      buildAbilityPickInteractionEntry({ ...base, operationId: "ab-bad", data: [1], subsumes: [0] }),
    ).toThrow(CoopInteractionBuildError);
  });
});

// ---------------------------------------------------------------------------
// The ER batch level-up panel - ONE typed decision set per party slot
// ---------------------------------------------------------------------------

describe("batch level-up panel typed as one decision set per party slot", () => {
  it("the prompt carries every learnable move; the decision carries the whole assignment set", () => {
    const prompt = buildLearnMoveBatchInteractionEntry({
      ...base,
      operationId: "lmb-prompt-s3",
      choice: { phase: "prompt", partySlot: 3, learnableIds: [10, 20, 30], ownerIsGuest: true },
    });
    expect(prompt.material.payload).toEqual({
      surface: "learn-move-batch/prompt",
      ownerSeatId: 1,
      partySlot: 3,
      learnableIds: [10, 20, 30],
      ownerIsGuest: true,
    });

    const decision = buildLearnMoveBatchInteractionEntry({
      ...base,
      operationId: "lmb-decision-s3",
      choice: {
        phase: "decision",
        partySlot: 3,
        assignments: [
          [10, 0],
          [20, 2],
        ],
        fallback: false,
      },
    });
    const payload = decision.material.payload as LearnMoveBatchDecisionMaterial;
    expect(payload.surface).toBe("learn-move-batch/decision");
    expect(payload.partySlot).toBe(3);
    expect(payload.assignments).toEqual([
      [10, 0],
      [20, 2],
    ]);
    expect(payload.fallback).toBe(false);
    // The whole decision set is one entry - its digest is deterministic over the set.
    expect(decision.material.digest).toBe(interactionMaterialDigest(payload));
  });

  it("rejects a malformed assignment set (fail loud)", () => {
    expect(() =>
      buildLearnMoveBatchInteractionEntry({
        ...base,
        operationId: "lmb-bad",
        // an assignment pair of the wrong arity is not a representable decision set.
        choice: {
          phase: "decision",
          partySlot: 0,
          assignments: [[1, 2, 3] as unknown as [number, number]],
          fallback: true,
        },
      }),
    ).toThrow(CoopInteractionBuildError);
  });
});

// ---------------------------------------------------------------------------
// REPLICA: the applier ADOPTS the verified typed material (never derives)
// ---------------------------------------------------------------------------

describe("createInteractionApplier (replica adoption)", () => {
  function makeSink() {
    const adopted: Array<{ verb: string; surface: string }> = [];
    const sink: CoopInteractionSink = {
      adoptLearnMove: (_c, m) => {
        adopted.push({ verb: "learnMove", surface: m.surface });
        return true;
      },
      adoptLearnMoveBatch: (_c, m) => {
        adopted.push({ verb: "learnMoveBatch", surface: m.surface });
        return true;
      },
      adoptAbilityPick: (_c, m) => {
        adopted.push({ verb: "abilityPick", surface: m.surface });
        return true;
      },
      adoptBargain: (_c, m) => {
        adopted.push({ verb: "bargain", surface: m.surface });
        return true;
      },
      adoptStormglass: (_c, m) => {
        adopted.push({ verb: "stormglass", surface: m.surface });
        return true;
      },
    };
    return { adopted, sink };
  }

  it("dispatches each surface to its sink verb and reaches materialApplied", () => {
    const { adopted, sink } = makeSink();
    const applier = createInteractionApplier(sink);

    const entries: CoopAuthorityEntry[] = [
      {
        ...buildLearnMoveInteractionEntry({
          ...base,
          operationId: "a",
          choice: { phase: "prompt", partySlot: 0, moveId: 1, maxMoveCount: 4 },
        }),
        revision: 1,
      },
      {
        ...buildLearnMoveBatchInteractionEntry({
          ...base,
          operationId: "b",
          choice: { phase: "decision", partySlot: 0, assignments: [[1, 0]], fallback: false },
        }),
        revision: 2,
      },
      { ...buildAbilityPickInteractionEntry({ ...base, operationId: "c", data: [1, 2] }), revision: 3 },
      { ...buildBargainInteractionEntry({ ...base, operationId: "d", choiceIndex: 0, outcome: null }), revision: 4 },
      { ...buildStormglassInteractionEntry({ ...base, operationId: "e", weatherIndex: 1, weather: 2 }), revision: 5 },
    ];
    for (const entry of entries) {
      expect(applier(ctxWithSeat(0), entry)).toBe(true);
    }
    expect(adopted.map(a => a.verb)).toEqual(["learnMove", "learnMoveBatch", "abilityPick", "bargain", "stormglass"]);
  });

  it("drives a full applyEntry to controlInstalled when a successor is stated", () => {
    const { sink } = makeSink();
    const applier = createInteractionApplier(sink);
    const successor: CoopNextControl = { kind: "MYSTERY", operationId: "op-mystery", ownerSeatId: 1 };
    const entry: CoopAuthorityEntry = {
      ...buildBargainInteractionEntry({
        ...base,
        operationId: "bg",
        choiceIndex: 1,
        outcome: { k: "meResync" },
        successor,
      }),
      revision: 1,
    };
    const rec = recordingSink();
    const out = applyEntry(ctxWithSeat(0), entry, {
      applyMaterial: applier,
      projector: fixedProjector({ kind: "installed", controlId: controlIdOf(successor) }),
      receipts: rec.sink,
    });
    expect(rec.stages).toEqual(["admitted", "materialApplied", "controlInstalled"]);
    expect(out.kind).toBe("applied");
  });

  it("returns false for a Colosseum material (owned by the transaction applier, not this one)", () => {
    const { sink } = makeSink();
    const applier = createInteractionApplier(sink);
    const entry: CoopAuthorityEntry = {
      ...buildColosseumBoardInteractionEntry({
        ...base,
        operationId: "co",
        board: { type: "board", pinned: 0, round: 0, labels: ["A", "B"] },
      }),
      revision: 1,
    };
    expect(applier(ctxWithSeat(0), entry)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Colosseum adopt-or-restore (the before-image rollback contract)
// ---------------------------------------------------------------------------

describe("Colosseum board applier - adopt-or-restore, digest-verified", () => {
  interface Snapshot {
    readonly seq: number;
  }

  /** A recording transaction whose adopt verdict is scripted, tracking capture/restore ordering. */
  function makeTransaction(adopt: (m: ColosseumBoardMaterial | ColosseumDecisionMaterial) => boolean) {
    let seq = 0;
    const log: string[] = [];
    const transaction: CoopColosseumBoardTransaction<Snapshot> = {
      captureBefore: () => {
        seq += 1;
        log.push(`capture:${seq}`);
        return { seq };
      },
      adopt: (_ctx, m) => {
        log.push(`adopt:${m.surface}`);
        return adopt(m);
      },
      restore: before => {
        log.push(`restore:${before.seq}`);
      },
    };
    return { log, transaction };
  }

  const boardEntry = (): CoopAuthorityEntry => ({
    ...buildColosseumBoardInteractionEntry({
      ...base,
      operationId: "co-board",
      board: { type: "board", pinned: 0, round: 1, labels: ["Left", "Right"] },
    }),
    revision: 1,
  });

  const decisionEntry = (): CoopAuthorityEntry => ({
    ...buildColosseumBoardInteractionEntry({
      ...base,
      operationId: "co-decision",
      board: { type: "decision", pinned: 0, round: 1, index: 1 },
    }),
    revision: 2,
  });

  it("adopts a board/decision and does NOT restore on success", () => {
    const { log, transaction } = makeTransaction(() => true);
    const applier = createColosseumBoardApplier(transaction);
    expect(applier(ctxWithSeat(0), boardEntry())).toBe(true);
    expect(applier(ctxWithSeat(0), decisionEntry())).toBe(true);
    // capture then adopt on each; NO restore ever fired.
    expect(log).toEqual(["capture:1", "adopt:colosseum/board", "capture:2", "adopt:colosseum/decision"]);
  });

  it("FAILURE-path: a rejected adopt restores the immutable before-image and yields false", () => {
    const { log, transaction } = makeTransaction(() => false);
    const applier = createColosseumBoardApplier(transaction);
    expect(applier(ctxWithSeat(0), boardEntry())).toBe(false);
    // capture -> adopt(false) -> restore(before): failure is indistinguishable from no attempt.
    expect(log).toEqual(["capture:1", "adopt:colosseum/board", "restore:1"]);
  });

  it("THROW-path: a throwing adopt restores the before-image, then the throw propagates", () => {
    const { log, transaction } = makeTransaction(() => {
      throw new Error("engine fault");
    });
    const applier = createColosseumBoardApplier(transaction);
    expect(() => applier(ctxWithSeat(0), boardEntry())).toThrow("engine fault");
    // the before-image is still restored before the throw escapes.
    expect(log).toEqual(["capture:1", "adopt:colosseum/board", "restore:1"]);
  });

  it("through applyEntry a rejected Colosseum adopt is classified materialRejected (state restored)", () => {
    const { log, transaction } = makeTransaction(() => false);
    const applier = createColosseumBoardApplier(transaction);
    const rec = recordingSink();
    const out = applyEntry(ctxWithSeat(0), boardEntry(), {
      applyMaterial: applier,
      projector: fixedProjector({ kind: "installed", controlId: "x" }),
      receipts: rec.sink,
    });
    expect(out.kind).toBe("materialRejected");
    expect(rec.stages).toEqual(["admitted"]); // materialApplied withheld.
    expect(log).toContain("restore:1");
  });

  it("returns false for a non-Colosseum material", () => {
    const { transaction } = makeTransaction(() => true);
    const applier = createColosseumBoardApplier(transaction);
    const entry: CoopAuthorityEntry = {
      ...buildStormglassInteractionEntry({ ...base, operationId: "sg", weatherIndex: 0, weather: 0 }),
      revision: 1,
    };
    expect(applier(ctxWithSeat(0), entry)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Digest defense + material validation
// ---------------------------------------------------------------------------

describe("digest defense + material validation", () => {
  it("decodeInteractionMaterial refuses a tampered redelivery (payload changed under the same digest)", () => {
    const built = buildAbilityPickInteractionEntry({ ...base, operationId: "ab", data: [1, 2, 3] });
    const builtPayload = built.material.payload as AbilityPickMaterial;
    const tampered: CoopAuthorityEntry = {
      ...built,
      revision: 1,
      material: { digest: built.material.digest, payload: { ...builtPayload, data: [9, 9, 9] } },
    };
    expect(decodeInteractionMaterial(tampered)).toBeNull();

    // The applier withholds materialApplied on that tamper.
    const applier = createInteractionApplier({
      adoptLearnMove: () => true,
      adoptLearnMoveBatch: () => true,
      adoptAbilityPick: () => true,
      adoptBargain: () => true,
      adoptStormglass: () => true,
    });
    expect(applier(ctxWithSeat(0), tampered)).toBe(false);
  });

  it("rejects a wrong entry kind and malformed materials", () => {
    const notInteraction = {
      ...buildAbilityPickInteractionEntry({ ...base, operationId: "ab", data: [1] }),
      kind: "TURN_COMMIT",
      revision: 1,
    } as unknown as CoopAuthorityEntry;
    expect(decodeInteractionMaterial(notInteraction)).toBeNull();

    // Field-level validation.
    expect(validateInteractionMaterial({ surface: "ability-pick", ownerSeatId: -1, data: [1] }).ok).toBe(false);
    expect(validateInteractionMaterial({ surface: "ability-pick", ownerSeatId: 0, data: ["x"] }).ok).toBe(false);
    expect(
      validateInteractionMaterial({ surface: "colosseum/decision", ownerSeatId: 0, pinned: 0, round: 0, index: 2 }).ok,
    ).toBe(false);
    expect(
      validateInteractionMaterial({
        surface: "colosseum/board",
        ownerSeatId: 0,
        pinned: 0,
        round: COOP_INTERACTION_COLOSSEUM_MAX_ROUND + 1,
        labels: ["a"],
      }).ok,
    ).toBe(false);
    expect(
      validateInteractionMaterial({ surface: "bargain", ownerSeatId: 0, choiceIndex: 0, outcome: undefined }).ok,
    ).toBe(false);
    expect(validateInteractionMaterial({ surface: "nope", ownerSeatId: 0 }).ok).toBe(false);
    expect(validateInteractionMaterial(null).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shadow parity
// ---------------------------------------------------------------------------

describe("shadow parity", () => {
  it("an independently-built identical entry is parity-equal to the authority's", () => {
    const successor: CoopNextControl = { kind: "REWARD", operationId: "op-reward", ownerSeatId: 1 };
    const build = () =>
      buildLearnMoveBatchInteractionEntry({
        ...base,
        operationId: "lmb",
        choice: { phase: "decision", partySlot: 2, assignments: [[10, 1]], fallback: true },
        successor,
      });
    const authority = shadowOfInteractionEntry(build());
    const shadow = shadowOfInteractionEntry(build());
    expect(authority).not.toBeNull();
    expect(shadow).not.toBeNull();
    if (authority == null || shadow == null) {
      return;
    }
    expect(interactionShadowsAgree(authority, shadow)).toBe(true);
    expect(authority.surface).toBe("learn-move-batch/decision");
    expect(authority.ownerSeatId).toBe(1);
    expect(authority.successorControlId).toBe(controlIdOf(successor));
  });

  it("a diverging choice fails parity (different digest)", () => {
    const authority = shadowOfInteractionEntry(
      buildStormglassInteractionEntry({ ...base, operationId: "sg", weatherIndex: 1, weather: 2 }),
    );
    const shadow = shadowOfInteractionEntry(
      buildStormglassInteractionEntry({ ...base, operationId: "sg", weatherIndex: 2, weather: 2 }),
    );
    expect(authority).not.toBeNull();
    expect(shadow).not.toBeNull();
    if (authority == null || shadow == null) {
      return;
    }
    expect(interactionShadowsAgree(authority, shadow)).toBe(false);
    expect(authority.digest).not.toBe(shadow.digest);
  });

  it("returns null for a non-interaction entry", () => {
    const notInteraction = {
      ...buildAbilityPickInteractionEntry({ ...base, operationId: "ab", data: [1] }),
      kind: "WAVE_ADVANCE",
    } as unknown as CoopAuthorityEntry;
    expect(shadowOfInteractionEntry(notInteraction)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zero-leak teardown through the foundation log
// ---------------------------------------------------------------------------

describe("zero-leak teardown through the authority log", () => {
  let scheduler: FakeScheduler;
  let sent: CoopAuthorityWire[];

  beforeEach(() => {
    scheduler = new FakeScheduler();
    sent = [];
  });

  it("commits interaction entries, drives one to retirement, and dispose leaves no timers", () => {
    const log = makeLog(scheduler, sent);

    const stormglass = log.commit(
      buildStormglassInteractionEntry({ ...base, operationId: "sg", weatherIndex: 0, weather: 0 }),
    );
    const colosseum = log.commit(
      buildColosseumBoardInteractionEntry({
        ...base,
        operationId: "co",
        board: { type: "decision", pinned: 0, round: 0, index: 0 },
      }),
    );
    expect(log.retained().map(e => e.revision)).toEqual([stormglass.revision, colosseum.revision]);
    expect(scheduler.liveCount()).toBeGreaterThan(0);

    // A null-successor interaction retires at materialApplied (no controlInstalled due).
    log.acceptReceipt(receipt(stormglass, "admitted"));
    expect(log.acceptReceipt(receipt(stormglass, "materialApplied"))).toBe(true);
    expect(log.retained().map(e => e.revision)).toEqual([colosseum.revision]);

    log.dispose("teardown");
    const diag = log.diagnostics();
    expect(diag.retainedEntries).toBe(0);
    expect(diag.deliveryLeases).toBe(0);
    expect(diag.activeDeliveryTimers).toBe(0);
    expect(diag.disposed).toBe(true);
    expect(scheduler.liveCount()).toBe(0);
  });
});
