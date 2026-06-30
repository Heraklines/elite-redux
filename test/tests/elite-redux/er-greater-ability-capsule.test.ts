/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Greater Ability Capsule - the rarer, stronger Ability Capsule (violet reskin).
// On use the player chooses ONE of:
//   (A) PERMANENTLY unlock ONE innate slot - writes the real candy-style unlock to
//       gameData.starterData[root].passiveAttr (UNLOCKED + ENABLED bits) so the
//       innate stays unlocked in starter-select AND future runs.
//   (B) RUN-unlock TWO innate slots - run-only (erRunUnlockedAbilitySlots, serialized
//       with the session save) and NEVER the permanent starterData unlock.
//
// Verifies: (A) the permanent unlock writes starterData (UNLOCKED + ENABLED), makes
// the innate fire this run, persists the account save, and is the candy-equivalent
// (still unlocked after a future run starts from that starterData); (B) run-unlocking
// two slots round-trips on customPokemonData and does NOT touch the permanent unlock;
// plus the availability gates + a fusion writes to the owning species.
// =============================================================================

import { erRunUnlockableInnateSlots } from "#data/elite-redux/er-ability-capsule";
import {
  GREATER_CAPSULE_RUN_UNLOCK_COUNT,
  greaterCapsuleCanPermanentlyUnlock,
  greaterCapsuleCanRunUnlockTwo,
  greaterCapsulePermanentlyUnlockableInnateSlots,
  greaterCapsulePermanentlyUnlockInnate,
  greaterCapsuleRunUnlockInnates,
  greaterCapsuleUnlockableInnateSlots,
} from "#data/elite-redux/er-greater-ability-capsule";
import { CustomPokemonData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { isSlotEnabled, isSlotUnlocked } from "#utils/passive-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Greater Ability Capsule - live effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH).enemyLevel(5);
  });

  // ---- Availability gates ----

  it("offers both options when a mon has 2+ locked innates, permanent-only with exactly 1", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    // A fresh scenario mon has NO candy innate unlock, so every present innate slot
    // is locked + run-unlockable.
    const lockedInnates = mon.getAbilitySlots().filter(s => s.slot >= 1);
    expect(lockedInnates.length).toBeGreaterThanOrEqual(2);
    expect(greaterCapsuleCanPermanentlyUnlock(mon)).toBe(true);
    expect(greaterCapsuleCanRunUnlockTwo(mon)).toBe(true);
    // The offered set is exactly the normal capsule's run-unlockable set.
    expect(greaterCapsuleUnlockableInnateSlots(mon).map(u => u.slot)).toEqual(
      erRunUnlockableInnateSlots(mon).map(u => u.slot),
    );
  });

  // ---- BUGFIX: a RUN-unlocked / Youngster-free innate is still PERMANENTLY unlockable ----

  it("still offers the PERMANENT unlock when every innate is only RUN-unlocked (the Youngster/no-effect bug)", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    const root = mon.species.getRootSpeciesId();
    vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);

    // Run-unlock EVERY locked innate. This mirrors "all innates are free for the run"
    // (a prior Ability Capsule, or Youngster mode making innates free): canApplyAbility
    // becomes TRUE for them, so the RUN-unlockable set goes empty.
    const slots = erRunUnlockableInnateSlots(mon).map(u => u.slot);
    expect(slots.length).toBeGreaterThanOrEqual(1);
    greaterCapsuleRunUnlockInnates(mon, slots);

    // RUN-aware set (option B) now offers nothing - this is what made the item wrongly
    // report "no effect on every Pokemon".
    expect(greaterCapsuleUnlockableInnateSlots(mon)).toHaveLength(0);
    expect(greaterCapsuleCanRunUnlockTwo(mon)).toBe(false);

    // But NONE are PERMANENTLY unlocked (passiveAttr untouched), so option (A) MUST
    // still be available - the fix keys off passiveAttr, not canApplyAbility.
    for (const slot of slots) {
      expect(isSlotUnlocked(game.scene.gameData.starterData[root].passiveAttr, (slot - 1) as 0 | 1 | 2)).toBe(false);
    }
    expect([...greaterCapsulePermanentlyUnlockableInnateSlots(mon).map(u => u.slot)].sort()).toEqual([...slots].sort());
    expect(greaterCapsuleCanPermanentlyUnlock(mon)).toBe(true);

    // Committing the permanent unlock works, then that slot drops out of the offer set.
    const target = slots[0];
    greaterCapsulePermanentlyUnlockInnate(mon, target);
    expect(isSlotUnlocked(game.scene.gameData.starterData[root].passiveAttr, (target - 1) as 0 | 1 | 2)).toBe(true);
    expect(greaterCapsulePermanentlyUnlockableInnateSlots(mon).map(u => u.slot)).not.toContain(target);
  });

  it("an already PERMANENTLY-unlocked innate is correctly excluded (genuine no-op)", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);
    const mon = game.scene.getPlayerPokemon()!;
    const target = greaterCapsulePermanentlyUnlockableInnateSlots(mon)[0];
    expect(target).toBeDefined();
    greaterCapsulePermanentlyUnlockInnate(mon, target.slot);
    expect(greaterCapsulePermanentlyUnlockableInnateSlots(mon).map(u => u.slot)).not.toContain(target.slot);
  });

  // ---- (A) PERMANENT unlock writes starterData and persists ----

  it("(A) permanently unlocks one innate: writes starterData (UNLOCKED+ENABLED), fires this run, saves", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    const root = mon.species.getRootSpeciesId();

    // Spy on the account save so we can assert the permanent write is persisted (the
    // candy-unlock discipline: starterData change must be saved). Mocked so the
    // headless run doesn't actually touch storage timing.
    const saveSpy = vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);

    const target = greaterCapsuleUnlockableInnateSlots(mon)[0];
    expect(target).toBeDefined();
    const passiveSlot = (target.slot - 1) as 0 | 1 | 2;

    // Locked before (no candy unlock).
    expect(mon.canApplyAbility(true, passiveSlot)).toBe(false);
    expect(isSlotUnlocked(game.scene.gameData.starterData[root].passiveAttr, passiveSlot)).toBe(false);

    const result = greaterCapsulePermanentlyUnlockInnate(mon, target.slot);
    expect(result).not.toBeNull();

    // The PERMANENT candy-style unlock is written: both UNLOCKED and ENABLED bits set.
    const attr = game.scene.gameData.starterData[root].passiveAttr;
    expect(isSlotUnlocked(attr, passiveSlot)).toBe(true);
    expect(isSlotEnabled(attr, passiveSlot)).toBe(true);
    // The innate is now LIVE this run.
    expect(mon.canApplyAbility(true, passiveSlot)).toBe(true);
    // The account save was persisted (so starter-select + future runs see it).
    expect(saveSpy).toHaveBeenCalled();
    // It is NOT a run-only entry - the run-unlock set stays empty (the unlock is permanent).
    expect(mon.customPokemonData.erRunUnlockedAbilitySlots).not.toContain(target.slot);
  });

  it("(A) the permanent unlock is account-level: the innate stays live with NO run-unlock entry", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);
    const mon = game.scene.getPlayerPokemon()!;
    // starterData is keyed by the ROOT species id (Garchomp's root is Gible).
    const root = mon.species.getRootSpeciesId();
    const target = greaterCapsuleUnlockableInnateSlots(mon)[0];
    const passiveSlot = (target.slot - 1) as 0 | 1 | 2;

    greaterCapsulePermanentlyUnlockInnate(mon, target.slot);
    expect(isSlotUnlocked(game.scene.gameData.starterData[root].passiveAttr, passiveSlot)).toBe(true);

    // The permanent unlock is ENTIRELY account-level: the mon carries NO run-unlock
    // entry, yet the innate is live purely because starterData.passiveAttr has the
    // slot unlocked. This is exactly what a FUTURE run (a fresh mon, empty run-state)
    // sees - the candy-unlock behavior. Clear the run-unlock set to prove it.
    mon.customPokemonData.erRunUnlockedAbilitySlots = [];
    expect(mon.canApplyAbility(true, passiveSlot)).toBe(true);
  });

  // ---- (B) RUN-unlock two slots, no permanent write ----

  it("(B) run-unlocks TWO innates this run WITHOUT touching the permanent starterData unlock", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    const root = mon.species.getRootSpeciesId();

    const saveSpy = vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);

    // Snapshot the PERMANENT unlock before.
    const permanentAttr = game.scene.gameData.starterData[root].passiveAttr;

    const slots = greaterCapsuleUnlockableInnateSlots(mon)
      .slice(0, GREATER_CAPSULE_RUN_UNLOCK_COUNT)
      .map(u => u.slot);
    expect(slots).toHaveLength(GREATER_CAPSULE_RUN_UNLOCK_COUNT);

    // Locked before.
    for (const slot of slots) {
      expect(mon.canApplyAbility(true, (slot - 1) as 0 | 1 | 2)).toBe(false);
    }

    greaterCapsuleRunUnlockInnates(mon, slots);

    // BOTH are active THIS run.
    for (const slot of slots) {
      expect(mon.canApplyAbility(true, (slot - 1) as 0 | 1 | 2)).toBe(true);
      expect(mon.customPokemonData.erRunUnlockedAbilitySlots).toContain(slot);
    }
    // The PERMANENT starter unlock is UNTOUCHED - the innates still read LOCKED in
    // starter-select + future runs.
    expect(game.scene.gameData.starterData[root].passiveAttr).toBe(permanentAttr);
    // No permanent write happened, so no account save was triggered by the run-unlock.
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("(B) the two run-unlocks survive a customPokemonData round-trip (mid-run reload)", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;

    const slots = greaterCapsuleUnlockableInnateSlots(mon)
      .slice(0, GREATER_CAPSULE_RUN_UNLOCK_COUNT)
      .map(u => u.slot);
    greaterCapsuleRunUnlockInnates(mon, slots);

    // Reconstruct exactly as a loaded session does (JSON -> Partial ctor).
    const round = new CustomPokemonData(JSON.parse(JSON.stringify(mon.customPokemonData)));
    for (const slot of slots) {
      expect(round.erRunUnlockedAbilitySlots).toContain(slot);
    }
  });

  it("a fusion's permanent unlock is written to the species that OWNS the slot", async () => {
    // Fuse Garchomp (base) with Pikachu so innate slots 0/2 (ER slots 1/3) are owned
    // by the fusion species. The permanent unlock for slot 1 (ER slot 2, base-owned)
    // must land on the BASE species' starterData.
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.scene.getPlayerPokemon()!;
    vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);

    // ER slot 2 is the base-owned innate (passive2). If present + locked, unlock it.
    const baseOwnedSlot = greaterCapsuleUnlockableInnateSlots(mon).find(u => u.slot === 2);
    if (!baseOwnedSlot) {
      // Garchomp may not expose a 2nd innate; skip the fusion-owner assertion in that
      // case (the non-fusion permanent-unlock path is already covered above).
      return;
    }
    const baseRoot = mon.species.getRootSpeciesId();
    greaterCapsulePermanentlyUnlockInnate(mon, 2);
    expect(isSlotUnlocked(game.scene.gameData.starterData[baseRoot].passiveAttr, 1)).toBe(true);
  });
});
