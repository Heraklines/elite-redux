/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type CoopAutomaticVictorySealIdentity,
  sealCoopAutomaticVictoryBoundary,
} from "#data/elite-redux/coop/coop-runtime";
import { BattlePhase } from "#phases/battle-phase";

/**
 * Exact normal-victory settlement boundary. BattleEnd stages the source transaction, automatic reward
 * children drain ahead of this phase, and only then may the host retain its complete state image. The
 * renderer reaches the same phase only after its held BattleEnd admitted that image. A failed proof keeps
 * the phase closed while the shared terminal supervisor tears both peers down coherently.
 */
export class CoopVictorySealPhase extends BattlePhase {
  public readonly phaseName = "CoopVictorySealPhase";
  private readonly identity: CoopAutomaticVictorySealIdentity;

  constructor(identity: CoopAutomaticVictorySealIdentity) {
    super();
    this.identity = identity;
  }

  start(): void {
    super.start();
    if (sealCoopAutomaticVictoryBoundary(this.identity)) {
      this.end();
    }
  }
}
