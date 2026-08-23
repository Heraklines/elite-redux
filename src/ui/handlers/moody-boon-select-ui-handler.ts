/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Fun Mode "Moody Mode" - the post-boss BOON DRAFT screen.
//
// A full-screen tarot-flavored draft shown after a boss wave: three horizontal
// boon cards, each color-coded by rarity (Great/Ultra/Rogue/Master) with the
// offer kind (NEW / RANK II / EVOLVE / REPLACE), its scope/target line and the
// full effect text (long text pages in-place inside a fixed-size box, so card
// dimensions never move). Hidden (Cursed Draft) cards render as "???" but stay
// selectable.
//
// Flow: pick a card (LEFT/RIGHT + ACTION) -> optional same-screen targeting
// (party member, second slot/mon, known move, held item stack, elemental type,
// evolution branch, or the boon to REPLACE) -> commitMoodyBoonOffer commits and
// the reward phase's onComplete fires EXACTLY once. CANCEL backs out one
// targeting step but can never dismiss the draft - a boon must be taken.
//
// The screen owns ONLY presentation + targeting; all draft state lives in
// moody-state.ts. show() args: [waveIndex: number, onComplete: () => void].
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import {
  commitMoodyBoonOffer,
  getMoodyBoonOffers,
  getMoodyModeState,
  MOODY_BOON_BY_ID,
} from "#data/elite-redux/moody/moody-state";
import type {
  MoodyBoonDefinition,
  MoodyBoonInstance,
  MoodyBoonOffer,
  MoodyBoonTarget,
  MoodyRarity,
} from "#data/elite-redux/moody/moody-types";
import { Button } from "#enums/buttons";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { buildPressureValveBoonTarget, buildPressureValveOperation } from "#ui/moody/moody-operation";
import {
  inferMoodyCadence,
  MOODY_CADENCE_LABEL,
  MOODY_SCOPE_GLYPH,
  moodyOfferDeltaLines,
  moodyOfferDescription,
} from "#ui/moody/moody-presentation";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

/** Rarity tint matches the shared modifier-tier palette (text.ts getModifierTierTextTint). */
const RARITY_TINT: Readonly<Record<MoodyRarity, number>> = {
  great: 0x4998f8,
  ultra: 0xf8d038,
  rogue: 0xdb4343,
  master: 0xe331c5,
};

const RARITY_LABEL: Readonly<Record<MoodyRarity, string>> = {
  great: "GREAT",
  ultra: "ULTRA",
  rogue: "ROGUE",
  master: "MASTER",
};

const KIND_LABEL: Readonly<Record<MoodyBoonOffer["kind"], string>> = {
  new: "NEW",
  "rank-up": "RANK II",
  evolution: "EVOLVE",
  replace: "REPLACE",
};

/** The targeting step the screen is currently in, after a card is chosen. */
enum TargetStep {
  /** No targeting - choosing among the three cards. */
  CARDS,
  /** Choosing the first party member (pokemon / move / item-stack / pokemon-type / pair lead). */
  PARTY,
  /** Choosing a second DISTINCT party member (pokemon-pair / slots). */
  PARTY_SECOND,
  /** Choosing a known move of the first party member. */
  MOVE,
  /** Choosing one held item stack of the first party member. */
  ITEM,
  /** Choosing one elemental type (pokemon-type / enemy-type). */
  TYPE,
  /** Choosing one of the two evolution branches. */
  EVOLVE,
  /** Choosing which owned boon to discard (replace offers). */
  REPLACE,
}

const CARD_X = [4, 82, 160] as const;
const CARD_Y = 24;
const CARD_W = 76;
const CARD_H = 132;
/** Effect text page geometry inside each card (stable - the box never resizes). */
const DESC_Y = CARD_Y + 52;
/** Whole-line page height that leaves a dedicated gutter for the bottom-right pager. */
const DESC_VISIBLE_H = 60;
const VISIBLE_ROWS = 6;
const ROW_STEP = 16;

