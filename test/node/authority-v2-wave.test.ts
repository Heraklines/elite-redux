/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Migration C node-pure tests (authority-v2-wave).
//
// The wave/terminal adapter's import graph is engine/DOM-free (TYPE-only contract
// import + the pure next-control / authority-entry / replica helpers), so it runs
// in the node-pure project in milliseconds. These pin Migration C's load-bearing
// behaviours:
//   - destination coverage for all five nextControl kinds (REWARD/BIOME/COMMAND/
//     MYSTERY on a WAVE_ADVANCE; TERMINAL on a TERMINAL_COMMIT).
//   - a TERMINAL_COMMIT supersedes an unretired turn entry at the LOG level: the
//     stale wait's lease cancels and both sides converge on TERMINAL, via the
//     foundation log's subsumes mechanism (no special abort predicate).
//   - a WAVE_ADVANCE subsumes prior SAME-WAVE turn/replacement entries only.
//   - material completeness validation (guards + fail-loud builders).
//   - the replica applier ADOPTS the typed material (never derives).
//   - shadow parity (authority statement == what a shadow derivation produces).
//   - zero-leak teardown (dispose leaves no timers/leases).
// =============================================================================

import {
  buildTerminalCommitEntry,
  buildWaveAdvanceEntry,
  type CoopTerminalMaterialV2,
  CoopWaveTerminalBuildError,
  type CoopWaveTerminalSink,
  type CoopWaveTransitionMaterialV2,
  checkWaveTerminalParity,
  createWaveTerminalApplier,
  digestOfMaterial,
  entryControlWave,
  isValidTerminalMaterial,
  isValidWaveTransitionMaterial,
  shadowOfWaveTerminalEntry,
  terminalSubsumes,
  waveBoundarySubsumes,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
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

/** A deterministic CoopScheduler: timers are inspectable + cancellation is exact (mirrors the log test double). */
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

  ownerCount(ownerId: string): number {
    return [...this.timers.values()].filter(t => t.ownerId === ownerId).length;
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

const PIPELINE_BOOKKEEPING = {
  receiptContext: frameContext({ senderSeatId: 1 }),
  recordStage: () => true,
};

function makeLog(scheduler: FakeScheduler, sent: CoopAuthorityWire[], over: Partial<AuthorityLogOptions> = {}) {
  return new AuthorityLog({
    localContext: frameContext(),
    scheduler,
    send: wire => sent.push(wire),
    peerBindings: [{ seatId: 1, connectionGeneration: frameContext().connectionGeneration }],
    ...over,
  });
}

/** A TURN_COMMIT input whose stated control is a COMMAND on `wave` (an in-wave turn wait). */
function turnEntryInput(wave: number, turn: number): Omit<CoopAuthorityEntry, "revision"> {
  const nextControl: CoopNextControl = {
    kind: "COMMAND_FRONTIER",
    epoch: 1,
    wave,
    turn,
    commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
  };
  return {
    context: frameContext(),
    operationId: `turn-w${wave}-t${turn}`,
    kind: "TURN_COMMIT",
    material: { digest: `turn-w${wave}-t${turn}`, payload: { wave, turn } },
    nextControl,
    subsumes: [],
  };
}

/** A TURN_COMMIT that explicitly yields to one of the named non-command entry kinds. */
function turnAwaitEntryInput(
  wave: number,
  turn: number,
  allowedKinds: Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }>["allowedKinds"],
): Omit<CoopAuthorityEntry, "revision"> {
  const entry = turnEntryInput(wave, turn);
  return {
    ...entry,
    nextControl: {
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: entry.operationId,
      epoch: 1,
      wave,
      turn,
      allowedKinds,
      expectedOperationId: null,
    },
  };
}

/** A REPLACEMENT_COMMIT input whose stated control is an ordered same-wave replacement wait. */
function replacementEntryInput(
  wave: number,
  allowedKinds: Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }>["allowedKinds"] = ["REPLACEMENT_COMMIT"],
): Omit<CoopAuthorityEntry, "revision"> {
  const nextControl: CoopNextControl = {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId: `repl-w${wave}`,
    epoch: 1,
    wave,
    turn: 1,
    allowedKinds,
    expectedOperationId: null,
  };
  return {
    context: frameContext(),
    operationId: `repl-w${wave}`,
    kind: "REPLACEMENT_COMMIT",
    material: { digest: `repl-w${wave}`, payload: { wave } },
    nextControl,
    subsumes: [],
  };
}

