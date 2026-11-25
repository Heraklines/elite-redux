/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Life Preserver`.
//
// "Once per battle, when this Pokemon's active ALLY would faint from DIRECT
// attack damage, that ally survives at 1 HP and the attacker becomes Drenched
// (ER_DRENCHED — moves last in its priority bracket for 2 turns; Water-types
// and drench-immune mons are unaffected)."
//
// Doubles-oriented: the HOLDER protects its partner. Hooked from
// `Pokemon.damageAndUpdate` (which carries the attacking `source` and the
// direct/indirect `result`) beside the other ER survive hooks. Once-per-battle
// is tracked per HOLDER keyed on the wave index (mirrors Last Host).
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_LIFE_PRESERVER_ABILITY_ID = 5916;

/** Marker attribute; the save + drench is applied by {@linkcode erTryLifePreserver}. */
export class LifePreserverAbAttr extends AbAttr {
  /** @param drenchTurns - How many turns the attacker stays Drenched (default 2). */
  constructor(public readonly drenchTurns: number = 2) {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Per-holder record of the wave (battle) in which Life Preserver last fired. */
const LIFE_PRESERVER_USED = new WeakMap<Pokemon, number>();

/** The unsuppressed Life Preserver attr a living, active pokemon carries, if any (found by name). */
function lifePreserverOf(pokemon: Pokemon): LifePreserverAbAttr | undefined {
  if (!pokemon.isActive(true)) {
    return;
  }
  return pokemon.getAllActiveAbilityAttrs().find(a => a?.constructor?.name === "LifePreserverAbAttr") as
    | LifePreserverAbAttr
    | undefined;
}

/**
 * Attempt Life Preserver when `defender` would faint from a DIRECT hit by
 * `source`. Returns `true` when the defender should cling to life at 1 HP (the
 * caller performs the clamp), having consumed a living ally-holder's once-per-
 * battle charge and Drenched the attacker (Water-type / drench-immune attackers
 * simply take no Drench, per `ErDrenchedTag.canAdd`).
 */
export function erTryLifePreserver(defender: Pokemon, source: Pokemon | undefined): boolean {
  if (!source || defender.hp < 1) {
    return false;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  // The holder is a LIVING ALLY of the defender carrying Life Preserver, that
  // has not spent its charge this battle.
  const holder = defender.getAllies().find(a => lifePreserverOf(a) !== undefined && LIFE_PRESERVER_USED.get(a) !== wave);
  if (!holder) {
    return false;
  }
  const attr = lifePreserverOf(holder);
  LIFE_PRESERVER_USED.set(holder, wave);
  globalScene.phaseManager.queueMessage(
    `${holder.getNameToRender()}'s Life Preserver kept ${defender.getNameToRender()} afloat!`,
  );
  // Drench the attacker (Water-types / drench-immune mons are filtered by canAdd).
  source.addTag(BattlerTagType.ER_DRENCHED, attr?.drenchTurns ?? 2, MoveId.NONE, holder.id);
  return true;
}

export function erLifePreserverUsedWave(pokemon: Pokemon): number | undefined {
  return LIFE_PRESERVER_USED.get(pokemon);
}
