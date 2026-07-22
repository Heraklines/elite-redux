import { consumePendingDevBattleSetup } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { isCoopV2ReplacementCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import {
  isCoopAuthoritativeGuestGated,
  isShowdownGuestFlipGated,
} from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { getCoopBattleStreamer, getCoopController } from "#data/elite-redux/coop/coop-runtime";
import { erRecordAchievementTurnStart } from "#data/elite-redux/er-achievement-tracker";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { BattleType } from "#enums/battle-type";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import { Stat } from "#enums/stat";
import { SwitchType } from "#enums/switch-type";
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

  /**
   * A V2 replacement result owns the complete post-summon state and the next command frontier. The
   * replica's ordinary TurnInit queue puts CommandPhase before TurnStartPhase/CoopReplayTurnPhase; if the
   * retained replacement carrier is already waiting, that command correctly fences itself on V2 material
   * and thereby blocks the only phase that can apply that material. Route the exact current/N+1 carrier to
   * the replay transaction first. It will apply + checksum + settle the replacement and then open only the
   * command slot authorized by the committed successor.
   */
  private pendingAuthoritativeReplacementTurn(): number | null {
    if (!isCoopAuthoritativeGuestGated() || !isCoopV2ReplacementCutoverActive()) {
      return null;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    const battle = globalScene.currentBattle;
    if (controller == null || streamer == null || battle == null) {
      return null;
    }
    const currentTurn = battle.turn;
    const currentWave = battle.waveIndex;
    const pending = streamer.peekCheckpointForTurn(currentTurn, currentWave);
    if (
      pending?.reason !== "replacement"
      || pending.epoch !== controller.sessionEpoch
      || pending.wave !== currentWave
      || pending.authoritativeState?.wave !== currentWave
      || (pending.turn !== currentTurn && pending.turn !== currentTurn + 1)
    ) {
      return null;
    }
    return currentTurn;
  }

  /**
   * A versus guest must not expose its next command while the host's fainted lead is still on its
   * renderer. The replacement is a separately addressed authority commit; CoopReplayTurnPhase consumes
   * it at the safe replay boundary and opens the command only after the new enemy is materialized.
   */
  private shouldDeferVersusGuestCommandForEnemyReplacement(): boolean {
    return isShowdownGuestFlipGated() && !globalScene.getEnemyField().some(enemy => enemy?.isActive());
  }

  /**
   * The authoritative guest owns input and presentation only.  Its locally-created TurnInitPhase must not
   * execute challenge cleanup, Mystery Encounter hooks, biome ambush RNG, enemy AI, or structural recentering.
   * Queue only the player command-intent phases and the renderer dispatcher; the host's turn stream supplies
   * every resolution and the ensuing checkpoint supplies canonical state.
   */
  private startAuthoritativeGuestInputTurn(): boolean {
    if (!isCoopAuthoritativeGuestGated()) {
      return false;
    }
    const replacementReplayTurn = this.pendingAuthoritativeReplacementTurn();
    if (replacementReplayTurn != null) {
      globalScene.getPlayerField().forEach(pokemon => {
        if (pokemon?.isActive()) {
          pokemon.resetTurnData();
        }
      });
      coopLog(
        "v2-replacement",
        `guest defers command until retained replacement material applies at wave=${globalScene.currentBattle.waveIndex} `
          + `turn=${replacementReplayTurn}`,
      );
      globalScene.phaseManager.pushNew(
        "CoopReplayTurnPhase",
        replacementReplayTurn,
        0,
        undefined,
        globalScene.currentBattle.waveIndex,
      );
      this.end();
      return true;
    }
    const deferCommand = this.shouldDeferVersusGuestCommandForEnemyReplacement();
    globalScene.getField().forEach((pokemon, fieldIndex) => {
      if (pokemon?.isPlayer() && pokemon.isActive()) {
        // Clear prior-turn input ephemera so the local command UI cannot inherit a stale queued/skip state.
        // This does not resolve an action; the host validates and commits the resulting command intent.
        pokemon.resetTurnData();
        if (!deferCommand) {
          globalScene.phaseManager.pushNew("CommandPhase", fieldIndex);
        }
      }
    });
    globalScene.phaseManager.pushNew("TurnStartPhase");
    this.end();
    return true;
  }

  start() {
    super.start();

    if (this.startAuthoritativeGuestInputTurn()) {
      return;
    }

    // catalog-v2 (#900): a turn is starting - init KO stints, arm LAST_MON_STANDING / IDENTITY_THEFT.
    erRecordAchievementTurnStart();

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

    // Showdown 1v1 (versus HOST-faint replacement): the versus GUEST is a pure renderer whose ENEMY
    // side is the remote host's team. When the host's own mon faints, the host summons its replacement
    // AFTER streaming this turn's resolution, as a SEPARATE out-of-band `reason=replacement` checkpoint
    // the guest only consumes in the NEXT turn's replay pump (CoopReplayTurnPhase). If we open the
    // guest's CommandPhase here (its own TurnInit) while the enemy platform is still empty, the guest
    // commands BLIND - "i had to choose a move to SEE your new pokemon". So when the versus guest has no
    // active enemy on the field (a host replacement is pending), DEFER opening the guest's own command:
    // skip it here and let the replay pump's checkpoint branch open it AFTER it applies the enemy
    // replacement (the SAME deferred-command mechanism the guest-OWN-faint path already uses, keyed on
    // the enemy slot instead of the own slot). Deterministic - the pump PARKS on the specific
    // replacement checkpoint (host-stall fallback bounds it), no spin, no timeout. If the replacement
    // already rendered by now (the non-racy timing) this is false and the command opens normally.
    const deferVersusGuestCommandForEnemyReplacement = this.shouldDeferVersusGuestCommandForEnemyReplacement();

    globalScene.getField().forEach((pokemon, i) => {
      if (pokemon?.isActive()) {
        if (pokemon.isPlayer()) {
          globalScene.currentBattle.addParticipant(pokemon as PlayerPokemon);
        }

        pokemon.resetTurnData();

        if (pokemon.isPlayer()) {
          if (!deferVersusGuestCommandForEnemyReplacement) {
            globalScene.phaseManager.pushNew("CommandPhase", i);
          }
        } else {
          // Multi-format: the enemy's position within its side (== i - enemyOffset, which is
          // BattlerIndex.ENEMY in binary but shifts in triple). getFieldIndex is self-consistent.
          globalScene.phaseManager.pushNew("EnemyCommandPhase", pokemon.getFieldIndex());
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
    const rule = getErBiomeRule(globalScene.arena.biomeId);
    const chance = rule?.ambushChance;
    if (!chance) {
      return;
    }
    const enemy = globalScene.getEnemyField(true)[0] as EnemyPokemon | undefined;
    const player = globalScene.getPlayerPokemon();
    if (!enemy?.isActive(true) || !player?.isActive(true)) {
      return;
    }
    // Reacted in time: the ambush is prevented when your lead holds the line.
    // Ruins (ambushDefenseGate): your lead's Defense >= the foe's Attack. Forest /
    // Snowy Forest: your lead is at least as fast as the foe.
    const avoided = rule.ambushDefenseGate
      ? player.getEffectiveStat(Stat.DEF, enemy) >= enemy.getEffectiveStat(Stat.ATK, player)
      : player.getEffectiveStat(Stat.SPD, enemy) >= enemy.getEffectiveStat(Stat.SPD, player);
    if (avoided) {
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
    // #629: the ambush move runs BEFORE the player's CommandPhase (already queued
    // above). If it KOs a player mon, FaintPhase only pushes its forced-switch
    // SwitchPhase to the BACK of the queue, so the CommandPhase would otherwise run
    // first and present the Fight menu for the FAINTED mon ("attack with a fainted
    // mon"). Interpose a modal faint-switch per active player slot so the
    // replacement is summoned BEFORE the command. The MovePhase is a dynamic phase
    // (runs a level above), so these non-dynamic SwitchPhases queue right after it
    // and before the CommandPhases. Modal + doReturn=false mirrors FaintPhase's own
    // switch: SwitchPhase.start() no-ops it when the slot's mon survived (or there
    // is no legal bench mon, or FaintPhase's back-queued switch already refilled it).
    for (const playerMon of globalScene.getPlayerField()) {
      if (playerMon?.isActive()) {
        globalScene.phaseManager.unshiftNew("SwitchPhase", SwitchType.SWITCH, playerMon.getFieldIndex(), true, false);
      }
    }
    // ER ambush signal (#439 §3): the free enemy move is otherwise a mystery (the
    // foe just acts before the player). Announce it so the player knows they were
    // ambushed. Unshifted LAST -> a non-MovePhase prepends to the queue front, so
    // it shows BEFORE the ambush move resolves (the no-op modal switches above are
    // invisible while the lead is still standing). Applies to Forest, Snowy Forest,
    // and Ruins (every biome with an ambushChance).
    globalScene.phaseManager.unshiftNew("MessagePhase", "You were ambushed! The foe strikes first!", null, true);
  }
}
