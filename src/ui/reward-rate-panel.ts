import { globalScene } from "#app/global-scene";
import {
  ER_REWARD_RATE_HUES,
  ER_REWARD_RATE_ROWS,
  type ErRewardRateKind,
  formatErRewardRate,
  getErRewardRateGrade,
  getErRewardRateRowTooltip,
} from "#data/elite-redux/er-reward-rate-visuals";
import { type ErRewardRateBreakdown, getCurrentErRewardRates } from "#data/elite-redux/er-reward-rates";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import Phaser from "phaser";

export const REWARD_RATE_PANEL_WIDTH = 44;
export const REWARD_RATE_PANEL_HEIGHT = 21.5;
const ROW_HEIGHT = 6.5;
const ROW_TOP = 1;
const ICON_X = 1.5;
const LABEL_X = 7;
const VALUE_X = 42;
const ROW_TEXTURE_KEY = "er-reward-rate-row";

const ROW_LABELS: Readonly<Record<ErRewardRateKind, string>> = Object.freeze({
  shiny: "Shiny",
  candy: "Candy",
  voucher: "Voucher",
});

const GLYPHS: Readonly<Record<ErRewardRateKind, readonly [number, number][]>> = Object.freeze({
  shiny: [
    [1.5, 0],
    [1.5, 1],
    [0, 1.5],
    [1, 1.5],
    [1.5, 1.5],
    [2, 1.5],
    [3, 1.5],
    [1.5, 2],
    [1.5, 3],
  ],
  candy: [
    [1, 0],
    [2, 0],
    [0, 1],
    [3, 1],
    [0, 2],
    [3, 2],
    [1, 3],
    [2, 3],
  ],
  voucher: [
    [1, 0],
    [2, 0],
    [0.5, 1],
    [2.5, 1],
    [1, 2],
    [2, 2],
    [1.5, 3],
  ],
});

const GLYPH_COLORS: Readonly<Record<ErRewardRateKind, number>> = Object.freeze({
  shiny: 0xf2c94c,
  candy: 0x6fe0a8,
  voucher: 0xc078f0,
});

interface RewardRateRow {
  kind: ErRewardRateKind;
  background: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
  corners: Phaser.GameObjects.Rectangle[];
  innerRim: Phaser.GameObjects.Rectangle;
}

export class RewardRatePanel extends Phaser.GameObjects.Container {
  private readonly rows: RewardRateRow[] = [];
  private readonly reducedMotion: boolean;
  private readonly webGl: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    this.setName("reward-rate-panel").setVisible(false).setAlpha(0);
    this.reducedMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    this.webGl = scene.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer;

