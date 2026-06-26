/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative non-battle ME outcome resync (#633, CHANGE-4 / P4 FOUNDATION). In
// authoritative co-op the HOST is the sole non-battle-ME engine; at the ME terminal it captures a
// COMPREHENSIVE resync (`captureCoopMeOutcome`) and streams it, and the guest applies it
// field-by-field (`applyCoopMeOutcome`) so its party / ME-save / RNG cursor / dex converge. This
// verifies (1) the `meResync` wire variant survives a JSON round-trip BYTE-IDENTICAL, with the
// bigint dex fields carried as strings, and (2) over a live GameManager, a capture -> JSON
// round-trip -> apply heals the guest's party scalars + saveData + seed + dex (bigint included).

import { getGameMode } from "#app/game-mode";
import {
  applyCoopDexDelta,
  applyCoopMeOutcome,
  captureCoopDexDelta,
  captureCoopMeOutcome,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A hand-built `meResync` blob matching the wire variant (no engine needed): the `dex` field is the
// lz-string-compressed bigint-safe blob shape `captureCoopDexDelta` emits, so this proves the
// variant is pure JSON without booting the game.
const resync = (
  over: Partial<Extract<CoopInteractionOutcome, { k: "meResync" }>> = {},
): Extract<CoopInteractionOutcome, { k: "meResync" }> => ({
  k: "meResync",
  base: null,
  party: ['{"species":143,"level":12,"friendship":70}'],
  meSaveData: "[]",
  seed: "abcd1234",
  waveSeed: "wave5678",
  dex: "",
  ...over,
});

describe("co-op ME outcome resync (#633, CHANGE-4 / P4) - wire round-trip", () => {
  it("the meResync wire variant survives a JSON serialize round-trip byte-identical", () => {
    const outcome = resync({
      party: ['{"species":143,"level":50}', '{"species":131,"level":48}'],
      meSaveData: '[{"type":768}]',
      seed: "seedAAAA",
      waveSeed: "seedBBBB",
      dex: "compressed-dex-blob-placeholder",
    });
    const msg: CoopMessage = { t: "interactionOutcome", seq: 1, kind: "meResync", outcome };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });

  it("the mePresent wire variant (with subPrompt) survives a JSON round-trip byte-identical", () => {
    const present: CoopInteractionOutcome = {
      k: "mePresent",
      tokens: { itemName: "Rare Candy", selectedPokemon: "Snorlax" },
      meetsReqs: [true, false, true],
      labels: ["Take it", "Not enough money", "Leave"],
      subPrompt: { kind: "secondary", labels: ["Yes", "No"] },
    };
    const msg: CoopMessage = { t: "interactionOutcome", seq: 2, kind: "mePresent", outcome: present };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op ME outcome resync (#633, CHANGE-4 / P4) - live capture/apply heal", () => {
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

  it("captureCoopMeOutcome -> JSON round-trip -> applyCoopMeOutcome heals party scalars + saveData + seed + dex (bigint)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);

    const scene = game.scene;
    const speciesId = scene.getPlayerParty()[0].species.speciesId;

    // --- Set up an AUTHORITATIVE host state to capture ---
    const mon = scene.getPlayerParty()[0];
    mon.level = 77;
    mon.friendship = 123;
    mon.calculateStats();

    scene.mysteryEncounterSaveData.encounteredEvents = [];
    // Push one event so the saveData payload is non-trivially round-tripped.
    (scene.mysteryEncounterSaveData.encounteredEvents as unknown[]).push({ type: 1234, seen: 1 });

    scene.setSeed("HOSTSEED1234567890ABCDEF");
    scene.waveSeed = "HOSTWAVESEED0987654321";

    // A bigint dex field (the exact JSON-hostile shape the serializer must string-encode).
    const dexEntry = scene.gameData.dexData[speciesId];
    expect(dexEntry).not.toBeUndefined();
    const wantSeenAttr = (dexEntry.seenAttr | 1n) + (1n << 40n); // forces a >2^53 bigint
    const wantCaughtAttr = (dexEntry.caughtAttr | 2n) + (1n << 41n);
    dexEntry.seenAttr = wantSeenAttr;
    dexEntry.caughtAttr = wantCaughtAttr;
    dexEntry.seenCount = 9;
    dexEntry.caughtCount = 4;

    // --- Capture the host's authoritative outcome, then JSON round-trip it (the wire) ---
    const captured = captureCoopMeOutcome();
    const onWire = JSON.parse(JSON.stringify(captured)) as Extract<CoopInteractionOutcome, { k: "meResync" }>;
    expect(onWire.k).toBe("meResync");
    expect(onWire.seed).toBe("HOSTSEED1234567890ABCDEF");
    expect(onWire.party.length).toBe(scene.getPlayerParty().length);

    // --- Diverge the LIVE (guest) state away from the captured values ---
    mon.level = 5;
    mon.friendship = 0;
    mon.calculateStats();
    scene.mysteryEncounterSaveData.encounteredEvents = [];
    scene.setSeed("GUESTSEED_DIFFERENT_0001");
    scene.waveSeed = "GUESTWAVE_DIFFERENT_0002";
    dexEntry.seenAttr = 0n;
    dexEntry.caughtAttr = 0n;
    dexEntry.seenCount = 0;
    dexEntry.caughtCount = 0;

    // --- Apply the round-tripped blob; the diverged guest must converge to the host ---
    applyCoopMeOutcome(onWire);

    const healed = scene.getPlayerParty()[0];
    expect(healed.level).toBe(77);
    expect(healed.friendship).toBe(123);

    expect(scene.mysteryEncounterSaveData.encounteredEvents.length).toBe(1);
    expect((scene.mysteryEncounterSaveData.encounteredEvents[0] as { type: number }).type).toBe(1234);

    expect(scene.seed).toBe("HOSTSEED1234567890ABCDEF");
    expect(scene.waveSeed).toBe("HOSTWAVESEED0987654321");

    // The bigint dex fields round-tripped via string and decoded back to the exact bigint.
    const after = scene.gameData.dexData[speciesId];
    expect(after.seenAttr).toBe(wantSeenAttr);
    expect(after.caughtAttr).toBe(wantCaughtAttr);
    expect(after.seenCount).toBe(9);
    expect(after.caughtCount).toBe(4);
  });

  it("#633 M-1: a host party SHRINK (release / sacrifice ME) truncates the guest's surplus bench mon", async () => {
    // The M-1 regression: applyCoopMePartyFromData appends gift mons but, before the fix, NEVER
    // removed a mon the host released/sacrificed - so a release/sacrifice ME left the guest party
    // one mon LONGER than the host's (a party-length divergence that breaks the per-turn replay).
    // Here the host outcome carries a SHORTER party than the live guest; applying it must truncate
    // the surplus bench mon back to the host's length.
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const scene = game.scene;

    // Add two BENCH mons so the party is 3 long (lead + 2 bench); a release/sacrifice ME would
    // drop a bench mon on the host while the guest still holds it.
    scene.getPlayerParty().push(scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 20));
    scene.getPlayerParty().push(scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 15));
    expect(scene.getPlayerParty().length).toBe(3);
    const onField = scene.getPlayerField(false).length;

    // Capture the FULL party, then build a host outcome whose party DROPPED the last bench mon
    // (as a release/sacrifice ME would). Keep the surviving entries verbatim so only the count
    // shrinks. Never trim below the on-field count (the floor the apply enforces).
    const full = captureCoopMeOutcome();
    expect(full.party.length).toBe(3);
    const targetLen = Math.max(2, onField);
    const shrunk = { ...full, party: full.party.slice(0, targetLen) };

    const survivingSpecies = scene
      .getPlayerParty()
      .slice(0, targetLen)
      .map(p => p.species.speciesId);

    applyCoopMeOutcome(JSON.parse(JSON.stringify(shrunk)));

    // The guest party converged to the host's (shorter) length, dropping the surplus bench mon.
    expect(scene.getPlayerParty().length).toBe(targetLen);
    expect(scene.getPlayerParty().map(p => p.species.speciesId)).toEqual(survivingSpecies);
  });

  it("captureCoopDexDelta / applyCoopDexDelta round-trip a >2^53 bigint dex field standalone", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const scene = game.scene;
    const speciesId = scene.getPlayerParty()[0].species.speciesId;
    const entry = scene.gameData.dexData[speciesId];

    const wantSeen = (1n << 60n) | 7n;
    const wantCaught = (1n << 59n) | 3n;
    entry.seenAttr = wantSeen;
    entry.caughtAttr = wantCaught;

    const blob = captureCoopDexDelta();
    expect(typeof blob).toBe("string");
    expect(blob.length).toBeGreaterThan(0);

    // Wipe + decode: the bigint must survive the string encoding exactly.
    entry.seenAttr = 0n;
    entry.caughtAttr = 0n;
    applyCoopDexDelta(blob);

    expect(scene.gameData.dexData[speciesId].seenAttr).toBe(wantSeen);
    expect(scene.gameData.dexData[speciesId].caughtAttr).toBe(wantCaught);
  });
});
