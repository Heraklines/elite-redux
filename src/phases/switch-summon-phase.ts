import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { SubstituteTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { markChivalryRedirect, pokemonCarriesChivalry } from "#data/elite-redux/abilities/chivalry";
import {
  applyGraveMarkerOnEntry,
  applyPendingSkyhookEntryBoost,
  markGenuineVoluntaryEntry,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { getSaltCircleEscapeSource } from "#data/elite-redux/ability-upgrades/requested-field-effects";
import type { ReplacementSummonBinding } from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import { getActiveCoopV2ReplacementCutover } from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import { failCoopSharedSession } from "#data/elite-redux/coop/coop-runtime";
import { isCoopRecording, recordCoopEvent } from "#data/elite-redux/coop/coop-turn-recorder";
import { erRecordAchievementSwitchIn } from "#data/elite-redux/er-achievement-tracker";
import { completeErEndlessSwitch, prepareErEndlessSwitch } from "#data/elite-redux/er-endless-rift-runtime";
import { type ErBondedCharmSnapshot, erBondedCharmApply, erBondedCharmSnapshot } from "#data/elite-redux/er-relics";
import { notifyMoodyFormationSwitch } from "#data/elite-redux/moody/moody-formation-game-adapter";
import { notifyMoodyRuntimeEntry } from "#data/elite-redux/moody/moody-runtime-field-engine";
import { notifyMoodyCoordinatorDirectPairSwitch } from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { SpeciesFormChangeActiveTrigger } from "#data/form-change-triggers";
import { getPokeballTintColor } from "#data/pokeball";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SwitchType } from "#enums/switch-type";
import type { Pokemon } from "#field/pokemon";
import { SwitchEffectTransferModifier } from "#modifiers/modifier";
import { enemyTrainerSlotForSwitch } from "#phases/battle-phase";
import { SummonPhase } from "#phases/summon-phase";
import { inSpeedOrder } from "#utils/speed-order-generator";
import i18next from "i18next";

/**
 * Revalidate a player replacement when its queued summon finally executes.
 * Two simultaneous faint pickers can briefly save the same bench index; after
 * the first party swap, that index contains the first fainted lead. Never seat
 * that stale entry (or an already-fielded mon); fall through to a legal reserve.
 */
export function resolvePlayerSwitchSlot(
  party: readonly Pokemon[],
  requestedSlot: number,
  battlerCount: number,
): number {
  const requested = party[requestedSlot];
  if (requestedSlot >= battlerCount && requested?.isAllowedInBattle() === true && !requested.isOnField()) {
    return requestedSlot;
  }
  return party.findIndex(
    (pokemon, index) => index >= battlerCount && pokemon.isAllowedInBattle() && !pokemon.isOnField(),
  );
}

export class SwitchSummonPhase extends SummonPhase {
  public readonly phaseName: "SwitchSummonPhase" | "ReturnPhase" = "SwitchSummonPhase";
  private readonly switchType: SwitchType;
  private readonly slotIndex: number;
  private readonly doReturn: boolean;
  private readonly coopReplacementBinding: ReplacementSummonBinding | null;
  private coopReplacementMaterialized = false;

  private lastPokemon: Pokemon;

  /**
   * Constructor for creating a new SwitchSummonPhase
   * @param switchType - The type of switch behavior
   * @param fieldIndex - Position on the battle field
   * @param slotIndex - The index of pokemon (in party of 6) to switch into
   * @param doReturn - Whether to render "comeback" dialogue
   * @param player - Whether the switch came from the player or enemy; default `true`
   * @param coopReplacementBinding - Exact Authority V2 replacement this player summon materializes
   */
  constructor(
    switchType: SwitchType,
    fieldIndex: number,
    slotIndex: number,
    doReturn: boolean,
    player = true,
    coopReplacementBinding: ReplacementSummonBinding | null = null,
  ) {
    super(fieldIndex, player);

    this.switchType = switchType;
    this.slotIndex = slotIndex;
    this.doReturn = doReturn;
    this.coopReplacementBinding = coopReplacementBinding;
  }

  start(): void {
    super.start();
  }

  preSummon(): void {
    if (!this.player) {
      // Partner attribution only applies in a partnered DOUBLE: in a TRIPLE vs one
      // trainer, `fieldIndex ? PARTNER : TRAINER` mislabeled slots 1-2 as the partner's
      // (wrong summon pool arg + wrong trainer sprite/name shown). getNextSummonIndex
      // also normalizes slot to NONE outside partnered doubles, so this keeps the two
      // in agreement.
      const trainerSlot = enemyTrainerSlotForSwitch(
        this.fieldIndex,
        globalScene.currentBattle.double && !!globalScene.currentBattle.trainer?.isDouble(),
      );
      if (this.slotIndex === -1) {
        //@ts-expect-error
        this.slotIndex = globalScene.currentBattle.trainer?.getNextSummonIndex(trainerSlot); // TODO: what would be the default trainer-slot fallback?
      }
      if (this.slotIndex > -1) {
        this.showEnemyTrainer(trainerSlot);
        globalScene.pbTrayEnemy.showPbTray(globalScene.getEnemyParty());
      }
    }

    const incoming = (this.player ? this.getParty() : globalScene.getEnemyParty())[this.slotIndex];
    const outgoing = this.getPokemon();
    // Host-authored switch presentation belongs to the same ordered turn stream as the effects around it.
    // A staged post-faint V2 replacement carries its summon in REPLACEMENT_COMMIT instead, so it cannot be
    // rendered twice when that out-of-band entry races the eventual turn batch.
    const replacementOwnsPresentation =
      this.player
      && this.coopReplacementBinding != null
      && outgoing?.isFainted() === true
      && (getActiveCoopV2ReplacementCutover()?.pendingCount ?? 0) > 0;
    const incomingSpeciesId = incoming?.species?.speciesId;
    if (
      incoming != null
      && outgoing != null
      && Number.isSafeInteger(incoming.id)
      && incoming.id > 0
      && Number.isSafeInteger(incomingSpeciesId)
      && (incomingSpeciesId as number) > 0
      && !replacementOwnsPresentation
    ) {
      const bi = this.player
        ? this.fieldIndex
        : (globalScene.currentBattle.arrangement?.enemyOffset ?? 2) + this.fieldIndex;
      recordCoopEvent({
        k: "switch",
        bi,
        partySlot: this.slotIndex,
        pokemonId: incoming.id,
        actor: { side: this.player ? "player" : "enemy", pokemonId: incoming.id },
        speciesId: incomingSpeciesId as number,
        switchType: this.switchType,
        doReturn: this.doReturn,
      });
    }

    if (
      !this.doReturn
      || (this.slotIndex !== -1
        && !(this.player ? globalScene.getPlayerParty() : globalScene.getEnemyParty())[this.slotIndex])
    ) {
      if (this.player) {
        this.switchAndSummon();
        return;
      }
      globalScene.time.delayedCall(750, () => this.switchAndSummon());
      return;
    }

    const pokemon = this.getPokemon();
    for (const enemyPokemon of inSpeedOrder(this.player ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER)) {
      enemyPokemon.removeTagsBySourceId(pokemon.id);
    }

    if (this.switchType === SwitchType.SWITCH || this.switchType === SwitchType.INITIAL_SWITCH) {
      const substitute = pokemon.getTag(SubstituteTag);
      if (substitute) {
        globalScene.tweens.add({
          targets: substitute.sprite,
          duration: 250,
          scale: substitute.sprite.scale * 0.5,
          ease: "Sine.easeIn",
          onComplete: () => substitute.sprite.destroy(),
        });
      }
    }

    globalScene.ui.showText(
      this.player
        ? i18next.t("battle:playerComeBack", {
            pokemonName: getPokemonNameWithAffix(pokemon),
          })
        : i18next.t("battle:trainerComeBack", {
            trainerName: globalScene.currentBattle.trainer?.getName(
              enemyTrainerSlotForSwitch(
                this.fieldIndex,
                globalScene.currentBattle.double && !!globalScene.currentBattle.trainer?.isDouble(),
              ),
            ),
            pokemonName: pokemon.getNameToRender(),
          }),
    );
    globalScene.playSound("se/pb_rel");
    pokemon.hideInfo();
    pokemon.tint(getPokeballTintColor(pokemon.getPokeball(true)), 1, 250, "Sine.easeIn");
    globalScene.tweens.add({
      targets: pokemon,
      duration: 250,
      ease: "Sine.easeIn",
      scale: 0.5,
      onComplete: () => {
        globalScene.time.delayedCall(750, () => this.switchAndSummon());
        pokemon.leaveField(this.switchType === SwitchType.SWITCH, false);
      },
    });
  }

  switchAndSummon() {
    const party = this.player ? this.getParty() : globalScene.getEnemyParty();
    const resolvedSlotIndex = this.player
      ? resolvePlayerSwitchSlot(party, this.slotIndex, globalScene.currentBattle.getBattlerCount())
      : this.slotIndex;
    const switchedInPokemon: Pokemon | undefined = party[resolvedSlotIndex];
    this.lastPokemon = this.getPokemon();

    if (
      this.coopReplacementBinding != null
      && (!this.player
        || this.fieldIndex !== this.coopReplacementBinding.fieldIndex
        || this.slotIndex !== this.coopReplacementBinding.partySlot
        || switchedInPokemon?.id !== this.coopReplacementBinding.pokemonId
        || switchedInPokemon?.species?.speciesId !== this.coopReplacementBinding.speciesId)
    ) {
      failCoopSharedSession(
        `Authority V2 replacement ${this.coopReplacementBinding.operationId} reached the wrong summon `
          + `(player=${String(this.player)} field=${this.fieldIndex} partySlot=${this.slotIndex} `
          + `pokemon=${switchedInPokemon?.id ?? 0} species=${switchedInPokemon?.species?.speciesId ?? 0}).`,
      );
      return;
    }

    // ER (#400): this guard used to sit AFTER the resetSummonData call below,
    // so an unresolvable slot (slotIndex -1: the second replacement of a
    // double KO with only one reserve, common under Doubles Only) dereferenced
    // `undefined` inside a delayed call - the phase never ended and the battle
    // hard-froze. Bail out cleanly before touching the missing Pokemon.
    if (!switchedInPokemon) {
      this.end();
      return;
    }

    // Defensive programming: Overcome the bug where the summon data has somehow not been reset
    // prior to switching in a new Pokemon.
    // Force the switch to occur and load the assets for the new pokemon, ignoring override.
    switchedInPokemon.resetSummonData();
    erRecordAchievementSwitchIn(switchedInPokemon);
    switchedInPokemon.loadAssets(true);

    // Even more defensive programming: Some callers will or will not make their users leave the field
    // before this phase starts.
    // To account for this (and avoid crashes by leaving the field during move processing),
    // forcibly ensure the the victim is off of the field if they have not already done so.
    // TODO: This means the switch out will occur immediately from U-turn's effect if the U-Turn user faints
    // (instead of happening at end of turn from an empty slot).
    // That being said, this blemish becomes completely irrelevant
    // once #6611 burns the entire system to the ground.
    // ER relic (#439): Bonded Charm - "soft baton pass". Snapshot the outgoing
    // lead's POSITIVE stat stages NOW, BEFORE leaveField() below runs
    // resetSummonData() and zeroes them (reading them after that point - as the
    // first version of this hook did - always returned 0, so nothing carried).
    // Gated to a player VOLUNTARY switch (the menu "Switch" command) so faint
    // replacements, U-turn/forced switches, baton pass, and the opening lead are
    // all excluded. Applied to the incoming mon after its fieldSetup(true) below.
    const bondedCharmStages: ErBondedCharmSnapshot =
      this.switchType === SwitchType.SWITCH
      && (!this.player || globalScene.currentBattle.turnCommands[this.fieldIndex]?.command === Command.POKEMON)
        ? erBondedCharmSnapshot(this.lastPokemon)
        : [];
    const saltCircleSource =
      this.switchType === SwitchType.INITIAL_SWITCH ? undefined : getSaltCircleEscapeSource(this.lastPokemon);

    // ER Chivalry (5909): a VOLUNTARY switch-out (menu "Switch" command) of a
    // Chivalry holder marks the incoming mon to redirect 25% of its direct
    // damage to the now-off-field holder. Detected BEFORE leaveField() while the
    // holder is still on the field (its active ability attrs are readable).
    if (
      this.switchType === SwitchType.SWITCH
      && globalScene.currentBattle.turnCommands[this.fieldIndex]?.command === Command.POKEMON
      && pokemonCarriesChivalry(this.lastPokemon)
    ) {
      markChivalryRedirect(switchedInPokemon, this.lastPokemon);
    }

    const voluntaryMoodySwitch =
      this.switchType === SwitchType.SWITCH
      && globalScene.currentBattle.turnCommands[this.fieldIndex]?.command === Command.POKEMON;
    const endlessTransfer = prepareErEndlessSwitch(this.lastPokemon, voluntaryMoodySwitch);
    notifyMoodyFormationSwitch(this.lastPokemon, switchedInPokemon, voluntaryMoodySwitch);
    notifyMoodyCoordinatorDirectPairSwitch(this.lastPokemon, switchedInPokemon, voluntaryMoodySwitch);

    if (this.lastPokemon.isOnField()) {
      this.lastPokemon.leaveField(this.switchType === SwitchType.SWITCH);
    }

    applyAbAttrs("PreSummonAbAttr", { pokemon: switchedInPokemon });
    applyAbAttrs("PreSwitchOutAbAttr", { pokemon: this.lastPokemon });
    // ER: fire any "on-opponent-switch-out" handlers (Tag — 656) on each
    // pokemon on the OPPOSITE side. We use a direct constructor.name scan
    // rather than going through pokerogue's centralised applyAbAttrs map
    // because that requires registering the AbAttr class in the global
    // AbilityAttrs object (touching a 6000-line file). The ER hook is
    // small enough to do inline.
    const opposingField = this.lastPokemon.isPlayer() ? globalScene.getEnemyField() : globalScene.getPlayerField();
    for (const observer of opposingField) {
      if (!observer || observer.isFainted()) {
        continue;
      }
      for (const attr of observer.getAllActiveAbilityAttrs()) {
        if (attr && attr.constructor.name === "OnOpponentSwitchOutAbAttr") {
          (
            attr as unknown as {
              fire: (holder: Pokemon, leavingOpponent: Pokemon) => void;
            }
          ).fire(observer, this.lastPokemon);
        }
      }
    }
    if (this.switchType === SwitchType.BATON_PASS) {
      // If switching via baton pass, update opposing tags coming from the prior pokemon
      (this.player ? globalScene.getEnemyField() : globalScene.getPlayerField()).forEach((enemyPokemon: Pokemon) =>
        enemyPokemon.transferTagsBySourceId(this.lastPokemon.id, switchedInPokemon.id),
      );

      // If the recipient pokemon lacks a baton, give our baton to it during the swap
      if (
        !globalScene.findModifier(
          m =>
            m instanceof SwitchEffectTransferModifier
            && (m as SwitchEffectTransferModifier).pokemonId === switchedInPokemon.id,
        )
      ) {
        const batonPassModifier = globalScene.findModifier(
          m =>
            m instanceof SwitchEffectTransferModifier
            && (m as SwitchEffectTransferModifier).pokemonId === this.lastPokemon.id,
        ) as SwitchEffectTransferModifier;

        if (batonPassModifier) {
          globalScene.tryTransferHeldItemModifier(
            batonPassModifier,
            switchedInPokemon,
            false,
            undefined,
            undefined,
            undefined,
            false,
          );
        }
      }
    }

    party[resolvedSlotIndex] = this.lastPokemon;
    party[this.fieldIndex] = switchedInPokemon;
    this.coopReplacementMaterialized = this.coopReplacementBinding != null;
    const showTextAndSummon = () => {
      globalScene.ui.showText(this.getSendOutText(switchedInPokemon));
      /**
       * If this switch is passing a Substitute, make the switched Pokemon matches the returned Pokemon's state as it left.
       * Otherwise, clear any persisting tags on the returned Pokemon.
       */
      if (this.switchType === SwitchType.BATON_PASS || this.switchType === SwitchType.SHED_TAIL) {
        const substitute = this.lastPokemon.getTag(SubstituteTag);
        if (substitute) {
          switchedInPokemon.x += this.lastPokemon.getSubstituteOffset()[0];
          switchedInPokemon.y += this.lastPokemon.getSubstituteOffset()[1];
          switchedInPokemon.setAlpha(0.5);
        }
      } else {
        switchedInPokemon.fieldSetup(true);
      }
      if (saltCircleSource !== undefined) {
        switchedInPokemon.addTag(BattlerTagType.SALT_CURED, 1, MoveId.SALT_CURE, saltCircleSource.id);
      }
      // ER relic (#439): Bonded Charm - apply the snapshot captured above, before
      // the outgoing mon's leaveField() zeroed its stages. Runs AFTER
      // fieldSetup(true) (which re-runs resetSummonData) so the carried stages
      // survive. No-op for an empty snapshot (relic absent / not a voluntary
      // player switch).
      erBondedCharmApply(switchedInPokemon, bondedCharmStages);
      completeErEndlessSwitch(this.lastPokemon, switchedInPokemon, endlessTransfer);
      notifyMoodyRuntimeEntry(switchedInPokemon, this.switchType !== SwitchType.INITIAL_SWITCH);
      this.summon();
    };

    if (this.player) {
      showTextAndSummon();
    } else {
      globalScene.time.delayedCall(1500, () => {
        this.hideEnemyTrainer();
        globalScene.pbTrayEnemy.hide();
        showTextAndSummon();
      });
    }
  }

  onEnd(): void {
    super.onEnd();

    const pokemon = this.getPokemon();

    const moveId = globalScene.currentBattle.lastMove;
    const lastUsedMove = moveId ? allMoves[moveId] : undefined;

    const currentCommand = globalScene.currentBattle.turnCommands[this.fieldIndex]?.command;
    const lastPokemonIsForceSwitchedAndNotFainted =
      lastUsedMove?.hasAttr("ForceSwitchOutAttr") && !this.lastPokemon.isFainted();
    const lastPokemonHasForceSwitchAbAttr =
      this.lastPokemon.hasAbilityWithAttr("PostDamageForceSwitchAbAttr") && !this.lastPokemon.isFainted();

    // Compensate for turn spent summoning/forced switch if switched out pokemon is not fainted.
    // Needed as we increment turn counters in `TurnEndPhase`.
    if (
      currentCommand === Command.POKEMON
      || lastPokemonIsForceSwitchedAndNotFainted
      || lastPokemonHasForceSwitchAbAttr
    ) {
      pokemon.tempSummonData.turnCount--;
      pokemon.tempSummonData.waveTurnCount--;
    }

    if (this.switchType === SwitchType.BATON_PASS && pokemon) {
      pokemon.transferSummon(this.lastPokemon);
    } else if (this.switchType === SwitchType.SHED_TAIL && pokemon) {
      const subTag = this.lastPokemon.getTag(SubstituteTag);
      if (subTag) {
        pokemon.summonData.tags.push(subTag);
      }
    }

    // Reset turn data if not initial switch (since it gets initialized to an empty object on turn start)
    if (this.switchType !== SwitchType.INITIAL_SWITCH) {
      pokemon.resetTurnData();
      pokemon.turnData.switchedInThisTurn = true;
    }

    if (
      this.switchType === SwitchType.SWITCH
      && globalScene.currentBattle.turnCommands[this.fieldIndex]?.command === Command.POKEMON
    ) {
      markGenuineVoluntaryEntry(pokemon);
    }
    applyPendingSkyhookEntryBoost(pokemon);
    applyGraveMarkerOnEntry(pokemon);

    this.lastPokemon.resetSummonData();

    // SwitchSummonPhase may be part of an already-open authoritative co-op turn. A root-delayed form
    // change can otherwise survive through the next TurnEnd and sit behind CoopTurnCommitPhase. Keep
    // this material mutation in the switch subtree; solo and Showdown/lockstep keep the legacy order.
    const coopTurnRecording = globalScene.gameMode.isCoop && isCoopRecording();
    globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeActiveTrigger, !coopTurnRecording);
    // Reverts to weather-based forms when weather suppressors (Cloud Nine/Air Lock) are switched out
    globalScene.arena.triggerWeatherBasedFormChanges(pokemon);
  }

  queuePostSummon(): void {
    globalScene.phaseManager.unshiftNew("PostSummonPhase", this.getPokemon().getBattlerIndex());
    if (this.coopReplacementBinding != null && this.coopReplacementMaterialized) {
      // The checkpoint is a child of THIS exact player summon. Enemy/trainer summons already queued at
      // the same faint boundary cannot consume it, and PostSummon's complete ability/hazard subtree drains
      // first because unshifted phases are FIFO at this level and descendants run before siblings.
      globalScene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase", false, this.coopReplacementBinding);
    }
  }

  /**
   * Get the text to be displayed when a pokemon is forced to switch and leave the field.
   * @param switchedInPokemon - The Pokemon having newly been sent in.
   * @returns The text to display.
   */
  private getSendOutText(switchedInPokemon: Pokemon): string {
    if (this.switchType === SwitchType.FORCE_SWITCH) {
      // "XYZ was dragged out!"
      return i18next.t("battle:pokemonDraggedOut", {
        pokemonName: getPokemonNameWithAffix(switchedInPokemon),
      });
    }
    if (this.player) {
      // "Go! XYZ!"
      return i18next.t("battle:playerGo", {
        pokemonName: getPokemonNameWithAffix(switchedInPokemon),
      });
    }

    // "Trainer sent out XYZ!"
    return i18next.t("battle:trainerGo", {
      trainerName: globalScene.currentBattle.trainer?.getName(
        enemyTrainerSlotForSwitch(
          this.fieldIndex,
          globalScene.currentBattle.double && !!globalScene.currentBattle.trainer?.isDouble(),
        ),
      ),
      pokemonName: this.getPokemon().getNameToRender(),
    });
  }
}
