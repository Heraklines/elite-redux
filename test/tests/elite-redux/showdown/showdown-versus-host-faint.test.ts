/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 VERSUS - the HOST-faints mirror of the guest-faint replacement flow (two-engine proof).
//
// The live bug (tester build mrbqqcbr): the GUEST KO'd the HOST's mon; the host picked + summoned its
// own replacement; but the GUEST opened its NEXT CommandPhase (its own TurnInitPhase) BEFORE the host's
// replacement materialized on the guest's ENEMY platform - so the guest "had to choose a move to SEE
// your new pokemon", commanding against an empty/fainted enemy slot.
//
// ROOT CAUSE: a host-owned faint rides the vanilla SwitchPhase, which runs AFTER TurnEndPhase streams
// turnResolution(N). The replacement is a SEPARATE out-of-band `reason=replacement` checkpoint the guest
// only consumes in turn N+1's replay pump (CoopReplayTurnPhase). But the guest's own turn-N+1
// TurnInitPhase opens its CommandPhase BEFORE that pump - so the enemy platform is still the fainted host
// lead. (The guest-OWN-faint direction never hit this: its own fainted slot defers the command into the
// pump, which renders the replacement first.)
//
// FIX (src/phases/turn-init-phase.ts): on the versus guest, when there is no active enemy on the field (a
// host replacement is pending), DEFER opening the guest's command - the replay pump's checkpoint branch
// opens it AFTER applying the enemy replacement, exactly like the guest-own-faint path. Deterministic
// (parks on the specific replacement checkpoint, host-stall-bounded), no spin, no timeout.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/showdown/showdown-versus-host-faint.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { type CoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
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
  type CoopResyncProbe,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  type ShowdownDuoRig,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { PartyUiHandler } from "#ui/handlers/party-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest's OWN team: a MAGIKARP lead (its TACKLE KOs the host's lead) + two benches. */
const GUEST_LEAD = SpeciesId.MAGIKARP;
const GUEST_BENCH_1 = SpeciesId.LAPRAS;
const GUEST_BENCH_2 = SpeciesId.GYARADOS;
/** MAGIKARP's moveset is [SPLASH, TACKLE, FLAIL, BOUNCE] - slot 1 = TACKLE (the KO). */
const GUEST_TACKLE_SLOT = 1;

/** The HOST's own team: a frail PIKACHU lead (set to 1 HP) + a SNORLAX bench (its faint replacement). */
const HOST_LEAD = SpeciesId.PIKACHU;
const HOST_BENCH = SpeciesId.SNORLAX;

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

const guestTeam = (): ShowdownMonManifest[] => [
  manifest(GUEST_LEAD, [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE]),
  manifest(GUEST_BENCH_1, [MoveId.SPLASH, MoveId.ICE_BEAM, MoveId.SURF, MoveId.BODY_SLAM]),
  manifest(GUEST_BENCH_2, [MoveId.SPLASH, MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE]),
];

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

