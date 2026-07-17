/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP REPLICATION ROUND-TRIP PROPERTY TEST (accepted-review item 4 - the centerpiece).
//
// The invariant every #875/#876-class bug must break:
//
//   capture the HOST's authoritative battle state -> serialize to JSON (the ACTUAL wire
//   encoding) -> apply to a FRESH GUEST scene -> recapture the guest's checksum view ->
//   it MUST equal the host's, BY CONSTRUCTION.
//
// "By construction" is the whole point: the capture must ALREADY exclude everything the
// apply cannot carry, so a healthy round trip is EQUAL with zero resync. The two failure
// classes are exact duals of that:
//   - #876 (ephemeral state HASHED but unappliable): a non-serializable FLINCHED tag is
//     LIVE on the host, dropped by the PokemonData wire, and never re-created on the pure-
//     renderer guest. If the hash INCLUDED it, the guest could never reproduce it -> the
//     recaptured checksum would DIVERGE (a permanent false desync). The round trip is RED.
//   - #875 (material state applied but UNHASHED): a learned bench moveset rides the wire +
//     heals, but if it is DROPPED from the hash a divergence is never DETECTED. The
//     detection sub-assertion (mutate a bench move -> the checksum MUST move) goes RED.
//
// Built on the two-engine duo harness (a REAL host BattleScene + a REAL guest BattleScene
// over the loopback) so the apply path is the production one, not a same-scene shortcut.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-roundtrip-replication.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { ErEnrageTag, FlinchedTag } from "#data/battler-tags";
import { modifierTypes } from "#data/data-lists";
import {
  applyCoopAuthoritativeBattleState,
  captureCoopAuthoritativeBattleState,
  captureCoopChecksum,
  captureCoopChecksumState,
  coopAppliedStateTick,
  drainCoopApplyFailures,
  resetCoopStateTicks,
} from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { setErBiomeOverstayAnchor } from "#data/elite-redux/er-biome-structure";
import { restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { Status } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { PersistentModifier } from "#modifiers/modifier";
import { BerryModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  installDuoLogCapture,
  setCoopHarnessModuleLetIsolation,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op replication round-trip - capture -> wire -> fresh guest apply -> recapture (item 4)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      setCoopWaveBarrierMs(50);
      setCoopRendezvousWaitMs(50);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`roundtrip-${Date.now()}`);
      // NB: no moveset OVERRIDE - readMoves/readBenchMovesDigest read getMoveset(), which a MOVESET_OVERRIDE
      // would rebuild from a fixed list on every call (masking the real per-mon movesets this test drives).
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(1)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopWaveBarrierMs(60_000);
      resetCoopRendezvousWaitMs();
      setCoopHarnessModuleLetIsolation(false);
      resetCoopStateTicks();
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    /** Add two rich BENCH mons (distinct movesets / status / level) to the HOST party BEFORE the mirror. */
    const addRichBench = (): void => {
      const a = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 20);
      const b = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 22);
      a.moveset = [new PokemonMove(MoveId.THUNDERBOLT), new PokemonMove(MoveId.QUICK_ATTACK)];
      a.moveset[0].ppUsed = 2;
      b.moveset = [new PokemonMove(MoveId.SWIFT), new PokemonMove(MoveId.BITE), new PokemonMove(MoveId.SAND_ATTACK)];
      a.status = new Status(StatusEffect.PARALYSIS, 0, 0);
      globalScene.getPlayerParty().push(a, b);
    };

    /** Enrich the HOST's live state (on-field tags + arena + modifiers + money/balls + substrates). */
    const enrichHost = (rig: DuoRig): void => {
      withClientSync(rig.hostCtx, () => {
        const arena = globalScene.arena;
        arena.trySetWeather(WeatherType.RAIN);
        arena.trySetTerrain(TerrainType.GRASSY, true);
        arena.addTag(ArenaTagType.STEALTH_ROCK, 0, MoveId.STEALTH_ROCK, 0, ArenaTagSide.ENEMY, true);

        // On-field lead: a SERIALIZABLE tag (ER_ENRAGE, survives the wire + is hashed) AND a NON-serializable
        // FLINCHED tag (#876: LIVE on the host, dropped by the wire, and DELIBERATELY excluded from the hash).
        const lead = globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
        const enrage = new ErEnrageTag();
        const flinch = new FlinchedTag(MoveId.TACKLE);
        lead.summonData.tags = [enrage, flinch];
        lead.summonData.statStages = [4, -2, 1, -3, 2, 0, 0];

        // A player-wide persistent modifier (EXP charm @ stack 2) - hashed via `modifiers` + saveDataDigest.
        const charmType = modifierTypes.EXP_CHARM().withIdFromFunc(modifierTypes.EXP_CHARM);
        const charm = charmType.newModifier() as PersistentModifier;
        charm.stackCount = 2;
        globalScene.addModifier(charm, true);

        // A dense held-item set matching the live divergence shape: two distinct same-id berries plus a
        // generated held item on the other active mon. These are added AFTER the duo mirror, so the guest
        // starts without them and the per-turn authoritative modifier materializer must reconstruct all
        // instances (not merely the first matching type id).
        const sitrus = new BerryModifierType(BerryType.SITRUS).newModifier(lead);
        const lum = new BerryModifierType(BerryType.LUM).newModifier(lead);
        const guestLead = globalScene.getPlayerField()[1];
        const leftovers = modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(guestLead);
        for (const held of [sitrus, lum, leftovers]) {
          if (held != null) {
            globalScene.addModifier(held, true);
          }
        }

        globalScene.money = 12_345;
        globalScene.pokeballCounts[0] = 7;
        globalScene.pokeballCounts[1] = 3;

        // A bench moveset CHANGE after the mirror (the #875 latent gap: the guest's mirror is now stale).
        const benchA = globalScene.getPlayerParty()[2];
        benchA.moveset = [new PokemonMove(MoveId.THUNDERBOLT), new PokemonMove(MoveId.IRON_TAIL)];

        // Module-let substrates (carried by the wire, healed via restoreCoopModuleLetSubstrates).
        restoreErMoneyStreaks([
          [111, 4],
          [222, 6],
        ]);
        setErBiomeOverstayAnchor(9);
      });
    };

    it("ROUND-TRIP: rich host state survives JSON -> fresh guest apply -> recaptured checksum is EQUAL", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      addRichBench();
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      // Faithful per-client module-let isolation so the two engines can hold DIFFERENT substrate state (prod
      // is one process per client); the apply must then HEAL the guest's to the host's.
      setCoopHarnessModuleLetIsolation(true);
      // Diverge the guest's substrates so the substrate apply does real work.
      withClientSync(rig.guestCtx, () => {
        restoreErMoneyStreaks([[999, 1]]);
        setErBiomeOverstayAnchor(null);
      });
      enrichHost(rig);
      resetCoopStateTicks();

      // HOST: capture the authoritative state (the wire) + the checksum VIEW + the hash.
      const { wire, hostState, hostChecksum } = withClientSync(rig.hostCtx, () => {
        const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
        expect(state, "host captured an authoritative state").not.toBeNull();
        return {
          wire: JSON.parse(JSON.stringify(state)) as NonNullable<typeof state>,
          hostState: captureCoopChecksumState(),
          hostChecksum: captureCoopChecksum(),
        };
      });

      // GUEST: apply the wire, then recapture. The apply MUST report clean (no structured failure) and the
      // recaptured checksum VIEW + hash MUST equal the host's - by construction, with no manual reconcile.
      const { guestState, guestChecksum, applyOk, applyFailures } = withClientSync(rig.guestCtx, () => {
        const ok = applyCoopAuthoritativeBattleState(wire, true);
        return {
          applyOk: ok,
          applyFailures: drainCoopApplyFailures(),
          guestState: captureCoopChecksumState(),
          guestChecksum: captureCoopChecksum(),
        };
      });

      expect(applyOk, "the guest apply succeeded").toBe(true);
      expect(applyFailures, "no structured per-mon/per-section apply failures on the happy path").toEqual([]);
      // THE PROPERTY: the guest's recaptured checksum view equals the host's, field-for-field.
      expect(guestState, "the recaptured guest checksum VIEW equals the host's (round-trip equal)").toEqual(hostState);
      expect(guestChecksum, "the recaptured guest HASH equals the host's").toBe(hostChecksum);
      logs.flush();
    }, 300_000);

    it("FINALE STAGE TWO: authoritative single-to-double geometry exposes and seats the partner slot", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      resetCoopStateTicks();

      const wire = withClientSync(rig.hostCtx, () => {
        expect(globalScene.currentBattle.double).toBe(true);
        expect(globalScene.getPlayerField()).toHaveLength(2);
        return JSON.parse(JSON.stringify(captureCoopAuthoritativeBattleState(2)));
      });

      withClientSync(rig.guestCtx, () => {
        // This is the finale renderer immediately before the phase-two carrier: the partner
        // remains in the party, but stage one's single arrangement cannot address field slot 1.
        globalScene.currentBattle.setDouble(false);
        expect(globalScene.getPlayerField()).toHaveLength(1);

        expect(applyCoopAuthoritativeBattleState(wire, true)).toBe(true);
        expect(globalScene.currentBattle.double, "the host's phase-two format is authoritative").toBe(true);
        const field = globalScene.getPlayerField();
        expect(field).toHaveLength(2);
        expect(field[1]?.coopOwner, "slot 1 is locally commandable by the guest").toBe("guest");
        expect(field[1]?.isActive(), "the partner is seated, not merely present on the bench").toBe(true);
      });
      logs.flush();
    }, 300_000);

    it("#876 IMMUNITY: a non-serializable FLINCHED tag LIVE on the host does NOT move the checksum", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      resetCoopStateTicks();

      const flinchImmune = withClientSync(rig.hostCtx, () => {
        const lead = globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
        lead.summonData.tags = [new ErEnrageTag()];
        const before = captureCoopChecksum();
        // Adding a NON-serializable tag (that the wire drops + the guest can never reproduce) must NOT change
        // the hash - else it is a permanent, unhealable false desync (#876).
        lead.summonData.tags = [new ErEnrageTag(), new FlinchedTag(MoveId.TACKLE)];
        const after = captureCoopChecksum();
        // A SERIALIZABLE tag change, by contrast, MUST still be detected.
        lead.summonData.tags = [];
        const withoutEnrage = captureCoopChecksum();
        return { before, after, withoutEnrage };
      });
      expect(flinchImmune.after, "a non-serializable FLINCHED tag does not move the checksum (#876)").toBe(
        flinchImmune.before,
      );
      expect(
        flinchImmune.withoutEnrage,
        "a SERIALIZABLE tag (ER_ENRAGE) change IS still detected (detection preserved)",
      ).not.toBe(flinchImmune.before);
      logs.flush();
    }, 300_000);

    it("#875 DETECTION: a learned/changed BENCH moveset MOVES the checksum (material state is hashed)", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      addRichBench();
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      resetCoopStateTicks();

      const detection = withClientSync(rig.hostCtx, () => {
        const before = captureCoopChecksum();
        // Change a BENCH mon's moveset (a reward-shop TM / Shroom learn the guest's mirror could drop, #875).
        const benchA = globalScene.getPlayerParty()[2];
        benchA.moveset = [new PokemonMove(MoveId.THUNDERBOLT), new PokemonMove(MoveId.IRON_TAIL)];
        const afterLearn = captureCoopChecksum();
        // Even a bench PP tick must move it (the digest folds [moveId, ppUsed]).
        benchA.getMoveset()[0].ppUsed += 3;
        const afterPp = captureCoopChecksum();
        return { before, afterLearn, afterPp };
      });
      expect(detection.afterLearn, "a bench moveset learn moves the checksum (#875 material state is hashed)").not.toBe(
        detection.before,
      );
      expect(detection.afterPp, "a bench PP change also moves the checksum").not.toBe(detection.afterLearn);
      logs.flush();
    }, 300_000);

    it("STRUCTURED APPLY FAILURE: a per-mon apply throw is CAPTURED (section+monId), happy path drains empty", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      addRichBench();
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      resetCoopStateTicks();

      // HOST: capture a clean authoritative state.
      const wire = withClientSync(rig.hostCtx, () => {
        const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
        return JSON.parse(JSON.stringify(state)) as NonNullable<typeof state>;
      });

      // GUEST: a CLEAN apply drains EMPTY (happy path is byte-identical behavior).
      const cleanFailures = withClientSync(rig.guestCtx, () => {
        applyCoopAuthoritativeBattleState(wire, true);
        return drainCoopApplyFailures();
      });
      expect(cleanFailures, "a clean apply records no structured failures").toEqual([]);

      // Corrupt ONE off-field BENCH mon's `ivs` to a non-iterable value. PokemonData's ctor copies `ivs`
      // verbatim (so parseAuthoritativeParty succeeds), but applyAuthoritativeMonData spreads it
      // (`[...data.ivs]`), which throws for that mon ALONE. A BENCH mon is off-field, so the failure does NOT
      // cascade into the field reconcile / render differ. The transaction must nevertheless reject the
      // WHOLE image, restore the pre-apply guest state, and preserve tick admission so the exact repaired
      // carrier remains retryable.
      resetCoopStateTicks();
      const corruptId = wire.playerParty[2].id as number;
      const corrupt = JSON.parse(JSON.stringify(wire)) as typeof wire;
      (corrupt.playerParty[2] as Record<string, unknown>).ivs = 5;

      const { applyOk, failures, before, after, admittedTick, retryOk, retryFailures } = withClientSync(
        rig.guestCtx,
        () => {
          const before = captureCoopChecksumState();
          const ok = applyCoopAuthoritativeBattleState(corrupt, true);
          const failures = drainCoopApplyFailures();
          const after = captureCoopChecksumState();
          const admittedTick = coopAppliedStateTick();
          (corrupt.playerParty[2] as Record<string, unknown>).ivs = wire.playerParty[2].ivs;
          const retryOk = applyCoopAuthoritativeBattleState(corrupt, true);
          const retryFailures = drainCoopApplyFailures();
          return { applyOk: ok, failures, before, after, admittedTick, retryOk, retryFailures };
        },
      );
      expect(applyOk, "one failed section rejects the complete authoritative transaction").toBe(false);
      expect(failures.length, "the per-mon failure is captured, not swallowed").toBeGreaterThan(0);
      const monFailure = failures.find(f => f.section === "monData");
      expect(monFailure, "the failure names the monData section").toBeDefined();
      expect(monFailure?.monId, "the failure carries the failing mon's id").toBe(corruptId);
      expect(after, "a rejected carrier leaves no partial material mutation").toEqual(before);
      expect(admittedTick, "a rejected carrier does not consume its immutable tick").toBe(-1);
      expect(retryOk, "the repaired exact-tick carrier remains admissible").toBe(true);
      expect(retryFailures).toEqual([]);
      logs.flush();
    }, 300_000);

    it("SHADOW-ATOMIC: a late material failure restores identity topology, RNG, and retry admission", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      addRichBench();
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      resetCoopStateTicks();

      const wire = withClientSync(rig.hostCtx, () => {
        const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
        expect(state).not.toBeNull();
        return JSON.parse(JSON.stringify(state)) as NonNullable<typeof state>;
      });

      const result = withClientSync(rig.guestCtx, () => {
        const beforeParty = [...globalScene.getPlayerParty()];
        const beforeEnemyParty = [...globalScene.getEnemyParty()];
        const beforeModifiers = [...globalScene.modifiers];
        const beforeArena = globalScene.arena;
        const beforeFormat = globalScene.currentBattle.format;
        const beforeChecksum = captureCoopChecksumState();
        const beforeMoney = globalScene.money;
        const beforeRnd = Phaser.Math.RND.state();

        const candidate = JSON.parse(JSON.stringify(wire)) as typeof wire;
        // Retire one prior-boundary object and force construction of a candidate-only replacement. The old
        // implementation destroyed the former before a later section could fail, so replaying a wire image
        // could only manufacture a lookalike object and leave live phase references dangling.
        const replacement = candidate.playerParty.at(-1) as Record<string, unknown>;
        replacement.id = (replacement.id as number) + 1_000_000;
        candidate.money = beforeMoney + 77_777;
        candidate.biomeId = beforeArena.biomeId === BiomeId.FOREST ? BiomeId.PLAINS : BiomeId.FOREST;
        candidate.waveSeed = "atomic-candidate-must-not-escape";

        const updateModifiers = vi.spyOn(globalScene, "updateModifiers");
        updateModifiers.mockImplementationOnce(() => {
          throw new Error("injected late modifier materialization failure");
        });
        let applyOk = false;
        try {
          applyOk = applyCoopAuthoritativeBattleState(candidate, true);
        } finally {
          updateModifiers.mockRestore();
        }
        const failures = drainCoopApplyFailures();
        const afterParty = [...globalScene.getPlayerParty()];
        const afterEnemyParty = [...globalScene.getEnemyParty()];
        const afterModifiers = [...globalScene.modifiers];
        const arenaRestored = globalScene.arena === beforeArena;
        const formatRestored = globalScene.currentBattle.format === beforeFormat;
        const checksumRestored = JSON.stringify(captureCoopChecksumState()) === JSON.stringify(beforeChecksum);
        const moneyRestored = globalScene.money === beforeMoney;
        const rndRestored = Phaser.Math.RND.state() === beforeRnd;
        const failedAdmittedTick = coopAppliedStateTick();

        const retryOk = applyCoopAuthoritativeBattleState(wire, true);
        const retryFailures = drainCoopApplyFailures();
        return {
          applyOk,
          failures,
          beforeParty,
          afterParty,
          beforeEnemyParty,
          afterEnemyParty,
          beforeModifiers,
          afterModifiers,
          arenaRestored,
          formatRestored,
          checksumRestored,
          moneyRestored,
          rndRestored,
          failedAdmittedTick,
          retryOk,
          retryFailures,
        };
      });

      expect(result.applyOk).toBe(false);
      expect(result.failures.some(failure => failure.section === "modifierRefresh")).toBe(true);
      expect(result.afterParty).toHaveLength(result.beforeParty.length);
      expect(result.afterParty.every((pokemon, index) => pokemon === result.beforeParty[index])).toBe(true);
      expect(result.afterEnemyParty.every((pokemon, index) => pokemon === result.beforeEnemyParty[index])).toBe(true);
      expect(result.afterModifiers.every((modifier, index) => modifier === result.beforeModifiers[index])).toBe(true);
      expect(result.arenaRestored).toBe(true);
      expect(result.formatRestored).toBe(true);
      expect(result.checksumRestored).toBe(true);
      expect(result.moneyRestored).toBe(true);
      expect(result.rndRestored).toBe(true);
      expect(result.failedAdmittedTick, "the failed candidate does not consume its immutable tick").toBe(-1);
      expect(result.retryOk).toBe(true);
      expect(result.retryFailures).toEqual([]);
      logs.flush();
    }, 300_000);
  },
);
