/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RUN-FLOW sync: biome (B7) + run seed (B8) into the per-turn checksum and
// the full snapshot, with a guest-side heal (#698).
//
// Tier 1 (always runs, pure - no engine):
//   - the new biomeId/seed checksum fields are HASHED (a split is detectable),
//   - key-order independence + determinism still hold with them present,
//   - the new snapshot fields survive the JSON wire round-trip (set + omitted).
//
// Tier 2 (ER_SCENARIO=1-gated, real engine via GameManager):
//   - a seed split is detected + healed (setSeed re-pins),
//   - a biome split is detected + healed (newArena to the host's biome) + idempotent,
//   - the CRITICAL healthy-case NO-OP: an unchanged biome does NOT trigger newArena
//     (same scene.arena object identity before/after) and nothing drifts - the
//     false-resync-storm guard,
//   - a seed+biome divergence heals through a real JSON wire round-trip.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import type { CoopChecksumMon } from "#data/elite-redux/coop/coop-battle-checksum";
import { type CoopChecksumState, checksumState } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopFullSnapshot,
  captureCoopChecksum,
  captureCoopFullSnapshot,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopFullBattleSnapshot } from "#data/elite-redux/coop/coop-transport";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Tier 1 - pure core (always runs). Mirrors coop-battle-checksum.test.ts's
// state() factory, extended with the new biomeId/seed fields.
// ---------------------------------------------------------------------------

const mon = (over: Partial<CoopChecksumMon> = {}): CoopChecksumMon => ({
  bi: 0,
  partyIndex: 0,
  speciesId: 1,
  hp: 20,
  maxHp: 21,
  status: 0,
  statStages: [0, 0, 0, 0, 0, 0, 0],
  fainted: false,
  abilityId: 65,
  formIndex: 0,
  isTerastallized: false,
  teraType: 0,
  bossSegments: 0,
  bossSegmentIndex: 0,
  moves: [
    [33, 0],
    [22, 1],
  ],
  tags: [],
  transformSpeciesId: 0,
  transformFormIndex: 0,
  ...over,
});

const state = (over: Partial<CoopChecksumState> = {}): CoopChecksumState => ({
  field: [mon()],
  weather: 0,
  terrain: 0,
  arenaTags: [],
  party: [1, 4],
  partyLevels: [50, 48],
  benchHp: [[1, 120, 0]],
  benchMoves: [[1, "aaaaaaaaaaaaaaaa"]],
  money: 1000,
  lockModifierTiers: false,
  modifiers: [["EXP_CHARM", 1]],
  heldItems: [[0, "LEFTOVERS", 1]],
  pokeballCounts: [
    [0, 5],
    [1, 2],
  ],
  biomeId: 0,
  seed: "SEED",
  saveDataDigest: "0000000000000000",
  ...over,
});

