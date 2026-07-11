/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative CAPTURE handshake (#633 B1/B2/B3). In authoritative co-op the HOST is the sole
// engine; the GUEST is a pure renderer that never runs AttemptCapturePhase, so a caught mon never
// reached its party (B1), and its dex never got credit (B3). The host now carries its full post-catch
// party on the `waveResolved("capture")` signal; the guest reconciles its BENCH to match - adding the
// caught mon with the host-resolved owner (B2), releasing any party-full casualty (B9a), preserving the
// on-field leads + every unchanged bench mon's object - then credits each freshly caught mon to its OWN
// gameData (B3). This verifies (1) the wire variant round-trips, and (2) the live reconcile over a
// GameManager: append, owner-mirror, dex-credit, and the release-replace composition swap.

import { getGameMode } from "#app/game-mode";
import { applyCoopCaptureParty } from "#data/elite-redux/coop/coop-battle-engine";
import type { CoopWaveAdvancePayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  clearCoopRuntime,
  mergeCoopPendingWaveAdvance,
  resolveCoopPendingWaveTransition,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("co-op capture handshake (#633 B1/B2/B3) - wire round-trip", () => {
  it("the waveResolved capture message (with captureParty) survives a JSON round-trip byte-identical", () => {
    const msg: CoopMessage = {
      t: "waveResolved",
      wave: 7,
      outcome: "capture",
      captureParty: ['{"species":143,"level":12}', '{"species":25,"level":20,"coopOwner":"guest"}'],
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });

  it("a non-capture waveResolved omits captureParty (undefined survives the round-trip)", () => {
    const msg: CoopMessage = { t: "waveResolved", wave: 3, outcome: "win" };
    const round = JSON.parse(JSON.stringify(msg)) as Extract<CoopMessage, { t: "waveResolved" }>;
    expect(round.outcome).toBe("win");
    expect(round.captureParty).toBeUndefined();
  });

  it("a waveResolved carries the complete host-stated map-boundary transition byte-identically", () => {
    const transition: CoopWaveAdvancePayload = {
      wave: 10,
      outcome: "win",
      nextLogicalPhase: "WAVE_VICTORY",
      nextWave: 11,
      biomeChange: true,
      eggLapse: true,
      meBoundary: "none",
      victoryKind: "wild",
    };
    const msg: CoopMessage = { t: "waveResolved", wave: 10, outcome: "win", transition };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});

// #633 B1 REGRESSION (live softlock): a co-op DOUBLE wild battle resolves ONE wave with BOTH a
// "capture" (carrying the party) and a "win" (carrying none); the later message must NOT discard the
// captured party (it did, so the caught mon never reached the guest -> party desync -> ME softlock).
describe("co-op wave-advance merge preserves captureParty across a same-wave supersession (#633 B1)", () => {
  const PARTY = ['{"species":143}', '{"species":25}'];

  it("a later same-wave 'win' (no party) does NOT clobber an earlier 'capture' party", () => {
    const afterCapture = mergeCoopPendingWaveAdvance(null, 2, "capture", PARTY);
    expect(afterCapture).toEqual({ wave: 2, outcome: "capture", captureParty: PARTY });
    const afterWin = mergeCoopPendingWaveAdvance(afterCapture, 2, "win", undefined);
    expect(afterWin).toEqual({ wave: 2, outcome: "win", captureParty: PARTY }); // party carried onto win
  });

  it("a later same-wave 'capture' supplies the party when 'win' arrived first", () => {
    const afterWin = mergeCoopPendingWaveAdvance(null, 2, "win", undefined);
    expect(afterWin?.captureParty).toBeUndefined();
    const afterCapture = mergeCoopPendingWaveAdvance(afterWin, 2, "capture", PARTY);
    expect(afterCapture).toEqual({ wave: 2, outcome: "capture", captureParty: PARTY });
  });

  it("a NEW wave's signal does NOT inherit the previous wave's party", () => {
    const wave2 = mergeCoopPendingWaveAdvance(null, 2, "capture", PARTY);
    const wave3 = mergeCoopPendingWaveAdvance(wave2, 3, "win", undefined);
    expect(wave3).toEqual({ wave: 3, outcome: "win", captureParty: undefined });
  });

  it("a STALE earlier-wave signal keeps the existing later-wave pending (returns null)", () => {
    const wave3 = mergeCoopPendingWaveAdvance(null, 3, "win", undefined);
    expect(mergeCoopPendingWaveAdvance(wave3, 2, "capture", PARTY)).toBeNull();
  });
});

describe("co-op wave-advance preserves the host-stated transition at the wave-10 map boundary", () => {
  const transition: CoopWaveAdvancePayload = {
    wave: 10,
    outcome: "win",
    nextLogicalPhase: "WAVE_VICTORY",
    nextWave: 11,
    biomeChange: true,
    eggLapse: true,
    meBoundary: "none",
    victoryKind: "wild",
  };

  it("never discards biomeChange and re-derives it from the guest scene", () => {
    const pending = mergeCoopPendingWaveAdvance(null, 10, "win", undefined, undefined, transition);
    expect(pending?.transition, "the pending tail retains the host's complete wave-10 statement").toEqual(transition);
    let derived = false;
    expect(
      resolveCoopPendingWaveTransition(pending!, () => {
        derived = true;
        return { ...transition, biomeChange: false };
      }),
      "a contradictory guest-local biome verdict cannot replace the host statement",
    ).toEqual(transition);
    expect(derived, "the guest-local derivation was never evaluated").toBe(false);
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op capture handshake (#633 B1/B2/B3) - live reconcile", () => {
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

  it("B1/B2/B3(#801): own (guest-owned) catch credits the local dex; PARTNER-owned constructs do NOT", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const scene = game.scene;

    // The guest currently has just the lead. Build the host's POST-CATCH party: lead + a caught Pikachu.
    const lead = scene.getPlayerParty()[0];
    lead.coopOwner = "host";
    const caught = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 18);
    caught.coopOwner = "guest";
    const target = [lead, caught].map(p => JSON.stringify(new PokemonData(p)));

    // Wipe Pikachu's dex so the B3 credit is a clean nonzero-after assertion.
    const pikachuDex = scene.gameData.dexData[SpeciesId.PIKACHU];
    pikachuDex.caughtAttr = 0n;
    pikachuDex.seenAttr = 0n;
    expect(scene.getPlayerParty().length).toBe(1);

    applyCoopCaptureParty(JSON.parse(JSON.stringify(target)));
    // setPokemonCaught is fire-and-forget inside the reconcile; let its dex write settle.
    await new Promise(resolve => setTimeout(resolve, 50));

    const party = scene.getPlayerParty();
    expect(party.length).toBe(2); // B1: the caught mon reached the guest's party
    expect(party[1].species.speciesId).toBe(SpeciesId.PIKACHU);
    expect(party[1].coopOwner).toBe("guest"); // B2: the host-resolved owner was mirrored, not re-derived
    expect(party[0]).toBe(lead); // the on-field lead object is preserved untouched
    // This apply runs on the authoritative-GUEST renderer, so a GUEST-owned constructed mon is
    // the LOCAL player's own catch - it credits the local dex (B3 unchanged).
    expect(scene.gameData.dexData[SpeciesId.PIKACHU].caughtAttr).not.toBe(0n);

    // #801 (live account overwrite): a PARTNER-owned (host) constructed mon must NOT credit the
    // local dex - that crediting is exactly the leak that copied partners' starters onto each
    // other's accounts on every adopt. The partner's catch reaches this account only through the
    // run-scoped dexSync stream.
    const partnerCaught = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 12);
    partnerCaught.coopOwner = "host";
    const eeveeDex = scene.gameData.dexData[SpeciesId.EEVEE];
    eeveeDex.caughtAttr = 0n;
    eeveeDex.seenAttr = 0n;
    const target2 = [lead, party[1], partnerCaught].map(p => JSON.stringify(new PokemonData(p)));
    applyCoopCaptureParty(JSON.parse(JSON.stringify(target2)));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(scene.gameData.dexData[SpeciesId.EEVEE].caughtAttr, "partner-owned construct never credits local dex").toBe(
      0n,
    );
  });

  it("B9a: a party-full release (host dropped a bench mon, added the caught one) reconciles by composition", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;

    const lead = scene.getPlayerParty()[0];
    lead.coopOwner = "host";
    const benchKept = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 10);
    benchKept.coopOwner = "guest";
    const benchReleased = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIDGEY), 12);
    benchReleased.coopOwner = "guest";
    scene.getPlayerParty().push(benchKept, benchReleased);
    expect(scene.getPlayerParty().length).toBe(3);

    // Host post-catch party: lead + the kept bench mon + a NEW Eevee (Pidgey was released to make room).
    const caught = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 15);
    caught.coopOwner = "guest";
    const target = [lead, benchKept, caught].map(p => JSON.stringify(new PokemonData(p)));

    applyCoopCaptureParty(JSON.parse(JSON.stringify(target)));

    const party = scene.getPlayerParty();
    const species = party.map(p => p.species.speciesId);
    expect(party.length).toBe(3);
    expect(species).toContain(SpeciesId.SNORLAX); // lead
    expect(species).toContain(SpeciesId.MAGIKARP); // kept bench mon
    expect(species).toContain(SpeciesId.EEVEE); // caught mon added
    expect(species).not.toContain(SpeciesId.PIDGEY); // released bench mon dropped
    expect(party[0]).toBe(lead); // on-field lead preserved
    // The kept bench mon is the SAME object (matched + reused, not reconstructed - held items survive).
    expect(party.find(p => p.species.speciesId === SpeciesId.MAGIKARP)).toBe(benchKept);
  });
});
