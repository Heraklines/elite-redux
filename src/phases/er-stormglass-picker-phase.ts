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
import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_BIOME_WAIT_MS } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopStormglassPresentationPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  notifyCoopV2InteractionSurfaceReady,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_STORMGLASS_CHOICE_KINDS, COOP_STORMGLASS_SEQ } from "#data/elite-redux/coop/coop-seq-registry";
import {
  type CoopStormglassOperationBinding,
  captureCoopStormglassOperationBinding,
  commitCoopStormglassDecision,
  commitCoopStormglassPresentation,
  coopStormglassDecisionOperationId,
  coopStormglassPresentationOperationId,
  settleCoopStormglassOperation,
} from "#data/elite-redux/coop/coop-stormglass-operation";
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
/** The line the WATCHER shows while the owning player picks (co-op). Clean text, no em dash. */
const STORMGLASS_WATCH_PROMPT = "The Stormglass hums. Your partner is choosing the weather...";

export class ErStormglassPickerPhase extends Phase {
  public readonly phaseName = "ErStormglassPickerPhase";
  /** Exact V2 presentation address owned by this phase generation. */
  public coopV2ControlOperationId: string | null = null;

  /** Guards against a double input resolving the prompt twice. */
  private resolving = false;
  /** Co-op (#130): this client drives the real picker (host / solo); the guest watches + adopts. */
  private coopOwner = true;
  /** Exact runtime that owns this picker across its async UI/watcher tails. */
  private readonly coopOwningRuntime;
  /** Per-runtime operation state captured before any picker callback/await. */
  private readonly coopOperationBinding: CoopStormglassOperationBinding | null;

  constructor() {
    super();
    this.coopOwningRuntime = getCoopRuntime();
    this.coopOperationBinding = this.coopOwningRuntime == null ? null : captureCoopStormglassOperationBinding();
  }

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
    // Co-op (#130): the chosen weather is run-affecting (hashed into the battle checksum), so an
    // unmirrored per-client prompt diverges the shared run - the systematic #855 class. The HOST OWNS
    // this one-time pick (deterministic, no interaction-counter alternation needed): it drives the real
    // picker and relays the chosen weather INDEX on the fixed COOP_STORMGLASS_SEQ; the GUEST never opens
    // the picker, adopts the relayed index, and heals via the per-turn checkpoint on timeout. Solo /
    // non-coop keeps the plain local picker.
    const controller = globalScene.gameMode.isCoop ? getCoopController() : null;
    if (controller != null) {
      const spoofed = getCoopRuntime()?.spoof != null;
      this.coopOwner = spoofed || controller.role === "host";
      coopLog(
        "reward",
        `stormglass owner/watcher decision: role=${controller.role} spoof=${spoofed} -> ${this.coopOwner ? "OWNER" : "WATCHER"} (#130)`,
      );
      if (!this.coopOwner) {
        void this.coopWatch();
        return;
      }
      this.coopV2ControlOperationId = coopStormglassPresentationOperationId(this.coopOperationBinding);
      const presented = commitCoopStormglassPresentation(
        STORMGLASS_WEATHER_CHOICES.map((choice, weatherIndex) => ({
          weatherIndex,
          weather: choice.weather,
        })),
        {
          localRole: controller.role,
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopOperationBinding,
      );
      if (!presented) {
        failCoopSharedSession("Stormglass presentation could not enter durable authority");
        return;
      }
    }
    this.openPicker();
  }

  /** Bind the authority-authored weather board to this exact phase generation. */
  public installCoopV2StormglassPresentation(
    operationId: string,
    presentation: CoopStormglassPresentationPayload,
  ): boolean {
    const expected = STORMGLASS_WEATHER_CHOICES.map((choice, weatherIndex) => ({
      weatherIndex,
      weather: choice.weather,
    }));
    if (
      operationId.length === 0
      || JSON.stringify(presentation.options) !== JSON.stringify(expected)
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopV2ControlOperationId = operationId;
    return true;
  }

  /** Show the prompt line, then the 5-weather option select. */
  private openPicker(): void {
    globalScene.ui.showText(STORMGLASS_PROMPT, null, () => {
      const options: OptionSelectItem[] = STORMGLASS_WEATHER_CHOICES.map((choice, index) => ({
        label: choice.label,
        handler: () => this.pick(choice.weather, index),
      }));
      Promise.resolve(globalScene.ui.setMode(UiMode.OPTION_SELECT, { options })).then(() =>
        notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime),
      );
    });
  }

