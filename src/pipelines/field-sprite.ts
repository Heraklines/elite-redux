import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { getTerrainColor } from "#data/terrain";
import { TimeOfDay } from "#enums/time-of-day";
import type { RGBArray } from "#types/sprite-types";
import { getCurrentTime } from "#utils/common";
import Phaser from "phaser";
import fieldSpriteFragShader from "./glsl/field-sprite-frag-shader.frag?raw";
import spriteVertShader from "./glsl/sprite-shader.vert?raw";

export class FieldSpritePipeline extends Phaser.Renderer.WebGL.Pipelines.MultiPipeline {
  constructor(game: Phaser.Game, config?: Phaser.Types.Renderer.WebGL.WebGLPipelineConfig) {
    super(
      config || {
        game,
        name: "field-sprite",
        fragShader: fieldSpriteFragShader,
        vertShader: spriteVertShader,
      },
    );
  }

  onPreRender(): void {
    super.onPreRender();

    const arena = globalScene.arena;
    const noTint = globalScene.dayNightTint === false;
    const time = noTint
      ? 0.1
      : globalScene.currentBattle?.waveIndex
        ? ((globalScene.currentBattle.waveIndex + globalScene.waveCycleOffset) % 40) / 40
        : getCurrentTime();

    // These uniforms are field-global. Uploading and rebuilding their arrays in
    // onBind repeated the same work for every rendered battler; that cost scaled
    // directly from singles to doubles/triples. Set them once per pipeline frame.
    this.set1f("time", time)
      .setBoolean("ignoreTimeTint", false)
      .setBoolean("isOutside", arena?.isOutside() ?? true)
      .set3fv(
        "overrideTint",
        (noTint || !arena ? ([0, 0, 0] as RGBArray) : overrideTint()).map(color => color / 255),
      )
      .set3fv(
        "dayTint",
        (arena?.getDayTint() ?? [0, 0, 0]).map(color => color / 255),
      )
      .set3fv(
        "duskTint",
        (arena?.getDuskTint() ?? [0, 0, 0]).map(color => color / 255),
      )
      .set3fv(
        "nightTint",
        (arena?.getNightTint() ?? [0, 0, 0]).map(color => color / 255),
      )
      .set3fv(
        "terrainColor",
        (arena ? getTerrainColor(arena.terrainType) : [0, 0, 0]).map(color => color / 255),
      )
      .set1f("terrainColorRatio", 0);
  }

  onBind(gameObject: Phaser.GameObjects.GameObject): void {
    super.onBind();

    const sprite = gameObject as Phaser.GameObjects.Sprite | Phaser.GameObjects.NineSlice;

    const data = sprite.pipelineData;
    const ignoreTimeTint = !!data["ignoreTimeTint"];
    const terrainColorRatio = (data["terrainColorRatio"] as number) ?? 0;

    this.setBoolean("ignoreTimeTint", ignoreTimeTint).set1f("terrainColorRatio", terrainColorRatio);
  }

  onBatch(gameObject: Phaser.GameObjects.GameObject): void {
    if (gameObject) {
      this.flush();
    }
  }
}

/**
 * Override the current arena tint based on the Time of day override
 * @returns The overriden tint colors as an RGB array.
 */
function overrideTint(): RGBArray {
  switch (Overrides.TIME_OF_DAY_OVERRIDE) {
    case TimeOfDay.DAY:
    case TimeOfDay.DAWN:
      return globalScene.arena.getDayTint();
    case TimeOfDay.DUSK:
      return globalScene.arena.getDuskTint();
    case TimeOfDay.NIGHT:
      return globalScene.arena.getNightTint();
    default:
      return [0, 0, 0];
  }
}
