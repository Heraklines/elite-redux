import { globalScene } from "#app/global-scene";
import { FieldSpritePipeline } from "#app/pipelines/field-sprite";
import { MysteryEncounterIntroVisuals } from "#field/mystery-encounter-intro";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { getErShinyLabPaletteVariantCacheKey, variantColorCache } from "#sprites/variant";
import spriteFragShader from "./glsl/sprite-frag-shader.frag?raw";
import spriteVertShader from "./glsl/sprite-shader.vert?raw";
import { getSpriteFusionPaletteUniforms, getSpriteVariantPaletteUniforms } from "./sprite-palette-uniforms";

export class SpritePipeline extends FieldSpritePipeline {
  constructor(game: Phaser.Game) {
    super(game, {
      game,
      name: "sprite",
      fragShader: spriteFragShader,
      vertShader: spriteVertShader,
    });
  }

  onPreRender(): void {
    super.onPreRender();

    this.set1f("teraTime", 0)
      .set3fv("teraColor", [0, 0, 0])
      .setBoolean("hasShadow", false)
      .setBoolean("yCenter", false)
      .set2f("relPosition", 0, 0)
      .set2f("texFrameUv", 0, 0)
      .set2f("size", 0, 0)
      .set2f("texSize", 0, 0)
      .set1f("yOffset", 0)
      .set1f("yShadowOffset", 0)
      .set4fv("tone", [0, 0, 0, 0]);
  }

  onBind(gameObject: Phaser.GameObjects.GameObject): void {
    super.onBind(gameObject);

    const sprite = gameObject as Phaser.GameObjects.Sprite;

    // TODO: Add strong typing on this stuff
    const data = sprite.pipelineData;
    const tone = data["tone"] as number[];
    const teraColor = (data["isTerastallized"] as boolean) ? ((data["teraColor"] as number[]) ?? [0, 0, 0]) : [0, 0, 0];
    const hasShadow = data["hasShadow"] as boolean;
    const yShadowOffset = data["yShadowOffset"] as number;
    const ignoreFieldPos = data["ignoreFieldPos"] as boolean;
    const ignoreOverride = data["ignoreOverride"] as boolean;

    const isEntityObj =
      sprite.parentContainer instanceof Pokemon
      || sprite.parentContainer instanceof Trainer
      || sprite.parentContainer instanceof MysteryEncounterIntroVisuals;
    const field = isEntityObj ? sprite.parentContainer.parentContainer : sprite.parentContainer;
    const position = isEntityObj ? [sprite.parentContainer.x, sprite.parentContainer.y] : [sprite.x, sprite.y];
    if (field) {
      position[0] += field.x / field.scale;
      position[1] += field.y / field.scale;
    }
    // Switch animations can detach a sprite from its field container between the
    // display-list update and the WebGL batch.  Rendering that one frame must not
    // tear down the whole battle renderer; a detached sprite is already expressed
    // in its own coordinates, so there is no field-relative offset to apply.
    const fieldRelativeX = ignoreFieldPos || field == null ? 0 : sprite.x - field.x;
    const fieldRelativeY = ignoreFieldPos || field == null ? 0 : sprite.y - field.y;
    position[0] += -(sprite.width - sprite.frame.width) / 2 + sprite.frame.x + fieldRelativeX;
    if (sprite.originY === 0.5) {
      position[1] += (sprite.height / 2) * ((isEntityObj ? sprite.parentContainer : sprite).scale - 1) + fieldRelativeY;
    }
    this.set1f("teraTime", (this.game.getTime() % 500000) / 500000)
      .set3fv(
        "teraColor",
        teraColor.map(c => c / 255),
      )
      .setBoolean("hasShadow", hasShadow)
      .setBoolean("yCenter", sprite.originY === 0.5)
      .set1f("fieldScale", field?.scale || 1)
      .set2f("relPosition", position[0], position[1])
      .set2f("texFrameUv", sprite.frame.u0, sprite.frame.v0)
      .set2f("size", sprite.frame.width, sprite.height)
      .set2f("texSize", sprite.texture.source[0].width, sprite.texture.source[0].height)
      .set1f(
        "yOffset",
        sprite.height - sprite.frame.height * (isEntityObj ? sprite.parentContainer.scale : sprite.scale),
      )
      .set1f("yShadowOffset", yShadowOffset ?? 0)
      .set4fv("tone", tone)
      .bindTexture(this.game.textures.get("tera").source[0].glTexture!, 1); // TODO: is this bang correct?

    if (globalScene.fusionPaletteSwaps) {
      const spriteColors = ((ignoreOverride && data["spriteColorsBase"]) || data["spriteColors"] || []) as number[][];
      const fusionSpriteColors = ((ignoreOverride && data["fusionSpriteColorsBase"])
        || data["fusionSpriteColors"]
        || []) as number[][];
      const uniforms = getSpriteFusionPaletteUniforms(sprite, spriteColors, fusionSpriteColors);
      this.set4fv("spriteColors", uniforms.spriteColors as number[]) //
        .set4iv("fusionSpriteColors", uniforms.fusionSpriteColors as number[]);
    }
  }

