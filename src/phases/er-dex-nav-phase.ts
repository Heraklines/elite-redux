/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  adoptAbilityWatcherOutcome,
  type CoopAbilityOperationBinding,
  captureCoopAbilityOperationBinding,
  commitAbilityWatcherOutcome,
  commitCoopAbilityPresentation,
  isCoopAbilityPresentationAuthorityActive,
  settleCoopAbilityAuthorityResult,
  settleCoopAbilityOperation,
  settleCoopAbilityOwnerProposal,
} from "#data/elite-redux/coop/coop-ability-operation";
import {
  COOP_ABILITY_OP,
  COOP_ABILITY_WAIT_MS,
  coopAbilityOpName,
  coopAbilityPickerSeq,
  sendCoopAbilityPickerOutcome,
} from "#data/elite-redux/coop/coop-ability-picker-relay";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { captureCoopNestedInteractionReturnPlan } from "#data/elite-redux/coop/coop-nested-interaction";
import type { CoopAbilityPresentationPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  advanceCoopInteractionForContinuation,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  isCoopV2InteractionHumanInputFrozen,
  notifyCoopV2InteractionSurfaceReady,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_ABILITY_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { UiMode } from "#enums/ui-mode";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * ER Dex Nav (#392): register two current-biome species in the item user's account dex.
 *
 * In co-op this is a fully ordered nested interaction. The authority freezes the candidate species,
 * the alternating owner alone drives the picker and performs the per-account writes, and the watcher
 * consumes the exact result before either reward continuation may advance. The account dex itself is
 * intentionally not mirrored to the other player or included in the shared run checksum.
 */
export class ErDexNavPhase extends Phase {
  public readonly phaseName = "ErDexNavPhase";
  public static readonly PICK_COUNT = 2;

  /** Constructor parity with the other nested picker projections; Dex Nav has no party target. */
  public readonly partyIndex: number;
  /** The reward interaction generation this picker belongs to (-1 outside co-op). */
  public readonly coopSeq: number;
  /** Exact V2 presentation address owned by this phase generation. */
  public coopV2ControlOperationId: string | null = null;

  private picksLeft = ErDexNavPhase.PICK_COUNT;
  private readonly coopIsWatcher: boolean;
  private readonly coopOperationBinding: CoopAbilityOperationBinding | null;
  private readonly coopOwningRuntime = getCoopRuntime();
  private candidateSpeciesIds: number[] | null = null;
  private readonly pickedSpeciesIds: number[] = [];
  private coopOutcome: number[] = [COOP_ABILITY_OP.CANCEL];
  private started = false;
  private surfaceOpened = false;

  constructor(partyIndex = 0, coopSeq = -1, coopIsWatcher = false) {
    super();
    this.partyIndex = partyIndex;
    this.coopSeq = coopSeq;
    this.coopIsWatcher = coopIsWatcher;
    this.coopOperationBinding = coopSeq >= 0 ? captureCoopAbilityOperationBinding() : null;
  }

  /**
   * Read-only ordered UI generation for the public two-browser oracle. Dex Nav intentionally reuses
   * one phase object for two distinct species picks; without this counter the second real picker is
   * byte-similar enough to be mistaken for the already-consumed first appearance.
   */
  public coopV2SurfaceGeneration(): number {
    return ErDexNavPhase.PICK_COUNT - this.picksLeft + 1;
  }

  start(): void {
    super.start();
    this.started = true;
    const controller = this.coopSeq >= 0 ? getCoopController() : null;
    if (controller?.role === "host" && isCoopAbilityPresentationAuthorityActive(this.coopOperationBinding)) {
      const candidates = this.localCandidateSpeciesIds();
      const operationId = commitCoopAbilityPresentation(
        {
          pinned: this.coopSeq,
          partyIndex: this.partyIndex,
          workflow: "dex-nav",
          candidateSpeciesIds: candidates,
          returnPlan: captureCoopNestedInteractionReturnPlan(this.coopSeq),
          localRole: "host",
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopOperationBinding,
      );
      if (candidates.length < ErDexNavPhase.PICK_COUNT || operationId == null) {
        failCoopSharedSession(`Dex Nav presentation ${this.coopSeq} could not enter durable authority`);
        return;
      }
      this.candidateSpeciesIds = candidates;
      this.coopV2ControlOperationId = operationId;
    }

    if (this.coopIsWatcher) {
      this.openWatcherSurface();
      void this.coopApplyRelayedOutcome();
      return;
    }

    if (
      this.coopSeq >= 0
      && isCoopAbilityPresentationAuthorityActive(this.coopOperationBinding)
      && this.candidateSpeciesIds == null
    ) {
      // A guest-owned picker must not derive candidates or open input before the authority presentation
      // arrives. The projector calls installCoopV2AbilityPresentation on this exact phase generation.
      return;
    }
    this.promptPick();
  }

  /** Adopt the authority's literal biome pool without consulting replica arena/RNG state. */
  public installCoopV2AbilityPresentation(operationId: string, presentation: CoopAbilityPresentationPayload): boolean {
    const candidates = presentation.candidateSpeciesIds;
    if (
      operationId.length === 0
      || presentation.workflow !== "dex-nav"
      || presentation.pinned !== this.coopSeq
      || presentation.partyIndex !== this.partyIndex
      || presentation.rolledAbilityIds !== undefined
      || !Array.isArray(candidates)
      || candidates.length < ErDexNavPhase.PICK_COUNT
      || !candidates.every(id => Number.isSafeInteger(id) && id > 0)
      || new Set(candidates).size !== candidates.length
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.candidateSpeciesIds = [...candidates];
    this.coopV2ControlOperationId = operationId;
    if (this.started) {
      if (this.coopIsWatcher) {
        this.openWatcherSurface();
      } else {
        this.promptPick();
      }
    }
    return true;
  }

  private localCandidateSpeciesIds(): number[] {
    return [...new Set(globalScene.arena.getErDexNavSpeciesPool())].filter(id => Number.isSafeInteger(id) && id > 0);
  }

  private openWatcherSurface(): void {
    if (this.surfaceOpened) {
      notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
      return;
    }
    this.surfaceOpened = true;
    Promise.resolve(globalScene.ui.setMode(UiMode.MESSAGE)).then(() =>
      notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime),
    );
  }

  private promptPick(): void {
    if (this.surfaceOpened || this.coopIsWatcher) {
      return;
    }
    const pool = (this.candidateSpeciesIds ?? this.localCandidateSpeciesIds()).filter(
      id => !this.pickedSpeciesIds.includes(id),
    );
    if (this.picksLeft <= 0) {
      this.commitAndEnd();
      return;
    }
    if (pool.length < this.picksLeft) {
      if (this.coopSeq >= 0) {
        failCoopSharedSession(`Dex Nav ${this.coopSeq} has no complete authority-owned candidate set`);
      } else {
        this.cancelAndEnd();
      }
      return;
    }
    const options: OptionSelectItem[] = pool
      .map(id => getPokemonSpecies(id))
      .sort((a, b) => a.getName().localeCompare(b.getName()))
      .map(species => ({
        label: species.getName(),
        handler: () => {
          this.surfaceOpened = false;
          void globalScene.ui.setMode(UiMode.MESSAGE);
          void this.registerCatch(species.speciesId);
          return true;
        },
      }));
    globalScene.ui.showText(
      `The Dex Nav scanned the area! Choose a Pokemon to register (${this.picksLeft} left).`,
      null,
      () => {
        Promise.resolve(
          globalScene.ui.setMode(UiMode.OPTION_SELECT, {
            options,
            maxOptions: 8,
            delay: 500,
          }),
        ).then(() => notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime));
        this.surfaceOpened = true;
      },
    );
  }

  private async registerCatch(speciesId: number): Promise<void> {
    if (
      this.candidateSpeciesIds != null
      && (!this.candidateSpeciesIds.includes(speciesId) || this.pickedSpeciesIds.includes(speciesId))
    ) {
      failCoopSharedSession(`Dex Nav ${this.coopSeq} selected species outside its authority presentation`);
      return;
    }
    const species = getPokemonSpecies(speciesId);
    const level = globalScene.currentBattle?.enemyLevels?.[0] ?? Math.max(globalScene.currentBattle?.waveIndex ?? 5, 5);
    const tempPokemon = globalScene.addPlayerPokemon(species, level, undefined, undefined, undefined, false);
    try {
      await globalScene.gameData.setPokemonCaught(tempPokemon, true, false, true);
      this.pickedSpeciesIds.push(speciesId);
      this.picksLeft--;
    } catch (error) {
      console.error("[ER] Dex Nav registration failed:", error);
    } finally {
      tempPokemon.destroy();
    }
    this.promptPick();
  }

  private commitAndEnd(): void {
    this.coopOutcome = [COOP_ABILITY_OP.DEX_NAV, ...this.pickedSpeciesIds];
    const relayOutcome = !this.coopIsWatcher;
    globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    advanceCoopInteractionForContinuation(this.coopSeq);
    this.end();
    if (relayOutcome) {
      this.relayEnd();
    }
  }

  private cancelAndEnd(): void {
    this.coopOutcome = [COOP_ABILITY_OP.CANCEL];
    const relayOutcome = !this.coopIsWatcher;
    this.end();
    if (relayOutcome) {
      this.relayEnd();
    }
  }

  private relayEnd(): void {
    if (this.coopSeq < 0) {
      return;
    }
    coopLog(
      "ability",
      `dexNav OWNER relay OUTCOME seq=${this.coopSeq} op=${coopAbilityOpName(this.coopOutcome[0])}`
        + ` data=[${this.coopOutcome.join(",")}]`,
    );
    const controller = getCoopController();
    const operationId =
      controller?.role === "host"
        ? settleCoopAbilityAuthorityResult(this.coopSeq, this.coopOperationBinding)
        : controller?.role === "guest"
          ? settleCoopAbilityOwnerProposal(this.coopSeq, this.coopOperationBinding)
          : null;
    if (operationId != null) {
      settleCoopV2InteractionOperation(operationId, this.coopOwningRuntime);
    }
    if (
      !sendCoopAbilityPickerOutcome(
        getCoopInteractionRelay(),
        this.coopSeq,
        this.coopOutcome,
        controller == null
          ? undefined
          : {
              localRole: controller.role,
              wave: globalScene.currentBattle?.waveIndex ?? 0,
              turn: globalScene.currentBattle?.turn ?? 0,
            },
        this.coopOperationBinding,
        operationId ?? undefined,
      )
    ) {
      failCoopSharedSession(`Dex Nav result ${this.coopSeq} could not enter durable authority`);
    }
  }

  private async coopApplyRelayedOutcome(): Promise<void> {
    isCoopV2InteractionHumanInputFrozen();
    const relay = getCoopInteractionRelay();
    if (this.coopSeq < 0 || relay == null) {
      this.end();
      return;
    }
    const action = await relay.awaitInteractionChoice(
      coopAbilityPickerSeq(this.coopSeq),
      COOP_ABILITY_WAIT_MS,
      COOP_ABILITY_CHOICE_KINDS,
    );
    const controller = getCoopController();
    const relayedData = action?.data ?? null;
    const adoption =
      controller == null
        ? null
        : adoptAbilityWatcherOutcome(
            {
              pinned: this.coopSeq,
              data: relayedData,
              committed: relayedData?.[0] === COOP_ABILITY_OP.DEX_NAV,
              localRole: controller.role,
              wave: globalScene.currentBattle?.waveIndex ?? 0,
              turn: globalScene.currentBattle?.turn ?? 0,
            },
            this.coopOperationBinding,
          );
    if (
      isCoopAbilityPresentationAuthorityActive(this.coopOperationBinding)
      && (adoption?.accepted !== true || action?.operationId !== adoption.operationId)
    ) {
      failCoopSharedSession(`Dex Nav result ${this.coopSeq} did not match its exact V2 presentation`);
      return;
    }
    const data = adoption?.accepted === true && relayedData != null ? relayedData : [COOP_ABILITY_OP.CANCEL];
    const committed =
      data[0] === COOP_ABILITY_OP.DEX_NAV
      && data.length === ErDexNavPhase.PICK_COUNT + 1
      && data.slice(1).every(id => Number.isSafeInteger(id) && this.candidateSpeciesIds?.includes(id) === true)
      && new Set(data.slice(1)).size === ErDexNavPhase.PICK_COUNT;
    coopLog(
      "ability",
      `dexNav WATCHER apply OUTCOME seq=${this.coopSeq} op=${coopAbilityOpName(data[0])}`
        + ` data=[${data.join(",")}] timedOut=${action == null}`,
    );
    if (data[0] !== COOP_ABILITY_OP.CANCEL && !committed) {
      failCoopSharedSession(`Dex Nav result ${this.coopSeq} is outside its immutable candidate set`);
      return;
    }
    if (committed) {
      // Per-account dex writes belong only to the item owner. The watcher closes the shared continuation.
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
      advanceCoopInteractionForContinuation(this.coopSeq);
    }
    this.end();
    if (adoption?.accepted === true) {
      settleCoopAbilityOperation(adoption.operationId, this.coopOperationBinding);
      settleCoopV2InteractionOperation(adoption.operationId, this.coopOwningRuntime);
    }
    if (
      adoption?.accepted === true
      && adoption.requiresAuthorityCommit
      && !commitAbilityWatcherOutcome(
        adoption.operationId,
        {
          pinned: this.coopSeq,
          data,
          committed,
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopOperationBinding,
      )
    ) {
      failCoopSharedSession(`Dex Nav result ${adoption.operationId} could not retain complete authority state`);
    }
  }

  end(): void {
    this.surfaceOpened = false;
    void globalScene.ui.setMode(UiMode.MESSAGE);
    super.end();
  }
}
