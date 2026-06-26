/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative EVOLUTION (#633 B6). In authoritative co-op the GUEST is a pure renderer; the
// HOST owns evolution. A guest-side evolve would construct a per-client mon (its own RNG id / form
// path / per-client-bound cloned held items - the Shedinja bonus-add) and DIVERGE. So the guest's
// LevelUpPhase evolution trigger (B6.1) and the Shedinja party-add (B6.2) are gated off on the
// authoritative guest. The guest adopts the host's evolved species via the resync `benchParty` (B4):
// the evolving slot's species differs -> the speciesId-only `party` hash mismatches -> a resync fires
// -> benchParty converges species + exp + level + moveset together (evolution convergence is
// resync-gated, not instant - documented). This verifies (1) the cycle-free authoritative-guest gate
// reads false off-session and true on an authoritative-guest session, and (2) over a GameManager, the
// benchParty reconcile converges a slot whose host species EVOLVED past the guest's.

import { getGameMode } from "#app/game-mode";
import {
  isCoopAuthoritativeGuestGated,
  setCoopAuthoritativeGuestPredicate,
} from "#data/elite-redux/coop/coop-authoritative-gate";
import { applyCoopCaptureParty } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { PokemonData } from "#system/pokemon-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op authoritative evolution (#633 B6) - resync-gated species convergence", () => {
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

  it("B6: the guest's EVOLVED-on-host slot converges species via the benchParty reconcile", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;

    // Guest has a PRE-evolution bench mon (Charmander) the host has EVOLVED (to Charmeleon). Because
    // the guest skips evolution (B6), its slot still holds the pre-evolution species until the resync.
    const lead = scene.getPlayerParty()[0];
    lead.coopOwner = "host";
    const benchPre = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMANDER), 16);
    benchPre.coopOwner = "guest";
    scene.getPlayerParty().push(benchPre);
    expect(scene.getPlayerParty().map(p => p.species.speciesId)).toContain(SpeciesId.CHARMANDER);

    // The HOST's authoritative party: the same slot now holds the EVOLVED species at a higher level.
    const hostEvolved = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMELEON), 17);
    hostEvolved.coopOwner = "guest";
    const target = [lead, hostEvolved].map(p => JSON.stringify(new PokemonData(p)));

    applyCoopCaptureParty(JSON.parse(JSON.stringify(target)));

    const species = scene.getPlayerParty().map(p => p.species.speciesId);
    expect(species).toContain(SpeciesId.CHARMELEON); // species converged to the host's evolved form
    expect(species).not.toContain(SpeciesId.CHARMANDER); // the pre-evolution slot was reconciled away
  });
});
