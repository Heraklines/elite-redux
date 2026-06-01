/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `force-foe-out-on-inactivity` archetype.
//
// PostTurn hook that tracks, per opposing pokemon, how many consecutive turns
// it has gone without using a damaging move. Once a foe reaches `turns` idle
// turns, it is forced out (and its counter resets).
//
// "Attacking" is read from the foe's move history: a new history entry whose
// move is a non-STATUS move counts as an attack and resets the idle counter.
// The snapshot of history length is stored per-foe on the Pokemon instance via
// a Symbol, so a freshly switched-in foe starts clean.
//
// Wires:
//   - 913 Strikeout — "Forces the foe out if they don't attack for 3 turns."
// =============================================================================

import { type AbAttrBaseParams, ForceSwitchOutHelper, PostTurnAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SwitchType } from "#enums/switch-type";
import type { Pokemon } from "#field/pokemon";

const SEEN_LEN = Symbol("ForceFoeOutOnInactivity.seenHistoryLen");
const IDLE = Symbol("ForceFoeOutOnInactivity.idleTurns");

export class ForceFoeOutOnInactivityAbAttr extends PostTurnAbAttr {
  private readonly turns: number;
  private readonly helper = new ForceSwitchOutHelper(SwitchType.SWITCH);

  constructor(turns = 3) {
    super();
    this.turns = turns;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().some(o => o && !o.isFainted());
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const opp of pokemon.getOpponents()) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      const store = opp as unknown as Record<symbol, number>;
      const history = opp.getMoveHistory();
      const seen = store[SEEN_LEN] ?? 0;
      const attackedThisTurn = history
        .slice(seen)
        .some(tm => tm.move !== MoveId.NONE && allMoves[tm.move]?.category !== MoveCategory.STATUS);
      store[SEEN_LEN] = history.length;

      if (attackedThisTurn) {
        store[IDLE] = 0;
        continue;
      }

      const idle = (store[IDLE] ?? 0) + 1;
      store[IDLE] = idle;
      if (idle >= this.turns) {
        store[IDLE] = 0;
        store[SEEN_LEN] = 0;
        this.helper.switchOutLogic(opp);
      }
    }
  }

  /** Test helper: current idle-turn count tracked for a given foe. */
  public idleTurns(foe: Pokemon): number {
    return (foe as unknown as Record<symbol, number>)[IDLE] ?? 0;
  }
}