  /**
   * Record the chosen weather through the EXISTING setter (persists it on the
   * relic + refreshes the modifier bar), apply it for this battle, then end.
   * In co-op the OWNER relays the chosen INDEX so the watcher adopts the same
   * weather. Returns true so the OPTION_SELECT handler treats the press as handled.
   */
  private pick(weather: WeatherType, index: number): boolean {
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
      // The result entry is authored only after the local picker and weather application are complete.
      if (globalScene.gameMode.isCoop && this.coopOwner) {
        try {
          const relay = getCoopInteractionRelay();
          const operationId =
            this.coopV2ControlOperationId == null
              ? null
              : coopStormglassDecisionOperationId(this.coopV2ControlOperationId);
          if (
            relay == null
            || operationId == null
            || !settleCoopStormglassOperation(operationId, this.coopOperationBinding)
            || !settleCoopV2InteractionOperation(operationId, this.coopOwningRuntime)
            || !commitCoopStormglassDecision(
              relay,
              index,
              weather,
              {
                localRole: "host",
                wave: globalScene.currentBattle?.waveIndex ?? 0,
                turn: globalScene.currentBattle?.turn ?? 0,
              },
              this.coopOperationBinding,
            )
          ) {
            failCoopSharedSession("Stormglass decision could not enter durable authority");
            return;
          }
          coopLog("reward", `stormglass OWNER commit weather=${weather} index=${index} (#130)`);
        } catch {
          failCoopSharedSession("Stormglass decision threw before entering durable authority");
          return;
        }
      }
      this.end();
    });
    return true;
  }

  /**
   * Co-op WATCHER (#130): never open the picker. Await the owner's relayed weather index and adopt the
   * identical weather; on timeout leave it unset (the per-turn checkpoint carries the owner's chosenWeather
   * and heals the divergence), so this can never hang the guest's wave-start queue.
   */
  private async coopWatch(): Promise<void> {
    try {
      globalScene.ui.showText(STORMGLASS_WATCH_PROMPT);
      notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
    } catch {
      /* cosmetic */
    }
    const relay = getCoopInteractionRelay();
    const res =
      relay == null
        ? null
        : await relay.awaitInteractionChoice(COOP_STORMGLASS_SEQ, COOP_BIOME_WAIT_MS, COOP_STORMGLASS_CHOICE_KINDS);
    const choice = STORMGLASS_WEATHER_CHOICES[res?.choice ?? -1];
    if (choice == null) {
      if (isCoopV2InteractionCutoverActive(this.coopOperationBinding?.durability)) {
        failCoopSharedSession("Stormglass watcher did not receive its exact retained decision");
        return;
      }
      coopWarn(
        "reward",
        `stormglass WATCHER: ${res == null ? "TIMEOUT" : "bad index"} -> leave unset, checkpoint heals (#130)`,
      );
    } else {
      if (!isCoopV2InteractionCutoverActive(this.coopOperationBinding?.durability)) {
        setStormglassWeather(choice.weather);
      }
      coopLog("reward", `stormglass WATCHER adopt weather=${choice.weather} index=${res?.choice} (#130)`);
      if (!isCoopV2InteractionCutoverActive(this.coopOperationBinding?.durability)) {
        erStormglassApplyChosenWeather();
      }
    }
    const expectedOperationId =
      this.coopV2ControlOperationId == null ? null : coopStormglassDecisionOperationId(this.coopV2ControlOperationId);
    if (
      isCoopV2InteractionCutoverActive(this.coopOperationBinding?.durability)
      && (expectedOperationId == null || res?.operationId !== expectedOperationId)
    ) {
      failCoopSharedSession("Stormglass watcher received a decision outside its exact V2 presentation address");
      return;
    }
    if (typeof res?.operationId === "string") {
      settleCoopStormglassOperation(res.operationId, this.coopOperationBinding);
      settleCoopV2InteractionOperation(res.operationId, this.coopOwningRuntime);
    }
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
  }
}
