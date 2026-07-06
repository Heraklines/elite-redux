/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 manifest exchange + ready rendezvous (C2). Two ShowdownSession
// controllers over a LoopbackTransport pair negotiate: each sends its team + a ready
// commit, awaits the opponent's, gates on (a) the opponent team passing the FORMAT rules
// and (b) the opponent's committed teamHash matching the manifest they sent, then crosses
// the `showdown-ready` reciprocal rendezvous barrier before resolving. Engine-free (an
// injected mega-form stub), mirrors the co-op session tests, so it runs unchanged over WebRTC.

import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  SHOWDOWN_READY_RENDEZVOUS_POINT,
  ShowdownNegotiationError,
  ShowdownSession,
  showdownTeamHash,
} from "#data/elite-redux/showdown/showdown-session";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; flush a few times to drain the handshake. */
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>(resolve => queueMicrotask(resolve));
  }
};

const noMegas = () => false;

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

/** A fully legal 6-mon team with distinct species. */
const legalTeam = (base = 100): ShowdownMonManifest[] =>
  Array.from({ length: 6 }, (_, i) => mon({ speciesId: base + i, rootSpeciesId: base + i }));

describe("Showdown manifest exchange + ready rendezvous (C2)", () => {
  it("both legal -> both resolve with matching hashes and adopt the opponent team", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new ShowdownSession(host, { isMegaForm: noMegas });
    const g = new ShowdownSession(guest, { isMegaForm: noMegas });

    const hTeam = legalTeam(100);
    const gTeam = legalTeam(200);

    const hp = h.negotiate(hTeam);
    const gp = g.negotiate(gTeam);
    await flush();

    const hRes = await hp;
    const gRes = await gp;

    // Each side adopts the OPPONENT's team (the host's enemy party is built from it in C3).
    expect(hRes.opponentManifest.map(m => m.speciesId)).toEqual(gTeam.map(m => m.speciesId));
    expect(gRes.opponentManifest.map(m => m.speciesId)).toEqual(hTeam.map(m => m.speciesId));
    // The committed hash matches the manifest hash on both sides.
    expect(hRes.opponentTeamHash).toBe(showdownTeamHash(gTeam));
    expect(gRes.opponentTeamHash).toBe(showdownTeamHash(hTeam));
  });

  it("a malformed team rejects BOTH sides (the void propagates)", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new ShowdownSession(host, { isMegaForm: noMegas });
    const g = new ShowdownSession(guest, { isMegaForm: noMegas });

    // The guest ships an ILLEGAL team (a level-50 mon). Its own defensive format check
    // voids it immediately (illegalTeam) and sends a showdownVoid, which rejects the host.
    const hTeam = legalTeam(100);
    const badTeam = legalTeam(200);
    badTeam[3].level = 50;

    const hp = h.negotiate(hTeam);
    const gp = g.negotiate(badTeam);
    await flush();

    // The guest rejects on its own structurally-illegal team.
    await expect(gp).rejects.toBeInstanceOf(ShowdownNegotiationError);
    await expect(gp).rejects.toMatchObject({ reason: "illegalTeam" });
    // The host rejects because it receives the guest's void.
    await expect(hp).rejects.toMatchObject({ reason: "void" });
  });

  it("an honest client rejects (illegalTeam) when a RAW peer ships an illegal team", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new ShowdownSession(host, { isMegaForm: noMegas });

    // A hostile RAW peer that patched out its own self-check ships a legal-looking team
    // with a level-50 mon and a MATCHING hash. The honest host validates the opponent and
    // rejects illegalTeam (the void it sends would reject the cheater's real client too).
    const hp = h.negotiate(legalTeam(100));
    const cheat = legalTeam(200);
    cheat[3].level = 50;
    guest.send({ t: "showdownTeam", manifest: cheat });
    guest.send({ t: "showdownReady", teamHash: showdownTeamHash(cheat) });
    await flush();

    await expect(hp).rejects.toMatchObject({ reason: "illegalTeam" });
  });

  it("an opponent manifest with a black shiny rejects BOTH clients (Task B6 field-legality)", async () => {
    // The field-legality rules (blackShiny/costCap/highCostLimit) are pure rule-checks, not
    // unlock-checks, so the PERMISSIVE_UNLOCKS the session uses still enforces them on the
    // opponent's manifest. A RAW cheating peer that ships a black-shiny mon is rejected by the
    // honest host (illegalTeam), and the void it sends rejects the cheater's client too.
    const { host, guest } = createLoopbackPair();
    const h = new ShowdownSession(host, { isMegaForm: noMegas });

    const hp = h.negotiate(legalTeam(100));
    const cheat = legalTeam(200);
    cheat[2].erBlackShiny = true;
    guest.send({ t: "showdownTeam", manifest: cheat });
    guest.send({ t: "showdownReady", teamHash: showdownTeamHash(cheat) });
    await flush();

    await expect(hp).rejects.toMatchObject({ reason: "illegalTeam" });
  });

  it("an opponent's own black-shiny team self-voids and propagates to both sides (Task B6)", async () => {
    // Symmetric to the malformed-team propagation: an honest guest that somehow assembled a
    // black-shiny team fails its OWN defensive format check and voids, rejecting the host too.
    const { host, guest } = createLoopbackPair();
    const h = new ShowdownSession(host, { isMegaForm: noMegas });
    const g = new ShowdownSession(guest, { isMegaForm: noMegas });

    const hTeam = legalTeam(100);
    const badTeam = legalTeam(200);
    badTeam[1].erBlackShiny = true;

    const hp = h.negotiate(hTeam);
    const gp = g.negotiate(badTeam);
    await flush();

    await expect(gp).rejects.toMatchObject({ reason: "illegalTeam" });
    await expect(hp).rejects.toMatchObject({ reason: "void" });
  });

  it("a tampered hash (ready hash != team manifest) rejects", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new ShowdownSession(host, { isMegaForm: noMegas });

    const hTeam = legalTeam(100);
    const hp = h.negotiate(hTeam);

    // The guest is a RAW transport peer that sends a legal team but a WRONG committed hash.
    const gTeam = legalTeam(200);
    guest.send({ t: "showdownTeam", manifest: gTeam });
    guest.send({ t: "showdownReady", teamHash: "deadbeefdeadbeef" });
    await flush();

    await expect(hp).rejects.toMatchObject({ reason: "hashMismatch" });
  });

  it("the ready commit and team can arrive in any order (buffered)", async () => {
    const { host, guest } = createLoopbackPair();
    const h = new ShowdownSession(host, { isMegaForm: noMegas });

    const hTeam = legalTeam(100);
    const hp = h.negotiate(hTeam);

    // Send ready BEFORE the team (reverse of the natural order) - the gate must buffer.
    const gTeam = legalTeam(200);
    guest.send({ t: "showdownReady", teamHash: showdownTeamHash(gTeam) });
    await flush();
    guest.send({ t: "showdownTeam", manifest: gTeam });
    // The raw peer must also cross the ready barrier for the host's negotiate to resolve.
    guest.send({ t: "rendezvous", point: SHOWDOWN_READY_RENDEZVOUS_POINT });
    await flush();

    const hRes = await hp;
    expect(hRes.opponentManifest.map(m => m.speciesId)).toEqual(gTeam.map(m => m.speciesId));
  });

  it("ready GATES on the rendezvous: resolves only once both cross showdown-ready", async () => {
    const { host, guest } = createLoopbackPair();
    // Long timeout so the barrier does NOT anti-hang out from under the assertion.
    const rendezvous = new CoopRendezvous(host, { timeoutMs: 10_000 });
    const h = new ShowdownSession(host, { isMegaForm: noMegas, rendezvous });

    let settled = false;
    const hp = h.negotiate(legalTeam(100)).then(r => {
      settled = true;
      return r;
    });

    // The RAW guest sends a fully-legal, correctly-hashed team + ready, but does NOT yet
    // arrive at the ready barrier. The host validates both and parks at showdown-ready.
    const gTeam = legalTeam(200);
    guest.send({ t: "showdownTeam", manifest: gTeam });
    guest.send({ t: "showdownReady", teamHash: showdownTeamHash(gTeam) });
    await flush();
    expect(settled).toBe(false); // gated at the barrier - not yet resolved

    // Now the guest arrives at the barrier; the host crosses and resolves.
    guest.send({ t: "rendezvous", point: SHOWDOWN_READY_RENDEZVOUS_POINT });
    await flush();
    const hRes = await hp;
    expect(settled).toBe(true);
    expect(hRes.opponentManifest.map(m => m.speciesId)).toEqual(gTeam.map(m => m.speciesId));

    rendezvous.dispose();
  });
});
