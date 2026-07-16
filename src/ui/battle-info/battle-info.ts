import { globalScene } from "#app/global-scene";
import { barSlotOffset } from "#data/battle-format";
import { isErBlackShiny } from "#data/elite-redux/er-black-shinies";
import { Gender, getGenderColor, getGenderSymbol } from "#data/gender";
import { getTypeRgb } from "#data/type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TextStyle } from "#enums/text-style";
import { UiTheme } from "#enums/ui-theme";
import type { Pokemon } from "#field/pokemon";
import { ErShinyLabNameFx } from "#sprites/er-shiny-lab-name-fx";
import { getErShinyLabNameStyleForPokemon, getErShinyLabSpriteFxLookForPokemon } from "#sprites/er-shiny-lab-sprite-fx";
import { getVariantTint } from "#sprites/variant";
import { addTextObject } from "#ui/text";
import { fixedInt, getLocalizedSpriteKey, getShinyDescriptor } from "#utils/common";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";

/**
 * Battle-info panels normally follow upstream's compact base-species label, but Showdown's
 * fielded form is part of the player's chosen competitive set. Keep that identity visible
 * there so a permanent Mega/Primal cannot look like the wrong set even when its sprite is
 * visually similar to the base form.
 */
function getBattleInfoDisplayName(pokemon: Pokemon): string {
  return pokemon.getNameToRender({ prependFormName: globalScene.gameMode.isShowdown });
}

/**
 * Parameters influencing the position of elements within the battle info container
 */
export type BattleInfoParamList = {
  /** X offset for the name text*/
  nameTextX: number;
  /** Y offset for the name text */
  nameTextY: number;
  /** X offset for the level container */
  levelContainerX: number;
  /** Y offset for the level container */
  levelContainerY: number;
  /** X offset for the hp bar */
  hpBarX: number;
  /** Y offset for the hp bar */
  hpBarY: number;
  /** Parameters for the stat box container */
  statBox: {
    /** The starting offset from the left of the label for the entries in the stat box */
    xOffset: number;
    /** The X padding between each number column */
    paddingX: number;
    /** The index of the stat entries at which paddingX is used instead of startingX */
    statOverflow: number;
  };
};

/**
 * Label + fill color for Elite Redux custom statuses, keyed by the status frame
 * name used in {@linkcode BattleInfo.updateStatusIcon}. These have no sprite in
 * the vanilla `statuses` atlas, so they render as a colored text badge instead.
 * Colors are picked to read at a glance and echo the effect (red bleed, icy
 * cyan frost, eerie purple fear) without clashing with the vanilla status pills.
 */
const ER_STATUS_BADGES: Record<string, { label: string; color: string }> = {
  bleed: { label: "BLEED", color: "#ff5555" },
  frostbite: { label: "FROST", color: "#8fe0ff" },
  fear: { label: "FEAR", color: "#c98bff" },
  commanded: { label: "CMND", color: "#ffd166" },
};

export abstract class BattleInfo extends Phaser.GameObjects.Container {
  public static readonly EXP_GAINS_DURATION_BASE = 1650;

  protected baseY: number;
  protected baseLvContainerX: number;

  protected player: boolean;
  protected mini: boolean;
  protected boss: boolean;
  protected bossSegments: number;
  protected offset: boolean;
  /** The triple+ base shift currently applied (so `applyTripleThin` stays idempotent). */
  private appliedTripleShiftX = 0;
  private appliedTripleShiftY = 0;
  /**
   * The slot-stacking [dx, dy] currently APPLIED to x/y. Tracked explicitly because the
   * un-apply must subtract what was actually added: recomputing it from (slotOffset,
   * capacity) breaks the moment capacity CHANGES between calls (triple stacking != double
   * stacking), leaving a residue on every format transition - the live "HP bar keeps
   * climbing each send-out after a single-format event battle" bug.
   */
  private appliedSlotDx = 0;
  private appliedSlotDy = 0;
  /** Which field SLOT this bar is stacked for (0 = anchor). Drives 3+-bar stacking. */
  protected slotOffset = 0;
  protected lastName: string | null;
  protected lastTeraType: PokemonType;
  protected lastStatus: StatusEffect;
  /** Last status-indicator frame shown (primary status name or an ER tag label). */
  protected lastStatusFrame: string | null = null;
  protected lastHp: number;
  protected lastMaxHp: number;
  protected lastHpFrame: string | null;
  protected lastExp: number;
  protected lastLevelExp: number;
  protected lastLevel: number;
  protected lastLevelCapped: boolean;
  protected lastStats: string;

