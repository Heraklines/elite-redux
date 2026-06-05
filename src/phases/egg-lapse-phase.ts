import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { Phase } from "#app/phase";
import { EGG_SEED, Egg, MAX_EGG_COUNT } from "#data/egg";
import { EggHatchData } from "#data/egg-hatch-data";
import { EggSourceType } from "#enums/egg-source-types";
import { GachaType } from "#enums/gacha-types";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { achvs } from "#system/achv";
import { planAutoRestock } from "#system/auto-egg-restock";
import { getVoucherTypeName, type VoucherType } from "#system/voucher";
import i18next from "i18next";

/** Map a gacha machine type to the corresponding {@link EggSourceType} for egg generation. */
function gachaSourceTypeFor(gachaType: GachaType): EggSourceType {
  switch (gachaType) {
    case GachaType.MOVE:
      return EggSourceType.GACHA_MOVE;
    case GachaType.LEGENDARY:
      return EggSourceType.GACHA_LEGENDARY;
    case GachaType.SHINY:
      return EggSourceType.GACHA_SHINY;
  }
  return EggSourceType.GACHA_LEGENDARY;
}

/**
 * Phase that handles updating eggs, and hatching any ready eggs
 * Also handles prompts for skipping animation, and calling the egg summary phase
 */
export class EggLapsePhase extends Phase {
  public readonly phaseName = "EggLapsePhase";
  private eggHatchData: EggHatchData[] = [];
  private readonly minEggsToSkip: number = 2;

  /**
   * Max eggs hatched in a single lapse event. A massive backlog (players have
   * amassed thousands) would otherwise try to hatch all at once and soft-lock
   * the UI / summary. The overflow stays in `gameData.eggs` with `hatchWaves`
   * already < 1, so it is re-collected and hatched 1000-at-a-time on subsequent
   * lapse events until the queue drains.
   */
  private static readonly HATCH_BATCH_CAP = 1000;

  start() {
    super.start();
    const allReadyEggs: Egg[] = globalScene.gameData.eggs.filter((egg: Egg) => {
      return Overrides.EGG_IMMEDIATE_HATCH_OVERRIDE ? true : --egg.hatchWaves < 1;
    });
    // Cap this batch; the rest stay queued (already past their hatch wave) and
    // drain on later lapses. This is what "unclogs the pipe" 1000 at a time.
    const eggsToHatch: Egg[] =
      allReadyEggs.length > EggLapsePhase.HATCH_BATCH_CAP
        ? allReadyEggs.slice(0, EggLapsePhase.HATCH_BATCH_CAP)
        : allReadyEggs;
    const deferredCount = allReadyEggs.length - eggsToHatch.length;
    const eggsToHatchCount: number = eggsToHatch.length;
    this.eggHatchData = [];

    if (deferredCount > 0) {
      globalScene.phaseManager.queueMessage(i18next.t("battle:eggHatchBatchDeferred", { count: deferredCount }));
    }

    if (eggsToHatchCount > 0) {
      if (eggsToHatchCount >= this.minEggsToSkip && globalScene.eggSkipPreference === 1) {
        globalScene.ui.showText(
          i18next.t("battle:eggHatching"),
          0,
          () => {
            // show prompt for skip, blocking inputs for 1 second
            globalScene.ui.showText(
              i18next.t("battle:eggSkipPrompt", {
                eggsToHatch: eggsToHatchCount,
              }),
              0,
            );
            globalScene.ui.setModeWithoutClear(
              UiMode.CONFIRM,
              () => {
                this.hatchEggsSkipped(eggsToHatch);
                this.finishWithSummary();
              },
              () => {
                this.hatchEggsRegular(eggsToHatch);
                this.finishWithoutSummary();
              },
              null,
              null,
              null,
              1000,
              true,
            );
          },
          100,
          true,
        );
      } else if (eggsToHatchCount >= this.minEggsToSkip && globalScene.eggSkipPreference === 2) {
        globalScene.phaseManager.queueMessage(i18next.t("battle:eggHatching"));
        this.hatchEggsSkipped(eggsToHatch);
        this.finishWithSummary();
      } else {
        // regular hatches, no summary
        globalScene.phaseManager.queueMessage(i18next.t("battle:eggHatching"));
        this.hatchEggsRegular(eggsToHatch);
        this.finishWithoutSummary();
      }
    } else {
      this.finishWithoutSummary();
    }
  }

