/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE FIELD SEATING integrity (#848). In 2-player co-op each player owns exactly ONE field slot
// (host = slot 0, guest = slot 1) and may ONLY switch/replace from their OWN party half - the field-slot
// OWNERSHIP is load-bearing (both engines resolve a slot's owner from the occupant's coopOwner tag). A
// faint-heavy trainer wave can EXHAUST a side's own bench; the soak driver's firstLegalBenchSlot used to
// FALL BACK to the partner's bench, so a voluntary switch or faint replacement seated the OTHER player's
// mon into that side's field slot. The two engines then DISAGREED which slot the guest controls (seed
// 20260704 wave 62: the guest switched slot 1 to a HOST-owned mon; the host resolved slot 0 as guest-owned
// and both spun on a partner-command request that never resolved).
//
// This test locks in the fix: firstLegalBenchSlot is STRICT same-owner (returns -1, never a cross-owner
// mon), and a guest-owned faint replacement seats the guest's OWN pick in the guest's OWN field slot on
// BOTH engines (the seating agrees).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-seating.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, coopOwnerOfPlayerFieldSlot, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  installDuoLogCapture,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { firstLegalBenchSlot } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest picks party slot 3 (CHARIZARD) as its own faint replacement (a GUEST-owned bench mon). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO field seating: strict same-owner switch/replace, no cross-owner desync (#848)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`seating-${Date.now()}`);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(100)
      .enemyMoveset(MoveId.GROWL)
      .startingLevel(50)
      .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH]);
  });

  afterEach(() => {
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** The guest's own-slot command answer (harmless SPLASH; the host's own EARTHQUAKE does the fainting). */
  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.ENEMY],
    }));
  }

  // ===========================================================================================
  // (1) STRICT same-owner bench selection (#848 core). On a TRAINER wave (the soak manifestation), when a
  // side has NO legal same-owner bench, firstLegalBenchSlot must return -1 - NEVER the partner's mon. The
  // pre-#848 fallback returned ANY legal bench, which is exactly what seated a cross-owner mon into a field
  // slot and desynced the two engines' seating.
  // ===========================================================================================
  it("firstLegalBenchSlot is STRICT same-owner on a trainer wave (never falls back to the partner's bench)", async () => {
    // A non-fixed wave so the battleType + randomTrainer overrides take (wave 1 is always wild).
    game.override
      .startingWave(11)
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER });
    await game.classicMode.startBattle(
      SpeciesId.SNORLAX, // 0
      SpeciesId.GENGAR, // 1
      SpeciesId.LAPRAS, // 2
      SpeciesId.CHARIZARD, // 3
      SpeciesId.BLASTOISE, // 4
      SpeciesId.VENUSAUR, // 5
    );
    expect(game.scene.currentBattle.battleType, "on a TRAINER wave").toBe(BattleType.TRAINER);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // Tag the host party so the GUEST owns ONLY the lead (slot 1) - i.e. NO guest-owned bench - while the
    // host owns every other slot (a full host bench). This is the "guest exhausted its own half" state.
    const party = rig.hostScene.getPlayerParty();
    for (let i = 0; i < party.length; i++) {
      party[i].coopOwner = i === COOP_GUEST_FIELD_INDEX ? "guest" : "host";
    }

    // STRICT: the guest has no guest-owned bench -> -1 (the fix). The pre-#848 fallback returned a HOST-owned
    // bench slot (>= 2) here, which is exactly the cross-owner seating corruption.
    expect(
      firstLegalBenchSlot(rig.hostScene, "guest"),
      "guest with no guest-owned bench yields -1 (never a partner mon) (#848)",
    ).toBe(-1);
    // The host DOES have a legal same-owner bench, and it is a HOST-owned slot (>= the on-field count).
    const hostBench = firstLegalBenchSlot(rig.hostScene, "host");
    expect(hostBench, "host has a legal host-owned bench slot").toBeGreaterThanOrEqual(2);
    expect(party[hostBench].coopOwner, "the host bench pick is HOST-owned (strict)").toBe("host");

    logs.flush();
  }, 240_000);

  // ===========================================================================================
  // (2) SEATING AGREEMENT on a guest-owned faint replacement. The guest's lead faints; the guest picks its
  // OWN guest-owned bench mon; the host summons THAT pick into the GUEST's field slot; and BOTH engines then
  // agree: the replacement occupies field slot 1 (the guest's slot), is guest-owned, same species on both,
  // and each engine resolves slot 1 as guest-owned + slot 0 as host-owned (no cross-owner seating swap).
  // ===========================================================================================
  it("guest-owned faint replacement: the host seats the guest's pick in the guest's slot; both engines agree", async () => {
    game.override.startingWave(1); // wave 1 is a wild double (deterministic combat for the faint drive)
    await game.classicMode.startBattle(
      SpeciesId.SNORLAX, // 0 host  (lead)
      SpeciesId.GENGAR, // 1 guest (lead; faints)
      SpeciesId.LAPRAS, // 2 host
      SpeciesId.CHARIZARD, // 3 guest (the guest's relayed replacement)
      SpeciesId.BLASTOISE, // 4 host
      SpeciesId.VENUSAUR, // 5 guest
    );
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Tag party ownership host EVEN / guest ODD on BOTH engines (the soak's 3-per-player split), so the
    // guest has its own bench (CHARIZARD slot 3, VENUSAUR slot 5) to replace from.
    for (const scene of [rig.hostScene, rig.guestScene]) {
      const party = scene.getPlayerParty();
      for (let i = 0; i < party.length; i++) {
        party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
      }
    }

    // The guest's lead (slot 1, GENGAR) at 1 HP on BOTH engines so the host's own ally-splashing EARTHQUAKE
    // faints it deterministically.
    rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
    });

    const turn = rig.hostScene.currentBattle.turn;

    // TURN 1 on the HOST: EARTHQUAKE (spread, hits the 1-HP guest ally) faints slot 1; the level-100 foes
    // shrug it off and GROWL harmlessly.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
      game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // GUEST renders turn 1: its OWN faint picker opens (CoopGuestFaintSwitchPhase); stub the ONE PARTY open
    // to pick CHARIZARD (slot 3, a GUEST-owned bench mon) - the relay send + seq keying stay fully real.
    await withClient(rig.guestCtx, async () => {
      const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
      const realSetMode = ui.setMode.bind(ui);
      ui.setMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.PARTY) {
          ui.setMode = realSetMode; // one-shot
          (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0);
          return;
        }
        if (args[0] === UiMode.MESSAGE) {
          return; // the picker's close transition - a no-op headlessly
        }
        return realSetMode(...args);
      };
      try {
        await driveGuestReplayTurn(rig.guestScene, turn);
      } finally {
        ui.setMode = realSetMode;
      }
    });

    // HOST: drive past its SwitchPhase - it AWAITS the guest's relayed pick and summons it into the
    // GUEST's slot. The crossing settles under BOTH destination contexts (the b59dba12 B-lane hang
    // class: parked FAINT_SWITCH envelopes starve the host's material-ACK barrier host-only).
    let hostAdvance: Promise<void> | undefined;
    await withClient(rig.hostCtx, async () => {
      hostAdvance = game.phaseInterceptor.to("CommandPhase", false) as Promise<void>;
      await drainLoopback();
    });
    expect(hostAdvance, "the host CommandPhase crossing was started").toBeDefined();
    await settleDuoPromise(rig, hostAdvance!, "guest-owned seating host crossing");

    // The HOST seated the guest's pick (CHARIZARD) into the GUEST's field slot (1), guest-owned. Methods
    // such as getBattlerIndex resolve through globalScene, so every presentation assertion must run in the
    // host context rather than merely dereference the host scene while the harness has restored the guest.
    withClientSync(rig.hostCtx, () => {
      const hostReplacement = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(hostReplacement?.species.speciesId, "host seated the guest's pick (CHARIZARD) in the guest slot").toBe(
        SpeciesId.CHARIZARD,
      );
      expect(hostReplacement?.coopOwner, "the seated replacement is GUEST-owned (no cross-owner seating)").toBe(
        "guest",
      );
      expect(hostReplacement?.getBattlerIndex(), "host projected the replacement into player seat 1").toBe(
        COOP_GUEST_FIELD_INDEX,
      );
      expect(
        hostReplacement == null ? -1 : rig.hostScene.field.getIndex(hostReplacement),
        "host field container contains the replacement",
      ).toBeGreaterThanOrEqual(0);
      expect(hostReplacement?.visible, "host can see the guest-owned replacement container").toBe(true);
      expect(hostReplacement?.getSprite()?.visible, "host can see the guest-owned replacement sprite").toBe(true);
      expect(hostReplacement?.getBattleInfo()?.visible, "host can see the guest-owned replacement UI bar").toBe(true);
      // Seating ownership resolves correctly on the HOST: slot 0 host, slot 1 guest (never swapped).
      expect(coopOwnerOfPlayerFieldSlot(COOP_HOST_FIELD_INDEX), "host resolves field slot 0 as HOST-owned").toBe(
        "host",
      );
      expect(coopOwnerOfPlayerFieldSlot(COOP_GUEST_FIELD_INDEX), "host resolves field slot 1 as GUEST-owned").toBe(
        "guest",
      );
    });

    // GUEST turn 2 pump: materializes the replacement from the out-of-band checkpoint into the SAME slot.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn + 1);
    });
    withClientSync(rig.guestCtx, () => {
      const guestReplacement = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(guestReplacement?.species.speciesId, "guest materialized its pick in ITS slot (same as host)").toBe(
        SpeciesId.CHARIZARD,
      );
      expect(guestReplacement?.coopOwner, "the guest's seated replacement is GUEST-owned").toBe("guest");
      expect(guestReplacement?.getBattlerIndex(), "owner projected its replacement into player seat 1").toBe(
        COOP_GUEST_FIELD_INDEX,
      );
      expect(
        guestReplacement == null ? -1 : rig.guestScene.field.getIndex(guestReplacement),
        "owner field container contains its replacement",
      ).toBeGreaterThanOrEqual(0);
      expect(guestReplacement?.visible, "owner can see its replacement container").toBe(true);
      expect(guestReplacement?.getSprite()?.visible, "owner can see its replacement sprite").toBe(true);
      expect(guestReplacement?.getBattleInfo()?.visible, "owner can see its replacement UI bar").toBe(true);
      // BOTH engines agree the guest controls slot 1 - the seating desync (#848) is impossible.
      expect(coopOwnerOfPlayerFieldSlot(COOP_GUEST_FIELD_INDEX), "guest resolves field slot 1 as GUEST-owned").toBe(
        "guest",
      );
      expect(coopOwnerOfPlayerFieldSlot(COOP_HOST_FIELD_INDEX), "guest resolves field slot 0 as HOST-owned").toBe(
        "host",
      );
    });

    logs.flush();
  }, 240_000);
});
