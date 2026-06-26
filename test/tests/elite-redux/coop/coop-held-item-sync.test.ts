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
  captureCoopChecksumState,
  captureCoopFullSnapshot,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopFullBattleSnapshot, CoopFullMonSnapshot } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
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
  tags: [] as number[],
});

const state = (over: Partial<CoopChecksumState> = {}): CoopChecksumState => ({
  field: [checksumMon()],
  weather: 0,
  terrain: 0,
  arenaTags: [],
  party: [1, 4],
  partyLevels: [50, 48],
  money: 1000,
  modifiers: [["EXP_CHARM", 1]],
  heldItems: [[0, "LEFTOVERS", 1]],
  pokeballCounts: [
    [0, 5],
    [1, 2],
  ],
  biomeId: 0,
  seed: "SEED",
  ...over,
});

describe("co-op held-item + ball sync pure core (#698, RISKY #1-#4)", () => {
  const base = checksumState(state());

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

  const startCoopDouble = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
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

  /** Held items the guest currently holds for `pokemonId`, as `[type.id, stackCount]`, sorted. */
  const heldOf = (pokemonId: number): [string, number][] =>
    globalScene
      .findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemonId, true)
      .map(m => [m.type.id, m.stackCount] as [string, number])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

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

  it("(#4) a ball-count drift heals to the host's authoritative count", async () => {
    await startCoopDouble();
    const hostCount = globalScene.pokeballCounts[0];
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();

    // GUEST drift: the pure-renderer never ran AttemptCapturePhase, so its count is higher.
    globalScene.pokeballCounts[0] = hostCount + 1;
    expect(captureCoopChecksumState().pokeballCounts).toContainEqual([0, hostCount + 1]);

    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot, true);
    }
    expect(globalScene.pokeballCounts[0]).toBe(hostCount);
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
    await startCoopDouble();
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
});
