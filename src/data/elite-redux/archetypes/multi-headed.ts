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
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { SpeciesFormKey } from "#enums/species-form-key";
import type { Pokemon } from "#field/pokemon";

// Head count is data-driven from the ER ROM's per-species F_TWO_HEADED /
// F_THREE_HEADED flags, carried verbatim in the `flags` field of every
// `ER_SPECIES` dump entry. This covers vanilla 2/3-headed mons AND every ER
// custom (Pentadug/Pentawug/Wugtrio/Sandy Shocks/Iron Jugulis/Hydrapple/… =
// three-headed) without a hand-maintained list — so a new headed custom can
// never silently fall back to the 2-head default again.
//
// Megas are split out because a Mega is a FORM of its base pokerogue species
// (sharing `speciesId`): Mawile/Shuckle gain a 3rd head ONLY as a mega, so a
// `SPECIES_*_MEGA` dump entry's count is keyed under the mega-only map.
const BASE_HEAD_COUNT = new Map<number, number>();
const MEGA_HEAD_COUNT = new Map<number, number>();
// speciesConst -> pokerogue species id. Needed because a `SPECIES_*_MEGA` dump
// entry has its OWN dump id, but at runtime a mega is a FORM of the base species
// and keeps the BASE `speciesId`. So a mega's head count must be keyed under the
// base species' pokerogue id, resolved from the base `speciesConst`.
const CONST_TO_PK_ID = new Map<string, number>();
for (const draft of ER_SPECIES) {
  const pk = ER_ID_MAP.species[(draft as { id: number }).id];
  if (pk !== undefined) {
    CONST_TO_PK_ID.set((draft as { speciesConst: string }).speciesConst, pk);
  }
}
for (const draft of ER_SPECIES) {
  const flags = (draft as { flags?: string }).flags ?? "";
  const count = flags.includes("F_THREE_HEADED") ? 3 : flags.includes("F_TWO_HEADED") ? 2 : 0;
  if (count === 0) {
    continue;
  }
  const speciesConst = (draft as { speciesConst: string }).speciesConst;
  // A mega (`SPECIES_X_MEGA`, `_MEGA_X`, `_MEGA_Y`) keys under its BASE id, since
  // that is the speciesId the mega'd mon presents in battle.
  const megaMatch = /^(.*)_MEGA(?:_[XY])?$/.exec(speciesConst);
  if (megaMatch) {
    const baseId = CONST_TO_PK_ID.get(megaMatch[1]);
    if (baseId !== undefined) {
      MEGA_HEAD_COUNT.set(baseId, count);
    }
    continue;
  }
  const pkId = ER_ID_MAP.species[(draft as { id: number }).id];
  if (pkId !== undefined) {
    BASE_HEAD_COUNT.set(pkId, count);
  }
}

/** Whether the holder is currently in a Mega form (any mega form key). */
function isMega(pokemon: Pokemon): boolean {
  const key = pokemon.getFormKey();
  return key === SpeciesFormKey.MEGA || key === SpeciesFormKey.MEGA_X || key === SpeciesFormKey.MEGA_Y;
}

/** Number of heads (= number of strikes) for a Multi-Headed holder. Default 2. */
export function getErHeadCount(pokemon: Pokemon): number {
  const sid = pokemon.species.speciesId;
  if (isMega(pokemon)) {
    const mega = MEGA_HEAD_COUNT.get(sid);
    if (mega !== undefined) {
      return mega;
    }
  }
  return BASE_HEAD_COUNT.get(sid) ?? 2;
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