const WIN_TRANSITION: CoopWaveTransitionMaterialV2 = {
  kind: "wave-advance",
  wave: 3,
  turn: 2,
  outcome: "win",
  nextWave: 4,
  biomeChange: false,
  eggLapse: true,
  meBoundary: "none",
  victoryKind: "wild",
};

const GAME_OVER_TERMINAL: CoopTerminalMaterialV2 = {
  kind: "terminal",
  terminalId: "term-gameover-w3",
  reason: "game-over",
  wave: 3,
  turn: 2,
};

const reward = (): CoopNextControl => ({ kind: "REWARD", operationId: "op-reward-w3", ownerSeatId: 0 });
const biome = (): CoopNextControl => ({ kind: "BIOME", operationId: "op-biome-w3", ownerSeatId: 0 });
const mystery = (): CoopNextControl => ({ kind: "MYSTERY", operationId: "op-mystery-w3", ownerSeatId: 1 });
const command = (): CoopNextControl => ({
  kind: "COMMAND_FRONTIER",
  epoch: 1,
  wave: 4,
  turn: 1,
  commands: [{ ownerSeatId: 0, pokemonId: 7, fieldIndex: 0 }],
});

function receipt(entry: CoopAuthorityEntry, stage: "admitted" | "materialApplied" | "controlInstalled") {
  return {
    context: { ...entry.context, senderSeatId: 1 },
    revision: entry.revision,
    operationId: entry.operationId,
    stage,
    ...(stage === "controlInstalled" && entry.nextControl != null ? { controlId: controlIdOf(entry.nextControl) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Destination coverage for all five nextControl kinds
// ---------------------------------------------------------------------------

describe("buildWaveAdvanceEntry - destination coverage", () => {
  const cases: [string, CoopNextControl][] = [
    ["REWARD", reward()],
    ["BIOME", biome()],
    ["COMMAND", command()],
    ["MYSTERY", mystery()],
  ];

  for (const [name, destination] of cases) {
    it(`states the ${name} destination and the complete transition material`, () => {
      const entry = buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: `wave-adv-w3-${name}`,
        transition: WIN_TRANSITION,
        destination: destination as never,
      });
      expect(entry.kind).toBe("WAVE_ADVANCE");
      expect(entry.nextControl).toEqual(destination);
      expect(controlIdOf(entry.nextControl as NonNullable<CoopNextControl>)).toBe(
        controlIdOf(destination as NonNullable<CoopNextControl>),
      );
      // The material IS the complete transition and its digest is deterministic.
      expect(entry.material.payload).toEqual(WIN_TRANSITION);
      expect(entry.material.digest).toBe(digestOfMaterial(WIN_TRANSITION));
    });
  }

  it("covers the fifth kind (TERMINAL) via buildTerminalCommitEntry", () => {
    const entry = buildTerminalCommitEntry({
      context: frameContext(),
      operationId: "terminal-w3",
      terminal: GAME_OVER_TERMINAL,
    });
    expect(entry.kind).toBe("TERMINAL_COMMIT");
    expect(entry.nextControl).toEqual({ kind: "TERMINAL", terminalId: GAME_OVER_TERMINAL.terminalId });
    expect(entry.material.payload).toEqual(GAME_OVER_TERMINAL);
    expect(entry.material.digest).toBe(digestOfMaterial(GAME_OVER_TERMINAL));
  });

  it("rejects a COMMAND destination that does not address nextWave/turn-1 (fail loud)", () => {
    expect(() =>
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wave-adv-bad-command",
        transition: WIN_TRANSITION,
        // nextWave is 4; a COMMAND on wave 5 (or turn 2) is a mis-addressed advance.
        destination: {
          kind: "COMMAND_FRONTIER",
          epoch: 1,
          wave: 5,
          turn: 1,
          commands: [{ ownerSeatId: 0, pokemonId: 7, fieldIndex: 0 }],
        },
      }),
    ).toThrow(CoopWaveTerminalBuildError);
  });

  it("rejects a TERMINAL / REPLACEMENT destination on a wave-advance", () => {
    expect(() =>
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wave-adv-terminal-dest",
        transition: WIN_TRANSITION,
        destination: { kind: "TERMINAL", terminalId: "x" } as never,
      }),
    ).toThrow(CoopWaveTerminalBuildError);
  });
});

// ---------------------------------------------------------------------------
// Material completeness validation
// ---------------------------------------------------------------------------

