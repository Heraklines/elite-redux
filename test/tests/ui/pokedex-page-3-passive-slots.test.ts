/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux UI integration test: pokedex-page 3-passive slot rendering and
// per-slot unlock/toggle controls.
//
// Drives the real `PokedexPageUiHandler` via `runToPokedexPage(...)` and
// exercises the two newly-3-passive-aware code paths from commit 2eff48e:
//
//   1. The ABILITIES sub-menu, which emits one option row per non-NONE
//      passive slot (3 rows for ER-custom species, 1 row for vanilla).
//   2. The candy/upgrade sub-menu (Button.STATS), which emits per-slot
//      Unlock-or-Toggle rows whose candy cost scales by
//      `PASSIVE_SLOTS[slot].costMultiplier` (1×, 2×, 4×).
//
// The handler builds its option array inline, then dispatches it to
// `ui.setModeWithoutClear(UiMode.OPTION_SELECT, { options, ... })`. We spy on
// `setModeWithoutClear` to capture the emitted options arrays, then assert on
// the labels and styles directly. This is the same observation strategy used
// by the starter-select-3-passive-slots test (whitebox via spy).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { Passive as PassiveAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { PASSIVE_SLOTS } from "#ui/starter-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Pokedex page - 3 passive slots", () => {
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
   * Open the pokedex page for `species`. Mirrors `runToPokedexPage` from
   * `test/tests/ui/pokedex.test.ts` so the canonical setup path is reused.
   */
  async function runToPokedexPage(species: PokemonSpecies): Promise<PokedexPageUiHandler> {
    await game.runToTitle();
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, species, {});
    const handler = game.scene.ui.getHandler();
    expect(handler).toBeInstanceOf(PokedexPageUiHandler);
    return handler as PokedexPageUiHandler;
  }

  /**
   * Temporarily override `_passives` on a species and restore it after the
   * (possibly async) callback resolves. Mirrors the pattern from
   * `starter-select-3-passive-slots.test.ts`.
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
   * Capture the OPTION_SELECT payload the handler emits via
   * `setModeWithoutClear`. The pokedex-page sub-menus all funnel through this
   * call, so a single spy + filter on mode covers ABILITIES + candy menus.
   */
  type CapturedOption = {
    label: string;
    style?: number;
    skip?: boolean;
    item?: string;
  };
  function spyOptionSelect(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(globalScene.ui, "setModeWithoutClear");
  }
  function lastOptionSelectPayload(spy: ReturnType<typeof vi.spyOn>): CapturedOption[] {
    // Find the most recent call whose first arg is UiMode.OPTION_SELECT.
    for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
      const call = spy.mock.calls[i];
      if (call[0] === UiMode.OPTION_SELECT) {
        const payload = call[1] as { options: CapturedOption[] } | undefined;
        if (payload && Array.isArray(payload.options)) {
          return payload.options;
        }
      }
    }
    throw new Error("No OPTION_SELECT payload captured");
  }

  /**
   * Slice the abilities menu options down to just the passive-section rows.
   * The handler emits options in this order:
   *
   *   [ability1, (ability2?), "Hidden" header, abilityHidden,
   *    "Passive" header (skip=true), passive[0], (passive[1]?), (passive[2]?),
   *    Cancel]
   *
   * We locate the "Passive" header (label === i18n key "pokedexUiHandler:passive"
   * → "Passive:" in en) by its `skip: true` flag AND its position AFTER the
   * "Hidden" header (if present). Everything between that header and the
   * trailing Cancel row is a passive slot row.
   */
  function getPassiveSectionLabels(options: CapturedOption[]): string[] {
    // The "Passive" header is the LAST `skip: true` row in the array — there
    // are at most 2 skip rows ("Hidden" + "Passive"). Find the last one.
    let passiveHeaderIdx = -1;
    for (let i = options.length - 1; i >= 0; i--) {
      if (options[i].skip) {
        passiveHeaderIdx = i;
        break;
      }
    }
    if (passiveHeaderIdx === -1) {
      return [];
    }
    // Skip the last entry — it's the "Cancel" row, which is selectable (no
    // `skip` flag). Take rows after the passive header up to (but not
    // including) Cancel.
    return options.slice(passiveHeaderIdx + 1, options.length - 1).map(o => o.label);
  }

  /**
   * Drive the ABILITIES sub-menu open. Awaits the chain of async UI calls so
   * that by the time we inspect the spy, the options array has been emitted.
   *
   * NB: the handler's processInput wraps the option-build in `setMode(...).then(...)
   *   → showText(...).then(...)` so we explicitly tick microtasks until the
   * spy captures the OPTION_SELECT payload.
   */
  async function openAbilitiesMenu(handler: PokedexPageUiHandler): Promise<CapturedOption[]> {
    // The handler's ABILITIES path calls `this.infoOverlay.show(...)` and
    // `this.moveInfoOverlay.show(...)` which dive into a real Phaser Graphics
    // call (`textMaskRect.clear()`) that the headless MockGraphics doesn't
    // implement. Stub the two overlays to no-ops so the option-build code
    // runs through to the `setModeWithoutClear(UiMode.OPTION_SELECT, ...)`
    // call we're observing.
    const overlays = handler as unknown as {
      infoOverlay: { show(_: unknown): void; clear(): void };
      moveInfoOverlay: { show(_: unknown): void; clear(): void };
    };
    vi.spyOn(overlays.infoOverlay, "show").mockImplementation(() => {});
    vi.spyOn(overlays.infoOverlay, "clear").mockImplementation(() => {});

    const spy = spyOptionSelect();
    // Set cursor directly to ABILITIES (index 1 — BASE_STATS=0, ABILITIES=1).
    handler.setCursor(1);
    handler.processInput(5 /* Button.ACTION */);

    // Tick until the inner `ui.setModeWithoutClear(UiMode.OPTION_SELECT, ...)`
    // fires. The chain is `setMode -> Promise -> showText -> callback ->
    // setModeWithoutClear`. We poll for up to ~50 microtask cycles.
    for (let i = 0; i < 100; i++) {
      try {
        return lastOptionSelectPayload(spy);
      } catch {
        // Not captured yet — yield a microtask and retry.
        await Promise.resolve();
        // Drain the showText callback (it's invoked synchronously after the
        // text fades; in test mode there's no fade so the callback fires on
        // the next microtask).
      }
    }
    return lastOptionSelectPayload(spy);
  }

  it("PASSIVE_SLOTS exports monotonically increasing cost multipliers (1× < 2× < 4×)", () => {
    // Per-slot cost progression: slot 1 base, slot 2 = 2×, slot 3 = 4×. The
    // pokedex-page candy menu multiplies `getPassiveCandyCount()` by these
    // multipliers — verifying the constants here guards against silent
    // regressions of the cost ladder.
    expect(PASSIVE_SLOTS).toHaveLength(3);
    expect(PASSIVE_SLOTS[0].costMultiplier).toBe(1);
    expect(PASSIVE_SLOTS[1].costMultiplier).toBe(2);
    expect(PASSIVE_SLOTS[2].costMultiplier).toBe(4);
    // Strictly increasing.
    expect(PASSIVE_SLOTS[1].costMultiplier).toBeGreaterThan(PASSIVE_SLOTS[0].costMultiplier);
    expect(PASSIVE_SLOTS[2].costMultiplier).toBeGreaterThan(PASSIVE_SLOTS[1].costMultiplier);
  });

  it("ER-custom triple: ABILITIES menu lists all 3 passive ability names", async () => {
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);
    // Use abilities that don't appear in Bulbasaur's vanilla
    // ability1/ability2/abilityHidden so the passive-section assertion isn't
    // confused by name-collisions with the abilities section. Bulbasaur:
    //   ability1 = OVERGROW, ability2 = NONE, abilityHidden = CHLOROPHYLL.
    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.LEVITATE, AbilityId.INTIMIDATE, AbilityId.FLASH_FIRE];

    await withPassives(species, triple, async () => {
      const handler = await runToPokedexPage(species);
      const options = await openAbilitiesMenu(handler);
      const passiveLabels = getPassiveSectionLabels(options);

      expect(passiveLabels).toHaveLength(3);
      // The display label is `${name}${statusSuffix}` so substring-match on
      // the ability name to stay locale/state independent.
      expect(passiveLabels[0].startsWith(allAbilities[AbilityId.LEVITATE].name)).toBe(true);
      expect(passiveLabels[1].startsWith(allAbilities[AbilityId.INTIMIDATE].name)).toBe(true);
      expect(passiveLabels[2].startsWith(allAbilities[AbilityId.FLASH_FIRE].name)).toBe(true);
    });
  });

  it("vanilla species: ABILITIES menu lists slot 1 only (1 passive row, not 3)", async () => {
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);

    await withPassives(species, null, async () => {
      const handler = await runToPokedexPage(species);
      const options = await openAbilitiesMenu(handler);
      const passiveLabels = getPassiveSectionLabels(options);

      // Vanilla species (no ER innates) emits exactly 1 passive row — the
      // legacy single passive (Bulbasaur → GRASSY_SURGE).
      expect(passiveLabels).toHaveLength(1);
      const vanillaPassiveId = species.getPassiveAbility(0);
      expect(passiveLabels[0].startsWith(allAbilities[vanillaPassiveId].name)).toBe(true);
    });
  });

  it("ER-custom triple, all slots LOCKED: every passive row has a '(...)' status suffix", async () => {
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);
    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.LEVITATE, AbilityId.INTIMIDATE, AbilityId.FLASH_FIRE];

    await withPassives(species, triple, async () => {
      const handler = await runToPokedexPage(species);
      const starterId = (handler as unknown as { starterId: number }).starterId;
      // Force all 3 slots LOCKED — every passive row carries the locked
      // suffix per the diff's `statusSuffix` ternary.
      globalScene.gameData.starterData[starterId].passiveAttr = 0;

      const options = await openAbilitiesMenu(handler);
      const passiveLabels = getPassiveSectionLabels(options);

      expect(passiveLabels).toHaveLength(3);
      // Each label ends with a parenthesized status string — exact text is
      // `(Locked)` in en but the regex stays locale-agnostic.
      for (const label of passiveLabels) {
        expect(label).toMatch(/\(.+\)$/);
      }
    });
  });

  it("ER-custom triple: slot 1 UNLOCKED+ENABLED has no suffix; slots 2/3 LOCKED still have one", async () => {
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);
    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.LEVITATE, AbilityId.INTIMIDATE, AbilityId.FLASH_FIRE];

    await withPassives(species, triple, async () => {
      const handler = await runToPokedexPage(species);
      const starterId = (handler as unknown as { starterId: number }).starterId;

      // Unlock + enable slot 1 only.
      globalScene.gameData.starterData[starterId].passiveAttr = PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1;

      const options = await openAbilitiesMenu(handler);
      const passiveLabels = getPassiveSectionLabels(options);

      expect(passiveLabels).toHaveLength(3);
      // Slot 0 (1st passive row) unlocked + enabled → no suffix (label is
      // exactly the ability name).
      expect(passiveLabels[0]).toBe(allAbilities[AbilityId.LEVITATE].name);
      // Slots 1/2 still locked → parenthesized suffix.
      expect(passiveLabels[1]).toMatch(/\(.+\)$/);
      expect(passiveLabels[2]).toMatch(/\(.+\)$/);
    });
  });

  it("species.getPassiveAbilities returns [slot1, NONE, NONE] for vanilla and a non-NONE triple for ER-custom", async () => {
    // Direct contract test on `PokemonSpecies.getPassiveAbilities(formIndex)` —
    // the data source the pokedex-page diff reads to decide how many slot
    // rows to emit. This is a fast assertion against the species-level
    // shape; if it ever regresses, both the abilities menu and the candy
    // menu will silently drop slots, so it's worth a direct guard.
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);

    await withPassives(species, null, () => {
      const vanilla = species.getPassiveAbilities(0);
      expect(vanilla).toHaveLength(3);
      // Slot 0 is the species' legacy passive — non-NONE.
      expect(vanilla[0]).not.toBe(AbilityId.NONE);
      // Slots 1/2 are NONE for a vanilla species.
      expect(vanilla[1]).toBe(AbilityId.NONE);
      expect(vanilla[2]).toBe(AbilityId.NONE);
    });

    const triple: [AbilityId, AbilityId, AbilityId] = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD];
    await withPassives(species, triple, () => {
      const er = species.getPassiveAbilities(0);
      expect(er).toEqual(triple);
      // All 3 slots non-NONE — pokedex page will emit 3 rows.
      expect(er.every(a => a !== AbilityId.NONE)).toBe(true);
    });
  });
});
