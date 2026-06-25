/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op per-turn CHECKSUM + auto-resync over the REAL engine (#633, TRACK-2).
//
// The pure hashing logic is covered by coop-battle-checksum.test.ts; the loopback
// resync handshake by coop-battle-stream.test.ts. This tier drives the ACTUAL engine
// through GameManager to prove the checksum + the full-snapshot heal work against live
// `Pokemon`/`Arena` objects:
//
//   (A) DETERMINISM - captureCoopChecksum() over a live battle is stable across repeated
//       reads at the same boundary, and changes when battle state changes.
//   (B) CONVERGENCE - the same engine, captured -> full-snapshot -> re-applied -> re-hashed,
//       round-trips to the SAME digest (the apply path is a true inverse of the capture).
//   (C) FORCED MISMATCH + HEAL - a deliberate divergence the numeric checkpoint can't fix
//       (an abilityId / ppUsed drift) makes the host vs guest checksums differ; applying the
//       host's full snapshot HEALS it and the checksum re-converges. This is the whole
//       TRACK-2 thesis - the checksum catches exactly the drift class the checkpoint misses.
//
// Single-scene constraint (documented across the co-op suite): there is ONE globalScene in
// the test process, so "the guest" is modeled by capturing the same engine's state, applying
// the guest's transform, and re-hashing - the faithful headless substitute for a 2nd client.
// Gated ER_SCENARIO=1 like the other ER engine tests.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import {
  applyCoopFullSnapshot,
  captureCoopChecksum,
  captureCoopFullSnapshot,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op battle checksum + resync - real engine (#633, TRACK-2)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  /** Start a co-op double (host-local spoof path) and tag field ownership. */
  const startCoopDouble = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    // The checksum + full-snapshot resync is the AUTHORITATIVE netcode's machinery; opt in
    // explicitly since the selectable default is now "lockstep" (#633, A/B).
    startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    return field;
  };

  it("(A) captureCoopChecksum is a stable 16-char digest, deterministic at one boundary", async () => {
    await startCoopDouble();
    const h1 = captureCoopChecksum();
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    // Repeated reads at the SAME boundary (no state change) -> identical digest.
    expect(captureCoopChecksum()).toBe(h1);
    expect(captureCoopChecksum()).toBe(h1);
  });

  it("(A) the checksum changes when live battle state changes (hp drift)", async () => {
    const field = await startCoopDouble();
    const before = captureCoopChecksum();
    field[COOP_HOST_FIELD_INDEX].hp -= 1;
    const after = captureCoopChecksum();
    expect(after).not.toBe(before);
  });

  it("(B) the checksum tracks across a real resolved turn (host vs guest-after-apply converge)", async () => {
    await startCoopDouble();

    // Drive one real turn. The HOST checksum is captured at the post-turn boundary.
    game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX);
    await game.phaseInterceptor.to("TurnEndPhase");

    const hostChecksum = captureCoopChecksum();
    // Capture the host's full authoritative snapshot, then (modeling the guest) apply it
    // back onto the same live field and re-hash: the apply is a faithful inverse, so the
    // checksum must re-converge to the host's exactly.
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(C) FORCED MISMATCH the checkpoint can't fix (ability drift) is HEALED by the full snapshot", async () => {
    const field = await startCoopDouble();

    // Host's authoritative truth: snapshot + checksum BEFORE the divergence.
    const hostSnapshot = captureCoopFullSnapshot();
    const hostChecksum = captureCoopChecksum();
    expect(hostSnapshot).not.toBeNull();

    // Inject a divergence the per-turn NUMERIC checkpoint (hp/status/stages/fainted) can
    // NOT carry: swap the guest mon's active ability + bump a move's PP. A guest that only
    // applied the checkpoint would still mismatch here - which is exactly what the checksum
    // exists to catch.
    const guestMon = field[COOP_GUEST_FIELD_INDEX];
    guestMon.summonData.ability = AbilityId.MOXIE;
    guestMon.getMoveset()[0].ppUsed += 3;

    const divergedChecksum = captureCoopChecksum();
    expect(divergedChecksum).not.toBe(hostChecksum);

    // Heal: adopt the host's full authoritative snapshot wholesale. The next checksum
    // re-converges to the host's - the divergence is gone.
    if (hostSnapshot != null) {
      applyCoopFullSnapshot(hostSnapshot);
    }
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(C) a full-snapshot blob survives JSON round-trip and still heals", async () => {
    const field = await startCoopDouble();
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();

    // Diverge.
    field[COOP_GUEST_FIELD_INDEX].hp = Math.max(1, field[COOP_GUEST_FIELD_INDEX].hp - 5);
    expect(captureCoopChecksum()).not.toBe(hostChecksum);

    // Heal through a JSON round-trip (what crosses the wire as the compressed blob).
    if (snapshot != null) {
      const roundTripped = JSON.parse(JSON.stringify(snapshot));
      applyCoopFullSnapshot(roundTripped);
    }
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });
});
