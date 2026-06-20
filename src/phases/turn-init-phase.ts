import { consumePendingDevBattleSetup } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import { Stat } from "#enums/stat";
import { TurnInitEvent } from "#events/battle-scene";
import type { EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import {
  handleMysteryEncounterBattleStartEffects,
  handleMysteryEncounterTurnStartEffects,
} from "#mystery-encounters/encounter-phase-utils";
import { FieldPhase } from "#phases/field-phase";
import i18next from "i18next";

export class TurnInitPhase extends FieldPhase {
  public readonly phaseName = "TurnInitPhase";
  start() {
    super.start();

    // Local-only dev tools: a test scenario may stage mid-combat setup (e.g.
    // pre-boosted stat stages) to apply once both sides are on the field.
    // consumePendingDevBattleSetup() returns null in production / clean checkout,
    // so this is inert there.
    const devBattleSetup = consumePendingDevBattleSetup();
    if (devBattleSetup) {
      try {
        devBattleSetup();
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
        console.warn("[dev-tools] battle setup threw:", err);
      }
    }

    globalScene.getPlayerField().forEach(p => {
      // If this pokemon is in play and can't legally be here, force a switch.
      // isAllowedInBattle() is `!isFainted() && isAllowedInChallenge()`, so a mon
      // that merely FAINTED (but is otherwise challenge-legal) also lands here and
      // is cleaned off the field - but it must NOT be announced as "ineligible for
      // this challenge". That challenge-worded notice only applies when the mon is
      // actually illegal under a challenge (e.g. evolved into a banned form);
      // showing it for a fainted lead was wrong, and doubly so since ER difficulty
      // tiers (Youngster/Ace/Elite/Hell) aren't challenges at all. (Scyther Redux
      // report: a fainted lead mislabeled "ineligible for the challenge".)
      if (p.isOnField() && !p.isAllowedInBattle()) {
        if (!p.isAllowedInChallenge()) {
          globalScene.phaseManager.queueMessage(
            i18next.t("challenges:illegalEvolution", { pokemon: p.name }),
            null,
            true,
          );
        }

        const allowedPokemon = globalScene.getPokemonAllowedInBattle();

        if (allowedPokemon.length === 0) {
          // If there are no longer any legal pokemon in the party, game over.
          globalScene.phaseManager.clearPhaseQueue();
          globalScene.phaseManager.unshiftNew("GameOverPhase");
        } else if (
          allowedPokemon.length >= globalScene.currentBattle.getBattlerCount()
          || (globalScene.currentBattle.double && !allowedPokemon[0].isActive(true))
        ) {
          // If there is at least one pokemon in the back that is legal to switch in, force a switch.
          p.switchOut();
        } else {
          // If there are no pokemon in the back but we're not game overing, just hide the pokemon.
          // This should only happen in double battles.
          p.leaveField();
        }
        if (allowedPokemon.length === 1 && globalScene.currentBattle.double) {
          globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
        }
      }
    });

    globalScene.eventTarget.dispatchEvent(new TurnInitEvent());

    handleMysteryEncounterBattleStartEffects();

    // If true, will skip remainder of current phase (and not queue CommandPhases etc.)
    if (handleMysteryEncounterTurnStartEffects()) {
      this.end();
      return;
    }

    globalScene.getField().forEach((pokemon, i) => {
      if (pokemon?.isActive()) {
        if (pokemon.isPlayer()) {
          globalScene.currentBattle.addParticipant(pokemon as PlayerPokemon);
        }

        pokemon.resetTurnData();

        if (pokemon.isPlayer()) {
          globalScene.phaseManager.pushNew("CommandPhase", i);
        } else {
          globalScene.phaseManager.pushNew("EnemyCommandPhase", i - BattlerIndex.ENEMY);
        }
      }
    });

    globalScene.phaseManager.pushNew("TurnStartPhase");

    this.applyErForestAmbush();

    this.end();
  }

  /**
   * ER biome identity (#439 §3): Forest / Snowy Forest ambush. On turn 1 of a
   * WILD encounter, a % chance the foe snatches a FREE move before you act -
   * unless your lead outspeeds it (you reacted in time). Reuses the Instruct
   * pattern (unshift a FIRST-timing MovePhase) and the enemy's own AI to pick a
   * sensible move + target.
   */
  private applyErForestAmbush(): void {
    const battle = globalScene.currentBattle;
    if (battle.turn !== 1 || battle.battleType !== BattleType.WILD) {
      return;
    }
    const chance = getErBiomeRule(globalScene.arena.biomeId)?.ambushChance;
    if (!chance) {
      return;
    }
    const enemy = globalScene.getEnemyField(true)[0] as EnemyPokemon | undefined;
    const player = globalScene.getPlayerPokemon();
    if (!enemy?.isActive(true) || !player?.isActive(true)) {
      return;
    }
    // Reacted in time: a lead that is at least as fast prevents the ambush.
    if (player.getEffectiveStat(Stat.SPD, enemy) >= enemy.getEffectiveStat(Stat.SPD, player)) {
      return;
    }
    if (globalScene.randBattleSeedInt(100) >= chance) {
      return;
    }
    const turnMove = enemy.getNextMove();
    if (!turnMove?.move) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      enemy,
      turnMove.targets,
      new PokemonMove(turnMove.move),
      MoveUseMode.NORMAL,
      MovePhaseTimingModifier.FIRST,
    );
  }
}
