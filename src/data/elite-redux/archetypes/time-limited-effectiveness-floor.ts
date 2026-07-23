/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `time-limited-effectiveness-floor` archetype.
//
// A time-boxed clone of Tera Shell's effectiveness OVERRIDE. For the first N
// turns after the holder enters, every attack it receives is treated as
// not-very-effective: the type-effectiveness multiplier is FLOORED at 0.5x
// (a 2x/4x hit is clamped DOWN to 0.5x; an already-resisted 0.25x/0.5x hit is
// left untouched). Unlike a flat damage multiplier, this matches the dex's
// "considered not very effective" wording exactly.
//
// It extends `FullHpResistTypeAbAttr` so the engine's existing
// `applyAbAttrs("FullHpResistTypeAbAttr", …)` call in `getMoveEffectiveness`
// picks it up via `instanceof` (no extra dispatch site needed). The only
// difference from the base is the GATE: a 3-turn entry window (tracked via
// `tempSummonData.turnCount`, resets on switch) instead of `isFullHp()`. The
// inherited `apply` also stamps `turnData.moveEffectiveness = 0.5`, so a
// multi-hit move is floored on every sub-hit.
//
// Wires:
//   - 773 Soothsayer — "All attacks received are considered not very effective
//     for three turns on entry."
// =============================================================================

import { type AbAttrBaseParams, FullHpResistTypeAbAttr, PostSummonAbAttr } from "#abilities/ab-attrs";
import type { TypeMultiplierAbAttrParams } from "#types/ability-types";
import { NumberHolder } from "#utils/common";

export interface TimeLimitedEffectivenessFloorOptions {
  /** Number of turns from entry the effectiveness floor stays active. */
  readonly turns: number;
  /** Optional entry-window token required for the floor to apply. */
  readonly activeWindowKey?: string;
}

/** Opens an entry-local window only on the holder's first summon of a battle. */
export class ActivateOncePerBattleEntryWindowAbAttr extends PostSummonAbAttr {
  private readonly key: string;

  constructor(key: string) {
    super(true);
    if (key.trim().length === 0) {
      throw new Error("[ActivateOncePerBattleEntryWindowAbAttr] key must be non-empty");
    }
    this.key = key;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return !pokemon.waveData.entryEffectsFired.has(this.key);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated || pokemon.waveData.entryEffectsFired.has(this.key)) {
      return;
    }
    pokemon.waveData.entryEffectsFired.add(this.key);
    pokemon.tempSummonData.abilityEntryWindows.add(this.key);
  }
}

export class TimeLimitedEffectivenessFloorAbAttr extends FullHpResistTypeAbAttr {
  private readonly turns: number;
  private readonly activeWindowKey: string | undefined;

  constructor(options: TimeLimitedEffectivenessFloorOptions) {
    super();
    if (options.turns <= 0) {
      throw new Error("[TimeLimitedEffectivenessFloorAbAttr] turns must be positive");
    }
    this.turns = options.turns;
    this.activeWindowKey = options.activeWindowKey;
  }

  override canApply({ typeMultiplier, move, pokemon }: TypeMultiplierAbAttrParams): boolean {
    // `tempSummonData.turnCount` starts at 1 on the entry turn and increments each
    // turn (resets on switch), so the entry turn is turn 1. `<= turns` therefore
    // covers turns 1..turns inclusive — i.e. a full `turns`-turn window from entry.
    const turnNumber = pokemon.tempSummonData?.turnCount ?? 1;
    return (
      (this.activeWindowKey === undefined || pokemon.tempSummonData.abilityEntryWindows.has(this.activeWindowKey))
      && turnNumber <= this.turns
      && typeMultiplier instanceof NumberHolder
      && !move?.hasAttr("FixedDamageAttr")
      && typeMultiplier.value > 0.5
    );
  }

  // `apply` inherited: floors typeMultiplier to 0.5 and caches it on turnData.

  // Suppress the Tera-Shell flavour message — the ability popup is enough.
  override getTriggerMessage(): string {
    return "";
  }
}
