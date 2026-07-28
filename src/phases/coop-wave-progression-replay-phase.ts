/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { Phase } from "#app/phase";
import type { CoopWaveProgressionPresentationV2 } from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { ExpGainsSpeed } from "#enums/exp-gains-speed";
import { ExpNotification } from "#enums/exp-notification";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import i18next from "i18next";

const PROGRESSION_STEP_WATCHDOG_MS = 15_000;

/**
 * Render the authority's retained post-battle EXP/level cues over the guest's parked BattleEndPhase.
 *
 * This phase never derives progression. Every displayed value is copied from the immutable WAVE_ADVANCE
 * carrier, and the complete settled state is still applied atomically after this phase reports completion.
 * A damaged UI subtree is presentation-only: the watchdog skips that cue and releases the ordered DATA
 * boundary instead of turning a missing animation into a co-op softlock.
 */
export class CoopWaveProgressionReplayPhase extends Phase {
  public readonly phaseName = "CoopWaveProgressionReplayPhase";

  private readonly wave: number;
  private readonly events: readonly CoopWaveProgressionPresentationV2[];
  private readonly onComplete: () => void;
  private completed = false;

  constructor(wave: number, events: readonly CoopWaveProgressionPresentationV2[], onComplete: () => void) {
    super();
    this.wave = wave;
    this.events = structuredClone(events);
    this.onComplete = onComplete;
  }

  public override start(): void {
    super.start();
    this.renderAll().catch(error => {
      coopWarn("progression", `GUEST retained presentation batch failed wave=${this.wave}; releasing DATA`, error);
      this.finish();
    });
  }

  private async renderAll(): Promise<void> {
    coopLog("progression", `GUEST retained presentation start wave=${this.wave} events=${this.events.length}`);
    for (const event of this.events) {
      try {
        await this.withWatchdog(event, () => this.render(event));
      } catch (error) {
        coopWarn("progression", `GUEST retained ${event.k} presentation failed; skipping cue`, error);
      }
    }
    this.finish();
  }

  private async withWatchdog(event: CoopWaveProgressionPresentationV2, render: () => Promise<void>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        render(),
        new Promise<void>(resolve => {
          timeout = setTimeout(() => {
            coopWarn(
              "progression",
              `GUEST retained ${event.k} presentation watchdog wave=${this.wave} slot=${event.partySlot}`,
            );
            globalScene.ui.setMode(UiMode.MESSAGE).catch(() => undefined);
            resolve();
          }, PROGRESSION_STEP_WATCHDOG_MS);
        }),
      ]);
    } finally {
      if (timeout != null) {
        clearTimeout(timeout);
      }
    }
  }

  private render(event: CoopWaveProgressionPresentationV2): Promise<void> {
    const pokemon = this.resolvePokemon(event.partySlot, event.pokemonId);
    if (pokemon == null) {
      coopWarn(
        "progression",
        `GUEST retained ${event.k} actor missing wave=${this.wave} slot=${event.partySlot} pokemon=${event.pokemonId}`,
      );
      return Promise.resolve();
    }
    return event.k === "exp" ? this.renderExp(pokemon, event) : this.renderLevelUp(pokemon, event);
  }

  private resolvePokemon(partySlot: number, pokemonId: number): PlayerPokemon | null {
    const party = globalScene.getPlayerParty();
    const exact = party.find(pokemon => pokemon.id === pokemonId);
    if (exact != null) {
      return exact;
    }
    const fallback = party[partySlot];
    return fallback?.id === pokemonId ? fallback : null;
  }

  private renderExp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "exp" }>,
  ): Promise<void> {
    // These are host-stated result values, not a local EXP calculation. The complete wave image that follows
    // repeats and validates them as part of its atomic state application.
    pokemon.level = event.toLevel;
    pokemon.exp = event.toExp;

    if (event.display === "party") {
      return this.renderPartyExp(pokemon, event);
    }

    const fastForward = globalScene.gameMode.isCoop && !globalScene.moveAnimations;
    return new Promise<void>(resolve => {
      globalScene.ui.showText(
        i18next.t("battle:expGain", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          exp: event.expGain,
        }),
        fastForward ? 0 : null,
        () => {
          pokemon
            .updateInfo(fastForward)
            .catch(error => coopWarn("progression", "retained field EXP gauge update failed", error))
            .finally(resolve);
        },
        null,
        true,
      );
    });
  }

  private async renderPartyExp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "exp" }>,
  ): Promise<void> {
    await pokemon.updateInfo(globalScene.expGainsSpeed >= ExpGainsSpeed.SKIP);
    if (globalScene.expParty === ExpNotification.SKIP) {
      return;
    }
    if (globalScene.expParty === ExpNotification.ONLY_LEVEL_UP && event.toLevel === event.fromLevel) {
      return;
    }
    await globalScene.partyExpBar.showPokemonExp(
      pokemon,
      event.expGain,
      globalScene.expParty === ExpNotification.ONLY_LEVEL_UP,
      event.toLevel,
    );
    await globalScene.partyExpBar.hide();
  }

  private async renderLevelUp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "levelUp" }>,
  ): Promise<void> {
    pokemon.level = event.toLevel;
    pokemon.stats = [...event.postStats];
    await pokemon.updateInfo();

    if (globalScene.expParty === ExpNotification.SKIP) {
      return Promise.resolve();
    }
    const promptStats = () =>
      globalScene.ui
        .getMessageHandler()
        .promptLevelUpStats(event.partySlot, [...event.preStats], false, [...event.postStats]);
    if (globalScene.expParty !== ExpNotification.DEFAULT) {
      return promptStats();
    }
    globalScene.playSound("level_up_fanfare");
    return new Promise<void>(resolve => {
      globalScene.ui.showText(
        i18next.t("battle:levelUp", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          level: event.toLevel,
        }),
        null,
        () => {
          promptStats()
            .catch(error => coopWarn("progression", "retained level-up stats prompt failed", error))
            .finally(resolve);
        },
        null,
        true,
      );
    });
  }

  private finish(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    coopLog("progression", `GUEST retained presentation complete wave=${this.wave} events=${this.events.length}`);
    // Restore the parked BattleEndPhase first. The callback retries the exact V2 entry against that real
    // boundary, so DATA can never apply while this cosmetic override is still current.
    this.end();
    this.onComplete();
  }
}
