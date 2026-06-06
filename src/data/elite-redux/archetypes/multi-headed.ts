/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Multi-Headed (ER ability 347) hit count.
//
// "Hits as many times as it has heads." The head count is NOT uniform — in the
// ER ROM it is a per-species flag (`F_TWO_HEADED` / `F_THREE_HEADED` in
// `gBaseStats[species].flags`, see vendor/elite-redux/source/src/battle_util.c
// and base_stats.h). The damaging-move handler then strikes once per head with
// reduced power on the later heads (2-headed: 100% + 25%; 3-headed: 100% + 20%
// + 15%) — that damage falloff is applied in `Pokemon.getBaseDamage`.
//
// The old wiring hardcoded TWO extra strikes (3 hits) for every Multi-Headed
// holder, so 2-headed mons (Doduo, Mawile, …) wrongly hit 3×. This attr makes
// the extra-strike count species-aware: `headCount - 1` extra strikes.
//
// Head counts come straight from the ROM's flag lists:
//   THREE_HEADED: Dugtrio, Magneton, Dodrio, Exeggutor, Combee, Magnezone,
//                 Probopass, Klang, Klinklang, Hydreigon, Barbaracle
//                 (+ Mega Mawile and Mega Shuckle, which gain a 3rd head only
//                  in their Mega form).
//   TWO_HEADED  : Doduo, Weezing, Girafarig, Mawile, Vanilluxe, Klink, Zweilous,
//                 Doublade, Binacle — and the default for any other Multi-Headed
//                 holder not explicitly flagged 3-headed in the ROM.
// Alolan Dugtrio / Alolan Exeggutor are forms of their (3-headed) base species,
// so they inherit 3 via the base-species id automatically.
// =============================================================================

import { AddSecondStrikeAbAttr, type AddSecondStrikeAbAttrParams } from "#abilities/ab-attrs";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";

/** Base species that are three-headed in ALL forms (per ROM F_THREE_HEADED). */
const THREE_HEADED: ReadonlySet<SpeciesId> = new Set<SpeciesId>([
  SpeciesId.DUGTRIO,
  SpeciesId.MAGNETON,
  SpeciesId.DODRIO,
  SpeciesId.EXEGGUTOR,
  SpeciesId.COMBEE,
  SpeciesId.MAGNEZONE,
  SpeciesId.PROBOPASS,
  SpeciesId.KLANG,
  SpeciesId.KLINKLANG,
  SpeciesId.HYDREIGON,
  SpeciesId.BARBARACLE,
]);

/**
 * Species that are three-headed ONLY in their Mega form (the ROM flags the
 * SPECIES_*_MEGA records, while the base is two-headed / not headed at all).
 */
const MEGA_THREE_HEADED: ReadonlySet<SpeciesId> = new Set<SpeciesId>([SpeciesId.MAWILE, SpeciesId.SHUCKLE]);

/** Whether the holder is currently in a Mega form (any mega form key). */
function isMega(pokemon: Pokemon): boolean {
  const key = pokemon.getFormKey();
  return key === SpeciesFormKey.MEGA || key === SpeciesFormKey.MEGA_X || key === SpeciesFormKey.MEGA_Y;
}

/** Number of heads (= number of strikes) for a Multi-Headed holder. Default 2. */
export function getErHeadCount(pokemon: Pokemon): number {
  const sid = pokemon.species.speciesId;
  if (THREE_HEADED.has(sid)) {
    return 3;
  }
  if (MEGA_THREE_HEADED.has(sid) && isMega(pokemon)) {
    return 3;
  }
  return 2;
}

/**
 * Multi-Headed: add `headCount - 1` extra strikes (so a 2-headed mon hits twice,
 * a 3-headed mon thrice). Reuses {@linkcode AddSecondStrikeAbAttr.canApply}
 * (only single-target moves that can be multi-strike-enhanced).
 */
export class ErMultiHeadedAbAttr extends AddSecondStrikeAbAttr {
  override apply(params: AddSecondStrikeAbAttrParams): void {
    params.hitCount.value += Math.max(0, getErHeadCount(params.pokemon) - 1);
  }
}
