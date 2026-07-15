/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Chivalry` (Mega Dragonite).
//
// DOUBLES / TRIPLES: the holder takes 50% of the DIRECT damage aimed at its
// ally. NERF (binding): the transferred share is a RAW HP deduction — it is NOT
// recalculated against the holder's defenses and Multiscale / damage-reduction /
// resistances do NOT reduce it. The ally keeps the OTHER 50% (a protective
// "transfer", matching the knight flavor — documented DECISION).
//
// SINGLES: whenever the holder VOLUNTARILY switches out (the menu "Switch"
// command), the incoming Pokemon carries a redirect: 25% of the DIRECT damage it
// takes is sent to the off-field holder as a raw HP deduction, until the end of
// the incoming Pokemon's next full turn (DEFAULT). The off-field holder CAN
// faint from this — and does so SAFELY: an off-field deduction never queues a
// FaintPhase (which would corrupt the summon flow); the holder is simply at 0 HP
// (fainted) when next summoned/checked.
//
// Both halves are applied in `Pokemon.damageAndUpdate` (which carries the
// attacking `source` and the direct/indirect `result`). The transferred /
// redirected hit is dealt as `HitResult.INDIRECT` (or a raw HP write for an
// off-field holder), so it never re-enters the damage formula and cannot
// recursively re-trigger Chivalry. The voluntary-switch mark is set from
// `SwitchSummonPhase`, mirroring the Bonded Charm relic's switch detection.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { HitResult } from "#enums/hit-result";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_CHIVALRY_ABILITY_ID = 5909;

/** Share of a direct hit on the ally transferred to the holder (doubles/triples). */
export const CHIVALRY_ALLY_TRANSFER_FRACTION = 0.5;
/** Share of a direct hit on the switch-in redirected to the off-field holder (singles). */
export const CHIVALRY_SWITCH_REDIRECT_FRACTION = 0.25;

/** Marker attribute; the transfer/redirect are applied by the `erApplyChivalry*` helpers. */
export class ChivalryAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Whether a pokemon carries an unsuppressed Chivalry among its active ability attrs. */
export function pokemonCarriesChivalry(pokemon: Pokemon): boolean {
  return pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "ChivalryAbAttr");
}

/** Whether a living, active pokemon carries an unsuppressed Chivalry. */
function hasChivalry(pokemon: Pokemon): boolean {
  return pokemon.isActive(true) && pokemonCarriesChivalry(pokemon);
}

/** Deduct `share` from `holder` as raw HP: `damageAndUpdate` on-field (so it can
 * faint properly), a plain HP write off-field (no FaintPhase → no corruption). */
function dealRawToHolder(holder: Pokemon, share: number): void {
  if (share <= 0 || holder.isFainted()) {
    return;
  }
  if (holder.isOnField()) {
    // On-field (doubles ally): INDIRECT so no defense recalc / Multiscale.
    holder.damageAndUpdate(share, { result: HitResult.INDIRECT });
  } else {
    // Off-field (singles switched-out holder): raw write, never a FaintPhase.
    holder.hp = Math.max(0, holder.hp - share);
  }
}

/**
 * DOUBLES/TRIPLES transfer. When `victim` takes a direct hit for `incomingDamage`
 * and a living ally carries Chivalry, that ally absorbs 50% as a raw HP hit.
 * Returns the amount removed from `victim`'s incoming damage (0 if inapplicable).
 */
export function erApplyChivalryAllyTransfer(victim: Pokemon, incomingDamage: number): number {
  if (incomingDamage <= 0) {
    return 0;
  }
  const holder = victim.getAllies().find(a => hasChivalry(a));
  if (!holder) {
    return 0;
  }
  const share = toDmgValue(incomingDamage * CHIVALRY_ALLY_TRANSFER_FRACTION, 1);
  if (share <= 0) {
    return 0;
  }
  dealRawToHolder(holder, share);
  return share;
}

/** Live singles redirect state for a switched-in Pokemon. */
interface ChivalryRedirect {
  /** The off-field Chivalry holder that switched out. */
  holder: Pokemon;
  /** Battle turn at/through which the redirect stays active (end of the incoming mon's next full turn). */
  expiryTurn: number;
}

const CHIVALRY_REDIRECT = new WeakMap<Pokemon, ChivalryRedirect>();

/**
 * Mark the switched-in `incoming` Pokemon to redirect 25% of its direct damage to
 * the off-field `holder` until the end of its next full turn. Called from
 * `SwitchSummonPhase` when a Chivalry holder voluntarily switches out.
 */
export function markChivalryRedirect(incoming: Pokemon, holder: Pokemon): void {
  CHIVALRY_REDIRECT.set(incoming, {
    holder,
    expiryTurn: (globalScene.currentBattle?.turn ?? 0) + 1,
  });
}

/**
 * SINGLES redirect. When `victim` (a marked switch-in) takes a direct hit, 25% is
 * dealt to the off-field holder as a raw HP deduction. Returns the amount removed
 * from `victim`'s incoming damage (0 if inapplicable / expired).
 */
export function erApplyChivalrySwitchRedirect(victim: Pokemon, incomingDamage: number): number {
  if (incomingDamage <= 0) {
    return 0;
  }
  const state = CHIVALRY_REDIRECT.get(victim);
  if (!state) {
    return 0;
  }
  if ((globalScene.currentBattle?.turn ?? 0) > state.expiryTurn || state.holder.isFainted()) {
    CHIVALRY_REDIRECT.delete(victim);
    return 0;
  }
  const share = toDmgValue(incomingDamage * CHIVALRY_SWITCH_REDIRECT_FRACTION, 1);
  if (share <= 0) {
    return 0;
  }
  dealRawToHolder(state.holder, share);
  return share;
}

/**
 * Apply BOTH Chivalry halves for a direct hit on `victim`, returning the total HP
 * removed from the incoming damage (the caller subtracts it before applying). The
 * doubles transfer and the singles redirect are mutually exclusive in practice
 * (an on-field ally vs an off-field switched-out holder).
 */
export function erApplyChivalry(victim: Pokemon, incomingDamage: number): number {
  const transferred = erApplyChivalryAllyTransfer(victim, incomingDamage);
  const redirected = erApplyChivalrySwitchRedirect(victim, incomingDamage - transferred);
  return transferred + redirected;
}

/** Test helper: whether `incoming` currently carries a live redirect. */
export function erChivalryRedirectActive(incoming: Pokemon): boolean {
  const state = CHIVALRY_REDIRECT.get(incoming);
  return !!state && (globalScene.currentBattle?.turn ?? 0) <= state.expiryTurn;
}
