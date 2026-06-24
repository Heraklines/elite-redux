/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "The Bargain" - Giratina's deal. A dialogue EVENT that fills the
// Abyss's every-10-waves shop slot (the Abyss has no market - this is its
// "shop"). Pushed from VictoryPhase on x0 waves when the biome is the Abyss.
//
// The presentation is the dedicated full-screen ErBargainUiHandler (UiMode.
// ER_BARGAIN): a dark void backdrop, Giratina Origin's portrait, his line, and
// the bargain list. This phase owns the deal LOGIC: it opens that screen, then on
// a pick runs the chosen Sin's cost/payoff (party pick -> apply -> result). All
// deal logic is save-safe (party never exceeds 6; no new serialized save state).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { Egg } from "#data/egg";
import {
  BARGAIN_RELIC_CHOICES,
  BARGAIN_SIN_ORDER,
  BARGAIN_STAT_CHOICES,
  type BargainSinKey,
  bargainBestCombatStat,
  bargainCurseRandomStat,
  bargainDullShine,
  bargainGrantStatBoost,
  bargainHeldCount,
  bargainResetToLevelOne,
  bargainSinAvailable,
  bargainWipeCandy,
  DISABLED_BARGAIN_SINS,
  pickBargainSins,
} from "#data/elite-redux/er-bargain-sins";
import { applyErBlackShinyKit } from "#data/elite-redux/er-black-shinies";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { achvs } from "#system/achv";
import { PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

const ns = "mysteryEncounters/theBargain";

export class TheBargainPhase extends Phase {
  public readonly phaseName = "TheBargainPhase";

  /** Guards against a double input resolving the event twice. */
  private resolving = false;

  start(): void {
    super.start();
    this.run();
  }

  private run(): void {
    const available = BARGAIN_SIN_ORDER.filter(k => !DISABLED_BARGAIN_SINS.has(k) && bargainSinAvailable(k));
    const sins = pickBargainSins(available, Math.min(3, available.length));
    if (sins.length === 0) {
      this.end();
      return;
    }
    this.openScreen(sins);
  }

  /** (Re)open the dedicated bargain screen for these Sins (also used to return from Check Team). */
  private openScreen(sins: BargainSinKey[]): void {
    // labels/descs for the dedicated bargain screen: the chosen Sins + a Leave row.
    const labels = [...sins.map(k => i18next.t(`${ns}:sins.${k}.name`)), i18next.t(`${ns}:option.leave.label`)];
    const descs = [...sins.map(k => i18next.t(`${ns}:sins.${k}.tooltip`)), i18next.t(`${ns}:option.leave.tooltip`)];
    // Giratina's offer line per Sin - the handler plays it on this screen (bg +
    // portrait stay) before handing off to the party menu on confirm.
    const offers = sins.map(k => i18next.t(`${ns}:sins.${k}.offer`));
    // The handler's dialogue box fits a short line; use the first two sentences of
    // the intro (the full ominous monologue still plays elsewhere as needed).
    const greeting = i18next.t(`${ns}:introDialogue`).split("$").slice(0, 2).join(" ");

    globalScene.ui.setMode(
      UiMode.ER_BARGAIN,
      labels,
      descs,
      greeting,
      offers,
      (sinIndex: number) => this.beginSin(sins, sins[sinIndex]),
      () => this.leave(),
      () => this.checkTeam(sins),
    );
  }

  /** View the party read-only (the Check Team button), then re-open the bargain screen. */
  private checkTeam(sins: BargainSinKey[]): void {
    globalScene.ui.setMode(UiMode.PARTY, PartyUiMode.CHECK, -1, () => {
      this.openScreen(sins);
    });
  }

  /**
   * A Sin's offer was acknowledged on the bargain screen: run the deal. If the
   * player backs out of the FIRST party pick (nothing applied yet), return to the
   * bargain choices instead of ending the event.
   */
  private async beginSin(sins: BargainSinKey[], key: BargainSinKey): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    // The offer already played on the bargain screen; hand off to MESSAGE (tears
    // down the bargain screen) for the party pick(s) + result.
    await globalScene.ui.setMode(UiMode.MESSAGE);
    const committed = await this.applySin(key);
    if (committed) {
      // The player accepted (and the deal was applied) one of Giratina's bargains.
      globalScene.validateAchv(achvs.DEVILS_BARGAIN);
      this.end();
      return;
    }
    // Backed out before any effect - reopen the choices so the player can pick again.
    this.resolving = false;
    this.openScreen(sins);
  }

  /** Leave the bargain (the Leave row, or CANCEL on the choices). */
  private async leave(): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    await globalScene.ui.setMode(UiMode.MESSAGE);
    await this.giratina(`${ns}:option.leave.line1`);
    await this.narrate(`${ns}:option.leave.line2`);
    await this.giratina(`${ns}:option.leave.line3`);
    this.end();
  }

  /**
   * Run one Sin's party pick(s), cost+payoff, then the result line. The offer line
   * is shown earlier on the bargain screen. Returns false if the player backed out
   * of the first pick before anything was applied (so the caller can reopen the
   * choices); true once the deal has gone through.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a 7-Sin dispatch switch; each case is a small self-contained deal, clearer kept inline than split across seven helpers
  private async applySin(key: BargainSinKey): Promise<boolean> {
    let pokeName = "";

    switch (key) {
      case "greed": {
        const mon = await this.pickPokemon();
        if (!mon) {
          return false;
        }
        bargainWipeCandy(mon);
        const wave = globalScene.currentBattle?.waveIndex ?? 1;
        globalScene.addMoney(2000 + wave * 300);
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.ER_GREATER_GOLDEN_BALL);
        pokeName = mon.getNameToRender();
        break;
      }
      case "gluttony": {
        const mon = await this.pickPokemon();
        if (!mon) {
          return false;
        }
        pokeName = mon.getNameToRender();
        globalScene.removePokemonFromPlayerParty(mon, true);
        new Egg({ sourceType: EggSourceType.EVENT, tier: EggTier.LEGENDARY }).addEggToGameData();
        break;
      }
      case "pride": {
        const mon = await this.pickPokemon(p => (p.isShiny() ? null : "This Pokémon does not shine."));
        if (!mon) {
          return false;
        }
        pokeName = mon.getNameToRender();
        const stat = await this.pickStat();
        bargainDullShine(mon);
        await mon.loadAssets();
        bargainGrantStatBoost(mon, stat ?? Stat.ATK, 3);
        break;
      }
      case "wrath": {
        const victim = await this.pickPokemon();
        if (!victim) {
          return false;
        }
        pokeName = victim.getNameToRender();
        bargainCurseRandomStat(victim);
        const beneficiary = await this.pickPokemon(p => (p === victim ? "Choose a different Pokémon." : null));
        if (beneficiary) {
          bargainGrantStatBoost(beneficiary, bargainBestCombatStat(beneficiary), 2);
        }
        break;
      }
      case "envy": {
        const mon = await this.pickPokemon(p =>
          bargainHeldCount(p) >= 3 ? null : "This Pokémon isn't carrying enough.",
        );
        if (!mon) {
          return false;
        }
        pokeName = mon.getNameToRender();
        for (const item of mon.getHeldItems().filter(m => !(m instanceof PokemonFormChangeItemModifier))) {
          globalScene.removeModifier(item);
        }
        globalScene.updateModifiers(true);
        // Offer the relic on the native reward-select screen (icons + on-focus
        // descriptions, pick one), restricted to the bargain relics - no bespoke
        // menu and no softlock.
        globalScene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, {
          guaranteedModifierTypeFuncs: BARGAIN_RELIC_CHOICES.map(c => c.make),
          fillRemaining: false,
        });
        break;
      }
      case "sloth": {
        const a = await this.pickPokemon();
        if (!a) {
          return false;
        }
        const b = await this.pickPokemon(p => (p === a ? "Choose a different Pokémon." : null));
        if (!b) {
          return false;
        }
        for (const mon of [a, b]) {
          bargainResetToLevelOne(mon);
          bargainWipeCandy(mon);
        }
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.ER_RELIC_COVENANT);
        break;
      }
      case "lust": {
        // Disabled (see DISABLED_BARGAIN_SINS); never offered. Kept for completeness.
        const target = await this.pickPokemon();
        if (!target) {
          return false;
        }
        pokeName = target.getNameToRender();
        for (const mon of globalScene.getPlayerParty()) {
          bargainCurseRandomStat(mon);
        }
        applyErBlackShinyKit(target);
        target.shiny = true;
        target.variant = 2;
        await target.loadAssets();
        target.updateInfo(true);
        break;
      }
    }

    globalScene.currentBattle.mysteryEncounter?.setDialogueToken("pokeName", pokeName);
    await this.narrate(`${ns}:sins.${key}.result`, { pokeName });
    return true;
  }

  // --- UI helpers ---

  /**
   * Open the party menu; resolves to the chosen mon, or null if backed out.
   * Mirrors the ME framework's selectPokemonForOption: capture the mode to return
   * to, AWAIT the restore inside the callback before resolving (a non-awaited
   * restore raced the next setMode and softlocked the deal flow, #550).
   */
  private pickPokemon(filter?: (p: PlayerPokemon) => string | null): Promise<PlayerPokemon | null> {
    return new Promise(resolve => {
      const exitMode = globalScene.ui.getMode();
      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.SELECT,
        -1,
        async (slotIndex: number) => {
          await globalScene.ui.setMode(exitMode);
          const party = globalScene.getPlayerParty();
          resolve(slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null);
        },
        filter,
      );
    });
  }

  private pickStat(): Promise<Stat | null> {
    return this.subMenu(BARGAIN_STAT_CHOICES.map(c => ({ label: c.label, value: c.stat })));
  }

  /** A simple labelled choice menu; resolves to the chosen value or null on cancel. */
  private subMenu<T>(choices: { label: string; value: T }[]): Promise<T | null> {
    return new Promise(resolve => {
      const exitMode = globalScene.ui.getMode();
      // Tear the option menu back down to the prior mode BEFORE resolving - a non-
      // awaited restore lets the result/dialogue that follows race the dead
      // OPTION_SELECT and softlock (same class as the party-select fix).
      const restore = (value: T | null): boolean => {
        globalScene.ui.setMode(exitMode).then(() => resolve(value));
        return true;
      };
      const options = choices.map(c => ({
        label: c.label,
        handler: () => restore(c.value),
      }));
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => restore(null),
      });
      globalScene.ui.setMode(UiMode.OPTION_SELECT, { options });
    });
  }

  private giratina(textKey: string): Promise<void> {
    return new Promise(resolve => {
      globalScene.ui.showDialogue(i18next.t(textKey), i18next.t(`${ns}:speaker`), null, () => resolve());
    });
  }

  private narrate(textKey: string, tokens?: Record<string, string>): Promise<void> {
    return new Promise(resolve => {
      globalScene.ui.showText(i18next.t(textKey, tokens ?? {}), null, () => resolve(), null, true);
    });
  }
}
