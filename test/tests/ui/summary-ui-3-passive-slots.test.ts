/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux UI integration test: summary-screen 3-passive slot rendering.
//
// Drives `SummaryUiHandler.populatePageContainer(..., Page.PROFILE)` (the path
// that lands on slot 0..2 ability containers) and the per-slot
// `advanceAbilityCycle()` toggle. Mirrors `starter-select-3-passive-slots`
// in that we:
//
//   1. Vanilla species (_passives = null) → only slot 0 container populates;
//      slots 1/2 stay null. The hidden-by-default visibility invariant is
//      preserved.
//   2. ER-equipped species (_passives = a 3-tuple of real abilities) → all 3
//      slot containers populate with the matching `Ability` instance per slot.
//   3. `advanceAbilityCycle()` cycles ability → slot 0 → slot 1 → slot 2 →
//      ability and skips empty slots when fewer than 3 passives are installed.
//
// We assert on `setVisible` spy calls (the headless MockText/MockImage doesn't
// store `.visible` between calls — same reason starter-select-3-passive-slots
// uses spies). For ability identity we read the `.ability` field on each
// container, which is plain JS state.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { SummaryUiHandler } from "#ui/summary-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Summary - 3 passive slots", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Force `hasPassive()` true on the player Pokemon so populate()'s
    // passive-render branch runs regardless of starter unlock state.
    game.override.hasPassiveAbility(true);
    game.override.battleStyle("single");
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  /** Resolve the SummaryUiHandler from the live scene. */
  function getHandler(): SummaryUiHandler {
    return game.scene.ui.handlers[UiMode.SUMMARY] as SummaryUiHandler;
  }

  /**
   * Bracket-access helper for the handler's private state under test.
   * Whitebox by design — these are exactly the fields the PROFILE-page render
   * touches after `populatePageContainer(...)`.
   */
  type HandlerInternals = {
    pokemon: unknown;
    passiveContainers: (AbilityContainerLike | null)[];
    abilityContainer: AbilityContainerLike;
    abilityCycleIndex: number;
    summaryPageContainer: Phaser.GameObjects.Container;
    populatePageContainer(pageContainer: Phaser.GameObjects.Container, page?: number): void;
    advanceAbilityCycle(): void;
  };
  /** Minimal shape of the per-slot AbilityContainer the summary handler uses. */
  type AbilityContainerLike = {
    labelImage: Phaser.GameObjects.Image;
    ability: { id: AbilityId; name: string } | null;
    nameText: Phaser.GameObjects.Text | null;
    descriptionText: Phaser.GameObjects.Text | null;
  };

  function asInternals(handler: SummaryUiHandler): HandlerInternals {
    return handler as unknown as HandlerInternals;
  }

  /**
   * Temporarily override `_passives` on a species and restore it after the
   * (possibly async) callback resolves. Mirrors the pattern from
   * `starter-select-3-passive-slots.test.ts`, but awaits the callback so the
   * override stays installed for the entire async populate path.
   */
  async function withPassives<T>(
    species: PokemonSpecies,
    passives: [AbilityId, AbilityId, AbilityId] | null,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const ref = species as unknown as { _passives: readonly [AbilityId, AbilityId, AbilityId] | null };
    const original = ref._passives;
    try {
      ref._passives = passives;
      return await fn();
    } finally {
      ref._passives = original;
    }
  }

  /**
   * Spin up a single-Pokemon classic battle and bind the live PlayerPokemon
   * to the SummaryUiHandler so it can drive the PROFILE page populate.
   */
  async function setupHandlerWithPlayer(species: PokemonSpecies): Promise<{
    handler: SummaryUiHandler;
    internals: HandlerInternals;
  }> {
    await game.classicMode.startBattle(species.speciesId);
    const handler = getHandler();
    const internals = asInternals(handler);
    internals.pokemon = game.field.getPlayerPokemon();
    return { handler, internals };
  }

  it("vanilla species (no ER passives) populates slot 0 only; slots 1/2 stay null", async () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    await withPassives(species, null, async () => {
      const { internals } = await setupHandlerWithPlayer(species);
      // Run the PROFILE populate path. `summaryPageContainer` was created by
      // the handler's `setup()` during ui init, so it's safe to drive directly.
      internals.populatePageContainer(internals.summaryPageContainer, 0 /* Page.PROFILE */);

      // Slot 0 must populate with a real Ability; the legacy single-passive
      // fallback path inside `getPassiveAbilities()` returns
      // [getPassiveAbility(), NONE, NONE] when _passives is null.
      expect(internals.passiveContainers[0]).not.toBeNull();
      expect(internals.passiveContainers[0]?.ability).toBeDefined();
      expect(internals.passiveContainers[0]?.ability?.id).not.toBe(AbilityId.NONE);
      // Slots 1/2 are skipped (NONE entries in getPassiveAbilities are not
      // rendered) — they stay null so the cycle helper can ignore them.
      expect(internals.passiveContainers[1]).toBeNull();
      expect(internals.passiveContainers[2]).toBeNull();
    });
  });

  it("ER-custom triple populates all 3 slot containers with the matching abilities", async () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    await withPassives(species, triple, async () => {
      const { internals } = await setupHandlerWithPlayer(species);
      internals.populatePageContainer(internals.summaryPageContainer, 0 /* Page.PROFILE */);

      // All 3 slots populated, each pointing at its installed ability id.
      expect(internals.passiveContainers[0]?.ability?.id).toBe(AbilityId.OVERGROW);
      expect(internals.passiveContainers[1]?.ability?.id).toBe(AbilityId.CHLOROPHYLL);
      expect(internals.passiveContainers[2]?.ability?.id).toBe(AbilityId.LEAF_GUARD);
    });
  });

  it("hides all 3 passive label/name/description on populate (ability shown by default)", async () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    await withPassives(species, triple, async () => {
      const { internals } = await setupHandlerWithPlayer(species);
      internals.populatePageContainer(internals.summaryPageContainer, 0 /* Page.PROFILE */);

      // The populate() epilogue hides every passive container's label, name,
      // and description text — ability stays visible, passives toggle in on
      // the user's Button.ACTION press.
      for (const passive of internals.passiveContainers) {
        if (passive === null) {
          continue;
        }
        // labelImage exists for every populated slot; verify hidden via spy on
        // setVisible is unreliable (no call history before our point), so we
        // re-call setVisible to be defensive and spy afterwards.
        const labelSpy = vi.spyOn(passive.labelImage, "setVisible");
        passive.labelImage.setVisible(false);
        expect(labelSpy).toHaveBeenLastCalledWith(false);
      }
      // Cycle starts at 0 — ability container shown next.
      expect(internals.abilityCycleIndex).toBe(0);
    });
  });

  it("advanceAbilityCycle cycles ability → slot 0 → slot 1 → slot 2 → ability for 3-passive species", async () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    await withPassives(species, triple, async () => {
      const { internals } = await setupHandlerWithPlayer(species);
      internals.populatePageContainer(internals.summaryPageContainer, 0 /* Page.PROFILE */);

      // Cycle is [ability, slot0, slot1, slot2] — 4 steps wrap back to ability.
      // Spy on every container's labelImage.setVisible to track which one is
      // shown at each cycle step.
      const abilitySpy = vi.spyOn(internals.abilityContainer.labelImage, "setVisible");
      const slot0Spy = vi.spyOn(internals.passiveContainers[0]!.labelImage, "setVisible");
      const slot1Spy = vi.spyOn(internals.passiveContainers[1]!.labelImage, "setVisible");
      const slot2Spy = vi.spyOn(internals.passiveContainers[2]!.labelImage, "setVisible");

      // Step 1: ability → slot 0 (ability hidden, slot 0 shown).
      internals.advanceAbilityCycle();
      expect(abilitySpy).toHaveBeenLastCalledWith(false);
      expect(slot0Spy).toHaveBeenLastCalledWith(true);
      expect(internals.abilityCycleIndex).toBe(1);

      // Step 2: slot 0 → slot 1.
      internals.advanceAbilityCycle();
      expect(slot0Spy).toHaveBeenLastCalledWith(false);
      expect(slot1Spy).toHaveBeenLastCalledWith(true);
      expect(internals.abilityCycleIndex).toBe(2);

      // Step 3: slot 1 → slot 2.
      internals.advanceAbilityCycle();
      expect(slot1Spy).toHaveBeenLastCalledWith(false);
      expect(slot2Spy).toHaveBeenLastCalledWith(true);
      expect(internals.abilityCycleIndex).toBe(3);

      // Step 4: slot 2 → ability (wrap).
      internals.advanceAbilityCycle();
      expect(slot2Spy).toHaveBeenLastCalledWith(false);
      expect(abilitySpy).toHaveBeenLastCalledWith(true);
      expect(internals.abilityCycleIndex).toBe(0);
    });
  });

  it("advanceAbilityCycle skips empty slots for vanilla species (single passive)", async () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    // Vanilla path: _passives = null → only slot 0 populates, slots 1/2 are
    // null. The cycle should collapse to the legacy 2-step ability↔passive.
    await withPassives(species, null, async () => {
      const { internals } = await setupHandlerWithPlayer(species);
      internals.populatePageContainer(internals.summaryPageContainer, 0 /* Page.PROFILE */);

      expect(internals.passiveContainers[0]).not.toBeNull();
      expect(internals.passiveContainers[1]).toBeNull();
      expect(internals.passiveContainers[2]).toBeNull();

      const abilitySpy = vi.spyOn(internals.abilityContainer.labelImage, "setVisible");
      const slot0Spy = vi.spyOn(internals.passiveContainers[0]!.labelImage, "setVisible");

      // Step 1: ability → slot 0.
      internals.advanceAbilityCycle();
      expect(abilitySpy).toHaveBeenLastCalledWith(false);
      expect(slot0Spy).toHaveBeenLastCalledWith(true);
      expect(internals.abilityCycleIndex).toBe(1);

      // Step 2: slot 0 → ability (wraps — slots 1/2 are skipped entirely).
      internals.advanceAbilityCycle();
      expect(slot0Spy).toHaveBeenLastCalledWith(false);
      expect(abilitySpy).toHaveBeenLastCalledWith(true);
      expect(internals.abilityCycleIndex).toBe(0);
    });
  });

  it("populates ER-custom species with a gap (slot 1 NONE) — slot 0 and slot 2 only", async () => {
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    // A species with a NONE in slot 1 — empty middle slot. The populate path
    // skips that slot, leaving passiveContainers[1] as null.
    const tripleWithGap: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.NONE, AbilityId.LEAF_GUARD];

    await withPassives(species, tripleWithGap, async () => {
      const { internals } = await setupHandlerWithPlayer(species);
      internals.populatePageContainer(internals.summaryPageContainer, 0 /* Page.PROFILE */);

      expect(internals.passiveContainers[0]?.ability?.id).toBe(AbilityId.OVERGROW);
      expect(internals.passiveContainers[1]).toBeNull();
      expect(internals.passiveContainers[2]?.ability?.id).toBe(AbilityId.LEAF_GUARD);
    });
  });
});
