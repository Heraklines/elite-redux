/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Abyss "The Bargain" - the dedicated full-screen DEAL screen.
//
// An ominous, shop-like (but not a shop) interface shown in the Abyss every-10-
// waves slot: a dark void, the animated Giratina Origin battle sprite on the
// left with a small PMD talking-head portrait inset over it, his spoken line in
// a bottom dialogue box, and the list of bargains in a framed panel on the
// right. A standalone "Check Team" button sits between that panel and the
// dialogue box (reachable by pressing down past Leave, like the reward shop).
//
// The screen is the persistent "stage": when a bargain is picked, Giratina's
// offer line plays HERE (bg + portrait stay, the choice list hides) and only
// once the player confirms does it hand off to the party menu. Backing out of
// the offer (or, via TheBargainPhase, the party menu) returns to the choices.
//
// Modeled on BiomeShop/Colosseum (a full-screen UiHandler container the UI shows
// on top of the field; container sits at y = -h so child (0,0) is the screen
// top-left). Pure presentation + cursor + select/confirm callbacks;
// TheBargainPhase owns all the deal logic.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Confirm the bargain at `sinIndex` (after its offer line is acknowledged). */
export type ErBargainConfirmCallback = (sinIndex: number) => void;

/** Giratina Origin forme index (0 = Altered, 1 = Origin) for the battle sprite. */
const GIRATINA_ORIGIN_FORM = 1;

