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

export class FunAbilityReviewUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private cursorObject: Phaser.GameObjects.NineSlice;
  private readonly descriptionTexts: Phaser.GameObjects.Text[] = [];
  private readonly cards: Phaser.GameObjects.Container[] = [];
  private readonly abilityTexts: Phaser.GameObjects.Text[][] = [];
  private party: Pokemon[] = [];
  private onContinue: (() => void) | null = null;
  private lastPartyCursor = 0;

  constructor(mode: UiMode | null = null) {
    super(mode);
  }

  public override setup(): void {
    const { width, height } = globalScene.scaledCanvas;
    this.container = globalScene.add.container(0, -height).setName("fun-ability-review");
    const overlay = globalScene.add.rectangle(0, 0, width, height, 0x242030, 0.96).setOrigin(0);
    const header = addWindow(0, 0, width, 14).setOrigin(0);
    const headerText = addTextObject(6, 2, "RANDOMIZED ABILITIES", TextStyle.HEADER_LABEL, {
      fontSize: "54px",
    }).setOrigin(0);
    this.container.add([overlay, header, headerText]);

    const cardWidth = Math.floor(width / 2) - 3;
    for (let index = 0; index < 6; index++) {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const card = globalScene.add.container(column * (cardWidth + 2) + 1, 15 + row * 31);
      const window = addWindow(0, 0, cardWidth, 30).setOrigin(0);
      const nameText = addTextObject(18, 2, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "36px",
        fixedWidth: (cardWidth - 21) * 6,
        maxLines: 1,
      }).setOrigin(0);
      nameText.setName("pokemon-name");
      const rows: Phaser.GameObjects.Text[] = [];
      for (let slot = 0; slot < 4; slot++) {
        const text = addTextObject(
          18 + (slot % 2) * Math.floor((cardWidth - 20) / 2),
          10 + Math.floor(slot / 2) * 9,
          "",
          TextStyle.SETTINGS_LABEL,
          {
            fontSize: "30px",
            fixedWidth: Math.floor((cardWidth - 24) / 2) * 6,
            maxLines: 1,
          },
        ).setOrigin(0);
        rows.push(text);
      }
      card.add([window, nameText, ...rows]);
      this.cards.push(card);
      this.abilityTexts.push(rows);
      this.container.add(card);
    }

    const descriptionWindow = addWindow(1, 108, width - 2, 56).setOrigin(0);
    for (let slot = 0; slot < 4; slot++) {
      this.descriptionTexts.push(
        addTextObject(6, 112 + slot * 12, "", TextStyle.SETTINGS_LABEL, {
          fontSize: "30px",
          fixedWidth: (width - 12) * 6,
          maxLines: 1,
        }).setOrigin(0),
      );
    }
    const rerollWindow = addWindow(1, 165, Math.floor(width / 2) - 2, 14).setOrigin(0);
    const startWindow = addWindow(Math.floor(width / 2), 165, Math.ceil(width / 2) - 1, 14).setOrigin(0);
    const rerollText = addTextObject(rerollWindow.x + rerollWindow.width / 2, 172, "REROLL", TextStyle.SETTINGS_LABEL, {
      fontSize: "54px",
    }).setOrigin(0.5);
    const startText = addTextObject(startWindow.x + startWindow.width / 2, 172, "START", TextStyle.SETTINGS_LABEL, {
      fontSize: "54px",
    }).setOrigin(0.5);
    this.cursorObject = globalScene.add
      .nineslice(3, 17, "summary_moves_cursor", undefined, cardWidth - 4, 26, 1, 1, 1, 1)
      .setOrigin(0);
    this.container.add([
      descriptionWindow,
      ...this.descriptionTexts,
      rerollWindow,
      startWindow,
      rerollText,
      startText,
      this.cursorObject,
    ]);
    this.container.setVisible(false);
    this.getUi().add(this.container);
  }

  public override show(args: any[]): boolean {
    super.show(args);
    this.party = (args[0] as Pokemon[]).slice(0, 6);
    this.onContinue = args[1] as () => void;
    this.cursor = 0;
    this.lastPartyCursor = 0;
    this.container.setVisible(true);
    this.refresh();
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    return true;
  }

  public override processInput(button: Button): boolean {
    let success = false;
    if (button === Button.LEFT || button === Button.RIGHT) {
      if (this.cursor < this.party.length) {
        const next = this.cursor + (button === Button.RIGHT ? 1 : -1);
        if (next >= 0 && next < this.party.length) {
          this.cursor = next;
          this.lastPartyCursor = next;
          success = true;
        }
      } else {
        this.cursor = this.cursor === 6 ? 7 : 6;
        success = true;
      }
    } else if (button === Button.UP) {
      this.cursor = this.cursor >= 6 ? Math.max(0, this.party.length - 2) : Math.max(0, this.cursor - 2);
      this.lastPartyCursor = this.cursor;
      success = true;
    } else if (button === Button.DOWN) {
      this.cursor = this.cursor < Math.max(0, this.party.length - 2) ? this.cursor + 2 : 6;
      if (this.cursor < this.party.length) {
        this.lastPartyCursor = this.cursor;
      }
      success = true;
    } else if (button === Button.ACTION || button === Button.SUBMIT) {
      if (this.cursor < this.party.length) {
        return false;
      }
      if (this.cursor === 6) {
        rerollFunAbilities();
        success = true;
      } else if (this.cursor === 7) {
        const callback = this.onContinue;
        this.getUi()
          .revertMode()
          .then(() => callback?.());
        return true;
      }
    }
    if (success) {
      this.getUi().playSelect();
      this.refresh();
    }
    return success;
  }

  public override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.onContinue = null;
  }

  private abilityRows(pokemon: Pokemon): AbilityRow[] {
    const abilities = [pokemon.getAbility(), ...pokemon.getPassiveAbilities()];
    return abilities.slice(0, 4).map(ability => ({
      name: ability?.name ?? "None",
      description: ability?.description ?? "No ability.",
    }));
  }

  private refresh(): void {
    const { width } = globalScene.scaledCanvas;
    const cardWidth = Math.floor(width / 2) - 3;
    this.cards.forEach((card, index) => {
      const pokemon = this.party[index];
      card.setVisible(!!pokemon);
      const nameObject = card.getAll().find(object => object.name === "pokemon-name") as
        | Phaser.GameObjects.Text
        | undefined;
      nameObject?.setVisible(!!pokemon);
      const oldIcon = card.getByName("pokemon-icon");
      oldIcon?.destroy();
      if (!pokemon) {
        return;
      }
      const icon = globalScene.addPokemonIcon(pokemon, 2, 5, 0.38, 0.38, true).setName("pokemon-icon");
      card.add(icon);
      const name = card.getAll().find(object => object.name === "pokemon-name") as Phaser.GameObjects.Text;
      name.setText(pokemon.getNameToRender({ useIllusion: false }));
      this.abilityRows(pokemon).forEach((ability, slot) => {
        this.abilityTexts[index][slot].setText(`${slot === 0 ? "A" : `I${slot}`}: ${ability.name}`);
        this.abilityTexts[index][slot].setColor(index === this.lastPartyCursor ? "#f8d870" : "#ffffff");
      });
    });

    if (this.cursor < this.party.length) {
      const column = this.cursor % 2;
      const row = Math.floor(this.cursor / 2);
      this.lastPartyCursor = this.cursor;
      this.cursorObject.setPosition(column * (cardWidth + 2) + 3, 17 + row * 31).setSize(cardWidth - 4, 26);
    } else {
      const isStart = this.cursor === 7;
      this.cursorObject
        .setPosition(isStart ? Math.floor(width / 2) + 2 : 3, 167)
        .setSize(Math.floor(width / 2) - 5, 10);
    }

    const selectedPokemon = this.party[Math.min(this.lastPartyCursor, Math.max(0, this.party.length - 1))];
    const selectedAbilities = selectedPokemon ? this.abilityRows(selectedPokemon) : [];
    this.descriptionTexts.forEach((text, slot) => {
      const ability = selectedAbilities[slot];
      text.setText(ability ? `${slot === 0 ? "A" : `I${slot}`}  ${ability.name}: ${ability.description}` : "");
    });
  }
}