  protected box: Phaser.GameObjects.Sprite;
  protected nameText: Phaser.GameObjects.Text;
  private nameFx?: ErShinyLabNameFx | undefined;
  protected genderText: Phaser.GameObjects.Text;
  protected teraIcon: Phaser.GameObjects.Sprite;
  protected shinyIcon: Phaser.GameObjects.Sprite;
  protected fusionShinyIcon: Phaser.GameObjects.Sprite;
  protected splicedIcon: Phaser.GameObjects.Sprite;
  protected statusIndicator: Phaser.GameObjects.Sprite;
  /**
   * Elite Redux custom statuses (bleed/frostbite/fear) have no frame in the
   * vanilla `statuses` atlas, so they're shown as a crisp colored text badge in
   * the same slot as the status sprite instead of a faint fallback frame.
   */
  protected erStatusText: Phaser.GameObjects.Text;
  protected levelContainer: Phaser.GameObjects.Container;
  protected hpLabel: Phaser.GameObjects.Image;
  protected hpBar: Phaser.GameObjects.Image;
  protected levelNumbersContainer: Phaser.GameObjects.Container;
  protected type1Icon: Phaser.GameObjects.Sprite;
  protected type2Icon: Phaser.GameObjects.Sprite;
  protected type3Icon: Phaser.GameObjects.Sprite;
  /**
   * ER N-type substrate: icons for a 4th+ type (some holders are sextuple-typed).
   * Created lazily so a mon with ≤3 types renders byte-identically to before.
   */
  protected extraTypeIcons: Phaser.GameObjects.Sprite[] = [];
  protected expBar: Phaser.GameObjects.Image;

  public expMaskRect: Phaser.GameObjects.Graphics;

  protected statsContainer: Phaser.GameObjects.Container;
  protected statsBox: Phaser.GameObjects.Sprite;
  protected statValuesContainer: Phaser.GameObjects.Container;
  protected statNumbers: Phaser.GameObjects.Sprite[];

  get statOrder(): Stat[] {
    return [];
  }

  /** Helper method used by the constructor to create the tera and shiny icons next to the name */
  private constructIcons() {
    const hitArea = new Phaser.Geom.Rectangle(0, 0, 12, 15);
    const hitCallback = Phaser.Geom.Rectangle.Contains;

    this.teraIcon = globalScene.add
      .sprite(0, 0, "icon_tera")
      .setName("icon_tera")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .setInteractive(hitArea, hitCallback)
      .setPositionRelative(this.nameText, 0, 2);

    this.shinyIcon = globalScene.add
      .sprite(0, 0, "shiny_star")
      .setName("icon_shiny")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .setInteractive(hitArea, hitCallback)
      .setPositionRelative(this.nameText, 0, 2);

    this.fusionShinyIcon = globalScene.add
      .sprite(0, 0, "shiny_star_2")
      .setName("icon_fusion_shiny")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .copyPosition(this.shinyIcon);

    this.splicedIcon = globalScene.add
      .sprite(0, 0, "icon_spliced")
      .setName("icon_spliced")
      .setVisible(false)
      .setOrigin(0)
      .setScale(0.5)
      .setInteractive(hitArea, hitCallback)
      .setPositionRelative(this.nameText, 0, 2);

    this.add([this.teraIcon, this.shinyIcon, this.fusionShinyIcon, this.splicedIcon]);
  }