export class ErBargainUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  /** The real animated Giratina Origin battle sprite (main left visual). */
  private giratina: Phaser.GameObjects.Sprite;
  /** Small PMD talking-head portrait inset over the sprite. */
  private portrait: Phaser.GameObjects.Sprite;
  private portraitWindow: Phaser.GameObjects.NineSlice;
  private titleText: Phaser.GameObjects.Text;
  private dialogueWindow: Phaser.GameObjects.NineSlice;
  private dialogueText: Phaser.GameObjects.Text;
  private descText: Phaser.GameObjects.Text;
  private descWindow: Phaser.GameObjects.NineSlice;
  private optionsWindow: Phaser.GameObjects.NineSlice;
  /** Standalone "Check Team" button below the panel, above the dialogue box. */
  private checkTeamWindow: Phaser.GameObjects.NineSlice;
  private checkTeamText: Phaser.GameObjects.Text;
  private rows: Phaser.GameObjects.Text[] = [];
  private cursorObj: Phaser.GameObjects.Rectangle;

  private labels: string[] = [];
  private descs: string[] = [];
  /** Giratina's offer line per Sin (parallel to the Sin rows, before Leave). */
  private offers: string[] = [];
  /** The opening line, restored when backing out of an offer. */
  private greeting = "";
  private onConfirm: ErBargainConfirmCallback | null = null;
  private onLeave: (() => void) | null = null;
  /** Optional "Check Team" action; when set, a button is appended after Leave. */
  private onCheckTeam: (() => void) | null = null;
  /** Wall-clock time (ms) the screen opened; input is swallowed briefly after. */
  private openedAt = 0;
  /** While true, an offer line is showing (choices hidden) awaiting confirm/back. */
  private speaking = false;
  /** The Sin index whose offer is currently showing. */
  private speakingIndex = 0;
  /** Wall-clock time (ms) the current offer line began showing. */
  private spokeAt = 0;

  // Layout (logical 320x180 screen; container at y=-h so child (0,0) == top-left).
  private static readonly OPT_X = 150;
  private static readonly OPT_W = 162;
  private static readonly OPT_Y = 16;
  /** Options panel height - kept short so the Check Team button fits beneath it. */
  private static readonly PANEL_H = 94;
  private static readonly ROW_Y0 = 29;
  private static readonly ROW_STEP = 15;
  /** The focused option's effect sub-box, inside the panel near its bottom. */
  private static readonly DESC_Y = 82;
  private static readonly DESC_H = 24;
  /** Standalone Check Team button geometry (between the panel and dialogue box). */
  private static readonly CT_X = 166;
  private static readonly CT_Y = 114;
  private static readonly CT_W = 130;
  private static readonly CT_H = 14;
  /** Foreboding violet tint applied to every framed window (Giratina's gloom). */
  private static readonly FRAME_TINT = 0x8050b0;

  constructor() {
    super(UiMode.ER_BARGAIN);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    // Full-screen handler containers sit at y = -h so a child at logical (0,0)
    // lands at the screen's top-left (the egg-gacha / biome-shop / colosseum
    // convention). At y = 0 everything renders one full height BELOW the viewport
    // - invisible - which is why this screen never appeared (#550).
    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Opaque void backdrop.
    this.bg = globalScene.add.rectangle(0, 0, w, h, 0x07030e, 1).setOrigin(0);
    this.container.add(this.bg);

    // The actual animated Giratina Origin battle sprite, left side - the main
    // visual. Loaded on demand in show(); hidden until it lands (the small
    // portrait below stands in meanwhile).
    this.giratina = globalScene.add.sprite(82, 88, "er_bargain_giratina");
    this.giratina.setOrigin(0.5, 0.5);
    this.giratina.setVisible(false);
    this.container.add(this.giratina);

    // Small PMD talking-head portrait in a framed box, bottom-left, sitting just
    // above the dialogue box (the "speaker" headshot).
    this.portraitWindow = addWindow(6, h - 98, 52, 52);
    this.portraitWindow.setTint(ErBargainUiHandler.FRAME_TINT);
    this.container.add(this.portraitWindow);
    this.portrait = globalScene.add.sprite(32, h - 72, "er_bargain_giratina");
    this.portrait.setOrigin(0.5, 0.5).setScale(0.28); // ~45px, fits the box
    this.container.add(this.portrait);

    this.titleText = addTextObject(w / 2, 3, "GIRATINA'S BARGAIN", TextStyle.WINDOW, { fontSize: "70px" });
    this.titleText.setOrigin(0.5, 0).setColor("#c8a8f0");
    this.container.add(this.titleText);

    // Framed panel for the bargain list (right side).
    this.optionsWindow = addWindow(
      ErBargainUiHandler.OPT_X,
      ErBargainUiHandler.OPT_Y,
      ErBargainUiHandler.OPT_W,
      ErBargainUiHandler.PANEL_H,
    );
    this.optionsWindow.setTint(ErBargainUiHandler.FRAME_TINT);
    this.container.add(this.optionsWindow);

    // The focused bargain's cost -> payoff, in its OWN framed sub-box at the
    // bottom of the panel (a box within the box), with room to breathe.
    this.descWindow = addWindow(
      ErBargainUiHandler.OPT_X + 6,
      ErBargainUiHandler.DESC_Y,
      ErBargainUiHandler.OPT_W - 12,
      ErBargainUiHandler.DESC_H,
    );
    this.descWindow.setTint(ErBargainUiHandler.FRAME_TINT);
    this.container.add(this.descWindow);
    this.descText = addTextObject(
      ErBargainUiHandler.OPT_X + ErBargainUiHandler.OPT_W / 2,
      ErBargainUiHandler.DESC_Y + 4,
      "",
      TextStyle.PARTY,
      {
        fontSize: "30px",
        align: "center",
        wordWrap: { width: (ErBargainUiHandler.OPT_W - 26) * 6 },
      },
    );
    this.descText.setOrigin(0.5, 0);
    this.container.add(this.descText);

    // Standalone "Check Team" button: its own framed box below the options panel
    // and just above the dialogue box. The player drops onto it by pressing down
    // past Leave; pressing up returns to the bargain list. Hidden until show()
    // is given an onCheckTeam callback.
    this.checkTeamWindow = addWindow(
      ErBargainUiHandler.CT_X,
      ErBargainUiHandler.CT_Y,
      ErBargainUiHandler.CT_W,
      ErBargainUiHandler.CT_H,
    );
    this.checkTeamWindow.setTint(ErBargainUiHandler.FRAME_TINT);
    this.checkTeamWindow.setVisible(false);
    this.container.add(this.checkTeamWindow);
    this.checkTeamText = addTextObject(
      ErBargainUiHandler.CT_X + ErBargainUiHandler.CT_W / 2,
      ErBargainUiHandler.CT_Y + ErBargainUiHandler.CT_H / 2,
      "Check Team",
      TextStyle.WINDOW,
      { fontSize: "52px" },
    );
    this.checkTeamText.setOrigin(0.5, 0.5);
    this.checkTeamText.setVisible(false);
    this.container.add(this.checkTeamText);

    // Cursor sized to sit INSIDE the options panel (never overflows the frame);
    // resized to the Check Team button when focus drops onto it.
    this.cursorObj = globalScene.add.rectangle(
      0,
      0,
      ErBargainUiHandler.OPT_W - 16,
      ErBargainUiHandler.ROW_STEP,
      0xffffff,
      0,
    );
    this.cursorObj.setStrokeStyle(1, 0xc060f8);
    this.cursorObj.setOrigin(0, 0.5);
    this.cursorObj.setVisible(false);
    this.container.add(this.cursorObj);

    // Giratina's spoken line, in a fitted dialogue box across the bottom.
    this.dialogueWindow = addWindow(4, h - 46, w - 8, 42);
    this.dialogueWindow.setTint(ErBargainUiHandler.FRAME_TINT);
    this.container.add(this.dialogueWindow);
    this.dialogueText = addTextObject(13, h - 40, "", TextStyle.WINDOW, {
      fontSize: "40px",
      wordWrap: { width: (w - 26) * 6 },
    });
    this.dialogueText.setOrigin(0, 0);
    this.container.add(this.dialogueText);
  }

  show(args: any[]): boolean {
    if (
      !(
        args.length >= 6
        && Array.isArray(args[0])
        && Array.isArray(args[3])
        && typeof args[4] === "function"
        && typeof args[5] === "function"
      )
    ) {
      return false;
    }
    this.labels = args[0] as string[];
    this.descs = args[1] as string[];
    this.greeting = (args[2] as string) ?? "";
    this.offers = args[3] as string[];
    this.onConfirm = args[4] as ErBargainConfirmCallback;
    this.onLeave = args[5] as () => void;
    this.onCheckTeam = typeof args[6] === "function" ? (args[6] as () => void) : null;

    this.speaking = false;
    this.dialogueText.setText(this.greeting);

    // Always reveal the big left visual immediately using the always-preloaded
    // portrait texture as a stand-in, then upgrade to the real animated battle
    // sprite when/if it lands (loadGiratina below). Without this, a failed/slow
    // battle-sprite load (e.g. the giratina_origin atlas not reaching the client
    // on staging) leaves the entire left side empty - the reported #550 follow-up
    // where only the small portrait showed. The stand-in guarantees a Giratina is
    // always on screen; the upgrade is seamless (synchronous when cached).
    this.giratina.setTexture("er_bargain_giratina");
    this.fitGiratina();

    // Restore the choosing UI. show() is the canonical re-entry (after Check Team
    // or backing out of the party); a prior speak() may have hidden the panel +
    // sub-box, and they would otherwise stay hidden on re-open.
    this.optionsWindow.setVisible(true);
    this.descWindow.setVisible(true);
    this.descText.setVisible(true);

    const showCheck = this.onCheckTeam !== null;
    this.checkTeamWindow.setVisible(showCheck);
    this.checkTeamText.setVisible(showCheck);

    this.loadGiratina();
    this.buildRows();
    this.cursor = 0;
    this.moveCursorTo(0);

    this.openedAt = performance.now();
    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  /**
   * Load + show the real animated Giratina Origin battle sprite behind the
   * portrait. If the sprite is already cached (re-entry from Check Team / the
   * party), show it immediately so it doesn't flicker out and reload. Otherwise
   * load on demand (the small PMD portrait stands in until it lands). No-ops if
   * the screen has since closed or the sprite failed.
   */
  private loadGiratina(): void {
    const species = getPokemonSpecies(SpeciesId.GIRATINA);
    const key = species.getSpriteKey(false, GIRATINA_ORIGIN_FORM, false, 0);
    if (globalScene.textures.exists(key)) {
      this.showGiratinaSprite(key);
      return;
    }
    species
      // female=false, Origin forme, non-shiny, variant 0, startLoad, front, spriteOnly
      .loadAssets(false, GIRATINA_ORIGIN_FORM, false, 0, true, false, true)
      .then(() => {
        if (!this.active || !globalScene.textures.exists(key)) {
          return;
        }
        this.showGiratinaSprite(key);
      })
      .catch(() => {});
  }

  /** Apply the Giratina texture/anim, then fit + reveal it. */
  private showGiratinaSprite(key: string): void {
    this.giratina.setTexture(key);
    if (globalScene.anims.exists(key)) {
      this.giratina.play(key);
    }
    this.fitGiratina();
  }

  /** Scale whatever texture is currently on the Giratina sprite to the left visual area and reveal it. */
  private fitGiratina(): void {
    this.giratina.setScale(1);
    const sh = this.giratina.height || 1;
    const maxH = 122;
    this.giratina.setScale(sh > maxH ? maxH / sh : 1);
    this.giratina.setVisible(true);
  }

  private buildRows(): void {
    for (const row of this.rows) {
      row.destroy();
    }
    this.rows = [];
    this.labels.forEach((label, i) => {
      const row = addTextObject(
        ErBargainUiHandler.OPT_X + 12,
        ErBargainUiHandler.ROW_Y0 + i * ErBargainUiHandler.ROW_STEP,
        label,
        TextStyle.WINDOW,
        { fontSize: "56px" },
      );
      row.setOrigin(0, 0.5);
      this.container.add(row);
      this.rows.push(row);
    });
  }

  /** Total navigable items: the option rows plus the Check Team button (if any). */
  private navCount(): number {
    return this.rows.length + (this.onCheckTeam ? 1 : 0);
  }

  private moveCursorTo(index: number): void {
    const total = this.navCount();
    if (total === 0) {
      this.cursorObj.setVisible(false);
      return;
    }
    const i = Math.max(0, Math.min(index, total - 1));

    // The Check Team button (the virtual last item) - move the cursor onto it.
    if (this.onCheckTeam !== null && i === this.rows.length) {
      this.cursorObj.setSize(ErBargainUiHandler.CT_W - 6, ErBargainUiHandler.CT_H - 2);
      this.cursorObj.setPosition(ErBargainUiHandler.CT_X + 3, ErBargainUiHandler.CT_Y + ErBargainUiHandler.CT_H / 2);
      this.cursorObj.setVisible(true);
      this.descText.setText("");
      this.rows.forEach(row => row.setAlpha(0.55));
      this.checkTeamText.setAlpha(1);
      return;
    }

    // A normal option row.
    const y = ErBargainUiHandler.ROW_Y0 + i * ErBargainUiHandler.ROW_STEP;
    this.cursorObj.setSize(ErBargainUiHandler.OPT_W - 16, ErBargainUiHandler.ROW_STEP);
    this.cursorObj.setPosition(ErBargainUiHandler.OPT_X + 7, y);
    this.cursorObj.setVisible(true);
    this.descText.setText(this.descs[i] ?? "");
    this.rows.forEach((row, r) => row.setAlpha(r === i ? 1 : 0.55));
    this.checkTeamText.setAlpha(0.55);
  }

  override setCursor(cursor: number): boolean {
    const changed = super.setCursor(cursor);
    this.moveCursorTo(this.cursor);
    return changed;
  }

  /**
   * Present `line` as Giratina's spoken offer on THIS screen (bg + portrait
   * stay), hiding the choice list. ACTION confirms the Sin; CANCEL returns to
   * the choices. Driven from activate() when a Sin row is chosen.
   */
  private speak(line: string, sinIndex: number): void {
    this.speaking = true;
    this.speakingIndex = sinIndex;
    this.spokeAt = performance.now();
    this.dialogueText.setText(line);
    // Hide the choice UI; the Giratina sprite, portrait and backdrop remain.
    this.optionsWindow.setVisible(false);
    this.descWindow.setVisible(false);
    this.descText.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const row of this.rows) {
      row.setVisible(false);
    }
    this.checkTeamWindow.setVisible(false);
    this.checkTeamText.setVisible(false);
  }

  /** Return from a shown offer line back to the bargain choices (restore UI). */
  private resumeChoosing(): void {
    this.speaking = false;
    this.optionsWindow.setVisible(true);
    this.descWindow.setVisible(true);
    this.descText.setVisible(true);
    for (const row of this.rows) {
      row.setVisible(true);
    }
    const showCheck = this.onCheckTeam !== null;
    this.checkTeamWindow.setVisible(showCheck);
    this.checkTeamText.setVisible(showCheck);
    this.dialogueText.setText(this.greeting);
    this.moveCursorTo(this.cursor);
  }

  /** Fire the focused item: Check Team, Leave, or a Sin's offer (then confirm). */
  private activate(): void {
    if (this.navCount() === 0) {
      return;
    }
    // Check Team (the virtual last item).
    if (this.onCheckTeam !== null && this.cursor === this.rows.length) {
      this.onCheckTeam();
      return;
    }
    // The Leave row sits after the Sins (offers.length is the Sin count).
    if (this.cursor >= this.offers.length) {
      this.onLeave?.();
      return;
    }
    // A Sin: speak its offer here; the next ACTION confirms, CANCEL backs out.
    this.speak(this.offers[this.cursor] ?? "", this.cursor);
  }

  /** Input while an offer line is showing: ACTION confirms, CANCEL backs out. */
  private handleSpeakingInput(button: Button): boolean {
    if (performance.now() - this.spokeAt < 250) {
      return true;
    }
    if (button === Button.ACTION) {
      const idx = this.speakingIndex;
      this.speaking = false;
      this.onConfirm?.(idx);
    } else if (button === Button.CANCEL) {
      this.resumeChoosing();
    }
    return true;
  }

  processInput(button: Button): boolean {
    if (this.speaking) {
      return this.handleSpeakingInput(button);
    }
    // Swallow any input that arrives in the first moments after the screen opens.
    // Without this, a button press carried over from mashing through the post-
    // victory / reward messages instantly auto-selects the first bargain before
    // the player ever sees this screen. Real-time gated so it can never hang.
    if (performance.now() - this.openedAt < 600) {
      return true;
    }
    const count = this.navCount();
    let moved = false;
    switch (button) {
      case Button.ACTION:
        this.activate();
        return true;
      case Button.CANCEL:
        this.onLeave?.();
        return true;
      case Button.UP:
        if (this.cursor > 0) {
          moved = this.setCursor(this.cursor - 1);
        }
        break;
      case Button.DOWN:
        if (this.cursor < count - 1) {
          moved = this.setCursor(this.cursor + 1);
        }
        break;
    }
    if (moved) {
      globalScene.ui.playSelect();
    }
    return moved;
  }

  clear(): void {
    super.clear();
    this.giratina.stop();
    this.giratina.setVisible(false);
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    for (const row of this.rows) {
      row.destroy();
    }
    this.rows = [];
    this.labels = [];
    this.descs = [];
    this.offers = [];
    this.speaking = false;
    this.onConfirm = null;
    this.onLeave = null;
    this.onCheckTeam = null;
  }
}
