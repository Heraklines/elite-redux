/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import type { CoopNestedInteractionReturnPlan } from "#data/elite-redux/coop/coop-operation-envelope";

/**
 * Capture the return plan from the exact queued reward continuation behind a nested picker. The plan is
 * cloned immediately and serialized by the picker presentation before input opens, so later queue changes
 * cannot alter the authoritative successor. `expectedPinned` prevents an unrelated queued reward phase
 * from being mistaken for the picker's parent.
 */
export function captureCoopNestedInteractionReturnPlan(
  expectedPinned?: number,
): CoopNestedInteractionReturnPlan | undefined {
  let captured: CoopNestedInteractionReturnPlan | undefined;
  globalScene.phaseManager.hasPhaseOfType("SelectModifierPhase", phase => {
    const candidate = phase.coopNestedInteractionReturnPlan();
    if (candidate == null || (expectedPinned != null && candidate.pinned !== expectedPinned)) {
      return false;
    }
    captured = structuredClone(candidate.plan);
    return true;
  });
  return captured;
}
