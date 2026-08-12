import { globalScene } from "#app/global-scene";
import type { MoodyEffectKind, MoodyEffectSide } from "#data/elite-redux/moody/moody-effect-flyout";
import { TextStyle } from "#enums/text-style";
import { UiTheme } from "#enums/ui-theme";
import { addTextObject } from "#ui/text";
import { fixedInt } from "#utils/common";
import i18next from "i18next";

const defaultBarWidth = 118;
const defaultLegacyBarWidth = 90;
const defaultBarHeight = 31;
const enemyTrainerPortraitBaseline = 7;
const screenLeft = 0;
const baseY = -116;
const textPadding = 15;
const legacyUiPlayerTextPadding = 16;
const legacyUiEnemyTextPadding = 6;
const trainerPortraitInset = 4;
const trainerPortraitGap = 4;
const enemyTrainerPortraitNudgeX = 6;
const trainerEffectTextInset = 6;
const trainerPortraitHeight = 39;
const trainerPortraitMaxWidth = 34;
const trainerPortraitCropWidthRatio = 1;
const trainerPortraitCropHeightRatio = 0.72;
const trainerNameScale = 0.1666666667;
const trainerNameMinScale = 0.125;
const trainerEffectTint = {
  boon: 0x7550a8,
  curse: 0x4e286f,
} as const;
const trainerEffectAccent = {
  boon: 0xd4adf3,
  curse: 0xb66add,
} as const;

interface VisibleFrameBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const visibleTrainerFrameBounds = new Map<string, VisibleFrameBounds>();

function getVisibleTrainerFrameBounds(source: Phaser.GameObjects.Sprite): VisibleFrameBounds {
  const width = source.frame.realWidth;
  const height = source.frame.realHeight;
  const cacheKey = `${source.texture.key}:${String(source.frame.name)}:${width}x${height}`;
  const cached = visibleTrainerFrameBounds.get(cacheKey);
  if (cached != null) {
    return cached;
  }
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (globalScene.textures.getPixelAlpha(x, y, source.texture.key, source.frame.name) <= 0) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const bounds =
    right >= left && bottom >= top
      ? { left, top, right, bottom }
      : { left: 0, top: 0, right: width - 1, bottom: height - 1 };
  visibleTrainerFrameBounds.set(cacheKey, bounds);
  return bounds;
}

export class AbilityBar extends Phaser.GameObjects.Container {
  private readonly abilityBars: (Phaser.GameObjects.Image | Phaser.GameObjects.NineSlice)[];
  private abilityBarText: Phaser.GameObjects.Text;
  private legacyUiPokemonText: Phaser.GameObjects.Text;
  private legacyUiAbilityText: Phaser.GameObjects.Text;
  private readonly isLegacyUi: boolean;
  private trainerPortrait: Phaser.GameObjects.Sprite;
  private trainerAccent: Phaser.GameObjects.Rectangle;
  private trainerEffectNameText: Phaser.GameObjects.Text;
  private player: boolean;
  private screenRight: number; // hold screenRight in case size changes between show and hide
  private shown: boolean;
  private currentBarWidth: number;

  constructor() {
    super(globalScene, defaultBarWidth, baseY);
    this.abilityBars = [];
    this.player = true;
    this.shown = false;
    this.isLegacyUi = globalScene.uiTheme === UiTheme.LEGACY;
    this.currentBarWidth = this.isLegacyUi ? defaultLegacyBarWidth : defaultBarWidth;
  }

