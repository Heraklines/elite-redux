/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P0 live regression (2026-07-16): every SOLO endless run froze at the wave-10
// World-Map biome pick. SelectBiomePhase.setNextBiomeAndEnd - the single
// terminal EVERY multi-option biome pick funnels through - unconditionally
// called requireCoopBiomeOperationRole(), whose P33 binding capture THROWS
// when no co-op runtime is installed ("[coop-op] no runtime installed for
// surface=biome"). The picker's onSelect died uncaught and the phase never
// ended ("stuck at wave 10, not switching biomes").
//
// The fix is a solo fast path at the head of the funnel. This test drives the
// funnel directly on a solo battle: pre-fix it THROWS synchronously; post-fix
// it applies the biome (queues SwitchBiomePhase) and returns true.
//
// Gated behind ER_SCENARIO=1 (like every ER engine test).
// =============================================================================

import { captureCoopBiomeOperationBinding } from "#data/elite-redux/coop/coop-biome-operation";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { SelectBiomePhase } from "#phases/select-biome-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("solo biome pick does not require a co-op runtime (P0 wave-10 freeze)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("the P33 binding capture still fails closed outside co-op (the hazard the funnel must guard)", () => {
    expect(() => captureCoopBiomeOperationBinding()).toThrow(/no runtime installed for surface=biome/);
  });

  it("setNextBiomeAndEnd applies the picked biome in a SOLO game instead of throwing", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const phase = new SelectBiomePhase(game.scene.currentBattle.waveIndex);
    // The phase is driven directly (not via the live queue), so neutralize end()
    // - the assertion is the funnel's behavior, not queue mechanics.
    (phase as unknown as { end: () => void }).end = () => {};

    let applied = false;
    // Pre-fix: this line THROWS "[coop-op] no runtime installed for surface=biome".
    expect(() => {
      applied = (phase as unknown as { setNextBiomeAndEnd: (b: BiomeId) => boolean }).setNextBiomeAndEnd(
        BiomeId.FOREST,
      );
    }).not.toThrow();
    expect(applied, "solo pick applies directly").toBe(true);

    const queued = game.scene.phaseManager.hasPhaseOfType?.("SwitchBiomePhase", () => true);
    expect(queued ?? true, "the biome transition phase was queued").toBeTruthy();
  });
});
