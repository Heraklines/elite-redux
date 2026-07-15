/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PROOF that a MULTI-FRAME ER custom "GIF" atlas actually ANIMATES in battle,
// via the render-harness stepped-animation capture. Drives the EXACT engine
// animation path a battle sprite uses — `anims.generateFrameNames(0001..0400)` +
// `anims.create({ frameRate, repeat:-1 })` + `sprite.play(key)` (see
// PokemonSpeciesForm.loadAssets / Pokemon.loadAssets) — against a real multi-frame
// atlas (the baked Regitube idle, 20 frames), then steps the virtual clock and
// captures a frame SEQUENCE. The sprite VISIBLY changes across frames.
//
// Also proves the REGRESSION guarantee: a SINGLE-frame atlas (every existing ER
// custom today) renders STATIC and unchanged, and carries no cadence override.
//
// NB: the harness field renderer (`renderBattlefield`) deliberately PINS each mon
// to its first frame (a still golden), so a battlefield render can't show motion —
// this test drives the engine's own anim path directly instead, which is the
// faithful proof that the sprite plays in-game.
//
// Run:  ER_SCENARIO=1 npx vitest run test/tools/render-animated-sprite.test.ts
// =============================================================================

import { applyErAtlasFrameRate, erAtlasFrameRate } from "#data/elite-redux/er-sprite-anim";
import { createRenderScene, pixelDiff, type RenderContext } from "#test/tools/render-harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import type Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const FIXTURE_DIR = join("test", "fixtures", "regitube-anim");
const OUT_DIR = join(
  "C:",
  "Users",
  "Hafida",
  "AppData",
  "Local",
  "Temp",
  "claude",
  "C--Users-Hafida",
  "91d7b1e2-397d-47d4-8fce-1ca7a5d1369d",
  "scratchpad",
  "library-ui-captures",
  "animated",
);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Inject an atlas fixture (png + hash json) into the render scene EXACTLY as the
 * game would: create the texture, register each frame, and copy every non-`frames`
 * top-level JSON key onto `texture.customData` (mirrors Phaser's JSONHash parser),
 * so the authored `animation` cadence is readable at buildAnim time.
 */
async function injectFixture(scene: Phaser.Scene, key: string, base: string): Promise<void> {
  const img = await loadImage(join(FIXTURE_DIR, `${base}.png`));
  const tex = scene.textures.addImage(key, img as any);
  if (!tex) {
    throw new Error(`failed to add texture ${key}`);
  }
  const atlas = JSON.parse(readFileSync(join(FIXTURE_DIR, `${base}.json`), "utf8"));
  (tex as any).customData ??= {};
  const cd = (tex as any).customData as Record<string, any>;
  for (const k of Object.keys(atlas)) {
    if (k === "frames" || k === "textures") {
      continue;
    }
    cd[k] = atlas[k];
  }
  for (const [name, f] of Object.entries<any>(atlas.frames)) {
    tex.add(name, 0, f.frame.x, f.frame.y, f.frame.w, f.frame.h);
  }
}

/** Build the battle animation the way the engine does, honouring an authored cadence. */
function buildBattleAnim(scene: Phaser.Scene, key: string): void {
  const frameNames = scene.anims.generateFrameNames(key, { zeroPad: 4, suffix: ".png", start: 1, end: 400 });
  scene.anims.create({ key, frames: frameNames, frameRate: 10, repeat: -1 });
  applyErAtlasFrameRate(scene.anims, key, scene.textures.get(key)?.customData);
}

describe.skipIf(!RUN)("render animated custom sprite (multi-frame ER atlas)", () => {
  let ctx: RenderContext;

  beforeAll(async () => {
    ctx = await createRenderScene();
  });

  it("a 20-frame Regitube atlas PLAYS: the sprite visibly changes across captured frames", async () => {
    const key = "pkmn__er__regitube_anim_test";
    await injectFixture(ctx.scene, key, "front");

    // The engine enumerates 0001.png..0400.png; our atlas defines 0001..0020.
    const frameNames = ctx.scene.anims.generateFrameNames(key, { zeroPad: 4, suffix: ".png", start: 1, end: 400 });
    expect(frameNames.length, "the multi-frame atlas exposes 20 animation frames").toBe(20);

    buildBattleAnim(ctx.scene, key);
    // The authored cadence (116.7 ms/frame) overrode the default 10 fps.
    const anim = ctx.scene.anims.get(key);
    expect(anim.frameRate, "authored frame rate applied (~8.57 fps)").toBeCloseTo(1000 / 116.7, 1);

    // Place a scaled sprite centre-screen and PLAY the animation (the battle path).
    const spr = ctx.scene.add.sprite(960, 540, key).setOrigin(0.5, 0.5).setScale(6);
    spr.play(key);

    // Stepped-animation capture: a flip-book of LIVE frames (no freeze).
    const CAPTURES = 8;
    const STEPS_BETWEEN = 4; // 4 x 16ms = 64ms; over 8 captures ~= 4 anim frames
    const shots: string[] = [];
    for (let c = 0; c < CAPTURES; c++) {
      for (let s = 0; s < STEPS_BETWEEN; s++) {
        ctx.step();
        await sleep(4);
      }
      const path = join(OUT_DIR, `regitube-frame${String(c).padStart(2, "0")}.png`);
      const { nonBlankPx } = ctx.snapshot(path);
      expect(nonBlankPx, `capture ${c} must render the sprite`).toBeGreaterThan(0);
      shots.push(path);
    }

    // The sprite must VISIBLY change: first vs last frame differ, and at least one
    // adjacent pair differs (the animation actually advanced, not a static hold).
    const lastShot = shots.at(-1) ?? shots[0];
    const firstVsLast = await pixelDiff(shots[0], lastShot);
    expect(firstVsLast.dimsMatch).toBe(true);
    expect(firstVsLast.changed, "first vs last frame must differ (sprite animated)").toBeGreaterThan(0);

    let anyAdjacentChange = false;
    for (let i = 1; i < shots.length; i++) {
      const d = await pixelDiff(shots[i], shots[i - 1]);
      if (d.changed > 0) {
        anyAdjacentChange = true;
        break;
      }
    }
    expect(anyAdjacentChange, "at least one frame-to-frame transition must change pixels").toBe(true);

    // biome-ignore lint/suspicious/noConsole: proof evidence
    console.log(
      `ANIMATED: 20-frame Regitube atlas — first->last changed ${firstVsLast.changed}px; shots in ${OUT_DIR}`,
    );

    // Clear the sprite off the shared scene so the next test renders on a clean field.
    spr.anims.stop();
    spr.destroy();
  }, 120000);

  it("a SINGLE-frame atlas renders STATIC and unchanged (regression): no cadence, no motion", async () => {
    const key = "pkmn__er__regitube_static_test";
    await injectFixture(ctx.scene, key, "static");

    const frameNames = ctx.scene.anims.generateFrameNames(key, { zeroPad: 4, suffix: ".png", start: 1, end: 400 });
    expect(frameNames.length, "single-frame atlas exposes exactly 1 frame").toBe(1);

    // A single-frame atlas carries NO animation block -> no override.
    expect(erAtlasFrameRate(ctx.scene.textures.get(key)?.customData)).toBeUndefined();

    buildBattleAnim(ctx.scene, key);
    // Unchanged: still the engine default 10 fps.
    expect(ctx.scene.anims.get(key).frameRate, "single-frame anim keeps the default 10 fps").toBe(10);

    const spr = ctx.scene.add.sprite(960, 540, key).setOrigin(0.5, 0.5).setScale(6);
    spr.play(key);

    const shots: string[] = [];
    for (let c = 0; c < 6; c++) {
      for (let s = 0; s < 6; s++) {
        ctx.step();
        await sleep(4);
      }
      const path = join(OUT_DIR, `static-frame${String(c).padStart(2, "0")}.png`);
      const { nonBlankPx } = ctx.snapshot(path);
      expect(nonBlankPx).toBeGreaterThan(0);
      shots.push(path);
    }

    // Static: no frame-to-frame change across the whole sequence.
    const lastShot = shots.at(-1) ?? shots[0];
    const firstVsLast = await pixelDiff(shots[0], lastShot);
    expect(firstVsLast.dimsMatch).toBe(true);
    expect(firstVsLast.changed, "a single-frame sprite must NOT change across frames").toBe(0);

    // biome-ignore lint/suspicious/noConsole: proof evidence
    console.log(`STATIC: single-frame atlas unchanged across ${shots.length} captures (regression OK)`);

    spr.anims.stop();
    spr.destroy();
  }, 120000);
});