  override onBatch(gameObject: Phaser.GameObjects.GameObject): void {
    if (gameObject) {
      const sprite = gameObject as Phaser.GameObjects.Sprite;
      const data = sprite.pipelineData;

      const variant: number = Object.hasOwn(data, "variant")
        ? data["variant"]
        : sprite.parentContainer instanceof Pokemon
          ? sprite.parentContainer.variant
          : 0;
      const variantCacheKey =
        sprite.parentContainer instanceof Pokemon
          ? (getErShinyLabPaletteVariantCacheKey(sprite.parentContainer, sprite.texture.key) ?? sprite.texture.key)
          : data["spriteKey"];
      const isShiny = sprite.parentContainer instanceof Pokemon ? sprite.parentContainer.shiny : !!data["shiny"];
      const variantPalettes = variantColorCache[variantCacheKey] as Record<number, Record<string, string>> | undefined;
      const uniforms = getSpriteVariantPaletteUniforms(
        isShiny && variantPalettes && Object.hasOwn(variantPalettes, variant) ? variantPalettes[variant] : undefined,
      );
      this.set4fv("baseVariantColors", uniforms.baseVariantColors as number[]) //
        .set4fv("variantColors", uniforms.variantColors as number[]);
    }

    super.onBatch(gameObject);
  }

  // biome-ignore lint/complexity/useMaxParams: Not our fault Phaser gives this 20 params
  override batchQuad(
    gameObject: Phaser.GameObjects.GameObject,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    tintTL: number,
    tintTR: number,
    tintBL: number,
    tintBR: number,
    tintEffect: number | boolean,
    texture?: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper,
    unit?: number,
  ): boolean {
    const sprite = gameObject as Phaser.GameObjects.Sprite;

    this.set1f("vCutoff", v1);

    const hasShadow = sprite.pipelineData["hasShadow"] as boolean;
    const yShadowOffset = (sprite.pipelineData["yShadowOffset"] as number) ?? 0;
    if (hasShadow) {
      const isEntityObj =
        sprite.parentContainer instanceof Pokemon
        || sprite.parentContainer instanceof Trainer
        || sprite.parentContainer instanceof MysteryEncounterIntroVisuals;
      const field = isEntityObj ? sprite.parentContainer.parentContainer : sprite.parentContainer;
      const fieldScaleRatio = field.scale / 6;
      const baseY = ((isEntityObj ? sprite.parentContainer.y : sprite.y + sprite.height) * 6) / fieldScaleRatio;
      const bottomPadding = (Math.ceil(sprite.height * 0.05 + Math.max(yShadowOffset, 0)) * 6) / fieldScaleRatio;
      const yDelta = (baseY - y1) / field.scale;
      y1 = baseY + bottomPadding;
      y2 = y1;
      const pixelHeight =
        (v1 - v0) / (sprite.frame.height * (isEntityObj ? sprite.parentContainer.scale : sprite.scale));
      v1 += (yDelta + bottomPadding / field.scale) * pixelHeight;
    }

    return super.batchQuad(
      gameObject,
      x0,
      y0,
      x1,
      y1,
      x2,
      y2,
      x3,
      y3,
      u0,
      v0,
      u1,
      v1,
      tintTL,
      tintTR,
      tintBL,
      tintBR,
      tintEffect,
      texture,
      unit,
    );
  }
}
