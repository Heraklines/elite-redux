/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Live regression (2026-07-17, five reports from one pair): a SHINY-LAB skinned
// battler failed the co-op launch-ready presentation gate every run.
//
// Mechanism: the launch settle sets the base sprite visible, then calls the real
// pokemon.playAnim() - which runs refreshErShinyLabBattleFx(), and when the FX
// overlay renders the mon it DELIBERATELY hides the base sprite
// (getSprite().setVisible(false) - pokemon.ts). The readiness inspection then
// read spriteVisible=false and failed the whole shared session closed
// ("Could not render both co-op player battlers before opening commands"),
// even though the mon was fully visible on screen through the overlay.
//
// This test reproduces that exact sequence with the overlay state stubbed to
// the live evidence shape (overlay visible, base hidden by playAnim) - the
// pixel renderer itself cannot run headlessly - and requires the launch-ready
// settle to ACCEPT the overlay as the visible render surface.
// =============================================================================

import { settleCoopFieldPresentationReady } from "#data/elite-redux/coop/coop-field-presentation";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe.runIf(process.env.ER_SCENARIO === "1")("co-op launch presentation with shiny-lab FX overlay", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("accepts a battler whose base sprite is hidden behind a VISIBLE shiny-lab FX overlay", async () => {
    await game.classicMode.startBattle(SpeciesId.GOLDEEN);
    const pokemon = game.scene.getPlayerParty()[0];

    // Stub the overlay to the live evidence state: the FX overlay IS the visible render
    // surface. The real pixel pipeline cannot run headlessly; isVisible() is the exact
    // predicate the readiness gate must consult.
    const carrier = pokemon as unknown as {
      erShinyLabFxOverlay: { isVisible(): boolean; getSprite(): unknown; hide(): void; destroy(): void } | null;
      playAnim: () => void;
    };
    carrier.erShinyLabFxOverlay = {
      isVisible: () => true,
      getSprite: () => pokemon.getSprite(),
      hide: () => {},
      destroy: () => {},
    };
    // Headless cannot load the real atlas (the sprite keeps its "pkmn__back__sub" placeholder and
    // the texture/anim caches read empty), so model the REAL browser's post-load state directly:
    // caches satisfied and the sprite carrying the exact live key. The gate logic under test is
    // untouched - only the environment-shaped inputs are.
    const key = pokemon.getBattleSpriteKey();
    const texturesCarrier = game.scene.textures as unknown as { exists?: (value: string) => boolean };
    const animsCarrier = game.scene.anims as unknown as { exists?: (value: string) => boolean };
    const realTextureExists = texturesCarrier.exists?.bind(game.scene.textures);
    texturesCarrier.exists = (value: string) => value === key || realTextureExists?.(value) === true;
    const realAnimExists = animsCarrier.exists?.bind(game.scene.anims);
    animsCarrier.exists = (value: string) => value === key || realAnimExists?.(value) === true;
    // The live sequence: the settle sets the sprite visible, then playAnim's FX refresh hides the
    // base sprite because the overlay now covers it (pokemon.ts, the getSprite().setVisible(false)
    // branch of refreshErShinyLabBattleFx) - while the sprite already carries the exact live key.
    carrier.playAnim = () => {
      const spriteCarrier = pokemon.getSprite() as unknown as {
        texture: { key: string };
        anims?: { currentAnim?: { key: string } };
        setVisible: (visible: boolean) => void;
      };
      spriteCarrier.texture = { key };
      spriteCarrier.anims = { currentAnim: { key } };
      spriteCarrier.setVisible(false);
    };

    const battle = game.scene.currentBattle;
    const capacity = battle.arrangement.playerCapacity;
    const seats = game.scene
      .getPlayerParty()
      .slice(0, capacity)
      .map((seatPokemon: Pokemon, slot: number) => ({ pokemon: seatPokemon, slot }));

    // Pre-fix this REJECTED with "presentation exposed an incomplete battler surface:
    // ... spriteVisible:false" - the exact five-report live failure. The overlay-covered
    // battler must count as visually complete.
    await expect(
      settleCoopFieldPresentationReady({
        side: "player",
        seats,
        capacity,
        boundary: "launch-ready",
        desired: "visible",
        hideStale: true,
        trainerDisposition: "hide-player",
      }),
    ).resolves.toBeGreaterThanOrEqual(0);

    expect(pokemon.getSprite()?.visible, "the base sprite stays hidden behind the covering overlay").toBe(false);
  });
});
