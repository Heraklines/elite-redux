/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setCoopAbilityOperationEpoch } from "#data/elite-redux/coop/coop-ability-operation";
import { setCoopBargainOperationEpoch } from "#data/elite-redux/coop/coop-bargain-operation";
import { setCoopBiomeOperationEpoch } from "#data/elite-redux/coop/coop-biome-operation";
import { setCoopCatchFullOperationEpoch } from "#data/elite-redux/coop/coop-catch-full-operation";
import { setCoopColosseumOperationEpoch } from "#data/elite-redux/coop/coop-colosseum-operation";
import { setCoopFaintSwitchOperationEpoch } from "#data/elite-redux/coop/coop-faint-switch-operation";
import { setCoopLearnMoveOperationEpoch } from "#data/elite-redux/coop/coop-learn-move-operation";
import { setCoopMeOperationEpoch } from "#data/elite-redux/coop/coop-me-operation";
import { setCoopRevivalOperationEpoch } from "#data/elite-redux/coop/coop-revival-operation";
import { setCoopRewardOperationEpoch } from "#data/elite-redux/coop/coop-reward-operation";
import { setCoopStormglassOperationEpoch } from "#data/elite-redux/coop/coop-stormglass-operation";
import {
  type CoopWaveAdvanceOperationBinding,
  setCoopWaveAdvanceOperationEpoch,
} from "#data/elite-redux/coop/coop-wave-operation";

/**
 * One fan-out for the session controller's host-negotiated epoch. Every migrated operation surface must
 * reject prior-run ids under the same value; keeping the fan-out centralized prevents a newly added adapter
 * from silently remaining on epoch 1.
 */
export function applyCoopOperationEpoch(epoch: number, waveBinding?: CoopWaveAdvanceOperationBinding | null): void {
  if (!Number.isSafeInteger(epoch) || epoch <= 0) {
    return;
  }
  setCoopAbilityOperationEpoch(epoch);
  setCoopBargainOperationEpoch(epoch);
  setCoopBiomeOperationEpoch(epoch);
  setCoopCatchFullOperationEpoch(epoch);
  setCoopColosseumOperationEpoch(epoch);
  setCoopFaintSwitchOperationEpoch(epoch);
  setCoopLearnMoveOperationEpoch(epoch);
  setCoopMeOperationEpoch(epoch);
  setCoopRevivalOperationEpoch(epoch);
  setCoopRewardOperationEpoch(epoch);
  setCoopStormglassOperationEpoch(epoch);
  setCoopWaveAdvanceOperationEpoch(epoch, waveBinding);
}
