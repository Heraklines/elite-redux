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
  private readonly cards: Phaser.GameObjects.Container[] = [];
  private readonly abilityNameTexts: Phaser.GameObjects.Text[][] = [];
  private readonly abilityDescriptionTexts: Phaser.GameObjects.Text[][] = [];
  private party: Pokemon[] = [];
  private onContinue: (() => void) | null = null;

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

    const cardWidth = Math.floor(width / 2) - 2;
    const abilityWidth = Math.floor((cardWidth - 10) / 2);
    for (let index = 0; index < 6; index++) {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const card = globalScene.add.container(column * (cardWidth + 2) + 1, 15 + row * 49);
      const window = addWindow(0, 0, cardWidth, 48).setOrigin(0);
      const nameText = addTextObject(15, 1, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "30px",
        fixedWidth: (cardWidth - 18) * 6,
        maxLines: 1,
      }).setOrigin(0);
      nameText.setName("pokemon-name");
      const names: Phaser.GameObjects.Text[] = [];
      const descriptions: Phaser.GameObjects.Text[] = [];
      for (let slot = 0; slot < 4; slot++) {
        const abilityX = 4 + (slot % 2) * (abilityWidth + 2);
        const abilityY = 10 + Math.floor(slot / 2) * 18;
        const name = addTextObject(abilityX, abilityY, "", TextStyle.SETTINGS_LABEL, {
          fontSize: "22px",
          fixedWidth: abilityWidth * 6,
          maxLines: 1,
        })
          .setOrigin(0)
          .setColor("#78e898");
        const description = addTextObject(abilityX, abilityY + 5, "", TextStyle.SETTINGS_LABEL, {
          fontSize: "18px",
          fixedWidth: abilityWidth * 6,
          maxLines: 3,
        }).setOrigin(0);
        description.setWordWrapWidth(abilityWidth * 6, true);
        names.push(name);
        descriptions.push(description);
      }
      card.add([window, nameText, ...names, ...descriptions]);
      this.cards.push(card);
      this.abilityNameTexts.push(names);
      this.abilityDescriptionTexts.push(descriptions);
      this.container.add(card);
    }

    const rerollWindow = addWindow(1, 163, Math.floor(width / 2) - 2, 16).setOrigin(0);
    const startWindow = addWindow(Math.floor(width / 2), 163, Math.ceil(width / 2) - 1, 16).setOrigin(0);
    const rerollText = addTextObject(
      rerollWindow.x + rerollWindow.width / 2,
      171,
      "REROLL ALL",
      TextStyle.SETTINGS_LABEL,
      { fontSize: "48px" },
    ).setOrigin(0.5);
    const startText = addTextObject(startWindow.x + startWindow.width / 2, 171, "START RUN", TextStyle.SETTINGS_LABEL, {
      fontSize: "48px",
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
    this.cursor = 0;
    this.container.setVisible(true);
    this.refresh();
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    return true;
  }

  public override processInput(button: Button): boolean {
    let success = false;
    if (button === Button.LEFT || button === Button.RIGHT || button === Button.UP || button === Button.DOWN) {
      this.cursor = this.cursor === 0 ? 1 : 0;
      success = true;
    } else if (button === Button.ACTION || button === Button.SUBMIT) {
      if (this.cursor === 0) {
        rerollFunAbilities();
        success = true;
      } else {
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
      const icon = globalScene.addPokemonIcon(pokemon, 1, 2, 0.3, 0.3, true).setName("pokemon-icon");
      card.add(icon);
      const name = card.getAll().find(object => object.name === "pokemon-name") as Phaser.GameObjects.Text;
      name.setText(pokemon.getNameToRender({ useIllusion: false }));
      this.abilityRows(pokemon).forEach((ability, slot) => {
        this.abilityNameTexts[index][slot].setText(`${slot === 0 ? "A" : `I${slot}`}  ${ability.name}`);
        const description = this.abilityDescriptionTexts[index][slot];
        description.setText(ability.description);
        description.setFontSize(ability.description.length > 110 ? 12 : ability.description.length > 75 ? 15 : 18);
      });
    });

    this.cursorObject
      .setPosition(this.cursor === 1 ? Math.floor(width / 2) + 2 : 3, 165)
      .setSize(Math.floor(width / 2) - 5, 12);
  }
}