describe("material completeness validation", () => {
  it("accepts a complete transition and rejects incomplete/inconsistent ones", () => {
    expect(isValidWaveTransitionMaterial(WIN_TRANSITION)).toBe(true);
    expect(
      isValidWaveTransitionMaterial({
        ...WIN_TRANSITION,
        authorityCarrier: {
          authoritativeState: { version: 1, tick: 10, wave: 3, turn: 2 },
          transition: { outcome: "win", wave: 3 },
        },
      }),
    ).toBe(true);
    expect(
      isValidWaveTransitionMaterial({
        ...WIN_TRANSITION,
        authorityCarrier: { authoritativeState: null, transition: { outcome: "win" } },
      }),
    ).toBe(false);
    expect(
      isValidWaveTransitionMaterial({
        ...WIN_TRANSITION,
        authorityCarrier: { authoritativeState: { tick: 10 }, transition: null },
      }),
    ).toBe(false);
    // flee must NOT carry a victoryKind.
    expect(isValidWaveTransitionMaterial({ ...WIN_TRANSITION, outcome: "flee", victoryKind: "wild" })).toBe(false);
    // a valid flee has no victoryKind.
    expect(isValidWaveTransitionMaterial({ ...WIN_TRANSITION, outcome: "flee", victoryKind: undefined })).toBe(true);
    // win MUST carry a victoryKind.
    expect(isValidWaveTransitionMaterial({ ...WIN_TRANSITION, victoryKind: undefined })).toBe(false);
    // bad discriminant / missing fields / bad enum.
    expect(isValidWaveTransitionMaterial({ ...WIN_TRANSITION, kind: "terminal" })).toBe(false);
    expect(isValidWaveTransitionMaterial({ ...WIN_TRANSITION, meBoundary: "bogus" })).toBe(false);
    expect(isValidWaveTransitionMaterial({ ...WIN_TRANSITION, wave: -1 })).toBe(false);
    expect(isValidWaveTransitionMaterial(null)).toBe(false);
  });

  it("accepts a complete terminal and rejects incomplete ones", () => {
    expect(isValidTerminalMaterial(GAME_OVER_TERMINAL)).toBe(true);
    expect(
      isValidTerminalMaterial({
        ...GAME_OVER_TERMINAL,
        authorityCarrier: {
          authoritativeState: { version: 1, tick: 10, wave: 3, turn: 2 },
          transition: { outcome: "gameOver", wave: 3 },
        },
      }),
    ).toBe(true);
    expect(
      isValidTerminalMaterial({
        ...GAME_OVER_TERMINAL,
        authorityCarrier: { authoritativeState: [], transition: { outcome: "gameOver" } },
      }),
    ).toBe(false);
    for (const reason of ["game-over", "final-flee", "final-boss-credits", "shared-fault"] as const) {
      expect(isValidTerminalMaterial({ ...GAME_OVER_TERMINAL, reason })).toBe(true);
    }
    expect(isValidTerminalMaterial({ ...GAME_OVER_TERMINAL, terminalId: "" })).toBe(false);
    expect(isValidTerminalMaterial({ ...GAME_OVER_TERMINAL, reason: "nope" })).toBe(false);
    expect(isValidTerminalMaterial({ ...GAME_OVER_TERMINAL, wave: 1.5 })).toBe(false);
    expect(isValidTerminalMaterial(undefined)).toBe(false);
  });

  it("the builders throw on malformed material / operationId", () => {
    expect(() =>
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "",
        transition: WIN_TRANSITION,
        destination: reward() as never,
      }),
    ).toThrow(CoopWaveTerminalBuildError);
    expect(() =>
      buildTerminalCommitEntry({
        context: frameContext(),
        operationId: "t",
        terminal: { ...GAME_OVER_TERMINAL, terminalId: "" },
      }),
    ).toThrow(CoopWaveTerminalBuildError);
    // A subsumes with a non-positive revision is a build error.
    expect(() =>
      buildTerminalCommitEntry({
        context: frameContext(),
        operationId: "t",
        terminal: GAME_OVER_TERMINAL,
        subsumes: [0],
      }),
    ).toThrow(CoopWaveTerminalBuildError);
  });
});

// ---------------------------------------------------------------------------
// Wave-boundary supersession helpers (pure)
// ---------------------------------------------------------------------------

