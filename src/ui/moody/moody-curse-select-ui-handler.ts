/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Moody CURSE DRAFT (setup after party selection).
//
// Runs once the starting party is finalized so party-aware previews (Type Tax
// duplicates, Oathbound anchor, Restless Lead, The Long Night, Cursed
// Inventory) show real consequences. Three curse cards with Dread severity,
// run-wide effect, current-party impact preview, dynamic target selection
// where required (Oathbound -> pick the Anchor), then a confirmation summary.
//
// Mandatory like the boon draft: CANCEL moves between steps but never dismisses
// the setup - one curse must be taken.
//
// show() args: [onComplete: (curseId) => void]
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { commitMoodyCurseOffer, getMoodyCurseOffers, MOODY_CURSE_BY_ID } from "#data/elite-redux/moody/moody-state";
import type { MoodyCurseDefinition, MoodyCurseOffer } from "#data/elite-redux/moody/moody-types";
import { Button } from "#enums/buttons";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { createMoodyCard, type MoodyCardComponent } from "#ui/moody/moody-card";
import { buildMoodyCurseCard, MOODY_MODE_RULES, type MoodyCardModel } from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

const CARD_X = [5, 109, 213] as const;
const CARD_Y = 16;
const CARD_W = 102;
const CARD_H = 122;

enum CurseStep {
  CARDS,
  TARGET,
  CONFIRM,
}

/** Party-aware impact preview per curse. Unknown curses get no preview. */
function curseImpactLines(definition: MoodyCurseDefinition, party: readonly PlayerPokemon[]): string[] {
  switch (definition.id) {
    case "type-tax": {
      const counts = new Map<number, number>();
      for (const pokemon of party) {
        for (const type of pokemon.getTypes()) {
          counts.set(type, (counts.get(type) ?? 0) + 1);
        }
      }
      const taxed = [...counts.entries()].filter(([, count]) => count > 1);
      if (taxed.length === 0) {
        return ["No duplicated party typings: no penalty yet."];
      }
      return taxed.map(
        ([type, count]) =>
          `${PokemonType[type].charAt(0)}${PokemonType[type].slice(1).toLowerCase()} ×${count}: −${(count - 1) * 4}% power`,
      );
    }
    case "oathbound":
      return ["Requires selecting the Anchor.", "If the Anchor faints, every other ally loses 20% current HP."];
    case "restless-lead":
      return [
        "The same Pokémon cannot lead twice in a row.",
        `Current lead: ${getPokemonNameWithAffix(party[0], false)}`,
      ];
    case "the-long-night":
      return ["Biome-transition healing is disabled.", "Purchasable healing costs twice as much."];
    case "cursed-inventory":
      return [
        "One item/vitamin stack is disabled at each biome transition.",
        "The cursed stack is revealed, not destroyed.",
      ];
    default:
      return [];
  }
}

