import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { COOP_REVIVAL_SEQ_BASE, getCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopRevivalOperationBinding,
  captureCoopRevivalOperationBinding,
  commitCoopRevivalPrompt,
  commitRevivalAuthorityDecision,
  coopRevivalDecisionOperationId,
  coopRevivalOperationId,
  isCoopRevivalAuthorityV2Active,
  sendCoopRevivalPromptWithOperationId,
} from "#data/elite-redux/coop/coop-revival-operation";
import {
  armCoopV2InteractionOwnerWindowAfterControlProof,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  notifyCoopV2InteractionSurfaceReady,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
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

type CoopRevivalPartnerResult = NonNullable<
  Awaited<ReturnType<NonNullable<ReturnType<typeof getCoopInteractionRelay>>["awaitInteractionChoice"]>>
>;

type CoopRevivalPartnerDecision =
  | { readonly kind: "resolved"; readonly result: CoopRevivalPartnerResult }
  | { readonly kind: "fallback" }
  | { readonly kind: "failed" };

/**
 * Sets the Party UI and handles the effect of Revival Blessing
 * when used by one of the player's Pokemon.
 */
export class RevivalBlessingPhase extends BattlePhase {
  public readonly phaseName = "RevivalBlessingPhase";
  public coopV2ControlOperationId: string | null = null;
  private coopOperationBinding: CoopRevivalOperationBinding | null = null;
  private readonly coopOwningRuntime = getCoopRuntime();

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
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = globalScene.currentBattle?.turn ?? 0;
    if (
      controller?.role === "host"
      && this.coopOperationBinding != null
      && isCoopRevivalAuthorityV2Active(this.coopOperationBinding)
    ) {
      this.coopV2ControlOperationId = commitCoopRevivalPrompt(
        {
          fieldIndex: this.user.getFieldIndex(),
          ownerRole: "host",
          localRole: "host",
          wave,
          turn,
        },
        this.coopOperationBinding,
      );
      if (this.coopV2ControlOperationId == null) {
        failCoopSharedSession("Host Revival Blessing prompt could not enter Authority V2.");
        this.end();
        return;
      }
    }
    const mode = globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.REVIVAL_BLESSING,
      this.user.getFieldIndex(),
      (slotIndex: number, _option: PartyOption) => {
        if (slotIndex >= 0 && slotIndex < 6) {
          const pokemon = globalScene.getPlayerParty()[slotIndex];
          if (!pokemon || !pokemon.isFainted()) {
            return this.end();
          }
          // The retained result must describe the mutation, not the picker intent. Apply first, then capture
          // and commit the complete post-revive image. A commit failure terminates the shared session rather
          // than letting the locally-mutated authority advance without a replayable result.
          this.applyRevive(slotIndex, pokemon);
          if (controller?.role === "host") {
            const decisionPayload = {
              type: "decision" as const,
              fieldIndex: this.user.getFieldIndex(),
              partySlot: slotIndex,
              speciesId: pokemon.species?.speciesId ?? 0,
            };
            settleCoopV2InteractionOperation(
              coopRevivalOperationId(decisionPayload, wave, turn, "host", this.coopOperationBinding),
              this.coopOwningRuntime,
            );
            const committed = commitRevivalAuthorityDecision(
              {
                payload: decisionPayload,
                ownerRole: "host",
                localRole: "host",
                wave,
                turn,
              },
              this.coopOperationBinding,
            );
            if (!committed) {
              failCoopSharedSession("Host-owned Revival Blessing decision could not enter durable authority.");
              return this.end();
            }
          }
        }
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
      },
      PartyUiHandler.FilterFainted,
    );
    Promise.resolve(mode).then(() => notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime));
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
    const presentationOperationId = sendCoopRevivalPromptWithOperationId(
      relay,
      fieldIndex,
      { localRole: "host", wave, turn },
      this.coopOperationBinding,
    );
    if (presentationOperationId == null) {
      failCoopSharedSession("Revival Blessing prompt could not enter durable authority.");
      this.end();
      return;
    }
    this.coopV2ControlOperationId = presentationOperationId === "legacy" ? null : presentationOperationId;
    const watcherMode = globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.REVIVAL_BLESSING,
      fieldIndex,
      () => {},
      PartyUiHandler.FilterFainted,
    );
    Promise.resolve(watcherMode).then(() => notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime));
    this.finishCoopPartnerPick(relay, seq, presentationOperationId, fieldIndex, wave, turn).catch(error => {
      coopLog("replay", `revival owner-pick lease failed (${String(error)})`);
      failCoopSharedSession("Revival Blessing owner window failed before its exact decision committed.");
      this.end();
    });
  }

  private async awaitCoopPartnerDecision(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    seq: number,
    presentationOperationId: string,
  ): Promise<CoopRevivalPartnerDecision> {
    if (!isCoopRevivalAuthorityV2Active(this.coopOperationBinding)) {
      const result = await relay.awaitInteractionChoice(seq, getCoopFaintSwitchWaitMs(), COOP_REVIVAL_CHOICE_KINDS);
      return result == null ? { kind: "fallback" } : { kind: "resolved", result };
    }
    if (presentationOperationId === "legacy") {
      return { kind: "failed" };
    }
    const lease = await armCoopV2InteractionOwnerWindowAfterControlProof(
      presentationOperationId,
      getCoopFaintSwitchWaitMs(),
      this.coopOwningRuntime,
    );
    if (lease == null) {
      return { kind: "failed" };
    }
    try {
      const result = await relay.awaitInteractionChoice(
        seq,
        null,
        COOP_REVIVAL_CHOICE_KINDS,
        undefined,
        presentationOperationId,
        lease.signal,
      );
      if (result != null) {
        return { kind: "resolved", result };
      }
      // Only this exact post-proof humanInput expiry authorizes the deterministic revive fallback.
      return lease.expired() ? { kind: "fallback" } : { kind: "failed" };
    } finally {
      lease.cancel();
    }
  }

  private resolveCoopPartnerSlot(
    outcome: Exclude<CoopRevivalPartnerDecision, { readonly kind: "failed" }>,
    v2: boolean,
  ): number {
    const party = globalScene.getPlayerParty();
    const result = outcome.kind === "resolved" ? outcome.result : null;
    let slotIndex = result?.choice ?? -1;
    const pickedSpecies = result?.data?.[1] ?? 0;
    if (!v2 && pickedSpecies > 0) {
      const bySpecies = party.findIndex(p => p.isFainted() && p.species?.speciesId === pickedSpecies);
      if (bySpecies >= 0 && bySpecies !== slotIndex) {
        coopLog("replay", `revival owner-pick: identity resolve sp=${pickedSpecies} slot ${slotIndex} -> ${bySpecies}`);
        slotIndex = bySpecies;
      }
    }
    const invalidLegacyPick = !v2 && (slotIndex < 0 || slotIndex >= 6 || !party[slotIndex]?.isFainted());
    if (outcome.kind === "fallback" || invalidLegacyPick) {
      slotIndex = party.findIndex(p => p.isFainted() && p.coopOwner === this.user.coopOwner);
      if (slotIndex < 0) {
        slotIndex = party.findIndex(p => p.isFainted());
      }
      coopLog("replay", `revival owner-pick: fallback -> party[${slotIndex}]`);
    }
    return slotIndex;
  }

  private commitCoopPartnerRevive(slotIndex: number, fieldIndex: number, wave: number, turn: number): boolean {
    const pokemon = globalScene.getPlayerParty()[slotIndex];
    if (pokemon == null) {
      return false;
    }
    this.applyRevive(slotIndex, pokemon);
    const decisionPayload = {
      type: "decision" as const,
      fieldIndex,
      partySlot: slotIndex,
      speciesId: pokemon.species?.speciesId ?? 0,
    };
    settleCoopV2InteractionOperation(
      coopRevivalOperationId(decisionPayload, wave, turn, this.user.coopOwner ?? "guest", this.coopOperationBinding),
      this.coopOwningRuntime,
    );
    return commitRevivalAuthorityDecision(
      {
        payload: decisionPayload,
        ownerRole: this.user.coopOwner ?? "guest",
        localRole: "host",
        wave,
        turn,
      },
      this.coopOperationBinding,
    );
  }

  private async finishCoopPartnerPick(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    seq: number,
    presentationOperationId: string,
    fieldIndex: number,
    wave: number,
    turn: number,
  ): Promise<void> {
    const outcome = await this.awaitCoopPartnerDecision(relay, seq, presentationOperationId);
    if (outcome.kind === "failed") {
      failCoopSharedSession("Revival Blessing owner window lost its exact Authority V2 control.");
      this.end();
      return;
    }
    const v2 = isCoopRevivalAuthorityV2Active(this.coopOperationBinding);
    const result = outcome.kind === "resolved" ? outcome.result : null;
    const expectedDecisionOperationId =
      result == null || presentationOperationId === "legacy"
        ? null
        : coopRevivalDecisionOperationId(presentationOperationId, result.choice);
    if (
      v2
      && outcome.kind === "resolved"
      && (expectedDecisionOperationId == null || outcome.result.operationId !== expectedDecisionOperationId)
    ) {
      failCoopSharedSession("Revival Blessing decision did not match its exact V2 presentation.");
      this.end();
      return;
    }
    const slotIndex = this.resolveCoopPartnerSlot(outcome, v2);
    const pokemon = globalScene.getPlayerParty()[slotIndex];
    if (v2 && (slotIndex < 0 || slotIndex >= 6 || !pokemon?.isFainted())) {
      failCoopSharedSession("Revival Blessing V2 decision addressed an invalid target.");
      this.end();
      return;
    }
    if (slotIndex >= 0 && !this.commitCoopPartnerRevive(slotIndex, fieldIndex, wave, turn)) {
      failCoopSharedSession("Guest-owned Revival Blessing decision could not enter durable authority.");
      this.end();
      return;
    }
    await Promise.resolve(globalScene.ui.setMode(UiMode.MESSAGE));
    this.end();
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
