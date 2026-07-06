import { globalScene } from "#app/global-scene";
import { getCoopController, isAuthoritativeBattleSession } from "#data/elite-redux/coop/coop-runtime";
import { ER_DOOMED_SWITCH_THRESHOLD_MULT, erAssessThreat, getErAiProfile } from "#data/elite-redux/er-enemy-ai";
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
    if (isAuthoritativeBattleSession() && getCoopController()?.role === "guest") {
      globalScene.currentBattle.turnCommands[globalScene.currentBattle.arrangement.enemyOffset + this.fieldIndex] = {
        command: Command.FIGHT,
        move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
        skip: true,
      };
      return this.end();
    }

    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];

    const battle = globalScene.currentBattle;

    const trainer = battle.trainer;

    // Any multi format + ANY ally (a triple has two; was `double` + first-ally-only, so
    // Commander never skipped the hidden mon's turn in triples): the acting mon is hiding
    // in an ally Dondozo iff some ally carries a COMMANDED tag SOURCED by it.
    if (
      battle.getBattlerCount() > 1
      && enemyPokemon.hasAbility(AbilityId.COMMANDER)
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

            return this.end();
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
