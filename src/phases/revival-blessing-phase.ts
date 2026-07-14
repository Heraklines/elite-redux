import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { COOP_REVIVAL_SEQ_BASE, getCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopRevivalOperationBinding,
  captureCoopRevivalOperationBinding,
  commitRevivalAuthorityDecision,
  sendCoopRevivalPrompt,
} from "#data/elite-redux/coop/coop-revival-operation";
import { failCoopSharedSession, getCoopController, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
import { COOP_REVIVAL_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { erRecordCoopRevivePartnerMon } from "#data/elite-redux/er-social-achievement-tracker";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";
import type { PartyOption } from "#ui/party-ui-handler";
import { PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

/**
 * Sets the Party UI and handles the effect of Revival Blessing
 * when used by one of the player's Pokemon.
 */
export class RevivalBlessingPhase extends BattlePhase {
  public readonly phaseName = "RevivalBlessingPhase";
  private coopOperationBinding: CoopRevivalOperationBinding | null = null;

  constructor(protected user: PlayerPokemon) {
    super();
  }

  public override start(): void {
    const controller = getCoopController();
    if (globalScene.gameMode?.isCoop === true && controller?.role === "host") {
      try {
        this.coopOperationBinding ??= captureCoopRevivalOperationBinding("host");
      } catch {
        failCoopSharedSession("Revival Blessing lost its authoritative host runtime binding.");
        this.end();
        return;
      }
    }
    // Co-op (#809, the faint-switch owner-pick pattern): the pick belongs to the mon's
    // OWNER. On the host engine with a PARTNER-owned user, prompt the partner's client
    // and await its relayed pick instead of opening the local party screen.
    if (
      globalScene.gameMode?.isCoop === true
      && controller?.role === "host"
      && this.user.coopOwner != null
      && this.user.coopOwner !== "host"
    ) {
      this.startCoopPartnerPick();
      return;
    }
    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.REVIVAL_BLESSING,
      this.user.getFieldIndex(),
      (slotIndex: number, _option: PartyOption) => {
        if (slotIndex >= 0 && slotIndex < 6) {
          const pokemon = globalScene.getPlayerParty()[slotIndex];
          if (!pokemon || !pokemon.isFainted()) {
            return this.end();
          }
          if (controller?.role === "host") {
            const committed = commitRevivalAuthorityDecision(
              {
                payload: {
                  type: "decision",
                  fieldIndex: this.user.getFieldIndex(),
                  partySlot: slotIndex,
                  speciesId: pokemon.species?.speciesId ?? 0,
                },
                ownerRole: "host",
                localRole: "host",
                wave: globalScene.currentBattle?.waveIndex ?? 0,
                turn: globalScene.currentBattle?.turn ?? 0,
              },
              this.coopOperationBinding,
            );
            if (!committed) {
              failCoopSharedSession("Host-owned Revival Blessing decision could not enter durable authority.");
              return this.end();
            }
          }
          this.applyRevive(slotIndex, pokemon);
        }
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
      },
      PartyUiHandler.FilterFainted,
    );
  }

  /**
   * Co-op (#809): send the partner a revival prompt and await its relayed pick on
   * `COOP_REVIVAL_SEQ_BASE + fieldIndex`. Timeout / invalid -> AI fallback (the partner's
   * first fainted mon, else any fainted) so the run never stalls. The pick is resolved by
   * SPECIES identity when carried (#799) so diverged party orders cannot revive the wrong mon.
   */
  private startCoopPartnerPick(): void {
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      this.end();
      return;
    }
    const fieldIndex = this.user.getFieldIndex();
    const seq = COOP_REVIVAL_SEQ_BASE + fieldIndex;
    coopLog("replay", `revival owner-pick: awaiting partner pick seq=${seq} (user slot=${fieldIndex})`);
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = globalScene.currentBattle?.turn ?? 0;
    if (!sendCoopRevivalPrompt(relay, fieldIndex, { localRole: "host", wave, turn }, this.coopOperationBinding)) {
      failCoopSharedSession("Revival Blessing prompt could not enter durable authority.");
      this.end();
      return;
    }
    void relay.awaitInteractionChoice(seq, getCoopFaintSwitchWaitMs(), COOP_REVIVAL_CHOICE_KINDS).then(res => {
      const party = globalScene.getPlayerParty();
      let slotIndex = res?.choice ?? -1;
      const pickedSpecies = res?.data?.[1] ?? 0;
      if (pickedSpecies > 0) {
        const bySpecies = party.findIndex(p => p.isFainted() && p.species?.speciesId === pickedSpecies);
        if (bySpecies >= 0 && bySpecies !== slotIndex) {
          coopLog(
            "replay",
            `revival owner-pick: identity resolve sp=${pickedSpecies} slot ${slotIndex} -> ${bySpecies}`,
          );
          slotIndex = bySpecies;
        }
      }
      if (slotIndex < 0 || slotIndex >= 6 || !party[slotIndex]?.isFainted()) {
        // Timeout or invalid: revive the partner's first fainted mon, else any fainted.
        slotIndex = party.findIndex(p => p.isFainted() && p.coopOwner === this.user.coopOwner);
        if (slotIndex < 0) {
          slotIndex = party.findIndex(p => p.isFainted());
        }
        coopLog("replay", `revival owner-pick: fallback -> party[${slotIndex}]`);
      }
      if (slotIndex >= 0) {
        const committed = commitRevivalAuthorityDecision(
          {
            payload: {
              type: "decision",
              fieldIndex,
              partySlot: slotIndex,
              speciesId: party[slotIndex].species?.speciesId ?? 0,
            },
            ownerRole: this.user.coopOwner ?? "guest",
            localRole: "host",
            wave,
            turn,
          },
          this.coopOperationBinding,
        );
        if (!committed) {
          failCoopSharedSession("Guest-owned Revival Blessing decision could not enter durable authority.");
          this.end();
          return;
        }
        this.applyRevive(slotIndex, party[slotIndex]);
      }
      this.end();
    });
  }

  /** Apply the revive + (in doubles) the follow-up summon for `pokemon` at `slotIndex`. */
  private applyRevive(slotIndex: number, pokemon: PlayerPokemon): void {
    pokemon.resetTurnData();
    pokemon.resetStatus(true, false, false, false);
    pokemon.heal(Math.min(toDmgValue(0.5 * pokemon.getMaxHp()), pokemon.getMaxHp()));
    // catalog-v2 (#900) LIFELINE_SUBSCRIPTION: a Revival Blessing revive of a co-op PARTNER's mon
    // counts as a partner revive (the modifier revive path already reports; this path did not).
    erRecordCoopRevivePartnerMon(pokemon);
    globalScene.phaseManager.queueMessage(
      i18next.t("moveTriggers:revivalBlessing", {
        pokemonName: pokemon.name,
      }),
      0,
      true,
    );

    const allyPokemon = this.user.getAlly();
    if (globalScene.currentBattle.double && globalScene.getPlayerParty().length > 1 && allyPokemon != null) {
      if (slotIndex <= 1) {
        // Revived ally pokemon
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          SwitchType.SWITCH,
          pokemon.getFieldIndex(),
          slotIndex,
          false,
          true,
        );
        globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
      } else if (allyPokemon.isFainted()) {
        // Revived party pokemon, and ally pokemon is fainted
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          SwitchType.SWITCH,
          allyPokemon.getFieldIndex(),
          slotIndex,
          false,
          true,
        );
        globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
      }
    }
  }
}
