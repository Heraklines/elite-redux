import { globalScene } from "#app/global-scene";
import { isReleasedCommander } from "#data/elite-redux/ability-upgrades/requested-field-effects";
import {
  getCoopController,
  isAuthoritativeBattleSession,
  isShowdownSyncSession,
  isVersusSession,
} from "#data/elite-redux/coop/coop-runtime";
import type { SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { ER_DOOMED_SWITCH_THRESHOLD_MULT, erAssessThreat, getErAiProfile } from "#data/elite-redux/er-enemy-ai";
import { isReplayRecording, recordReplayCommand } from "#data/elite-redux/replay-recorder";
import type { ReplayCommandKind } from "#data/elite-redux/replay-trace";
import { getShowdownRelay } from "#data/elite-redux/showdown/showdown-battle-state";
import { applyShowdownSyncCommand, hasShowdownSyncCommand } from "#data/elite-redux/showdown/showdown-sync-command";
import { getMoveTargets } from "#data/moves/move-utils";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { FieldPhase } from "#phases/field-phase";

/**
 * Phase for determining an enemy AI's action for the next turn.
 * During this phase, the enemy decides whether to switch (if it has a trainer)
 * or to use a move from its moveset.
 *
 * For more information on how the Enemy AI works, see docs/enemy-ai.md
 * @see {@linkcode Pokemon.getMatchupScore}
 * @see {@linkcode EnemyPokemon.getNextMove}
 */
export class EnemyCommandPhase extends FieldPhase {
  public readonly phaseName = "EnemyCommandPhase";
  protected fieldIndex: number;
  protected skipTurn = false;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
    if (globalScene.currentBattle.mysteryEncounter?.skipEnemyBattleTurns) {
      this.skipTurn = true;
    }
  }

  start() {
    super.start();

    // Co-op AUTHORITATIVE netcode only (#633, TRACK-2 Phase B): the GUEST never resolves
    // enemies - the host is the sole engine. Rolling the AI here (getNextMove /
    // getMatchupScore) would draw battle RNG and desync. Write an inert, skipped command so
    // the phase queue stays well-formed and the guest's TurnStartPhase diverts the whole
    // turn to CoopReplayTurnPhase. In LOCKSTEP the guest rolls the enemy AI NORMALLY (both
    // engines resolve on the shared seed, so they stay in lockstep). Gated on the live guest
    // role, so solo / host play is byte-for-byte unchanged. Showdown-versus (C4) rides the SAME
    // guest short-circuit (its enemy side is the HOST's team; the guest never resolves it).
    //
    // PREDICATE ALIGNMENT (#6): this guest gate is a SHARED co-op+versus behavior, so it keys off the
    // ENGINE-view predicate {@linkcode isAuthoritativeBattleSession} (`authoritative && (isCoop ||
    // isShowdown)`); the host gate below is VERSUS-ONLY (a co-op host's enemy is AI, not a human), so it
    // keys off the NETCODE-view predicate {@linkcode isVersusSession}. See the coop-runtime doc on
    // `isVersusSession` for why the two views agree for a live versus match + when to reach for each.
    if (isAuthoritativeBattleSession() && getCoopController()?.role === "guest") {
      globalScene.currentBattle.turnCommands[globalScene.currentBattle.arrangement.enemyOffset + this.fieldIndex] = {
        command: Command.FIGHT,
        move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
        skip: true,
      };
      return this.end();
    }

    // The Sync guest selected and applied its own canonical enemy-side command while its preceding
    // CommandPhase awaited the host's player-side command. Do not overwrite that human choice with AI.
    if (
      isShowdownSyncSession()
      && getCoopController()?.role === "guest"
      && hasShowdownSyncCommand("enemy", this.fieldIndex)
    ) {
      return this.end();
    }

    // Showdown 1v1 (C4): the HOST awaits the REMOTE player's command for this enemy slot instead
    // of rolling the AI (the enemy side is a real human). On a timeout/null (disconnect) it falls
    // back to the AI so the turn never hangs. The guest short-circuit above already handled the
    // guest; solo / co-op never take this branch (isVersusSession is false).
    if (isVersusSession() && getCoopController()?.role === "host") {
      void this.resolveVersusEnemyCommand();
      return;
    }

    this.resolveEnemyAiCommand();
  }

  /**
   * Showdown 1v1 (C4): resolve THIS enemy slot's command from the remote player's relay, or fall
   * back to the AI on a timeout/disconnect (null) so the turn never hangs.
   */
  private async resolveVersusEnemyCommand(): Promise<void> {
    const relay = getShowdownRelay();
    const turn = globalScene.currentBattle.turn;
    const sync = isShowdownSyncSession();
    const command =
      relay == null
        ? null
        : await (sync ? relay.awaitCommand(turn, this.fieldIndex) : relay.requestEnemyCommand(turn, this.fieldIndex));
    if (sync && command != null && applyShowdownSyncCommand("enemy", this.fieldIndex, command)) {
      this.recordVersusEnemyCommand();
      this.end();
      return;
    }
    // Host-authoritative validation: an out-of-range / illegal relayed pick falls back to the AI
    // (same as a timeout), so a hostile/buggy peer can never force an illegal enemy action.
    if (command == null || !this.isRelayedCommandLegal(command)) {
      // Disconnect / timeout / illegal pick: the enemy acts by AI so the duel never stalls.
      this.resolveEnemyAiCommand();
      // D5 telemetry: capture the AI-fallback enemy command actually committed (no-op unless recording).
      this.recordVersusEnemyCommand();
      return;
    }
    const slot = globalScene.currentBattle.arrangement.enemyOffset + this.fieldIndex;
    if (command.command === Command.POKEMON) {
      globalScene.currentBattle.turnCommands[slot] = {
        command: Command.POKEMON,
        cursor: command.cursor,
        args: [command.baton ?? false],
        skip: this.skipTurn,
      };
    } else {
      const moveId = command.moveId ?? MoveId.NONE;
      // isRelayedCommandLegal already confirmed this enemy mon exists on the field.
      const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];
      globalScene.currentBattle.turnCommands[slot] = {
        command: Command.FIGHT,
        move: {
          move: moveId,
          // Host-authoritative targets: the engine's resolver gives the LEGAL target set. In a 1v1 (and
          // for spread moves / a single candidate) that set is DETERMINISTIC, so the relayed target is
          // ignored - a hostile/buggy peer can't aim at an illegal battler. In doubles/triples a
          // single-target move has MULTIPLE legal candidates, so the guest's chosen target (carried as
          // stable `targetRefs`, mapped across the perspective flip by pokemonId) is honored IF it is in
          // the legal set, else it falls back to the canonical default.
          targets: this.resolveRelayedEnemyTargets(enemyPokemon, moveId, command),
          // SerializedCommand.useMode is a MoveUseMode value carried as a plain number on the wire.
          useMode: (command.useMode as MoveUseMode | undefined) ?? MoveUseMode.NORMAL,
        },
        skip: this.skipTurn,
      };
    }
    // D5 telemetry: capture the RELAYED enemy command actually committed (no-op unless recording).
    this.recordVersusEnemyCommand();
    this.end();
  }

  /**
   * D5 telemetry: RECORD the finalized enemy-slot command (relayed OR AI-fallback) into the replay trace
   * so a showdown match records BOTH sides' per-turn decisions. Reads the committed `turnCommands[slot]`
   * (source-agnostic) and maps it to a {@linkcode ReplayCommandKind}. No-op unless recording (showdown
   * host only). The enemy slot is `enemyOffset + fieldIndex`, so its `slotFieldIndex` is distinct from the
   * host's player-side commands (slots 0/1) - a future showdown loader tells the two sides apart.
   */
  private recordVersusEnemyCommand(): void {
    if (!isReplayRecording()) {
      return;
    }
    const battle = globalScene.currentBattle;
    const slot = battle.arrangement.enemyOffset + this.fieldIndex;
    const tc = battle.turnCommands[slot];
    if (tc == null || tc.skip) {
      return; // an inert/skipped enemy turn contributes no decision
    }
    let kind: ReplayCommandKind;
    if (tc.command === Command.POKEMON) {
      kind = { kind: "switch", partyIndex: tc.cursor ?? 0 };
    } else {
      const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];
      const moveId = tc.move?.move ?? MoveId.NONE;
      const moveIndex = enemyPokemon?.getMoveset().findIndex(m => m?.moveId === moveId) ?? -1;
      const target = tc.move?.targets?.[0];
      kind = target == null ? { kind: "move", moveIndex } : { kind: "move", moveIndex, target };
    }
    recordReplayCommand({
      type: "command",
      wave: battle.waveIndex,
      turn: battle.turn,
      slotFieldIndex: slot,
      command: kind,
    });
  }

  /**
   * Resolve the target set for a relayed enemy FIGHT, host-authoritatively. `getMoveTargets` gives the
   * LEGAL candidate set: a spread move (`multiple`) or a single legal candidate is DETERMINISTIC, so the
   * relayed choice is ignored. For a single-target move with MULTIPLE candidates (doubles/triples), the
   * guest's chosen target is carried as stable `targetRefs` ({side, pokemonId}); each is mapped to the
   * host's battler index by pokemonId (globally unique, shared across clients via the launch snapshot),
   * which handles the perspective flip. A mapped target is honored only if it is in the legal set; an
   * absent/illegal choice falls back to the canonical first legal target.
   */
  private resolveRelayedEnemyTargets(enemyPokemon: EnemyPokemon, moveId: number, command: SerializedCommand): number[] {
    const legal = getMoveTargets(enemyPokemon, moveId);
    // Deterministic set: spread move, or 0/1 legal candidate. No live choice to honor.
    if (legal.multiple || legal.targets.length <= 1) {
      return legal.targets;
    }
    // Multiple single-target candidates (doubles/triples). Map the relayed stable refs to host indices.
    const field = [...globalScene.getPlayerField(), ...globalScene.getEnemyField()];
    const legalSet = new Set(legal.targets);
    for (const ref of command.targetRefs ?? []) {
      const mon = field.find(p => p.id === ref.pokemonId);
      const bi = mon?.getBattlerIndex();
      if (bi != null && legalSet.has(bi)) {
        return [bi]; // a single-target move commits to exactly one chosen foe
      }
    }
    // No valid relayed choice: use the engine's canonical default (first legal target).
    return [legal.targets[0]];
  }

  /**
   * Host-authoritative legality of a RELAYED enemy command against THIS live enemy mon (streamed
   * state can't cheat): a FIGHT must name a move the mon actually carries AND that move must have PP
   * remaining; a POKEMON switch must target a real, non-fainted, benched party member. An illegal pick
   * is rejected -> the caller AI-falls-back.
   */
  private isRelayedCommandLegal(command: SerializedCommand): boolean {
    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];
    if (enemyPokemon == null) {
      return false;
    }
    if (command.command === Command.POKEMON) {
      const target = globalScene.getEnemyParty()[command.cursor];
      return target != null && !target.isFainted() && !target.isOnField();
    }
    // FIGHT: the chosen move must be one the mon actually carries (never an injected arbitrary move)
    // AND it must have PP left (#4) - a no-PP move can't legally be used, so it AI-falls-back instead.
    const move = enemyPokemon.getMoveset().find(m => m?.moveId === command.moveId);
    return move != null && !move.isOutOfPp();
  }

  /** Roll the enemy AI's command for this slot (the vanilla / co-op-host / disconnect-fallback path). */
  private resolveEnemyAiCommand(): void {
    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];

    const battle = globalScene.currentBattle;

    const trainer = battle.trainer;

    // Any multi format + ANY ally (a triple has two; was `double` + first-ally-only, so
    // Commander never skipped the hidden mon's turn in triples): the acting mon is hiding
    // in an ally Dondozo iff some ally carries a COMMANDED tag SOURCED by it.
    if (
      battle.getBattlerCount() > 1
      && enemyPokemon.hasAbility(AbilityId.COMMANDER)
      && !isReleasedCommander(enemyPokemon)
      && enemyPokemon
        .getAllies()
        .some(ally => ally.getTag(BattlerTagType.COMMANDED)?.getSourcePokemon() === enemyPokemon)
    ) {
      this.skipTurn = true;
    }

    /**
     * If the enemy has a trainer, decide whether or not the enemy should switch
     * to another member in its party.
     *
     * This block compares the active enemy Pokemon's {@linkcode Pokemon.getMatchupScore | matchup score}
     * against the active player Pokemon with the enemy party's other non-fainted Pokemon. If a party
     * member's matchup score is 3x the active enemy's score (or 2x for "boss" trainers),
     * the enemy will switch to that Pokemon.
     */
    if (trainer && enemyPokemon.getMoveQueue().length === 0) {
      const opponents = enemyPokemon.getOpponents();

      if (!enemyPokemon.isTrapped()) {
        // ER smarter AI (Elite/Hell): use the best-move matchup metric for both
        // the bench and the active mon, and a tuned (lower) switch threshold so
        // the AI swaps to a real counter more readily. Inactive -> vanilla.
        const erAi = getErAiProfile(enemyPokemon);
        const partyMemberScores = trainer.getPartyMemberMatchupScores(enemyPokemon.trainerSlot, true, erAi.active);

        if (partyMemberScores.length > 0) {
          const matchupScores = opponents.map(opp => enemyPokemon.getMatchupScore(opp, erAi.active));
          const matchupScore = matchupScores.reduce((total, score) => (total += score), 0) / matchupScores.length;

          const sortedPartyMemberScores = trainer.getSortedPartyMemberMatchupScores(partyMemberScores);

          const switchMultiplier = 1 - (battle.enemySwitchCounter ? Math.pow(0.1, 1 / battle.enemySwitchCounter) : 0);

          let switchThreshold = erAi.active ? erAi.switchThreshold : trainer.config.isBoss ? 2 : 3;
          // Phase A2: if the active mon is DOOMED this turn (an opponent KOs it and
          // it can't outrun the hit), pivot more eagerly - drop the threshold so a
          // benched wall triggers the switch. The active dies for nothing otherwise.
          if (erAi.active) {
            const threat = erAssessThreat(enemyPokemon);
            if (threat.incomingKO && !threat.outspeeds) {
              switchThreshold *= ER_DOOMED_SWITCH_THRESHOLD_MULT;
            }
          }

          if (sortedPartyMemberScores[0][1] * switchMultiplier >= matchupScore * switchThreshold) {
            const index = trainer.getNextSummonIndex(enemyPokemon.trainerSlot, partyMemberScores);

            battle.turnCommands[globalScene.currentBattle.arrangement.enemyOffset + this.fieldIndex] = {
              command: Command.POKEMON,
              cursor: index,
              args: [false],
              skip: this.skipTurn,
            };

            battle.enemySwitchCounter++;

            this.end();
            return;
          }
        }
      }
    }

    /** Select a move to use (and a target to use it against, if applicable) */
    const nextMove = enemyPokemon.getNextMove();

    if (this.shouldTera(enemyPokemon)) {
      globalScene.currentBattle.preTurnCommands[globalScene.currentBattle.arrangement.enemyOffset + this.fieldIndex] = {
        command: Command.TERA,
      };
    }

    globalScene.currentBattle.turnCommands[globalScene.currentBattle.arrangement.enemyOffset + this.fieldIndex] = {
      command: Command.FIGHT,
      move: nextMove,
      skip: this.skipTurn,
    };

    globalScene.currentBattle.enemySwitchCounter = Math.max(globalScene.currentBattle.enemySwitchCounter - 1, 0);

    this.end();
  }

  private shouldTera(pokemon: EnemyPokemon): boolean {
    return !!globalScene.currentBattle.trainer?.shouldTera(pokemon);
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }
}
