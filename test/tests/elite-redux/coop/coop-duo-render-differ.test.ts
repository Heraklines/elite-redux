/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op PHASE-3 RENDER DIFFER (#838). After the guest applies the host's authoritative
// full-state, a systematic differ reconciles the guest's RENDER to that DATA. Its granularity is
// deliberately INVERTED so a MISSED field degrades to a harmless extra refresh, never a stale visual:
//   - CHEAP REFRESH runs UNCONDITIONALLY on every on-field mon (battle-info bars: hp / the ER status
//     badge / name / gender / level / stat-stage text / shiny+tera icons) + boss segment dividers +
//     BOTH held-item indicator bars.
//   - The EXPENSIVE RE-SUMMON (load the atlas + replay the sprite) fires for a newly presented object or
//     when getBattleSpriteKey INPUTS (species / form / shiny / variant / fusion / gender) change. It stays
//     off on routine hp/status turns while ensuring a new authoritative replacement leaves its placeholder.
//
// These tests drive TWO real engines (buildDuo): the HOST captures its authoritative state, the GUEST
// applies it through the REAL apply path (applyCoopAuthoritativeBattleState -> runCoopRenderDiffer), and
// we assert the render-adjacent facts the harness CAN see headlessly - which canonical refresh helpers
// fired (updateInfo / updateModifiers) and whether a re-summon (loadAssets) fired. The apply is driven
// DIRECTLY (not through the turn pump) so the differ's before/after sprite-key gate is deterministic.
//
// THE MAINTAINER'S LIVE REPORT ("enemy items don't seem synced", build mr9oh5r8-kjr @wave 7) is the
// item-bar case: the DATA converges (both clients' checksums incl. heldItemsDigest matched) but the
// enemy held-item bar never REDRAWS on the guest, because the modifier reconcile only calls
// updateModifiers when it detects a change. The differ's UNCONDITIONAL updateModifiers(false) closes it
// - a missed change degrades to a harmless extra bar rebuild instead of a stale bar. That is exactly the
// "cheap-refresh unconditional path is NEW" fails-before case: on a NO-CHANGE apply, HEAD never touched
// the enemy item bar; the differ does.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-render-differ.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  applyCoopAuthoritativeBattleState,
  captureCoopAuthoritativeBattleState,
  captureCoopChecksum,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, type DuoRig, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO Phase-3 render differ: cheap refresh unconditional, re-summon key-gated (#838)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`render-differ-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(5)
        .enemyMoveset(MoveId.SPLASH)
        .enemyHeldItems([{ name: "LEFTOVERS" }])
        .startingLevel(50)
        .moveset([MoveId.TACKLE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** startBattle + stand up the guest engine + both runtimes over one loopback pair. */
    async function setup(): Promise<DuoRig> {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      return buildDuo(game, pair, setCoopRuntime, toCoop);
    }

    /**
     * Capture the host's authoritative state (JSON round-tripped, faithful to the wire) and apply it to the
     * guest through the REAL apply path (which runs the render differ). Asserts both halves succeeded.
     */
    async function applyOnce(rig: DuoRig): Promise<void> {
      const state = await withClient(rig.hostCtx, () => {
        const s = captureCoopAuthoritativeBattleState(rig.hostScene.currentBattle.turn);
        return s == null ? null : (JSON.parse(JSON.stringify(s)) as NonNullable<typeof s>);
      });
      expect(state, "host captured an authoritative state").not.toBeNull();
      const applied = await withClient(rig.guestCtx, () => applyCoopAuthoritativeBattleState(state ?? undefined, true));
      expect(applied, "guest accepted + applied the authoritative state").toBe(true);
    }

    /** The `type.id`s the guest's on-field enemies currently hold, flattened + sorted. */
    function enemyHeldIds(scene: BattleScene): string[] {
      return scene
        .findModifiers(m => m instanceof PokemonHeldItemModifier, false)
        .map(m => m.type.id)
        .sort();
    }

    it("cheap refresh is UNCONDITIONAL: on a NO-CHANGE apply the guest still refreshes both item bars + every on-field battle-info (fails-before)", async () => {
      const rig = await setup();
      // Converge once so the guest holds the host's enemy items (this first apply legitimately redraws as it
      // ADDS them). A subsequent identical apply is then a genuine no-op for the modifier reconcile.
      await applyOnce(rig);

      // Spy the guest render surface, THEN apply an identical authoritative state (fresh tick). The modifier
      // reconcile sees no change (changed=false), so on HEAD updateModifiers(false) would NOT fire and the
      // enemy item bar would stay stale; the differ refreshes it (and the player bar + every on-field mon's
      // battle-info) UNCONDITIONALLY.
      const spies = await withClient(rig.guestCtx, () => ({
        modifiers: vi.spyOn(rig.guestScene, "updateModifiers"),
        info: rig.guestScene.getField(true).map(m => vi.spyOn(m, "updateInfo").mockResolvedValue()),
        load: rig.guestScene.getField(true).map(m => vi.spyOn(m, "loadAssets").mockResolvedValue()),
      }));

      await applyOnce(rig);

      // Both held-item indicator bars rebuilt unconditionally (the enemy bar is the maintainer's bug).
      expect(spies.modifiers, "enemy held-item bar refreshed unconditionally").toHaveBeenCalledWith(false, true);
      expect(spies.modifiers, "player held-item bar refreshed unconditionally").toHaveBeenCalledWith(true, true);
      // Every on-field mon's battle-info bar refreshed (hp / status badge / name / level / stat text).
      expect(spies.info.length, "there are on-field mons to refresh").toBeGreaterThan(0);
      expect(
        spies.info.every(s => s.mock.calls.length > 0),
        "every on-field mon's battle-info was refreshed",
      ).toBe(true);
      // A no-change apply is CHEAP-only: nothing re-summoned (no atlas reload).
      expect(
        spies.load.some(s => s.mock.calls.length > 0),
        "no re-summon on a no-change apply (cheap refresh only)",
      ).toBe(false);
    }, 300_000);

    it("enemy item CHANGE: after the host enemy loses a held item the guest DROPS it (data) AND its item bar refreshes (render)", async () => {
      const rig = await setup();
      await applyOnce(rig);

      const heldBefore = await withClient(rig.guestCtx, () => enemyHeldIds(rig.guestScene));
      expect(heldBefore, "guest enemy holds the host's item after converging").toContain("LEFTOVERS");

      // HOST truth changes: the enemy consumes / loses its held item.
      await withClient(rig.hostCtx, () => {
        for (const m of rig.hostScene.findModifiers(x => x instanceof PokemonHeldItemModifier, false)) {
          rig.hostScene.removeModifier(m, true);
        }
        rig.hostScene.updateModifiers(false);
      });

      const modSpy = await withClient(rig.guestCtx, () => vi.spyOn(rig.guestScene, "updateModifiers"));
      await applyOnce(rig);

      const heldAfter = await withClient(rig.guestCtx, () => enemyHeldIds(rig.guestScene));
      expect(heldAfter, "guest enemy DROPPED the item - DATA converged").not.toContain("LEFTOVERS");
      expect(modSpy, "guest enemy held-item bar was redrawn - RENDER refreshed").toHaveBeenCalledWith(false, true);
    }, 300_000);

    it("repairs hidden-but-correct field objects absolutely without changing authoritative state", async () => {
      const rig = await setup();
      await applyOnce(rig);
      const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());
      const hidden = await withClient(rig.guestCtx, () => {
        const player = rig.guestScene.getPlayerParty()[0];
        const enemy = rig.guestScene.getEnemyParty()[0];
        for (const mon of [player, enemy]) {
          // Keep actual field membership intact while corrupting presentation only: this is the live class
          // a logical checksum cannot detect. Also retain the interrupted-Return transition flag: it makes
          // isOnField() lie even while the object remains in the Phaser container.
          mon.switchOutStatus = true;
          mon.setVisible(false);
          mon.setAlpha(0);
          mon.setScale(0.25);
          mon.getSprite().setVisible(false);
          mon.getSprite().setTint(0xff00ff);
          mon.getBattleInfo().setVisible(false);
        }
        return [player, enemy];
      });

      await applyOnce(rig);

      await withClient(rig.guestCtx, () => {
        for (const mon of hidden) {
          expect(mon.isOnField(), `${mon.name} remains seated`).toBe(true);
          expect(mon.visible, `${mon.name} container visibility is repaired`).toBe(true);
          expect(mon.alpha, `${mon.name} alpha is repaired`).toBe(1);
          expect(mon.scaleX, `${mon.name} scale is repaired`).toBe(mon.getSpriteScale());
          expect(mon.getSprite().visible, `${mon.name} sprite visibility is repaired`).toBe(true);
          expect(mon.getBattleInfo().visible, `${mon.name} info visibility is repaired`).toBe(true);
        }
      });
      const guestChecksum = await withClient(rig.guestCtx, () => captureCoopChecksum());
      expect(guestChecksum, "pure render repair leaves the guest logically identical to the host").toBe(hostChecksum);
    }, 300_000);

    it("loads the atlas when authority seats an object that had no pre-apply presentation key", async () => {
      const rig = await setup();
      await applyOnce(rig);
      const enemy = await withClient(rig.guestCtx, () => rig.guestScene.getEnemyParty()[0]);
      const loadSpy = await withClient(rig.guestCtx, () => {
        rig.guestScene.field.remove(enemy, false);
        enemy.setVisible(false);
        enemy.getSprite().setVisible(false);
        enemy.getBattleInfo().setVisible(false);
        return vi.spyOn(enemy, "loadAssets").mockResolvedValue();
      });

      await applyOnce(rig);

      await withClient(rig.guestCtx, () => {
        expect(enemy.isOnField(), "the host-presented replacement is seated").toBe(true);
        expect(enemy.visible, "the host-presented replacement container is visible").toBe(true);
        expect(enemy.getSprite().visible, "the host-presented replacement sprite is visible").toBe(true);
      });
      expect(
        loadSpy,
        "a newly presented object loads its real atlas even though no pre-apply sprite key existed",
      ).toHaveBeenCalled();
    }, 300_000);

    it("does not reveal logical active slots when the host carrier says they are pre-intro/off-field", async () => {
      const rig = await setup();
      await applyOnce(rig);
      const state = await withClient(rig.hostCtx, () => {
        for (const mon of [...rig.hostScene.getPlayerParty(), ...rig.hostScene.getEnemyParty()]) {
          if (mon.isOnField()) {
            rig.hostScene.field.remove(mon, false);
          }
          mon.setVisible(false);
          mon.getSprite().setVisible(false);
          mon.getBattleInfo().setVisible(false);
        }
        const captured = captureCoopAuthoritativeBattleState(rig.hostScene.currentBattle.turn);
        return captured == null ? null : (JSON.parse(JSON.stringify(captured)) as NonNullable<typeof captured>);
      });
      expect(
        state?.field.every(seat => seat.presented === false),
        "host states the pre-intro visual boundary",
      ).toBe(true);
      const applied = await withClient(rig.guestCtx, () => applyCoopAuthoritativeBattleState(state ?? undefined, true));
      expect(applied, "guest accepted the pre-intro carrier").toBe(true);
      await withClient(rig.guestCtx, () => {
        for (const mon of [...rig.guestScene.getPlayerParty(), ...rig.guestScene.getEnemyParty()]) {
          if (state?.field.some(seat => seat.pokemonId === mon.id)) {
            expect(mon.isOnField(), `${mon.name} is not seated before its presentation seam`).toBe(false);
            expect(mon.visible, `${mon.name} is not revealed before its presentation seam`).toBe(false);
            expect(mon.getSprite().visible, `${mon.name} sprite stays hidden before intro`).toBe(false);
            expect(mon.getBattleInfo().visible, `${mon.name} info stays hidden before intro`).toBe(false);
          }
        }
      });
    }, 300_000);

    it("re-summon is KEY-GATED: a stable apply never reloads the atlas; a sprite-key (species/form) change does", async () => {
      const rig = await setup();
      await applyOnce(rig);

      const enemy = await withClient(rig.guestCtx, () => rig.guestScene.getEnemyField().find(e => e.isOnField()));
      expect(enemy, "a guest on-field enemy exists").toBeDefined();
      const loadSpy = await withClient(rig.guestCtx, () => vi.spyOn(enemy!, "loadAssets").mockResolvedValue());

      // (a) STABLE apply: identical authoritative data -> the sprite-key INPUTS are unchanged -> NO re-summon.
      await applyOnce(rig);
      expect(
        loadSpy,
        "no re-summon when the sprite-key inputs are unchanged (cheap refresh only)",
      ).not.toHaveBeenCalled();

      // (b) VISUAL-IDENTITY change: pre-set the guest enemy to a DIFFERENT species so its PRE-apply sprite key
      //     differs from the host's authoritative species. The authoritative apply restores the host's species
      //     (MAGIKARP), so preKey != postKey for a mon that stayed on field -> the differ MUST reload the atlas
      //     + replay the sprite (a form change / transform in production). Same "mutate the guest to force the
      //     live path" technique the #845 render test uses.
      await withClient(rig.guestCtx, () => {
        enemy!.species = getPokemonSpecies(SpeciesId.GYARADOS);
      });
      await applyOnce(rig);
      expect(
        loadSpy,
        "a sprite-key change (species/form/transform) triggers the expensive re-summon",
      ).toHaveBeenCalled();
    }, 300_000);
  },
);
