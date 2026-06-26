/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER damage-calc PREVIEW helper.
//
// Both player-facing predicted-damage surfaces - the fight-menu "DMG CALC" panel
// (fight-ui-handler) and the Battle Info "Damage Calculator" inspector page
// (battle-info-overlay) - go through this so they can never drift. Per-hit damage
// comes straight from the REAL Pokemon.getAttackDamage (simulated:true), which
// already applies the full ability suite (offensive/defensive multipliers, type
// change/immunity, STAB, weather, items, ER type-chart overrides, ...). The ONE
// thing a single simulated call can't see is MULTI-HIT - getAttackDamage returns
// one strike - so this layer scales it:
//   - MultiHitAttr moves (Double Kick / Bullet Seed / Rock Blast / ...), including
//     the ramping Triple-Kick effect (1x/2x/3x base per strike).
//   - ER Multi-Headed (ability 347): a single-target move strikes once per head
//     with reduced power on later heads -> x1.25 total (2 heads), x1.35 (3 heads).
//
// (Multi-Lens / Parental Bond / Minion-Control add strikes too; their exact
// per-strike falloff is left for a follow-up so a wrong factor can't make the
// preview LESS accurate than just delegating to the real per-hit calc.)
// =============================================================================

import { getErHeadCount } from "#data/elite-redux/archetypes/multi-headed";
import type { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MultiHitType } from "#enums/multi-hit-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

export interface ErDamagePreview {
  /** Min total damage across all strikes (0.85 roll). */
  min: number;
  /** Max total damage across all strikes (1.0 roll). */
  max: number;
  /** Max total damage on a critical hit. */
  crit: number;
  /** Hit-count label: "", "2", "2-5", "3 heads", ... */
  hits: string;
}

/** The total-damage multiplier (total / single-hit), min..max, from multi-hit sources. */
function multiHitFactor(
  source: Pokemon,
  target: Pokemon,
  move: Move,
): { min: number; max: number; hits: string } {
  // MultiHitAttr move (the move itself strikes multiple times).
  const mh = move.attrs.find(a => a.constructor.name === "MultiHitAttr") as
    | { getMultiHitType: () => MultiHitType }
    | undefined;
  let hitsMin = 1;
  let hitsMax = 1;
  switch (mh?.getMultiHitType()) {
    case MultiHitType.TWO:
      hitsMin = 2;
      hitsMax = 2;
      break;
    case MultiHitType.TWO_TO_FIVE:
      hitsMin = 2;
      hitsMax = 5;
      break;
    case MultiHitType.THREE:
      hitsMin = 3;
      hitsMax = 3;
      break;
    case MultiHitType.TEN:
      hitsMin = 10;
      hitsMax = 10;
      break;
    default:
      break;
  }
  if (hitsMax > 1) {
    // Ramping 3-strike moves (Triple Kick / Triple Axel) deal 1x/2x/3x base per
    // strike -> hits*(hits+1)/2 times the base hit; plain multi-hits multiply by count.
    const ramps = move.hasAttr("MultiHitPowerIncrementAttr");
    const scale = (h: number): number => (ramps ? (h * (h + 1)) / 2 : h);
    return {
      min: scale(hitsMin),
      max: scale(hitsMax),
      hits: hitsMin === hitsMax ? `${hitsMin} hits` : `${hitsMin}-${hitsMax} hits`,
    };
  }
  // ER Multi-Headed: only on a move that can actually be multi-strike-enhanced
  // (matches the ability's own gate, so it never over-counts a charging/spread move).
  if (
    source.hasAbility(ErAbilityId.MULTI_HEADED as unknown as AbilityId)
    && move.canBeMultiStrikeEnhanced(source, false, target)
  ) {
    const heads = getErHeadCount(source);
    const f = heads >= 3 ? 1.35 : 1.25;
    return { min: f, max: f, hits: `${heads} heads` };
  }
  return { min: 1, max: 1, hits: "" };
}

/**
 * Predicted damage of `move` from `source` onto `target` for the damage-calc UIs.
 * Reuses the real getAttackDamage (full ability suite) and scales for multi-hit.
 * Never throws; returns zeros on any failure.
 */
export function getErDamagePreview(source: Pokemon, target: Pokemon, move: Move): ErDamagePreview {
  let base = 0;
  let critBase = 0;
  // getAttackDamage's per-strike reduction (Multi-Headed / Minion-Control) reads
  // source.turnData.{hitCount,hitsLeft}; in a preview those are stale (no active
  // strike), which would wrongly reduce our BASE hit before we scale it. Pin them
  // to the first strike (strikeIndex 0 = full power) for the calc, then restore.
  const td = source.turnData as { hitCount: number; hitsLeft: number } | undefined;
  const savedHitCount = td?.hitCount;
  const savedHitsLeft = td?.hitsLeft;
  try {
    if (td) {
      td.hitCount = 1;
      td.hitsLeft = 1;
    }
    base = target.getAttackDamage({ source, move, simulated: true }).damage;
    critBase = target.getAttackDamage({ source, move, simulated: true, isCritical: true }).damage;
  } catch {
    base = 0;
    critBase = 0;
  } finally {
    if (td && savedHitCount !== undefined && savedHitsLeft !== undefined) {
      td.hitCount = savedHitCount;
      td.hitsLeft = savedHitsLeft;
    }
  }
  const f = multiHitFactor(source, target, move);
  return {
    min: Math.floor(base * 0.85 * f.min),
    max: Math.floor(base * f.max),
    crit: Math.floor(critBase * f.max),
    hits: f.hits,
  };
}
