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
import type { ModifierType } from "#modifiers/modifier-type";
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

    // labels/descs for the dedicated bargain screen: the chosen Sins + a Leave row.
    const labels = [...sins.map(k => i18next.t(`${ns}:sins.${k}.name`)), i18next.t(`${ns}:option.leave.label`)];
    const descs = [...sins.map(k => i18next.t(`${ns}:sins.${k}.tooltip`)), ""];
    // The handler's dialogue box fits a short line; use the first two sentences of
    // the intro (the full ominous monologue still plays elsewhere as needed).
    const greeting = i18next.t(`${ns}:introDialogue`).split("$").slice(0, 2).join(" ");

    globalScene.ui.setMode(UiMode.ER_BARGAIN, labels, descs, greeting, (index: number) => this.onChoice(sins, index));
  }

  /** Resolve the player's choice from the bargain screen. */
  private async onChoice(sins: BargainSinKey[], index: number): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    this.trace(`onChoice index=${index}`);
    // Hand the UI back to MESSAGE (this tears down the bargain screen) before any
    // dialogue / party-select / reward flow.
    await globalScene.ui.setMode(UiMode.MESSAGE);
    this.trace("onChoice: MESSAGE mode set");

    // Leave: CANCEL (index < 0) or the Leave row (index === sins.length).
    if (index < 0 || index >= sins.length) {
      await this.giratina(`${ns}:option.leave.line1`);
      await this.narrate(`${ns}:option.leave.line2`);
      await this.giratina(`${ns}:option.leave.line3`);
      this.end();
      return;
    }

    await this.applySin(sins[index]);
    this.end();
  }

  /** Run one Sin's offer line, party pick(s), cost+payoff, then the result line. */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a 7-Sin dispatch switch; each case is a small self-contained deal, clearer kept inline than split across seven helpers
  private async applySin(key: BargainSinKey): Promise<void> {
    this.trace(`applySin ${key}: show offer`);
    await this.giratina(`${ns}:sins.${key}.offer`);
    this.trace(`applySin ${key}: offer dismissed`);
    let pokeName = "";

    switch (key) {
      case "greed": {
        const mon = await this.pickPokemon();
        if (mon) {
          bargainWipeCandy(mon);
          const wave = globalScene.currentBattle?.waveIndex ?? 1;
          globalScene.addMoney(2000 + wave * 300);
          globalScene.addModifier(modifierTypes.ER_GREATER_GOLDEN_BALL().newModifier(), false, true);
          pokeName = mon.getNameToRender();
        }
        break;
      }
      case "gluttony": {
        const mon = await this.pickPokemon();
        if (mon) {
          pokeName = mon.getNameToRender();
          globalScene.removePokemonFromPlayerParty(mon, true);
          new Egg({ sourceType: EggSourceType.EVENT, tier: EggTier.LEGENDARY }).addEggToGameData();
        }
        break;
      }
      case "pride": {
        const mon = await this.pickPokemon(p => (p.isShiny() ? null : "This Pokémon does not shine."));
        if (mon) {
          pokeName = mon.getNameToRender();
          const stat = await this.pickStat();
          bargainDullShine(mon);
          await mon.loadAssets();
          bargainGrantStatBoost(mon, stat ?? Stat.ATK, 3);
        }
        break;
      }
      case "wrath": {
        const victim = await this.pickPokemon();
        if (victim) {
          pokeName = victim.getNameToRender();
          bargainCurseRandomStat(victim);
          const beneficiary = await this.pickPokemon(p => (p === victim ? "Choose a different Pokémon." : null));
          if (beneficiary) {
            bargainGrantStatBoost(beneficiary, bargainBestCombatStat(beneficiary), 2);
          }
        }
        break;
      }
      case "envy": {
        const mon = await this.pickPokemon(p =>
          bargainHeldCount(p) >= 3 ? null : "This Pokémon isn't carrying enough.",
        );
        if (mon) {
          pokeName = mon.getNameToRender();
          for (const item of mon.getHeldItems().filter(m => !(m instanceof PokemonFormChangeItemModifier))) {
            globalScene.removeModifier(item);
          }
          globalScene.updateModifiers(true);
          const relic = await this.pickRelic();
          const made = (relic ?? BARGAIN_RELIC_CHOICES[0].make)().newModifier();
          if (made) {
            globalScene.addModifier(made, false, true);
          }
        }
        break;
      }
      case "sloth": {
        const a = await this.pickPokemon();
        const b = a ? await this.pickPokemon(p => (p === a ? "Choose a different Pokémon." : null)) : null;
        if (a && b) {
          for (const mon of [a, b]) {
            bargainResetToLevelOne(mon);
            bargainWipeCandy(mon);
          }
          globalScene.addModifier(modifierTypes.ER_RELIC_COVENANT().newModifier(), false, true);
        }
        break;
      }
      case "lust": {
        // Disabled (see DISABLED_BARGAIN_SINS); never offered. Kept for completeness.
        const target = await this.pickPokemon();
        if (target) {
          pokeName = target.getNameToRender();
          for (const mon of globalScene.getPlayerParty()) {
            bargainCurseRandomStat(mon);
          }
          applyErBlackShinyKit(target);
          target.shiny = true;
          target.variant = 2;
          await target.loadAssets();
          target.updateInfo(true);
        }
        break;
      }
    }

    globalScene.currentBattle.mysteryEncounter?.setDialogueToken("pokeName", pokeName);
    this.trace(`applySin ${key}: show result`);
    await this.narrate(`${ns}:sins.${key}.result`, { pokeName });
    this.trace(`applySin ${key}: result dismissed`);
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
      this.trace("pickPokemon: open PARTY");
      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.SELECT,
        -1,
        async (slotIndex: number) => {
          this.trace(`pickPokemon: slot=${slotIndex}`);
          await globalScene.ui.setMode(exitMode);
          const party = globalScene.getPlayerParty();
          resolve(slotIndex >= 0 && slotIndex < party.length ? party[slotIndex] : null);
        },
        filter,
      );
    });
  }

  // biome-ignore lint/suspicious/noConsole: temporary #550 softlock breadcrumb (removed once verified)
  private trace(step: string): void {
    console.log(`[bargain] ${step}`);
  }

  private pickStat(): Promise<Stat | null> {
    return this.subMenu(BARGAIN_STAT_CHOICES.map(c => ({ label: c.label, value: c.stat })));
  }

  private pickRelic(): Promise<(() => ModifierType) | null> {
    return this.subMenu(BARGAIN_RELIC_CHOICES.map(c => ({ label: c.label, value: c.make })));
  }

  /** A simple labelled choice menu; resolves to the chosen value or null on cancel. */
  private subMenu<T>(choices: { label: string; value: T }[]): Promise<T | null> {
    return new Promise(resolve => {
      const options = choices.map(c => ({
        label: c.label,
        handler: () => {
          resolve(c.value);
          return true;
        },
      }));
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => {
          resolve(null);
          return true;
        },
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
