/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Spoofed co-op partner (#633, co-op mode - phase P1).
//
// Stands in for player 2 over a LoopbackTransport so the ENTIRE co-op flow -
// menu entry, the local player's own starter-select, the partner-status
// notifications, the both-ready handshake, and (later) the battle - can be
// developed and played locally with a single human. The real second player drops
// in behind the same transport interface at phase P6; nothing else changes.
//
// The spoof only emits the wire messages a real partner would (`hello` then a
// `rosterSync` snapshot). It is engine-free: timing (e.g. "the partner takes a
// few seconds to lock in") is the caller's job - the live phase schedules
// `announcePicking()` then `lockIn()` off `globalScene.time`; tests drive them
// directly and flush microtasks. This keeps the spoof headlessly testable.
// =============================================================================

import type { CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** Options for {@linkcode SpoofGuest}. */
export interface SpoofGuestOptions {
  /** Display name the host sees in "<name> is ready" notifications. */
  username?: string;
  /** The roster the spoof "picks" (defaults to a tiny valid demo team). */
  roster?: CoopRosterEntry[];
  /** Protocol/game version for the handshake. */
  version?: string;
}

/**
 * A minimal, valid default team for the spoof: two cheap mons inside the 5-point
 * budget. Species ids are intentionally low/common; the host never battles the
 * spoof's mons in P1 (selection only), so identity barely matters - this just has
 * to be a legal roster the merge can lay into the guest half (party slots 3..5).
 */
const DEFAULT_SPOOF_ROSTER: CoopRosterEntry[] = [
  { speciesId: 1, cost: 3 }, // Bulbasaur-ish
  { speciesId: 4, cost: 2 }, // Charmander-ish
];

/**
 * Drives the guest endpoint of a loopback pair to imitate a second human. Bind it
 * to the `guest` transport from `createLoopbackPair()`; the local human's
 * {@linkcode CoopSessionController} sits on the `host` endpoint.
 */
export class SpoofGuest {
  private readonly transport: CoopTransport;
  private readonly username: string;
  private readonly version: string;
  private readonly roster: CoopRosterEntry[];

  constructor(transport: CoopTransport, opts: SpoofGuestOptions = {}) {
    this.transport = transport;
    this.username = opts.username ?? "Player 2 (CPU)";
    this.version = opts.version ?? "1";
    this.roster = (opts.roster ?? DEFAULT_SPOOF_ROSTER).map(e => ({ speciesId: e.speciesId, cost: e.cost }));
  }

  /** Announce the spoofed partner (mirrors a real client's opening `hello`). */
  connect(): void {
    this.transport.send({ t: "hello", version: this.version, username: this.username, role: this.transport.role });
  }

  /** Send the roster as "still choosing" (drives the host's "Partner is choosing..." state). */
  announcePicking(): void {
    this.sendRoster(false);
  }

  /** Send the roster as "locked in" (drives the host's "<name> is ready"). */
  lockIn(): void {
    this.sendRoster(true);
  }

  /** connect -> announcePicking -> lockIn back to back (instant local partner). */
  autoComplete(): void {
    this.connect();
    this.announcePicking();
    this.lockIn();
  }

  /** The roster the spoof brings (so the host side can show / merge it). */
  pickedRoster(): readonly CoopRosterEntry[] {
    return this.roster;
  }

  private sendRoster(ready: boolean): void {
    this.transport.send({
      t: "rosterSync",
      role: this.transport.role,
      entries: this.roster.map(e => ({ speciesId: e.speciesId, cost: e.cost })),
      ready,
    });
  }
}
