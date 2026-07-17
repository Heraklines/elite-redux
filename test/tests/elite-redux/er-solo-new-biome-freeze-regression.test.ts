/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P0 live regression (2026-07-17): a SOLO classic run froze on the FIRST wave of
// a NEW biome (the wave-11 / wave-N+1 encounter right after a successful
// SwitchBiomePhase -> NewBiomeEncounterPhase). Two live captures shared the exact
// signature - the run reached NewBiomeEncounterPhase, generated the wild enemy,
// then hung with the phase never ending (UI stuck in MESSAGE). This is the
// downstream freeze the prior P0 biome-pick fix (9b65f9084) exposed by finally
// letting solo runs PAST the transition.
//
// Root cause: NewBiomeEncounterPhase gated its encounter-presentation liveness on
// coopBoundaryStillLive(), which returns FALSE off co-op (coopGeneration < 0). It
// fed that into two seams that ALSO run for solo:
//   1. isEncounterPresentationBoundaryLive() (EncounterPhase.runEncounter's async
//      chain early-returns -> the encounter never presents), and
//   2. the doEncounterCommon(...) `remainsCurrent` predicate inside
//      startPresentationIntro (doEncounterCommon early-returns before this.end()).
// Both made a solo new-biome encounter stall forever.
//
// The fix routes solo through the base "always live" boundary and only ties the
// shared presentation to the retained co-op boundary for a bounded authoritative
// co-op phase. This test drives a real solo NewBiomeEncounterPhase presentation:
// pre-fix it never reaches this.end(); post-fix it does.
//
// Gated behind ER_SCENARIO=1 (like every ER engine test).
// =============================================================================

import { SpeciesId } from "#enums/species-id";
import { NewBiomeEncounterPhase } from "#phases/new-biome-encounter-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("solo new-biome encounter presents instead of freezing (P0 wave-11 freeze)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("isEncounterPresentationBoundaryLive() is TRUE for a solo new-biome phase", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const phase = new NewBiomeEncounterPhase();
    const live = (
      phase as unknown as { isEncounterPresentationBoundaryLive: () => boolean }
    ).isEncounterPresentationBoundaryLive();

    // Pre-fix: coopBoundaryStillLive() -> false off co-op, so runEncounter's async
    // presentation chain early-returns and the phase never ends.
    expect(live, "a solo new-biome encounter must be presentation-live").toBe(true);
  });

  it("doEncounter drives the presentation to end() (does not stall in MESSAGE)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const phase = new NewBiomeEncounterPhase();
    // Capture that the presentation actually reaches its terminal seam. Drive the
    // presentation directly (not via the live queue), so the assertion is the
    // presentation's own completion, not queue mechanics. The headless tween mock
    // fires onComplete synchronously, so continueIntro -> doEncounterCommon runs inline.
    let ended = false;
    (phase as unknown as { end: () => void }).end = () => {
      ended = true;
    };

    (phase as unknown as { doEncounter: () => void }).doEncounter();

    // Pre-fix: doEncounterCommon's `remainsCurrent` (coopBoundaryStillLive) is false,
    // so it returns before ever calling this.end() - the softlock.
    expect(ended, "the solo new-biome encounter presentation reaches end()").toBe(true);
  });
});