  setup(): this {
    if (this.isLegacyUi) {
      for (const key of ["ability_bar_right", "ability_bar_left"]) {
        const bar = globalScene.add
          .nineslice(0, 0, key, undefined, defaultBarWidth, defaultBarHeight, 16, 16)
          .setOrigin(0)
          .setVisible(false);
        this.add(bar);
        this.abilityBars.push(bar);
      }

      this.legacyUiPokemonText = addTextObject(legacyUiPlayerTextPadding, 3, "", TextStyle.MESSAGE, {
        fontSize: "72px",
      }) //
        .setOrigin(0);

      this.legacyUiAbilityText = addTextObject(legacyUiPlayerTextPadding, 16, "", TextStyle.MESSAGE, {
        fontSize: "72px",
      }) //
        .setOrigin(0);

      this.legacyUiAbilityText.setColor("#484848");
      this.legacyUiAbilityText.setShadowColor("#d0d0c8");

      this.add(this.legacyUiPokemonText) //
        .bringToTop(this.legacyUiPokemonText);
      this.add(this.legacyUiAbilityText) //
        .bringToTop(this.legacyUiAbilityText);
    } else {
      for (const key of ["ability_bar_right", "ability_bar_left"]) {
        const bar = globalScene.add //
          .image(0, 0, key)
          .setOrigin(0)
          .setVisible(false);
        this.add(bar);
        this.abilityBars.push(bar);
      }

      this.abilityBarText = addTextObject(textPadding, 3, "", TextStyle.MESSAGE, {
        fontSize: "72px",
      })
        .setOrigin(0)
        .setWordWrapWidth(600, true);

      this.add(this.abilityBarText) //
        .bringToTop(this.abilityBarText);
    }

    this.trainerPortrait = globalScene.add.sprite(0, 0, "trainer_m_back").setOrigin(0.5, 0).setVisible(false);
    this.trainerAccent = globalScene.add
      .rectangle(0, 0, this.currentBarWidth, 2, trainerEffectAccent.boon)
      .setOrigin(0)
      .setVisible(false);
    this.trainerEffectNameText = addTextObject(trainerEffectTextInset, defaultBarHeight / 2, "", TextStyle.MESSAGE, {
      fontSize: "72px",
    })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.add([this.trainerAccent, this.trainerPortrait, this.trainerEffectNameText]);

    this.setVisible(false) //
      .setX(-this.currentBarWidth); // start hidden (right edge of bar at x=0)

    return this;
  }

  public override setVisible(value: boolean): this {
    this.abilityBars[+this.player].setVisible(value);
    if (!value) {
      this.trainerPortrait?.setVisible(false);
      this.trainerAccent?.setVisible(false);
      this.trainerEffectNameText?.setVisible(false);
    }
    this.shown = value;
    return this;
  }

  private resetTrainerEffectStyle(): void {
    for (const bar of this.abilityBars) {
      bar.clearTint();
    }
    this.trainerPortrait.setVisible(false);
    this.trainerAccent.setVisible(false);
    this.trainerEffectNameText.setVisible(false);
    this.abilityBarText?.setVisible(true);
    this.legacyUiPokemonText?.setVisible(true);
    this.legacyUiAbilityText?.setVisible(true);
  }

  private updateBarWidth(): void {
    if (!this.isLegacyUi) {
      return;
    }
    const textMaxWidth = Math.max(this.legacyUiPokemonText.displayWidth, this.legacyUiAbilityText.displayWidth);
    this.currentBarWidth = Math.max(
      defaultLegacyBarWidth,
      textMaxWidth + legacyUiEnemyTextPadding + legacyUiPlayerTextPadding,
    );
    this.abilityBars[+this.player].setSize(this.currentBarWidth, defaultBarHeight);
  }

  public async startTween(config: any, text?: string): Promise<void> {
    this.setVisible(true);
    if (text) {
      if (this.isLegacyUi) {
        const lines = text.split("\n");
        this.legacyUiPokemonText.setText(lines[0]?.trimStart());
        this.legacyUiAbilityText.setText(lines[1]?.trimStart());
        this.updateBarWidth();
        config.x = this.player ? screenLeft : this.screenRight - this.currentBarWidth;
      } else {
        this.abilityBarText.setText(text);
      }
    }
    return new Promise(resolve => {
      globalScene.tweens.add({
        ...config,
        onComplete: () => {
          if (config.onComplete) {
            config.onComplete();
          }
          resolve();
        },
      });
    });
  }

