/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op per-turn CHECKSUM + auto-resync over the REAL engine (#633, TRACK-2).
//
// The pure hashing logic is covered by coop-battle-checksum.test.ts; the loopback
// resync handshake by coop-battle-stream.test.ts. This tier drives the ACTUAL engine
// through GameManager to prove the checksum + the full-snapshot heal work against live
// `Pokemon`/`Arena` objects:
//
//   (A) DETERMINISM - captureCoopChecksum() over a live battle is stable across repeated
//       reads at the same boundary, and changes when battle state changes.
//   (B) CONVERGENCE - the same engine, captured -> full-snapshot -> re-applied -> re-hashed,
//       round-trips to the SAME digest (the apply path is a true inverse of the capture).
//   (C) FORCED MISMATCH + HEAL - a deliberate divergence the numeric checkpoint can't fix
//       (an abilityId / ppUsed drift) makes the host vs guest checksums differ; applying the
//       host's full snapshot HEALS it and the checksum re-converges. This is the whole
//       TRACK-2 thesis - the checksum catches exactly the drift class the checkpoint misses.
//
// Single-scene constraint (documented across the co-op suite): there is ONE globalScene in
// the test process, so "the guest" is modeled by capturing the same engine's state, applying
// the guest's transform, and re-hashing - the faithful headless substitute for a 2nd client.
// Gated ER_SCENARIO=1 like the other ER engine tests.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { DisabledTag, EncoreTag, ErBleedTag, ErFearTag, ErFrostbiteTag, SubstituteTag } from "#data/battler-tags";
import { modifierTypes } from "#data/data-lists";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopFullSnapshot,
  captureCoopAuthoritativeBattleState,
  captureCoopCheckpoint,
  captureCoopChecksum,
  captureCoopChecksumState,
  captureCoopFullSnapshot,
  resetCoopStateTicks,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { PokemonSummonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { PersistentModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { negotiateLocalSpoofPeer } from "#test/tools/coop-local-peer";
import type { TurnMove } from "#types/turn-move";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op battle checksum + resync - real engine (#633, TRACK-2)", () => {
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
    // The checksum + full-snapshot resync is the AUTHORITATIVE netcode's machinery; opt in
    // explicitly since the selectable default is now "lockstep" (#633, A/B).
    const runtime = startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    await negotiateLocalSpoofPeer(runtime);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    return field;
  };

  it("(A) captureCoopChecksum is a stable 16-char digest, deterministic at one boundary", async () => {
    await startCoopDouble();
    const h1 = captureCoopChecksum();
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    // Repeated reads at the SAME boundary (no state change) -> identical digest.
    expect(captureCoopChecksum()).toBe(h1);
    expect(captureCoopChecksum()).toBe(h1);
  });

  it("(A) the checksum changes when live battle state changes (hp drift)", async () => {
    const field = await startCoopDouble();
    const before = captureCoopChecksum();
    field[COOP_HOST_FIELD_INDEX].hp -= 1;
    const after = captureCoopChecksum();
    expect(after).not.toBe(before);
  });

  it("authority boundary clamps impossible hp before checkpoint and checksum capture", async () => {
    const field = await startCoopDouble();
    const mon = field[COOP_HOST_FIELD_INDEX];
    mon.hp = mon.getMaxHp() + 2;

    const checksumState = captureCoopChecksumState();

    expect(mon.hp).toBe(mon.getMaxHp());
    expect(checksumState.field.find(entry => entry.bi === mon.getBattlerIndex())?.hp).toBe(mon.getMaxHp());

    // Recreate the impossible state to prove checkpoint capture independently enforces the same boundary.
    mon.hp = mon.getMaxHp() + 2;

    const checkpoint = captureCoopCheckpoint();

    expect(mon.hp).toBe(mon.getMaxHp());
    expect(checkpoint?.field.find(entry => entry.bi === mon.getBattlerIndex())?.hp).toBe(mon.getMaxHp());
  });

  it("(A) a just-fainted enemy's stat stages remain checksum-visible at wave win (#878)", async () => {
    await startCoopDouble();
    const fainted = globalScene.getEnemyField(false)[0];
    expect(fainted).toBeDefined();
    fainted.hp = 0;
    fainted.summonData.statStages = [0, 0, 0, 0, 0, 0, 0];
    const before = captureCoopChecksum();

    // getField(true) drops fainted mons. If checksum capture uses that active-only view, this
    // divergence is invisible exactly at the wave-win boundary where the foe just disappeared.
    fainted.summonData.statStages[0] = 6;
    expect(captureCoopChecksum(), "fainted enemy stat-stage drift must move the checksum").not.toBe(before);
  });

  it("(B) the checksum tracks across a real resolved turn (host vs guest-after-apply converge)", async () => {
    await startCoopDouble();

    // Drive one real turn. The HOST checksum is captured at the post-turn boundary.
    game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX);
    await game.phaseInterceptor.to("TurnEndPhase");

    const hostChecksum = captureCoopChecksum();
    // Capture the host's full authoritative snapshot, then (modeling the guest) apply it
    // back onto the same live field and re-hash: the apply is a faithful inverse, so the
    // checksum must re-converge to the host's exactly.
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(C) FORCED MISMATCH the checkpoint can't fix (ability drift) is HEALED by the full snapshot", async () => {
    const field = await startCoopDouble();

    // Host's authoritative truth: snapshot + checksum BEFORE the divergence.
    const hostSnapshot = captureCoopFullSnapshot();
    const hostChecksum = captureCoopChecksum();
    expect(hostSnapshot).not.toBeNull();

    // Inject a divergence the per-turn NUMERIC checkpoint (hp/status/stages/fainted) can
    // NOT carry: swap the guest mon's active ability + bump a move's PP. A guest that only
    // applied the checkpoint would still mismatch here - which is exactly what the checksum
    // exists to catch.
    const guestMon = field[COOP_GUEST_FIELD_INDEX];
    guestMon.summonData.ability = AbilityId.MOXIE;
    guestMon.getMoveset()[0].ppUsed += 3;

    const divergedChecksum = captureCoopChecksum();
    expect(divergedChecksum).not.toBe(hostChecksum);

    // Heal: adopt the host's full authoritative snapshot wholesale. The next checksum
    // re-converges to the host's - the divergence is gone.
    if (hostSnapshot != null) {
      applyCoopFullSnapshot(hostSnapshot);
    }
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(C) a full-snapshot blob survives JSON round-trip and still heals", async () => {
    const field = await startCoopDouble();
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();

    // Diverge.
    field[COOP_GUEST_FIELD_INDEX].hp = Math.max(1, field[COOP_GUEST_FIELD_INDEX].hp - 5);
    expect(captureCoopChecksum()).not.toBe(hostChecksum);

    // Heal through a JSON round-trip (what crosses the wire as the compressed blob).
    if (snapshot != null) {
      const roundTripped = JSON.parse(JSON.stringify(snapshot));
      applyCoopFullSnapshot(roundTripped);
    }
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(D) authoritative state round-trips exotic live summonData byte-identically and preserves Pokemon.id identity", async () => {
    const field = await startCoopDouble();
    resetCoopStateTicks();

    const mon = field[COOP_HOST_FIELD_INDEX];
    const source = field[COOP_GUEST_FIELD_INDEX];
    const queuedMove: TurnMove = {
      move: MoveId.SOLAR_BEAM,
      targets: [source.getBattlerIndex()],
      result: MoveResult.SUCCESS,
      useMode: MoveUseMode.NORMAL,
    };
    const historyMove: TurnMove = {
      move: MoveId.TACKLE,
      targets: [source.getBattlerIndex()],
      result: MoveResult.SUCCESS,
      useMode: MoveUseMode.NORMAL,
    };
    const encore = new EncoreTag(source.id);
    encore.loadTag({
      tagType: BattlerTagType.ENCORE,
      turnCount: 3,
      sourceMove: MoveId.ENCORE,
      sourceId: source.id,
      moveId: MoveId.TACKLE,
    });
    const disabled = new DisabledTag(source.id);
    disabled.loadTag({
      tagType: BattlerTagType.DISABLED,
      turnCount: 2,
      sourceMove: MoveId.DISABLE,
      sourceId: source.id,
      moveId: MoveId.SPLASH,
    });
    const substitute = new SubstituteTag(MoveId.SUBSTITUTE, mon.id);
    substitute.loadTag({
      tagType: BattlerTagType.SUBSTITUTE,
      turnCount: 0,
      sourceMove: MoveId.SUBSTITUTE,
      sourceId: mon.id,
      hp: 17,
    });
    const bleed = new ErBleedTag();
    bleed.loadTag({ tagType: BattlerTagType.ER_BLEED, turnCount: 42 });
    const frostbite = new ErFrostbiteTag();
    frostbite.loadTag({ tagType: BattlerTagType.ER_FROSTBITE, turnCount: 37 });
    const fear = new ErFearTag();
    fear.loadTag({ tagType: BattlerTagType.ER_FEAR, turnCount: 2 });

    mon.summonData.statStages = [6, -6, 2, -2, 1, -1, 0];
    mon.summonData.moveQueue = [queuedMove];
    mon.summonData.moveHistory = [historyMove];
    mon.summonData.types = [PokemonType.WATER, PokemonType.GRASS];
    mon.summonData.addedType = PokemonType.GHOST;
    mon.summonData.ability = AbilityId.MOXIE;
    mon.summonData.passiveAbilities = [AbilityId.MOXIE, undefined, AbilityId.MOXIE];
    mon.summonData.speciesForm = getPokemonSpeciesForm(SpeciesId.MAGIKARP, 0);
    mon.summonData.stats = [111, 222, 333, 444, 555, 666];
    mon.summonData.moveset = [new PokemonMove(MoveId.SPLASH), new PokemonMove(MoveId.TACKLE)];
    mon.summonData.moveset[0].ppUsed = 3;
    mon.summonData.tags = [encore, disabled, substitute, bleed, frostbite, fear];

    const expectedSummonData = JSON.stringify(new PokemonData(mon).summonData);
    const expectedId = mon.id;
    const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
    expect(state).not.toBeNull();
    const roundTripped = JSON.parse(JSON.stringify(state));

    for (const seat of roundTripped.field) {
      expect(seat).not.toHaveProperty("tags");
      expect(seat).not.toHaveProperty("statStages");
      expect(seat).not.toHaveProperty("transform");
    }
    const hostMonWire = roundTripped.playerParty.find((p: Record<string, unknown>) => p.id === expectedId);
    expect(hostMonWire?.summonData).toBeDefined();
    expect((hostMonWire?.summonData as { tags: { tagType: number }[] }).tags.map(t => t.tagType).sort()).toEqual(
      [
        BattlerTagType.DISABLED,
        BattlerTagType.ENCORE,
        BattlerTagType.ER_BLEED,
        BattlerTagType.ER_FEAR,
        BattlerTagType.ER_FROSTBITE,
        BattlerTagType.SUBSTITUTE,
      ].sort(),
    );

    mon.summonData = new PokemonSummonData();
    expect(JSON.stringify(new PokemonData(mon).summonData)).not.toBe(expectedSummonData);
    expect(applyCoopAuthoritativeBattleState(roundTripped, true)).toBe(true);
    expect(globalScene.getPlayerParty().find(p => p.id === expectedId)).toBe(mon);
    expect(JSON.stringify(new PokemonData(mon).summonData)).toBe(expectedSummonData);
    expect(mon.getTag(BattlerTagType.ER_BLEED)?.turnCount).toBe(42);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)?.turnCount).toBe(37);
    expect(mon.getTag(BattlerTagType.ER_FEAR)?.turnCount).toBe(2);
  });

  // GAP 1 (#633): arena tags (hazards / screens / tailwind) are set by host MoveEffectPhases the
  // pure-renderer guest never runs, so the guest never has them and the checksum (which hashes
  // (tagType, side)) resync-loops every turn. The full snapshot now carries + reconciles them.
  it("(GAP 1) ARENA TAGS: a host hazard the guest lacks is added by the snapshot + the checksum converges", async () => {
    await startCoopDouble();
    // HOST truth: the host laid Stealth Rock on the enemy side (a MoveEffectPhase the guest never ran).
    globalScene.arena.addTag(ArenaTagType.STEALTH_ROCK, 0, MoveId.STEALTH_ROCK, 0, ArenaTagSide.ENEMY, true);
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.arenaTags.some(t => t.tagType === ArenaTagType.STEALTH_ROCK)).toBe(true);

    // GUEST divergence: the guest never ran the move, so it has no Stealth Rock -> checksum mismatch.
    globalScene.arena.removeTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY, true);
    expect(globalScene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY)).toBeUndefined();
    expect(captureCoopChecksum(), "guest desync detected before the arena-tag reconcile").not.toBe(hostChecksum);

    // Heal: the snapshot adds the missing hazard + the checksum re-converges.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(
      globalScene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY),
      "the host hazard the guest lacked was added",
    ).toBeDefined();
    expect(captureCoopChecksum(), "checksum converges after the arena-tag reconcile").toBe(hostChecksum);

    // IDEMPOTENT: re-applying the same snapshot must not double-add or throw.
    expect(() => applyCoopFullSnapshot(snapshot!)).not.toThrow();
    expect(captureCoopChecksum()).toBe(hostChecksum);
  });

  it("(GAP 1) ARENA TAGS: a screen the host cleared is REMOVED from the guest + the checksum converges", async () => {
    await startCoopDouble();
    // HOST truth (post-clear): the host has NO Reflect. Capture that snapshot/checksum first.
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();

    // GUEST divergence: the guest still has a Reflect the host already cleared (the move desync).
    globalScene.arena.addTag(ArenaTagType.REFLECT, 5, MoveId.REFLECT, 0, ArenaTagSide.PLAYER, true);
    expect(globalScene.arena.getTagOnSide(ArenaTagType.REFLECT, ArenaTagSide.PLAYER)).toBeDefined();
    expect(captureCoopChecksum(), "guest has an extra screen the host cleared").not.toBe(hostChecksum);

    // Heal: the snapshot reconcile removes the host-absent screen + the checksum re-converges.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(
      globalScene.arena.getTagOnSide(ArenaTagType.REFLECT, ArenaTagSide.PLAYER),
      "the screen the host cleared is gone from the guest",
    ).toBeUndefined();
    expect(captureCoopChecksum(), "checksum converges after the screen removal").toBe(hostChecksum);
  });

  // GAP 2 (#633): a persistent-modifier / relic STACK-COUNT divergence is hashed -> a permanent
  // still-diverged loop the checkpoint can't fix. The snapshot now reconciles the safe (non-held)
  // modifier stack counts.
  it("(GAP 2) MODIFIER STACK heal: a relic/EXP-charm stack-count drift converges via the snapshot", async () => {
    await startCoopDouble();
    // Give the player an EXP charm at stack 2 (a non-held global persistent modifier). withIdFromFunc
    // sets the registry id (`type.id`) the checksum hashes - a bare newModifier() leaves it unset.
    const charmType = modifierTypes.EXP_CHARM().withIdFromFunc(modifierTypes.EXP_CHARM);
    const charm = charmType.newModifier() as PersistentModifier;
    charm.stackCount = 2;
    globalScene.addModifier(charm, true);
    const live = globalScene.modifiers.find(m => m.type.id === "EXP_CHARM") as PersistentModifier;
    expect(live, "the EXP charm is a live player modifier").toBeDefined();

    // HOST truth at stack 2.
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot?.modifiers.some(([id, n]) => id === "EXP_CHARM" && n === 2)).toBe(true);

    // GUEST divergence: the stack count drifted to 3 (one client rolled an extra upgrade).
    live.stackCount = 3;
    expect(captureCoopChecksum(), "a stack-count divergence is detected").not.toBe(hostChecksum);

    // Heal: the snapshot sets the host's stack count back + the checksum converges.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(live.stackCount, "the guest's EXP-charm stack is set to the host's").toBe(2);
    expect(captureCoopChecksum(), "checksum converges after the modifier stack heal").toBe(hostChecksum);
  });

  // GAP 3 (#633): the checkpoint never writes maxHp (it clamps to local getMaxHp()); if maxHp
  // diverged (a genuine IV/level/form/stat-calc mismatch the guest's own calculateStats can't
  // reconcile), hp clamps to the wrong ceiling and only-hp heals loop forever. The snapshot now
  // FORCES the host's maxHp (and warns) so hp clamps correctly + getMaxHp() matches the host.
  //
  // Single-scene harness note: the guest mon IS the captured object, so calculateStats() recomputes
  // its NATURAL maxHp on apply. To model a host whose maxHp genuinely differs (the real 2-client
  // case), mutate the snapshot blob's maxHp to a value the guest's recompute will NOT produce; the
  // force then has to override calculateStats - exactly the production behavior.
  it("(GAP 3) maxHp FORCE: the snapshot forces a host maxHp the guest's recompute can't reach (+warn)", async () => {
    const field = await startCoopDouble();
    const guestMon = field[COOP_GUEST_FIELD_INDEX];
    const naturalMaxHp = guestMon.getMaxHp();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot).not.toBeNull();

    // Model a host whose maxHp for this mon is 30 HIGHER than the guest's natural recompute (a real
    // stat-calc divergence the guest can't reproduce). Force-set hp to the host's too.
    const forcedMaxHp = naturalMaxHp + 30;
    const guestBi = guestMon.getBattlerIndex();
    const snap = snapshot!;
    for (const f of snap.field) {
      if (f.bi === guestBi) {
        f.maxHp = forcedMaxHp;
        f.hp = forcedMaxHp;
      }
    }

    // Apply: the force overrides calculateStats so getMaxHp() reports the host's, and a loud
    // [coop-maxhp] warn surfaces the upstream stat divergence for a later root-cause fix.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let sawMaxHpWarn = false;
    try {
      applyCoopFullSnapshot(snap);
      // Capture the assertion BEFORE restoring the spy (mockRestore clears mock.calls).
      // The maxHp-divergence warn was refactored from a `[coop-maxhp]` prefix to the standard
      // coopWarn("resync", "maxhp divergence ...") channel; match the message, not the old prefix.
      sawMaxHpWarn = warnSpy.mock.calls.some(args => args.join(" ").toLowerCase().includes("maxhp divergence"));
    } finally {
      warnSpy.mockRestore();
    }
    expect(guestMon.getMaxHp(), "the guest maxHp is FORCED to the host's (calculateStats overridden)").toBe(
      forcedMaxHp,
    );
    // hp now clamps to the FORCED max (not the lower natural one), so the host's hp value applied.
    expect(guestMon.hp, "hp clamps correctly to the forced (host) max").toBe(forcedMaxHp);
    expect(sawMaxHpWarn, "a loud [coop-maxhp] warn surfaces the upstream stat divergence").toBe(true);
  });

  // GAP 4 (#633): the snapshot carries the player party order but did not rewrite it; a bench-order
  // divergence is hashed -> a permanent loop. The snapshot now adopts the host's bench order
  // (off-field only - safe). Reordering the guest's bench to match the host's converges the checksum.
  it("(GAP 4) PARTY ORDER adopt: the guest's bench is reordered to the host's order + the checksum converges", async () => {
    await startCoopDouble();
    // Add two distinct bench mons (party slots 2,3 behind the 2 on-field leads).
    const a = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    const b = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 5);
    globalScene.getPlayerParty().push(a, b);

    // HOST truth: capture the snapshot with the host's party order [..leads.., Pikachu, Eevee].
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot?.party.slice(-2)).toEqual([a.species.speciesId, b.species.speciesId]);

    // GUEST divergence: swap the two bench mons (the merged-roster bench-order drift).
    const party = globalScene.getPlayerParty();
    const i = party.indexOf(a);
    const j = party.indexOf(b);
    [party[i], party[j]] = [party[j], party[i]];
    expect(captureCoopChecksum(), "the bench-order divergence is detected").not.toBe(hostChecksum);

    // Heal: the snapshot adopts the host's bench order + the checksum re-converges.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(globalScene.getPlayerParty().slice(-2), "the guest's bench matches the host's order").toEqual([a, b]);
    expect(captureCoopChecksum(), "checksum converges after the party-order adopt").toBe(hostChecksum);
  });

  // GAP 7 (#633): a dropped Tera command (type/STAB change) is now DETECTED (the checksum hashes
  // isTerastallized + teraType) and FORCED by the snapshot. A structural moveset divergence rebuilds.
  it("(GAP 7) TERA force: a dropped Tera command is detected + forced back by the snapshot", async () => {
    const field = await startCoopDouble();
    // HOST truth: the host's guest-slot mon Terastallized this turn.
    const mon = field[COOP_GUEST_FIELD_INDEX];
    mon.isTerastallized = true;
    mon.teraType = PokemonType.FIRE;
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();
    expect(snapshot?.field.some(f => f.isTerastallized === true && f.teraType === PokemonType.FIRE)).toBe(true);

    // GUEST divergence: the guest dropped the Tera command, so it is NOT terastallized.
    mon.isTerastallized = false;
    expect(captureCoopChecksum(), "the dropped Tera is detected").not.toBe(hostChecksum);

    // Heal: the snapshot forces the host's Tera state back + the checksum re-converges.
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(mon.isTerastallized, "the guest's Tera state is forced to the host's").toBe(true);
    expect(mon.teraType).toBe(PokemonType.FIRE);
    expect(captureCoopChecksum(), "checksum converges after the Tera force").toBe(hostChecksum);
  });

  it("(GAP 7) MOVESET rebuild: a structural move-ID divergence is rebuilt from the host's list", async () => {
    const field = await startCoopDouble();
    // Clear the global MOVESET_OVERRIDE so getMoveset() reads the mon's REAL `moveset` array (the
    // override otherwise rebuilds the moveset from the fixed list on every read, masking a rebuild).
    game.override.moveset([]);
    const guestMon = field[COOP_GUEST_FIELD_INDEX];
    // Give the mon a concrete real moveset so the capture has authoritative move ids.
    guestMon.moveset = [new PokemonMove(MoveId.TACKLE), new PokemonMove(MoveId.GROWL)];
    const hostMoveIds = guestMon.getMoveset().map(m => m.moveId);
    const hostChecksum = captureCoopChecksum();
    const snapshot = captureCoopFullSnapshot();

    // GUEST divergence: swap slot 0 to a DIFFERENT move id (a structural change, not just ppUsed).
    guestMon.moveset = [new PokemonMove(MoveId.EARTHQUAKE), new PokemonMove(MoveId.GROWL)];
    expect(guestMon.getMoveset()[0].moveId, "a different move id now occupies slot 0").toBe(MoveId.EARTHQUAKE);
    expect(captureCoopChecksum(), "the move-id divergence is detected").not.toBe(hostChecksum);

    // Heal: the snapshot REBUILDS the moveset from the host's list (not just aligns PP).
    if (snapshot != null) {
      applyCoopFullSnapshot(snapshot);
    }
    expect(
      guestMon.getMoveset().map(m => m.moveId),
      "the moveset is rebuilt to the host's move ids",
    ).toEqual(hostMoveIds);
    expect(captureCoopChecksum(), "checksum converges after the moveset rebuild").toBe(hostChecksum);
  });
});
