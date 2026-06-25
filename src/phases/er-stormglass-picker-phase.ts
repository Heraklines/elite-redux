/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER relic #130 - Stormglass weather PICKER. A one-time, path-independent prompt
// that lets the player CHOOSE which weather the Stormglass relic conjures (its
// description promises "a weather of your choice for 5 turns"). Previously the
// relic silently auto-assigned a seeded default; this phase replaces that with a
// real choice the first time it matters.
//
// Enqueued from EncounterPhase at battle start when the relic is held but no
// weather has been chosen yet (getStormglassWeather() == null). Because it fires
// at that single chokepoint - NOT at each grant site - it is path-independent:
// it works no matter how the relic was granted (ME reward pool, Bargain Envy,
// etc.). Once a weather is recorded it never prompts again (the choice persists
// on the relic instance via setStormglassWeather and round-trips through the
// save). Showing it BEFORE the chosen weather is applied means the pick takes
// effect that same battle.
//
// RNG note: this REPLACES the old seeded randBattleSeedInt default, so the run's
// route/battle RNG draw is simply gone - the player's choice is now the source
// of truth and runs stay in sync.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  erStormglassApplyChosenWeather,
  getStormglassWeather,
  STORMGLASS_WEATHER_CHOICES,
  setStormglassWeather,
} from "#data/elite-redux/er-relics";
import { UiMode } from "#enums/ui-mode";
import type { WeatherType } from "#enums/weather-type";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";

/** The short line shown above the weather list. Clean text, no em dash. */
const STORMGLASS_PROMPT = "The Stormglass hums. Choose the weather it conjures for 5 turns.";

export class ErStormglassPickerPhase extends Phase {
  public readonly phaseName = "ErStormglassPickerPhase";

  /** Guards against a double input resolving the prompt twice. */
  private resolving = false;

  start(): void {
    super.start();
    // Defensive: only prompt when the relic is held AND nothing has been chosen
    // yet (the EncounterPhase gate already checks this, but a queued phase could
    // outlive a state change). If a weather is already set, just apply + end so
    // the relic still works this battle.
    if (getStormglassWeather() != null) {
      erStormglassApplyChosenWeather();
      this.end();
      return;
    }
    this.openPicker();
  }

  /** Show the prompt line, then the 5-weather option select. */
  private openPicker(): void {
    globalScene.ui.showText(STORMGLASS_PROMPT, null, () => {
      const options: OptionSelectItem[] = STORMGLASS_WEATHER_CHOICES.map(choice => ({
        label: choice.label,
        handler: () => this.pick(choice.weather),
      }));
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options });
    });
  }

  /**
   * Record the chosen weather through the EXISTING setter (persists it on the
   * relic + refreshes the modifier bar), apply it for this battle, then end.
   * Returns true so the OPTION_SELECT handler treats the press as handled.
   */
  private pick(weather: WeatherType): boolean {
    if (this.resolving) {
      return true;
    }
    this.resolving = true;
    setStormglassWeather(weather);
    // Tear the option menu back down to MESSAGE before applying + ending so the
    // following encounter flow doesn't race the dead OPTION_SELECT (the bargain
    // sub-menu softlock class). The chosen weather wins over the biome ambient.
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      erStormglassApplyChosenWeather();
      this.end();
    });
    return true;
  }
}