    this.ensureRowTexture(scene);
    this.buildFrame(scene);
    this.buildRows(scene);
  }

  private ensureRowTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(ROW_TEXTURE_KEY)) {
      return;
    }
    const texture = scene.textures.createCanvas(ROW_TEXTURE_KEY, 2, 2);
    if (!texture) {
      throw new Error(`RewardRatePanel could not create ${ROW_TEXTURE_KEY}`);
    }
    const context = texture.getContext();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 2, 2);
    texture.refresh();
  }

  private buildFrame(scene: Phaser.Scene): void {
    const frame = scene.add.graphics();
    frame.fillStyle(0x090810, 0.78).fillRect(0, 0, REWARD_RATE_PANEL_WIDTH, REWARD_RATE_PANEL_HEIGHT);
    frame
      .lineStyle(0.5, 0xa8a6b8, 0.8)
      .strokeRect(0.25, 0.25, REWARD_RATE_PANEL_WIDTH - 0.5, REWARD_RATE_PANEL_HEIGHT - 0.5);
    frame.lineStyle(0.5, 0xa8a6b8, 0.2);
    frame.lineBetween(1, ROW_TOP + ROW_HEIGHT, REWARD_RATE_PANEL_WIDTH - 1, ROW_TOP + ROW_HEIGHT);
    frame.lineBetween(1, ROW_TOP + ROW_HEIGHT * 2, REWARD_RATE_PANEL_WIDTH - 1, ROW_TOP + ROW_HEIGHT * 2);
    this.add(frame);
  }

  private buildRows(scene: Phaser.Scene): void {
    for (let index = 0; index < ER_REWARD_RATE_ROWS.length; index++) {
      const kind = ER_REWARD_RATE_ROWS[index];
      const rowY = ROW_TOP + index * ROW_HEIGHT;
      const background = scene.add
        .image(0.5, rowY, ROW_TEXTURE_KEY)
        .setOrigin(0, 0)
        .setDisplaySize(REWARD_RATE_PANEL_WIDTH - 1, ROW_HEIGHT);

      const glyph = scene.add.graphics().fillStyle(GLYPH_COLORS[kind], 1);
      for (const [gx, gy] of GLYPHS[kind]) {
        glyph.fillRect(ICON_X + gx, rowY + 1 + gy, 0.75, 0.75);
      }

      const label = addTextObject(LABEL_X, rowY + 0.6, ROW_LABELS[kind], TextStyle.PARTY, { fontSize: "30px" })
        .setOrigin(0, 0)
        .setShadow(0, 0, "#00000000");
      const value = addTextObject(VALUE_X, rowY + 0.6, "", TextStyle.PARTY, { fontSize: "30px" })
        .setOrigin(1, 0)
        .setShadow(0, 0, "#00000000");

      const corners = [
        scene.add.rectangle(1.25, rowY + 1, 0.75, 0.75, 0xffffff),
        scene.add.rectangle(REWARD_RATE_PANEL_WIDTH - 1.25, rowY + 1, 0.75, 0.75, 0xffffff),
        scene.add.rectangle(1.25, rowY + ROW_HEIGHT - 1, 0.75, 0.75, 0xffffff),
        scene.add.rectangle(REWARD_RATE_PANEL_WIDTH - 1.25, rowY + ROW_HEIGHT - 1, 0.75, 0.75, 0xffffff),
      ];
      corners.forEach(corner => corner.setVisible(false));

      const innerRim = scene.add
        .rectangle(0.9, rowY + 0.4, REWARD_RATE_PANEL_WIDTH - 1.8, ROW_HEIGHT - 0.8)
        .setOrigin(0, 0)
        .setFillStyle(0, 0)
        .setStrokeStyle(0.35, 0xffffff, 0.9)
        .setVisible(false);

      const hitArea = scene.add
        .zone(0.5, rowY, REWARD_RATE_PANEL_WIDTH - 1, ROW_HEIGHT)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      hitArea
        .on("pointerover", () => this.showRowTooltip(kind))
        .on("pointerdown", () => this.showRowTooltip(kind))
        .on("pointerout", () => globalScene.ui?.hideTooltip());

      this.add([background, ...corners, innerRim, glyph, label, value, hitArea]);
      this.rows.push({ kind, background, label, value, corners, innerRim });
    }
  }

  anchorUnderLuck(luckText: Phaser.GameObjects.Text): void {
    this.setX(globalScene.scaledCanvas.width - REWARD_RATE_PANEL_WIDTH - 2);
    this.setY(luckText.getBottomCenter().y + 1.5);
  }

  refreshFromGame(rates: ErRewardRateBreakdown = getCurrentErRewardRates()): void {
    const totals = [rates.totalShiny, rates.totalCandy, rates.totalVoucher] as const;
    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index];
      const total = totals[index];
      const grade = getErRewardRateGrade(total);
      row.value.setText(formatErRewardRate(total)).setTint(grade.level === 0 ? 0x8a8a92 : 0xffffff);
      row.label.setTint(grade.level === 0 ? 0x777780 : GLYPH_COLORS[row.kind]);

      if (this.webGl) {
        row.background.pipelineData = {
          rate: total,
          rateCap: rates.totalCap,
          semanticHue: ER_REWARD_RATE_HUES[row.kind],
          visualGrade: grade.level,
          phaseOffset: index * 2.17,
          reducedMotion: this.reducedMotion,
        };
        row.background.setPipeline("RewardRateAura");
      } else {
        row.background.setTint(grade.color).setAlpha(0.38);
      }

      const showCorners = total >= 30;
      row.corners.forEach(corner =>
        corner.setVisible(showCorners).setFillStyle(grade.color, total === 50 ? 1 : 0.75),
      );
      row.innerRim.setVisible(total >= 40).setStrokeStyle(0.35, grade.color, total === 50 ? 1 : 0.85);
    }
  }

  private showRowTooltip(kind: ErRewardRateKind): void {
    const tooltip = getErRewardRateRowTooltip(kind, getCurrentErRewardRates());
    globalScene.ui?.showTooltip(tooltip.title, tooltip.content, true);
  }
}
