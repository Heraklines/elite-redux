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
// The spoof only emits the wire messages a real partner would (the negotiated
// `hello` / data fingerprint followed by a `rosterSync` snapshot). It is
// engine-free: timing (e.g. "the partner takes a
// few seconds to lock in") is the caller's job - the live phase schedules
// `announcePicking()` then `lockIn()` off `globalScene.time`; tests drive them
// directly and flush microtasks. This keeps the spoof headlessly testable.
// =============================================================================

import { CoopBattleSync } from "#data/elite-redux/coop/coop-battle-sync";
import {
  COOP_CAP_AUTHORITY_V2_INTERACTION,
  COOP_CAP_AUTHORITY_V2_RECOVERY,
  COOP_CAP_AUTHORITY_V2_REPLACEMENT,
  COOP_CAP_AUTHORITY_V2_SHADOW,
  COOP_CAP_AUTHORITY_V2_TURN,
  COOP_CAP_AUTHORITY_V2_WAVE,
} from "#data/elite-redux/coop/coop-capabilities";
import { coopLog, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";

/** Options for {@linkcode SpoofGuest}. */
export interface SpoofGuestOptions {
  /** Display name the host sees in "<name> is ready" notifications. */
  username?: string;
  /** The roster the spoof "picks" (defaults to a tiny valid demo team). */
  roster?: CoopRosterEntry[];
  /** Explicit protocol-version override for mismatch tests; normally mirrors the local host. */
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
 * The engine-free CPU stand-in answers legacy command requests, but it does not
 * own a replica engine/log. Advertising a live Authority V2 capability would
 * make the host publish retained entries to a receiver that cannot admit,
 * materialize, or receipt them.
 */
const UNSUPPORTED_SPOOF_CAPABILITIES = new Set<string>([
  COOP_CAP_AUTHORITY_V2_SHADOW,
  COOP_CAP_AUTHORITY_V2_TURN,
  COOP_CAP_AUTHORITY_V2_REPLACEMENT,
  COOP_CAP_AUTHORITY_V2_WAVE,
  COOP_CAP_AUTHORITY_V2_INTERACTION,
  COOP_CAP_AUTHORITY_V2_RECOVERY,
]);

/**
 * Drives the guest endpoint of a loopback pair to imitate a second human. Bind it
 * to the `guest` transport from `createLoopbackPair()`; the local human's
 * capability advertisement is mirrored only for protocols this stand-in
 * implements.
 * {@linkcode CoopSessionController} sits on the `host` endpoint.
 */
export class SpoofGuest {
  private readonly transport: CoopTransport;
  private readonly username: string;
  /** Explicit mismatch override for tests; the local CPU normally mirrors the host build. */
  private readonly version: string | undefined;
  private readonly roster: CoopRosterEntry[];
  private connected = false;
  private disposed = false;
  private pendingHello: Extract<CoopMessage, { t: "hello"; username: string }> | null = null;
  private pendingFingerprint: Extract<CoopMessage, { t: "dataFingerprint" }> | null = null;
  private readonly offMessage: () => void;
  /** Answers the host's in-battle command requests over the transport (#633, LIVE-C). */
  private readonly battleSync: CoopBattleSync;

  constructor(transport: CoopTransport, opts: SpoofGuestOptions = {}) {
    this.transport = transport;
    this.username = opts.username ?? "Player 2 (CPU)";
    this.version = opts.version;
    this.roster = (opts.roster ?? DEFAULT_SPOOF_ROSTER).map(e => ({ speciesId: e.speciesId, cost: e.cost }));
    // Stand in for a real guest in battle: pick the FIRST legal move the host
    // offered (the host did the legality work; the spoof needs no engine). An
    // empty offer means only Struggle is legal - cursor 0 + the host's own
    // no-usable-move fallback resolves it to Struggle.
    this.battleSync = new CoopBattleSync(transport);
    this.battleSync.onCommandRequest(({ moveSlots, offer }) => {
      const offeredMove = offer?.moves[0];
      const cursor = offeredMove?.slot ?? (moveSlots.length > 0 ? moveSlots[0] : 0);
      if (isCoopDebug()) {
        coopLog(
          "ai",
          `spoof command request offeredSlots=[${moveSlots.join(",")}] -> auto-pick FIGHT cursor=${cursor}`,
        );
      }
      return {
        command: Command.FIGHT,
        cursor,
        ...(offeredMove == null ? {} : { moveId: offeredMove.moveId, targets: [...(offeredMove.targetSets[0] ?? [])] }),
      };
    });
    // A local CPU is a same-build peer, not a protocol-1 shortcut. Observe the
    // host's real opening frames and mirror the exact negotiated control identity,
    // capability advertisement, and data fingerprint back across the transport.
    // Buffering keeps both call orders valid: controller.connect() -> spoof.connect()
    // (unit tests) and spoof.connect() -> controller.connect() (the local factory).
    this.offMessage = transport.onMessage(msg => {
      if (msg.t === "hello" && "username" in msg) {
        this.pendingHello = msg;
        if (this.connected) {
          this.replyHello(msg);
        }
      } else if (msg.t === "dataFingerprint") {
        this.pendingFingerprint = msg;
        if (this.connected) {
          this.replyFingerprint(msg);
        }
      }
    });
  }

  /** Arm the negotiated peer handshake (idempotent). */
  connect(): void {
    if (this.connected || this.disposed) {
      return;
    }
    this.connected = true;
    coopLog(
      "ai",
      `spoof connect role=${this.transport.role} username=${this.username} version=${this.version ?? "mirror-host"} `
        + `rosterSpecies=[${this.roster.map(e => e.speciesId).join(",")}]`,
    );
    if (this.pendingHello != null) {
      this.replyHello(this.pendingHello);
    }
    if (this.pendingFingerprint != null) {
      this.replyFingerprint(this.pendingFingerprint);
    }
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

  /** Stop answering battle command requests (call on teardown). */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.offMessage();
    this.battleSync.dispose();
  }

  private replyHello(hostHello: Extract<CoopMessage, { t: "hello"; username: string }>): void {
    const capabilities = hostHello.capabilities?.filter(capability => !UNSUPPORTED_SPOOF_CAPABILITIES.has(capability));
    this.transport.send({
      t: "hello",
      version: this.version ?? hostHello.version,
      username: this.username,
      role: this.transport.role,
      epoch: hostHello.epoch,
      ...(hostHello.runId == null ? {} : { runId: hostHello.runId, checkpointRevision: hostHello.checkpointRevision }),
      ...(capabilities == null ? {} : { capabilities }),
    });
  }

  private replyFingerprint(hostFingerprint: Extract<CoopMessage, { t: "dataFingerprint" }>): void {
    this.transport.send({ t: "dataFingerprint", fp: structuredClone(hostFingerprint.fp) });
  }

  private sendRoster(ready: boolean): void {
    coopLog("ai", `spoof sendRoster ready=${ready} count=${this.roster.length} role=${this.transport.role}`);
    this.transport.send({
      t: "rosterSync",
      role: this.transport.role,
      entries: this.roster.map(e => ({ speciesId: e.speciesId, cost: e.cost })),
      ready,
    });
  }
}
