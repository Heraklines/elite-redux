/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * ER Dex Nav (#392, community batch): queued when the Dex Nav consumable is
 * picked up. Lists the current biome's wild encounter pool and lets the player
 * register ("catch") {@linkcode ErDexNavPhase.PICK_COUNT} species in the
 * Pokedex, as if caught at the current wave's level - dex entry, starter
 * unlock and all.
 */
export class ErDexNavPhase extends Phase {
  public readonly phaseName = "ErDexNavPhase";

  /** How many species one Dex Nav registers. */
  public static readonly PICK_COUNT = 2;

  private picksLeft = ErDexNavPhase.PICK_COUNT;

  /**
   * Co-op (wiring audit): true ONLY on the reward WATCHER. The Dex Nav is the item USER's (the reward
   * OWNER's) per-account dex write; the watcher applies the same consumable only to keep the shop in
   * lockstep, so it must NOT open the species picker. Threaded from {@linkcode ErDexNavModifier.apply}.
   */
  private readonly coopIsWatcher: boolean;

  constructor(coopIsWatcher = false) {
    super();
    this.coopIsWatcher = coopIsWatcher;
  }

  start(): void {
    super.start();
    // Co-op (wiring audit): the picker is a PER-ACCOUNT dex write owned by the item USER (the reward
    // owner). On the WATCHER, opening it would show an unexpected, drivable screen and grant the watcher
    // free dex entries from the owner's item. The dex is not run-checksummed, so no relay/adopt is
    // needed - the watcher simply skips. Byte-identical off the watcher (solo / owner / lockstep).
    if (this.coopIsWatcher) {
      this.end();
      return;
    }
    this.promptPick();
  }

  private promptPick(): void {
    const pool = globalScene.arena.getErDexNavSpeciesPool();
    if (this.picksLeft <= 0 || pool.length === 0) {
      this.end();
      return;
    }
    const options: OptionSelectItem[] = pool
      .map(id => getPokemonSpecies(id))
      .sort((a, b) => a.getName().localeCompare(b.getName()))
      .map(species => ({
        label: species.getName(),
        handler: () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          this.registerCatch(species.speciesId);
          return true;
        },
      }));
    globalScene.ui.showText(
      `The Dex Nav scanned the area! Choose a Pokemon to register (${this.picksLeft} left).`,
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options,
          maxOptions: 8,
          delay: 500,
        });
      },
    );
  }

  private registerCatch(speciesId: number): void {
    this.picksLeft--;
    const species = getPokemonSpecies(speciesId);
    // Match the wild encounter the player would have met here: the species at
    // the current wave's standard enemy level.
    const level = globalScene.currentBattle?.enemyLevels?.[0] ?? Math.max(globalScene.currentBattle?.waveIndex ?? 5, 5);
    const tempPokemon = globalScene.addPlayerPokemon(species, level, undefined, undefined, undefined, false);
    globalScene.gameData
      .setPokemonCaught(tempPokemon, true, false, true)
      .then(() => {
        tempPokemon.destroy();
        this.promptPick();
      })
      .catch(err => {
        console.error("[ER] Dex Nav registration failed:", err);
        tempPokemon.destroy();
        this.promptPick();
      });
  }

  end(): void {
    globalScene.ui.setMode(UiMode.MESSAGE);
    super.end();
  }
}