describe.skipIf(!RUN)("Showdown versus - HOST-faints replacement ordering (two-engine proof)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let resyncProbe: CoopResyncProbe | undefined;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-host-faint-${Date.now()}`);
    setCoopFaintSwitchWaitMs(4000);
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    resyncProbe?.restore();
    resyncProbe = undefined;
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    initGlobalScene(prevScene);
  });

  async function startHostShowdown(opponent: ShowdownMonManifest[], hostLeadMoves: MoveId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle([manifest(HOST_LEAD, hostLeadMoves)], opponent);
      const starters = generateStarters(game.scene, [HOST_LEAD, HOST_BENCH]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase", false);
    game.scene.getPlayerParty()[0].moveset = hostLeadMoves.map(m => new PokemonMove(m));
  }

  /** The guest's Magikarp ships TACKLE at the host each turn (KOs the host's 1-HP lead). */
  function wireGuestTackle(rig: ShowdownDuoRig): void {
    rig.guestPeer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: GUEST_TACKLE_SLOT,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));
  }

  /** Register a one-shot driver for the HOST's OWN vanilla faint picker (picks its SNORLAX bench). */
  function driveHostOwnFaintPicker(): void {
    game.onNextPrompt("SwitchPhase", UiMode.PARTY, () => {
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      handler.setCursor(1); // the host's bench (SNORLAX)
      handler.processInput(Button.ACTION); // select it
      handler.processInput(Button.ACTION); // send it out
    });
  }

  /** Species of the guest's ENEMY lead (= the host's active mon) + whether it is a live, rendered mon. */
  function guestEnemyLead(rig: ShowdownDuoRig): { sp: number; fainted: boolean; active: boolean } {
    return withClientSync(rig.guestCtx, () => {
      const mon = rig.guestScene.getEnemyField()[0];
      return { sp: mon?.species?.speciesId ?? 0, fainted: mon?.isFainted() ?? true, active: mon?.isActive() ?? false };
    });
  }

  /** Drive the retained V2 replacement entry through its real phase queue and open the stated command surface. */
  async function driveGuestToCommand(
    rig: ShowdownDuoRig,
  ): Promise<{ commandOpened: boolean; enemyAtCommand: { sp: number; fainted: boolean; active: boolean } }> {
    const command = await driveClientPhaseQueueTo(rig.guestScene, "CommandPhase");
    command.start();
    await drainLoopback();
    return {
      commandOpened: command.phaseName === "CommandPhase" && rig.guestScene.ui.getMode() === UiMode.COMMAND,
      enemyAtCommand: guestEnemyLead(rig),
    };
  }

  it("(i) HOST faint -> the guest's next command opens with the host's replacement RENDERED, not an empty enemy", async () => {
    await startHostShowdown(guestTeam(), [MoveId.SPLASH, MoveId.TACKLE, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK]);
    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    wireGuestTackle(rig);
    // A host-faint replacement is player-facing on the guest: it must converge with ZERO forced resyncs.
    resyncProbe = installCoopResyncProbe(rig.guestRuntime as unknown as CoopRuntime);

    // Only the HOST's lead faints: set the host's own Pikachu to 1 HP; the guest's Magikarp stays full.
    rig.hostScene.getPlayerField()[0].hp = 1;

    const turn = rig.hostScene.currentBattle.turn;

    // HOST turn N: SPLASH (harmless); the guest's Magikarp TACKLE KOs the host's own Pikachu.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.SPLASH, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(rig.hostScene.getPlayerField()[0]?.isFainted() ?? true, "the HOST's own lead fainted (guest KO'd it)").toBe(
      true,
    );

    // GUEST replays turn N (finalizes it) BEFORE the host summons - the production race: turnResolution(N)
    // is consumed and the turn advances while the replacement checkpoint does not yet exist.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    // After finalize the enemy lead is the FAINTED host Pikachu (the replacement has not streamed yet).
    expect(guestEnemyLead(rig).fainted, "the guest's enemy lead is the fainted host mon right after turn N").toBe(true);

    // HOST crosses to turn N+1: picks SNORLAX, summons it, streams the out-of-band replacement checkpoint,
    // then opens its own turn-N+1 CommandPhase (requesting the guest's next enemy command).
    driveHostOwnFaintPicker();
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase");
    });
    expect(rig.hostScene.getPlayerField()[0]?.species.speciesId, "the host summoned its SNORLAX replacement").toBe(
      HOST_BENCH,
    );

    // GUEST drives its REAL turn-N+1 machinery (TurnInit -> TurnStart -> pump), stopping when its own
    // CommandPhase opens. THE ASSERTION: the enemy replacement is RENDERED (SNORLAX, alive) at that moment -
    // the guest is NOT choosing blind against an empty/fainted platform.
    const { commandOpened, enemyAtCommand } = await withClient(rig.guestCtx, () => driveGuestToCommand(rig));
    expect(commandOpened, "the guest opened its own turn-N+1 CommandPhase (no stall)").toBe(true);
    expect(
      enemyAtCommand.sp,
      "the host's replacement (SNORLAX) is RENDERED on the guest's enemy platform when its command opens",
    ).toBe(HOST_BENCH);
    expect(enemyAtCommand.fainted, "the rendered enemy is ALIVE (not the fainted host lead) at command time").toBe(
      false,
    );
    expect(enemyAtCommand.active, "the rendered enemy is an ACTIVE on-field mon at command time").toBe(true);
    expect(resyncProbe.count(), "the host-faint replacement converged with ZERO forced resyncs").toBe(0);

    logs.flush();
  }, 300_000);
});
