import Phaser from "phaser";
import rewardRateAuraFragShader from "./glsl/reward-rate-aura.frag?raw";
import spriteVertShader from "./glsl/sprite-shader.vert?raw";

/** Per-row uniform payload for {@linkcode RewardRateAuraPipeline}. */
export interface RewardRatePipelineData {
  /** Current rate total (0..rateCap), drives aura strength scaling. */
  rate: number;
  /** Rate ceiling used to normalize the aura ramp (default 50). */
  rateCap: number;
  /** Row semantic hue in degrees (48 shiny / 145 candy / 286 voucher). */
  semanticHue: number;
  /** Grade level 0..11 from getErRewardRateGrade().level. */
  visualGrade: number;
  /** Static per-row phase so the three rows never pulse in lockstep. */
  phaseOffset: number;
  /** Freezes every time-varying term while retaining the static grade frame. */
  reducedMotion: boolean;
}

const DEFAULT_DATA: RewardRatePipelineData = Object.freeze({
  rate: 0,
  rateCap: 50,
  semanticHue: 0,
  visualGrade: 0,
  phaseOffset: 0,
  reducedMotion: false,
});

/**
 * Shared row-background pipeline for the reward-rate panel. Rows register
 * themselves as the pipeline's game object; their `pipelineData` carries the
 * per-row {@linkcode RewardRatePipelineData} uploaded in {@linkcode onBatch}.
 * All uniform writes borrow preallocated locals — no per-frame allocation.
 */
export class RewardRateAuraPipeline extends Phaser.Renderer.WebGL.Pipelines.MultiPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: "RewardRateAura",
      fragShader: rewardRateAuraFragShader,
      vertShader: spriteVertShader,
    });
  }

  onPreRender(): void {
    super.onPreRender();
    this.set1f("time", this.game.loop.time / 1000);
  }

  onBind(gameObject: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject);
    if (!gameObject) {
      return;
    }

    // Only textured display objects reach this pipeline, and those declare
    // pipelineData; cast once (field-sprite.ts precedent) to read it typed.
    const sprite = gameObject as Phaser.GameObjects.Image;
    const data = (sprite.pipelineData ?? {}) as Partial<RewardRatePipelineData>;
    this.set1f("uRate", data.rate ?? DEFAULT_DATA.rate)
      .set1f("uRateCap", data.rateCap ?? DEFAULT_DATA.rateCap)
      .set1f("uSemanticHue", data.semanticHue ?? DEFAULT_DATA.semanticHue)
      .set1f("uVisualGrade", data.visualGrade ?? DEFAULT_DATA.visualGrade)
      .set1f("uPhaseOffset", data.phaseOffset ?? DEFAULT_DATA.phaseOffset)
      .set1f("uReducedMotion", (data.reducedMotion ?? DEFAULT_DATA.reducedMotion) ? 1 : 0);
  }

  onBatch(gameObject: Phaser.GameObjects.GameObject): void {
    if (gameObject) {
      this.flush();
    }
  }
}
