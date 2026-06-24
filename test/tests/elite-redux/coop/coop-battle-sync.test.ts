/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op battle command relay (#633, LIVE-C). The host-authoritative partner
// command travels over the transport: the host offers the legal move slots and
// awaits the peer's pick; the SpoofGuest answers it in-process. This is the pure,
// engine-free core - verified over a LoopbackTransport (the exact "test it via
// spoofing" path) - that runs unchanged over the real WebRTC transport.

import { CoopBattleSync } from "#data/elite-redux/coop/coop-battle-sync";
import { SpoofGuest } from "#data/elite-redux/coop/coop-spoof-guest";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { describe, expect, it } from "vitest";

describe("co-op battle command relay (#633, LIVE-C)", () => {
  it("host requests a command; the peer's chosen slot comes back over the transport", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    // The peer picks the SECOND offered slot - proving the host receives the
    // peer's actual choice, not a local guess.
    guestSync.onCommandRequest(({ moveSlots }) => ({ command: Command.FIGHT, cursor: moveSlots[1] }));

    const cmd = await hostSync.requestPartnerCommand(1, 3, [0, 2]);
    expect(cmd).not.toBeNull();
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(2); // moveSlots[1]
  });

  it("a request with no responding peer resolves null (caller -> AI fallback)", async () => {
    const { host } = createLoopbackPair();
    // Fire the timeout immediately (no peer responder installed).
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 1,
      schedule: cb => {
        cb();
        return () => {};
      },
    });
    const cmd = await hostSync.requestPartnerCommand(1, 0, [0, 1]);
    expect(cmd).toBeNull();
  });

  it("the SpoofGuest answers the host's request end-to-end (loopback)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    // A real SpoofGuest binds its own responder over the guest endpoint; it picks
    // the FIRST offered slot (it has no engine - the host did the legality work).
    new SpoofGuest(guest);

    const cmd = await hostSync.requestPartnerCommand(1, 0, [2, 3]);
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(2); // the first offered slot
  });

  it("broadcastLocalCommand resolves the PEER's awaiting partner-command (lockstep, #633, LIVE-C)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);

    // LOCKSTEP: the HOST awaits the partner's slot 1 (the guest's own slot). The
    // GUEST, instead of answering a request, BROADCASTS its own pick for slot 1.
    // That `command` message matches the host's pending request by fieldIndex and
    // resolves it with the exact move the human chose - no AI fallback.
    const awaited = hostSync.requestPartnerCommand(1, 0, [0, 1, 2]);
    guestSync.broadcastLocalCommand(1, { command: Command.FIGHT, cursor: 2, moveId: 999, targets: [2] });

    const cmd = await awaited;
    expect(cmd).not.toBeNull();
    expect(cmd?.command).toBe(Command.FIGHT);
    expect(cmd?.cursor).toBe(2); // the human's actual pick crossed the wire
    expect(cmd?.moveId).toBe(999);
  });

  it("broadcastLocalCommand for a DIFFERENT slot does not resolve an await on another slot", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host, {
      timeoutMs: 5,
      schedule: cb => {
        const id = setTimeout(cb, 5);
        return () => clearTimeout(id);
      },
    });
    const guestSync = new CoopBattleSync(guest);

    // Host awaits slot 1; the guest broadcasts a command for slot 0. Matching is by
    // fieldIndex, so slot 1's await is untouched and falls through to the timeout
    // (null -> the caller's AI fallback).
    const awaited = hostSync.requestPartnerCommand(1, 0, [0]);
    guestSync.broadcastLocalCommand(0, { command: Command.FIGHT, cursor: 0 });

    const cmd = await awaited;
    expect(cmd).toBeNull();
  });

  it("a superseding request for the same slot resolves the stale one null", async () => {
    const { host, guest } = createLoopbackPair();
    const hostSync = new CoopBattleSync(host);
    const guestSync = new CoopBattleSync(guest);
    guestSync.onCommandRequest(({ moveSlots }) => ({ command: Command.FIGHT, cursor: moveSlots[0] }));

    const first = hostSync.requestPartnerCommand(1, 0, [0]);
    const second = hostSync.requestPartnerCommand(1, 1, [1]);
    // The first is superseded immediately (resolves null); the second still gets a
    // valid command back over the wire (matching is by slot, so we don't assert
    // WHICH reply lands - only that the stale request is cleared and a real one wins).
    expect(await first).toBeNull();
    const secondCmd = await second;
    expect(secondCmd).not.toBeNull();
    expect(secondCmd?.command).toBe(Command.FIGHT);
  });
});
