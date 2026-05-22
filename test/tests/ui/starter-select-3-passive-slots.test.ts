/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux UI integration test: starter selection 3-passive slot rendering.
//
// Drives the real `StarterSelectUiHandler`'s `renderPassiveSlots` path:
//
//   1. Vanilla species (legacy single-passive path — _passives forced to null)
//      renders slot 1 with the vanilla passive name and slots 2/3 as a faint
//      "—" placeholder.
//   2. ER-equipped species (_passives = a 3-tuple of real abilities) renders
//      all 3 slot text objects with the matching ability names.
//   3. Per-slot bitmask states control the locked/disabled/enabled visuals
//      (icon visibility + text color/alpha).
//
// We don't drive the real Phaser scene through STARTER_SELECT_PHASE (the
// `describe.todo`'d tests in starter-select.test.ts cover that with full save
// data). Instead we instantiate the handler in a headless `BattleScene`,
// directly populate `lastSpecies`, and invoke `renderPassiveSlots()` — the
// pure rendering helper we just added — then spy on the per-slot `setText`
// and `setVisible` calls to verify the rendering decisions.
//
// We assert on calls (via `vi.spyOn`) rather than on `.visible` / `.alpha`
// because the headless `MockText` is a `setVisible`/`setAlpha` no-op and never
// stores those properties — see `test/mocks/mocks-container/mock-text.ts`.
// =============================================================================