describe("waveBoundarySubsumes / terminalSubsumes / entryControlWave", () => {
  it("entryControlWave reads the wave only from COMMAND/REPLACEMENT controls", () => {
    expect(entryControlWave({ ...turnEntryInput(3, 1), revision: 1 })).toBe(3);
    expect(entryControlWave({ ...replacementEntryInput(3), revision: 2 })).toBe(3);
    // A reward/biome/terminal/null control has no wave coordinate.
    const rewardEntry: CoopAuthorityEntry = {
      ...buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: WIN_TRANSITION,
        destination: reward() as never,
      }),
      revision: 3,
    };
    expect(entryControlWave(rewardEntry)).toBeNull();
  });

  it("waveBoundarySubsumes selects ONLY same-wave turn/replacement entries", () => {
    const retained: CoopAuthorityEntry[] = [
      { ...turnEntryInput(3, 1), revision: 1 },
      { ...turnEntryInput(3, 2), revision: 2 },
      { ...replacementEntryInput(3), revision: 3 },
      { ...turnEntryInput(4, 1), revision: 4 }, // a DIFFERENT wave - not subsumed.
    ];
    expect(waveBoundarySubsumes(retained, 3)).toEqual([1, 2, 3]);
    expect(waveBoundarySubsumes(retained, 4)).toEqual([4]);
    expect(waveBoundarySubsumes(retained, 9)).toEqual([]);
  });

  it("terminalSubsumes selects every unretired non-terminal entry", () => {
    const waveAdv: CoopAuthorityEntry = {
      ...buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: WIN_TRANSITION,
        destination: reward() as never,
      }),
      revision: 5,
    };
    const retained: CoopAuthorityEntry[] = [
      { ...turnEntryInput(3, 1), revision: 1 },
      waveAdv,
      {
        ...buildTerminalCommitEntry({ context: frameContext(), operationId: "t", terminal: GAME_OVER_TERMINAL }),
        revision: 6,
      },
    ];
    // Everything but the existing terminal (a terminal never subsumes another terminal).
    expect(terminalSubsumes(retained)).toEqual([1, 5]);
  });
});

// ---------------------------------------------------------------------------
// LOG-LEVEL: a WAVE_ADVANCE subsumes prior same-wave entries
// ---------------------------------------------------------------------------

