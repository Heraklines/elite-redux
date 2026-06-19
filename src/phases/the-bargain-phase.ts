/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "The Bargain" - Giratina's deal, a DIALOGUE EVENT that fills the
// Abyss's every-10-waves shop slot (the Abyss has no market - this is its
// "shop"). Pushed from VictoryPhase on x0 waves when the biome is the Abyss.
//
// It is NOT a mystery encounter (it runs post-victory like the biome shop) and it
// is NOT a grid shop - it is a talking event: Giratina's portrait + dialogue, then
// a menu of 3 random Sins (of 6 active) + Leave. Each Sin is a run-scoped
// cost->payoff (see er-bargain-sins). All deal logic is save-safe; the party never
// exceeds 6 and no new serialized save state is added.
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
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import i18next from "i18next";

const ns = "mysteryEncounters/theBargain";

export class TheBargainPhase extends Phase {
  public readonly phaseName = "TheBargainPhase";

  /** The Giratina portrait overlay, torn down when the event ends. */
  private portrait: Phaser.GameObjects.Sprite | undefined;
  /** Guards against a double input resolving the event twice. */
  private resolving = false;

  start(): void {
    super.start();
    void this.run();
  }

  private async run(): Promise<void> {
    const available = BARGAIN_SIN_ORDER.filter(k => !DISABLED_BARGAIN_SINS.has(k) && bargainSinAvailable(k));
    // Always >= 3 with a party of 2+ (greed/gluttony/wrath/sloth). If somehow not,
    // just show however many are offerable; never error.
    const sins = pickBargainSins(available, Math.min(3, available.length));
    if (sins.length === 0) {
      this.end();
      return;
    }

    this.showPortrait();
    await this.narrate(`${ns}:intro`);
    await this.giratina(`${ns}:introDialogue`);
    await this.showMenu(sins);
  }

  /** Add Giratina's portrait as a fixed overlay (top-left, above the dialogue box). */
  private showPortrait(): void {
    if (this.portrait) {
      return;
    }
    const sprite = globalScene.add.sprite(28, 22, "er_bargain_giratina");
    sprite.setOrigin(0, 0).setScale(0.55).setScrollFactor(0).setDepth(1000);
    globalScene.fieldUI.add(sprite);
    this.portrait = sprite;
  }

  private clearPortrait(): void {
    this.portrait?.destroy();
    this.portrait = undefined;
  }

  /** Present the 3 chosen Sins + Leave. */
  private showMenu(sins: BargainSinKey[]): Promise<void> {
    return new Promise(resolve => {
      const options: OptionSelectItem[] = sins.map(key => ({
        label: i18next.t(`${ns}:sins.${key}.name`),
        handler: () => {
          void this.resolveSin(key).then(resolve);
          return true;
        },
        onHover: () => {
          globalScene.ui.showText(i18next.t(`${ns}:sins.${key}.tooltip`), 0, undefined, 0);
        },
      }));
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => {
          void this.leave().then(resolve);
          return true;
        },
      });
      globalScene.ui.showText(i18next.t(`${ns}:query`), null, () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, supportHover: true });
      });
    });
  }

  /** Walk away: Giratina's parting lines, then end. */
  private async leave(): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    await globalScene.ui.setMode(UiMode.MESSAGE);
    await this.giratina(`${ns}:option.leave.line1`);
    await this.narrate(`${ns}:option.leave.line2`);
    await this.giratina(`${ns}:option.leave.line3`);
    this.finish();
  }

  /** Run the chosen Sin's offer line, party pick(s), cost+payoff, result, then end. */
  private async resolveSin(key: BargainSinKey): Promise<void> {
    if (this.resolving) {
      return;
    }
    this.resolving = true;
    await globalScene.ui.setMode(UiMode.MESSAGE);
    await this.giratina(`${ns}:sins.${key}.offer`);

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

    await this.narrate(`${ns}:sins.${key}.result`, { pokeName });
    this.finish();
  }

  // --- UI helpers (generic, no mystery-encounter coupling) ---

  /** Open the party menu; resolves to the chosen mon, or null if backed out. */
  private pickPokemon(filter?: (p: PlayerPokemon) => string | null): Promise<PlayerPokemon | null> {
    return new Promise(resolve => {
      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.SELECT,
        -1,
        (slotIndex: number) => {
          globalScene.ui.setMode(UiMode.MESSAGE);
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

  private pickRelic(): Promise<(() => ModifierType) | null> {
    return this.subMenu(BARGAIN_RELIC_CHOICES.map(c => ({ label: c.label, value: c.make })));
  }

  /** A simple labelled choice menu; resolves to the chosen value or null on cancel. */
  private subMenu<T>(choices: { label: string; value: T }[]): Promise<T | null> {
    return new Promise(resolve => {
      const options: OptionSelectItem[] = choices.map(c => ({
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

  /** Tear down the portrait, return to MESSAGE, and end the phase. */
  private finish(): void {
    this.clearPortrait();
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
  }
}