export class MoodyBoonSelectUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  /** "Current build: n / 12 lines · ranks r · next draft" under the header. */
  private buildStatsText: Phaser.GameObjects.Text;
  private buildSidebarText: Phaser.GameObjects.Text;

  // --- Card-select layer ---
  private cardLayer: Phaser.GameObjects.Container;
  private cardNames: Phaser.GameObjects.Text[] = [];
  private cardKinds: Phaser.GameObjects.Text[] = [];
  private cardRarities: Phaser.GameObjects.Text[] = [];
  private cardScopes: Phaser.GameObjects.Text[] = [];
  private cardDescs: Phaser.GameObjects.Text[] = [];
  private cardPageLabels: Phaser.GameObjects.Text[] = [];
  private cardHits: Phaser.GameObjects.Zone[] = [];
  private cardCursor: Phaser.GameObjects.NineSlice;
  /** Page index of each card's effect text (paged in-place). */
  private cardPages: number[] = [0, 0, 0];
  /** Page count of each card's effect text (1 = fits). */
  private cardPageCounts: number[] = [1, 1, 1];

  // --- Targeting layer (one shared list pane reused for every step) ---
  private targetLayer: Phaser.GameObjects.Container;
  private targetTitle: Phaser.GameObjects.Text;
  private targetRows: Phaser.GameObjects.Text[] = [];
  private targetCursor: Phaser.GameObjects.NineSlice;
  private targetUpArrow: Phaser.GameObjects.Image;
  private targetDownArrow: Phaser.GameObjects.Image;
  private targetHint: Phaser.GameObjects.Text;
  private evolutionTexts: Phaser.GameObjects.Text[] = [];
  private evolutionPageLabels: Phaser.GameObjects.Text[] = [];
  private evolutionPages: number[] = [0, 0];
  private evolutionPageCounts: number[] = [1, 1];

  private waveIndex = 0;
  private onComplete: (() => void) | null = null;
  private offers: MoodyBoonOffer[] = [];
  private step: TargetStep = TargetStep.CARDS;
  private targetCursorIndex = 0;
  private targetScrollTop = 0;
  /** Committed (so double-confirm can never fire onComplete twice). */
  private committed = false;
  /** A mandatory nested picker is open; ignore input until it resolves. */
  private operationPending = false;

  // Targeting accumulators.
  private pickedPartyIndex = -1;
  private replaceInstanceId: string | undefined;
  private party: PlayerPokemon[] = [];
  private heldItems: PokemonHeldItemModifier[] = [];
  private typeOptions: PokemonType[] = [];
  private replaceCandidates: MoodyBoonInstance[] = [];

  constructor() {
    super(UiMode.MOODY_BOON_SELECT);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    // Full-screen handler containers sit at y=-h so child (0,0) is the screen top-left.
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    const bg = globalScene.add.rectangle(0, 0, w, h, 0x14101c, 1).setOrigin(0);
    this.container.add(bg);
    const header = addTextObject(w / 2, 3, "MOODY DRAFT", TextStyle.HEADER_LABEL, { fontSize: "42px" });
    header.setOrigin(0.5, 0);
    this.container.add(header);
    this.buildStatsText = addTextObject(w / 2, 13, "", TextStyle.SETTINGS_LABEL, { fontSize: "22px" });
    this.buildStatsText.setOrigin(0.5, 0).setAlpha(0.85);
    this.container.add(this.buildStatsText);
    const sidebar = addWindow(238, CARD_Y, 78, CARD_H);
    this.container.add(sidebar);
    this.buildSidebarText = addTextObject(243, CARD_Y + 5, "", TextStyle.SETTINGS_LABEL, {
      fontSize: "26px",
      fixedWidth: 68 * 6,
      maxLines: 13,
      wordWrap: { width: 68 * 6, useAdvancedWrap: true },
    }).setOrigin(0, 0);
    this.container.add(this.buildSidebarText);
    const footer = addTextObject(
      w / 2,
      h - 9,
      "◀ ▶ choose   Z confirm   ↑ ↓ read card   X back",
      TextStyle.SETTINGS_LABEL,
      { fontSize: "40px" },
    );
    footer.setOrigin(0.5, 1).setAlpha(0.8);
    this.container.add(footer);

    // --- Card layer ---
    this.cardLayer = globalScene.add.container(0, 0);
    this.container.add(this.cardLayer);
    for (let i = 0; i < 3; i++) {
      const x = CARD_X[i];
      const frame = addWindow(x, CARD_Y, CARD_W, CARD_H);
      this.cardLayer.add(frame);
      const name = addTextObject(x + CARD_W / 2, CARD_Y + 3, "", TextStyle.SUMMARY_HEADER, {
        fontSize: "34px",
        align: "center",
        fixedWidth: (CARD_W - 10) * 6,
        maxLines: 2,
        wordWrap: { width: (CARD_W - 10) * 6, useAdvancedWrap: true },
      });
      name.setOrigin(0.5, 0);
      const kind = addTextObject(x + 5, CARD_Y + 24, "", TextStyle.SUMMARY_HEADER, { fontSize: "30px" });
      kind.setOrigin(0, 0);
      const rarity = addTextObject(x + CARD_W - 5, CARD_Y + 24, "", TextStyle.SUMMARY_HEADER, { fontSize: "30px" });
      rarity.setOrigin(1, 0);
      const scope = addTextObject(x + 5, CARD_Y + 34, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "30px",
        fixedWidth: (CARD_W - 10) * 6,
        maxLines: 2,
        wordWrap: { width: (CARD_W - 10) * 6, useAdvancedWrap: true },
      });
      scope.setOrigin(0, 0).setAlpha(0.85);
      const desc = addTextObject(x + 5, DESC_Y, "", TextStyle.WINDOW, {
        fontSize: "34px",
        wordWrap: { width: (CARD_W - 10) * 6, useAdvancedWrap: true },
      });
      desc.setOrigin(0, 0);
      // Clip the effect text to the card's fixed description box (page-flip paging keeps it inside).
      const mask = globalScene.make.graphics();
      mask.fillStyle(0xffffff);
      mask.fillRect(x, DESC_Y - 2, CARD_W, DESC_VISIBLE_H + 4);
      mask.setScale(6);
      desc.setMask(mask.createGeometryMask());
      const pageLabel = addTextObject(x + CARD_W - 5, CARD_Y + CARD_H - 12, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "30px",
      });
      pageLabel.setOrigin(1, 0).setAlpha(0.8);
      this.cardLayer.add([name, kind, rarity, scope, desc, pageLabel]);

      // Click/touch target covering the whole card.
      const hit = globalScene.add.zone(x, CARD_Y, CARD_W, CARD_H).setOrigin(0);
      hit.setInteractive({ useHandCursor: true });
      const cardIndex = i;
      hit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!this.active || this.step !== TargetStep.CARDS) {
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
      this.cardLayer.add(hit);

      this.cardNames.push(name);
      this.cardKinds.push(kind);
      this.cardRarities.push(rarity);
      this.cardScopes.push(scope);
      this.cardDescs.push(desc);
      this.cardPageLabels.push(pageLabel);
      this.cardHits.push(hit);
    }
    this.cardCursor = globalScene.add
      .nineslice(0, 0, "summary_moves_cursor", undefined, CARD_W + 4, CARD_H + 4, 2, 2, 2, 2)
      .setOrigin(0)
      .setVisible(false);
    this.cardLayer.add(this.cardCursor);

    // --- Targeting layer (shared list pane, centered) ---
    this.targetLayer = globalScene.add.container(0, 0);
    this.targetLayer.setVisible(false);
    this.container.add(this.targetLayer);
    const paneW = 216;
    const paneH = 132;
    const paneX = (w - paneW) / 2;
    const paneY = 22;
    const pane = addWindow(paneX, paneY, paneW, paneH);
    this.targetLayer.add(pane);
    this.targetTitle = addTextObject(paneX + 8, paneY + 5, "", TextStyle.SETTINGS_LABEL, { fontSize: "40px" });
    this.targetTitle.setOrigin(0, 0);
    this.targetLayer.add(this.targetTitle);
    for (let row = 0; row < VISIBLE_ROWS; row++) {
      const text = addTextObject(paneX + 14, paneY + 24 + row * ROW_STEP, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "42px",
      });
      text.setOrigin(0, 0);
      this.targetLayer.add(text);
      this.targetRows.push(text);
    }
    this.targetCursor = globalScene.add
      .nineslice(0, 0, "summary_moves_cursor", undefined, paneW - 12, 15, 1, 1, 1, 1)
      .setOrigin(0)
      .setVisible(false);
    this.targetLayer.add(this.targetCursor);
    this.targetUpArrow = globalScene.add
      .image(paneX + paneW - 10, paneY + 20, "cursor")
      .setScale(0.45)
      .setAngle(-90)
      .setAlpha(0.8)
      .setVisible(false);
    this.targetDownArrow = globalScene.add
      .image(paneX + paneW - 10, paneY + paneH - 8, "cursor")
      .setScale(0.45)
      .setAngle(90)
      .setAlpha(0.8)
      .setVisible(false);
    this.targetLayer.add(this.targetUpArrow);
    this.targetLayer.add(this.targetDownArrow);
    this.targetHint = addTextObject(paneX + 8, paneY + paneH - 13, "", TextStyle.SETTINGS_LABEL, { fontSize: "30px" });
    this.targetHint.setOrigin(0, 0).setAlpha(0.8);
    this.targetLayer.add(this.targetHint);

    const branchTop = paneY + 25;
    const branchHeight = paneH - 39;
    for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
      const branchX = paneX + 7 + branchIndex * 103;
      const branchText = addTextObject(branchX, branchTop, "", TextStyle.WINDOW, {
        fontSize: "32px",
        wordWrap: { width: 94 * 6, useAdvancedWrap: true },
      })
        .setOrigin(0, 0)
        .setVisible(false);
      const branchMask = globalScene.make.graphics();
      branchMask.fillStyle(0xffffff);
      branchMask.fillRect(branchX, branchTop, 94, branchHeight);
      branchMask.setScale(6);
      branchText.setMask(branchMask.createGeometryMask());
      const pageLabel = addTextObject(branchX + 92, paneY + paneH - 12, "", TextStyle.SETTINGS_LABEL, {
        fontSize: "28px",
      })
        .setOrigin(1, 0)
        .setVisible(false);
      this.evolutionTexts.push(branchText);
      this.evolutionPageLabels.push(pageLabel);
      this.targetLayer.add([branchText, pageLabel]);
    }

    // Click/touch for targeting rows.
    const rowHit = globalScene.add.zone(paneX, paneY + 20, paneW, VISIBLE_ROWS * ROW_STEP + 4).setOrigin(0);
    rowHit.setInteractive({ useHandCursor: true });
    rowHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.active || this.step === TargetStep.CARDS) {
        return;
      }
      if (this.step === TargetStep.EVOLVE) {
        const branch = pointer.x / 6 < globalScene.scaledCanvas.width / 2 ? 0 : 1;
        if (branch === this.targetCursorIndex) {
          this.confirmTarget();
        } else {
          this.targetCursorIndex = branch;
          this.refreshTargetList();
          this.getUi().playSelect();
        }
        return;
      }
      // Pointer coords are canvas-space (6x the logical canvas); convert to logical.
      const localY = pointer.y / 6 - (paneY + 20);
      const slot = Math.max(0, Math.min(VISIBLE_ROWS - 1, Math.floor(localY / ROW_STEP)));
      const index = this.targetScrollTop + slot;
      if (index >= this.currentTargetCount()) {
        return;
      }
      if (index === this.targetCursorIndex) {
        this.confirmTarget();
      } else {
        this.targetCursorIndex = index;
        this.refreshTargetList();
        this.getUi().playSelect();
      }
      pointer.event?.stopPropagation?.();
    });
    this.targetLayer.add(rowHit);
  }

  show(args: any[]): boolean {
    if (args.length !== 2 || typeof args[0] !== "number" || !(args[1] instanceof Function)) {
      return false;
    }
    if (!super.show(args)) {
      return false;
    }

    this.waveIndex = args[0] as number;
    this.onComplete = args[1] as () => void;
    this.committed = false;
    this.operationPending = false;
    this.step = TargetStep.CARDS;
    this.targetCursorIndex = 0;
    this.targetScrollTop = 0;
    this.pickedPartyIndex = -1;
    this.replaceInstanceId = undefined;
    this.party = globalScene.getPlayerParty();
    this.offers = [...getMoodyBoonOffers(this.waveIndex)];
    this.cardPages = [0, 0, 0];

    // Build summary: current lines / cap, total ranks, and evolution proximity so
    // the draft choice is informed without mentally reconstructing the build.
    const state = getMoodyModeState();
    if (state == null) {
      this.buildStatsText.setText("");
      this.buildSidebarText.setText("CURRENT BUILD\nNo acquired lines.");
    } else {
      const totalRanks = state.boons.reduce((sum, boon) => sum + boon.rank, 0);
      const evolvingSoon = state.boons.filter(boon => boon.rank === 2).length;
      this.buildStatsText.setText(
        `WAVE ${this.waveIndex}  ·  build ${state.boons.length}/12  ·  ranks ${totalRanks}  ·  ${evolvingSoon} line${evolvingSoon === 1 ? "" : "s"} can evolve`,
      );
      this.buildSidebarText.setText(
        [
          "CURRENT BUILD",
          ...state.boons.map(boon => {
            const definition = MOODY_BOON_BY_ID.get(boon.boonId);
            const evolution = definition?.evolutions.find(branch => branch.id === boon.evolutionId);
            const rank = boon.rank === 1 ? "I" : boon.rank === 2 ? "II" : (evolution?.name ?? "III");
            return `${definition?.name ?? boon.boonId} ${rank} (W${boon.acquiredAtWave})`;
          }),
        ].join("\n"),
      );
    }

    this.refreshCards();
    this.cardLayer.setVisible(true);
    this.targetLayer.setVisible(false);
    this.cardCursor.setVisible(true);
    this.setCursor(0);
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Card layer
  // ---------------------------------------------------------------------------

  private definitionOf(offer: MoodyBoonOffer): MoodyBoonDefinition | undefined {
    return MOODY_BOON_BY_ID.get(offer.boonId);
  }

  /** The effect text shown on a card: base text, or rank-up preview / evolve branch names. */
  private cardDescription(offer: MoodyBoonOffer, definition: MoodyBoonDefinition): string {
    return [moodyOfferDescription(offer, definition), ...moodyOfferDeltaLines(offer, definition)].join("\n\n");
  }

  private scopeLine(offer: MoodyBoonOffer, definition: MoodyBoonDefinition): string {
    const scope = `${MOODY_SCOPE_GLYPH[definition.targetKind]} ${definition.scope} · ${MOODY_CADENCE_LABEL[inferMoodyCadence(definition)]}`;
    if (offer.kind === "rank-up" || offer.kind === "evolution") {
      return `${scope}  ·  owned`;
    }
    return scope;
  }

  private refreshCards(): void {
    for (let i = 0; i < 3; i++) {
      const offer = this.offers[i];
      const hidden = offer.hidden === true;
      const definition = this.definitionOf(offer);
      if (hidden || definition == null) {
        this.cardNames[i].setText("???").setColor("#b8b0c8");
        this.cardKinds[i].setText("").setColor("#f8f8f8");
        this.cardRarities[i].setText("CURSED").setColor("#8a4a9a");
        this.cardScopes[i].setText("unknown");
        this.cardDescs[i].setText("The Cursed Draft hides this boon.\n\nIt may still be taken - sight unseen.");
        this.cardPageCounts[i] = 1;
        this.cardPageLabels[i].setText("");
        this.cardDescs[i].y = DESC_Y;
        continue;
      }
      const tint = RARITY_TINT[definition.rarity];
      this.cardNames[i].setText(definition.name).setColor("#f8f8f8");
      this.cardKinds[i].setText(KIND_LABEL[offer.kind]).setColor("#e8e0f0");
      this.cardRarities[i]
        .setText(RARITY_LABEL[definition.rarity])
        .setColor(Phaser.Display.Color.IntegerToColor(tint).rgba);
      this.cardScopes[i].setText(this.scopeLine(offer, definition));
      this.cardDescs[i].setText(this.cardDescription(offer, definition));
      // Pages = how many times the text overflows the fixed description box. The
      // mask keeps overflow invisible; UP/DOWN flips pages by shifting the text up
      // exactly one box-height per page (stable dimensions, no reflow).
      const pageCount = Math.max(1, Math.ceil(this.cardDescs[i].displayHeight / DESC_VISIBLE_H));
      this.cardPageCounts[i] = pageCount;
      this.cardPages[i] = 0;
      this.applyCardPage(i);
    }
  }

  /** Flip card `i` to its current page by shifting the masked text up. */
  private applyCardPage(i: number): void {
    const pages = this.cardPageCounts[i];
    this.cardPages[i] = Math.max(0, Math.min(this.cardPages[i], pages - 1));
    this.cardDescs[i].y = DESC_Y - this.cardPages[i] * DESC_VISIBLE_H;
    this.cardPageLabels[i].setText(pages > 1 ? `${this.cardPages[i] + 1}/${pages}` : "");
  }

  private confirmCard(): void {
    const offer = this.offers[this.cursor];
    if (offer == null) {
      return;
    }
    this.getUi().playSelect();
    this.beginTargeting(offer);
  }

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  /** Enter the first targeting step required by the offer, or commit directly. */
  private beginTargeting(offer: MoodyBoonOffer): void {
    if (offer.hidden) {
      // Hidden card: definition lookup still succeeds (only the RENDER is hidden);
      // target it like a visible one.
    }
    const definition = this.definitionOf(offer);
    if (offer.kind === "rank-up") {
      // Rank-ups retain the instance's original binding and acquisition choice.
      this.commitOffer(offer, {});
      return;
    }
    if (offer.kind === "evolution") {
      const definition = this.definitionOf(offer);
      if (definition?.evolutions.length === 1) {
        this.commitOffer(offer, {}, definition.evolutions[0].id);
        return;
      }
      this.openStep(TargetStep.EVOLVE);
      return;
    }
    if (offer.kind === "replace") {
      this.replaceCandidates = (getMoodyModeState()?.boons ?? []).slice();
      this.openStep(TargetStep.REPLACE);
      return;
    }
    if (definition == null) {
      // Unknown/hidden with no definition resolvable: commit target-less (the state
      // layer validates; never let the UI strand the draft).
      this.commitOffer(offer, {});
      return;
    }
    this.beginDefinitionTargeting(offer, definition);
  }

  private beginDefinitionTargeting(offer: MoodyBoonOffer, definition: MoodyBoonDefinition): void {
    if (definition.id === "apex-plunder") {
      // Apex Plunder binds only after an eligible segmented boss is defeated.
      this.commitOffer(offer, {});
      return;
    }
    switch (definition.targetKind) {
      case "slot":
      case "pokemon":
        this.openStep(TargetStep.PARTY);
        return;
      case "slots":
      case "pokemon-pair":
        this.openStep(TargetStep.PARTY);
        return;
      case "move":
      case "item-stack":
      case "pokemon-type":
        if (definition.scope.toLowerCase().startsWith("team")) {
          this.prepareStepData(TargetStep.TYPE);
          this.openStep(TargetStep.TYPE);
          return;
        }
        this.openStep(TargetStep.PARTY);
        return;
      case "enemy-type":
        this.prepareStepData(TargetStep.TYPE);
        this.openStep(TargetStep.TYPE);
        return;
      case "team":
      case "field":
      case "economy":
      case "reward":
      case "contract":
      case "rule":
        this.commitOffer(offer, {});
        return;
    }
  }

  private openStep(step: TargetStep): void {
    this.step = step;
    this.targetCursorIndex = 0;
    this.targetScrollTop = 0;
    this.cardLayer.setVisible(false);
    this.targetLayer.setVisible(true);
    this.refreshTargetList();
  }

  /** Back one targeting step; CANCEL on the card layer does nothing (mandatory draft). */
  private backStep(): boolean {
    if (this.step === TargetStep.CARDS) {
      return false; // cannot dismiss a mandatory reward
    }
    if (this.step === TargetStep.PARTY_SECOND || this.step === TargetStep.MOVE || this.step === TargetStep.ITEM) {
      this.openStep(TargetStep.PARTY);
      return true;
    }
    if (this.step === TargetStep.TYPE) {
      const offer = this.offers[this.cursor];
      const definition = offer == null ? undefined : this.definitionOf(offer);
      if (definition?.targetKind === "pokemon-type" && !definition.scope.toLowerCase().startsWith("team")) {
        this.openStep(TargetStep.PARTY);
        return true;
      }
      this.backToOfferOrReplacement();
      return true;
    }
    if (this.step === TargetStep.PARTY && this.replaceInstanceId != null) {
      this.openStep(TargetStep.REPLACE);
      return true;
    }
    // PARTY / EVOLVE / REPLACE are first steps: back to cards.
    this.backToOfferOrReplacement();
    return true;
  }

  private backToOfferOrReplacement(): void {
    if (this.replaceInstanceId != null && this.step !== TargetStep.REPLACE) {
      this.openStep(TargetStep.REPLACE);
      return;
    }
    this.closeTargetLayer();
  }

  private closeTargetLayer(): void {
    this.replaceInstanceId = undefined;
    this.step = TargetStep.CARDS;
    this.targetLayer.setVisible(false);
    this.cardLayer.setVisible(true);
    this.cardCursor.setVisible(true);
  }

  private currentOffer(): MoodyBoonOffer | null {
    return this.offers[this.cursor] ?? null;
  }

  private currentTargetCount(): number {
    switch (this.step) {
      case TargetStep.PARTY:
      case TargetStep.PARTY_SECOND:
        return this.party.length;
      case TargetStep.MOVE:
        return this.party[this.pickedPartyIndex]?.moveset.length ?? 0;
      case TargetStep.ITEM:
        return this.heldItems.length;
      case TargetStep.TYPE:
        return this.typeOptions.length;
      case TargetStep.EVOLVE: {
        const offer = this.currentOffer();
        return offer == null ? 0 : (this.definitionOf(offer)?.evolutions.length ?? 0);
      }
      case TargetStep.REPLACE:
        return this.replaceCandidates.length;
      default:
        return 0;
    }
  }

  private targetStepTitle(): string {
    switch (this.step) {
      case TargetStep.PARTY: {
        const definition = this.currentOffer() == null ? undefined : this.definitionOf(this.currentOffer()!);
        return definition?.targetKind === "slot" ? "Mark a slot" : "Choose a Pokémon";
      }
      case TargetStep.PARTY_SECOND:
        return "Choose a second, different Pokémon";
      case TargetStep.MOVE:
        return "Choose a known move";
      case TargetStep.ITEM:
        return "Choose a held item stack";
      case TargetStep.TYPE:
        return "Choose an elemental type";
      case TargetStep.EVOLVE:
        return "Choose an evolution";
      case TargetStep.REPLACE:
        return "Discard which boon?";
      default:
        return "";
    }
  }

  private partyRowLabel(index: number, second: boolean): string {
    const pokemon = this.party[index];
    if (pokemon == null) {
      return "";
    }
    const marker = second && index === this.pickedPartyIndex ? " (first)" : "";
    return `${index + 1}. ${getPokemonNameWithAffix(pokemon, false)}  Lv${pokemon.level}${marker}`;
  }

  private refreshTargetList(): void {
    const count = this.currentTargetCount();
    const paneW = 216;
    const paneY = 22;
    // Keep the cursor inside the visible window.
    if (this.targetCursorIndex < this.targetScrollTop) {
      this.targetScrollTop = this.targetCursorIndex;
    } else if (this.targetCursorIndex >= this.targetScrollTop + VISIBLE_ROWS) {
      this.targetScrollTop = this.targetCursorIndex - VISIBLE_ROWS + 1;
    }
    this.targetScrollTop = Math.max(0, Math.min(this.targetScrollTop, Math.max(0, count - VISIBLE_ROWS)));

    this.targetTitle.setText(this.targetStepTitle());
    const offer = this.currentOffer();
    const definition = offer == null ? undefined : this.definitionOf(offer);
    const evolutionStep = this.step === TargetStep.EVOLVE;

    for (let slot = 0; slot < VISIBLE_ROWS; slot++) {
      const index = this.targetScrollTop + slot;
      const row = this.targetRows[slot];
      row.setVisible(!evolutionStep);
      if (index >= count) {
        row.setText("");
        continue;
      }
      let label = "";
      let greyed = false;
      switch (this.step) {
        case TargetStep.PARTY:
          label = this.partyRowLabel(index, false);
          break;
        case TargetStep.PARTY_SECOND:
          label = this.partyRowLabel(index, true);
          greyed = index === this.pickedPartyIndex;
          break;
        case TargetStep.MOVE: {
          const move = this.party[this.pickedPartyIndex]?.moveset[index];
          label = move == null ? "" : move.getName();
          break;
        }
        case TargetStep.ITEM: {
          const item = this.heldItems[index];
          label = item == null ? "" : `${item.type.name} ×${item.getStackCount()}`;
          break;
        }
        case TargetStep.TYPE: {
          const type = this.typeOptions[index];
          label = type == null ? "" : PokemonType[type].charAt(0) + PokemonType[type].slice(1).toLowerCase();
          break;
        }
        case TargetStep.EVOLVE: {
          const branch = definition?.evolutions[index];
          label = branch == null ? "" : branch.name;
          break;
        }
        case TargetStep.REPLACE: {
          const instance = this.replaceCandidates[index];
          const owned = instance == null ? undefined : MOODY_BOON_BY_ID.get(instance.boonId);
          label = owned == null || instance == null ? "" : `${owned.name}  (rank ${"I".repeat(instance.rank)})`;
          break;
        }
      }
      row.setText(label).setAlpha(greyed ? 0.4 : 1);
    }

    const evolutionCount = definition?.evolutions.length ?? 0;
    this.evolutionTexts.forEach((text, index) => {
      const branchVisible = evolutionStep && index < evolutionCount;
      text.setVisible(branchVisible);
      this.evolutionPageLabels[index].setVisible(branchVisible);
      if (!evolutionStep) {
        return;
      }
      const branch = definition?.evolutions[index];
      text.setText(branch == null ? "" : `${branch.name}\n\n${branch.description}`);
      this.evolutionPageCounts[index] = Math.max(1, Math.ceil(text.displayHeight / (paneY + 115 - (paneY + 25))));
      this.evolutionPages[index] = Math.min(this.evolutionPages[index], this.evolutionPageCounts[index] - 1);
      this.applyEvolutionPage(index);
    });

    if (this.step === TargetStep.PARTY_SECOND) {
      this.targetHint.setText("The partner must be a different Pokémon.");
    } else {
      this.targetHint.setText("");
    }

    if (evolutionStep) {
      const branchWidth = evolutionCount === 1 ? 204 : 101;
      this.targetCursor
        .setVisible(true)
        .setPosition((globalScene.scaledCanvas.width - paneW) / 2 + 5 + this.targetCursorIndex * 103, paneY + 22)
        .setSize(branchWidth, paneY + 130 - (paneY + 22));
    } else {
      const cursorY = paneY + 24 + (this.targetCursorIndex - this.targetScrollTop) * ROW_STEP;
      this.targetCursor
        .setVisible(count > 0)
        .setPosition((globalScene.scaledCanvas.width - paneW) / 2 + 5, cursorY - 1)
        .setSize(paneW - 12, 15);
    }
    this.targetUpArrow.setVisible(this.targetScrollTop > 0);
    this.targetDownArrow.setVisible(this.targetScrollTop + VISIBLE_ROWS < count);
  }

  private applyEvolutionPage(index: number): void {
    const pageHeight = 90;
    const pageCount = this.evolutionPageCounts[index];
    this.evolutionPages[index] = Math.max(0, Math.min(this.evolutionPages[index], pageCount - 1));
    this.evolutionTexts[index].y = 47 - this.evolutionPages[index] * pageHeight;
    this.evolutionPageLabels[index].setText(pageCount > 1 ? `${this.evolutionPages[index] + 1}/${pageCount}` : "");
  }

  /** Populate per-step option data that depends on earlier picks. */
  private prepareStepData(step: TargetStep): boolean {
    switch (step) {
      case TargetStep.MOVE:
        return (this.party[this.pickedPartyIndex]?.moveset.length ?? 0) > 0;
      case TargetStep.ITEM: {
        const pokemon = this.party[this.pickedPartyIndex];
        this.heldItems =
          pokemon == null
            ? []
            : (globalScene.findModifiers(
                m => m.is("PokemonHeldItemModifier") && (m as PokemonHeldItemModifier).pokemonId === pokemon.id,
                true,
              ) as PokemonHeldItemModifier[]);
        return this.heldItems.length > 0;
      }
      case TargetStep.TYPE: {
        // All real elemental types (UNKNOWN and STELLAR are not choosable boon targets).
        this.typeOptions = [];
        for (let type = PokemonType.NORMAL; type <= PokemonType.FAIRY; type++) {
          this.typeOptions.push(type);
        }
        return this.typeOptions.length > 0;
      }
      default:
        return true;
    }
  }

  private confirmTarget(): void {
    const offer = this.currentOffer();
    if (offer == null) {
      return;
    }
    const definition = this.definitionOf(offer);
    const i = this.targetCursorIndex;

    switch (this.step) {
      case TargetStep.PARTY: {
        if (i < 0 || i >= this.party.length) {
          return;
        }
        this.pickedPartyIndex = i;
        const kind = definition?.targetKind;
        if (kind === "move") {
          if (this.prepareStepData(TargetStep.MOVE)) {
            this.openStep(TargetStep.MOVE);
          }
          return;
        }
        if (kind === "item-stack") {
          if (this.prepareStepData(TargetStep.ITEM)) {
            this.openStep(TargetStep.ITEM);
          }
          return;
        }
        if (kind === "pokemon-type") {
          if (this.prepareStepData(TargetStep.TYPE)) {
            this.openStep(TargetStep.TYPE);
          }
          return;
        }
        if (kind === "pokemon-pair" || kind === "slots") {
          if (this.party.length < 2) {
            return; // a pair needs two distinct members
          }
          this.openStep(TargetStep.PARTY_SECOND);
          return;
        }
        if (definition?.id === "pressure-valve") {
          this.requestPressureValve(offer, i);
          return;
        }
        // slot / pokemon commit with the single pick.
        const pokemon = this.party[i];
        this.commitOffer(offer, {
          pokemonIds: [pokemon.id],
          partySlots: [i],
        });
        return;
      }
      case TargetStep.PARTY_SECOND: {
        if (i < 0 || i >= this.party.length || i === this.pickedPartyIndex) {
          return;
        }
        const first = this.party[this.pickedPartyIndex];
        const second = this.party[i];
        this.commitOffer(offer, {
          pokemonIds: [first.id, second.id],
          partySlots: [this.pickedPartyIndex, i],
        });
        return;
      }
      case TargetStep.MOVE: {
        const pokemon = this.party[this.pickedPartyIndex];
        const move = pokemon?.moveset[i];
        if (pokemon == null || move == null) {
          return;
        }
        this.commitOffer(offer, {
          pokemonIds: [pokemon.id],
          partySlots: [this.pickedPartyIndex],
          moveIds: [move.moveId],
        });
        return;
      }
      case TargetStep.ITEM: {
        const pokemon = this.party[this.pickedPartyIndex];
        const item = this.heldItems[i];
        if (pokemon == null || item == null) {
          return;
        }
        this.commitOffer(offer, {
          pokemonIds: [pokemon.id],
          partySlots: [this.pickedPartyIndex],
          itemTypeIds: [item.type.id],
        });
        return;
      }
      case TargetStep.TYPE: {
        const type = this.typeOptions[i];
        if (type == null) {
          return;
        }
        if (definition?.targetKind === "pokemon-type") {
          if (definition.scope.toLowerCase().startsWith("team")) {
            this.commitOffer(offer, { pokemonType: type });
            return;
          }
          const pokemon = this.party[this.pickedPartyIndex];
          if (pokemon == null) {
            return;
          }
          this.commitOffer(offer, {
            pokemonIds: [pokemon.id],
            partySlots: [this.pickedPartyIndex],
            pokemonType: type,
          });
        } else {
          // enemy-type: type only.
          this.commitOffer(offer, { pokemonType: type });
        }
        return;
      }
      case TargetStep.EVOLVE: {
        const branch = definition?.evolutions[i];
        if (branch == null) {
          return;
        }
        this.commitOffer(offer, {}, branch.id);
        return;
      }
      case TargetStep.REPLACE: {
        const instance = this.replaceCandidates[i];
        if (instance == null || definition == null) {
          return;
        }
        this.replaceInstanceId = instance.instanceId;
        this.beginDefinitionTargeting(offer, definition);
        return;
      }
      default:
        return;
    }
  }

  private requestPressureValve(offer: MoodyBoonOffer, partyIndex: number): void {
    const pokemon = this.party[partyIndex];
    if (pokemon == null || this.operationPending) {
      return;
    }
    this.operationPending = true;
    void globalScene.ui
      .requestMoodyPressureValve(
        buildPressureValveOperation({
          healing: "Heal 6% maximum HP for each excess stat stage.",
          barrier: "Gain an 8% maximum-HP barrier for each excess stat stage.",
          pp: "Restore 1 PP to the most depleted move for each excess stat stage.",
        }),
      )
      .then(result => {
        this.operationPending = false;
        const target =
          result.action === "confirm" ? buildPressureValveBoonTarget(pokemon.id, partyIndex, result.selectedIds) : null;
        if (target == null) {
          this.getUi().playError();
          return;
        }
        this.commitOffer(offer, target);
      })
      .catch(() => {
        this.operationPending = false;
        this.getUi().playError();
      });
  }

  // ---------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------

  private commitOffer(
    offer: MoodyBoonOffer,
    target: MoodyBoonTarget,
    evolutionId?: string,
    replaceInstanceId?: string,
  ): void {
    if (this.committed) {
      return; // exactly-once: a second confirm path can never re-fire onComplete
    }
    try {
      commitMoodyBoonOffer(offer, this.waveIndex, target, evolutionId, replaceInstanceId ?? this.replaceInstanceId);
    } catch {
      // Invalid pick (e.g. a race where the draft already moved on): keep the screen
      // alive so the player can pick again instead of softlocking a mandatory reward.
      this.closeTargetLayer();
      return;
    }
    this.committed = true;
    const onComplete = this.onComplete;
    this.onComplete = null;
    this.getUi().playSelect();
    // Revert to the previous mode (clears this handler via the mode chain), then
    // fire the completion callback exactly once.
    const finish = () => onComplete?.();
    this.getUi().revertMode().then(finish, finish);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  processInput(button: Button): boolean {
    if (!this.active || this.committed || this.operationPending) {
      return false;
    }

    if (this.step === TargetStep.CARDS) {
      switch (button) {
        case Button.LEFT:
          if (this.setCursor(this.cursor === 0 ? 2 : this.cursor - 1)) {
            this.getUi().playSelect();
            this.moveCardCursor();
            return true;
          }
          return false;
        case Button.RIGHT:
          if (this.setCursor(this.cursor === 2 ? 0 : this.cursor + 1)) {
            this.getUi().playSelect();
            this.moveCardCursor();
            return true;
          }
          return false;
        case Button.UP:
          if (this.cardPages[this.cursor] > 0) {
            this.cardPages[this.cursor]--;
            this.applyCardPage(this.cursor);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.DOWN:
          if (this.cardPages[this.cursor] < this.cardPageCounts[this.cursor] - 1) {
            this.cardPages[this.cursor]++;
            this.applyCardPage(this.cursor);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.ACTION:
        case Button.SUBMIT:
          this.confirmCard();
          return true;
        case Button.CANCEL:
          // A mandatory draft cannot be dismissed.
          return false;
        default:
          return false;
      }
    }

    // Targeting layers.
    const count = this.currentTargetCount();
    if (this.step === TargetStep.EVOLVE) {
      switch (button) {
        case Button.LEFT:
        case Button.RIGHT:
          this.targetCursorIndex = this.targetCursorIndex === 0 ? 1 : 0;
          this.refreshTargetList();
          this.getUi().playSelect();
          return true;
        case Button.UP:
          if (this.evolutionPages[this.targetCursorIndex] > 0) {
            this.evolutionPages[this.targetCursorIndex]--;
            this.applyEvolutionPage(this.targetCursorIndex);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.DOWN:
          if (this.evolutionPages[this.targetCursorIndex] < this.evolutionPageCounts[this.targetCursorIndex] - 1) {
            this.evolutionPages[this.targetCursorIndex]++;
            this.applyEvolutionPage(this.targetCursorIndex);
            this.getUi().playSelect();
            return true;
          }
          return false;
        case Button.ACTION:
        case Button.SUBMIT:
          this.confirmTarget();
          return true;
        case Button.CANCEL:
          return this.backStep();
        default:
          return false;
      }
    }
    switch (button) {
      case Button.UP:
        if (count > 0 && this.targetCursorIndex > 0) {
          this.targetCursorIndex--;
          this.refreshTargetList();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.DOWN:
        if (count > 0 && this.targetCursorIndex < count - 1) {
          this.targetCursorIndex++;
          this.refreshTargetList();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.LEFT:
        if (count > 0) {
          this.targetCursorIndex = Math.max(0, this.targetCursorIndex - VISIBLE_ROWS);
          this.refreshTargetList();
          this.getUi().playSelect();
          return true;
        }
        return false;
      case Button.RIGHT:
        if (count > 0) {
          this.targetCursorIndex = Math.min(count - 1, this.targetCursorIndex + VISIBLE_ROWS);
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
        return this.backStep();
      default:
        return false;
    }
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCardCursor();
    return changed;
  }

  private moveCardCursor(): void {
    if (this.step !== TargetStep.CARDS || this.cardCursor == null) {
      return;
    }
    this.cardCursor.setVisible(true).setPosition(CARD_X[this.cursor] - 2, CARD_Y - 2);
    // Dim unfocused cards slightly; the focused card keeps full alpha.
    for (let i = 0; i < 3; i++) {
      this.cardNames[i].setAlpha(i === this.cursor ? 1 : 0.7);
      this.cardDescs[i].setAlpha(i === this.cursor ? 1 : 0.7);
    }
  }

  override clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cardCursor?.setVisible(false);
    this.targetCursor?.setVisible(false);
    this.getUi().hideTooltip();
  }
}
