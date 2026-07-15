/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Last Host`.
//
// "Once per battle, if the holder would faint (direct OR indirect damage) while
// at least one opposing Pokemon is affected by Infestation: consume the
// Infestation on the affected opponent with the HIGHEST current HP; the holder
// survives at 1 HP; that opponent (the parasite's host) loses 25% of its max HP,
// which CAN faint it. Cannot trigger again even if the holder heals."
//
// Hooked from `Pokemon.damage` (the single chokepoint for BOTH direct and
// indirect damage — the same place ER's Second Wind / Pharaoh's Ankh relics
// clamp a lethal hit to 1 HP). `erTryLastHost` returns whether the holder should
// survive; the caller then sets `damage = hp - 1`.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_LAST_HOST_ABILITY_ID = 5906;

/** Fraction of the consumed host's max HP it loses when Last Host fires. */
export const LAST_HOST_HOST_DAMAGE_FRACTION = 0.25;

/** Marker attribute; the survival effect is applied by {@linkcode erTryLastHost}. */
export class LastHostAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/**
 * Per-holder record of the wave (battle) in which Last Host last fired. A wave is
 * one battle here, so comparing against the current wave enforces "once per
 * battle" (and re-arms on the next battle). Deterministic — no RNG, co-op safe.
 */
const LAST_HOST_USED = new WeakMap<Pokemon, number>();

/**
 * Attempt Last Host on a would-be-fatal hit against `pokemon`. Returns `true`
 * when the holder should cling to life at 1 HP (the caller performs the clamp),
 * having consumed the highest-HP infested opponent's Infestation and dealt 25% of
 * that opponent's max HP to it.
 */
export function erTryLastHost(pokemon: Pokemon): boolean {
  if (pokemon.hp < 1) {
    return false;
  }
  if (!pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "LastHostAbAttr")) {
    return false;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  if (LAST_HOST_USED.get(pokemon) === wave) {
    return false;
  }
  const infested = pokemon.getOpponents().filter(o => o?.isActive(true) && !!o.getTag(BattlerTagType.INFESTATION));
  if (infested.length === 0) {
    return false;
  }
  // The affected opponent with the HIGHEST current HP hosts the parasite.
  const host = infested.reduce((highest, o) => (o.hp > highest.hp ? o : highest));

  LAST_HOST_USED.set(pokemon, wave);
  host.removeTag(BattlerTagType.INFESTATION);
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} clung to life through its last host!`);
  // The host loses 25% of its max HP - this can faint it.
  host.damageAndUpdate(toDmgValue(host.getMaxHp() * LAST_HOST_HOST_DAMAGE_FRACTION, 1), { result: HitResult.INDIRECT });
  return true;
}
