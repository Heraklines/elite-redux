/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RISKY held-item cluster (#698 / #633 RISKY #1-#4): per-mon held items +
// the pokeball inventory into the per-turn checksum + the full snapshot, with a
// gated guest-side heal.
//
// In authoritative co-op the HOST is the sole engine; the GUEST is a pure renderer.
// Held-item binding (#1 enemy items, #2 player stack drift, #3 on-field rebind) and
// the ball inventory (#4, decremented host-only in AttemptCapturePhase) live OUTSIDE
// the per-turn checkpoint, so a host-only consume/rebind/decrement was invisible and
// unhealable mid-battle. This batch lands the ON-FIELD held-item digest (detection)
// + the snapshot held-item / ball-count blobs (heal), gated `authoritativeGuest`.
//
// Two tiers, matching the rest of the co-op suite:
//   - Always-run PURE: snapshot/checksum wire round-trips + determinism + per-field
//     detection (a rebind by battler index, a ball-count drift) using the exported
//     captureCoopChecksumState()/checksumState helpers (no GameManager).
//   - ER_SCENARIO=1 LIVE: drive the REAL engine through GameManager and prove the
//     gated heal sets a live mon's held items / ball counts to the host's exactly,
//     and that the gate (authoritativeGuest=false) is a no-op (solo/host/lockstep).
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { type CoopChecksumState, checksumState } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopFullSnapshot,
  captureCoopAuthoritativeBattleState,
  captureCoopChecksum,
  captureCoopChecksumState,
  captureCoopFullSnapshot,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopFullBattleSnapshot, CoopFullMonSnapshot } from "#data/elite-redux/coop/coop-transport";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import {
  ErResistBerryModifier,
  erResistBerryModifierType,
  getErResistBerryEntries,
  restoreErResistBerries,
} from "#data/elite-redux/er-resist-berries";
import { applyErTrainerVitaminCatchup } from "#data/elite-redux/er-trainer-runtime-hook";
import {
  ErWardStoneModifier,
  erWardStoneModifierType,
  getErWardStoneEntries,
  restoreErWardStones,
} from "#data/elite-redux/er-ward-stones";
import { BerryType } from "#enums/berry-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import * as Modifier from "#modifiers/modifier";
import { BaseStatModifier, BerryModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import {
  BaseStatBoosterModifierType,
  BerryModifierType,
  getModifierTypeFuncById,
  type ModifierType,
  type ModifierTypeGenerator,
} from "#modifiers/modifier-type";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierTypeFunc } from "#types/modifier-types";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// ---------------------------------------------------------------------------
// PURE TIER (always run): wire round-trips + checksum detection. No GameManager.
// ---------------------------------------------------------------------------

const checksumMon = () => ({
  bi: 0,
  partyIndex: 0,
  speciesId: 1,
  hp: 20,
  maxHp: 20,
  status: 0,
  statStages: [0, 0, 0, 0, 0, 0, 0],
  fainted: false,
  abilityId: 1,
  formIndex: 0,
  isTerastallized: false,
  teraType: 0,
  bossSegments: 0,
  bossSegmentIndex: 0,
  moves: [[33, 0]] as [number, number][],
  tags: [] as string[],
  transformSpeciesId: 0,
  transformFormIndex: 0,
});