  /**
   * Submethod of the constructor that creates and adds the stats container to the battle info
   */
  protected constructStatContainer({ xOffset, paddingX, statOverflow }: BattleInfoParamList["statBox"]): void {
    this.statsContainer = globalScene.add.container(0, 0).setName("container_stats").setAlpha(0);
    this.add(this.statsContainer);

    this.statsBox = globalScene.add
      .sprite(0, 0, `${this.getTextureName()}_stats`)
      .setName("box_stats")
      .setOrigin(1, 0.5);
    this.statsContainer.add(this.statsBox);

    const statLabels: Phaser.GameObjects.Sprite[] = [];
    this.statNumbers = [];

    this.statValuesContainer = globalScene.add.container();
    this.statsContainer.add(this.statValuesContainer);

    const startingX = -this.statsBox.width + xOffset;

    // this gives us a different starting location from the left of the label and padding between stats for a player vs enemy
    // since the player won't have HP to show, it doesn't need to change from the current version

    for (const [i, s] of this.statOrder.entries()) {
      const isHp = s === Stat.HP;
      // we do a check for i > statOverflow to see when the stat labels go onto the next column
      // For enemies, we have HP (i=0) by itself then a new column, so we check for i > 0
      // For players, we don't have HP, so we start with i = 0 and i = 1 for our first column, and so need to check for i > 1
      const statX =
        i > statOverflow
          ? this.statNumbers[Math.max(i - 2, 0)].x + this.statNumbers[Math.max(i - 2, 0)].width + paddingX
          : startingX; // we have the Math.max(i - 2, 0) in there so for i===1 to not return a negative number; since this is now based on anything >0 instead of >1, we need to allow for i-2 < 0

      let statY = -this.statsBox.height / 2 + 4; // this is the baseline for the y-axis
      if (isHp || s === Stat.SPD) {
        statY += 5;
      } else if (this.player === !!(i % 2)) {
        // we compare i % 2 against this.player to tell us where to place the label
        // because this.battleStatOrder for enemies has HP, this.battleStatOrder[1]=ATK, but for players
        // this.battleStatOrder[0]=ATK, so this comparing i % 2 to this.player fixes this issue for us
        statY += 10;
      }

      const statLabel = globalScene.add
        .sprite(statX, statY, getLocalizedSpriteKey("pbinfo_stat"), Stat[s])
        .setName("icon_stat_label_" + i.toString())
        .setOrigin(0);
      statLabels.push(statLabel);
      this.statValuesContainer.add(statLabel);

      const statNumber = globalScene.add
        .sprite(statX + statLabel.width, statY, "pbinfo_stat_numbers", isHp ? "empty" : "3")
        .setName("icon_stat_number_" + i.toString())
        .setOrigin(0);
      this.statNumbers.push(statNumber);
      this.statValuesContainer.add(statNumber);

      if (isHp) {
        statLabel.setVisible(false);
        statNumber.setVisible(false);
      }
    }
  }

  /**
   * Submethod of the constructor that creates and adds the pokemon type icons to the battle info
   */
  protected abstract constructTypeIcons(): void;

  /**
   * @param x - The x position of the battle info container
   * @param y - The y position of the battle info container
   * @param player - Whether this battle info belongs to a player or an enemy
   * @param posParams - The parameters influencing the position of elements within the battle info container
   */
  constructor(x: number, y: number, player: boolean, posParams: BattleInfoParamList) {
    super(globalScene, x, y);
    this.baseY = y;
    this.player = player;
    this.mini = !player;
    this.boss = false;
    this.offset = false;
    this.lastName = null;
    this.lastTeraType = PokemonType.UNKNOWN;
    this.lastStatus = StatusEffect.NONE;
    this.lastHp = -1;
    this.lastMaxHp = -1;
    this.lastHpFrame = null;
    this.lastExp = -1;
    this.lastLevelExp = -1;
    this.lastLevel = -1;
    this.baseLvContainerX = posParams.levelContainerX;

    // Initially invisible and shown via Pokemon.showInfo
    this.setVisible(false);

    this.box = globalScene.add.sprite(0, 0, this.getTextureName()).setName("box").setOrigin(1, 0.5);
    this.add(this.box);

    this.nameText = addTextObject(posParams.nameTextX, posParams.nameTextY, "", TextStyle.BATTLE_INFO)
      .setName("text_name")
      .setOrigin(0);
    this.add(this.nameText);

    this.genderText = addTextObject(0, 0, "", TextStyle.BATTLE_INFO)
      .setName("text_gender")
      .setOrigin(0)
      .setPositionRelative(this.nameText, 0, 2);
    this.add(this.genderText);

    this.constructIcons();

    this.statusIndicator = globalScene.add
      .sprite(0, 0, getLocalizedSpriteKey("statuses"))
      .setName("icon_status")
      .setVisible(false)
      .setOrigin(0)
      .setPositionRelative(this.nameText, 0, 11.5);
    this.add(this.statusIndicator);

    // ER custom-status badge (bleed/frostbite/fear). Shares the status slot;
    // shown only when an ER status tag is active (see updateStatusIcon).
    this.erStatusText = addTextObject(0, 0, "", TextStyle.BATTLE_INFO)
      .setName("text_er_status")
      .setOrigin(0)
      .setVisible(false);
    this.erStatusText.setFontSize("44px"); // a touch smaller than the name, reads as a compact badge
    this.add(this.erStatusText);

    this.levelContainer = globalScene.add
      .container(posParams.levelContainerX, posParams.levelContainerY)
      .setName("container_level");
    this.add(this.levelContainer);

    const levelOverlay = globalScene.add.image(5.5, 0, getLocalizedSpriteKey("overlay_lv")).setOrigin(1, 0.5);
    this.levelContainer.add(levelOverlay);

    this.hpBar = globalScene.add.image(posParams.hpBarX, posParams.hpBarY, "overlay_hp").setName("hp_bar").setOrigin(0);
    this.add(this.hpBar);

    this.hpLabel = globalScene.add
      .image(posParams.hpBarX - 1, posParams.hpBarY - 3, getLocalizedSpriteKey("overlay_hp_label"))
      .setOrigin(1, 0);
    this.add(this.hpLabel);

    this.levelNumbersContainer = globalScene.add
      .container(9.5, globalScene.uiTheme === UiTheme.LEGACY ? 0 : -0.5)
      .setName("container_level");
    this.levelContainer.add(this.levelNumbersContainer);

    this.constructStatContainer(posParams.statBox);

    this.constructTypeIcons();
  }

