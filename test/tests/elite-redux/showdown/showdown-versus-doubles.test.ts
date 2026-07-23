/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown VERSUS DOUBLES / TRIPLES - end-to-end TWO-ENGINE proof.
//
// The multi-slot increment over the proven 1v1 versus loop. Over ONE loopback pair with BOTH real
// engines:
//   (1) DOUBLES full turn: both clients field TWO mons; the guest ships TWO commands per turn through
//       the ShowdownCommandRelay (one per own field slot, keyed by (turn, fieldIndex)); the host
//       resolves BOTH enemy slots from the relay; wave-start AND post-turn checksums converge.
//   (2) DOUBLES per-slot faint: a KO in ONE guest slot opens THAT slot's picker (keyed by
//       COOP_FAINT_SWITCH_SEQ_BASE + fieldIndex), the guest relays its replacement, the host summons
//       it, and the battle continues with the other slot untouched.
//   (3) TRIPLES smoke: both clients field THREE mons; the guest ships THREE commands per turn; one full
//       turn resolves and the checksums converge.
//
// RED-PROOFS baked in: (1) asserts the guest responder was invoked for BOTH/ALL slots (revert the relay
// to turn-only keying -> the second/third per-turn await collides and the assertion fails); the
// checksum parity assertions fail if the multi-slot build/stream diverges.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/showdown/showdown-versus-doubles.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownDuo,
  driveGuestReplayTurn,
  installDuoLogCapture,
  type ShowdownDuoRig,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const manifest = (speciesId: SpeciesId, moveset: MoveId[]): ShowdownMonManifest => ({
  speciesId,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset,
  item: "LEFTOVERS",
  rootSpeciesId: speciesId,
  erBlackShiny: false,
  baseCost: 4,
});

/** A harmless move both sides can spam so a full multi-slot turn resolves with no faints. */
const HARMLESS: MoveId[] = [MoveId.SPLASH, MoveId.TACKLE, MoveId.GROWL, MoveId.LEER];

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

