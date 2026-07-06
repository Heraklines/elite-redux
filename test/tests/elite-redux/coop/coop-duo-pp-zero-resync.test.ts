/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op PP ZERO-RESYNC PROOF (#838, Phase 5 - the finale of the full-state refactor).
//
// The historical KNOWN REAL DESYNC (see CLAUDE.md "Two-engine co-op harness"): the per-turn numeric
// CHECKPOINT reconciled hp/status/stages/tags/weather/terrain/money but NOT moveset `ppUsed`. The
// pure-renderer guest never decrements PP, the checksum hashes PP, so EVERY turn a move was used the
// guest diverged and forced a full `stateSync` resync. That was the top source of "normal-play" resyncs.
//
// The full-state authoritative payload (CoopAuthoritativeBattleStateV1) closes that BY CONSTRUCTION: it
// carries both parties as serialized `PokemonData`, and PP rides through the serialized `PokemonMove.ppUsed`
// in each mon's moveset. So once the guest applies the authoritative state (which it does every finalize,
// BEFORE the checksum verify), its PP EQUALS the host's - the checksum matches with ZERO mismatch, and the
// Phase-5 `[coop:ASSERT]` assertion never fires.
//
// This is the REAL two-engine proof of that guarantee: a SECOND real engine (the guest BattleScene) whose
// on-field PP is DELIBERATELY diverged from the host's (the exact renderer-lag class) applies the host's
// authoritative payload and its full-state checksum SNAPS BACK to equal the host's - PP closed, assertion
// count still 0. The isolation assertion proves PP is the SOLE pre-apply divergence (strip `ppUsed` and the
// two field states are byte-equal), so this is a PP proof, not an incidental convergence.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-pp-zero-resync.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  applyCoopAuthoritativeBattleState,
  captureCoopAuthoritativeBattleState,
  captureCoopChecksum,
  captureCoopChecksumState,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  getCoopChecksumAssertionCount,
  resetCoopChecksumAssertionCount,
  setCoopChecksumAssertSeverity,
} from "#data/elite-redux/coop/coop-checksum-assert";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/**
 * Deep-clone a captured checksum-state `field` array with every move's `ppUsed` zeroed (PP-strip). The
 * per-mon `moves` channel is a `[moveId, ppUsed]` tuple list, so ppUsed is index 1 of each move tuple.
 */
function stripPp(field: unknown): string {
  const cloned = JSON.parse(JSON.stringify(field)) as { moves?: [number, number][] }[];
  for (const mon of cloned) {
    for (const move of mon.moves ?? []) {
      move[1] = 0;
    }
  }
  return JSON.stringify(cloned);
}

describe.skipIf(!RUN)(
  "co-op DUO PP zero-resync: the authoritative payload converges PP by construction (#838 P5)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`pp-zero-resync-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(1)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .moveset([MoveId.TACKLE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
      initGlobalScene(game.scene);
    });

    it("a guest whose on-field PP diverges from the host converges to byte-equal PP with ZERO checksum mismatch", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

      // BASELINE: apply the host's authoritative state once so host + guest are byte-equal before we perturb
      // PP - this makes the PP divergence below the SOLE difference (not riding on any residual mirror gap).
      const baseline = await withClient(rig.hostCtx, () => captureCoopAuthoritativeBattleState(1));
      expect(baseline, "host produced a baseline authoritative state").not.toBeNull();
      await withClient(rig.guestCtx, () => applyCoopAuthoritativeBattleState(baseline ?? undefined, true));
      const hostBaseChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());
      const guestBaseChecksum = await withClient(rig.guestCtx, () => captureCoopChecksum());
      expect(guestBaseChecksum, "host + guest are byte-equal after the baseline apply").toBe(hostBaseChecksum);

      // From here the Phase-5 assertion counter must never move: pin the loud severity + zero the tally.
      setCoopChecksumAssertSeverity("assert");
      resetCoopChecksumAssertionCount();

      // PERTURB the HOST's on-field PP (the host consumed PP this turn); the pure-renderer guest never
      // decremented, so it now LAGS the host on `ppUsed` - the exact historical PP desync class.
      await withClient(rig.hostCtx, () => {
        const mon = rig.hostScene.getPlayerField()[0];
        const move = (mon.moveset ?? []).find(m => m != null);
        expect(move, "the host lead has a move to consume PP on").toBeTruthy();
        if (move != null) {
          move.ppUsed += 5;
        }
      });

      // PP genuinely diverged: the full-state checksum differs, and it differs ONLY in PP.
      const hostState = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());
      const guestPreChecksum = await withClient(rig.guestCtx, () => captureCoopChecksum());
      expect(guestPreChecksum, "the PP-perturbed guest DIVERGES from the host before the apply").not.toBe(hostChecksum);
      // PP-ISOLATION: the ONLY top-level checksum-state key that differs is `field`...
      const hostRec = hostState as unknown as Record<string, unknown>;
      const guestRec = guestState as unknown as Record<string, unknown>;
      const differingKeys = Object.keys(hostRec).filter(
        k => JSON.stringify(hostRec[k]) !== JSON.stringify(guestRec[k]),
      );
      expect(differingKeys, "the sole pre-apply divergence is the on-field `field` state").toEqual(["field"]);
      // ...and WITHIN `field`, stripping every move's ppUsed makes the two byte-equal (PP is the whole diff).
      expect(
        stripPp(guestState.field),
        "with ppUsed stripped, host + guest field states are byte-equal - PP is the SOLE divergence",
      ).toBe(stripPp(hostState.field));
      expect(
        JSON.stringify(guestState.field),
        "with ppUsed KEPT, host + guest field states genuinely differ (the PP actually diverged)",
      ).not.toBe(JSON.stringify(hostState.field));

      // APPLY the host's authoritative payload on the guest. PP rides through the serialized moveset ppUsed,
      // so this converges PP BY CONSTRUCTION - no resync, no stateSync, no PP-specific reconcile.
      const authoritative = await withClient(rig.hostCtx, () => captureCoopAuthoritativeBattleState(2));
      expect(authoritative, "host produced the authoritative payload carrying its PP").not.toBeNull();
      const applied = await withClient(rig.guestCtx, () =>
        applyCoopAuthoritativeBattleState(authoritative ?? undefined, true),
      );
      expect(applied, "the guest applied the authoritative payload").toBe(true);

      // CONVERGED: the guest full-state checksum EQUALS the host's - PP closed with ZERO mismatch.
      const guestAfterChecksum = await withClient(rig.guestCtx, () => captureCoopChecksum());
      expect(
        guestAfterChecksum,
        "guest checksum EQUALS the host's after applying the authoritative payload (PP converged by construction)",
      ).toBe(hostChecksum);

      // ...and the Phase-5 production assertion NEVER fired: the payload closed PP before any verify could
      // read a mismatch. This is the "zero checksum mismatches" gate the soak enforces run-wide.
      expect(
        getCoopChecksumAssertionCount(),
        "no [coop:ASSERT] checksum assertion fired - the payload converged PP with zero mismatches",
      ).toBe(0);

      logs.flush();
    }, 300_000);
  },
);