  /** Run auto-restock then end the phase. */
  private finishWithoutSummary(): void {
    this.autoRestockIfEnabled();
    this.end();
  }

  /** Run auto-restock then show the egg summary (which calls end()). */
  private finishWithSummary(): void {
    this.autoRestockIfEnabled();
    this.showSummary();
  }

  /**
   * Spend vouchers to silently top off the egg queue based on the player's
   * persisted {@link AutoEggRestockSettings}. Plays no animation and queues a
   * single summary message at the end.
   */
  private autoRestockIfEnabled(): void {
    const gd = globalScene.gameData;
    const plan = planAutoRestock({
      settings: gd.autoEggRestock,
      eggsHeld: gd.eggs.length,
      voucherCounts: gd.voucherCounts as Record<VoucherType, number>,
      maxEggs: MAX_EGG_COUNT,
    });
    if (plan.purchases.length === 0) {
      return;
    }

    let totalPulls = 0;
    const breakdown: string[] = [];
    for (const purchase of plan.purchases) {
      gd.voucherCounts[purchase.voucherType] -= purchase.vouchers;
      for (let i = 0; i < purchase.pulls; i++) {
        new Egg({
          pulled: true,
          sourceType: gachaSourceTypeFor(gd.autoEggRestock.gachaType),
        });
      }
      totalPulls += purchase.pulls;
      breakdown.push(`${purchase.pulls}× ${getVoucherTypeName(purchase.voucherType)}`);
    }
    globalScene.phaseManager.queueMessage(
      i18next.t("egg:autoRestocked", {
        count: totalPulls,
        breakdown: breakdown.join(", "),
      }),
    );
  }

  /**
   * Hatches eggs normally one by one, showing animations
   * @param eggsToHatch list of eggs to hatch
   */
  hatchEggsRegular(eggsToHatch: Egg[]) {
    let eggsToHatchCount: number = eggsToHatch.length;
    for (const egg of eggsToHatch) {
      globalScene.phaseManager.unshiftNew("EggHatchPhase", this, egg, eggsToHatchCount);
      eggsToHatchCount--;
    }
  }

  /**
   * Hatches eggs with no animations
   * @param eggsToHatch list of eggs to hatch
   */
  hatchEggsSkipped(eggsToHatch: Egg[]) {
    for (const egg of eggsToHatch) {
      this.hatchEggSilently(egg);
    }
  }

  showSummary() {
    globalScene.phaseManager.unshiftNew("EggSummaryPhase", this.eggHatchData);
    this.end();
  }

  /**
   * Hatches an egg and stores it in the local EggHatchData array without animations
   * Also validates the achievements for the hatched pokemon and removes the egg
   * @param egg egg to hatch
   */
  hatchEggSilently(egg: Egg) {
    const eggIndex = globalScene.gameData.eggs.findIndex(e => e.id === egg.id);
    if (eggIndex === -1) {
      return this.end();
    }
    globalScene.gameData.eggs.splice(eggIndex, 1);

    const data = this.generatePokemon(egg);
    const pokemon = data.pokemon;
    if (pokemon.fusionSpecies) {
      pokemon.clearFusionSpecies();
    }

    if (pokemon.species.subLegendary) {
      globalScene.validateAchv(achvs.HATCH_SUB_LEGENDARY);
    }
    if (pokemon.species.legendary) {
      globalScene.validateAchv(achvs.HATCH_LEGENDARY);
    }
    if (pokemon.species.mythical) {
      globalScene.validateAchv(achvs.HATCH_MYTHICAL);
    }
    if (pokemon.isShiny()) {
      globalScene.validateAchv(achvs.HATCH_SHINY);
    }
  }

  /**
   * Generates a Pokemon and creates a new EggHatchData instance for the given egg
   * @param egg the egg to hatch
   * @returns the hatched PlayerPokemon
   */
  generatePokemon(egg: Egg): EggHatchData {
    let ret: PlayerPokemon;
    let newHatchData: EggHatchData;
    globalScene.executeWithSeedOffset(
      () => {
        ret = egg.generatePlayerPokemon();
        newHatchData = new EggHatchData(ret, egg.eggMoveIndex);
        newHatchData.setDex();
        this.eggHatchData.push(newHatchData);
      },
      egg.id,
      EGG_SEED.toString(),
    );
    return newHatchData!;
  }
}
