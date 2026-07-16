/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Heartbreak` (link-driven trio, item 4).
//
// DOUBLES/TRIPLES innate (inert in singles). On entry the holder LINKs to a
// nearest living ally (see `link.ts`). When that linked ally FAINTS, the holder
// (in a grief-rage) gains +1 Speed and +1 in its HIGHER attacking stat (Attack
// vs Sp. Atk by raw stat), and loses -1 Defense and -1 Sp. Def.
//
// The ally's faint is an EVENT, so it is driven from `FaintPhase.doFaint` (via
// `erHeartbreakOnAllyFaint`) rather than the link's lazy teardown. The link is
// broken afterwards. All stat changes route through `StatStageChangePhase` so
// Clear Body / Contrary / Mist and friends are honored.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { breakLink, formLink, getRawLinkPartner } from "./link";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_HEARTBREAK_ABILITY_ID = 5920;

/** PostSummon marker: forms the link on entry. */
export class HeartbreakAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      formLink(pokemon);
    }
  }
}

/** Whether `pokemon` carries an unsuppressed Heartbreak and is active. */
function hasHeartbreak(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true) && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "HeartbreakAbAttr")
  );
}

/**
 * React to `fainted` fainting: if it was linked to a living Heartbreak holder,
 * that holder gains +1 Speed & +1 higher attacking stat and loses -1 Def & -1
 * Sp.Def. Called from `FaintPhase.doFaint` while the ally is mid-teardown (so
 * the link is read RAW, without the both-on-field liveness gate).
 */
export function erHeartbreakOnAllyFaint(fainted: Pokemon): void {
  const holder = getRawLinkPartner(fainted);
  if (!holder || holder === fainted || !hasHeartbreak(holder)) {
    return;
  }
  breakLink(fainted);

  const higherAttack = holder.getStat(Stat.ATK) >= holder.getStat(Stat.SPATK) ? Stat.ATK : Stat.SPATK;
  const index = holder.getBattlerIndex();
  // +1 Speed and +1 higher attacking stat.
  globalScene.phaseManager.unshiftNew("StatStageChangePhase", index, true, [Stat.SPD, higherAttack], 1);
  // -1 Defense and -1 Sp.Def.
  globalScene.phaseManager.unshiftNew("StatStageChangePhase", index, true, [Stat.DEF, Stat.SPDEF], -1);
}
