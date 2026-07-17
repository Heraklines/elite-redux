import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves } from "#data/data-lists";
import { classicFinalBossDialogue } from "#data/dialogue";
import { erHeartbreakOnAllyFaint } from "#data/elite-redux/abilities/heartbreak";
import type { CoopFaintSourceAddress } from "#data/elite-redux/coop/coop-faint-switch-operation";
import { getCoopController, isVersusSession } from "#data/elite-redux/coop/coop-runtime";
import {
  consumeCoopRecordedFaintOccurrence,
  isCoopRecording,
  withCoopMessageRecordingSuppressed,
} from "#data/elite-redux/coop/coop-turn-recorder";
import {
  erRecordAchievementEnemyFaint,
  erRecordAchievementPlayerFaint,
} from "#data/elite-redux/er-achievement-tracker";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { recordErStreakFaint } from "#data/elite-redux/er-money-streak";
import { erMomentumEngineOnEnemyKo, erRelicRecordPlayerFaint, erTryAnchorLastStand } from "#data/elite-redux/er-relics";
import { SpeciesFormChangeActiveTrigger } from "#data/form-change-triggers";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { FieldPosition } from "#enums/field-position";
import { HitResult } from "#enums/hit-result";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { SwitchType } from "#enums/switch-type";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { type PokemonHeldItemModifier, PokemonInstantReviveModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { PokemonPhase } from "#phases/pokemon-phase";
import { achvs } from "#system/achv";
import { inSpeedOrder } from "#utils/speed-order-generator";
import i18next from "i18next";

export class FaintPhase extends PokemonPhase {
  public readonly phaseName = "FaintPhase";
  /**
   * Whether or not instant revive should be prevented
   */
  private readonly preventInstantRevive: boolean;

  /**
   * The source Pokemon that dealt fatal damage; only present for faints triggered by a move.
   */
  // TODO: This should be handled by a move in flight object/similar
  private readonly source?: Pokemon | undefined;
  /** Immutable authoritative event identity captured before any delayed/re-entrant faint work. */
  private faintSourceAddress: CoopFaintSourceAddress | undefined;

  constructor(battlerIndex: BattlerIndex, preventInstantRevive = false, source?: Pokemon) {
    super(battlerIndex);

    this.preventInstantRevive = preventInstantRevive;
    this.source = source;
  }

  public override start(): void {
    super.start();

    const faintPokemon = this.getPokemon();
    this.faintSourceAddress = {
      wave: globalScene.currentBattle.waveIndex,
      turn: globalScene.currentBattle.turn,
      occurrence: consumeCoopRecordedFaintOccurrence(this.battlerIndex) ?? 0,
    };

    if (this.source) {
      faintPokemon.getTag(BattlerTagType.DESTINY_BOND)?.lapse(this.source, BattlerTagLapseType.CUSTOM);
      faintPokemon.getTag(BattlerTagType.GRUDGE)?.lapse(faintPokemon, BattlerTagLapseType.CUSTOM, this.source);
    }

    faintPokemon.resetSummonData();

    if (!this.preventInstantRevive) {
      const instantReviveModifier = globalScene.applyModifier(
        PokemonInstantReviveModifier,
        this.player,
        faintPokemon,
      ) as PokemonInstantReviveModifier;

      if (instantReviveModifier) {
        faintPokemon.loseHeldItem(instantReviveModifier);
        globalScene.updateModifiers(this.player);
        this.end();
        return;
      }
    }

    /**
     * In case the current pokemon was just switched in, make sure it is counted as participating in the combat.
     * For EXP_SHARE purposes, if the current pokemon faints as the combat ends and it was the ONLY player pokemon
     * involved in combat, it needs to be counted as a participant so the other party pokemon can get their EXP,
     * so the fainted pokemon has been included.
     */
    for (const pokemon of globalScene.getPlayerField()) {
      if (pokemon?.isActive() || pokemon?.isFainted()) {
        globalScene.currentBattle.addParticipant(pokemon);
      }
    }

    if (globalScene.currentBattle.isClassicFinalBoss && !this.player) {
      this.handleFinalBossFaint();
    } else {
      this.doFaint();
    }
  }

  private doFaint(): void {
    const pokemon = this.getPokemon();
    // A replacement phase may not run until TurnInit has already advanced the mutable battle turn.
    // Capture the faint's immutable protocol address here, at the event source, and carry it through
    // every later host/renderer phase instead of reconstructing it from ambient scene state.
    const faintSourceAddress = this.faintSourceAddress ?? {
      wave: globalScene.currentBattle.waveIndex,
      turn: globalScene.currentBattle.turn,
      occurrence: 0,
    };

    // ER Heartbreak (ability 5920): if this fainting Pokemon was linked to a
    // living Heartbreak holder, that holder gains +1 Speed / +1 higher attacking
    // stat and loses -1 Def / -1 Sp.Def.
    erHeartbreakOnAllyFaint(pokemon);

    // Track total times pokemon have been KO'd for Last Respects/Supreme Overlord
    if (pokemon.isPlayer()) {
      globalScene.arena.playerFaints += 1;
      erRecordAchievementPlayerFaint(pokemon);
      // ER Slum (#439 §3): the den - every ALLY that faints in a TRAINER battle
      // costs you a slice of your money (2% of the current purse). Trainer battles
      // only (a wild faint is free); gated on the biome rule so it only bites here.
      const moneyLossPct = getErBiomeRule(globalScene.arena.biomeId)?.moneyLossPctPerFaint;
      if (moneyLossPct && globalScene.currentBattle.battleType === BattleType.TRAINER && globalScene.money > 0) {
        const loss = Math.floor((globalScene.money * moneyLossPct) / 100);
        if (loss > 0) {
          globalScene.money = Math.max(0, globalScene.money - loss);
          globalScene.updateMoneyText();
          globalScene.animateMoneyChanged(false);
          globalScene.phaseManager.queueMessage(
            `In the chaos of the slum, you lost ₽${loss} when ${getPokemonNameWithAffix(pokemon)} fell!`,
            null,
            true,
          );
        }
      }
      // ER money streak (#348): a faint breaks this mon's faint-free streak.
      recordErStreakFaint(pokemon);
      // ER relics (#439): a player faint breaks Morale Banner's faint-free bonus
      // for the rest of this biome.
      erRelicRecordPlayerFaint();
      // ER relics (#439): Anchor - if the slot 6 mon is now the last one standing,
      // fully heal it once per biome (last stand). No-op unless the relic is held.
      erTryAnchorLastStand();
      globalScene.currentBattle.playerFaintsHistory.push({
        pokemon,
        turn: globalScene.currentBattle.turn,
      });
    } else {
      globalScene.currentBattle.enemyFaints += 1;
      erRecordAchievementEnemyFaint(pokemon);
      // ER relics (#439): Momentum Engine - each enemy KO grants the active player
      // mon +1 Speed stage (resets each battle). No-op unless the relic is held.
      erMomentumEngineOnEnemyKo();
      globalScene.currentBattle.enemyFaintsHistory.push({
        pokemon,
        turn: globalScene.currentBattle.turn,
      });
    }

    // #691 (host-language leak): the guest REGENERATES "X fainted!" in its OWN language from the `faint`
    // event (narrate=true), so the host must NOT also stream its (host-language) `fainted` line - suppress
    // RECORDING it (still SHOWN locally; only the recorder tap is gated). Gated on `isCoopRecording()` so
    // solo / host / lockstep call `narrate()` directly with byte-identical args.
    const narrate = () =>
      globalScene.phaseManager.queueMessage(
        i18next.t("battle:fainted", {
          pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        }),
        null,
        true,
      );
    const coopRecording = isCoopRecording();
    if (coopRecording) {
      withCoopMessageRecordingSuppressed(narrate);
    } else {
      narrate();
    }
    // An off-field enemy's delayed active-form revert is a proven no-op in QuietFormChangePhase. During
    // authoritative recording, queuing it after TurnEnd only trips the unresolved-mutation sentinel and
    // terminates an otherwise valid turn (Xerneas wave-190 soak). Omit that inert enemy phase. A player
    // revert is material, so run it in this faint subtree before CoopTurnCommit captures the checkpoint.
    // Solo and lockstep preserve the original delayed ordering byte-for-byte.
    if (!coopRecording || pokemon.isPlayer()) {
      globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeActiveTrigger, !coopRecording);
    }

    pokemon.resetTera();

    // TODO: this can be simplified by just checking whether lastAttack is defined
    if (pokemon.turnData.attacksReceived?.length > 0) {
      const lastAttack = pokemon.turnData.attacksReceived[0];
      applyAbAttrs("PostFaintAbAttr", {
        pokemon,
        // TODO: We should refactor lastAttack's sourceId to forbid null and just use undefined
        attacker: globalScene.getPokemonById(lastAttack.sourceId) ?? undefined,
        // TODO: improve the way that we provide the move that knocked out the pokemon...
        move: new PokemonMove(lastAttack.move).getMove(),
      }); // TODO: is this bang correct?
    } else {
      //If killed by indirect damage, apply post-faint abilities without providing a last move
      applyAbAttrs("PostFaintAbAttr", { pokemon });
    }

    for (const p of inSpeedOrder(ArenaTagSide.BOTH)) {
      applyAbAttrs("PostKnockOutAbAttr", { pokemon: p, victim: pokemon });
    }
    if (pokemon.turnData.attacksReceived?.length > 0) {
      const defeatSource = this.source;

      if (defeatSource?.isOnField()) {
        applyAbAttrs("PostVictoryAbAttr", { pokemon: defeatSource });
        const pvmove = allMoves[pokemon.turnData.attacksReceived[0].move];
        const pvattrs = pvmove.getAttrs("PostVictoryStatStageChangeAttr");
        if (pvattrs.length > 0) {
          for (const pvattr of pvattrs) {
            pvattr.applyPostVictory(defeatSource, defeatSource, pvmove);
          }
        }
      }
    }

    if (this.player) {
      /** The total number of Pokemon in the player's party that can legally fight */
      const legalPlayerPokemon = globalScene.getPokemonAllowedInBattle();
      /** The total number of legal player Pokemon that aren't currently on the field */
      const legalPlayerPartyPokemon = legalPlayerPokemon.filter(p => !p.isActive(true));
      if (legalPlayerPokemon.length === 0) {
        /** If the player doesn't have any legal Pokemon, end the game */
        globalScene.phaseManager.unshiftNew("GameOverPhase");
      } else if (
        legalPlayerPokemon.length === 1
        && legalPlayerPartyPokemon.length === 0
        && (globalScene.currentBattle.double || globalScene.currentBattle.getBattlerCount() >= 3)
      ) {
        /**
         * Exactly one legal Pokemon left and already on the field: recenter it. A double toggles its
         * +/-32 slot offset; a triple sets the position directly (its lone survivor may be at any slot).
         */
        if (globalScene.currentBattle.double) {
          globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
        } else {
          legalPlayerPokemon.find(p => p.isActive(true))?.setFieldPosition(FieldPosition.CENTER, 500);
        }
      } else if (legalPlayerPartyPokemon.length > 0) {
        /**
         * If previous conditions weren't met, and the player has at least 1 legal Pokemon off the field,
         * push a phase that prompts the player to summon a Pokemon from their party.
         */
        globalScene.phaseManager.pushNew(
          "SwitchPhase",
          SwitchType.SWITCH,
          this.fieldIndex,
          true,
          false,
          faintSourceAddress,
        );
      }
    } else {
      globalScene.phaseManager.unshiftNew("VictoryPhase", this.battlerIndex);
      let willSwitchIn = false;
      if ([BattleType.TRAINER, BattleType.MYSTERY_ENCOUNTER].includes(globalScene.currentBattle.battleType)) {
        // Slot-gate the replacement only in DOUBLES (each partner refills its own slot).
        // In a single battle ANY reserve must come in: mixed trainerSlot values (e.g. a
        // double-variant trainer config rolled into a single format) otherwise soft-lock
        // the fight - the fainted mon stays on an empty field and the battle can't end
        // (found by the headless full-run harness at a seeded wave-22 trainer).
        const hasReservePartyMember =
          globalScene
            .getEnemyParty()
            .filter(
              p =>
                p.isActive()
                && !p.isOnField()
                && (!globalScene.currentBattle.double || p.trainerSlot === (pokemon as EnemyPokemon).trainerSlot),
            ).length > 0;
        if (hasReservePartyMember) {
          // Showdown 1v1 (versus faint-replacement): the enemy side is the remote human GUEST's own
          // team, so the HOST must AWAIT the guest's relayed replacement pick instead of AI auto-picking
          // (the guest's renderer opens its own faint picker off this streamed faint and relays the
          // choice). The dedicated phase awaits that pick, validates it, summons it, and AI-falls-back on
          // a timeout/illegal pick so the duel never stalls. A co-op host (its enemy is AI) or any
          // non-versus trainer keeps the vanilla inline auto-pick below.
          if (isVersusSession() && getCoopController()?.role === "host") {
            globalScene.phaseManager.pushNew("ShowdownEnemyFaintSwitchPhase", this.fieldIndex, faintSourceAddress);
          } else {
            globalScene.phaseManager.pushNew("SwitchSummonPhase", SwitchType.SWITCH, this.fieldIndex, -1, false, false);
          }
          willSwitchIn = true;
        }
      }
      // ER rival-sprite-shift fix: in a double battle, when a foe faints and
      // nothing switches into its slot, the lone surviving foe keeps its
      // double-slot offset (+32 RIGHT / -32 LEFT). The player branch above
      // recenters its lone survivor via ToggleDoublePositionPhase, but the enemy
      // branch never did, so the survivor stayed shifted off-center (reported in
      // DOUBLES_ONLY / co-op rival fights, on mons that never evolved). Recenter it.
      // Recenter a LONE surviving foe (exactly one left on the side) to CENTER. A double always
      // reaches here with one survivor; a triple only when it has collapsed to one (the
      // 2-non-adjacent-survivor auto-shift is a separate, not-yet-implemented mechanic).
      if (!willSwitchIn && (globalScene.currentBattle.double || globalScene.currentBattle.getBattlerCount() >= 3)) {
        const survivors = globalScene.getEnemyField().filter(p => p !== pokemon && !p.isFainted());
        if (survivors.length === 1) {
          survivors[0].setFieldPosition(FieldPosition.CENTER, 500);
        }
      }
    }

    // in double battles redirect potential moves off fainted pokemon
    const allyPokemon = pokemon.getAlly();
    if (globalScene.currentBattle.double && allyPokemon != null) {
      globalScene.redirectPokemonMoves(pokemon, allyPokemon);
    }

    pokemon.faintCry(() => {
      if (pokemon.isPlayer()) {
        pokemon.addFriendship(-erBalanceNum("vanilla.friendship.lossFaint"));
      }
      pokemon.hideInfo();
      globalScene.playSound("se/faint");
      globalScene.tweens.add({
        targets: pokemon,
        duration: 500,
        y: pokemon.y + 150,
        ease: "Sine.easeIn",
        onComplete: () => {
          pokemon.lapseTags(BattlerTagLapseType.FAINT);

          pokemon.y -= 150;
          pokemon.doSetStatus(StatusEffect.FAINT);
          if (pokemon.isPlayer()) {
            globalScene.currentBattle.removeFaintedParticipant(pokemon as PlayerPokemon);
          } else {
            globalScene.addFaintedEnemyScore(pokemon as EnemyPokemon);
            // ER Wasteland: pull the guaranteed wild drop FIRST (while the mon's
            // items still carry its pokemonId), THEN sweep the rest to post-battle
            // loot (which nulls the pokemonId for the ability-gated steal pool).
            this.applyErWastelandWildDrop(pokemon as EnemyPokemon);
            globalScene.currentBattle.addPostBattleLoot(pokemon as EnemyPokemon);
          }
          pokemon.leaveField();
          this.end();
        },
      });
    });
  }

  private handleFinalBossFaint(): void {
    const { phaseManager, ui } = globalScene;
    const enemy = this.getPokemon();

    if (enemy.formIndex > 0) {
      // Primal Cascoon: the second-stage final boss is the Primal Cascoon.
      if (enemy.species.speciesId === SpeciesId.CASCOON) {
        globalScene.validateAchv(achvs.PRIMAL_CASCOON);
      }
      ui.showDialogue(classicFinalBossDialogue.secondStageWin, enemy.species.name, null, () => this.doFaint());
      return;
    }

    // Final boss' HP threshold has been bypassed; cancel faint and force check for 2nd phase
    enemy.hp++;
    phaseManager.unshiftNew("DamageAnimPhase", enemy.getBattlerIndex(), 0, HitResult.INDIRECT);
    this.end();
  }

  /**
   * ER Wasteland (#439 §3): scarcity has a flip side - a defeated WILD mon drops a
   * fixed number of its held items to your lead, guaranteed (not ability-gated like
   * the normal post-battle steal pool). Transfers up to `wildItemDropCount` of the
   * fainted wild mon's transferable held items onto the first living player mon, one
   * stack each, with a message. WILD battles only; gated on the biome rule so other
   * biomes are unaffected. Never throws.
   */
  private applyErWastelandWildDrop(enemy: EnemyPokemon): void {
    const dropCount = getErBiomeRule(globalScene.arena.biomeId)?.wildItemDropCount;
    if (!dropCount || globalScene.currentBattle.battleType !== BattleType.WILD) {
      return;
    }
    const recipient = globalScene.getPlayerField().find(p => p?.isActive(true)) ?? globalScene.getPlayerPokemon();
    if (!recipient) {
      return;
    }
    const drops = globalScene
      .findModifiers(m => m.is("PokemonHeldItemModifier") && m.pokemonId === enemy.id && m.isTransferable, false)
      .slice(0, dropCount) as PokemonHeldItemModifier[];
    for (const item of drops) {
      if (!globalScene.canTransferHeldItemModifier(item, recipient, 1)) {
        continue;
      }
      if (globalScene.tryTransferHeldItemModifier(item, recipient, false, 1, true, undefined, true)) {
        globalScene.phaseManager.queueMessage(
          `${getPokemonNameWithAffix(recipient)} scavenged ${item.type.name} from the wreckage!`,
          null,
          true,
        );
      }
    }
  }
}