import { allAbilities, allSpecies } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { Passive as PassiveAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Starter select - 3 passive slots", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  /**
   * Resolve the StarterSelectUiHandler instance from the live scene. Mirrors
   * the access pattern used by `GameManager.resetScene()`.
   */
  function getHandler(): StarterSelectUiHandler {
    return game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
  }

  /**
   * Bracket-access helper for the handler's private fields. The test is
   * intentionally a white-box test of the render helper — we exercise the
   * exact text/sprite objects the runtime renders.
   */
  type HandlerInternals = {
    lastSpecies: PokemonSpecies;
    pokemonPassiveText: Phaser.GameObjects.Text;
    pokemonPassiveSlotTexts: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    pokemonPassiveDisabledIcon: Phaser.GameObjects.Sprite;
    pokemonPassiveLockedIcon: Phaser.GameObjects.Sprite;
    pokemonPassiveSlotDisabledIcons: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite];
    pokemonPassiveSlotLockedIcons: [Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite];
    renderPassiveSlots(passiveAttr: number, formIndex: number | undefined, isFreshStartChallenge: boolean): void;
  };

  function asInternals(handler: StarterSelectUiHandler): HandlerInternals {
    return handler as unknown as HandlerInternals;
  }

  /**
   * Temporarily override `_passives` on a species and restore it after the
   * callback runs. Mirrors the pattern from
   * `test/data/pokemon-species-passives.test.ts`.
   */
  function withPassives<T>(
    species: PokemonSpecies,
    passives: [AbilityId, AbilityId, AbilityId] | null,
    fn: () => T,
  ): T {
    const ref = species as unknown as { _passives: readonly [AbilityId, AbilityId, AbilityId] | null };
    const original = ref._passives;
    try {
      ref._passives = passives;
      return fn();
    } finally {
      ref._passives = original;
    }
  }

  /**
   * Last argument passed to `setText` on the given mock object. The headless
   * MockText records calls only via `vi.spyOn`; the bare `.text` property
   * isn't updated by `setText` in all execution paths, so we read the spy
   * directly for determinism.
   */
  function lastSetTextArg(spy: ReturnType<typeof vi.spyOn>): unknown {
    expect(spy).toHaveBeenCalled();
    const lastCall = spy.mock.calls.at(-1);
    return lastCall ? lastCall[0] : undefined;
  }

  /**
   * Last argument passed to `setVisible` on the given mock object.
   */
  function lastSetVisibleArg(spy: ReturnType<typeof vi.spyOn>): unknown {
    expect(spy).toHaveBeenCalled();
    const lastCall = spy.mock.calls.at(-1);
    return lastCall ? lastCall[0] : undefined;
  }

  it("vanilla species (legacy single-passive) shows slot 1 + 2 placeholders", () => {
    const handler = getHandler();
    const internals = asInternals(handler);
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    // Force the legacy single-passive fallback path (slot 0 only).
    withPassives(species, null, () => {
      internals.lastSpecies = species;
      const slot0TextSpy = vi.spyOn(internals.pokemonPassiveText, "setText");
      const slot1TextSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[0], "setText");
      const slot2TextSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[1], "setText");
      const slot1DisabledSpy = vi.spyOn(internals.pokemonPassiveSlotDisabledIcons[0], "setVisible");
      const slot1LockedSpy = vi.spyOn(internals.pokemonPassiveSlotLockedIcons[0], "setVisible");
      const slot2DisabledSpy = vi.spyOn(internals.pokemonPassiveSlotDisabledIcons[1], "setVisible");
      const slot2LockedSpy = vi.spyOn(internals.pokemonPassiveSlotLockedIcons[1], "setVisible");

      // All 3 slots unlocked + enabled for slot 0; slots 1/2 should collapse
      // to "—" and slot 0 should render the legacy passive ability name.
      internals.renderPassiveSlots(PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1, 0, false);

      const legacyPassiveName = allAbilities[species.getPassiveAbility(0)].name;
      expect(lastSetTextArg(slot0TextSpy)).toBe(legacyPassiveName);
      // Placeholder en dash for empty slots — keeps layout visually stable.
      expect(lastSetTextArg(slot1TextSpy)).toBe("—");
      expect(lastSetTextArg(slot2TextSpy)).toBe("—");

      // Placeholder slots show no icons (last setVisible call must be `false`).
      expect(lastSetVisibleArg(slot1DisabledSpy)).toBe(false);
      expect(lastSetVisibleArg(slot1LockedSpy)).toBe(false);
      expect(lastSetVisibleArg(slot2DisabledSpy)).toBe(false);
      expect(lastSetVisibleArg(slot2LockedSpy)).toBe(false);
    });
  });

  it("ER-equipped species renders all 3 slot ability names", () => {
    const handler = getHandler();
    const internals = asInternals(handler);
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    // Use a clearly distinguishable triple to verify each slot maps to its
    // assigned ability and the rendering doesn't shuffle order.
    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    withPassives(species, triple, () => {
      internals.lastSpecies = species;
      const slot0TextSpy = vi.spyOn(internals.pokemonPassiveText, "setText");
      const slot1TextSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[0], "setText");
      const slot2TextSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[1], "setText");
      const slot0VisibleSpy = vi.spyOn(internals.pokemonPassiveText, "setVisible");
      const slot1VisibleSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[0], "setVisible");
      const slot2VisibleSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[1], "setVisible");

      // All 3 slots unlocked + enabled — exercises the full-color rendering
      // path on every slot.
      const allUnlockedEnabled =
        PassiveAttr.UNLOCKED_1
        | PassiveAttr.ENABLED_1
        | PassiveAttr.UNLOCKED_2
        | PassiveAttr.ENABLED_2
        | PassiveAttr.UNLOCKED_3
        | PassiveAttr.ENABLED_3;
      internals.renderPassiveSlots(allUnlockedEnabled, 0, false);

      expect(lastSetTextArg(slot0TextSpy)).toBe(allAbilities[AbilityId.OVERGROW].name);
      expect(lastSetTextArg(slot1TextSpy)).toBe(allAbilities[AbilityId.CHLOROPHYLL].name);
      expect(lastSetTextArg(slot2TextSpy)).toBe(allAbilities[AbilityId.LEAF_GUARD].name);

      // All slot texts must be visible (we're not in a fresh-start challenge).
      expect(lastSetVisibleArg(slot0VisibleSpy)).toBe(true);
      expect(lastSetVisibleArg(slot1VisibleSpy)).toBe(true);
      expect(lastSetVisibleArg(slot2VisibleSpy)).toBe(true);
    });
  });

  it("slot 1 LOCKED state shows lock icon (and not stop icon)", () => {
    const handler = getHandler();
    const internals = asInternals(handler);
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    withPassives(species, triple, () => {
      internals.lastSpecies = species;
      const lockedSpy = vi.spyOn(internals.pokemonPassiveLockedIcon, "setVisible");
      const disabledSpy = vi.spyOn(internals.pokemonPassiveDisabledIcon, "setVisible");
      const alphaSpy = vi.spyOn(internals.pokemonPassiveText, "setAlpha");

      // No slots unlocked — everything should be locked.
      internals.renderPassiveSlots(0, 0, false);

      // Slot 1 must show the LOCK icon, not the DISABLE (stop) icon.
      expect(lastSetVisibleArg(lockedSpy)).toBe(true);
      expect(lastSetVisibleArg(disabledSpy)).toBe(false);
      // Text alpha < 1 (gray-out) when locked.
      const alpha = lastSetTextArg(alphaSpy);
      expect(typeof alpha).toBe("number");
      expect(alpha).toBeLessThan(1);
    });
  });

  it("slot 1 UNLOCKED-but-disabled state shows stop icon (and not lock icon)", () => {
    const handler = getHandler();
    const internals = asInternals(handler);
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    withPassives(species, triple, () => {
      internals.lastSpecies = species;
      const lockedSpy = vi.spyOn(internals.pokemonPassiveLockedIcon, "setVisible");
      const disabledSpy = vi.spyOn(internals.pokemonPassiveDisabledIcon, "setVisible");
      const alphaSpy = vi.spyOn(internals.pokemonPassiveText, "setAlpha");

      // Only slot 1 unlocked, but the ENABLED bit is clear.
      internals.renderPassiveSlots(PassiveAttr.UNLOCKED_1, 0, false);

      // STOP icon visible, LOCK icon hidden.
      expect(lastSetVisibleArg(disabledSpy)).toBe(true);
      expect(lastSetVisibleArg(lockedSpy)).toBe(false);
      // Faded text.
      const alpha = lastSetTextArg(alphaSpy);
      expect(typeof alpha).toBe("number");
      expect(alpha).toBeLessThan(1);
    });
  });

  it("slot 1 UNLOCKED-and-enabled state shows neither icon (full-color text)", () => {
    const handler = getHandler();
    const internals = asInternals(handler);
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    withPassives(species, triple, () => {
      internals.lastSpecies = species;
      const lockedSpy = vi.spyOn(internals.pokemonPassiveLockedIcon, "setVisible");
      const disabledSpy = vi.spyOn(internals.pokemonPassiveDisabledIcon, "setVisible");
      const alphaSpy = vi.spyOn(internals.pokemonPassiveText, "setAlpha");

      internals.renderPassiveSlots(PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1, 0, false);

      expect(lastSetVisibleArg(disabledSpy)).toBe(false);
      expect(lastSetVisibleArg(lockedSpy)).toBe(false);
      expect(lastSetTextArg(alphaSpy)).toBe(1);
    });
  });

  it("fresh-start challenge hides all 3 passive slot texts", () => {
    const handler = getHandler();
    const internals = asInternals(handler);
    const species = allSpecies.find(s => s.speciesId === SpeciesId.BULBASAUR);
    expect(species).toBeDefined();
    if (!species) {
      return;
    }

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];

    withPassives(species, triple, () => {
      internals.lastSpecies = species;
      const slot0VisibleSpy = vi.spyOn(internals.pokemonPassiveText, "setVisible");
      const slot1VisibleSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[0], "setVisible");
      const slot2VisibleSpy = vi.spyOn(internals.pokemonPassiveSlotTexts[1], "setVisible");
      const slot0LockSpy = vi.spyOn(internals.pokemonPassiveLockedIcon, "setVisible");
      const slot0DisabledSpy = vi.spyOn(internals.pokemonPassiveDisabledIcon, "setVisible");

      // isFreshStartChallenge = true — all slots must be hidden.
      internals.renderPassiveSlots(0xff, 0, true);

      expect(lastSetVisibleArg(slot0VisibleSpy)).toBe(false);
      expect(lastSetVisibleArg(slot1VisibleSpy)).toBe(false);
      expect(lastSetVisibleArg(slot2VisibleSpy)).toBe(false);
      expect(lastSetVisibleArg(slot0LockSpy)).toBe(false);
      expect(lastSetVisibleArg(slot0DisabledSpy)).toBe(false);
    });
  });
});