export class MoodyCurseSelectUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private cards: MoodyCardComponent[] = [];
  private cardCursor: Phaser.GameObjects.NineSlice;
  private impactTitle: Phaser.GameObjects.Text;
  private impactText: Phaser.GameObjects.Text;
  private rulesText: Phaser.GameObjects.Text;

  // Target layer (shared with confirmation visuals).
  private targetLayer: Phaser.GameObjects.Container;
  private targetRows: Phaser.GameObjects.Text[] = [];
  private targetCursorObj: Phaser.GameObjects.NineSlice;

  private offers: MoodyCurseOffer[] = [];
  private onComplete: ((curseId: string) => void) | null = null;
  private step: CurseStep = CurseStep.CARDS;
  private party: PlayerPokemon[] = [];
  private targetCursorIndex = 0;
  private committed = false;

  constructor() {
    super(UiMode.MOODY_CURSE_SELECT);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setName("moody-curse-select");
    this.container.setVisible(false);
    ui.add(this.container);

    const bg = globalScene.add.rectangle(0, 0, w, h, 0x14101c, 1).setOrigin(0);
    this.container.add(bg);
    const header = addTextObject(w / 2, 3, "MOODY MODE — CHOOSE A CURSE", TextStyle.HEADER_LABEL);
    header.setOrigin(0.5, 0);
    this.container.add(header);
    const footer = addTextObject(
      w / 2,
      h - 9,
      "◀ ▶ choose   ↑ ↓ read card   Z confirm   X back",
      TextStyle.SETTINGS_LABEL,
      {
        fontSize: "40px",
      },
    );
    footer.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(footer);

    for (let i = 0; i < 3; i++) {
      const card = createMoodyCard(CARD_X[i], CARD_Y, CARD_W, CARD_H);
      this.container.add(card.container);
      const cardIndex = i;
      const hit = globalScene.add.zone(CARD_X[i], CARD_Y, CARD_W, CARD_H).setOrigin(0);
      hit.setInteractive({ useHandCursor: true });
      hit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!this.active || this.step !== CurseStep.CARDS) {
          return;
        }
        if (this.cursor === cardIndex) {
          this.confirmCard();
        } else {
          this.setCursor(cardIndex);
          this.getUi().playSelect();
        }
        pointer.event?.stopPropagation?.();
      });
      this.container.add(hit);
      this.cards.push(card);
    }
    this.cardCursor = globalScene.add
      .nineslice(0, 0, "summary_moves_cursor", undefined, CARD_W + 4, CARD_H + 4, 2, 2, 2, 2)
      .setOrigin(0)
      .setVisible(false);
    this.container.add(this.cardCursor);

    // Impact preview strip under the cards.
    const impactY = CARD_Y + CARD_H + 4;
    this.impactTitle = addTextObject(8, impactY, "Party impact:", TextStyle.SETTINGS_LABEL, { fontSize: "34px" });
    this.impactTitle.setOrigin(0, 0).setColor("#f8d038");
    this.container.add(this.impactTitle);
    this.impactText = addTextObject(8, impactY + 10, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "30px",
      fixedWidth: (w - 130) * 6,
      maxLines: 2,
      wordWrap: { width: (w - 130) * 6, useAdvancedWrap: true },
    });
    this.impactText.setOrigin(0, 0).setAlpha(0.9);
    this.container.add(this.impactText);
    this.rulesText = addTextObject(w - 8, impactY, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "28px",
      align: "right",
      fixedWidth: 116 * 6,
      maxLines: 4,
      wordWrap: { width: 116 * 6, useAdvancedWrap: true },
    });
    this.rulesText.setOrigin(1, 0).setAlpha(0.75);
    this.rulesText.setText(MOODY_MODE_RULES.map(rule => `· ${rule}`).join("\n"));
    this.container.add(this.rulesText);

    // Target layer (Oathbound anchor pick) / confirmation list.
    this.targetLayer = globalScene.add.container(0, 0);
    this.targetLayer.setVisible(false);
    this.container.add(this.targetLayer);
    const paneW = 216;
    const paneH = 132;
    const paneX = (w - paneW) / 2;
    const paneY = 24;
    this.targetLayer.add(addWindow(paneX, paneY, paneW, paneH));
    for (let row = 0; row < 6; row++) {
      const text = addTextObject(paneX + 14, paneY + 26 + row * 16, "", TextStyle.SETTINGS_LABEL, { fontSize: "42px" });
      text.setOrigin(0, 0);
      this.targetLayer.add(text);
      this.targetRows.push(text);
    }
    this.targetCursorObj = globalScene.add
      .nineslice(0, 0, "summary_moves_cursor", undefined, paneW - 12, 15, 1, 1, 1, 1)
      .setOrigin(0)
      .setVisible(false);
    this.targetLayer.add(this.targetCursorObj);
    const rowHit = globalScene.add.zone(paneX, paneY + 22, paneW, 6 * 16 + 4).setOrigin(0);
    rowHit.setInteractive({ useHandCursor: true });
    rowHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.active || this.step === CurseStep.CARDS) {
        return;
      }
      const localY = pointer.y / 6 - (paneY + 22);
      const index = Math.max(0, Math.min(5, Math.floor(localY / 16)));
      if (this.step === CurseStep.TARGET && index < this.party.length) {
        if (index === this.targetCursorIndex) {
          this.confirmTarget();
        } else {
          this.targetCursorIndex = index;
          this.refreshTargetList();
          this.getUi().playSelect();
        }
      } else if (this.step === CurseStep.CONFIRM) {
        this.commitCurse();
      }
      pointer.event?.stopPropagation?.();
    });
    this.targetLayer.add(rowHit);
  }

  show(args: any[]): boolean {
    if (args.length !== 1 || !(args[0] instanceof Function)) {
      return false;
    }
    if (!super.show(args)) {
      return false;
    }
    this.offers = [...getMoodyCurseOffers()];
    this.onComplete = args[0] as (curseId: string) => void;
    if (this.offers.length !== 3) {
      return false;
    }
    this.party = globalScene.getPlayerParty();
    this.step = CurseStep.CARDS;
    this.committed = false;
    this.targetCursorIndex = 0;
    this.refreshCards();
    this.targetLayer.setVisible(false);
    this.cardCursor.setVisible(true);
    this.setCursor(0);
    this.moveCardCursor();
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  private currentDefinition(): MoodyCurseDefinition | undefined {
    return MOODY_CURSE_BY_ID.get(this.offers[this.cursor]?.curseId);
  }

  private refreshCards(): void {
    for (let i = 0; i < 3; i++) {
      const definition = MOODY_CURSE_BY_ID.get(this.offers[i]?.curseId);
      if (definition == null) {
        this.cards[i].setModel({
          title: "???",
          cardState: "hidden",
          cardStateLabel: "",
          scopeGlyph: "?",
          scopeLabel: "unknown",
          cadenceLabel: "",
          targetLabel: "",
          description: "",
          deltaLines: [],
        } satisfies MoodyCardModel);
        continue;
      }
      const card = buildMoodyCurseCard(definition);
      this.cards[i].setModel({
        title: card.title,
        rarity: "rogue",
        rarityTint: 0xb06ac0,
        rarityLabel: card.dreadLabel,
        cardState: "new",
        cardStateLabel: "CURSE",
        scopeGlyph: "☾",
        scopeLabel: "run-wide",
        cadenceLabel: "PERMANENT",
        targetLabel: card.targetLabel ?? "",
        description: card.description,
        deltaLines: [],
      } satisfies MoodyCardModel);
    }
  }

  private refreshImpact(): void {
    const definition = this.currentDefinition();
    if (definition == null) {
      this.impactText.setText("");
      return;
    }
    const lines = curseImpactLines(definition, this.party);
    this.impactText.setText(lines.length === 0 ? "No immediate party impact." : lines.join("\n"));
  }

  private confirmCard(): void {
    const definition = this.currentDefinition();
    if (definition == null) {
      return;
    }
    this.getUi().playSelect();
    if (definition.id === "oathbound" && this.party.length > 0) {
      this.step = CurseStep.TARGET;
      this.targetCursorIndex = 0;
      this.openTargetLayer();
      return;
    }
    this.openConfirm();
  }

  private openTargetLayer(): void {
    this.cardCursor.setVisible(false);
    this.targetLayer.setVisible(true);
    this.refreshTargetList();
  }

  private openConfirm(): void {
    this.step = CurseStep.CONFIRM;
    this.cardCursor.setVisible(false);
    this.targetLayer.setVisible(true);
    this.refreshTargetList();
  }

  private refreshTargetList(): void {
    const definition = this.currentDefinition();
    if (this.step === CurseStep.TARGET) {
      for (let row = 0; row < 6; row++) {
        const pokemon = this.party[row];
        this.targetRows[row].setText(
          pokemon == null ? "" : `${row + 1}. ${getPokemonNameWithAffix(pokemon, false)}  Lv${pokemon.level}`,
        );
      }
      this.targetCursorObj
        .setVisible(true)
        .setPosition((globalScene.scaledCanvas.width - 216) / 2 + 5, 24 + 25 + this.targetCursorIndex * 16);
      return;
    }
    // CONFIRM step: summary rows; any confirm commits.
    const impact = definition == null ? [] : curseImpactLines(definition, this.party);
    const rows = [
      `Take ${definition?.name ?? "?"} (${definition == null ? "" : `Dread ${"I".repeat(definition.dread)}`})?`,
      "",
      ...impact.slice(0, 3),
      "",
      "Z confirm   X back",
    ];
    for (let row = 0; row < 6; row++) {
      this.targetRows[row].setText(rows[row] ?? "");
    }
    this.targetCursorObj.setVisible(false);
  }

  private confirmTarget(): void {
    const pokemon = this.party[this.targetCursorIndex];
    if (pokemon == null) {
      return;
    }
    this.getUi().playSelect();
    this.openConfirm();
  }

  private commitCurse(): void {
    const definition = this.currentDefinition();
    if (definition == null || this.committed) {
      return;
    }
    const target =
      definition.id === "oathbound" && this.party[this.targetCursorIndex] != null
        ? {
            pokemonIds: [this.party[this.targetCursorIndex].id],
            partySlots: [this.targetCursorIndex],
          }
        : undefined;
    const offer = this.offers[this.cursor];
    if (offer == null) {
      return;
    }
    // Core validates that this exact seeded offer belongs to the active draft.
    commitMoodyCurseOffer(offer, target);
    this.committed = true;
    const onComplete = this.onComplete;
    this.onComplete = null;
    this.getUi().playSelect();
    this.getUi()
      .revertMode()
      .then(() => onComplete?.(definition.id));
  }

  processInput(button: Button): boolean {
    if (!this.active || this.committed) {
      return false;
    }
    if (this.step === CurseStep.CARDS) {
      switch (button) {
        case Button.LEFT:
          if (this.setCursor(this.cursor === 0 ? 2 : this.cursor - 1)) {
            this.moveCardCursor();
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.RIGHT:
          if (this.setCursor(this.cursor === 2 ? 0 : this.cursor + 1)) {
            this.moveCardCursor();
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.UP:
          if (this.cards[this.cursor].getPage() > 0) {
            this.cards[this.cursor].setPage(this.cards[this.cursor].getPage() - 1);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.DOWN:
          if (this.cards[this.cursor].getPage() < this.cards[this.cursor].getPageCount() - 1) {
            this.cards[this.cursor].setPage(this.cards[this.cursor].getPage() + 1);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.ACTION:
        case Button.SUBMIT:
          this.confirmCard();
          return true;
        case Button.CANCEL:
          return false; // mandatory setup: cannot dismiss
        default:
          return false;
      }
    }
    if (this.step === CurseStep.TARGET) {
      switch (button) {
        case Button.UP:
          if (this.targetCursorIndex > 0) {
            this.targetCursorIndex--;
            this.refreshTargetList();
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.DOWN:
          if (this.targetCursorIndex < Math.min(6, this.party.length) - 1) {
            this.targetCursorIndex++;
            this.refreshTargetList();
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.ACTION:
        case Button.SUBMIT:
          this.confirmTarget();
          return true;
        case Button.CANCEL:
          this.step = CurseStep.CARDS;
          this.targetLayer.setVisible(false);
          this.cardCursor.setVisible(true);
          return true;
        default:
          return false;
      }
    }
    // CONFIRM step.
    switch (button) {
      case Button.ACTION:
      case Button.SUBMIT:
        this.commitCurse();
        return true;
      case Button.CANCEL: {
        const definition = this.currentDefinition();
        if (definition?.id === "oathbound") {
          this.step = CurseStep.TARGET;
        } else {
          this.step = CurseStep.CARDS;
          this.targetLayer.setVisible(false);
          this.cardCursor.setVisible(true);
        }
        return true;
      }
      default:
        return false;
    }
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCardCursor();
    this.refreshImpact();
    return changed;
  }

  private moveCardCursor(): void {
    if (this.step !== CurseStep.CARDS || this.cardCursor == null) {
      return;
    }
    this.cardCursor.setPosition(CARD_X[this.cursor] - 2, CARD_Y - 2);
    for (let i = 0; i < 3; i++) {
      this.cards[i].setFocused(i === this.cursor);
    }
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cardCursor?.setVisible(false);
    this.targetCursorObj?.setVisible(false);
    this.getUi().hideTooltip();
  }
}