  getStatsValueContainer(): Phaser.GameObjects.Container {
    return this.statValuesContainer;
  }

  //#region Initialization methods

  initSplicedIcon(pokemon: Pokemon, baseWidth: number) {
    this.splicedIcon.setPositionRelative(
      this.nameText,
      baseWidth + this.genderText.displayWidth + 1 + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0),
      2.5,
    );
    this.splicedIcon.setVisible(pokemon.isFusion(true));
    this.splicedIcon
      .on("pointerover", () =>
        globalScene.ui.showTooltip(
          "",
          `${pokemon.species.getName(pokemon.formIndex)}/${pokemon.fusionSpecies?.getName(pokemon.fusionFormIndex)}`,
        ),
      )
      .on("pointerout", () => globalScene.ui.hideTooltip());
  }

  /**
   * Called by {@linkcode initInfo} to initialize the shiny icon
   * @param pokemon - The pokemon object attached to this battle info
   * @param baseXOffset - The x offset to use for the shiny icon
   * @param doubleShiny - Whether the pokemon is shiny and its fusion species is also shiny
   */
  protected initShinyIcon(pokemon: Pokemon, xOffset: number, doubleShiny: boolean) {
    const baseVariant = doubleShiny ? pokemon.variant : pokemon.getVariant(true);

    this.shinyIcon.setPositionRelative(
      this.nameText,
      xOffset
        + this.genderText.displayWidth
        + 1
        + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0)
        + (this.splicedIcon.visible ? this.splicedIcon.displayWidth + 1 : 0),
      2.5,
    );
    this.shinyIcon
      .setTexture(`shiny_star${doubleShiny ? "_1" : ""}`)
      .setVisible(pokemon.isShiny())
      // ER Black Shinies (#349): the t4 sparkle is BLACK, not blue/red/gold.
      .setTint(isErBlackShiny(pokemon) ? 0x0a0a0a : getVariantTint(baseVariant));

    this.shinyIcon
      .on("pointerover", () => globalScene.ui.showTooltip("", i18next.t("common:shinyOnHover") + shinyDescriptor))
      .on("pointerout", () => globalScene.ui.hideTooltip());

    if (!this.shinyIcon.visible) {
      return;
    }

    let shinyDescriptor = "";
    if (doubleShiny || baseVariant) {
      // ER Black Shinies (#349): the t4 tier reads "Black", not "Epic".
      shinyDescriptor = " (" + (isErBlackShiny(pokemon) ? "Black" : getShinyDescriptor(baseVariant));
      if (doubleShiny) {
        shinyDescriptor += "/" + getShinyDescriptor(pokemon.fusionVariant);
      }
      shinyDescriptor += ")";
    }
  }

  initInfo(pokemon: Pokemon) {
    this.updateNameText(pokemon);
    this.updateShinyLabNameplate(pokemon);
    const nameTextWidth = this.nameText.displayWidth;

    this.name = getBattleInfoDisplayName(pokemon);
    this.box.name = getBattleInfoDisplayName(pokemon);

    this.genderText
      .setText(getGenderSymbol(pokemon.gender))
      .setColor(getGenderColor(pokemon.gender))
      .setPositionRelative(this.nameText, nameTextWidth, 0);

    this.lastTeraType = pokemon.getTeraType();

    this.teraIcon
      .setVisible(pokemon.isTerastallized)
      .on("pointerover", () => {
        if (pokemon.isTerastallized) {
          globalScene.ui.showTooltip(
            "",
            i18next.t("fightUiHandler:teraHover", {
              type: i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[this.lastTeraType])}`),
            }),
          );
        }
      })
      .on("pointerout", () => globalScene.ui.hideTooltip())
      .setPositionRelative(this.nameText, nameTextWidth + this.genderText.displayWidth + 1, 2);

    const isFusion = pokemon.isFusion(true);
    this.initSplicedIcon(pokemon, nameTextWidth);

    const doubleShiny = isFusion && pokemon.shiny && pokemon.fusionShiny;
    this.initShinyIcon(pokemon, nameTextWidth, doubleShiny);

    this.fusionShinyIcon.setVisible(doubleShiny).copyPosition(this.shinyIcon);
    if (isFusion) {
      this.fusionShinyIcon.setTint(getVariantTint(pokemon.fusionVariant));
    }

    this.hpBar.setScale(pokemon.getHpRatio(true), 1);
    this.lastHpFrame = this.hpBar.scaleX > 0.5 ? "high" : this.hpBar.scaleX > 0.25 ? "medium" : "low";
    this.hpBar.setFrame(this.lastHpFrame);
    this.lastHp = pokemon.hp;
    this.lastMaxHp = pokemon.getMaxHp();

    this.setLevel(pokemon.level);
    this.lastLevel = pokemon.level;

    this.shinyIcon.setVisible(pokemon.isShiny());

    this.setTypes(pokemon.getTypes(true, false, undefined, true));

    const stats = this.statOrder.map(() => 0);

    this.lastStats = stats.join("");
    this.updateStats(stats);
  }
  //#endregion

  /**
   * Return the texture name of the battle info box
   */
  abstract getTextureName(): string;

  setMini(_mini: boolean): void {}

  toggleStats(visible: boolean): void {
    globalScene.tweens.add({
      targets: this.statsContainer,
      duration: fixedInt(125),
      ease: "Sine.easeInOut",
      alpha: visible ? 1 : 0,
    });
  }

  setOffset(offset: boolean): void {
    this.offset = offset;
    this.setSlotOffset(offset ? 1 : 0);
  }

  /**
   * Position this info bar for its field SLOT within its side. Slot 0 is the anchor; each
   * later slot steps diagonally so three-plus bars stack without overlapping. Binary slot 1
   * reproduces the legacy single offset exactly. See `barSlotOffset` in `#data/battle-format`.
   */
  setSlotOffset(slot: number, capacity = 2): void {
    const [newDx, newDy] = barSlotOffset(slot, this.player, capacity);
    this.slotOffset = slot;
    // Idempotence on the APPLIED delta, not on (slot == slot): the same slot under a NEW
    // capacity must still re-position, and un-applying must subtract exactly what was
    // added (see appliedSlotDx docs - recomputing from the current capacity left a
    // residue on every triple<->single/double transition, creeping the bar upward).
    if (newDx === this.appliedSlotDx && newDy === this.appliedSlotDy) {
      return;
    }
    this.x += newDx - this.appliedSlotDx;
    this.y += newDy - this.appliedSlotDy;
    this.baseY = this.y;
    this.appliedSlotDx = newDx;
    this.appliedSlotDy = newDy;
  }

  /**
   * Triple+ only: thin the stacked bars (a smaller scale) and nudge the side's whole stack
   * off the sprites - the player's DOWN (it sits over the field), the enemy's UP (toward the
   * top edge). Idempotent: re-applying with the same capacity is a no-op, and capacity<3
   * restores full size / zero shift, so single/double are unaffected.
   */
  applyTripleThin(capacity: number, isPlayer: boolean): void {
    // Per-side triple nudge [dx, dy] off the sprites. The player's stack drops toward the
    // command menu (its lowest bar sits just above it); the enemy's slides to the top-left
    // so its leftmost bar reaches the screen edge. Idempotent via the applied-shift trackers.
    const [sx, sy] = capacity < 3 ? [0, 0] : isPlayer ? [0, 34] : [-15, -4];
    this.x += sx - this.appliedTripleShiftX;
    this.y += sy - this.appliedTripleShiftY;
    this.baseY = this.y;
    this.appliedTripleShiftX = sx;
    this.appliedTripleShiftY = sy;
    this.setScale(capacity >= 3 ? 0.78 : 1);
  }

  //#region Update methods and helpers

  /**
   * Update the status icon to match the pokemon's current status
   * @param pokemon - The pokemon object attached to this battle info
   * @param xOffset - The offset from the name text
   */
  updateStatusIcon(pokemon: Pokemon, xOffset = 0) {
    // The primary status (BRN/PSN/PAR/…) takes precedence; when there is none,
    // surface the ER status-tag labels (bleed/frostbite/fear) in the same slot
    // so they read like vanilla statuses in combat.
    const status = pokemon.status?.effect || StatusEffect.NONE;
    let frame: string | null = status === StatusEffect.NONE ? null : StatusEffect[status].toLowerCase();
    if (frame === null) {
      if (pokemon.getTag(BattlerTagType.ER_BLEED)) {
        frame = "bleed";
      } else if (pokemon.getTag(BattlerTagType.ER_FROSTBITE)) {
        frame = "frostbite";
      } else if (pokemon.getTag(BattlerTagType.ER_FEAR)) {
        frame = "fear";
      } else if (pokemon.getTag(BattlerTagType.ER_COMMANDED)) {
        frame = "commanded";
      }
    }

    if (this.lastStatusFrame !== frame) {
      this.lastStatusFrame = frame;
      this.lastStatus = status;
      const erBadge = frame === null ? undefined : ER_STATUS_BADGES[frame];
      if (erBadge) {
        // ER custom status: the vanilla `statuses` atlas has no frame for it, so
        // a setFrame fallback showed a faint/garbled icon. Render a crisp colored
        // text badge in the same slot instead.
        this.statusIndicator.setVisible(false);
        this.erStatusText
          .setText(erBadge.label)
          .setColor(erBadge.color)
          .setVisible(true)
          .setPositionRelative(this.nameText, xOffset, 11.5);
      } else {
        this.erStatusText.setVisible(false);
        if (frame !== null) {
          this.statusIndicator.setFrame(frame);
        }
        this.statusIndicator.setVisible(frame !== null).setPositionRelative(this.nameText, xOffset, 11.5);
      }
    }
  }

  /** Update the pokemon name inside the container */
  protected updateName(pokemon: Pokemon): boolean {
    const name = getBattleInfoDisplayName(pokemon);
    if (this.lastName === name) {
      this.updateShinyLabNameplate(pokemon);
      return false;
    }

    this.updateNameText(pokemon);
    this.updateShinyLabNameplate(pokemon);
    this.genderText.setPositionRelative(this.nameText, this.nameText.displayWidth, 0);

    return true;
  }

  private updateShinyLabNameplate(pokemon: Pokemon): void {
    // Shared resolver (single source of truth with Starter Select / Summary / Party):
    // the name adopts the equipped palette's color (or a named-combo signature) for ANY
    // shiny with Name FX unlocked + on - no earned-tier gate (the old inline `>= 3` here
    // silently kept ordinary shinies' names white, the "Name FX doesn't appear" report).
    const style = getErShinyLabNameStyleForPokemon(pokemon);
    // The FX goes on the NAME text itself - NOT the box around it (tinting the box
    // looked like a negative white->black wash). Only recolor the name.
    this.nameText.setColor(style ? style.color : "#f8f8f8");
    // Additionally animate the equipped SURFACE on the name glyphs (frame-swap overlay).
    // No-ops back to the flat colour above for palette-only / no-FX nameplates.
    this.getNameFx().update(this.nameText, getErShinyLabSpriteFxLookForPokemon(pokemon));
  }

  /** Lazily build the owned animated Name-FX overlay for this nameplate. */
  private getNameFx(): ErShinyLabNameFx {
    if (!this.nameFx) {
      this.nameFx = new ErShinyLabNameFx();
    }
    return this.nameFx;
  }

  destroy(fromScene?: boolean): void {
    this.nameFx?.destroy();
    this.nameFx = undefined;
    super.destroy(fromScene);
  }

  protected updateTeraType(ty: PokemonType): boolean {
    if (this.lastTeraType === ty) {
      return false;
    }

    this.teraIcon
      .setVisible(ty !== PokemonType.UNKNOWN)
      .setTintFill(Phaser.Display.Color.GetColor(...getTypeRgb(ty)))
      .setPositionRelative(this.nameText, this.nameText.displayWidth + this.genderText.displayWidth + 1, 2);
    this.lastTeraType = ty;

    return true;
  }

  /**
   * Update the type icons to match the pokemon's types
   */
  setTypes(types: PokemonType[]): void {
    const key = `pbinfo_${this.player ? "player" : "enemy"}`;
    this.type1Icon
      .setTexture(`${key}_type${types.length > 1 ? "1" : ""}`)
      .setFrame(PokemonType[types[0]].toLowerCase());
    this.type2Icon.setVisible(types.length > 1);
    this.type3Icon.setVisible(types.length > 2);
    if (types.length > 1) {
      this.type2Icon.setFrame(PokemonType[types[1]].toLowerCase());
    }
    if (types.length > 2) {
      this.type3Icon.setFrame(PokemonType[types[2]].toLowerCase());
    }
    // ER N-type substrate (maintainer paired-column layout): types 4..N pair into
    // VERTICAL COLUMNS advancing along the type3->type1 axis, mirroring the game's
    // own dual-type pair repeated. type1/type2 are column 0 (top/bottom); type3 is
    // the TOP of column 1, type4 its BOTTOM, type5 the top of column 2, etc. So a
    // six/seven-type mon shows compact columns beside the name instead of a long
    // horizontal row crowding the name plate / covering the sprite. Icons pooled
    // per slot. (1-3 types keep the existing placement - type3Icon at column-1 top.)
    const colDx = this.type3Icon.x - this.type1Icon.x;
    const rowTopY = this.type1Icon.y;
    const rowBottomY = this.type2Icon.y;
    for (let i = 3; i < types.length; i++) {
      let icon = this.extraTypeIcons[i - 3];
      if (!icon) {
        icon = globalScene.add
          .sprite(0, 0, `${key}_type`)
          .setName(`icon_type_${i + 1}`)
          .setOrigin(0);
        this.extraTypeIcons[i - 3] = icon;
        this.add(icon);
      }
      const column = Math.floor(i / 2);
      const row = i % 2;
      icon.setPosition(this.type1Icon.x + colDx * column, row === 0 ? rowTopY : rowBottomY);
      icon.setFrame(PokemonType[types[i]].toLowerCase());
      icon.setVisible(true);
    }
    for (let i = Math.max(0, types.length - 3); i < this.extraTypeIcons.length; i++) {
      this.extraTypeIcons[i].setVisible(false);
    }
  }

  /**
   * Called by {@linkcode updateInfo} to update the position of the tera, spliced, and shiny icons
   * @param isFusion - Whether the pokemon is a fusion or not
   */
  protected updateIconDisplay(isFusion: boolean): void {
    this.teraIcon.setPositionRelative(this.nameText, this.nameText.displayWidth + this.genderText.displayWidth + 1, 2);
    this.splicedIcon
      .setVisible(isFusion)
      .setPositionRelative(
        this.nameText,
        this.nameText.displayWidth
          + this.genderText.displayWidth
          + 1
          + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0),
        1.5,
      );
    this.shinyIcon.setPositionRelative(
      this.nameText,
      this.nameText.displayWidth
        + this.genderText.displayWidth
        + 1
        + (this.teraIcon.visible ? this.teraIcon.displayWidth + 1 : 0)
        + (this.splicedIcon.visible ? this.splicedIcon.displayWidth + 1 : 0),
      2.5,
    );
  }

  //#region Hp Bar Display handling
  /**
   * Called every time the hp frame is updated by the tween
   * @param pokemon - The pokemon object attached to this battle info
   */
  protected updateHpFrame(): void {
    const hpFrame = this.hpBar.scaleX > 0.5 ? "high" : this.hpBar.scaleX > 0.25 ? "medium" : "low";
    if (hpFrame !== this.lastHpFrame) {
      this.hpBar.setFrame(hpFrame);
      this.lastHpFrame = hpFrame;
    }
  }

  /**
   * Called by every frame in the hp animation tween created in {@linkcode updatePokemonHp}
   * @param _pokemon - The pokemon the battle-info bar belongs to
   */
  protected onHpTweenUpdate(_pokemon: Pokemon): void {
    this.updateHpFrame();
  }

  /** Update the pokemonHp bar */
  protected updatePokemonHp(pokemon: Pokemon, resolve: (r: void | PromiseLike<void>) => void, instant?: boolean): void {
    let duration = instant ? 0 : Phaser.Math.Clamp(Math.abs(this.lastHp - pokemon.hp) * 5, 250, 5000);
    const speed = globalScene.hpBarSpeed;
    if (speed) {
      duration = speed >= 3 ? 0 : duration / Math.pow(2, speed);
    }
    globalScene.tweens.add({
      targets: this.hpBar,
      ease: "Sine.easeOut",
      scaleX: pokemon.getHpRatio(true),
      duration,
      onUpdate: () => {
        this.onHpTweenUpdate(pokemon);
      },
      onComplete: () => {
        this.updateHpFrame();
        resolve();
      },
    });
    this.lastMaxHp = pokemon.getMaxHp();
  }

  //#endregion

  async updateInfo(pokemon: Pokemon, instant?: boolean): Promise<void> {
    let resolve: (r: void | PromiseLike<void>) => void = () => {};
    const promise = new Promise<void>(r => (resolve = r));
    if (!globalScene) {
      return resolve();
    }

    const gender: Gender = pokemon.summonData?.illusion?.gender ?? pokemon.gender;

    this.genderText.setText(getGenderSymbol(gender)).setColor(getGenderColor(gender));

    const nameUpdated = this.updateName(pokemon);

    const teraTypeUpdated = this.updateTeraType(pokemon.isTerastallized ? pokemon.getTeraType() : PokemonType.UNKNOWN);

    const isFusion = pokemon.isFusion(true);

    if (nameUpdated || teraTypeUpdated) {
      this.updateIconDisplay(isFusion);
    }

    this.updateStatusIcon(pokemon);

    this.setTypes(pokemon.getTypes(true, false, undefined, true));

    if (this.lastHp !== pokemon.hp || this.lastMaxHp !== pokemon.getMaxHp()) {
      this.updatePokemonHp(pokemon, resolve, instant);
    }
    if (!this.player && this.lastLevel !== pokemon.level) {
      this.setLevel(pokemon.level);
      this.lastLevel = pokemon.level;
    }

    const stats = pokemon.getStatStages();
    const statsStr = stats.join("");

    if (this.lastStats !== statsStr) {
      this.updateStats(stats);
      this.lastStats = statsStr;
    }

    this.shinyIcon.setVisible(pokemon.isShiny(true));

    const doubleShiny = isFusion && pokemon.shiny && pokemon.fusionShiny;
    const baseVariant = doubleShiny ? pokemon.variant : pokemon.getVariant(true);
    // ER Black Shinies (#349): updateInfo re-tints the star every refresh, so
    // without this check it would paint the t4 BLACK sparkle back to epic red.
    this.shinyIcon.setTint(isErBlackShiny(pokemon) ? 0x0a0a0a : getVariantTint(baseVariant));

    this.fusionShinyIcon.setVisible(doubleShiny).setPosition(this.shinyIcon.x, this.shinyIcon.y);
    if (isFusion) {
      this.fusionShinyIcon.setTint(getVariantTint(pokemon.fusionVariant));
    }

    resolve();
    await promise;
  }
  //#endregion

  updateNameText(pokemon: Pokemon): void {
    let displayName = getBattleInfoDisplayName(pokemon).replace(/[♂♀]/g, "");
    let nameTextWidth: number;

    const nameSizeTest = addTextObject(0, 0, displayName, TextStyle.BATTLE_INFO);
    nameTextWidth = nameSizeTest.displayWidth;

    const gender = pokemon.summonData.illusion?.gender ?? pokemon.gender;
    while (
      nameTextWidth
      > (this.player || !this.boss ? 60 : 98)
        - ((gender === Gender.GENDERLESS ? 0 : 6)
          + (pokemon.fusionSpecies ? 8 : 0)
          + (pokemon.isShiny() ? 8 : 0)
          + (Math.min(pokemon.level.toString().length, 3) - 3) * 8)
    ) {
      displayName = `${displayName.slice(0, displayName.endsWith(".") ? -2 : -1).trimEnd()}.`;
      nameSizeTest.setText(displayName);
      nameTextWidth = nameSizeTest.displayWidth;
    }

    nameSizeTest.destroy();

    this.nameText.setText(displayName);
    this.lastName = getBattleInfoDisplayName(pokemon);

    if (this.nameText.visible) {
      this.nameText.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, this.nameText.width, this.nameText.height),
        Phaser.Geom.Rectangle.Contains,
      );
    }
  }

  /**
   * Set the level numbers container to display the provided level
   *
   * @remarks
   * The numbers in the pokemon's level uses images for each number rather than a text object with a special font.
   * This method sets the images for each digit of the level number and then positions the level container based
   * on the number of digits.
   *
   * @param level - The level to display
   * @param textureKey - The texture key for the level numbers
   */
  setLevel(level: number, textureKey: "numbers" | "numbers_red" = "numbers"): void {
    this.levelNumbersContainer.removeAll(true);
    const levelStr = level.toString();
    for (let i = 0; i < levelStr.length; i++) {
      this.levelNumbersContainer.add(globalScene.add.image(i * 8, 0, textureKey, levelStr[i]));
    }
    this.levelContainer.setX(this.baseLvContainerX - 8 * Math.max(levelStr.length - 3, 0));
  }

  updateStats(stats: number[]): void {
    for (const [i, s] of this.statOrder.entries()) {
      if (s !== Stat.HP) {
        this.statNumbers[i].setFrame(stats[s - 1].toString());
      }
    }
  }

  getBaseY(): number {
    return this.baseY;
  }

  resetY(): void {
    this.y = this.baseY;
  }
}
