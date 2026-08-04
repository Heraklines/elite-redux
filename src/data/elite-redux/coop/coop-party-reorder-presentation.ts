/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";

type CoopPartyReorderPresentationProjector = (scene: BattleScene, capacity: number) => Promise<number>;

let projector: CoopPartyReorderPresentationProjector | null = null;

/** Install the concrete visual projector without making the UI layer import Pokemon presentation classes. */
export function installCoopPartyReorderPresentationProjector(
  nextProjector: CoopPartyReorderPresentationProjector,
): void {
  projector = nextProjector;
}

/** Invoke the presentation leaf that is registered by the ordinary battle presentation module. */
export function settleCoopPartyReorderPresentationReady(scene: BattleScene, capacity: number): Promise<number> {
  if (projector == null) {
    return Promise.reject(new Error("Co-op party-reorder presentation projector is not installed"));
  }
  return projector(scene, capacity);
}