describe("WAVE_ADVANCE supersession at the log", () => {
  let scheduler: FakeScheduler;
  let sent: CoopAuthorityWire[];

  beforeEach(() => {
    scheduler = new FakeScheduler();
    sent = [];
  });

  it("retires same-wave turn/replacement entries and keeps a different-wave one", () => {
    const log = makeLog(scheduler, sent);
    const turnW3T1 = log.commit(turnAwaitEntryInput(3, 1, ["REPLACEMENT_COMMIT"])); // rev 1
    const replW3 = log.commit(replacementEntryInput(3, ["TURN_COMMIT"])); // rev 2
    const turnW4 = log.commit(turnAwaitEntryInput(4, 1, ["WAVE_ADVANCE"])); // rev 3 (different wave)
    expect(log.retained().map(e => e.revision)).toEqual([1, 2, 3]);

    // Build the advance's subsumes from the live retained frontier.
    const subsumes = waveBoundarySubsumes(log.retained(), 3);
    expect(subsumes).toEqual([1, 2]);

    const advance = log.commit(
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wave-adv-w3",
        transition: WIN_TRANSITION,
        destination: reward() as never,
        subsumes,
      }),
    );
    expect(advance.revision).toBe(4);

    // Admitting the advance retires the two same-wave entries (supersession by log order).
    log.acceptReceipt(receipt(advance, "admitted"));
    expect(
      log
        .retained()
        .map(e => e.revision)
        .sort((a, b) => a - b),
    ).toEqual([3, 4]);
    // Their leases (and timers) are cancelled.
    expect(scheduler.ownerCount(`authority-v2:session-A:seat0:deliver:${turnW3T1.revision}`)).toBe(0);
    expect(scheduler.ownerCount(`authority-v2:session-A:seat0:deliver:${replW3.revision}`)).toBe(0);
    // The different-wave turn is untouched, still delivering.
    expect(scheduler.ownerCount(`authority-v2:session-A:seat0:deliver:${turnW4.revision}`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// LOG-LEVEL: a TERMINAL_COMMIT supersedes an unretired (stale) turn wait
// ---------------------------------------------------------------------------

describe("TERMINAL_COMMIT supersedes an unretired turn wait", () => {
  let scheduler: FakeScheduler;
  let sent: CoopAuthorityWire[];

  beforeEach(() => {
    scheduler = new FakeScheduler();
    sent = [];
  });

  it("cancels the stale wait's lease with no abort predicate; both converge on TERMINAL", () => {
    const log = makeLog(scheduler, sent);
    // A stale turn wait: committed, retained, its redelivery timer armed, and it will NEVER
    // reach controlInstalled (the host resolves the run instead of the turn).
    const staleTurn = log.commit(turnAwaitEntryInput(3, 2, ["TERMINAL_COMMIT"])); // rev 1
    expect(log.retained().map(e => e.revision)).toEqual([1]);
    expect(scheduler.ownerCount(`authority-v2:session-A:seat0:deliver:${staleTurn.revision}`)).toBe(1);

    // The terminal is the canonical successor of the final live events - it subsumes them.
    const subsumes = terminalSubsumes(log.retained());
    expect(subsumes).toEqual([1]);
    const terminal = log.commit(
      buildTerminalCommitEntry({
        context: frameContext(),
        operationId: "terminal-w3",
        terminal: GAME_OVER_TERMINAL,
        subsumes,
      }),
    );
    expect(terminal.revision).toBe(2);

    // Admitting the terminal retires the stale turn via subsumes (no special abort predicate).
    log.acceptReceipt(receipt(terminal, "admitted"));
    // The stale wait is gone; its lease + timer are cancelled.
    expect(log.retained().map(e => e.revision)).toEqual([2]);
    expect(scheduler.ownerCount(`authority-v2:session-A:seat0:deliver:${staleTurn.revision}`)).toBe(0);

    // Both sides converge on TERMINAL: the terminal entry is retained until it reaches
    // controlInstalled (its nextControl is non-null), and it is the ONLY retained entry.
    const [remaining] = log.retained();
    expect(remaining.kind).toBe("TERMINAL_COMMIT");
    expect(remaining.nextControl).toEqual({ kind: "TERMINAL", terminalId: GAME_OVER_TERMINAL.terminalId });

    // Driving the terminal to its required stage retires it too.
    log.acceptReceipt(receipt(terminal, "materialApplied"));
    expect(log.acceptReceipt(receipt(terminal, "controlInstalled"))).toBe(true);
    expect(log.retained()).toHaveLength(0);
  });

  it("zero-leak teardown: dispose leaves no timers or leases", () => {
    const log = makeLog(scheduler, sent);
    log.commit(turnAwaitEntryInput(3, 2, ["TERMINAL_COMMIT"]));
    log.commit(
      buildTerminalCommitEntry({
        context: frameContext(),
        operationId: "t",
        terminal: GAME_OVER_TERMINAL,
        subsumes: [1],
      }),
    );
    expect(scheduler.liveCount()).toBeGreaterThan(0);

    log.dispose("teardown");
    const diag = log.diagnostics();
    expect(diag.retainedEntries).toBe(0);
    expect(diag.deliveryLeases).toBe(0);
    expect(diag.activeDeliveryTimers).toBe(0);
    expect(diag.disposed).toBe(true);
    expect(scheduler.liveCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// REPLICA: the applier ADOPTS the typed material (never derives)
// ---------------------------------------------------------------------------

function ctxWithSeat(localSeatId: number): CoopRuntimeContext {
  return { localSeatId } as unknown as CoopRuntimeContext;
}

function recordingSink(): {
  sink: ReplicaReceiptSink;
  stages: string[];
} {
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

describe("createWaveTerminalApplier (replica adoption)", () => {
  it("adopts a complete WAVE_ADVANCE material through the sink and reaches controlInstalled", () => {
    const adopted: CoopWaveTransitionMaterialV2[] = [];
    const terminals: CoopTerminalMaterialV2[] = [];
    const sink: CoopWaveTerminalSink = {
      adoptWaveTransition: (_ctx, m) => adopted.push(m),
      adoptTerminal: (_ctx, m) => terminals.push(m),
    };
    const applier = createWaveTerminalApplier(sink);
    const entry: CoopAuthorityEntry = {
      ...buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: WIN_TRANSITION,
        destination: reward() as never,
      }),
      revision: 1,
    };
    const rec = recordingSink();
    const out = applyEntry(ctxWithSeat(1), entry, {
      applyMaterial: applier,
      projector: fixedProjector({
        kind: "installed",
        controlId: controlIdOf(reward() as NonNullable<CoopNextControl>),
      }),
      receipts: rec.sink,
      ...PIPELINE_BOOKKEEPING,
    });
    // The guest ADOPTED the typed transition (never derived it) and then installed the stated control.
    expect(adopted).toEqual([WIN_TRANSITION]);
    expect(terminals).toHaveLength(0);
    expect(rec.stages).toEqual(["admitted", "materialApplied", "controlInstalled"]);
    expect(out.kind).toBe("applied");
  });

  it("adopts a TERMINAL_COMMIT material through the sink", () => {
    const terminals: CoopTerminalMaterialV2[] = [];
    const sink: CoopWaveTerminalSink = {
      adoptWaveTransition: () => {
        throw new Error("wave sink must not fire for a terminal");
      },
      adoptTerminal: (_ctx, m) => terminals.push(m),
    };
    const applier = createWaveTerminalApplier(sink);
    const entry: CoopAuthorityEntry = {
      ...buildTerminalCommitEntry({ context: frameContext(), operationId: "t", terminal: GAME_OVER_TERMINAL }),
      revision: 1,
    };
    expect(applier(ctxWithSeat(0), entry)).toBe(true);
    expect(terminals).toEqual([GAME_OVER_TERMINAL]);
  });

  it("withholds materialApplied on a digest mismatch (tamper/duplicate defense)", () => {
    const sink: CoopWaveTerminalSink = { adoptWaveTransition: () => {}, adoptTerminal: () => {} };
    const applier = createWaveTerminalApplier(sink);
    const base = buildWaveAdvanceEntry({
      context: frameContext(),
      operationId: "wa",
      transition: WIN_TRANSITION,
      destination: reward() as never,
    });
    // A redelivery that smuggled a different payload under the same digest is rejected.
    const tampered: CoopAuthorityEntry = {
      ...base,
      revision: 1,
      material: { digest: base.material.digest, payload: { ...WIN_TRANSITION, nextWave: 99 } },
    };
    expect(applier(ctxWithSeat(0), tampered)).toBe(false);
  });

  it("returns false for an entry kind it does not own", () => {
    const sink: CoopWaveTerminalSink = { adoptWaveTransition: () => {}, adoptTerminal: () => {} };
    const applier = createWaveTerminalApplier(sink);
    expect(applier(ctxWithSeat(0), { ...turnEntryInput(3, 1), revision: 1 })).toBe(false);
  });

  it("rejects a TERMINAL entry whose control terminalId disagrees with its material", () => {
    const sink: CoopWaveTerminalSink = { adoptWaveTransition: () => {}, adoptTerminal: () => {} };
    const applier = createWaveTerminalApplier(sink);
    const base = buildTerminalCommitEntry({ context: frameContext(), operationId: "t", terminal: GAME_OVER_TERMINAL });
    const mismatched: CoopAuthorityEntry = {
      ...base,
      revision: 1,
      nextControl: { kind: "TERMINAL", terminalId: "a-different-terminal" },
    };
    expect(applier(ctxWithSeat(0), mismatched)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shadow parity
// ---------------------------------------------------------------------------

describe("shadow parity", () => {
  it("an independently-built identical entry is parity-equal to the authority's", () => {
    const build = () =>
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: WIN_TRANSITION,
        destination: command() as never,
      });
    const authority = shadowOfWaveTerminalEntry(build());
    const shadow = shadowOfWaveTerminalEntry(build());
    expect(checkWaveTerminalParity(authority, shadow)).toEqual({ ok: true });
    expect(authority.wave).toBe(WIN_TRANSITION.wave);
    expect(authority.nextWave).toBe(WIN_TRANSITION.nextWave);
    expect(authority.controlId).toBe(controlIdOf(command() as NonNullable<CoopNextControl>));
  });

  it("a diverging destination fails loud with the offending field named", () => {
    const authority = shadowOfWaveTerminalEntry(
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: WIN_TRANSITION,
        destination: reward() as never,
      }),
    );
    const shadow = shadowOfWaveTerminalEntry(
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: WIN_TRANSITION,
        destination: biome() as never,
      }),
    );
    const verdict = checkWaveTerminalParity(authority, shadow);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("controlId");
    }
  });

  it("a diverging transition (different nextWave) fails parity on the material digest", () => {
    const authority = shadowOfWaveTerminalEntry(
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: WIN_TRANSITION,
        destination: reward() as never,
      }),
    );
    const shadow = shadowOfWaveTerminalEntry(
      buildWaveAdvanceEntry({
        context: frameContext(),
        operationId: "wa",
        transition: { ...WIN_TRANSITION, nextWave: 5, biomeChange: true },
        destination: reward() as never,
      }),
    );
    const verdict = checkWaveTerminalParity(authority, shadow);
    expect(verdict.ok).toBe(false);
  });
});
