/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative BENCH-MON DRIFT heal (#633 B4). The live REVIVE desync: a player revives a
// fainted BENCH mon in the shop; the HOST shows it fainted (0 hp), the GUEST shows it alive (22 hp).
// The per-turn checksum + comprehensive resync healed ON-FIELD mons but NOT bench-mon HP / level / exp
// / form / friendship / moveset (the snapshot reordered the bench but never reconciled its CONTENT).
// The fix carries the WHOLE party as serialized PokemonData on the resync (`benchParty`) and reconciles
// it via the capture-handshake machinery, GATED guest-only. Plus the checksum now hashes `partyLevels`
// so a same-species bench level/revive drift the speciesId-only `party` list misses is DETECTABLE.
// This verifies (1) the snapshot carries benchParty, (2) a divergent bench mon (hp/level/exp/form)
// CONVERGES after applyCoopFullSnapshot(authoritativeGuest=true), and (3) it does NOT run for a
// non-authoritative apply (host / solo / lockstep keep their bench).

import { getGameMode } from "#app/game-mode";
import { applyCoopFullSnapshot, captureCoopFullSnapshot } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op bench-mon drift heal (#633 B4) - live revive-desync convergence", () => {
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

  it("the full snapshot CARRIES benchParty (full per-mon PokemonData for the whole party)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;
    scene.getPlayerParty().push(scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 25));

    const snap = captureCoopFullSnapshot();
    expect(snap).not.toBeNull();
    expect(Array.isArray(snap?.benchParty)).toBe(true);
    expect(snap?.benchParty?.length).toBe(scene.getPlayerParty().length);
  });

  it("B4: a divergent BENCH mon (hp / level / exp) CONVERGES after the resync heal (the revive desync)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;

    // The HOST's authoritative party: lead + a bench mon REVIVED to full hp at a higher level.
    const bench = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 22);
    scene.getPlayerParty().push(bench);
    bench.level = 24;
    bench.exp = 60_000;
    bench.calculateStats();
    bench.hp = bench.getMaxHp(); // host: alive, full hp

    const snap = JSON.parse(JSON.stringify(captureCoopFullSnapshot()));

    // Diverge the LIVE (guest) bench mon: the host's REVIVE never reached it, so the guest still shows
    // it FAINTED (0 hp) at the old level/exp - the exact live host=fainted / guest=stale split.
    bench.hp = 0;
    bench.level = 20;
    bench.exp = 30_000;
    bench.calculateStats();
    bench.hp = 0;

    // Apply the host snapshot AS THE AUTHORITATIVE GUEST (the gate the resync phase passes).
    applyCoopFullSnapshot(snap, true);

    const healed = scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.MAGIKARP);
    expect(healed).not.toBeUndefined();
    expect(healed?.level).toBe(24); // level converged
    expect(healed?.exp).toBe(60_000); // exp converged
    expect(healed?.hp).toBeGreaterThan(0); // the revive propagated (no longer fainted on the guest)
  });

  it("B4: a NON-authoritative apply (host / solo / lockstep) does NOT touch the bench", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;

    const bench = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 22);
    scene.getPlayerParty().push(bench);
    bench.level = 24;
    bench.calculateStats();

    const snap = JSON.parse(JSON.stringify(captureCoopFullSnapshot()));

    // Diverge then apply with authoritativeGuest=false (the default for host / solo / lockstep).
    bench.level = 20;
    bench.calculateStats();
    applyCoopFullSnapshot(snap, false);

    // The bench reconcile was gated off, so the guest-side divergence is left exactly as it was.
    const after = scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.MAGIKARP);
    expect(after?.level).toBe(20);
  });
});
