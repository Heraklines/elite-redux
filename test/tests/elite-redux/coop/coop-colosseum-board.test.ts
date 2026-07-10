/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op COLOSSEUM between-rounds board relay (#829). The Colosseum's CONTINUE / CASH-OUT board is a
// bespoke UiMode.COLOSSEUM choice that opens between gauntlet rounds. In co-op the board decision is
// made by the encounter OWNER and streamed on a DEDICATED seq (7_600_000 + pinned ME counter), so a
// board present / decision can never FIFO-collide with the per-round ME-battle handoff (8M/9M bands).
// This locks the wire protocol's contract over a LoopbackTransport (the engine-free "test via spoofing"
// path the rest of the co-op suite uses - no GameManager / no Phaser boot):
//
//   1. coopColosseumStreamBoard STREAMS a `mePresent` carrying `subPrompt: { kind: "secondary", labels }`
//      on the board seq's OUTCOME inbox (the channel a watcher / guest owner reads to render the SAME
//      two-option decision) - REUSING the frozen mePresent wire shape, no new transport union member.
//   2. coopColosseumSendDecision RELAYS the resolved index on the board seq's CHOICE inbox, and
//      coopColosseumAwaitDecision resolves to exactly that index (the host adopting a guest-owned pick,
//      or the guest watcher adopting a host-owned pick - one seq, both directions).
//   3. coopColosseumBoardOwnedLocally resolves board ownership from the pinned-counter parity (even ->
//      host, odd -> guest), the SAME rule the whole ME uses, so the gauntlet is one stable owner.
//
// The real production helpers are driven through the real relay (assembled runtime); the seq BASE is
// imported-by-value from the SOURCE constant so the test tracks production, not a copy.

import {
  COOP_COLOSSEUM_SEQ_BASE,
  type CoopColosseumRoundOps,
  coopColosseumAwaitDecision,
  coopColosseumBoardOwnedLocally,
  coopColosseumSendDecision,
  coopColosseumSeq,
  coopColosseumStreamBoard,
  runColosseumGuestRoundLoop,
} from "#data/elite-redux/coop/coop-colosseum";
import {
  resetCoopColosseumOperationFlag,
  setCoopColosseumOperationEnabled,
} from "#data/elite-redux/coop/coop-colosseum-operation";
import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import { COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-me-pump";
import {
  assembleCoopRuntime,
  clearCoopRuntime,
  getCoopInteractionRelay,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome, CoopMessage, CoopSerializedEnemy } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { COLOSSEUM_CASH_OUT, COLOSSEUM_CONTINUE } from "#ui/colosseum-ui-handler";
import { afterEach, describe, expect, it } from "vitest";

/** The board's two decision labels (index 0 == CONTINUE, index 1 == CASH OUT); asserted verbatim on the wire. */
const BOARD_LABELS = ["CONTINUE (risk for S+)", "CASH OUT (claim S)"];

describe("co-op Colosseum between-rounds board relay (#829)", () => {
  afterEach(() => {
    resetCoopColosseumOperationFlag();
    clearCoopRuntime();
    setCoopMeInteractionStart(-1); // drop the ME pin so the next file starts clean
  });

  /**
   * Stand up an authoritative HOST runtime (its interactionRelay is what the board helpers read via
   * getCoopInteractionRelay), pin the ME on `start`, and pair a bare GUEST relay on the other loopback
   * end so the test can watch what the partner receives and reply as the board owner / watcher would.
   */
  const rig = (start: number) => {
    const { host, guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    setCoopRuntime(runtime);
    setCoopMeInteractionStart(start);
    return { seq: coopColosseumSeq(start), guestRelay: new CoopInteractionRelay(guest) };
  };

  it("derives the board seq from the pinned counter in the dedicated band", () => {
    expect(coopColosseumSeq(4)).toBe(COOP_COLOSSEUM_SEQ_BASE + 4);
    // A not-in-ME (-1) read is clamped so a stray call never lands on a negative / colliding seq.
    expect(coopColosseumSeq(-1)).toBe(COOP_COLOSSEUM_SEQ_BASE);
  });

  it("streams the board present + relays the decision so the partner watcher adopts both (host-owned)", async () => {
    // Host-owned board (even counter): the host DRIVES its real board and streams the present + its
    // resolved decision; the guest watcher adopts exactly what the host picked, no local re-derivation.
    const { seq, guestRelay } = rig(4);
    expect(coopColosseumBoardOwnedLocally()).toBe(true); // even counter -> host owns

    coopColosseumStreamBoard([...BOARD_LABELS]);
    const present = await guestRelay.awaitInteractionOutcome(seq);
    expect(present?.k).toBe("mePresent");
    if (present?.k !== "mePresent") {
      throw new Error("board present kind lost over the wire");
    }
    expect(present.subPrompt).toEqual({ kind: "secondary", labels: BOARD_LABELS });

    coopColosseumSendDecision(1); // CASH OUT
    const decision = await guestRelay.awaitInteractionChoice(seq);
    expect(decision?.choice).toBe(1);
  });

  it("keeps the pure legacy board/pick carriers working when the operation flag is off", async () => {
    setCoopColosseumOperationEnabled(false);
    const { seq, guestRelay } = rig(4);
    coopColosseumStreamBoard([...BOARD_LABELS]);
    expect((await guestRelay.awaitInteractionOutcome(seq))?.k).toBe("mePresent");
    coopColosseumSendDecision(COLOSSEUM_CASH_OUT);
    expect((await guestRelay.awaitInteractionChoice(seq))?.choice).toBe(COLOSSEUM_CASH_OUT);
  });

  it("DURABILITY: dropping only coloBoard still materializes the committed board for the guest", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionOutcome" && msg.kind === "coloBoard",
      },
      { seed: 0xc010 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    setCoopMeInteractionStart(4);

    coopColosseumStreamBoard([...BOARD_LABELS]);
    const present = await guestRuntime.interactionRelay.awaitInteractionOutcome(coopColosseumSeq(4), 25);

    expect(pair.faultsInjected(), "the raw coloBoard carrier was actually dropped").toBe(1);
    expect(present?.k, "the committed board reached the real guest outcome FIFO").toBe("mePresent");
    if (present?.k === "mePresent") {
      expect(present.subPrompt).toEqual({ kind: "secondary", labels: BOARD_LABELS });
    }
  });

  it("DURABILITY: dropping only coloPick still materializes the committed decision for the guest", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "coloPick",
      },
      { seed: 0xc011 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    setCoopMeInteractionStart(4);

    coopColosseumSendDecision(COLOSSEUM_CONTINUE);
    const decision = await guestRuntime.interactionRelay.awaitInteractionChoice(coopColosseumSeq(4), 25);

    expect(pair.faultsInjected(), "the raw coloPick carrier was actually dropped").toBe(1);
    expect(decision?.choice, "the committed decision reached the real guest choice FIFO").toBe(COLOSSEUM_CONTINUE);
  });

  it("awaits the guest owner's relayed decision index (guest-owned)", async () => {
    // Guest-owned board (odd counter): the guest DRIVES its board and relays its picked index; the host
    // (sole engine) awaits it on the SAME board seq and resolves to exactly that index, then applies it.
    const { seq, guestRelay } = rig(5);
    expect(coopColosseumBoardOwnedLocally()).toBe(false); // odd counter -> guest owns

    const hostAwait = coopColosseumAwaitDecision();
    guestRelay.sendInteractionChoice(seq, "coloPick", 0); // CONTINUE
    expect(await hostAwait).toBe(0);
  });

  it("resolves null when the partner never relays (disconnect ceiling), so neither client hangs", async () => {
    // No relay at all (no session): the awaiter resolves null immediately - the caller then falls back.
    clearCoopRuntime();
    setCoopMeInteractionStart(3);
    expect(await coopColosseumAwaitDecision(1)).toBeNull();
  });

  it("the board present wire shape is pure JSON (survives a serialize round-trip byte-identical)", () => {
    // The exact `mePresent` the board streams must be plain JSON (the transport structured-clones it),
    // so a board relay can never lose the labels or the subPrompt kind on the wire.
    const present: CoopInteractionOutcome = {
      k: "mePresent",
      tokens: {},
      meetsReqs: [],
      labels: [],
      subPrompt: { kind: "secondary", labels: [...BOARD_LABELS] },
    };
    const msg: CoopMessage = {
      t: "interactionOutcome",
      seq: COOP_COLOSSEUM_SEQ_BASE + 1,
      kind: "coloBoard",
      outcome: present,
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});

// =============================================================================
// #829 PART 2: the GUEST between-rounds ROUND LOOP (runColosseumGuestRoundLoop). Proven over a REAL
// relay pair with FAKE engine ops (the same headless "spoof the engine" path the wire tests use), so the
// round STATE MACHINE - watch/drive the board, boot each CONTINUE round, defer the leave to the true
// ME-end LEAVE, never strand - is exercised end-to-end without a GameManager / Phaser boot. The host end
// STREAMS the per-round board (coopColosseumStreamBoard) + its pick (coopColosseumSendDecision) + the true
// 9M LEAVE exactly as ColosseumChoicePhase / coopEndMePump do in production; the loop consumes them off
// the guest relay. The engine touches (adopt boss / boot ME battle / capture UI / leave+advance) are the
// injected CoopColosseumRoundOps, so what is asserted is the loop's decisions, not the engine.
// =============================================================================
describe("co-op Colosseum guest between-rounds ROUND LOOP (#829)", () => {
  afterEach(() => {
    clearCoopRuntime();
    setCoopMeInteractionStart(-1);
  });

  /**
   * Stand up an authoritative HOST runtime (its interactionRelay is the "host" end the board helpers
   * send on) + pin the ME on `start`, and pair a bare GUEST relay on the other loopback end - the end
   * the guest round loop reads. Identical to the wire suite's rig above.
   */
  const rig = (start: number) => {
    const { host, guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    setCoopRuntime(runtime);
    setCoopMeInteractionStart(start);
    return { seq: coopColosseumSeq(start), guestRelay: new CoopInteractionRelay(guest) };
  };

  /** One macrotask tick: drains ALL pending microtasks (loopback deliveries + the loop's await chain). */
  const tick = (): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, 0));

  /** A minimal serialized boss the fake awaitBoss hands the loop (the loop only forwards it to bootRoundBattle). */
  const FAKE_BOSS: CoopSerializedEnemy[] = [{ fieldIndex: 0, data: { speciesId: 1, level: 50 } }];

  /** Recording fake ops: the round loop's engine seam, so the test asserts the loop's DECISIONS. */
  interface FakeOpsState {
    boots: CoopSerializedEnemy[][];
    driveCalls: string[][];
    leaves: number;
  }
  const makeFakeOps = (opts: {
    owned: boolean;
    boss: CoopSerializedEnemy[] | null;
    driveReturns?: number[];
  }): { ops: CoopColosseumRoundOps; state: FakeOpsState } => {
    const state: FakeOpsState = { boots: [], driveCalls: [], leaves: 0 };
    let driveIdx = 0;
    const ops: CoopColosseumRoundOps = {
      boardOwnedLocally: () => opts.owned,
      driveBoard: async (labels: string[]) => {
        state.driveCalls.push([...labels]);
        const ret = opts.driveReturns?.[driveIdx] ?? COLOSSEUM_CASH_OUT;
        driveIdx++;
        return ret;
      },
      awaitBoss: async () => opts.boss,
      bootRoundBattle: (enemies: CoopSerializedEnemy[]) => {
        state.boots.push(enemies);
      },
      leaveAndAdvance: () => {
        state.leaves++;
      },
      showTag: () => {},
      hideTag: () => {},
    };
    return { ops, state };
  };

  it("WATCHER: watches CONTINUE (boots the next round) then CASH OUT (defers the leave to the true 9M LEAVE)", async () => {
    // Host-owned board: the guest WATCHES the host's relayed pick. Round 1 -> CONTINUE -> boot round 2;
    // round 2 -> CASH OUT -> the loop must WAIT for the host's true ME-end LEAVE before leaving (so it
    // advances IN STEP with the host's reward flow, never early).
    const { guestRelay } = rig(4);
    const seqTerm = COOP_ME_TERM_SEQ_BASE + 4;
    const { ops, state } = makeFakeOps({ owned: false, boss: FAKE_BOSS });
    const loop = runColosseumGuestRoundLoop(4, seqTerm, guestRelay, ops);

    // Round 1: host streams the board present + its CONTINUE pick.
    coopColosseumStreamBoard(["CONTINUE (risk for S+)", "CASH OUT (claim S)"]);
    coopColosseumSendDecision(COLOSSEUM_CONTINUE);
    await tick();
    expect(state.boots.length, "watcher booted the next round after CONTINUE").toBe(1);
    expect(state.boots[0], "booted with the host's re-streamed boss (adopted verbatim)").toEqual(FAKE_BOSS);
    expect(state.driveCalls.length, "a WATCHER never drives its own board").toBe(0);
    expect(state.leaves, "no leave mid-gauntlet").toBe(0);

    // Round 2: host streams the board present + its CASH OUT pick.
    coopColosseumStreamBoard(["CONTINUE (risk for SS)", "CASH OUT (claim S+)"]);
    coopColosseumSendDecision(COLOSSEUM_CASH_OUT);
    await tick();
    expect(state.leaves, "CASH OUT does NOT leave until the host's true ME-end LEAVE arrives").toBe(0);
    expect(state.boots.length, "no further round booted on CASH OUT").toBe(1);

    // The host runs its reward flow, then coopEndMePump sends the true 9M LEAVE.
    getCoopInteractionRelay()?.sendInteractionChoice(seqTerm, "meBtn", COOP_INTERACTION_LEAVE);
    await loop;
    expect(state.leaves, "left + advanced EXACTLY once at the true ME-end LEAVE").toBe(1);
    guestRelay.dispose();
  });

  it("OWNER: DRIVES the CONTINUE / CASH-OUT board off its own capture UI (never watches)", async () => {
    // Guest-owned board (odd counter in production): the guest DRIVES its local capture UI via ops.driveBoard
    // and relays the pick. Round 1 -> CONTINUE -> boot round 2; round 2 -> CASH OUT -> await the true LEAVE.
    const { guestRelay } = rig(5);
    const seqTerm = COOP_ME_TERM_SEQ_BASE + 5;
    const { ops, state } = makeFakeOps({
      owned: true,
      boss: FAKE_BOSS,
      driveReturns: [COLOSSEUM_CONTINUE, COLOSSEUM_CASH_OUT],
    });
    const loop = runColosseumGuestRoundLoop(5, seqTerm, guestRelay, ops);

    // Round 1: only the board present is streamed (the OWNER makes the decision locally, not off the wire).
    coopColosseumStreamBoard(["CONTINUE (risk for A)", "CASH OUT (claim B+)"]);
    await tick();
    expect(state.driveCalls.length, "owner drove its own board on round 1").toBe(1);
    expect(state.driveCalls[0], "driveBoard received the HOST-streamed labels (guest gauntlet is empty)").toEqual([
      "CONTINUE (risk for A)",
      "CASH OUT (claim B+)",
    ]);
    expect(state.boots.length, "booted round 2 after the owner's CONTINUE").toBe(1);

    // Round 2: owner drives again -> CASH OUT.
    coopColosseumStreamBoard(["CONTINUE (risk for A+)", "CASH OUT (claim A)"]);
    await tick();
    expect(state.driveCalls.length, "owner drove its own board on round 2").toBe(2);
    expect(state.leaves, "no leave until the true ME-end LEAVE").toBe(0);

    getCoopInteractionRelay()?.sendInteractionChoice(seqTerm, "meBtn", COOP_INTERACTION_LEAVE);
    await loop;
    expect(state.leaves, "left once at the true ME-end LEAVE").toBe(1);
    guestRelay.dispose();
  });

  it("FINAL ROUND: the true ME-end LEAVE (no board streamed) leaves + advances once, boots no extra round", async () => {
    // The final round auto-awards EX and goes STRAIGHT to endColosseum -> leave, so NO board is streamed -
    // only the true 9M LEAVE. The loop's race must resolve the terminal and leave without driving a round.
    const { guestRelay } = rig(6);
    const seqTerm = COOP_ME_TERM_SEQ_BASE + 6;
    const { ops, state } = makeFakeOps({ owned: false, boss: null });
    const loop = runColosseumGuestRoundLoop(6, seqTerm, guestRelay, ops);

    getCoopInteractionRelay()?.sendInteractionChoice(seqTerm, "meBtn", COOP_INTERACTION_LEAVE);
    await loop;
    expect(state.leaves, "left + advanced once on the final-round LEAVE").toBe(1);
    expect(state.boots.length, "no extra round booted (final round)").toBe(0);
    expect(state.driveCalls.length, "no board driven (none was streamed)").toBe(0);
    guestRelay.dispose();
  });

  it("DEFENSIVE: a malformed board present (no secondary sub-prompt) leaves once - never strands", async () => {
    // A board present the loop cannot read (a host stall / malformed frame: no secondary sub-prompt) must
    // defensively leave + advance rather than park forever waiting for a decision it can never render.
    const { seq, guestRelay } = rig(8);
    const seqTerm = COOP_ME_TERM_SEQ_BASE + 8;
    const { ops, state } = makeFakeOps({ owned: false, boss: null });
    const loop = runColosseumGuestRoundLoop(8, seqTerm, guestRelay, ops);

    const malformed: CoopInteractionOutcome = { k: "mePresent", tokens: {}, meetsReqs: [], labels: [] };
    getCoopInteractionRelay()?.sendInteractionOutcome(seq, "coloBoard", malformed);
    await loop;
    expect(state.leaves, "defensively left + advanced once on a malformed board").toBe(1);
    expect(state.boots.length, "booted no round").toBe(0);
    guestRelay.dispose();
  });
});
