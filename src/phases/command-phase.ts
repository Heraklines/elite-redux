import type { TurnCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { speciesStarterCosts } from "#balance/starters";
import { TrappedTag } from "#data/battler-tags";
import { getDailyEventSeedBoss } from "#data/daily-seed/daily-run";
import { isDailyFinalBoss } from "#data/daily-seed/daily-seed-utils";
import {
  applyCoopCheckpoint,
  applyCoopEnemies,
  captureCoopCheckpoint,
  captureCoopEnemies,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  applyWiredPartnerCommand,
  type ResolvedPartnerCommand,
  resolvePartnerCommand,
} from "#data/elite-redux/coop/coop-partner-ai";
import { getCoopBattleStreamer, getCoopBattleSync, getCoopController } from "#data/elite-redux/coop/coop-runtime";
import { coopOwnerOfFieldIndex } from "#data/elite-redux/coop/coop-session";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { isIgnorePP, isVirtual, MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { PokeballType } from "#enums/pokeball";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";
import { FieldPhase } from "#phases/field-phase";
import type { MoveTargetSet } from "#types/move-target-set";
import type { TurnMove } from "#types/turn-move";
import i18next from "i18next";

export class CommandPhase extends FieldPhase {
  public readonly phaseName = "CommandPhase";
  protected fieldIndex: number;

  /**
   * Whether the command phase is handling a switch command
   */
  private isSwitch = false;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
  }

  /**
   * Resets the cursor to the position of {@linkcode Command.FIGHT} if any of the following are true
   * - The setting to remember the last action is not enabled
   * - This is the first turn of a mystery encounter, trainer battle, or the END biome
   * - The cursor is currently on the POKEMON command
   */
  private resetCursorIfNeeded(): void {
    const commandUiHandler = globalScene.ui.handlers[UiMode.COMMAND];
    const { arena, commandCursorMemory, currentBattle } = globalScene;
    const { battleType, turn } = currentBattle;
    const { biomeId } = arena;

    // If one of these conditions is true, we always reset the cursor to Command.FIGHT
    const cursorResetEvent =
      battleType === BattleType.MYSTERY_ENCOUNTER || battleType === BattleType.TRAINER || biomeId === BiomeId.END;

    if (!commandUiHandler) {
      return;
    }
    if (
      (turn === 1 && (!commandCursorMemory || cursorResetEvent))
      || commandUiHandler.getCursor() === Command.POKEMON
    ) {
      commandUiHandler.setCursor(Command.FIGHT);
    }
  }

  /**
   * Submethod of {@linkcode start} that validates field index logic for nonzero field indices.
   * Must only be called if the field index is nonzero.
   */
  private handleFieldIndexLogic(): void {
    // If we somehow are attempting to check the right pokemon but there's only one pokemon out
    // Switch back to the center pokemon. This can happen rarely in double battles with mid turn switching
    // TODO: Prevent this from happening in the first place
    if (globalScene.getPlayerField().filter(p => p.isActive()).length === 1) {
      this.fieldIndex = FieldPosition.CENTER;
      return;
    }

    const allyCommand = globalScene.currentBattle.turnCommands[this.fieldIndex - 1];
    if (allyCommand?.command === Command.BALL || allyCommand?.command === Command.RUN) {
      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: allyCommand?.command,
        skip: true,
      };
    }
  }

  /**
   * Submethod of {@linkcode start} that sets the turn command to skip if this pokemon
   * is commanding its ally via {@linkcode AbilityId.COMMANDER}.
   */
  private checkCommander(): void {
    // If the Pokemon has applied Commander's effects to its ally, skip this command
    if (
      globalScene.currentBattle?.double
      && this.getPokemon().getAlly()?.getTag(BattlerTagType.COMMANDED)?.getSourcePokemon() === this.getPokemon()
    ) {
      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: Command.FIGHT,
        move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
        skip: true,
      };
    }
  }

  /**
   * Clear out all unusable moves in front of the currently acting pokemon's move queue.
   */
  // TODO: Refactor move queue handling to ensure that this method is not necessary.
  private clearUnusableMoves(): void {
    const playerPokemon = this.getPokemon();
    const moveQueue = playerPokemon.getMoveQueue();
    if (moveQueue.length === 0) {
      return;
    }

    let entriesToDelete = 0;
    const moveset = playerPokemon.getMoveset();
    for (const queuedMove of moveQueue) {
      const movesetQueuedMove = moveset.find(m => m.moveId === queuedMove.move);
      if (
        queuedMove.move !== MoveId.NONE
        && !isVirtual(queuedMove.useMode)
        && !(movesetQueuedMove?.isUsable(playerPokemon, isIgnorePP(queuedMove.useMode), true)?.[0] ?? false)
      ) {
        entriesToDelete++;
      } else {
        break;
      }
    }
    if (entriesToDelete) {
      moveQueue.splice(0, entriesToDelete);
    }
  }

  /**
   * Attempt to execute the first usable move in this Pokemon's move queue
   * @returns Whether a queued move was successfully set to be executed.
   */
  private tryExecuteQueuedMove(): boolean {
    this.clearUnusableMoves();
    const playerPokemon = globalScene.getPlayerField()[this.fieldIndex];
    const moveQueue = playerPokemon.getMoveQueue();

    if (moveQueue.length === 0) {
      return false;
    }

    const queuedMove = moveQueue[0];
    if (queuedMove.move === MoveId.NONE) {
      this.handleCommand(Command.FIGHT, -1);
      return true;
    }
    const moveIndex = playerPokemon.getMoveset().findIndex(m => m.moveId === queuedMove.move);
    if (!isVirtual(queuedMove.useMode) && moveIndex === -1) {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    } else {
      this.handleCommand(Command.FIGHT, moveIndex, queuedMove.useMode, queuedMove);
    }

    return true;
  }

  /**
   * Co-op battle control (#633, P2 + LIVE-C): in a co-op double the local human
   * only ever drives THEIR OWN field slot; the PARTNER's slot is resolved here and
   * the interactive menu is never opened for it. Returns `true` when this is the
   * partner slot (its command will be submitted, possibly asynchronously) so the
   * caller skips the menu.
   *
   * The partner's command comes from the partner OVER THE TRANSPORT (LIVE-C): the
   * host (authoritative) offers the legal move slots it computed and awaits the
   * peer's pick - a real guest live, or the {@linkcode SpoofGuest} over loopback in
   * dev/tests. If no relay is present or the peer does not answer within the
   * timeout, it falls back to the self-contained AI picker
   * ({@linkcode resolvePartnerCommand}) so the turn never hangs.
   */
  private tryCoopAutoResolve(): boolean {
    if (!globalScene.gameMode.isCoop) {
      return false;
    }
    const controller = getCoopController();
    // Fall back to normal (interactive) behavior if there is somehow no live
    // session - never lock the human out of their command.
    if (controller == null) {
      return false;
    }
    // Only auto-resolve the PARTNER's slot; the local player commands their own.
    if (coopOwnerOfFieldIndex(this.fieldIndex) === controller.role) {
      return false;
    }

    const partner = this.getPokemon();
    // Passing the full `move` arg makes handleFightCommand reuse the resolved
    // targets and SKIP the interactive SelectTargetPhase.
    const apply = (resolved: ResolvedPartnerCommand) =>
      this.handleCommand(resolved.command, resolved.moveIndex, resolved.turnMove.useMode, resolved.turnMove);
    // The local AI command: both the no-relay path and the timeout/illegal fallback.
    const fallback = () => resolvePartnerCommand(partner);

    const sync = getCoopBattleSync();
    if (sync == null) {
      apply(fallback());
      return true;
    }
    // Offer the legal move slots WE computed and await the partner's pick. The
    // partner's command is applied EXACTLY ({@linkcode applyWiredPartnerCommand}:
    // matched by move ID + verbatim targets, no RNG re-roll) so both engines stay
    // in lockstep; a missing / slow reply (or an unfindable move) -> AI fallback.
    const moveset = partner.getMoveset();
    const moveSlots = moveset.map((m, i) => (m.isUsable(partner, false, true)[0] ? i : -1)).filter(i => i >= 0);
    void sync
      .requestPartnerCommand(this.fieldIndex, globalScene.currentBattle.turn, moveSlots)
      .then(cmd => apply((cmd && applyWiredPartnerCommand(partner, cmd)) || fallback()));
    return true;
  }

  /**
   * Co-op host-authoritative sync (#633, LIVE-D), run at each turn boundary (the
   * field is stable here - no resolution in flight). The HOST broadcasts the
   * authoritative post-previous-turn state once per turn (at field slot 0, turn 2+);
   * the GUEST snaps to the latest such checkpoint, so both screens converge on the
   * same hp / status / stages / weather every turn instead of drifting apart. Fully
   * guarded: no-op outside a live co-op session, and the apply/capture are themselves
   * wrapped so a sync hiccup can never break the turn.
   */
  private tryCoopCheckpointSync(): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null) {
      return;
    }
    const { turn, waveIndex } = globalScene.currentBattle;
    if (controller.role === "host") {
      // Turn 1 of each wave (first command phase): broadcast the authoritative enemy
      // party so the guest's enemies match exactly (ability/moveset/IVs/nature).
      if (this.fieldIndex === 0 && turn === 1) {
        streamer.sendEnemyParty(waveIndex, captureCoopEnemies());
      }
      // Once per turn after turn 1: snapshot + broadcast the post-turn state.
      if (this.fieldIndex === 0 && turn > 1) {
        const checkpoint = captureCoopCheckpoint();
        if (checkpoint != null) {
          streamer.sendCheckpoint("turn", checkpoint);
        }
      }
    } else {
      // Guest: at the wave's first turn, adopt the host's exact enemy party.
      if (turn === 1) {
        const enemies = streamer.consumeEnemyParty(waveIndex);
        if (enemies != null) {
          applyCoopEnemies(enemies);
        }
      }
      // Apply the host's latest authoritative checkpoint at this safe boundary.
      const checkpoint = streamer.consumeCheckpoint();
      if (checkpoint != null) {
        applyCoopCheckpoint(checkpoint);
      }
    }
  }

  public override start(): void {
    super.start();

    this.tryCoopCheckpointSync();

    globalScene.updateGameInfo();
    this.resetCursorIfNeeded();

    if (this.fieldIndex) {
      this.handleFieldIndexLogic();
    }

    this.checkCommander();

    if (globalScene.currentBattle.turnCommands[this.fieldIndex]?.skip) {
      this.end();
      return;
    }

    if (this.tryExecuteQueuedMove()) {
      return;
    }

    if (this.tryCoopAutoResolve()) {
      return;
    }

    if (
      globalScene.currentBattle.isBattleMysteryEncounter()
      && globalScene.currentBattle.mysteryEncounter?.skipToFightInput
    ) {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.FIGHT, this.fieldIndex);
    } else {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    }
  }

  /**
   * Submethod of {@linkcode handleFightCommand} responsible for queuing the provided error message when the move cannot be used
   * @param msg - The reason why the move cannot be used
   */
  private queueFightErrorMessage(msg: string): void {
    const ui = globalScene.ui;
    ui.setMode(UiMode.MESSAGE);
    ui.showText(
      msg,
      null,
      () => {
        ui.clearText();
        ui.setMode(UiMode.FIGHT, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleFightCommand} that returns the moveID for the phase
   * based on the move passed in or the cursor.
   *
   * Does not check if the move is usable or not, that should be handled by the caller.
   */
  private computeMoveId(playerPokemon: PlayerPokemon, cursor: number, move: TurnMove | undefined): MoveId {
    return move?.move ?? (cursor > -1 ? playerPokemon.getMoveset()[cursor]?.moveId : MoveId.NONE);
  }

  /**
   * Process the logic for executing a fight-related command
   *
   * @remarks
   * - Validates whether the move can be used, using struggle if not
   * - Constructs the turn command and inserts it into the battle's turn commands
   *
   * @param command - The command to handle (FIGHT or TERA)
   * @param cursor - The index that the cursor is placed on, or -1 if no move can be selected.
   * @param ignorePP - Whether to ignore PP when checking if the move can be used.
   * @param move - The move to force the command to use, if any.
   */
  private handleFightCommand(
    command: Command.FIGHT | Command.TERA,
    cursor: number,
    useMode: MoveUseMode = MoveUseMode.NORMAL,
    move?: TurnMove,
  ): boolean {
    const playerPokemon = this.getPokemon();
    const ignorePP = isIgnorePP(useMode);
    const [canUse, reason] = cursor === -1 ? [true, ""] : playerPokemon.trySelectMove(cursor, ignorePP);

    // Ternary here ensures we don't compute struggle conditions unless necessary
    const useStruggle = canUse
      ? false
      : cursor > -1 && !playerPokemon.getMoveset().some(m => m.isUsable(playerPokemon, ignorePP, true)[0]);

    if (!canUse && !useStruggle) {
      this.queueFightErrorMessage(reason);
      return false;
    }

    const moveId = useStruggle ? MoveId.STRUGGLE : this.computeMoveId(playerPokemon, cursor, move);

    const turnCommand: TurnCommand = {
      command: Command.FIGHT,
      cursor,
      move: { move: moveId, targets: [], useMode },
      args: [useMode, move],
    };
    const preTurnCommand: TurnCommand = {
      command,
      targets: [this.fieldIndex],
      skip: command === Command.FIGHT,
    };

    const moveTargets: MoveTargetSet =
      move === undefined
        ? getMoveTargets(playerPokemon, moveId)
        : {
            targets: move.targets,
            // Co-op (#633): a relayed PARTNER move must take its spread/`multiple`
            // flag from the MOVE DEFINITION (deterministic + identical on both
            // clients, same source the local-human path above uses) - NOT from the
            // wired target-array length. The length proxy diverged across clients
            // (one treated Sappy Seed as spread, the other single-target), flipping
            // the spread-damage modifier and desyncing the whole battle. Same seed
            // already gives both clients identical enemies + RNG, so matching this
            // one flag is all that's needed. Solo / queued moves keep the proxy.
            multiple: globalScene.gameMode.isCoop
              ? getMoveTargets(playerPokemon, moveId).multiple
              : move.targets.length > 1,
          };

    if (moveId === MoveId.NONE) {
      turnCommand.targets = [this.fieldIndex];
    }

    console.log(
      "Move:",
      MoveId[moveId],
      "Move targets:",
      moveTargets,
      "\nPlayer Pokemon:",
      getPokemonNameWithAffix(playerPokemon),
    );

    // Co-op (#633): a RELAYED PARTNER command (a forced `move` on the field slot the
    // local player does NOT control) carries the partner's already-RESOLVED targets -
    // they are authoritative. Never open the interactive target-select for a mon we
    // don't own (the live "guest got the target cursor for the host's Bulbasaur, then
    // was stuck choosing Charmander's move" bug). Solo / own-slot / queued-move paths
    // are unaffected: `coopController` is null outside a live co-op run.
    const coopController = move !== undefined && globalScene.gameMode.isCoop ? getCoopController() : null;
    const isCoopPartnerApply = coopController != null && coopOwnerOfFieldIndex(this.fieldIndex) !== coopController.role;

    // Whether an interactive SelectTargetPhase was queued for THIS (own) command, so
    // the co-op broadcast of our own pick is DEFERRED until SelectTargetPhase resolves
    // the actual target (relaying the chosen target, not the candidate set).
    let selectTargetQueued = false;

    if (!isCoopPartnerApply && moveTargets.targets.length > 1 && moveTargets.multiple) {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
      selectTargetQueued = true;
    }

    if (turnCommand.move && (moveTargets.targets.length <= 1 || moveTargets.multiple)) {
      turnCommand.move.targets = moveTargets.targets;
    } else if (
      turnCommand.move
      && playerPokemon.getTag(BattlerTagType.CHARGING)
      && playerPokemon.getMoveQueue().length > 0
    ) {
      turnCommand.move.targets = playerPokemon.getMoveQueue()[0].targets;
    } else if (isCoopPartnerApply && turnCommand.move) {
      // Multi-candidate single-target partner move: apply the partner's resolved
      // targets verbatim instead of opening target-select on a mon we don't control.
      turnCommand.move.targets = moveTargets.targets;
    } else {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
      selectTargetQueued = true;
    }

    globalScene.currentBattle.preTurnCommands[this.fieldIndex] = preTurnCommand;
    globalScene.currentBattle.turnCommands[this.fieldIndex] = turnCommand;

    // Broadcast our own-slot command now ONLY if its target is already final. When an
    // interactive SelectTargetPhase was queued, that phase broadcasts the RESOLVED
    // command instead, so the partner never re-opens target-select / re-picks.
    if (!selectTargetQueued) {
      this.broadcastLocalCoopCommand(turnCommand, moveId, moveTargets.targets, useMode);
    }

    return true;
  }

  /**
   * Co-op LOCKSTEP (#633, LIVE-C): broadcast the LOCAL human's OWN-slot FIGHT
   * command over the transport so the PEER's partner-slot await
   * ({@linkcode tryCoopAutoResolve}) resolves with the move the human actually
   * picked, instead of falling back to the peer's AI. Each client commands only
   * its own field slot interactively and broadcasts it; the other client awaits
   * and applies it - that is how two real humans trade moves.
   *
   * GUARDED so the solo / non-coop path is byte-for-byte unaffected:
   *   - only in a co-op run with a live session, and
   *   - only for the LOCAL player's OWN field slot (the partner slot is the one we
   *     AWAIT, never broadcast; broadcasting it would feed the peer its own pick).
   *
   * Known gap (this first cut): only the FIGHT command is broadcast. Non-FIGHT
   * partner commands (switch / item / run) still fall back to the peer's AI - those
   * are not yet relayed. The peer applies `cursor` (the move slot) via
   * {@linkcode resolvePartnerSlotCommand}, which re-validates + re-resolves targets
   * host-side; the wired `targets` are sent for parity / future use but a single-
   * target move with multiple candidates in a double is re-picked by the peer's
   * seeded RNG (a known determinism edge until the apply path consumes the wired
   * targets directly).
   */
  private broadcastLocalCoopCommand(
    turnCommand: TurnCommand,
    moveId: MoveId,
    targets: BattlerIndex[],
    useMode: MoveUseMode,
  ): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    // Only broadcast OUR OWN slot; the partner slot is awaited, not broadcast.
    if (coopOwnerOfFieldIndex(this.fieldIndex) !== controller.role) {
      return;
    }
    const sync = getCoopBattleSync();
    if (sync == null) {
      return;
    }
    sync.broadcastLocalCommand(this.fieldIndex, {
      command: Command.FIGHT,
      cursor: turnCommand.cursor ?? -1,
      moveId,
      targets,
      useMode,
    });
  }

  /**
   * Set the mode in preparation to show the text, and then show the text.
   * Only works for parameterless i18next keys.
   * @param key - The i18next key for the text to show
   */
  private queueShowText(key: string): void {
    globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    globalScene.ui.setMode(UiMode.MESSAGE);

    globalScene.ui.showText(
      i18next.t(key),
      null,
      () => {
        globalScene.ui.showText("", 0);
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleBallCommand} that checks if a pokeball can be thrown
   * and displays the appropriate error message.
   *
   * @remarks
   * The pokeball may not be thrown if any of the following are true:
   * - It is a trainer battle
   * - The player is in the {@linkcode BiomeId.END | End} biome and
   *   - it is not classic mode; or
   *   - the player has not caught the target before and the player is still missing more than one starter
   * - The player is in a mystery encounter that disallows catching the pokemon
   * @returns Whether a pokeball can be thrown
   */
  private checkCanUseBall(): boolean {
    const { arena, currentBattle, gameData, gameMode } = globalScene;
    const { battleType } = currentBattle;
    const { biomeId } = arena;
    const { isClassic, isEndless, isDaily } = gameMode;
    const { dexData } = gameData;

    const isClassicFinalBoss = gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex);
    const isEndlessMinorBoss = gameMode.isEndlessMinorBoss(globalScene.currentBattle.waveIndex);
    const isFullFreshStart = gameMode.isFullFreshStartChallenge();
    const someUncaughtSpeciesOnField = globalScene
      .getEnemyField()
      .some(p => p.isActive() && !dexData[p.species.speciesId].caughtAttr);
    const missingMultipleStarters =
      gameData.getStarterCount(d => !!d.caughtAttr) < Object.keys(speciesStarterCosts).length - 1;
    const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

    if (biomeId === BiomeId.END && battleType === BattleType.WILD) {
      if (
        (isClassic && !isClassicFinalBoss && someUncaughtSpeciesOnField)
        || (isFullFreshStart && !isClassicFinalBoss)
        || (isEndless && !isEndlessMinorBoss)
      ) {
        // Uncatchable paradox mons in classic and endless
        this.queueShowText("battle:noPokeballForce");
      } else if (
        (isClassic && isClassicFinalBoss && missingMultipleStarters)
        || (isFullFreshStart && isClassicFinalBoss)
        || (isEndless && isEndlessMinorBoss)
        || (isDaily && !isCatchableDailyBoss)
      ) {
        // Uncatchable final boss in classic, endless and daily
        this.queueShowText("battle:noPokeballForceFinalBoss");
      } else {
        return true;
      }
    } else if (battleType === BattleType.TRAINER) {
      this.queueShowText("battle:noPokeballTrainer");
    } else if (currentBattle.isBattleMysteryEncounter() && !currentBattle.mysteryEncounter!.catchAllowed) {
      this.queueShowText("battle:noPokeballMysteryEncounter");
    } else {
      return true;
    }

    return false;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is to use a pokeball.
   *
   * @param cursor - The index of the pokeball to use
   * @returns Whether the command was successfully initiated
   */
  private handleBallCommand(cursor: number): boolean {
    const targets = globalScene
      .getEnemyField()
      .filter(p => p.isActive(true))
      .map(p => p.getBattlerIndex());

    if (!this.checkCanUseBall()) {
      return false;
    }

    if (targets.length > 1) {
      this.queueShowText("battle:noPokeballMulti");
      return false;
    }

    const isChallengeActive = globalScene.gameMode.hasAnyChallenges();
    const isFinalBoss = globalScene.gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex);
    const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

    const numBallTypes = 5;
    if (cursor < numBallTypes) {
      const targetPokemon = globalScene.getEnemyPokemon(false);
      if (
        targetPokemon?.isBoss()
        && targetPokemon?.bossSegmentIndex >= 1 // TODO: Decouple this hardcoded exception for wonder guard and just check the target...
        && !targetPokemon?.hasAbility(AbilityId.WONDER_GUARD, false, true)
      ) {
        // When facing the final boss, it must be weakened unless a Master Ball is used AND no challenges are active.
        // The message is customized for the final boss.
        if (
          isFinalBoss
          && (cursor < PokeballType.MASTER_BALL || (cursor === PokeballType.MASTER_BALL && isChallengeActive))
        ) {
          this.queueShowText("battle:noPokeballForceFinalBossCatchable");
          return false;
        }
        // When facing any other boss, Master Ball can always be used, and we use the standard message.
        if (isCatchableDailyBoss || cursor < PokeballType.MASTER_BALL) {
          this.queueShowText("battle:noPokeballStrong");
          return false;
        }
      }

      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: Command.BALL,
        cursor,
      };
      globalScene.currentBattle.turnCommands[this.fieldIndex]!.targets = targets;
      if (this.fieldIndex) {
        globalScene.currentBattle.turnCommands[this.fieldIndex - 1]!.skip = true;
      }
      return true;
    }

    return false;
  }

  /**
   * Submethod of {@linkcode tryLeaveField} to handle the logic for effects that prevent the pokemon from leaving the field
   * due to trapping abilities or effects.
   *
   * This method queues the proper messages in the case of trapping abilities or effects.
   *
   * @returns Whether the pokemon is currently trapped
   */
  private handleTrap(): boolean {
    const playerPokemon = this.getPokemon();
    const trappedAbMessages: string[] = [];
    const isSwitch = this.isSwitch;
    if (!playerPokemon.isTrapped(trappedAbMessages)) {
      return false;
    }
    if (trappedAbMessages.length > 0) {
      if (isSwitch) {
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          globalScene.ui.showText(
            trappedAbMessages[0],
            null,
            () => {
              globalScene.ui.showText("", 0);
              if (isSwitch) {
                globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
              }
            },
            null,
            true,
          );
        });
      }
    } else {
      const trapTag = playerPokemon.getTag(TrappedTag);
      const fairyLockTag = globalScene.arena.getTagOnSide(ArenaTagType.FAIRY_LOCK, ArenaTagSide.PLAYER);

      if (!isSwitch) {
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        globalScene.ui.setMode(UiMode.MESSAGE);
      }
      if (trapTag) {
        this.showNoEscapeText(trapTag, false);
      } else if (fairyLockTag) {
        this.showNoEscapeText(fairyLockTag, false);
      }
    }

    return true;
  }

  /**
   * Common helper method that attempts to have the pokemon leave the field.
   * Checks for trapping abilities and effects.
   *
   * @param cursor - The index of the option that the cursor is on
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private tryLeaveField(cursor?: number, isBatonSwitch = false): boolean {
    const currentBattle = globalScene.currentBattle;

    if (isBatonSwitch || !this.handleTrap()) {
      currentBattle.turnCommands[this.fieldIndex] = this.isSwitch
        ? {
            command: Command.POKEMON,
            cursor,
            args: [isBatonSwitch],
          }
        : {
            command: Command.RUN,
          };
      if (!this.isSwitch && this.fieldIndex) {
        currentBattle.turnCommands[this.fieldIndex - 1]!.skip = true;
      }
      return true;
    }

    return false;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is RUN.
   *
   * @remarks
   * Checks if the player is allowed to flee, and if not, queues the appropriate message.
   *
   * The player cannot flee if:
   * - The player is in the {@linkcode BiomeId.END | End} biome
   * - The player is in a trainer battle
   * - The player is in a mystery encounter that disallows fleeing
   * - The player's pokemon is trapped by an ability or effect
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private handleRunCommand(): boolean {
    const { currentBattle, arena } = globalScene;
    const mysteryEncounterFleeAllowed = currentBattle.mysteryEncounter?.fleeAllowed ?? true;
    if (arena.biomeId === BiomeId.END || !mysteryEncounterFleeAllowed) {
      this.queueShowText("battle:noEscapeForce");
      return false;
    }
    if (
      currentBattle.battleType === BattleType.TRAINER
      || currentBattle.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE
    ) {
      this.queueShowText("battle:noEscapeTrainer");
      return false;
    }

    const success = this.tryLeaveField();

    return success;
  }

  /**
   * Show a message indicating that the pokemon cannot escape, and then return to the command phase.
   */
  private showNoEscapeText(tag: any, isSwitch: boolean): void {
    globalScene.ui.showText(
      i18next.t("battle:noEscapePokemon", {
        pokemonName:
          tag.sourceId && globalScene.getPokemonById(tag.sourceId)
            ? getPokemonNameWithAffix(globalScene.getPokemonById(tag.sourceId)!)
            : "",
        moveName: tag.getMoveName(),
        escapeVerb: i18next.t(isSwitch ? "battle:escapeVerbSwitch" : "battle:escapeVerbFlee"),
      }),
      null,
      () => {
        globalScene.ui.showText("", 0);
        if (!isSwitch) {
          globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        }
      },
      null,
      true,
    );
  }

  // Overloads for handleCommand to provide a more specific signature for the different options
  /**
   * Process the command phase logic based on the selected command
   *
   * @param command - The kind of command to handle
   * @param cursor - The index of option that the cursor is on, or -1 if no option is selected
   * @param useMode - The mode to use for the move, if applicable. For switches, a boolean that specifies whether the switch is a Baton switch.
   * @param move - For {@linkcode Command.FIGHT}, the move to use
   * @returns Whether the command was successful
   */
  handleCommand(command: Command.FIGHT | Command.TERA, cursor: number, useMode?: MoveUseMode, move?: TurnMove): boolean;
  handleCommand(command: Command.POKEMON, cursor: number, useBaton: boolean): boolean;
  handleCommand(command: Command.BALL | Command.RUN, cursor: number): boolean;
  handleCommand(command: Command, cursor: number, useMode?: boolean | MoveUseMode, move?: TurnMove): boolean;

  public handleCommand(
    command: Command,
    cursor: number,
    useMode: boolean | MoveUseMode = false,
    move?: TurnMove,
  ): boolean {
    let success = false;

    switch (command) {
      case Command.TERA:
      case Command.FIGHT:
        success = this.handleFightCommand(command, cursor, typeof useMode === "boolean" ? undefined : useMode, move);
        break;
      case Command.BALL:
        success = this.handleBallCommand(cursor);
        break;
      case Command.POKEMON:
        this.isSwitch = true;
        success = this.tryLeaveField(cursor, typeof useMode === "boolean" ? useMode : undefined);
        this.isSwitch = false;
        break;
      case Command.RUN:
        success = this.handleRunCommand();
    }

    if (success) {
      this.end();
    }

    return success;
  }

  cancel() {
    if (this.fieldIndex) {
      globalScene.phaseManager.unshiftNew("CommandPhase", 0);
      globalScene.phaseManager.unshiftNew("CommandPhase", 1);
      this.end();
    }
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }

  getPokemon(): PlayerPokemon {
    return globalScene.getPlayerField()[this.fieldIndex];
  }

  end() {
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
  }
}
