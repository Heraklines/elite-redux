/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op LAUNCH (#633). The live "guest stuck on loading" hang: at the end of
// starter-select both clients launched the merged party through the INTERACTIVE
// SAVE_SLOT picker (choose a slot + overwrite-confirm + deleteSession). That modal
// runs INDEPENDENTLY on each client - the same desync class we already removed for
// the battle-start "switch?" prompt and the host-only challenge screen - and on the
// GUEST it never resolves into EncounterPhase (it stalls on a second human's
// confirm, or its overwrite `deleteSession` returns false and triggers a reset).
// Only the HOST is the persistence authority, so only the host runs SAVE_SLOT; the
// guest drops straight into the merged battle on its current slot.
//
// Two tiers:
//   Tier 1 (always runs): the pure slot-clamp `coopGuestSessionSlot` - engine-free.
//   Tier 2 (ER_SCENARIO=1): the REAL SelectStarterPhase.launchCoopMergedParty driven
//     headlessly with the UI spied - proving the GUEST never opens UiMode.SAVE_SLOT
//     (and reaches initBattle), while the HOST still does (solo path unchanged).
//
// A true two-GameManager test is impossible headlessly (PokeRogue's `globalScene` is
// a process singleton, so two clients can't coexist in one vitest process); driving
// the real launch decision as each role is the faithful, deterministic substitute.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { captureCoopEnemies } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_SAVE_SLOT_COUNT, coopGuestSessionSlot } from "#data/elite-redux/coop/coop-session";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { buildCoopEnemy } from "#phases/encounter-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("co-op launch (#633) - pure guest slot clamp", () => {
  it("keeps a valid slot (0..4) unchanged", () => {
    for (let s = 0; s < COOP_SAVE_SLOT_COUNT; s++) {
      expect(coopGuestSessionSlot(s)).toBe(s);
    }
  });

  it("defaults to slot 0 for an unset / out-of-range / non-integer slot", () => {
    expect(coopGuestSessionSlot(-1)).toBe(0); // unset (engine default)
    expect(coopGuestSessionSlot(COOP_SAVE_SLOT_COUNT)).toBe(0); // past the last real slot
    expect(coopGuestSessionSlot(99)).toBe(0);
    expect(coopGuestSessionSlot(1.5)).toBe(0);
    expect(coopGuestSessionSlot(Number.NaN)).toBe(0);
  });
});

describe.skipIf(!RUN)("co-op launch (#633) - real phase launch decision (hang fix)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    // Boot a real scene so globalScene.ui exists; then flip into co-op so the launch
    // helper runs in the mode it ships in.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  it("the GUEST launches WITHOUT opening the interactive SAVE_SLOT modal (and reaches initBattle)", () => {
    const phase = new SelectStarterPhase();
    // Isolate the LAUNCH DECISION from the heavy battle init: record initBattle, no-op it.
    const initSpy = vi.spyOn(phase, "initBattle").mockImplementation(() => {});
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode").mockImplementation(() => Promise.resolve());

    globalScene.sessionSlotId = 2; // the guest had slot 2 selected from the lobby
    phase.launchCoopMergedParty([], [], "guest");

    // No save-slot picker opened for the guest...
    const openedSaveSlot = setModeSpy.mock.calls.some(([mode]) => mode === UiMode.SAVE_SLOT);
    expect(openedSaveSlot).toBe(false);
    // ...it went straight into the battle on its (clamped) current slot.
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(globalScene.sessionSlotId).toBe(2);
  });

  it("the HOST still opens the SAVE_SLOT picker (persistence authority, solo path unchanged)", () => {
    const phase = new SelectStarterPhase();
    const initSpy = vi.spyOn(phase, "initBattle").mockImplementation(() => {});
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode").mockImplementation(() => Promise.resolve());

    phase.launchCoopMergedParty([], [], "host");

    // The host runs the interactive slot picker exactly as before...
    const openedSaveSlot = setModeSpy.mock.calls.some(([mode]) => mode === UiMode.SAVE_SLOT);
    expect(openedSaveSlot).toBe(true);
    // ...and does NOT launch until the human has chosen a slot (the mocked picker
    // never fires its callback here).
    expect(initSpy).not.toHaveBeenCalled();
  });

  it("the guest reconstructs the host's EXACT enemy party from the stream (species divergence fix)", () => {
    // The host's generated enemy party, serialized for the wire (LIVE-D6).
    const hostParty = globalScene.getEnemyParty();
    expect(hostParty.length).toBeGreaterThan(0);
    const serialized = captureCoopEnemies();
    expect(serialized.length).toBe(hostParty.length);

    // The guest rebuilds each enemy from the host's serialized identity. Even though
    // the guest's own RNG would roll DIFFERENT mons (the live host-Hoothoot /
    // guest-Venonat divergence), the rebuilt party matches the host's exactly -
    // species, ability slot, nature, IVs, and moveset - so both clients fight the
    // same enemies.
    serialized.forEach((entry, i) => {
      const rebuilt = buildCoopEnemy(entry.data, 5);
      expect(rebuilt).not.toBeNull();
      expect(rebuilt?.species.speciesId).toBe(hostParty[i].species.speciesId);
      expect(rebuilt?.abilityIndex).toBe(hostParty[i].abilityIndex);
      expect(rebuilt?.nature).toBe(hostParty[i].nature);
      expect(rebuilt?.ivs).toEqual(hostParty[i].ivs);
      expect(rebuilt?.getMoveset().map(m => m.moveId)).toEqual(hostParty[i].getMoveset().map(m => m.moveId));
    });
  });
});