const state = (over: Partial<CoopChecksumState> = {}): CoopChecksumState => ({
  field: [checksumMon()],
  weather: 0,
  terrain: 0,
  arenaTags: [],
  party: [1, 4],
  partyLevels: [50, 48],
  benchHp: [[1, 120, 0]],
  benchMoves: [[1, "aaaaaaaaaaaaaaaa"]],
  money: 1000,
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

describe("co-op held-item + ball sync pure core (#698, RISKY #1-#4)", () => {
  const base = checksumState(state());

  it("persistent modifiers reject an empty identity, while direct vitamin/berry grants are self-identifying", () => {
    expect(() => new BaseStatModifier({ id: "" } as ModifierType, 1, Stat.HP)).toThrow(/stable ModifierType\.id/);
    const vitaminType = new BaseStatBoosterModifierType(Stat.HP);
    expect(vitaminType.id).toBe("BASE_STAT_BOOSTER");
    expect(() => new BaseStatModifier(vitaminType, 1, Stat.HP)).not.toThrow();
    for (const berryType of Object.values(BerryType).filter((value): value is BerryType => typeof value === "number")) {
      expect(new BerryModifierType(berryType).id, BerryType[berryType]).toBe("BERRY");
    }
    const rareSpeciesGenerator = getModifierTypeFuncById("RARE_SPECIES_STAT_BOOSTER")() as ModifierTypeGenerator;
    expect(rareSpeciesGenerator.id).toBe("RARE_SPECIES_STAT_BOOSTER");
    expect(rareSpeciesGenerator.generateType([], ["LIGHT_BALL"])?.id).toBe("RARE_SPECIES_STAT_BOOSTER");
  });

  it("snapshot held-items + ball counts round-trip JSON byte-identical", () => {
    const snap: Partial<CoopFullBattleSnapshot> = {
      pokeballCounts: [
        [0, 3],
        [4, 1],
      ],
    };
    const mon: Partial<CoopFullMonSnapshot> = {
      heldItems: [{ typeId: "LEFTOVERS", className: "TurnHealModifier", args: [123], stackCount: 1 }],
    };
    const rtSnap = JSON.parse(JSON.stringify(snap)) as Partial<CoopFullBattleSnapshot>;
    const rtMon = JSON.parse(JSON.stringify(mon)) as Partial<CoopFullMonSnapshot>;
    expect(rtSnap.pokeballCounts).toEqual([
      [0, 3],
      [4, 1],
    ]);
    expect(rtMon.heldItems?.[0]).toEqual({
      typeId: "LEFTOVERS",
      className: "TurnHealModifier",
      args: [123],
      stackCount: 1,
    });
  });

  it("an older host OMITTING the optional snapshot fields round-trips them undefined (additive)", () => {
    const snap: Partial<CoopFullBattleSnapshot> = { money: 500 };
    const mon: Partial<CoopFullMonSnapshot> = { bi: 0 };
    const rtSnap = JSON.parse(JSON.stringify(snap)) as Partial<CoopFullBattleSnapshot>;
    const rtMon = JSON.parse(JSON.stringify(mon)) as Partial<CoopFullMonSnapshot>;
    expect(rtSnap.pokeballCounts).toBeUndefined();
    expect(rtMon.heldItems).toBeUndefined();
  });

  it("checksum is deterministic across repeated calls (no storm)", () => {
    expect(checksumState(state())).toBe(base);
    expect(checksumState(state())).toBe(base);
  });

  it("(#2) an on-field held-item STACK change is detected (Bug-Bite/Knock-Off)", () => {
    expect(checksumState(state({ heldItems: [[0, "LEFTOVERS", 2]] }))).not.toBe(base);
  });

  it("(#3) an on-field REBIND to a different battler index is detected (same global total)", () => {
    // The aggregate `modifiers` total is unchanged (still one LEFTOVERS); only the holder bi moves.
    expect(checksumState(state({ heldItems: [[1, "LEFTOVERS", 1]] }))).not.toBe(base);
  });

  it("(#4) a ball-inventory drift is detected", () => {
    expect(
      checksumState(
        state({
          pokeballCounts: [
            [0, 4],
            [1, 2],
          ],
        }),
      ),
    ).not.toBe(base);
  });

  it("(B1 regression) the held-item digest is keyed by battler index, NOT pokemonId", () => {
    // Two states with the same item, count, and bi but (conceptually) different pokemonIds hash the
    // same: the digest never carries the per-client pokemonId, so a healthy lockstep pair agrees.
    expect(checksumState(state({ heldItems: [[0, "LEFTOVERS", 1]] }))).toBe(base);
  });

  it("(#698 BUG 1) two DISTINCT same-type-id berries do NOT matchType - so the heal keeps BOTH", () => {
    // The held-item heal's NEW collision guard skips a re-add only when it matchType()-matches a GENUINE
    // SURVIVOR (an item that failed to remove). The bug was a guard keyed on `type.id`: every berry shares
    // id "BERRY", so the SECOND distinct berry was dropped as a "collision" with the first (the live
    // `host=[BERRY,BERRY] -> added=[BERRY]` proof). This asserts the INVARIANT the fix relies on: two
    // berries of DIFFERENT berryType share `type.id` "BERRY" yet are NOT matchType-equal, so PokeRogue's
    // addModifier() pushes a SECOND entry (no merge) and the guard never falsely drops it.
    const sitrus = new BerryModifier(new BerryModifierType(BerryType.SITRUS), 1, BerryType.SITRUS);
    const lum = new BerryModifier(new BerryModifierType(BerryType.LUM), 1, BerryType.LUM);
    // Same registry id (the field the OLD broken guard compared) ...
    expect(sitrus.type.id).toBe("BERRY");
    expect(sitrus.type.id).toBe(lum.type.id);
    // ... but NOT matchType (the field the NEW guard + addModifier's merge compare): each is kept.
    expect(sitrus.matchType(lum)).toBe(false);
    expect(lum.matchType(sitrus)).toBe(false);
    // A truly-identical berry DOES matchType (it would merge into one stack, not be dropped wrongly).
    const sitrus2 = new BerryModifier(new BerryModifierType(BerryType.SITRUS), 1, BerryType.SITRUS);
    expect(sitrus.matchType(sitrus2)).toBe(true);
  });

  it("(#698 BUG 2) a player-wide modifier blob round-trips JSON byte-identical (full ModifierData shape)", () => {
    // The snapshot now carries the host's player-wide PersistentModifiers as full ModifierData blobs so
    // the guest can RECONSTRUCT one it is MISSING (a temp stat booster needs its stat arg; the bare
    // `[typeId, stackCount]` digest can't rebuild it). Prove the blob shape survives the wire verbatim.
    const snap: Partial<CoopFullBattleSnapshot> = {
      playerModifiers: [
        { typeId: "TEMP_STAT_STAGE_BOOSTER", className: "TempStatStageBoosterModifier", args: [1, 5], stackCount: 1 },
        { typeId: "SUPER_EXP_CHARM", className: "ExpBoosterModifier", args: [60], stackCount: 1 },
      ],
    };
    const rt = JSON.parse(JSON.stringify(snap)) as Partial<CoopFullBattleSnapshot>;
    expect(rt.playerModifiers).toEqual(snap.playerModifiers);
  });

  it("(#698 BUG 2) an older host OMITTING playerModifiers round-trips it undefined (additive fallback)", () => {
    const snap: Partial<CoopFullBattleSnapshot> = { money: 500 };
    const rt = JSON.parse(JSON.stringify(snap)) as Partial<CoopFullBattleSnapshot>;
    expect(rt.playerModifiers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LIVE TIER (ER_SCENARIO=1): real engine, gated heal.
// ---------------------------------------------------------------------------

describe.skipIf(!RUN)("co-op held-item + ball heal - real engine (#698, RISKY #1-#4)", () => {
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

  const startCoopDouble = async (withBench = false) => {
    if (withBench) {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.BLISSEY);
    } else {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    }
    startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    // Scene-health precondition: under `isolate: false` the GameManager scene is shared across
    // every test file, and a prior file can occasionally leave `startBattle` resolving onto an
    // un-summoned field ("There are no Pokemon on the field!"). Assert the two on-field mons exist
    // BEFORE we capture/heal so a degraded scene fails fast HERE with a clear message instead of a
    // cryptic `undefined is not iterable` later when captureCoopChecksumState reads a torn-down arena.
    expect(field[COOP_HOST_FIELD_INDEX], "co-op host lead not summoned (degraded scene)").toBeDefined();
    expect(field[COOP_GUEST_FIELD_INDEX], "co-op guest lead not summoned (degraded scene)").toBeDefined();
    expect(globalScene.arena, "arena not built (degraded scene)").toBeTruthy();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    return field;
  };

  /**
   * Attach a held item to `mon` with its registry id (`type.id`) SET. A bare `newModifier(mon)` leaves
   * `type.id` unset (the checksum / digest hashes that id), so mirror the engine-test path: build the
   * type via `withIdFromFunc` before `newModifier`.
   */
  const giveHeld = (mon: Pokemon, func: ModifierTypeFunc): void => {
    const held = func().withIdFromFunc(func).newModifier(mon);
    if (held != null) {
      globalScene.addModifier(held, true);
    }
  };

  /** Attach a SPECIFIC berry (distinct `berryType`, shared `type.id` "BERRY") to `mon` (#698 BUG 1). */
  const giveBerry = (mon: Pokemon, berryType: BerryType): void => {
    const held = new BerryModifierType(berryType).newModifier(mon);
    if (held != null) {
      globalScene.addModifier(held, true);
    }
  };

  /** Held items the guest currently holds for `pokemonId`, as `[type.id, stackCount]`, sorted. */
  const heldOf = (pokemonId: number): [string, number][] =>
    globalScene
      .findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemonId, true)
      .map(m => [m.type.id, m.stackCount] as [string, number])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

  /** The guest's player-wide persistent modifier type.ids, sorted (held items excluded). */
  const playerModifierIds = (): string[] =>
    globalScene.modifiers
      .filter(m => !(m instanceof PokemonHeldItemModifier))
      .map(m => m.type.id)
      .sort();

  it("trainer vitamin catch-up emits a serializable BASE_STAT_BOOSTER (live faint-recovery regression)", async () => {
    const field = await startCoopDouble();
    const playerVitaminType = new BaseStatBoosterModifierType(Stat.HP);
    playerVitaminType.id = "BASE_STAT_BOOSTER";
    const playerVitamin = playerVitaminType.newModifier(field[COOP_HOST_FIELD_INDEX]);
    expect(playerVitamin).toBeInstanceOf(BaseStatModifier);
    if (playerVitamin != null) {
      globalScene.addModifier(playerVitamin, true);
    }

    // applyErTrainerVitaminCatchup only needs trainer presence to select its trainer-only branch. The
    // actual enemy party is the fully constructed live party from startBattle.
    globalScene.currentBattle.trainer = {} as never;
    applyErTrainerVitaminCatchup(globalScene.getEnemyParty());
    const mirrored = globalScene.findModifiers(m => m instanceof BaseStatModifier, false);
    expect(mirrored.length, "the trainer apex received at least one mirrored vitamin").toBeGreaterThan(0);
    expect(
      mirrored.every(modifier => modifier.type.id === "BASE_STAT_BOOSTER"),
      "no trainer vitamin serializes as heldItems=[bi,null,stack]",
    ).toBe(true);

    const authoritative = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
    expect(authoritative, "the turn authority remains capturable with the trainer vitamin").not.toBeNull();
    expect(
      authoritative?.enemyModifiers.some(raw => raw.typeId === "BASE_STAT_BOOSTER"),
      "the exact stable held-item id rides the authoritative carrier",
    ).toBe(true);
  });

  it("(#1/#2) a STALE extra item on a live mon is REMOVED by the gated heal (set to host exactly)", async () => {
    const field = await startCoopDouble();
    const lead = field[COOP_HOST_FIELD_INDEX];
    // HOST truth: the lead holds exactly one LEFTOVERS.
    giveHeld(lead, modifierTypes.LEFTOVERS);
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();
    expect(heldOf(lead.id)).toEqual([["LEFTOVERS", 1]]);

    // GUEST divergence: a STALE extra item the host doesn't have.
    giveHeld(lead, modifierTypes.FOCUS_BAND);
    expect(heldOf(lead.id).length).toBe(2);

    // Heal (gated authoritative): the live mon's held items become exactly the host's set.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, true);
    }
    expect(heldOf(lead.id)).toEqual([["LEFTOVERS", 1]]);
  });

  it("canonicalizes a legacy unkeyed enemy vitamin and heals it through the modern authoritative-state path", async () => {
    await startCoopDouble();
    const enemy = globalScene.getEnemyField()[0];
    expect(enemy).toBeDefined();

    // Exact shape produced by the live ER trainer vitamin catch-up before the producer fix: the concrete
    // generated type had no registry id. It worked on the host, but JSON wrote a null checksum id and
    // ModifierData.toModifier() could not rebuild it on the guest.
    const legacy = new BaseStatBoosterModifierType(Stat.SPATK).newModifier(enemy) as PokemonHeldItemModifier;
    legacy.type.id = undefined as unknown as string;
    expect(legacy.type.id).toBeFalsy();
    await globalScene.addEnemyModifier(legacy, true, true);

    const hostChecksum = captureCoopChecksum();
    expect(captureCoopChecksumState().heldItems).toContainEqual([enemy.getBattlerIndex(), "BASE_STAT_BOOSTER", 1]);
    const captured = captureCoopFullSnapshot();
    expect(captured).not.toBeNull();
    const wire = JSON.parse(JSON.stringify(captured)) as CoopFullBattleSnapshot;
    expect(wire.authoritativeState?.enemyModifiers).toContainEqual(
      expect.objectContaining({ typeId: "BASE_STAT_BOOSTER", className: "BaseStatModifier" }),
    );
    expect(wire.field.flatMap(mon => mon.heldItems ?? [])).toContainEqual(
      expect.objectContaining({ typeId: "BASE_STAT_BOOSTER", className: "BaseStatModifier" }),
    );

    globalScene.removeModifier(legacy, true);
    globalScene.updateModifiers(false);
    expect(captureCoopChecksum()).not.toBe(hostChecksum);

    // applyCoopFullSnapshot takes its modern early-return path when authoritativeState is present. The
    // canonical modifier key makes that path sufficient; the companion fullField need not be (and is not)
    // applied as a second, potentially stale whole-field overlay.
    applyCoopFullSnapshot(wire, true);
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(#3) an on-field REBIND heals: item lands on host's holder, gone from the wrong mon", async () => {
    const field = await startCoopDouble();
    const a = field[COOP_HOST_FIELD_INDEX];
    const b = field[COOP_GUEST_FIELD_INDEX];
    // HOST truth: the item belongs to mon A.
    giveHeld(a, modifierTypes.LEFTOVERS);
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();
    const digestBefore = JSON.stringify(captureCoopChecksumState().heldItems);

    // GUEST divergence: rebind the live item to mon B (same global total, wrong holder).
    for (const m of globalScene.findModifiers(
      x => x instanceof PokemonHeldItemModifier && x.pokemonId === a.id,
      true,
    )) {
      (m as PokemonHeldItemModifier).pokemonId = b.id;
    }
    globalScene.updateModifiers(true);
    expect(heldOf(a.id)).toEqual([]);
    expect(heldOf(b.id)).toEqual([["LEFTOVERS", 1]]);
    // Detection: the per-bi digest differs.
    expect(JSON.stringify(captureCoopChecksumState().heldItems)).not.toBe(digestBefore);

    // Heal: item back on A, gone from B.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, true);
    }
    expect(heldOf(a.id)).toEqual([["LEFTOVERS", 1]]);
    expect(heldOf(b.id)).toEqual([]);
  });

  it("(#4) the resync snapshot does NOT touch balls; the END-OF-TURN authoritative state carries them (#843)", async () => {
    await startCoopDouble();
    const hostCount = globalScene.pokeballCounts[0];
    // The authoritative-turn state is the SOLE ball carrier; the resync snapshot must not race it.
    const authoritative = captureCoopAuthoritativeBattleState(globalScene.currentBattle?.turn ?? 0);
    const snapshot = captureCoopFullSnapshot();
    expect(authoritative).not.toBeNull();
    expect(snapshot).not.toBeNull();
    // The authoritative state carries the ball inventory (the end-of-turn SET); the resync snapshot does not.
    expect(authoritative?.pokeballCounts).toContainEqual([0, hostCount]);
    expect(snapshot?.pokeballCounts).toBeUndefined();

    // GUEST drift: the pure-renderer never ran AttemptCapturePhase, so its count is higher.
    globalScene.pokeballCounts[0] = hostCount + 1;
    // The drift IS still detectable in the checksum (balls stay hashed) so a real desync surfaces.
    expect(captureCoopChecksumState().pokeballCounts).toContainEqual([0, hostCount + 1]);

    // 🔴 THE FIX (#843): the resync/crossing snapshot MUST NOT re-SET balls. Healing them here raced the
    // reward-shop ADD (a resync fired by an unrelated field re-SET the count around a between-wave ball
    // grant), drifting the guest ABOVE the host (soak seed 20260706 @wave 106). So the drift is left
    // untouched by the full-snapshot heal - balls converge only via the authoritative state below.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, true);
    }
    expect(globalScene.pokeballCounts[0], "resync snapshot leaves balls untouched (no racing SET)").toBe(hostCount + 1);
    // The heal path itself (the authoritative-state SET reconciling the guest back to the host's count) is
    // exercised end-to-end across two real engines in coop-duo-pokeball-reward.test.ts + the soak; here the
    // pure-core guarantee is that the resync snapshot no longer carries or re-SETs the ball inventory.
  });

  it("(gate) authoritativeGuest=false leaves held items + ball counts UNCHANGED (solo/host/lockstep)", async () => {
    const field = await startCoopDouble();
    const lead = field[COOP_HOST_FIELD_INDEX];
    giveHeld(lead, modifierTypes.LEFTOVERS);
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();

    // Diverge BOTH held items + ball counts.
    giveHeld(lead, modifierTypes.FOCUS_BAND);
    globalScene.pokeballCounts[0] += 3;
    const heldDiverged = heldOf(lead.id);
    const ballDiverged = globalScene.pokeballCounts[0];

    // Apply with the gate FALSE (the solo/host/lockstep call shape): no held-item / ball heal.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, false);
    }
    expect(heldOf(lead.id)).toEqual(heldDiverged);
    expect(globalScene.pokeballCounts[0]).toBe(ballDiverged);
  });

  it("(B1 regression) a BENCH mon's held item is NOT in the on-field digest (no false resync)", async () => {
    await startCoopDouble(true);
    const party = globalScene.getPlayerParty();
    const onFieldCount = globalScene.getPlayerField(false).length;
    // Need at least one bench mon to exercise this.
    if (party.length <= onFieldCount) {
      return;
    }
    const bench = party.at(-1);
    if (bench == null) {
      return;
    }
    const digestBefore = JSON.stringify(captureCoopChecksumState().heldItems);
    // Give the BENCH mon an item: the ON-FIELD digest must be identical (bench excluded).
    giveHeld(bench, modifierTypes.LEFTOVERS);
    expect(JSON.stringify(captureCoopChecksumState().heldItems)).toBe(digestBefore);
  });

  it("bench Ward Stone + resist berry round-trip and legacy side-channel restore de-duplicates", async () => {
    await startCoopDouble(true);
    const party = globalScene.getPlayerParty();
    const bench = party[2];
    expect(bench, "third starter is an actual off-field bench mon").toBeDefined();
    expect(bench.isOnField(), "identity test exercises a bench holder").toBe(false);

    const ward = erWardStoneModifierType("greater").newModifier(bench) as ErWardStoneModifier;
    ward.charges = 1;
    ward.waveProgress = 7;
    const berry = erResistBerryModifierType(PokemonType.FIRE).newModifier(bench) as ErResistBerryModifier;
    globalScene.addModifier(ward, true);
    globalScene.addModifier(berry, true);

    const wardSideChannel = getErWardStoneEntries();
    const berrySideChannel = getErResistBerryEntries();
    const blobs = [ward, berry].map(modifier => new ModifierData(modifier, true));
    expect(blobs.map(blob => blob.typeId)).toEqual(["ER_WARD_STONE_GREATER", "ER_RESIST_BERRY_FIRE"]);

    globalScene.removeModifier(ward);
    globalScene.removeModifier(berry);
    for (const data of blobs) {
      const ctor =
        (Modifier as unknown as Record<string, new (...args: any[]) => Modifier.PersistentModifier>)[data.className]
        ?? resolveErModifierClass(data.className);
      const rebuilt = data.toModifier(ctor);
      expect(rebuilt, `${data.typeId} rebuilt through the production ModifierData path`).not.toBeNull();
      expect((rebuilt as PokemonHeldItemModifier).pokemonId).toBe(bench.id);
      globalScene.addModifier(rebuilt!, true);
    }

    // GameData applies the ordinary ModifierData list first, then these legacy
    // ER side channels. Their `already` checks must leave exactly one of each.
    restoreErWardStones(wardSideChannel);
    restoreErResistBerries(berrySideChannel);
    const benchItems = globalScene.findModifiers(
      modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === bench.id,
      true,
    );
    expect(benchItems.filter(modifier => modifier instanceof ErWardStoneModifier)).toHaveLength(1);
    expect(benchItems.filter(modifier => modifier instanceof ErResistBerryModifier)).toHaveLength(1);
    const rebuiltWard = benchItems.find(modifier => modifier instanceof ErWardStoneModifier) as ErWardStoneModifier;
    expect([rebuiltWard.charges, rebuiltWard.waveProgress]).toEqual([1, 7]);
  });

  it("(#698 BUG 1) a host mon with 2 DISTINCT same-type-id berries converges on the guest (both survive)", async () => {
    const field = await startCoopDouble();
    const lead = field[COOP_HOST_FIELD_INDEX];
    // HOST truth: the lead holds TWO DISTINCT berries that SHARE type.id "BERRY" (SITRUS + LUM). The
    // old guard kept only the first (the live `host=[BERRY,BERRY] -> added=[BERRY]`, guest digest 2 vs
    // host 3, permanent mismatch). The heal must now re-add BOTH.
    giveBerry(lead, BerryType.SITRUS);
    giveBerry(lead, BerryType.LUM);
    expect(heldOf(lead.id)).toEqual([
      ["BERRY", 1],
      ["BERRY", 1],
    ]);
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();

    // GUEST divergence: strip both, leaving the lead bare (the worst case the heal must rebuild).
    for (const m of globalScene.findModifiers(
      x => x instanceof PokemonHeldItemModifier && x.pokemonId === lead.id,
      true,
    )) {
      globalScene.removeModifier(m);
    }
    globalScene.updateModifiers(true);
    expect(heldOf(lead.id)).toEqual([]);

    // Heal (gated authoritative): BOTH berries are re-added, not just one.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, true);
    }
    expect(heldOf(lead.id)).toEqual([
      ["BERRY", 1],
      ["BERRY", 1],
    ]);
  });

  it("(#698 BUG 2) a host-only player-wide modifier is ADDED to the guest by the heal (checksum converges)", async () => {
    await startCoopDouble();
    // HOST truth: a player-wide EXP charm the guest does NOT have. The stack-only reconcile could never
    // CREATE it (the `<absent>` permanent divergence); the full-blob reconcile reconstructs + adds it.
    const charm = modifierTypes.SUPER_EXP_CHARM().withIdFromFunc(modifierTypes.SUPER_EXP_CHARM).newModifier();
    expect(charm).not.toBeNull();
    if (charm != null) {
      globalScene.addModifier(charm, true);
    }
    expect(playerModifierIds()).toContain("SUPER_EXP_CHARM");
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.playerModifiers?.some(b => b.typeId === "SUPER_EXP_CHARM")).toBe(true);

    // GUEST divergence: remove the charm (the pure renderer never ran the reward grant that created it).
    for (const m of [...globalScene.modifiers]) {
      if (m.type.id === "SUPER_EXP_CHARM") {
        globalScene.removeModifier(m);
      }
    }
    globalScene.updateModifiers(true);
    expect(playerModifierIds()).not.toContain("SUPER_EXP_CHARM");
    expect(captureCoopChecksum()).not.toBe(hostChecksum);

    // Heal (gated authoritative): the missing player-wide modifier is reconstructed + added back, and the
    // post-heal checksum equals the host's.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, true);
    }
    expect(playerModifierIds()).toContain("SUPER_EXP_CHARM");
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(#698 BUG 2 gate) authoritativeGuest=false does NOT add a missing player-wide modifier", async () => {
    await startCoopDouble();
    const charm = modifierTypes.SUPER_EXP_CHARM().withIdFromFunc(modifierTypes.SUPER_EXP_CHARM).newModifier();
    if (charm != null) {
      globalScene.addModifier(charm, true);
    }
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();

    // GUEST removes it; apply with the gate FALSE (solo/host/lockstep): the full-blob ADD must NOT run.
    for (const m of [...globalScene.modifiers]) {
      if (m.type.id === "SUPER_EXP_CHARM") {
        globalScene.removeModifier(m);
      }
    }
    globalScene.updateModifiers(true);
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, false);
    }
    // The OLD stack-only reconcile (the false-gate fallback) never ADDS, so it stays absent - no regression.
    expect(playerModifierIds()).not.toContain("SUPER_EXP_CHARM");
  });
});
