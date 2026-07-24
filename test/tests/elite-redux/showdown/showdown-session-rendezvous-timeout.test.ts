/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { SHOWDOWN_PROTO_VERSION, ShowdownSession, showdownTeamHash } from "#data/elite-redux/showdown/showdown-session";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { describe, expect, it } from "vitest";

const flush = async () => {
  for (let index = 0; index < 6; index++) {
    await new Promise<void>(resolve => queueMicrotask(resolve));
  }
};

function legalTeam(base: number): ShowdownMonManifest[] {
  return Array.from({ length: 6 }, (_, index) => ({
    speciesId: base + index,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    nature: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [1, 2, 3, 4],
    item: "LEFTOVERS",
    rootSpeciesId: base + index,
    erBlackShiny: false,
    baseCost: 4,
  }));
}

function makeManualScheduler() {
  const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
  return {
    schedule(callback: () => void): () => void {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    fireNext(): void {
      const timer = timers.find(candidate => !candidate.cancelled);
      if (timer != null) {
        timer.cancelled = true;
        timer.callback();
      }
    },
  };
}

describe("Showdown negotiation rendezvous exhaustion", () => {
  it("recovers when the first handshake was consumed before the peer session subscribed", async () => {
    const { host, guest } = createLoopbackPair();
    const offGuestGeneric = guest.onMessage(() => {});
    const hostSession = new ShowdownSession(host, { isMegaForm: () => false, timeoutMs: 1_000 });
    const hostNegotiation = hostSession.negotiate(legalTeam(100));

    // Reproduce the live race: generic runtime listeners consumed the host's first team/ready before
    // SelectStarterPhase constructed the guest ShowdownSession.
    await flush();
    const guestSession = new ShowdownSession(guest, { isMegaForm: () => false, timeoutMs: 1_000 });
    const guestNegotiation = guestSession.negotiate(legalTeam(200));

    await expect(Promise.all([hostNegotiation, guestNegotiation])).resolves.toHaveLength(2);
    hostSession.dispose();
    guestSession.dispose();
    offGuestGeneric();
  });

  it("rejects instead of entering battle when showdown-ready never receives a peer arrival", async () => {
    const { host, guest } = createLoopbackPair();
    const manual = makeManualScheduler();
    const rendezvous = new CoopRendezvous(host, {
      schedule: manual.schedule,
      maxRecoveryAttempts: 1,
    });
    const session = new ShowdownSession(host, {
      isMegaForm: () => false,
      rendezvous,
      // Keep the whole-negotiation watchdog out of this rendezvous-specific regression.
      schedule: () => () => {},
    });
    const negotiation = session.negotiate(legalTeam(100));
    const opponentTeam = legalTeam(200);
    guest.send({ t: "showdownTeam", manifest: opponentTeam, showdownProto: SHOWDOWN_PROTO_VERSION });
    guest.send({ t: "showdownReady", teamHash: showdownTeamHash(opponentTeam) });
    await flush();

    manual.fireNext();
    await flush();
    manual.fireNext();
    await flush();

    await expect(negotiation).rejects.toMatchObject({ reason: "timeout" });
    session.dispose();
    rendezvous.dispose();
  });
});
