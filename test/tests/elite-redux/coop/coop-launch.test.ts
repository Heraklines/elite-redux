/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op LAUNCH (#633). The live launch hangs: at the end of starter-select the
// merged party launched through the INTERACTIVE SAVE_SLOT picker (choose a slot +
// overwrite-confirm + deleteSession). That modal runs INDEPENDENTLY on each client -
// the same desync class we already removed for the battle-start "switch?" prompt and
// the host-only challenge screen.
//   - GUEST: it never resolves into EncounterPhase (stalls on a second human's
//     confirm, or its overwrite `deleteSession` returns false and triggers a reset).
//   - HOST: its per-slot cloud loads dead-end ("Session not found." on every empty
//     slot), the picker callback never fires, so initBattle never runs and the guest
//     waits forever.
// So NEITHER client runs the picker now: both AUTO-PICK a slot and drop straight into
// the merged battle. The HOST (persistence authority) picks the FIRST EMPTY slot from
// a DIRECT localStorage occupancy read (never overwriting an existing run), falling
// back to its current slot only when all 5 are full. The guest reuses its current slot.
//
// Two tiers:
//   Tier 1 (always runs): the pure slot helpers `coopGuestSessionSlot` /
//     `coopHostSessionSlot` / `coopHostFallbackSlot` - engine-free, incl. the host
//     auto-slot data-safety guarantees (never returns an occupied slot).
//   Tier 2 (ER_SCENARIO=1): the REAL SelectStarterPhase.launchCoopMergedParty driven
//     headlessly with the UI spied - proving NEITHER role opens UiMode.SAVE_SLOT, both
//     reach initBattle, and the host auto-picks an EMPTY slot (solo path unchanged).
//
// A true two-GameManager test is impossible headlessly (PokeRogue's `globalScene` is
// a process singleton, so two clients can't coexist in one vitest process); driving
// the real launch decision as each role is the faithful, deterministic substitute.
// =============================================================================

import { getSessionDataLocalStorageKey } from "#app/account";
import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { captureCoopEnemies } from "#data/elite-redux/coop/coop-battle-engine";
import { buildCoopEnemy } from "#data/elite-redux/coop/coop-enemy-builder";
import { clearCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_SAVE_SLOT_COUNT,
  coopGuestSessionSlot,
  coopHostFallbackSlot,
  coopHostSessionSlot,
} from "#data/elite-redux/coop/coop-session";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
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

describe("co-op launch (#633) - HOST auto-slot picker (data-safety)", () => {
  /** Build a probe over a fixed occupancy map: occupied[slot] = does the slot hold data. */
  const probeFrom = (occupied: readonly boolean[]) => async (slot: number) => occupied[slot] === true;

  it("picks the FIRST empty slot and NEVER returns one that holds session data", async () => {
    // Slots 0 and 1 are occupied (real runs); 2,3,4 are empty -> must pick 2.
    const occupied = [true, true, false, true, false];
    const slot = await coopHostSessionSlot(probeFrom(occupied), /* current */ 3);
    expect(slot).toBe(2);
    expect(occupied[slot]).toBe(false); // the picked slot is genuinely empty - no overwrite
  });

  it("picks slot 0 when it is empty (the common fresh-start case)", async () => {
    const occupied = [false, false, false, false, false];
    expect(await coopHostSessionSlot(probeFrom(occupied), 4)).toBe(0);
  });

  it("scans in order and skips every occupied slot until the first gap", async () => {
    // Only slot 4 is free.
    const occupied = [true, true, true, true, false];
    const slot = await coopHostSessionSlot(probeFrom(occupied), 1);
    expect(slot).toBe(4);
    expect(occupied[slot]).toBe(false);
  });

  it("falls back to the host's CURRENT slot ONLY when all 5 slots are full", async () => {
    const occupied = [true, true, true, true, true];
    expect(await coopHostSessionSlot(probeFrom(occupied), 3)).toBe(3);
    expect(await coopHostSessionSlot(probeFrom(occupied), 0)).toBe(0);
    // ...and clamps an unset / invalid current to slot 0 (engine default).
    expect(await coopHostSessionSlot(probeFrom(occupied), -1)).toBe(0);
    expect(await coopHostSessionSlot(probeFrom(occupied), 99)).toBe(0);
    expect(await coopHostSessionSlot(probeFrom(occupied), Number.NaN)).toBe(0);
  });

  it("NEVER selects a slot reported as holding data (exhaustive over every single-gap layout)", async () => {
    // For each layout with exactly one empty slot, the picker must return THAT slot
    // and never an occupied one - the core data-loss guarantee.
    for (let empty = 0; empty < COOP_SAVE_SLOT_COUNT; empty++) {
      const occupied = Array.from({ length: COOP_SAVE_SLOT_COUNT }, (_, s) => s !== empty);
      const slot = await coopHostSessionSlot(probeFrom(occupied), 0);
      expect(slot).toBe(empty);
      expect(occupied[slot]).toBe(false);
    }
  });

  it("coopHostFallbackSlot clamps to a real slot (0..4), defaulting to 0", () => {
    for (let s = 0; s < COOP_SAVE_SLOT_COUNT; s++) {
      expect(coopHostFallbackSlot(s)).toBe(s);
    }
    expect(coopHostFallbackSlot(-1)).toBe(0);
    expect(coopHostFallbackSlot(COOP_SAVE_SLOT_COUNT)).toBe(0);
    expect(coopHostFallbackSlot(1.5)).toBe(0);
    expect(coopHostFallbackSlot(Number.NaN)).toBe(0);
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

  it("the GUEST launches WITHOUT opening the interactive SAVE_SLOT modal (and reaches initBattle)", async () => {
    const phase = new SelectStarterPhase();
    // Isolate the LAUNCH DECISION from the heavy battle init: record initBattle, no-op it.
    const initSpy = vi.spyOn(phase, "initBattle").mockImplementation(() => {});
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode").mockImplementation(() => Promise.resolve());

    globalScene.sessionSlotId = 2; // the guest had slot 2 selected from the lobby
    await phase.launchCoopMergedParty([], [], "guest");
    // The guest reaches initBattle via setMode(MESSAGE).then(...) - a microtask; flush it.
    await Promise.resolve();

    // No save-slot picker opened for the guest...
    const openedSaveSlot = setModeSpy.mock.calls.some(([mode]) => mode === UiMode.SAVE_SLOT);
    expect(openedSaveSlot).toBe(false);
    // ...it went straight into the battle on its (clamped) current slot.
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(globalScene.sessionSlotId).toBe(2);
  });

  it("the HOST AUTO-PICKS an empty slot and launches WITHOUT the SAVE_SLOT picker (#633 host launch hang)", async () => {
    const phase = new SelectStarterPhase();
    const initSpy = vi.spyOn(phase, "initBattle").mockImplementation(() => {});
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode").mockImplementation(() => Promise.resolve());
    const verifiedSlot = vi.spyOn(globalScene.gameData, "findVerifiedEmptyCoopSessionSlot").mockResolvedValue(1);
    const confirmedSlot = vi.spyOn(globalScene.gameData, "confirmPendingFreshCoopSessionSlot").mockReturnValue(true);

    // Simulate slot 0 holding a REAL local run; 1..4 empty. The host must NOT overwrite slot 0.
    localStorage.setItem(getSessionDataLocalStorageKey(0), "EXISTING_RUN");
    for (let s = 1; s < 5; s++) {
      localStorage.removeItem(getSessionDataLocalStorageKey(s));
    }
    globalScene.sessionSlotId = 0; // host's current slot (the occupied one)
    try {
      await phase.launchCoopMergedParty([], [], "host");
      // initBattle is reached via setMode(MESSAGE).then(...) - a microtask; flush it.
      await Promise.resolve();

      // The host opens NO interactive slot picker (the live launch hang is gone)...
      const openedSaveSlot = setModeSpy.mock.calls.some(([mode]) => mode === UiMode.SAVE_SLOT);
      expect(openedSaveSlot).toBe(false);
      // ...it auto-picked the first EMPTY slot (1), NEVER overwriting the occupied slot 0...
      expect(globalScene.sessionSlotId).toBe(1);
      expect(verifiedSlot).toHaveBeenCalledTimes(1);
      expect(confirmedSlot).toHaveBeenCalledWith(1);
      expect(localStorage.getItem(getSessionDataLocalStorageKey(0))).toBe("EXISTING_RUN");
      // ...and dropped straight into the battle.
      expect(initSpy).toHaveBeenCalledTimes(1);
    } finally {
      localStorage.removeItem(getSessionDataLocalStorageKey(0));
    }
  });

  it("the HOST fails closed instead of overwriting when no slot can be verified or reclaimed", async () => {
    const phase = new SelectStarterPhase();
    const initSpy = vi.spyOn(phase, "initBattle").mockImplementation(() => {});
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode").mockImplementation(() => Promise.resolve());
    vi.spyOn(globalScene.gameData, "findCoopLaunchSlotWithOverride").mockResolvedValue(null);
    const confirmedSlot = vi.spyOn(globalScene.gameData, "confirmPendingFreshCoopSessionSlot");

    for (let s = 0; s < 5; s++) {
      localStorage.setItem(getSessionDataLocalStorageKey(s), `RUN_${s}`);
    }
    globalScene.sessionSlotId = 3; // host's current slot
    try {
      await phase.launchCoopMergedParty([], [], "host");
      await Promise.resolve();

      // No replica-confirmed empty slot exists: keep every byte untouched and stop before materialization.
      expect(globalScene.sessionSlotId).toBe(3);
      expect(initSpy).not.toHaveBeenCalled();
      expect(confirmedSlot).not.toHaveBeenCalled();
      expect(setModeSpy.mock.calls.some(([mode]) => mode === UiMode.SAVE_SLOT)).toBe(false);
      for (let s = 0; s < 5; s++) {
        expect(localStorage.getItem(getSessionDataLocalStorageKey(s))).toBe(`RUN_${s}`);
      }
    } finally {
      for (let s = 0; s < 5; s++) {
        localStorage.removeItem(getSessionDataLocalStorageKey(s));
      }
    }
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
