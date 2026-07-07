/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 vs-CPU spoof (D0). Engine-free over a LoopbackTransport: the ShowdownSpoof drives
// the WHOLE friendly handshake so the mode is playable solo - it answers a real host's negotiate
// with a legal team (both resolve) and arrives at the `showdown-wager-commit` barrier so the host's
// friendly lock resolves.

import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { SHOWDOWN_WAGER_COMMIT_POINT, ShowdownSession } from "#data/elite-redux/showdown/showdown-session";
import { ShowdownSpoof } from "#data/elite-redux/showdown/showdown-spoof";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush generously to drain the deferred spoof handshake. */
const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>(resolve => queueMicrotask(resolve));
  }
};

const mon = (over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest => ({
  speciesId: 6,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [1, 2, 3, 4],
  item: "LEFTOVERS",
  rootSpeciesId: 4,
  erBlackShiny: false,
  baseCost: 4,
  ...over,
});

const legalTeam = (base = 200): ShowdownMonManifest[] =>
  Array.from({ length: 6 }, (_, i) => mon({ speciesId: base + i, rootSpeciesId: base + i }));

describe("Showdown vs-CPU spoof (D0)", () => {
  it("answers a real host's negotiate with a legal team and both resolve", async () => {
    const { host, guest } = createLoopbackPair();
    const spoof = new ShowdownSpoof(guest);
    const hostRv = new CoopRendezvous(host, { timeoutMs: 10_000 });
    const session = new ShowdownSession(host, { rendezvous: hostRv });

    const negotiate = session.negotiate(legalTeam(), null);
    await flush();
    const result = await negotiate;

    // The host adopted the spoof's full 6-mon team; the first spoof mon is CATERPIE.
    expect(result.opponentManifest).toHaveLength(6);
    expect(result.opponentManifest[0].speciesId).toBe(SpeciesId.CATERPIE);

    session.dispose();
    hostRv.dispose();
    spoof.dispose();
  });

  it("arrives at the wager-commit barrier so the host's friendly lock resolves", async () => {
    const { host, guest } = createLoopbackPair();
    const spoof = new ShowdownSpoof(guest);
    const hostRv = new CoopRendezvous(host, { timeoutMs: 10_000 });
    const session = new ShowdownSession(host, { rendezvous: hostRv });

    await session.negotiate(legalTeam(), null);
    await flush();

    // The host locks Friendly -> crosses the commit barrier; the spoof already arrived post-negotiate.
    const commit = await hostRv.rendezvous(SHOWDOWN_WAGER_COMMIT_POINT);
    expect(commit.timedOut).toBe(false);

    session.dispose();
    hostRv.dispose();
    spoof.dispose();
  });
});