  public async showAbility(pokemonName: string, abilityName: string, passive = false, player = true): Promise<void> {
    this.resetTrainerEffectStyle();
    const text = `${i18next.t("fightUiHandler:abilityFlyInText", { pokemonName, passive: passive ? i18next.t("fightUiHandler:passive") : "", abilityName })}`;
    this.screenRight = globalScene.scaledCanvas.width;
    if (player !== this.player) {
      // Move the bar if it has changed from the player to enemy side (or vice versa)
      this.setX(player ? -this.currentBarWidth : this.screenRight);
      this.player = player;
    }
    globalScene.fieldUI.bringToTop(this);

    if (this.isLegacyUi) {
      // Handle the empty space being on opposite sides for left and right ability bar images
      const textX = this.player ? legacyUiPlayerTextPadding : legacyUiEnemyTextPadding;
      this.legacyUiPokemonText.setX(textX);
      this.legacyUiAbilityText.setX(textX);
    }

    let y = baseY;
    if (this.player) {
      y += globalScene.currentBattle.double ? 14 : 0;
    } else {
      y -= globalScene.currentBattle.double ? 28 : 14;
    }

    this.setY(y);

    return this.startTween(
      {
        targets: this,
        x: this.player ? screenLeft : this.screenRight - this.currentBarWidth,
        duration: 500,
        ease: "Sine.easeOut",
        hold: 1000,
      },
      text,
    );
  }

  private configureTrainerPortrait(
    side: MoodyEffectSide,
  ): { left: number; right: number; width: number; visibleCenterOffset: number } | null {
    const source = side === "player" ? globalScene.trainer : globalScene.currentBattle?.trainer?.getSprites().at(0);
    if (source == null || source.texture == null) {
      this.trainerPortrait.setVisible(false);
      return null;
    }

    const visibleBounds = side === "enemy" ? getVisibleTrainerFrameBounds(source) : null;
    const sourceWidth = side === "enemy" ? source.frame.realWidth : source.frame.width;
    const sourceHeight = side === "enemy" ? source.frame.realHeight : source.frame.height;
    const cropWidth = Math.max(1, Math.round(sourceWidth * trainerPortraitCropWidthRatio));
    const cropX = Math.round((sourceWidth - cropWidth) / 2);
    const cropY = visibleBounds?.top ?? 0;
    const cropHeight =
      visibleBounds == null
        ? Math.max(1, Math.round(source.frame.height * trainerPortraitCropHeightRatio))
        : Math.max(1, Math.ceil((visibleBounds.bottom - visibleBounds.top + 1) / 2));
    const visibleWidth = visibleBounds == null ? cropWidth : visibleBounds.right - visibleBounds.left + 1;
    const scale = Math.min(1, trainerPortraitHeight / cropHeight, trainerPortraitMaxWidth / visibleWidth);
    const displayWidth = visibleWidth * scale;
    const visibleCenterX =
      side === "player"
        ? trainerPortraitInset + trainerPortraitMaxWidth / 2
        : this.currentBarWidth - trainerPortraitInset - trainerPortraitMaxWidth / 2;
    const visibleCenterOffset =
      visibleBounds == null ? 0 : ((visibleBounds.left + visibleBounds.right + 1) / 2 - sourceWidth / 2) * scale;
    const spriteX = visibleCenterX - visibleCenterOffset;
    const left = visibleCenterX - displayWidth / 2;
    const portraitOriginX = 0.5;
    const portraitOriginY = side === "player" ? 1 : (cropY + cropHeight) / sourceHeight;
    const portraitBaselineY = side === "player" ? defaultBarHeight + 1 : enemyTrainerPortraitBaseline;
    this.trainerPortrait
      .setTexture(source.texture.key)
      .setFrame(source.frame.name)
      .setCrop(cropX, cropY, cropWidth, cropHeight)
      .setScale(scale)
      .setFlipX(false)
      .setAlpha(1)
      .clearTint()
      .setOrigin(portraitOriginX, portraitOriginY)
      .setPosition(spriteX, portraitBaselineY)
      .setVisible(true);
    this.bringToTop(this.trainerPortrait);
    return { left, right: left + displayWidth, width: displayWidth, visibleCenterOffset };
  }

