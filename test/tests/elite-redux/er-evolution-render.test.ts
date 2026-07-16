/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER EVOLUTION-surface runtime render gate (the evolved-sprite blank / scramble).
//
// Luvdisc evolving into Discupid (ER custom species 70003) showed NO sprite for
// the EVOLVED form; Regitube's evolved form drew the raw packed sheet. Both ER
// atlases are multi-frame packed sheets (frames 0001.png..NNNN in ONE image).
//
// EvolutionPhase.configureSprite renders the evolved sprite on the evolution
// scene. It set the sprite's animation with a bare `play(key)` and NO explicit
// frame pin: on a menu/scene surface the per-species anim is not stepped, so the
// sprite is left on the atlas's whole-sheet `__BASE` frame (the scramble) - or,
// when the anim was not recovered, blank. The fix routes configureSprite through
// the shared `playErPokemonSpriteAnim` helper (pin frame 0001 + gap-fill the anim
// + play), the SAME guard the summary surface got (commit 15283704b).
//
// This drives the REAL EvolutionPhase.configureSprite through the Tier-2 CANVAS
// render harness (where setTexture/setFrame are the genuine impls, unlike the
// headless MockSprite no-ops), reproducing the live condition (atlas loaded, anim
// not stepped, `__BASE` the texture default), then asserts the evolved mon sprite
// is pinned to a single real frame - never the `__BASE` whole sheet. Gated
// ER_SCENARIO=1; needs the local er-assets checkout (../er-assets symlink).
// =============================================================================

import { ER_DISCUPID_SPECIES_ID, ER_REGITUBE_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { EvolutionPhase } from "#phases/evolution-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  createRenderScene,
  findSuspectSprites,
  type RenderContext,
  renderTwoPass,
  repointGlobalScene,
  restoreGlobalScene,
} from "#test/tools/render-harness";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Expose the protected sprite-configuration path EvolutionPhase renders through. */
class HarnessEvolutionPhase extends EvolutionPhase {
  public renderEvolvedSprite(pokemon: Pokemon, sprite: Phaser.GameObjects.Sprite): void {
    // setPipeline=false mirrors updateEvolvedPokemonSprites (the evolved-sprite path).
    this.configureSprite(pokemon, sprite, false);
  }
}

interface EvoCase {
  label: string;
  speciesId: number;
}

describe.skipIf(!RUN)("ER evolution-surface render (evolved sprite: single frame, never __BASE)", () => {
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

  const cases: EvoCase[] = [
    { label: "Discupid (blank-evolved-sprite repro)", speciesId: ER_DISCUPID_SPECIES_ID },
    { label: "Regitube (packed-sheet scramble repro)", speciesId: ER_REGITUBE_SPECIES_ID },
  ];

  it.each(cases)("$label renders a real frame on the evolution scene", async ({ speciesId }) => {
    const game = new GameManager(phaserGame);
    lastScene = game.scene;

    // The 70000-band ids throw in the vitest overrides-helper enum logging, so open
    // the battle with a vanilla species and swap the mon to the evolved ER species
    // (exactly as the live evolution builds the evolved preview mon's assets).
    await game.classicMode.startBattle(SpeciesId.LUVDISC);
    const mon = game.scene.getPlayerPokemon() as PlayerPokemon;
    expect(mon, "player mon present").toBeDefined();
    mon.species = getPokemonSpecies(speciesId);
    await mon.loadAssets(false);

    const spriteKey = mon.getSpriteKey(true);
    const atlasPath = mon.getSpriteAtlasPath(true);

    repointGlobalScene(game.scene, ctx);
    try {
      // Load the evolved atlas (WITH its frame JSON) onto the canvas render scene,
      // mirroring getPossibleEvolution -> loadAssets loading it before configureSprite.
      game.scene.loadPokemonAtlas(spriteKey, atlasPath);
      await new Promise(r => setTimeout(r, 400));
      expect(game.scene.textures.exists(spriteKey), `atlas ${spriteKey} loaded on canvas scene`).toBe(true);
      expect(
        game.scene.textures.get(spriteKey).has("0001.png"),
        `atlas ${spriteKey} is a multi-frame sheet (has 0001.png)`,
      ).toBe(true);

      // Reproduce the live evolution-scene condition faithfully. loadAssets' finalize
      // can settle via its safety backstop and register the per-species animation
      // BEFORE its frames are extractable, leaving a FRAMELESS anim under spriteKey
      // (the #396 race). Because the anim then EXISTS, the pre-fix configureSprite's
      // own missing-anim rebuild (guarded `!anims.exists`) is skipped, and a bare
      // `play` on a frameless anim cannot drive the sprite off the multi-frame
      // atlas's whole-sheet __BASE default - the blank / scramble the tester saw.
      // The fix's explicit `setFrame("0001.png")` is the ONLY thing that recovers a
      // real frame here.
      if (game.scene.anims.exists(spriteKey)) {
        game.scene.anims.remove(spriteKey);
      }
      game.scene.anims.create({ key: spriteKey, frames: [], frameRate: 10, repeat: -1 });
      game.scene.textures.get(spriteKey).firstFrame = "__BASE";

      const phase = new HarnessEvolutionPhase(mon, null, mon.level);

      let sprite: Phaser.GameObjects.Sprite | undefined;
      const run = () => {
        // The evolution scene creates the sprite from the "pkmn__sub" placeholder and
        // then configures it; configureSprite must move it onto a real evolved frame.
        const s = game.scene.add.sprite(960, 540, "pkmn__sub");
        ctx.uiInner.add(s);
        phase.renderEvolvedSprite(mon, s);
        sprite = s;
      };
      await renderTwoPass(ctx, run);

      // No visible multi-frame atlas node may still sit on its __BASE whole-sheet frame.
      const suspects = findSuspectSprites(ctx).filter(s => s.includes("__BASE") || s.includes("whole-sheet"));
      expect(suspects, `evolution-scene packed-sheet / blank suspects:\n${suspects.join("\n")}`).toEqual([]);

      // Belt-and-suspenders: the evolved mon sprite's own resolved frame is a real
      // animation frame, not the __BASE whole sheet (the blank / scramble class).
      const spriteFrame: string | undefined = sprite?.frame?.name;
      expect(spriteFrame, "evolved mon sprite has a resolved frame").toBeDefined();
      expect(spriteFrame).not.toBe("__BASE");
    } finally {
      // Restore the scene's real render members before the NEXT case constructs a
      // GameManager (which re-spies the genuine UI - our render mock lacks it).
      restoreGlobalScene(game.scene);
    }
  });
});
