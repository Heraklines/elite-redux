/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  coopColosseumAwaitDecision,
  coopColosseumSendDecision,
  setCoopColosseumBoardPhaseOpener,
} from "#data/elite-redux/coop/coop-colosseum";
import {
  coopColosseumDecisionOperationId,
  isCoopColosseumAuthorityV2Active,
} from "#data/elite-redux/coop/coop-colosseum-operation";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopRuntime,
  notifyCoopV2InteractionSurfaceReady,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { UiMode } from "#enums/ui-mode";
import { COLOSSEUM_CASH_OUT, type ColosseumViewData } from "#ui/handlers/colosseum-ui-handler";

/**
 * Exact guest board lease for both owner and watcher paths. It temporarily overrides the completed battle
 * phase, exposes the real COLOSSEUM handler, and resumes that same standby generation after the decision.
 */
export class CoopGuestColosseumChoicePhase extends Phase {
  public readonly phaseName = "CoopGuestColosseumChoicePhase";
  public coopV2ControlOperationId: string | null;
  private readonly coopOwningRuntime = getCoopRuntime();
  private readonly generation = coopSessionGeneration();
  private finished = false;

  constructor(
    private readonly labels: readonly string[],
    private readonly round: number,
    private readonly owner: boolean,
    operationId: string | null,
    private readonly resolve: (choice: number) => void,
  ) {
    super();
    this.coopV2ControlOperationId = operationId;
  }

  public override start(): void {
    super.start();
    void this.open();
  }

  private live(): boolean {
    return (
      !this.finished
      && globalScene.phaseManager.getCurrentPhase() === this
      && getCoopRuntime() === this.coopOwningRuntime
      && coopSessionGeneration() === this.generation
    );
  }

  private decisionOperationId(): string | null {
    return this.coopV2ControlOperationId == null
      ? null
      : coopColosseumDecisionOperationId(this.coopV2ControlOperationId);
  }

  private settleV2Decision(): boolean {
    if (!isCoopColosseumAuthorityV2Active()) {
      return true;
    }
    const operationId = this.decisionOperationId();
    if (operationId == null || !settleCoopV2InteractionOperation(operationId, this.coopOwningRuntime)) {
      failCoopSharedSession(`Guest Colosseum round ${this.round} lost its exact V2 decision address`);
      return false;
    }
    return true;
  }

  private finish(choice: number): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    globalScene.ui.setMode(UiMode.MESSAGE).then(
      () => {
        this.end();
        this.resolve(choice);
      },
      () => {
        this.end();
        this.resolve(choice);
      },
    );
  }

  private async open(): Promise<void> {
    if (
      this.labels.length !== 2
      || this.labels.some(label => typeof label !== "string")
      || (isCoopColosseumAuthorityV2Active() && this.coopV2ControlOperationId == null)
    ) {
      failCoopSharedSession(`Guest Colosseum round ${this.round} had no complete board presentation`);
      this.finish(-1);
      return;
    }
    const data: ColosseumViewData = {
      round: this.round,
      totalRounds: Math.max(this.round + 1, 2),
      tierLabel: "?",
      nextTierLabel: "?",
      challengers: [],
      choiceLabels: [this.labels[0], this.labels[1]],
    };
    const opened = await globalScene.ui.setModeBoundedWhen(
      UiMode.COLOSSEUM,
      2_000,
      () => this.live(),
      data,
      (choice: number) => {
        if (!this.owner || !this.live()) {
          return;
        }
        const exactChoice = choice === COLOSSEUM_CASH_OUT ? COLOSSEUM_CASH_OUT : 0;
        if (this.settleV2Decision() && coopColosseumSendDecision(exactChoice, this.round)) {
          this.finish(exactChoice);
        }
      },
    );
    if (opened === "superseded" || !this.live()) {
      failCoopSharedSession(`Guest Colosseum board UI could not bind for round ${this.round}`);
      this.finish(-1);
      return;
    }
    notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
    if (this.owner) {
      return;
    }
    const decision = await coopColosseumAwaitDecision(undefined, this.round);
    if (!this.live()) {
      return;
    }
    if ((decision !== 0 && decision !== COLOSSEUM_CASH_OUT) || !this.settleV2Decision()) {
      failCoopSharedSession(`Guest Colosseum watcher round ${this.round} received no exact decision`);
      this.finish(-1);
      return;
    }
    this.finish(decision);
  }
}

setCoopColosseumBoardPhaseOpener(
  (labels: readonly string[], round: number, owner: boolean, operationId?: string): Promise<number> =>
    new Promise<number>(resolve => {
      const phase = new CoopGuestColosseumChoicePhase(labels, round, owner, operationId ?? null, resolve);
      if (!globalScene.phaseManager.overridePhase(phase)) {
        failCoopSharedSession(`Guest Colosseum round ${round} could not override its stale battle phase`);
        resolve(-1);
      }
    }),
);
