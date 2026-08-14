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

interface ReviewDensity {
  rowHeight: number;
  pokemonWidth: number;
  nameX: number;
  dividerPadding: number;
  bottomPadding: number;
  textRightInset: number;
  nameFontSize: number;
  abilityFontSize: number;
  abilityNameY: number;
  descriptionY: number;
  descriptionFontSize: number;
  descriptionLineHeight: number;
}

export class FunAbilityReviewUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private cursorObject: Phaser.GameObjects.NineSlice;
  private readonly rows: Phaser.GameObjects.Container[] = [];
  private readonly rowWindows: Phaser.GameObjects.NineSlice[] = [];
  private readonly rowDividers: Phaser.GameObjects.Rectangle[][] = [];
  private readonly pokemonNameTexts: Phaser.GameObjects.Text[] = [];
  private readonly abilityNameTexts: Phaser.GameObjects.Text[][] = [];
  private readonly abilityDescriptionTexts: Phaser.GameObjects.Text[][] = [];
  private readonly descriptionPages: string[][][] = [];
  private party: Pokemon[] = [];
  private onContinue: (() => void) | null = null;
  private descriptionPage = 0;
  private descriptionTimer: Phaser.Time.TimerEvent | null = null;
  private density: ReviewDensity = this.getDensity(6);

  constructor(mode: UiMode | null = null) {
    super(mode);
  }

  public override setup(): void {
    const { width, height } = globalScene.scaledCanvas;
    this.container = globalScene.add.container(0, -height).setName("fun-ability-review");
    this.container.add(globalScene.add.rectangle(0, 0, width, height, 0x242030, 0.96).setOrigin(0));

    for (let index = 0; index < 6; index++) {
      const row = globalScene.add.container(1, 1);
      const window = addWindow(0, 0, width - 2, 1).setOrigin(0);
      const name = addTextObject(0, 0, "", TextStyle.SETTINGS_LABEL, { maxLines: 1 }).setOrigin(0, 0.5);
      const names: Phaser.GameObjects.Text[] = [];
      const descriptions: Phaser.GameObjects.Text[] = [];
      const dividers: Phaser.GameObjects.Rectangle[] = [];
      const pageSlots: string[][] = [];
      const objects: Phaser.GameObjects.GameObject[] = [window, name];
      for (let slot = 0; slot < 4; slot++) {
        const divider = globalScene.add.rectangle(0, 0, 1, 1, 0x665c72).setOrigin(0);
        dividers.push(divider);
        objects.push(divider);
        const abilityName = addTextObject(0, 0, "", TextStyle.SETTINGS_LABEL, { maxLines: 1 })
          .setOrigin(0)
          .setColor("#78e898");
        const description = addTextObject(0, 0, "", TextStyle.SETTINGS_LABEL, { maxLines: 1 }).setOrigin(0);
        names.push(abilityName);
        descriptions.push(description);
        pageSlots.push([]);
        objects.push(abilityName, description);
      }
      row.add(objects);
      this.rows.push(row);
      this.rowWindows.push(window);
      this.rowDividers.push(dividers);
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
    this.density = this.getDensity(this.party.length);
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
      // Reroll is a one-shot action. Move focus to START so the next confirm
      // launches the run instead of silently rerolling forever.
      this.cursor = 7;
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
    // Measured from pokemon-emerald-pro.ttf: average glyph advance is ~0.36 em
    // (0.35 lowercase, 0.38 uppercase, 0.19 for spaces). 0.42 leaves headroom
    // for capitals/digits so pagination rarely overestimates; Phaser's
    // fixedWidth clips any miscounted line anyway.
    const canvasWidth = (this.density.textRightInset + 4) * 6;
    const maxCharsPerLine = Math.max(8, Math.floor(canvasWidth / (this.density.descriptionFontSize * 0.42)));
    const maxCharsPerPage = maxCharsPerLine * this.descriptionMaxLines();
    if (description.length <= maxCharsPerPage) {
      return [description];
    }
    const pages: string[] = [];
    let current = "";
    for (const word of description.split(/\s+/)) {
      if (current && current.length + word.length + 1 > maxCharsPerPage) {
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

  private descriptionMaxLines(): number {
    return Math.max(
      1,
      Math.floor(
        (this.density.rowHeight - this.density.descriptionY - this.density.bottomPadding)
          / this.density.descriptionLineHeight,
      ),
    );
  }

  private startDescriptionTimer(): void {
    this.descriptionTimer?.remove();
    this.descriptionTimer = globalScene.time.addEvent({
      delay: 8000,
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
        text.setText(page).setMaxLines(this.descriptionMaxLines());
      });
    });
  }

  private getDensity(partySize: number): ReviewDensity {
    const visibleRows = Phaser.Math.Clamp(partySize, 3, 6);
    const rowHeight = Math.floor(162 / visibleRows);
    const header = { rowHeight, dividerPadding: 2, textRightInset: 0 };
    switch (visibleRows) {
      case 3:
        return {
          ...header,
          pokemonWidth: 58,
          nameX: 28,
          bottomPadding: 3,
          nameFontSize: 44,
          abilityFontSize: 38,
          abilityNameY: 4,
          descriptionY: 10,
          descriptionFontSize: 34,
          descriptionLineHeight: 8,
        };
      case 4:
        return {
          ...header,
          pokemonWidth: 55,
          nameX: 27,
          bottomPadding: 2,
          nameFontSize: 38,
          abilityFontSize: 34,
          abilityNameY: 3,
          descriptionY: 8,
          descriptionFontSize: 30,
          descriptionLineHeight: 7,
        };
      case 5:
        return {
          ...header,
          pokemonWidth: 50,
          nameX: 25,
          bottomPadding: 2,
          nameFontSize: 34,
          abilityFontSize: 31,
          abilityNameY: 2,
          descriptionY: 8,
          descriptionFontSize: 28,
          descriptionLineHeight: 6.5,
        };
      default:
        return {
          ...header,
          pokemonWidth: 44,
          nameX: 22,
          bottomPadding: 2,
          nameFontSize: 32,
          abilityFontSize: 31,
          abilityNameY: 2,
          descriptionY: 9,
          descriptionFontSize: 30,
          descriptionLineHeight: 6,
        };
    }
  }

  private applyDensity(): void {
    const { width } = globalScene.scaledCanvas;
    const rowWidth = width - 2;
    const abilityWidth = Math.floor((rowWidth - this.density.pokemonWidth) / 4);
    const lastCellWidth = rowWidth - this.density.pokemonWidth - abilityWidth * 3;
    this.density.textRightInset = abilityWidth - 5;
    this.rows.forEach((row, rowIndex) => {
      row.setY(1 + rowIndex * this.density.rowHeight);
      this.rowWindows[rowIndex].setSize(rowWidth, this.density.rowHeight - 1);
      const name = this.pokemonNameTexts[rowIndex];
      name
        .setPosition(this.density.nameX, this.density.rowHeight / 2)
        .setFixedSize(Math.max(12, (this.density.pokemonWidth - this.density.nameX - 3) * 6), 0);
      this.abilityNameTexts[rowIndex].forEach((abilityName, slot) => {
        const x = this.density.pokemonWidth + slot * abilityWidth;
        const cellWidth = slot === 3 ? lastCellWidth : abilityWidth;
        this.rowDividers[rowIndex][slot]
          .setPosition(x, this.density.dividerPadding)
          .setSize(1, Math.max(1, this.density.rowHeight - 1 - this.density.dividerPadding * 2));
        abilityName.setPosition(x + 2, this.density.abilityNameY).setFixedSize(Math.max(12, (cellWidth - 4) * 6), 0);
        const description = this.abilityDescriptionTexts[rowIndex][slot];
        description
          .setPosition(x + 2, this.density.descriptionY)
          .setFontSize(this.density.descriptionFontSize)
          .setFixedSize(Math.max(12, (cellWidth - 4) * 6), 0)
          .setMaxLines(this.descriptionMaxLines())
          .setLineSpacing(Math.max(0, this.density.descriptionLineHeight * 6 - this.density.descriptionFontSize - 9))
          .setWordWrapWidth(Math.max(12, (cellWidth - 4) * 6), true);
      });
    });
  }

  private fitTextToWidth(text: Phaser.GameObjects.Text, logicalWidth: number): void {
    text.setFixedSize(0, 0).updateText();
    const canvasWidth = text.width;
    const maxCanvasWidth = logicalWidth * 6;
    if (canvasWidth > maxCanvasWidth) {
      const currentFontSize = Number.parseInt(text.style.fontSize as string, 10) || 96;
      text.setFontSize(Math.max(24, Math.floor(currentFontSize * (maxCanvasWidth / canvasWidth))));
      text.updateText();
    }
    text.setFixedSize(maxCanvasWidth, 0);
  }

  private refresh(): void {
    const { width } = globalScene.scaledCanvas;
    const rowWidth = width - 2;
    const abilityWidth = Math.floor((rowWidth - this.density.pokemonWidth) / 4);
    this.applyDensity();
    this.rows.forEach((row, index) => {
      const pokemon = this.party[index];
      row.setVisible(!!pokemon);
      row.getByName("pokemon-icon")?.destroy();
      if (!pokemon) {
        this.descriptionPages[index].forEach(pages => pages.splice(0));
        return;
      }
      const iconScale = Math.min(0.5, (this.density.rowHeight - 4) / 24);
      const iconX = Math.floor(this.density.nameX / 2) - 1;
      const iconOffsetY = Math.max(1, Math.floor((this.density.rowHeight - 32 * iconScale) / 2));
      const icon = globalScene
        .addPokemonIcon(pokemon, iconX, iconOffsetY, 0.5, 0, true)
        .setName("pokemon-icon")
        .setScale(iconScale);
      row.add(icon);
      const renderedName = pokemon.getNameToRender({ useIllusion: false });
      const nameText = this.pokemonNameTexts[index];
      nameText.setText(renderedName).setFontSize(this.density.nameFontSize).setLineSpacing(0);
      this.fitTextToWidth(nameText, this.density.pokemonWidth - this.density.nameX - 3);
      this.abilityRows(pokemon).forEach((ability, slot) => {
        const prefix = slot === 0 ? `R A${pokemon.abilityIndex + 1}/3` : `I${slot}`;
        const abilityNameText = this.abilityNameTexts[index][slot];
        abilityNameText
          .setText(`${prefix} ${ability.name}`)
          .setFontSize(this.density.abilityFontSize)
          .setLineSpacing(0);
        this.fitTextToWidth(
          abilityNameText,
          (slot === 3 ? rowWidth - this.density.pokemonWidth - abilityWidth * 3 : abilityWidth) - 4,
        );
        this.descriptionPages[index][slot] = this.paginateDescription(ability.description);
      });
    });
    this.updateDescriptionPages();

    if (this.cursor < this.party.length) {
      this.cursorObject
        .setPosition(3, 3 + this.cursor * this.density.rowHeight)
        .setSize(width - 6, this.density.rowHeight - 5);
    } else {
      this.cursorObject
        .setPosition(this.cursor === 7 ? Math.floor(width / 2) + 2 : 3, 165)
        .setSize(Math.floor(width / 2) - 5, 12);
    }
  }
}
