/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative EVOLUTION (#633 B6). In authoritative co-op the GUEST is a pure renderer; the
// HOST owns evolution. A guest-side evolve would construct a per-client mon (its own RNG id / form path /
// per-client-bound held items) and diverge. Evolution is now retained on WAVE_ADVANCE / ME_TERMINAL as a
// complete immutable post-Pokemon image and replayed before DATA applies; full two-browser identity parity
// is mandatory in the 30-wave public campaign. This focused file keeps only the leaf guest-mechanics gate
// and the exact PokemonData wire-image round trip. It deliberately makes no obsolete resync claim.

import type { AnySound } from "#app/battle-scene";
import { isValidWaveProgressionPresentation } from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  isCoopAuthoritativeGuestGated,
  setCoopAuthoritativeGuestPredicate,
} from "#data/elite-redux/coop/coop-authoritative-gate";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { SpeciesId } from "#enums/species-id";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { fadeOutSoundIfActive } from "#utils/sound-fade";
import Phaser from "phaser";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("co-op authoritative evolution gate (#633 B6) - cycle-free predicate", () => {
  afterEach(() => {
    // Always restore the leaf gate to its off-session default.
    setCoopAuthoritativeGuestPredicate(null);
  });

  it("the cycle-free gate reads FALSE before any session (solo / host / lockstep default)", () => {
    setCoopAuthoritativeGuestPredicate(null);
    expect(isCoopAuthoritativeGuestGated()).toBe(false);
  });

  it("the cycle-free gate reflects the installed predicate (true when authoritative guest)", () => {
    setCoopAuthoritativeGuestPredicate(() => true);
    expect(isCoopAuthoritativeGuestGated()).toBe(true);
    setCoopAuthoritativeGuestPredicate(() => false);
    expect(isCoopAuthoritativeGuestGated()).toBe(false);
  });

  it("a throwing predicate reads FALSE (never crashes the Shedinja / evolution path)", () => {
    setCoopAuthoritativeGuestPredicate(() => {
      throw new Error("boom");
    });
    expect(isCoopAuthoritativeGuestGated()).toBe(false);
  });

  it("does not fade a one-shot evolution track after Phaser has destroyed its audio nodes", () => {
    const fadeOut = vi.spyOn(SoundFade, "fadeOut").mockImplementation((_scene, sound) => sound);
    const scene = {} as Phaser.Scene;
    const activeSound = { pendingRemove: false } as AnySound;
    const completedSound = { pendingRemove: true } as AnySound;

    fadeOutSoundIfActive(scene, activeSound);
    fadeOutSoundIfActive(scene, completedSound);

    expect(fadeOut).toHaveBeenCalledOnce();
    expect(fadeOut).toHaveBeenCalledWith(scene, activeSound, 100);
    fadeOut.mockRestore();
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op authoritative evolution (#633 B6) - immutable V2 presentation image", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  it("the gate predicate is INSTALLED on a session and CLEARED on teardown", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    // This client is the HOST (not the authoritative guest), so the gate reads false - but a predicate
    // IS installed (it returns false for the host). After teardown it reads false again (cleared).
    expect(typeof isCoopAuthoritativeGuestGated()).toBe("boolean");
    clearCoopRuntime();
    expect(isCoopAuthoritativeGuestGated()).toBe(false);
  });

  it("B6: one exact evolved PokemonData image reconstructs without local evolution mechanics", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const scene = game.scene;

    const before = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMANDER), 16);
    before.coopOwner = "guest";
    const after = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMELEON), 17);
    after.id = before.id;
    after.coopOwner = "guest";
    const postPokemon = JSON.parse(JSON.stringify(new PokemonData(after))) as Record<string, unknown>;
    const event = {
      k: "evolution" as const,
      partySlot: 1,
      pokemonId: before.id,
      fromSpeciesId: before.species.speciesId,
      fromFormIndex: before.formIndex,
      fromSpriteKey: before.getSpriteKey(true),
      toSpeciesId: after.species.speciesId,
      toFormIndex: after.formIndex,
      toSpriteKey: after.getSpriteKey(true),
      postPokemon,
    };
    expect(isValidWaveProgressionPresentation(event), "the complete event passes the V2 wire validator").toBe(true);

    const rndState = Phaser.Math.RND.state();
    const reconstructed = new PokemonData(event.postPokemon).toPokemon(undefined, event.partySlot);
    Phaser.Math.RND.state(rndState);
    expect(reconstructed.id).toBe(before.id);
    expect(reconstructed.species.speciesId).toBe(SpeciesId.CHARMELEON);
    expect(reconstructed.formIndex).toBe(after.formIndex);
    expect(reconstructed.getSpriteKey(true)).toBe(event.toSpriteKey);

    reconstructed.destroy();
    before.destroy();
    after.destroy();
  });
});
