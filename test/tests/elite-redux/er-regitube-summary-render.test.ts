/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Regitube SUMMARY-surface runtime render gate (the menu big-sprite scramble).
//
// Regitube's front atlas is a multi-frame packed sheet (frames 0001.png..NNNN in
// one 64x1536 image). Battle surfaces PLAY the animation (frames selected). The
// SUMMARY handler set the sprite texture WITHOUT selecting a frame and, when the
// per-species animation was not built on that surface, left the sprite on its
// whole-sheet `__BASE` frame - the scrambled packed texture the tester saw.
//
// This drives the REAL SummaryUiHandler.setSpeciesDetails path through the Tier-2
// CANVAS render harness (where setTexture/setFrame are restored to the genuine
// impls, unlike the headless MockSprite no-ops), then asserts the mon sprite is
// pinned to a single real frame (never the `__BASE` whole sheet). Gated ER_SCENARIO=1.
// =============================================================================

import { ER_REGITUBE_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
import type { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  createRenderScene,
  findSuspectSprites,
  type RenderContext,
  renderTwoPass,
  repointGlobalScene,
  restoreGlobalScene,
} from "#test/tools/render-harness";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
/** Page.ABILITIES is module-local in summary-ui-handler; its value is 1. */
const SUMMARY_PAGE_ABILITIES = 1;

describe.skipIf(!RUN)("ER Regitube summary-surface render (no packed-sheet scramble)", () => {
  let phaserGame: Phaser.Game;
  let ctx: RenderContext;
  let lastScene: any = null;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    ctx = await createRenderScene();
  });

  afterAll(() => {
    if (lastScene) {
      restoreGlobalScene(lastScene);
    }
  });

  it("Regitube's summary sprite renders a single real frame, not the __BASE sheet", async () => {
    const game = new GameManager(phaserGame);
    lastScene = game.scene;
    await game.classicMode.startBattle(ER_REGITUBE_SPECIES_ID as SpeciesId);
    const mon = game.scene.getPlayerPokemon();
    expect(mon, "Regitube player mon present").toBeDefined();

    const registered: any = game.scene.ui.handlers[UiMode.SUMMARY];
    expect(registered, "summary handler registered").toBeDefined();
    const HandlerClass = registered.constructor;

    repointGlobalScene(game.scene, ctx);

    // The summary handler assumes the mon's atlas is already loaded (it is, in
    // battle). The canvas render scene has its own TextureManager, so load the
    // Regitube front atlas (WITH its frame JSON) onto it first - mirroring the
    // real battle-time load - so the runtime setTexture/setFrame path is exercised
    // against a real multi-frame atlas (not a frameless texture).
    const spriteKey = mon!.getSpriteKey(true);
    const atlasPath = mon!.getSpriteAtlasPath(true);
    game.scene.loadPokemonAtlas(spriteKey, atlasPath);
    await new Promise(r => setTimeout(r, 400));
    expect(game.scene.textures.exists(spriteKey), `atlas ${spriteKey} loaded on canvas scene`).toBe(true);
    expect(
      game.scene.textures.get(spriteKey).has("0001.png"),
      `atlas ${spriteKey} is a multi-frame sheet (has 0001.png)`,
    ).toBe(true);
    // Simulate the REAL menu surface: the atlas texture is loaded, but the
    // per-species ANIMATION is NOT built (menu screens don't lazily build it,
    // unlike the battle field). Without that anim, setTexture defaults to the
    // whole-sheet __BASE frame - the scramble. The fix must recover here.
    if (game.scene.anims.exists(spriteKey)) {
      game.scene.anims.remove(spriteKey);
    }
    // Real Phaser (WebGL multiatlas) defaults setTexture(key) to the __BASE
    // whole-sheet frame; the canvas harness's frame injection makes 0001 the
    // default, hiding the bug. Pin __BASE as the texture default to reproduce
    // the live condition faithfully.
    game.scene.textures.get(spriteKey).firstFrame = "__BASE";

    let handler: any;
    const run = () => {
      handler = new HandlerClass();
      handler.setup();
      handler.show([mon, undefined /* SummaryUiMode.DEFAULT */, SUMMARY_PAGE_ABILITIES]);
    };
    await renderTwoPass(ctx, run);

    // The runtime mon sprite must be pinned to a real frame, never the whole
    // packed sheet. `findSuspectSprites` flags any visible multi-frame atlas
    // node still on its `__BASE` frame.
    const suspects = findSuspectSprites(ctx).filter(s => s.includes("__BASE") || s.includes("whole-sheet"));
    expect(suspects, `packed-sheet scramble suspects:\n${suspects.join("\n")}`).toEqual([]);

    // Belt-and-suspenders: the summary mon sprite's own frame is not __BASE.
    const spriteFrame: string | undefined = handler?.pokemonSprite?.frame?.name;
    expect(spriteFrame, "summary mon sprite has a resolved frame").toBeDefined();
    expect(spriteFrame).not.toBe("__BASE");
  });
});