describe("co-op run-flow sync pure core (#698, B7 + B8)", () => {
  const base = checksumState(state());

  it("(B7) a changed biomeId changes the digest", () => {
    expect(checksumState(state({ biomeId: 5 }))).not.toBe(base);
  });

  it("(B8) a changed seed changes the digest", () => {
    expect(checksumState(state({ seed: "OTHER" }))).not.toBe(base);
  });

  it("determinism: identical biomeId + seed -> identical digest across repeated calls (no storm)", () => {
    expect(checksumState(state())).toBe(base);
    expect(checksumState(state())).toBe(base);
  });

  it("KEY-ORDER INDEPENDENT with the two new fields present", () => {
    const a: CoopChecksumState = {
      seed: "SEED",
      biomeId: 7,
      money: 1000,
      weather: 0,
      terrain: 0,
      field: [mon()],
      party: [1, 4],
      partyLevels: [50, 48],
      benchHp: [[1, 120, 0]],
      benchMoves: [[1, "aaaaaaaaaaaaaaaa"]],
      arenaTags: [],
      lockModifierTiers: false,
      modifiers: [["EXP_CHARM", 1]],
      heldItems: [[0, "LEFTOVERS", 1]],
      pokeballCounts: [
        [0, 5],
        [1, 2],
      ],
      saveDataDigest: "0000000000000000",
    };
    const b: CoopChecksumState = {
      field: [mon()],
      terrain: 0,
      weather: 0,
      arenaTags: [],
      party: [1, 4],
      partyLevels: [50, 48],
      benchHp: [[1, 120, 0]],
      benchMoves: [[1, "aaaaaaaaaaaaaaaa"]],
      lockModifierTiers: false,
      modifiers: [["EXP_CHARM", 1]],
      saveDataDigest: "0000000000000000",
      pokeballCounts: [
        [0, 5],
        [1, 2],
      ],
      heldItems: [[0, "LEFTOVERS", 1]],
      money: 1000,
      biomeId: 7,
      seed: "SEED",
    };
    expect(checksumState(a)).toBe(checksumState(b));
  });

  it("wire round-trip: a snapshot WITH biomeId/seed/waveSeed survives JSON byte-identical", () => {
    const snap: Partial<CoopFullBattleSnapshot> = {
      biomeId: 18,
      seed: "ABC123",
      waveSeed: "WAVE9",
    };
    const rt = JSON.parse(JSON.stringify(snap)) as Partial<CoopFullBattleSnapshot>;
    expect(rt.biomeId).toBe(18);
    expect(rt.seed).toBe("ABC123");
    expect(rt.waveSeed).toBe("WAVE9");
  });

  it("wire round-trip: a snapshot OMITTING them round-trips with the three undefined (additive-optional)", () => {
    const snap: Partial<CoopFullBattleSnapshot> = { money: 500 };
    const rt = JSON.parse(JSON.stringify(snap)) as Partial<CoopFullBattleSnapshot>;
    expect(rt.biomeId).toBeUndefined();
    expect(rt.seed).toBeUndefined();
    expect(rt.waveSeed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tier 2 - real engine (ER_SCENARIO=1-gated). Mirrors the (B)/(C) forced-
// mismatch-and-heal structure in coop-battle-checksum-engine.test.ts.
// ---------------------------------------------------------------------------

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op run-flow sync - real engine (#698, B7 + B8)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  /** Start a co-op double (host-local spoof path) and tag field ownership. */
  const startCoopDouble = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    return field;
  };

  it("(B8) seed split detected + healed: the host snapshot re-pins the guest's run seed", async () => {
    await startCoopDouble();
    const hostChecksum = captureCoopChecksum();
    const hostSnapshot = captureCoopFullSnapshot();
    expect(hostSnapshot).not.toBeNull();
    const hostSeed = globalScene.seed;
    expect(hostSnapshot?.seed).toBe(hostSeed);

    // GUEST divergence: the run seed drifted (a no-ME segment seed split).
    globalScene.setSeed("GUEST_DIVERGED_SEED");
    expect(captureCoopChecksum(), "a seed split is detected").not.toBe(hostChecksum);

    // Heal: the snapshot re-pins the host's seed + the checksum converges.
    if (hostSnapshot != null) {
      applyCoopFullSnapshot(hostSnapshot, true);
    }
    expect(globalScene.seed, "the guest's run seed is restored to the host's").toBe(hostSeed);
    expect(captureCoopChecksum(), "checksum converges after the seed heal").toBe(hostChecksum);
  });

  it("(B7) biome split detected + healed + idempotent: newArena rebuilds to the host's biome", async () => {
    await startCoopDouble();
    const hostChecksum = captureCoopChecksum();
    const hostSnapshot = captureCoopFullSnapshot();
    expect(hostSnapshot).not.toBeNull();
    const hostBiome = globalScene.arena.biomeId;
    expect(hostSnapshot?.biomeId).toBe(hostBiome);

    // GUEST divergence: an independent biome re-roll landed it in a DIFFERENT biome.
    const divergentBiome = hostBiome === BiomeId.VOLCANO ? BiomeId.TOWN : BiomeId.VOLCANO;
    globalScene.newArena(divergentBiome);
    expect(globalScene.arena.biomeId, "the guest is in a different biome").toBe(divergentBiome);
    expect(captureCoopChecksum(), "the biome split is detected").not.toBe(hostChecksum);

    // Heal: the snapshot rebuilds the arena to the host's biome + the checksum converges.
    if (hostSnapshot != null) {
      applyCoopFullSnapshot(hostSnapshot, true);
    }
    expect(globalScene.arena.biomeId, "the guest's biome is rebuilt to the host's").toBe(hostSnapshot?.biomeId);
    expect(captureCoopChecksum(), "checksum converges after the biome heal").toBe(hostChecksum);

    // IDEMPOTENT: a SECOND apply (now already converged) must not throw or drift.
    expect(() => applyCoopFullSnapshot(hostSnapshot!, true)).not.toThrow();
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(B7+B8) healthy-case NO-OP: an unchanged biome does NOT call newArena (same arena identity)", async () => {
    await startCoopDouble();
    const hostSnapshot = captureCoopFullSnapshot();
    expect(hostSnapshot).not.toBeNull();
    const hostChecksum = captureCoopChecksum();

    // The CRITICAL false-storm guard: with NO divergence, the biome heal must be a pure no-op -
    // the newArena branch is mismatch-gated, so scene.arena stays the SAME object instance.
    const arenaBefore = globalScene.arena;
    const seedBefore = globalScene.seed;
    if (hostSnapshot != null) {
      applyCoopFullSnapshot(hostSnapshot, true);
    }
    expect(globalScene.arena, "scene.arena is the SAME object - newArena was NOT taken").toBe(arenaBefore);
    expect(globalScene.seed, "the run seed is unchanged").toBe(seedBefore);
    expect(captureCoopChecksum(), "the checksum still matches - no false resync").toBe(hostChecksum);
  });

  it("(B7+B8) JSON round-trip heal: a seed + biome divergence heals through the real wire", async () => {
    await startCoopDouble();
    const hostChecksum = captureCoopChecksum();
    const hostSnapshot = captureCoopFullSnapshot();
    expect(hostSnapshot).not.toBeNull();
    const hostBiome = globalScene.arena.biomeId;

    // Diverge BOTH seed and biome.
    globalScene.setSeed("GUEST_DIVERGED_SEED");
    const divergentBiome = hostBiome === BiomeId.VOLCANO ? BiomeId.TOWN : BiomeId.VOLCANO;
    globalScene.newArena(divergentBiome);
    expect(captureCoopChecksum(), "the seed + biome split is detected").not.toBe(hostChecksum);

    // Heal through a JSON round-trip (what crosses the wire as the compressed blob).
    if (hostSnapshot != null) {
      const roundTripped = JSON.parse(JSON.stringify(hostSnapshot)) as CoopFullBattleSnapshot;
      applyCoopFullSnapshot(roundTripped, true);
    }
    expect(globalScene.arena.biomeId, "biome healed through the wire").toBe(hostSnapshot?.biomeId);
    expect(captureCoopChecksum(), "checksum converges after the wire heal").toBe(hostChecksum);
  });
});
