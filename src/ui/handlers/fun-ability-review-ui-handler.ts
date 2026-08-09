/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { rerollFunAbilities } from "#data/elite-redux/er-fun-mode";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import type { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

interface AbilityRow {
  name: string;
  description: string;
}

const MAX_DESCRIPTION_PAGE_LENGTH = 145;

export class FunAbilityReviewUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private cursorObject: Phaser.GameObjects.NineSlice;
  private readonly rows: Phaser.GameObjects.Container[] = [];
  private readonly pokemonNameTexts: Phaser.GameObjects.Text[] = [];
  private readonly abilityNameTexts: Phaser.GameObjects.Text[][] = [];
  private readonly abilityDescriptionTexts: Phaser.GameObjects.Text[][] = [];
  private readonly descriptionPages: string[][][] = [];
  private party: Pokemon[] = [];
  private onContinue: (() => void) | null = null;
  private descriptionPage = 0;
  private descriptionTimer: Phaser.Time.TimerEvent | null = null;

  constructor(mode: UiMode | null = null) {
    super(mode);
  }

  public override setup(): void {
    const { width, height } = globalScene.scaledCanvas;
    this.container = globalScene.add.container(0, -height).setName("fun-ability-review");
    this.container.add(globalScene.add.rectangle(0, 0, width, height, 0x242030, 0.96).setOrigin(0));

    const rowWidth = width - 2;
    const pokemonWidth = 44;
    const abilityWidth = Math.floor((rowWidth - pokemonWidth) / 4);
    for (let index = 0; index < 6; index++) {
      const row = globalScene.add.container(1, 1 + index * 27);
      const window = addWindow(0, 0, rowWidth, 26).setOrigin(0);
      const name = addTextObject(14, 2, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "18px",
        fixedWidth: (pokemonWidth - 16) * 6,
        maxLines: 1,
      }).setOrigin(0);
      const names: Phaser.GameObjects.Text[] = [];
      const descriptions: Phaser.GameObjects.Text[] = [];
      const pageSlots: string[][] = [];
      const objects: Phaser.GameObjects.GameObject[] = [window, name];
      for (let slot = 0; slot < 4; slot++) {
        const x = pokemonWidth + slot * abilityWidth;
        objects.push(globalScene.add.rectangle(x, 2, 1, 22, 0x665c72).setOrigin(0));
        const abilityName = addTextObject(x + 2, 2, "", TextStyle.SETTINGS_LABEL, {
          fontSize: "14px",
          fixedWidth: (abilityWidth - 4) * 6,
          maxLines: 1,
        })
          .setOrigin(0)
          .setColor("#78e898");
        const description = addTextObject(x + 2, 7, "", TextStyle.SETTINGS_LABEL, {
          fontSize: "12px",
          fixedWidth: (abilityWidth - 4) * 6,
          maxLines: 5,
        }).setOrigin(0);
        description.setWordWrapWidth((abilityWidth - 4) * 6, true);
        names.push(abilityName);
        descriptions.push(description);
        pageSlots.push([]);
        objects.push(abilityName, description);
      }
      row.add(objects);
      this.rows.push(row);
      this.pokemonNameTexts.push(name);
      this.abilityNameTexts.push(names);
      this.abilityDescriptionTexts.push(descriptions);
      this.descriptionPages.push(pageSlots);
      this.container.add(row);
    }

    const rerollWindow = addWindow(1, 163, Math.floor(width / 2) - 2, 16).setOrigin(0);
    const startWindow = addWindow(Math.floor(width / 2), 163, Math.ceil(width / 2) - 1, 16).setOrigin(0);
    const rerollText = addTextObject(
      rerollWindow.x + rerollWindow.width / 2,
      171,
      "REROLL ALL",
      TextStyle.SETTINGS_LABEL,
      { fontSize: "42px" },
    ).setOrigin(0.5);
    const startText = addTextObject(startWindow.x + startWindow.width / 2, 171, "START", TextStyle.SETTINGS_LABEL, {
      fontSize: "42px",
    }).setOrigin(0.5);
    this.cursorObject = globalScene.add
      .nineslice(3, 165, "summary_moves_cursor", undefined, Math.floor(width / 2) - 5, 12, 1, 1, 1, 1)
      .setOrigin(0);
    this.container.add([rerollWindow, startWindow, rerollText, startText, this.cursorObject]);
    this.container.setVisible(false);
    this.getUi().add(this.container);
  }

  public override show(args: any[]): boolean {
    super.show(args);
    this.party = (args[0] as Pokemon[]).slice(0, 6);
    this.onContinue = args[1] as () => void;
    this.cursor = 6;
    this.descriptionPage = 0;
    this.container.setVisible(true);
    this.refresh();
    this.startDescriptionTimer();
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    return true;
  }

  public override processInput(button: Button): boolean {
    let success = false;
    if (button === Button.UP || button === Button.DOWN) {
      success = this.moveVertical(button === Button.DOWN);
    } else if (button === Button.LEFT || button === Button.RIGHT) {
      success = this.moveHorizontal();
    } else if (button === Button.CYCLE_SHINY && this.cursor < this.party.length) {
      this.cycleChoiceAbility(this.party[this.cursor]);
      success = true;
    } else if (button === Button.ACTION || button === Button.SUBMIT) {
      success = this.confirmSelection();
    }
    if (success) {
      this.getUi().playSelect();
      this.refresh();
    }
    return success;
  }

  public override clear(): void {
    super.clear();
    this.descriptionTimer?.remove();
    this.descriptionTimer = null;
    this.container.setVisible(false);
    this.onContinue = null;
  }

  private moveVertical(down: boolean): boolean {
    if (this.cursor >= 6) {
      this.cursor = down ? 0 : Math.max(0, this.party.length - 1);
    } else if (down) {
      this.cursor = this.cursor >= this.party.length - 1 ? 6 : this.cursor + 1;
    } else {
      this.cursor = this.cursor === 0 ? 6 : this.cursor - 1;
    }
    return true;
  }

  private moveHorizontal(): boolean {
    if (this.cursor < 6) {
      return false;
    }
    this.cursor = this.cursor === 6 ? 7 : 6;
    return true;
  }

  private confirmSelection(): boolean {
    if (this.cursor < this.party.length) {
      this.cycleChoiceAbility(this.party[this.cursor]);
      return true;
    }
    if (this.cursor === 6) {
      rerollFunAbilities();
      this.descriptionPage = 0;
      return true;
    }
    const callback = this.onContinue;
    this.getUi()
      .revertMode()
      .then(() => callback?.());
    return true;
  }

  private cycleChoiceAbility(pokemon: Pokemon): void {
    pokemon.abilityIndex = (pokemon.abilityIndex + 1) % 3;
    this.descriptionPage = 0;
  }

  private abilityRows(pokemon: Pokemon): AbilityRow[] {
    const abilities = [pokemon.getAbility(), ...pokemon.getPassiveAbilities().slice(0, 3)];
    return abilities.map(ability => ({
      name: ability?.name ?? "None",
      description: ability?.description ?? "No ability.",
    }));
  }

  private paginateDescription(description: string): string[] {
    if (description.length <= MAX_DESCRIPTION_PAGE_LENGTH) {
      return [description];
    }
    const pages: string[] = [];
    let current = "";
    for (const word of description.split(/\s+/)) {
      if (current && current.length + word.length + 1 > MAX_DESCRIPTION_PAGE_LENGTH) {
        pages.push(current);
        current = word;
      } else {
        current += `${current ? " " : ""}${word}`;
      }
    }
    if (current) {
      pages.push(current);
    }
    return pages.length > 0 ? pages : [description];
  }

  private startDescriptionTimer(): void {
    this.descriptionTimer?.remove();
    this.descriptionTimer = globalScene.time.addEvent({
      delay: 2800,
      loop: true,
      callback: () => {
        if (!this.container.visible) {
          return;
        }
        this.descriptionPage++;
        this.updateDescriptionPages();
      },
    });
  }

  private updateDescriptionPages(): void {
    this.abilityDescriptionTexts.forEach((texts, pokemonIndex) => {
      texts.forEach((text, slot) => {
        const pages = this.descriptionPages[pokemonIndex][slot];
        const page = pages.length > 0 ? pages[this.descriptionPage % pages.length] : "";
        text.setText(page);
        text.setFontSize(page.length > 115 ? 10 : page.length > 75 ? 12 : 14);
      });
    });
  }

  private refresh(): void {
    const { width } = globalScene.scaledCanvas;
    this.rows.forEach((row, index) => {
      const pokemon = this.party[index];
      row.setVisible(!!pokemon);
      row.getByName("pokemon-icon")?.destroy();
      if (!pokemon) {
        this.descriptionPages[index].forEach(pages => pages.splice(0));
        return;
      }
      const icon = globalScene.addPokemonIcon(pokemon, 1, 1, 0.24, 0.24, true).setName("pokemon-icon");
      row.add(icon);
      const renderedName = pokemon.getNameToRender({ useIllusion: false });
      this.pokemonNameTexts[index]
        .setText(renderedName)
        .setFontSize(renderedName.length > 12 ? 14 : renderedName.length > 9 ? 16 : 18);
      this.abilityRows(pokemon).forEach((ability, slot) => {
        const prefix = slot === 0 ? `R A${pokemon.abilityIndex + 1}/3` : `I${slot}`;
        this.abilityNameTexts[index][slot].setText(`${prefix} ${ability.name}`);
        this.descriptionPages[index][slot] = this.paginateDescription(ability.description);
      });
    });
    this.updateDescriptionPages();

    if (this.cursor < this.party.length) {
      this.cursorObject.setPosition(3, 3 + this.cursor * 27).setSize(width - 6, 22);
    } else {
      this.cursorObject
        .setPosition(this.cursor === 7 ? Math.floor(width / 2) + 2 : 3, 165)
        .setSize(Math.floor(width / 2) - 5, 12);
    }
  }
}