  private fitTrainerEffectName(maxWidth: number): void {
    this.trainerEffectNameText.setScale(trainerNameScale);
    if (this.trainerEffectNameText.displayWidth <= maxWidth) {
      return;
    }
    const fittedScale = Math.max(
      trainerNameMinScale,
      trainerNameScale * (maxWidth / this.trainerEffectNameText.displayWidth),
    );
    this.trainerEffectNameText.setScale(fittedScale);
    if (this.trainerEffectNameText.displayWidth <= maxWidth) {
      return;
    }
    const original = this.trainerEffectNameText.text;
    for (let length = original.length - 1; length > 0; length--) {
      this.trainerEffectNameText.setText(`${original.slice(0, length).trimEnd()}...`);
      if (this.trainerEffectNameText.displayWidth <= maxWidth) {
        break;
      }
    }
  }

  /** Reuse the normal ability flyout with a violet trainer-owned treatment. */
  public async showTrainerEffect(name: string, kind: MoodyEffectKind, side: MoodyEffectSide): Promise<void> {
    this.screenRight = globalScene.scaledCanvas.width;
    const player = side === "player";
    if (player !== this.player) {
      this.setX(player ? -this.currentBarWidth : this.screenRight);
      this.player = player;
    }
    globalScene.fieldUI.bringToTop(this);

    this.abilityBarText?.setVisible(false);
    this.legacyUiPokemonText?.setVisible(false);
    this.legacyUiAbilityText?.setVisible(false);
    this.abilityBars[+this.player].setTintFill(trainerEffectTint[kind]);
    this.trainerAccent.setFillStyle(trainerEffectAccent[kind]).setSize(this.currentBarWidth, 2).setVisible(true);
    const portraitBounds = this.configureTrainerPortrait(side);

    const textX = player
      ? (portraitBounds?.right ?? trainerEffectTextInset) + trainerPortraitGap
      : trainerEffectTextInset;
    const maxWidth = Math.max(
      30,
      player
        ? this.currentBarWidth - textX - trainerEffectTextInset
        : (portraitBounds?.left ?? this.currentBarWidth) - textX - trainerPortraitGap,
    );
    this.trainerEffectNameText.setText(name).setX(textX).setColor("#ffffff").setWordWrapWidth(0).setVisible(true);
    this.fitTrainerEffectName(maxWidth);
    if (!player && portraitBounds != null) {
      const left = Math.min(
        this.currentBarWidth - trainerPortraitInset - portraitBounds.width,
        textX + this.trainerEffectNameText.displayWidth + trainerPortraitGap,
      );
      this.trainerPortrait.setX(
        left + portraitBounds.width / 2 - portraitBounds.visibleCenterOffset + enemyTrainerPortraitNudgeX,
      );
    }
    this.bringToTop(this.trainerEffectNameText);

    let y = baseY;
    if (player) {
      y += globalScene.currentBattle.double ? 14 : 0;
    } else {
      y -= globalScene.currentBattle.double ? 28 : 14;
    }
    this.setY(y);

    return this.startTween({
      targets: this,
      x: player ? screenLeft : this.screenRight - this.currentBarWidth,
      duration: fixedInt(400),
      ease: "Sine.easeOut",
      hold: fixedInt(1400),
    });
  }

  public async hide(): Promise<void> {
    return this.startTween({
      targets: this,
      x: this.player ? -this.currentBarWidth : this.screenRight,
      duration: 200,
      ease: "Sine.easeIn",
      onComplete: () => {
        this.setVisible(false);
      },
    });
  }

  public isVisible(): boolean {
    return this.shown;
  }
}
