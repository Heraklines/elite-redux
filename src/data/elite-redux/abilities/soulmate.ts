/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Soulmate` (Discupid trio, item 2).
//
// DOUBLES/TRIPLES innate (inert in singles — no ally to link). On entry the
// holder forms a LINK to a nearest living ally (see `link.ts`). While linked:
//   - 25% of the DIRECT damage the linked ally takes is REDIRECTED to the
//     holder as a raw HP deduction (reuses Batch 2's Chivalry transfer plumbing:
//     an INDIRECT on-field write, so it is NOT recalculated against the holder's
//     defenses / Multiscale, and cannot re-trigger the redirect). The ally keeps
//     the other 75%.
//   - 50% of the DIRECT healing the HOLDER receives is COPIED to the linked ally.
//     The copied heal can NEVER recursively trigger another healing-copy — a
//     module-level guard flag suppresses re-entry (documented DECISION).
//
// Damage redirect is applied in `Pokemon.damageAndUpdate` (alongside Chivalry);
// heal copy in `Pokemon.heal`.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { HitResult } from "#enums/hit-result";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import { formLink, getLinkedAlly } from "./link";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_SOULMATE_ABILITY_ID = 5918;

/** Share of the linked ally's direct damage redirected to the holder. */
export const SOULMATE_DAMAGE_REDIRECT_FRACTION = 0.25;
/** Share of the holder's direct healing copied to the linked ally. */
export const SOULMATE_HEAL_COPY_FRACTION = 0.5;

/** PostSummon marker: forms the link on entry. The redirect/heal-copy run via the `erSoulmate*` helpers. */
export class SoulmateAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      formLink(pokemon);
    }
  }
}

/** Whether a living, active pokemon carries an unsuppressed Soulmate. */
function hasSoulmate(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true) && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "SoulmateAbAttr")
  );
}

/**
 * DAMAGE REDIRECT. When `victim` takes a direct hit and its linked partner is a
 * Soulmate holder, 25% is redirected to that holder as a raw INDIRECT HP hit.
 * Returns the amount removed from `victim`'s incoming damage (0 if inapplicable).
 */
export function erApplySoulmateRedirect(victim: Pokemon, incomingDamage: number): number {
  if (incomingDamage <= 0) {
    return 0;
  }
  const partner = getLinkedAlly(victim);
  if (!partner || !hasSoulmate(partner) || partner.isFainted()) {
    return 0;
  }
  const share = toDmgValue(incomingDamage * SOULMATE_DAMAGE_REDIRECT_FRACTION, 1);
  if (share <= 0) {
    return 0;
  }
  // INDIRECT: raw, no defense recalc / Multiscale, cannot re-trigger the redirect.
  partner.damageAndUpdate(share, { result: HitResult.INDIRECT });
  return share;
}

/** Recursion guard: while a copied heal is being applied, no further copy fires. */
let copyingHeal = false;

/**
 * HEAL COPY. When a Soulmate `holder` heals `healedAmount`, copy 50% to its
 * linked ally. Guarded so the copied heal cannot recursively re-copy. Called
 * from `Pokemon.heal` with the ACTUAL amount healed.
 */
export function erApplySoulmateHealCopy(holder: Pokemon, healedAmount: number): void {
  if (copyingHeal || healedAmount <= 0 || !hasSoulmate(holder)) {
    return;
  }
  const ally = getLinkedAlly(holder);
  if (!ally || ally.isFainted() || ally.isFullHp()) {
    return;
  }
  const copy = toDmgValue(healedAmount * SOULMATE_HEAL_COPY_FRACTION, 1);
  if (copy <= 0) {
    return;
  }
  copyingHeal = true;
  try {
    ally.heal(copy);
  } finally {
    copyingHeal = false;
  }
}