describe.skipIf(!RUN)("Showdown versus DOUBLES / TRIPLES - two-engine multi-slot proof", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-versus-doubles-${Date.now()}`);
    setCoopFaintSwitchWaitMs(4000);
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    initGlobalScene(prevScene);
  });

  /**
   * Boot the HOST into a live showdown battle at the given field WIDTH (2 = doubles, 3 = triples) versus
   * `opponent`, reach the first CommandPhase, and bake `hostMoves` onto EACH fielded host mon (a direct
   * set - not a global override - so it rides the mirror into the guest's ENEMY mons without corrupting
   * the guest's own manifest movesets).
   */
  async function startHostShowdown(
    hostSpecies: SpeciesId[],
    opponent: ShowdownMonManifest[],
    battleFormat: "doubles" | "triples",
    hostMoves: MoveId[],
  ): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle(
        hostSpecies.map(s => manifest(s, hostMoves)),
        opponent,
        null,
        null,
        null,
        null,
        battleFormat,
      );
      const starters = generateStarters(game.scene, hostSpecies);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    // Stop before CommandPhase starts. Mandatory versus authority is installed by buildShowdownDuo below;
    // letting this orphan host CommandPhase run first correctly terminalizes the shared battle and clears
    // its field, which made this grouped shard observe zero host battlers (and a null battle on the next case).
    await game.phaseInterceptor.to("CommandPhase", false);
    // Bake the moves onto BOTH the base moveset (what the mirror serializes to the guest) AND
    // summonData.moveset (what getMoveset() actually returns once a mon is summoned - a bare
    // `.moveset =` is shadowed by summonData.moveset, which made the host use its default damaging
    // moves non-deterministically). Set both so every fielded host mon deterministically uses HARMLESS.
    for (const mon of game.scene.getPlayerField()) {
      mon.moveset = hostMoves.map(m => new PokemonMove(m));
      mon.summonData.moveset = hostMoves.map(m => new PokemonMove(m));
    }
  }

  it("(1) DOUBLES: guest ships TWO commands/turn through the relay; host resolves both; checksums converge", async () => {
    const opponent = [manifest(SpeciesId.SNORLAX, HARMLESS), manifest(SpeciesId.LAPRAS, HARMLESS)];
    await startHostShowdown([SpeciesId.MUNCHLAX, SpeciesId.BLASTOISE], opponent, "doubles", HARMLESS);

    // FIELD WIDTH: the negotiated doubles format built a 2v2 on the host.
    expect(game.scene.getPlayerField().length, "host fields 2 (doubles)").toBe(2);
    expect(game.scene.getEnemyField().length, "host enemy side is 2 (doubles)").toBe(2);

    const pair = createLoopbackPair();
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    // The guest fields 2 (its own team = the host's enemy side, flipped to its local PLAYER side).
    expect(rig.guestScene.getPlayerField().length, "guest fields 2 (doubles)").toBe(2);
    expect(rig.guestScene.getEnemyField().length, "guest enemy side is 2 (doubles)").toBe(2);

    // The guest answers BOTH own slots with a harmless SPLASH; record which slots were asked (proves the
    // relay carries TWO per-turn commands keyed by fieldIndex - the multi-slot red-proof anchor).
    const requestedSlots: number[] = [];
    rig.guestPeer.onCommandRequest(({ fieldIndex }) => {
      requestedSlots.push(fieldIndex);
      return {
        command: Command.FIGHT,
        cursor: 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.PLAYER],
        useMode: MoveUseMode.NORMAL,
      };
    });

    // (a) WAVE-START PARITY: the guest booted from the host's doubles battle is checksum-identical.
    const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestStart, "guest boots checksum-identical to the host (doubles)").toBe(hostStart);

    // Host plays a full doubles turn: both host mons SPLASH; each enemy slot awaits the guest's relay.
    const turn = rig.hostScene.currentBattle.turn;
    const enemyCommands: (number | undefined)[] = [];
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.SPLASH, 0);
      game.move.select(MoveId.SPLASH, 1);
      await game.phaseInterceptor.to("TurnStartPhase");
      // Capture the committed ENEMY-slot moves: both must be the GUEST's relayed SPLASH (move 150),
      // proving the host resolved BOTH enemy slots FROM THE RELAY (not an AI fallback).
      const arrangement = rig.hostScene.currentBattle.arrangement;
      const tc = rig.hostScene.currentBattle.turnCommands;
      enemyCommands.push(tc[arrangement.enemyOffset]?.move?.move, tc[arrangement.enemyOffset + 1]?.move?.move);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // The guest replays the host's streamed doubles turn.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    // TWO commands relayed this turn - one per enemy field slot (the multi-slot proof).
    expect([...requestedSlots].sort(), "the host asked the guest for BOTH enemy slots").toEqual([0, 1]);
    // Both enemy slots were resolved FROM THE RELAY (the guest's SPLASH), not an AI fallback.
    expect(enemyCommands, "both enemy slots committed the guest's relayed SPLASH (no AI fallback)").toEqual([
      MoveId.SPLASH,
      MoveId.SPLASH,
    ]);

    // (b) POST-TURN PARITY: the whole doubles turn resolved identically on both engines - the guest
    // converged to the host's authoritative post-turn state. This is the gold-standard convergence proof
    // (it holds regardless of the exact HP outcome of the ambient random-ability rolls generateStarters
    // makes for each mon), so it does NOT over-specify a "nobody faints" HP result.
    const hostAfter = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestAfter, "guest converged to the host's post-turn doubles state").toBe(hostAfter);

    logs.flush();
  }, 300_000);

  it("(2) DOUBLES per-slot faint: a KO in ONE guest slot opens THAT slot's picker + replacement; battle continues", async () => {
    const opponent = [
      manifest(SpeciesId.MAGIKARP, HARMLESS), // slot 0 - the KO target (frail)
      manifest(SpeciesId.LAPRAS, HARMLESS), // slot 1 - untouched
      manifest(SpeciesId.GYARADOS, HARMLESS), // bench - the guest's replacement pick
    ];
    // Host leads carry THUNDERBOLT so slot 0 can KO the guest's Magikarp; both bulky enough to survive.
    await startHostShowdown([SpeciesId.PIKACHU, SpeciesId.SNORLAX], opponent, "doubles", [
      MoveId.THUNDERBOLT,
      MoveId.SPLASH,
      MoveId.GROWL,
      MoveId.LEER,
    ]);

    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    // Put the guest's lead (host ENEMY slot 0) at 1 HP on BOTH engines so THUNDERBOLT KOs it deterministically.
    rig.hostScene.getEnemyField()[0].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[0].hp = 1;
    });

    // The guest answers each own slot with SPLASH (harmless).
    rig.guestPeer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));

    const turn = rig.hostScene.currentBattle.turn;
    // Host slot 0 THUNDERBOLTs the guest's Magikarp (enemy slot 0); host slot 1 SPLASHes.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.THUNDERBOLT, 0, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, 1);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // The enemy slot-0 mon fainted; slot 1 is untouched. The host awaits the guest's per-slot replacement.
    expect(rig.hostScene.getEnemyParty()[0].isFainted(), "the guest's slot-0 lead fainted").toBe(true);

    // Drive the guest's replay, intercepting the ONE own-team faint picker (slot 0) to pick the bench GYARADOS.
    const GUEST_BENCH_PICK = 2;
    let pickerOpened = false;
    await withClient(rig.guestCtx, async () => {
      const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
      const realSetMode = ui.setMode.bind(ui);
      ui.setMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.PARTY) {
          pickerOpened = true;
          ui.setMode = realSetMode;
          (args[3] as (slotIndex: number, option: number) => void)(GUEST_BENCH_PICK, 0);
          return;
        }
        if (args[0] === UiMode.MESSAGE) {
          return;
        }
        return realSetMode(...args);
      };
      try {
        await driveGuestReplayTurn(rig.guestScene, turn);
      } finally {
        ui.setMode = realSetMode;
      }
    });

    // The per-slot picker OPENED (the fieldIndex-keyed faint band fired for slot 0).
    expect(pickerOpened, "the guest's per-slot faint picker opened for the KO'd slot").toBe(true);

    // HOST crosses to the next CommandPhase: its ShowdownEnemyFaintSwitchPhase consumes the buffered
    // per-slot pick and summons THE GUEST'S CHOICE into the KO'd slot, then the match continues (no stall).
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase");
    });

    // The HOST summoned the guest's CHOSEN replacement (GYARADOS) into enemy slot 0 (the per-slot round-trip).
    expect(
      rig.hostScene.getEnemyField()[0]?.species.speciesId,
      "the host summoned the guest's chosen bench (GYARADOS) into the KO'd slot",
    ).toBe(SpeciesId.GYARADOS);
    expect(rig.hostScene.getEnemyField()[0]?.isFainted(), "the summoned replacement is battle-ready").toBe(false);
    // Slot 1 (LAPRAS) is untouched - the faint was PER-SLOT.
    expect(rig.hostScene.getEnemyField()[1]?.species.speciesId, "the other enemy slot is untouched").toBe(
      SpeciesId.LAPRAS,
    );

    logs.flush();
  }, 300_000);

  it("(3) TRIPLES smoke: guest ships THREE commands/turn; one full turn resolves; checksums converge", async () => {
    const opponent = [
      manifest(SpeciesId.SNORLAX, HARMLESS),
      manifest(SpeciesId.LAPRAS, HARMLESS),
      manifest(SpeciesId.BLASTOISE, HARMLESS),
    ];
    await startHostShowdown(
      [SpeciesId.MUNCHLAX, SpeciesId.GYARADOS, SpeciesId.VENUSAUR],
      opponent,
      "triples",
      HARMLESS,
    );

    // FIELD WIDTH: the negotiated triples format built a 3v3 on the host.
    expect(game.scene.getPlayerField().length, "host fields 3 (triples)").toBe(3);
    expect(game.scene.getEnemyField().length, "host enemy side is 3 (triples)").toBe(3);

    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    expect(rig.guestScene.getPlayerField().length, "guest fields 3 (triples)").toBe(3);

    const requestedSlots: number[] = [];
    rig.guestPeer.onCommandRequest(({ fieldIndex }) => {
      requestedSlots.push(fieldIndex);
      return {
        command: Command.FIGHT,
        cursor: 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.PLAYER],
        useMode: MoveUseMode.NORMAL,
      };
    });

    const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestStart, "guest boots checksum-identical to the host (triples)").toBe(hostStart);

    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.SPLASH, 0);
      game.move.select(MoveId.SPLASH, 1);
      game.move.select(MoveId.SPLASH, 2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    // THREE commands relayed this turn - one per enemy field slot.
    expect([...requestedSlots].sort(), "the host asked the guest for ALL THREE enemy slots").toEqual([0, 1, 2]);

    const hostAfter = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestAfter, "guest converged to the host's post-turn triples state").toBe(hostAfter);

    logs.flush();
  }, 300_000);
});
