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
  coopColosseumAwaitDecision,
  coopColosseumBoardOwnedLocally,
  coopColosseumSendDecision,
  coopColosseumSeq,
  coopColosseumStreamBoard,
} from "#data/elite-redux/coop/coop-colosseum";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

/** The board's two decision labels (index 0 == CONTINUE, index 1 == CASH OUT); asserted verbatim on the wire. */
const BOARD_LABELS = ["CONTINUE (risk for S+)", "CASH OUT (claim S)"];

describe("co-op Colosseum between-rounds board relay (#829)", () => {
  afterEach(() => {
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
