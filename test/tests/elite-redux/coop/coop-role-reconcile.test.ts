/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op role reconciliation (#633). The lobby can race two clients into the SAME
// role (both "host"); then both drive field slot 0 and both AWAIT slot 1, which
// nobody commands -> the live "stuck until the 30s timeout" stall. On the `hello`
// handshake each client now breaks the tie DETERMINISTICALLY (lower tiebreak nonce
// = host), so exactly one ends up host and one guest - verified here by spoofing
// the conflicting hello over the transport (the headless "spoof two players" path).

import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

describe("co-op role reconciliation (#633)", () => {
  it("a peer claiming the SAME role flips us to the OTHER role by tiebreak (we lose -> guest)", async () => {
    const { host, guest } = createLoopbackPair();
    // We are host with a HIGH tiebreak; the peer (spoofed) also claims host but with
    // a LOWER tiebreak, so it wins host and we must become guest.
    const me = new CoopSessionController(host, { username: "A", tiebreak: 0.9 });
    expect(me.role).toBe("host");
    guest.send({ t: "hello", version: "1", username: "B", role: "host", tiebreak: 0.1, epoch: 101 });
    await new Promise(r => setTimeout(r, 0));
    expect(me.role).toBe("guest");
    expect(me.partnerRoleId).toBe("host");
  });

  it("a peer claiming the SAME role leaves us host when we have the lower tiebreak", async () => {
    const { host, guest } = createLoopbackPair();
    const me = new CoopSessionController(host, { username: "A", tiebreak: 0.1 });
    guest.send({ t: "hello", version: "1", username: "B", role: "host", tiebreak: 0.9, epoch: 102 });
    await new Promise(r => setTimeout(r, 0));
    expect(me.role).toBe("host");
    expect(me.partnerRoleId).toBe("guest");
  });

  it("two conflicting clients reconcile to OPPOSITE roles (the real two-human case)", async () => {
    // Simulate both clients constructed as "host" (lobby race). Each receives the
    // other's hello and reconciles independently; the result must be consistent:
    // exactly one host, one guest.
    const a = createLoopbackPair();
    const b = createLoopbackPair();
    const clientA = new CoopSessionController(a.host, { username: "A", tiebreak: 0.2 });
    const clientB = new CoopSessionController(b.host, { username: "B", tiebreak: 0.8 });
    // Cross-deliver each other's hello (what the live channel does).
    a.guest.send({
      t: "hello",
      version: "1",
      username: "B",
      role: "host",
      tiebreak: 0.8,
      epoch: clientB.sessionEpoch,
      runId: clientB.runId,
      checkpointRevision: clientB.checkpointRevision,
    });
    b.guest.send({
      t: "hello",
      version: "1",
      username: "A",
      role: "host",
      tiebreak: 0.2,
      epoch: clientA.sessionEpoch,
      runId: clientA.runId,
      checkpointRevision: clientA.checkpointRevision,
    });
    await new Promise(r => setTimeout(r, 0));
    // Lower tiebreak (A, 0.2) is host; B is guest. They are OPPOSITE.
    expect(clientA.role).toBe("host");
    expect(clientB.role).toBe("guest");
    expect(clientA.role).not.toBe(clientB.role);
    expect(clientB.sessionEpoch, "the losing host adopts the winner's epoch").toBe(clientA.sessionEpoch);
  });

  it("no conflict: a peer with the OPPOSITE role leaves our role unchanged", async () => {
    const { host, guest } = createLoopbackPair();
    const me = new CoopSessionController(host, { username: "A", tiebreak: 0.5 });
    guest.send({ t: "hello", version: "1", username: "B", role: "guest", tiebreak: 0.1, epoch: 0 });
    await new Promise(r => setTimeout(r, 0));
    expect(me.role).toBe("host"); // unchanged - roles already distinct
  });
});
