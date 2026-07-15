/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Borrowed Time` (Mega Shuckle Y).
//
// "On entry, swap the holder's RAW (base, pre-stage/pre-item) Speed stat with
// the fastest opposing Pokemon. Over the next 3 turns the swap linearly decays:
// at the end of each turn 1/3 of the ORIGINAL difference returns to each side,
// so after 3 turn-ends both mons are back to their own Speed."
//
// The swap is applied to the permanent `stats[SPD]` value (what `getStat(SPD)`
// reads), so stage multipliers, items, and Relativity's Speed read all compose
// on top of the borrowed value. The trajectory is recomputed each turn from the
// stored originals + the fixed original difference (no cumulative rounding
// drift): holder = holderBase - diff * remaining/3, partner = partnerBase +
// diff * remaining/3, where remaining counts down 3 → 0.
//
// Partner switch-out (DEFAULT, documented): the swap persists on BOTH mons on
// the same decay schedule regardless of the partner leaving the field — the
// stored partner reference keeps decaying, and off-field writes are harmless.
//
// Two attrs on one ability: a PostSummon that performs the swap + seeds state,
// and a PostTurn that advances the decay. State is module-level, keyed on the
// holder. Deterministic (fastest opponent is a stat comparison, ties broken by
// battler index) — no RNG, co-op safe.
// =============================================================================

import { PostSummonAbAttr, PostTurnAbAttr } from "#abilities/ab-attrs";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_BORROWED_TIME_ABILITY_ID = 5910;

/** Number of end-of-turn decay steps before the swap fully unwinds. */
export const BORROWED_TIME_DECAY_TURNS = 3;

/** Live swap state for a Borrowed Time holder. */
interface BorrowedTimeState {
  /** The opposing Pokemon whose raw Speed was swapped in. */
  partner: Pokemon;
  /** Original (pre-swap) raw Speed of the holder. */
  holderBase: number;
  /** Original (pre-swap) raw Speed of the partner. */
  partnerBase: number;
  /** `holderBase - partnerBase` — the fixed amount that decays back over 3 turns. */
  diff: number;
  /** Number of end-of-turn decay steps applied so far (0..3). */
  elapsed: number;
}

const BORROWED_TIME_STATE = new WeakMap<Pokemon, BorrowedTimeState>();

/** Apply the current-turn Speed values for both sides given `remaining` (3..0). */
function applyDecay(state: BorrowedTimeState, holder: Pokemon): void {
  const remaining = BORROWED_TIME_DECAY_TURNS - state.elapsed;
  const share = (state.diff * remaining) / BORROWED_TIME_DECAY_TURNS;
  // holder trails its own base by `share`; partner leads its own base by `share`.
  holder.setStat(Stat.SPD, Math.max(1, Math.round(state.holderBase - share)));
  state.partner.setStat(Stat.SPD, Math.max(1, Math.round(state.partnerBase + share)));
}

/** PostSummon half: find the fastest opponent, swap raw Speed, seed decay state. */
export class BorrowedTimeSummonAbAttr extends PostSummonAbAttr {
  constructor() {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().some(o => o?.isActive(true));
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const opponents = pokemon.getOpponents().filter(o => o?.isActive(true));
    if (opponents.length === 0) {
      return;
    }
    // Fastest opponent by RAW Speed; ties broken deterministically by battler index.
    const partner = opponents.reduce((fastest, o) => (o.getStat(Stat.SPD) > fastest.getStat(Stat.SPD) ? o : fastest));
    const holderBase = pokemon.getStat(Stat.SPD);
    const partnerBase = partner.getStat(Stat.SPD);
    const state: BorrowedTimeState = {
      partner,
      holderBase,
      partnerBase,
      diff: holderBase - partnerBase,
      elapsed: 0,
    };
    BORROWED_TIME_STATE.set(pokemon, state);
    // Full swap at elapsed 0 (remaining = 3 → share = diff).
    applyDecay(state, pokemon);
  }
}

/** PostTurn half: advance the linear decay; restore + clear on completion. */
export class BorrowedTimeDecayAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return BORROWED_TIME_STATE.has(pokemon);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const state = BORROWED_TIME_STATE.get(pokemon);
    if (!state) {
      return;
    }
    state.elapsed += 1;
    if (state.elapsed >= BORROWED_TIME_DECAY_TURNS) {
      // Restore both sides EXACTLY to their originals, then clear.
      pokemon.setStat(Stat.SPD, Math.max(1, state.holderBase));
      state.partner.setStat(Stat.SPD, Math.max(1, state.partnerBase));
      BORROWED_TIME_STATE.delete(pokemon);
      return;
    }
    applyDecay(state, pokemon);
  }
}

/** Test helper: read the holder's current live Borrowed Time state (or `undefined`). */
export function erBorrowedTimeState(pokemon: Pokemon): Readonly<BorrowedTimeState> | undefined {
  return BORROWED_TIME_STATE.get(pokemon);
}
